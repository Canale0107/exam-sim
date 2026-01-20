from __future__ import annotations

import json
import os
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


def _agent_log(message: str, data: dict, hypothesis_id: str):
    try:
        Path("/Users/canale/Projects/exam-sim/.cursor").mkdir(parents=True, exist_ok=True)
        payload = {
            "sessionId": "debug-session",
            "runId": "scrape-fix",
            "hypothesisId": hypothesis_id,
            "location": "examtopics_helper/scrape.py",
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        with open("/Users/canale/Projects/exam-sim/.cursor/debug.log", "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass


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
    explanation = _text_or_none(explanation_el)

    # attempt to detect official answer labels (Suggested Answer preferred)
    meta_text = f"{q_text_raw} {explanation or ''}"
    extracted_labels = _extract_answer_labels(meta_text)
    correct_labels: set[str] = set(extracted_labels)

    q_text = _strip_suggested_answer_ui(q_text_raw)
    q_text = _strip_inline_choices_from_text(q_text)
    # #region agent log
    _agent_log(
        "parse_discussion_page extracted",
        {
            "q_text_raw_tail": (q_text_raw[-140:] if q_text_raw else None),
            "q_text_clean_tail": (q_text[-140:] if q_text else None),
            "extracted_labels": extracted_labels,
            "has_explanation": bool(explanation),
        },
        "H2",
    )
    # #endregion agent log

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

