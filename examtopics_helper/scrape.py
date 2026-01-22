from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from bs4 import BeautifulSoup
from tqdm import tqdm

from .db import ParsedQuestion
from .http import FetchConfig, polite_get


@dataclass(frozen=True)
class CollectUrlsConfig:
    max_workers: int = 10


def normalize_discussion_url(base_url: str, href: str) -> str:
    # keep it simple; ExamTopics links are usually absolute-path.
    if href.startswith("http://") or href.startswith("https://"):
        return href
    if href.startswith("/"):
        m = re.match(r"^(https?://[^/]+)", base_url)
        if m:
            return m.group(1) + href
    # fallback: join-ish
    return base_url.rstrip("/") + "/" + href.lstrip("/")


def collect_discussion_urls_from_list_pages(
    list_page_urls: Iterable[str],
    target_exam_keyword: str,
    fetch: FetchConfig,
    cfg: CollectUrlsConfig = CollectUrlsConfig(),
) -> list[str]:
    """
    list_page_urls: e.g. https://www.examtopics.com/discussions/amazon-aws/1
    target_exam_keyword: match against anchor text (case-insensitive)
    """
    target = target_exam_keyword.strip().lower()
    out: list[str] = []

    def fetch_one(url: str) -> list[str]:
        resp = polite_get(url, fetch)
        soup = BeautifulSoup(resp.content, "lxml")
        anchors = soup.select("a.discussion-link")
        urls: list[str] = []
        for a in anchors:
            text = a.get_text(" ", strip=True)
            href = a.get("href")
            if not href:
                continue
            if target and target not in text.lower():
                continue
            urls.append(normalize_discussion_url(url, href))
        return urls

    with ThreadPoolExecutor(max_workers=cfg.max_workers) as ex:
        futures = [ex.submit(fetch_one, u) for u in list_page_urls]
        for fut in tqdm(
            as_completed(futures),
            total=len(futures),
            desc="collecting discussion urls",
            unit="page",
        ):
            out.extend(fut.result())

    # de-dup keep order
    seen = set()
    uniq: list[str] = []
    for u in out:
        if u in seen:
            continue
        seen.add(u)
        uniq.append(u)
    return uniq


def _text_or_none(el) -> Optional[str]:
    if el is None:
        return None
    s = el.get_text(" ", strip=True)
    return s if s else None


def _strip_suggested_answer_ui(text: str) -> str:
    # ExamTopics sometimes renders UI text into the extracted question body, e.g.:
    # "Show Suggested Answer Hide Answer Suggested Answer: CD 🗳️"
    # We keep the question, and strip everything from "Show Suggested Answer" onward.
    s = text or ""
    # Be tolerant to weird whitespace / missing spaces.
    s2 = re.sub(r"\s*(Show\s*Suggested\s*Answer|Hide\s*Answer)\b.*$", "", s, flags=re.I)
    if s2 != s:
        return s2.strip()
    # Fallback: if only "Suggested Answer:" is present
    s3 = re.sub(r"\s*Suggested\s*Answer\s*:.*$", "", s, flags=re.I)
    return s3.strip()


def _strip_inline_choices_from_text(text: str) -> str:
    """
    Some pages include choices inline in the same extracted question text, e.g.:
    "... Which solution...? A. ... B. ... C. ..."
    Heuristic: if we see A and B option markers, strip everything from the first A marker onward.
    """
    s = text or ""
    if not re.search(r"\sA[\.\)]\s", s):
        return s.strip()
    if not re.search(r"\sB[\.\)]\s", s):
        return s.strip()
    m = re.search(r"\sA[\.\)]\s", s)
    return (s[: m.start()] if m else s).strip()


def _extract_answer_labels(text: str) -> list[str]:
    """
    Extract single/multi answer labels from either:
    - "Suggested Answer: B"
    - "Suggested Answer: AC"
    - "Suggested Answer: A, C"
    - "Correct Answer: A, C"
    Returns list like ["A","C"] preserving order.
    """
    if not text:
        return []

    # Prefer Suggested Answer if available
    m = re.search(r"Suggested\s*Answer\s*:\s*([A-Z][A-Z\s,]*)", text, flags=re.I)
    if not m:
        m = re.search(r"Correct\s*Answer\s*:\s*([A-Z][A-Z\s,]*)", text, flags=re.I)
    if not m:
        return []

    raw = m.group(1).upper()
    letters = re.findall(r"[A-Z]", raw)
    out: list[str] = []
    seen: set[str] = set()
    for ch in letters:
        if ch in seen:
            continue
        seen.add(ch)
        out.append(ch)
    return out


