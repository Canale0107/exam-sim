from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
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
    q_text = _text_or_none(q_el) or _text_or_none(soup.select_one("h1")) or "Question"

    # choices candidates
    choice_els = (
        soup.select(".question-choices li")
        or soup.select("ul.choices li")
        or soup.select("li.multi-choice-item")
    )

    # attempt to detect "correct answer is X" style
    correct_labels: set[str] = set()
    correct_el = soup.select_one(".correct-answer") or soup.find(
        string=re.compile(r"Correct Answer", re.IGNORECASE)
    )
    correct_text = None
    if hasattr(correct_el, "get_text"):
        correct_text = correct_el.get_text(" ", strip=True)
    elif isinstance(correct_el, str):
        correct_text = correct_el.strip()
    if correct_text:
        # accept patterns like "Correct Answer: A" or "Correct Answer: A, C"
        m = re.search(r"Correct\s*Answer\s*:\s*([A-Z](?:\s*,\s*[A-Z])*)", correct_text, re.I)
        if m:
            labels = re.split(r"\s*,\s*", m.group(1).upper())
            correct_labels = {x.strip().upper() for x in labels if x.strip()}

    explanation_el = soup.select_one(".discussion-container") or soup.select_one(
        ".discussion"
    )
    explanation = _text_or_none(explanation_el)

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

