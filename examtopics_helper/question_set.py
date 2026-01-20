from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class Choice:
    id: str
    text: str


@dataclass(frozen=True)
class Question:
    id: str
    text: str
    choices: list[Choice]
    answer_choice_ids: Optional[list[str]] = None
    # Explicitly indicates whether the UI should allow multiple selections.
    # If omitted, the app may infer from answer_choice_ids length / "(Choose two.)" text.
    is_multi_select: Optional[bool] = None
    explanation: Optional[str] = None
    tags: Optional[list[str]] = None


@dataclass(frozen=True)
class QuestionSet:
    set_id: str
    title: str
    questions: list[Question]


class QuestionSetFormatError(ValueError):
    pass


def _require(d: dict[str, Any], k: str) -> Any:
    if k not in d:
        raise QuestionSetFormatError(f"missing required field: {k}")
    return d[k]


def _as_str(x: Any, *, field: str) -> str:
    if not isinstance(x, str) or not x.strip():
        raise QuestionSetFormatError(f"{field} must be a non-empty string")
    return x


def _as_optional_str(x: Any, *, field: str) -> Optional[str]:
    if x is None:
        return None
    if not isinstance(x, str):
        raise QuestionSetFormatError(f"{field} must be a string or null")
    s = x.strip()
    return s if s else None


def _as_optional_str_list(x: Any, *, field: str) -> Optional[list[str]]:
    if x is None:
        return None
    if not isinstance(x, list) or not all(isinstance(i, str) for i in x):
        raise QuestionSetFormatError(f"{field} must be a list of strings or null")
    out = [i.strip() for i in x if i.strip()]
    return out or None


def _as_optional_bool(x: Any, *, field: str) -> Optional[bool]:
    if x is None:
        return None
    if not isinstance(x, bool):
        raise QuestionSetFormatError(f"{field} must be a boolean or null")
    return x


def parse_question_set(obj: Any) -> QuestionSet:
    if not isinstance(obj, dict):
        raise QuestionSetFormatError("root must be an object")

    set_id = _as_str(_require(obj, "set_id"), field="set_id")
    title = _as_str(_require(obj, "title"), field="title")
    questions_raw = _require(obj, "questions")
    if not isinstance(questions_raw, list):
        raise QuestionSetFormatError("questions must be a list")

    seen_qids: set[str] = set()
    questions: list[Question] = []
    for i, q in enumerate(questions_raw, start=1):
        if not isinstance(q, dict):
            raise QuestionSetFormatError(f"questions[{i}] must be an object")

        qid = _as_str(_require(q, "id"), field=f"questions[{i}].id")
        if qid in seen_qids:
            raise QuestionSetFormatError(f"duplicate question id: {qid}")
        seen_qids.add(qid)

        qtext = _as_str(_require(q, "text"), field=f"questions[{i}].text")
        choices_raw = _require(q, "choices")
        if not isinstance(choices_raw, list) or not choices_raw:
            raise QuestionSetFormatError(f"questions[{i}].choices must be a non-empty list")

        seen_cids: set[str] = set()
        choices: list[Choice] = []
        for j, c in enumerate(choices_raw, start=1):
            if not isinstance(c, dict):
                raise QuestionSetFormatError(f"questions[{i}].choices[{j}] must be an object")
            cid = _as_str(_require(c, "id"), field=f"questions[{i}].choices[{j}].id")
            if cid in seen_cids:
                raise QuestionSetFormatError(f"duplicate choice id in question {qid}: {cid}")
            seen_cids.add(cid)
            ctext = _as_str(_require(c, "text"), field=f"questions[{i}].choices[{j}].text")
            choices.append(Choice(id=cid, text=ctext))

        answer_choice_ids = _as_optional_str_list(q.get("answer_choice_ids"), field=f"questions[{i}].answer_choice_ids")
        if answer_choice_ids:
            unknown = [cid for cid in answer_choice_ids if cid not in seen_cids]
            if unknown:
                raise QuestionSetFormatError(
                    f"questions[{i}].answer_choice_ids contains unknown choice ids: {unknown}"
                )

        is_multi_select = _as_optional_bool(q.get("is_multi_select"), field=f"questions[{i}].is_multi_select")

        explanation = _as_optional_str(q.get("explanation"), field=f"questions[{i}].explanation")
        tags = _as_optional_str_list(q.get("tags"), field=f"questions[{i}].tags")

        questions.append(
            Question(
                id=qid,
                text=qtext,
                choices=choices,
                answer_choice_ids=answer_choice_ids,
                is_multi_select=is_multi_select,
                explanation=explanation,
                tags=tags,
            )
        )

    return QuestionSet(set_id=set_id, title=title, questions=questions)


def load_question_set_json_bytes(data: bytes) -> QuestionSet:
    try:
        obj = json.loads(data.decode("utf-8"))
    except Exception as e:  # pragma: no cover
        raise QuestionSetFormatError(f"failed to parse JSON: {e}") from e
    return parse_question_set(obj)


def load_question_set_file(path: str) -> QuestionSet:
    with open(path, "rb") as f:
        return load_question_set_json_bytes(f.read())

