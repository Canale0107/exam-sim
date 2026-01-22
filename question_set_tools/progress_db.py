from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_progress_db_path() -> str:
    # local-first default (future: server-side DB)
    return os.path.join(os.getcwd(), "progress.sqlite3")


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS attempt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  selected_choice_ids TEXT, -- JSON string (e.g. ["A"])
  is_correct INTEGER,       -- 1/0/NULL(unknown)
  flagged INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  answered_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, set_id, question_id)
);

CREATE TABLE IF NOT EXISTS app_state (
  user_id TEXT NOT NULL,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, k)
);
"""


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.commit()


def get_attempt(
    conn: sqlite3.Connection, user_id: str, set_id: str, question_id: str
) -> Optional[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM attempt WHERE user_id = ? AND set_id = ? AND question_id = ?",
        (user_id, set_id, question_id),
    ).fetchone()


def upsert_attempt(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    set_id: str,
    question_id: str,
    selected_choice_ids_json: str | None,
    is_correct: int | None,
    flagged: bool,
    note: str | None,
    answered_at: str | None,
) -> None:
    now = utc_now_iso()
    conn.execute(
        """
        INSERT INTO attempt(user_id, set_id, question_id, selected_choice_ids, is_correct, flagged, note, answered_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, set_id, question_id) DO UPDATE SET
          selected_choice_ids=excluded.selected_choice_ids,
          is_correct=excluded.is_correct,
          flagged=excluded.flagged,
          note=excluded.note,
          answered_at=excluded.answered_at,
          updated_at=excluded.updated_at
        """,
        (
            user_id,
            set_id,
            question_id,
            selected_choice_ids_json,
            is_correct,
            1 if flagged else 0,
            note,
            answered_at,
            now,
        ),
    )
    conn.commit()


def get_state(conn: sqlite3.Connection, user_id: str, key: str) -> Optional[str]:
    row = conn.execute(
        "SELECT v FROM app_state WHERE user_id = ? AND k = ?",
        (user_id, key),
    ).fetchone()
    return None if row is None else str(row["v"])


def set_state(conn: sqlite3.Connection, user_id: str, key: str, value: str) -> None:
    now = utc_now_iso()
    conn.execute(
        """
        INSERT INTO app_state(user_id, k, v, updated_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(user_id, k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at
        """,
        (user_id, key, value, now),
    )
    conn.commit()