def _format_top_voted_explanation(discussion_text: Optional[str]) -> Optional[str]:
    """
    Keep only the highest-voted comment from the discussion text.

    We rely on the plain-text markers that appear in extracted discussions:
      "... upvoted 27 times ..."
    This is robust even when the HTML structure changes.
    """
    if not discussion_text:
        return None

    s = str(discussion_text).replace("\u00a0", " ").strip()
    vote_pat = re.compile(r"\bupvoted\s+(\d+)\s+times?\b", flags=re.I)

    matches = list(vote_pat.finditer(s))
    if not matches:
        # No vote markers → leave as-is (but trimmed)
        return s or None

    blocks: list[tuple[int, str]] = []
    start = 0
    for m in matches:
        block = s[start : m.start()].strip()
        # Strip common separators between comments
        block = re.sub(r"^\s*\.\.\.\s*", "", block)
        try:
            votes = int(m.group(1))
        except Exception:
            votes = 0
        if block:
            blocks.append((votes, block))
        start = m.end()

    if not blocks:
        return None

    votes, best = max(blocks, key=lambda x: x[0])

    # Make it readable: normalize separators and spacing
    best = best.replace(" ... ", "\n\n").replace("...", "\n\n")
    best = re.sub(r"\n{3,}", "\n\n", best)
    best = re.sub(r"[ \t]{2,}", " ", best).strip()

    # Best-effort parse: author / age / selected answer
    author = None
    age = None
    selected = None
    body = best

    m_author = re.match(r"^([^\s]+)\s+(.*)$", best)
    rest = best
    if m_author:
        author = m_author.group(1).strip()
        rest = m_author.group(2).strip()

    # Remove common labels that appear between author and age
    rest = re.sub(r"\b(Highly\s+Voted|Most\s+Recent)\b", "", rest, flags=re.I).strip()

    m_age = re.search(r"(\d[\w\s,]*?\bago)\b", rest, flags=re.I)
    if m_age:
        age = m_age.group(1).strip()

    m_sel = re.search(r"Selected\s+Answer\s*:\s*([A-Z]{1,6})", rest, flags=re.I)
    if m_sel:
        selected = m_sel.group(1).strip().upper()
        body = rest[m_sel.end() :].strip()
    else:
        # Sometimes the thread uses "Correct D." instead of "Selected Answer: D"
        m_corr = re.search(r"\bCorrect\s+([A-Z]{1,6})\b", rest, flags=re.I)
        if m_corr:
            selected = m_corr.group(1).strip().upper()
            body = rest[m_corr.end() :].strip()
        else:
            body = rest.strip()

    # If body redundantly starts with the age again, strip it
    if age:
        body = re.sub(rf"^\s*{re.escape(age)}\s*", "", body).strip()

    # Add a newline before URLs for readability
    body = re.sub(r"(?<!\s)(https?://\S+)", r"\n\1", body)
    body = re.sub(r"\s+(https?://\S+)", r"\n\1", body).strip()

    lines: list[str] = [f"Top voted ({votes} votes)", ""]
    if author:
        lines.append(f"author: {author}")
    if age:
        lines.append(age)
    if selected:
        lines.append(f"Selected Answer: {selected}")
    if body:
        lines.extend(["", body])
    return "\n".join(lines).strip() or None


def parse_discussion_page(html: str) -> ParsedQuestion:
    """
    Best-effort parser with fallbacks.
    If correct answer cannot be derived, all choices are stored with is_correct=False.
    """
    soup = BeautifulSoup(html, "lxml")

    # Title-ish fallback (not stored in ParsedQuestion, caller can pull separately if needed)
    # question text candidates
    q_el = (
        soup.select_one(".question-body")
        or soup.select_one(".question-text")
        or soup.select_one("div.question")
        or soup.select_one("article")
    )
    q_text_raw = _text_or_none(q_el) or _text_or_none(soup.select_one("h1")) or "Question"
    # If q_el is a broad container, it may include choices; attempt to remove them before extracting text.
    if q_el is not None:
        try:
            tmp = BeautifulSoup(str(q_el), "lxml")
            # Remove common choice containers within this subtree
            for sel in [
                ".question-choices",
                "ul.choices",
                "li.multi-choice-item",
                ".multi-choice-item",
            ]:
                for el in tmp.select(sel):
                    el.decompose()
            cleaned = tmp.get_text(" ", strip=True)
            if cleaned:
                q_text_raw = cleaned
        except Exception:
            pass

    # choices candidates
    choice_els = (
        soup.select(".question-choices li")
        or soup.select("ul.choices li")
        or soup.select("li.multi-choice-item")
    )

    explanation_el = soup.select_one(".discussion-container") or soup.select_one(
        ".discussion"
    )
    discussion_text = _text_or_none(explanation_el)
    explanation = _format_top_voted_explanation(discussion_text)

    # attempt to detect official answer labels (Suggested Answer preferred)
    meta_text = f"{q_text_raw} {discussion_text or ''}"
    extracted_labels = _extract_answer_labels(meta_text)
    correct_labels: set[str] = set(extracted_labels)

    q_text = _strip_suggested_answer_ui(q_text_raw)
    q_text = _strip_inline_choices_from_text(q_text)

    choices: list[tuple[Optional[str], str, bool]] = []
    for idx, li in enumerate(choice_els, start=1):
        t = li.get_text(" ", strip=True)
        if not t:
            continue
        # label heuristic: leading "A." / "A)" / "A "
        label = None
        mm = re.match(r"^\s*([A-Z])[\.\)\:]\s*(.+)$", t)
        if mm:
            label = mm.group(1).upper()
            t = mm.group(2).strip()
        else:
            # sometimes label is in separate span
            lab_el = li.select_one(".choice-letter") or li.select_one(".letter")
            lab = _text_or_none(lab_el)
            if lab and re.match(r"^[A-Z]$", lab.strip().upper()):
                label = lab.strip().upper()

        is_correct = bool(label and label in correct_labels)
        choices.append((label, t, is_correct))

    if not choices:
        # keep app usable even if selectors miss
        choices = [(None, "N/A (could not parse choices)", False)]

    return ParsedQuestion(
        text=q_text,
        choices=choices,
        explanation=explanation,
        raw_html=html,
        q_index=1,
    )


def fetch_and_parse_discussion(url: str, fetch: FetchConfig) -> tuple[str, ParsedQuestion]:
    resp = polite_get(url, fetch)
    html = resp.text
    return url, parse_discussion_page(html)

