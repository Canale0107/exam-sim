from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_db_path() -> str:
    # local-first: keep DB in repo folder by default
    return os.path.join(os.getcwd(), "examtopics.sqlite3")


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS exam (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discussion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  scraped_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(exam_id) REFERENCES exam(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS question (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id INTEGER NOT NULL,
  q_index INTEGER NOT NULL DEFAULT 1,
  text TEXT NOT NULL,
  explanation TEXT,
  raw_html TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(discussion_id) REFERENCES discussion(id) ON DELETE CASCADE,
  UNIQUE(discussion_id, q_index)
);

CREATE TABLE IF NOT EXISTS choice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  label TEXT,
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(question_id) REFERENCES question(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL UNIQUE,
  selected_choice_id INTEGER,
  is_correct INTEGER,
  answered_at TEXT,
  FOREIGN KEY(question_id) REFERENCES question(id) ON DELETE CASCADE,
  FOREIGN KEY(selected_choice_id) REFERENCES choice(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
"""


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.commit()


def upsert_exam(conn: sqlite3.Connection, name: str) -> int:
    created_at = utc_now_iso()
    conn.execute(
        "INSERT INTO exam(name, created_at) VALUES(?, ?) ON CONFLICT(name) DO NOTHING",
        (name, created_at),
    )
    row = conn.execute("SELECT id FROM exam WHERE name = ?", (name,)).fetchone()
    assert row is not None
    conn.commit()
    return int(row["id"])


def insert_discussion_urls(conn: sqlite3.Connection, exam_id: int, urls: Iterable[str]) -> int:
    created_at = utc_now_iso()
    cur = conn.cursor()
    inserted = 0
    for url in urls:
        try:
            cur.execute(
                "INSERT INTO discussion(exam_id, url, created_at) VALUES(?, ?, ?)",
                (exam_id, url, created_at),
            )
            inserted += 1
        except sqlite3.IntegrityError:
            # already exists
            pass
    conn.commit()
    return inserted


def list_discussions(conn: sqlite3.Connection, exam_id: int) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM discussion WHERE exam_id = ? ORDER BY id ASC", (exam_id,)
        ).fetchall()
    )


def mark_discussion_scraped(conn: sqlite3.Connection, discussion_id: int, title: str | None) -> None:
    conn.execute(
        "UPDATE discussion SET title = COALESCE(?, title), scraped_at = ? WHERE id = ?",
        (title, utc_now_iso(), discussion_id),
    )
    conn.commit()


@dataclass(frozen=True)
class ParsedQuestion:
    text: str
    choices: list[tuple[Optional[str], str, bool]]  # (label, text, is_correct)
    explanation: Optional[str] = None
    raw_html: Optional[str] = None
    q_index: int = 1


def upsert_question_with_choices(conn: sqlite3.Connection, discussion_id: int, q: ParsedQuestion) -> int:
    created_at = utc_now_iso()
    conn.execute(
        """
        INSERT INTO question(discussion_id, q_index, text, explanation, raw_html, created_at)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(discussion_id, q_index) DO UPDATE SET
          text=excluded.text,
          explanation=excluded.explanation,
          raw_html=excluded.raw_html
        """,
        (discussion_id, q.q_index, q.text, q.explanation, q.raw_html, created_at),
    )
    row = conn.execute(
        "SELECT id FROM question WHERE discussion_id = ? AND q_index = ?",
        (discussion_id, q.q_index),
    ).fetchone()
    assert row is not None
    question_id = int(row["id"])

    # replace choices (simple + deterministic)
    conn.execute("DELETE FROM choice WHERE question_id = ?", (question_id,))
    for label, text, is_correct in q.choices:
        conn.execute(
            "INSERT INTO choice(question_id, label, text, is_correct) VALUES(?, ?, ?, ?)",
            (question_id, label, text, 1 if is_correct else 0),
        )
    conn.commit()
    return question_id


def list_questions(conn: sqlite3.Connection, exam_id: int) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            """
            SELECT q.*, d.url AS discussion_url, d.title AS discussion_title
            FROM question q
            JOIN discussion d ON d.id = q.discussion_id
            WHERE d.exam_id = ?
            ORDER BY q.id ASC
            """,
            (exam_id,),
        ).fetchall()
    )


def get_choices(conn: sqlite3.Connection, question_id: int) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM choice WHERE question_id = ? ORDER BY id ASC",
            (question_id,),
        ).fetchall()
    )


def get_attempt(conn: sqlite3.Connection, question_id: int) -> Optional[sqlite3.Row]:
    return conn.execute("SELECT * FROM attempt WHERE question_id = ?", (question_id,)).fetchone()


def set_attempt(conn: sqlite3.Connection, question_id: int, selected_choice_id: int | None) -> None:
    # compute correctness (if we know the choice)
    is_correct: int | None = None
    if selected_choice_id is not None:
        row = conn.execute(
            "SELECT is_correct FROM choice WHERE id = ? AND question_id = ?",
            (selected_choice_id, question_id),
        ).fetchone()
        if row is not None:
            is_correct = int(row["is_correct"])

    conn.execute(
        """
        INSERT INTO attempt(question_id, selected_choice_id, is_correct, answered_at)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(question_id) DO UPDATE SET
          selected_choice_id=excluded.selected_choice_id,
          is_correct=excluded.is_correct,
          answered_at=excluded.answered_at
        """,
        (question_id, selected_choice_id, is_correct, utc_now_iso()),
    )
    conn.commit()


def get_state(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT v FROM app_state WHERE k = ?", (key,)).fetchone()
    return None if row is None else str(row["v"])


def set_state(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO app_state(k, v) VALUES(?, ?)
        ON CONFLICT(k) DO UPDATE SET v=excluded.v
        """,
        (key, value),
    )
    conn.commit()

