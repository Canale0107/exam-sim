from __future__ import annotations

import json
from typing import Optional

import streamlit as st

from examtopics_helper import progress_db
from examtopics_helper.question_set import QuestionSetFormatError, load_question_set_file, load_question_set_json_bytes


st.set_page_config(page_title="study (BYOS)", layout="wide")


def get_progress_conn(db_path: str):
    conn = progress_db.connect(db_path)
    progress_db.init_db(conn)
    return conn


def sidebar_config():
    st.sidebar.header("設定")
    user_id = st.sidebar.text_input("ユーザーID（ローカル用）", value="local")
    progress_db_path = st.sidebar.text_input("進捗DBパス", value=progress_db.default_progress_db_path())

    st.sidebar.markdown("---")
    st.sidebar.subheader("問題セット（JSON / BYOS）")
    json_path = st.sidebar.text_input("ローカルJSONパス（任意）", value="")
    uploaded = st.sidebar.file_uploader("またはJSONをアップロード", type=["json"])

    return {
        "user_id": user_id.strip() or "local",
        "progress_db_path": progress_db_path,
        "json_path": json_path.strip(),
        "uploaded": uploaded,
    }


def load_set(cfg) -> Optional[object]:
    # Prefer uploaded file
    if cfg["uploaded"] is not None:
        data = cfg["uploaded"].getvalue()
        return load_question_set_json_bytes(data)
    if cfg["json_path"]:
        return load_question_set_file(cfg["json_path"])
    return None


cfg = sidebar_config()
conn = get_progress_conn(cfg["progress_db_path"])

st.title("study (BYOS)")
st.caption("問題本文はアプリ側でホストせず、ユーザーが用意したJSONを読み込んで学習します。進捗のみ保存します。")

try:
    qset = load_set(cfg)
except QuestionSetFormatError as e:
    st.error(f"問題セットJSONの形式エラー: {e}")
    qset = None

if qset is None:
    st.info("サイドバーから問題セットJSONを指定してください。")
    st.stop()

set_id = qset.set_id
user_id = cfg["user_id"]

state_key = f"set:{set_id}:current_index"
saved = progress_db.get_state(conn, user_id, state_key)
if "q_index" not in st.session_state:
    st.session_state.q_index = int(saved) if (saved and saved.isdigit()) else 0
st.session_state.q_index = max(0, min(st.session_state.q_index, len(qset.questions) - 1))

# progress summary
answered = 0
correct = 0
unknown = 0
for q in qset.questions:
    a = progress_db.get_attempt(conn, user_id, set_id, q.id)
    if a and a["selected_choice_ids"] is not None:
        answered += 1
        if a["is_correct"] == 1:
            correct += 1
        elif a["is_correct"] == 0:
            pass
        else:
            unknown += 1

colA, colB, colC, colD = st.columns([2, 2, 2, 3])
colA.metric("進捗", f"{answered}/{len(qset.questions)}")
colB.metric("正解数", f"{correct}")
colC.metric("正誤不明", f"{unknown}")
colD.metric("正答率", f"{(correct/answered*100):.1f}%" if answered else "—")

st.divider()

q = qset.questions[st.session_state.q_index]
st.caption(f"{qset.title} / Q {st.session_state.q_index + 1} / {len(qset.questions)}  (id={q.id})")
st.write(q.text)

attempt = progress_db.get_attempt(conn, user_id, set_id, q.id)
selected_choice_ids: list[str] = []
flagged = False
note = ""
if attempt:
    flagged = bool(int(attempt["flagged"]))
    note = str(attempt["note"] or "")
    try:
        selected_choice_ids = json.loads(attempt["selected_choice_ids"]) if attempt["selected_choice_ids"] else []
    except Exception:
        selected_choice_ids = []

choice_labels = [f"{c.id} {c.text}".strip() for c in q.choices]
choice_ids = [c.id for c in q.choices]

default_idx = 0
if selected_choice_ids and selected_choice_ids[0] in choice_ids:
    default_idx = choice_ids.index(selected_choice_ids[0])

picked_label = st.radio("回答を選択（単一選択）", choice_labels, index=default_idx, key=f"radio_{set_id}_{q.id}")
picked_id = choice_ids[choice_labels.index(picked_label)] if choice_labels else None

meta_cols = st.columns([1, 1, 4])
flagged_new = meta_cols[0].checkbox("見直しフラグ", value=flagged, key=f"flag_{set_id}_{q.id}")
note_new = meta_cols[2].text_input("メモ（任意）", value=note, key=f"note_{set_id}_{q.id}")

btn_cols = st.columns([1, 1, 6])
if btn_cols[0].button("保存", type="primary"):
    is_correct: int | None = None
    if q.answer_choice_ids:
        is_correct = 1 if [picked_id] == q.answer_choice_ids else 0
    progress_db.upsert_attempt(
        conn,
        user_id=user_id,
        set_id=set_id,
        question_id=q.id,
        selected_choice_ids_json=json.dumps([picked_id]),
        is_correct=is_correct,
        flagged=bool(flagged_new),
        note=(note_new.strip() or None),
        answered_at=progress_db.utc_now_iso(),
    )
    st.rerun()

if btn_cols[1].button("未回答に戻す"):
    progress_db.upsert_attempt(
        conn,
        user_id=user_id,
        set_id=set_id,
        question_id=q.id,
        selected_choice_ids_json=None,
        is_correct=None,
        flagged=bool(flagged_new),
        note=(note_new.strip() or None),
        answered_at=None,
    )
    st.rerun()

attempt = progress_db.get_attempt(conn, user_id, set_id, q.id)
if attempt and attempt["selected_choice_ids"] is not None:
    if attempt["is_correct"] == 1:
        st.success("正解")
    elif attempt["is_correct"] == 0:
        st.error("不正解")
    else:
        st.info("正誤不明（この問題セットに正答が含まれていません）")

if q.answer_choice_ids:
    st.caption(f"正答: {', '.join(q.answer_choice_ids)}")

if q.explanation:
    with st.expander("解説（問題セットに含まれる場合）"):
        st.write(q.explanation)

nav = st.columns([1, 1, 1, 6])
if nav[0].button("← 前へ", disabled=(st.session_state.q_index == 0)):
    st.session_state.q_index -= 1
    progress_db.set_state(conn, user_id, state_key, str(st.session_state.q_index))
    st.rerun()
if nav[1].button("次へ →", disabled=(st.session_state.q_index >= len(qset.questions) - 1)):
    st.session_state.q_index += 1
    progress_db.set_state(conn, user_id, state_key, str(st.session_state.q_index))
    st.rerun()
if nav[2].button("未回答へ"):
    jump = None
    for i, qq in enumerate(qset.questions):
        a = progress_db.get_attempt(conn, user_id, set_id, qq.id)
        if not a or a["selected_choice_ids"] is None:
            jump = i
            break
    if jump is not None:
        st.session_state.q_index = jump
        progress_db.set_state(conn, user_id, state_key, str(st.session_state.q_index))
        st.rerun()
    else:
        st.info("未回答はありません")

