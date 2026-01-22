from __future__ import annotations

import hashlib
import re
from typing import Any

from .db import ParsedQuestion


def choice_id_for(label: str | None, idx0: int) -> str:
    if label and label.strip():
        return label.strip()
    # fallback: A, B, C...
    return chr(ord("A") + idx0)


def question_id_from_url(url: str, q_index: int) -> str:
    # Typical: https://www.examtopics.com/discussions/<category>/<id>/
    m = re.search(r"/discussions/[^/]+/(\d+)", url)
    if m:
        return f"et-{m.group(1)}-q{q_index}"
    return f"et-{hashlib.sha1(url.encode('utf-8')).hexdigest()[:10]}-q{q_index}"


def parsed_to_question_dict(url: str, pq: ParsedQuestion) -> dict[str, Any]:
    choices: list[dict[str, Any]] = []
    answer_ids: list[str] = []
    for i, (label, text, is_correct) in enumerate(pq.choices):
        cid = choice_id_for(label, i)
        choices.append({"id": cid, "text": text})
        if is_correct:
            answer_ids.append(cid)

    # Heuristic: multi if multiple answers or question text contains "(Choose two.)" etc.
    is_multi_select = bool(answer_ids and len(answer_ids) > 1) or bool(
        re.search(r"\(\s*Choose\s+(?:two|three|four|\d+)\s*\)", pq.text, flags=re.I)
    )

    return {
        "id": question_id_from_url(url, pq.q_index),
        "text": pq.text,
        "choices": choices,
        "answer_choice_ids": answer_ids or None,
        "is_multi_select": is_multi_select,
        "explanation": pq.explanation,
        "tags": None,
    }


def normalize_question_dict(q: dict[str, Any]) -> dict[str, Any]:
    """
    Defensive normalization for already-scraped/cached data:
    - Strip "Show Suggested Answer ..." tail from question text
    - If answer_choice_ids is missing, infer from "Suggested Answer: AC" in the text
    """
    text = str(q.get("text") or "")

    # Extract suggested/correct answers from the (possibly dirty) text
    m = re.search(r"Suggested\s*Answer\s*:\s*([A-Z][A-Z\s,]*)", text, flags=re.I)
    if not m:
        m = re.search(r"Correct\s*Answer\s*:\s*([A-Z][A-Z\s,]*)", text, flags=re.I)
    labels: list[str] = []
    if m:
        raw = m.group(1).upper()
        letters = re.findall(r"[A-Z]", raw)
        seen: set[str] = set()
        for ch in letters:
            if ch in seen:
                continue
            seen.add(ch)
            labels.append(ch)

    # Strip UI tail
    text_clean = re.sub(r"\s*(Show\s*Suggested\s*Answer|Hide\s*Answer)\b.*$", "", text, flags=re.I).strip()
    if text_clean == text:
        text_clean = re.sub(r"\s*Suggested\s*Answer\s*:.*$", "", text, flags=re.I).strip()
    # Strip inline choices if they were captured into the question text
    if re.search(r"\sA[\.\)]\s", text_clean) and re.search(r"\sB[\.\)]\s", text_clean):
        m2 = re.search(r"\sA[\.\)]\s", text_clean)
        if m2:
            text_clean = text_clean[: m2.start()].strip()

    out = dict(q)
    out["text"] = text_clean

    # Only fill if not already present
    if out.get("answer_choice_ids") is None and labels:
        out["answer_choice_ids"] = labels
    if out.get("is_multi_select") is None:
        out["is_multi_select"] = bool(out.get("answer_choice_ids") and len(out["answer_choice_ids"]) > 1) or bool(
            re.search(r"\(\s*Choose\s+(?:two|three|four|\d+)\s*\)", out.get("text", ""), flags=re.I)
        )
    return out


def export_question_set(set_id: str, questions: list[dict[str, Any]]) -> dict[str, Any]:
    return {"set_id": set_id, "questions": questions}

