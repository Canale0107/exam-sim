from __future__ import annotations

# NOTE:
# This app is intentionally separated from the study UI.
# It may store and handle scraped content locally for conversion/export purposes.
# Do NOT host this as a public web service that collects/stores/distributes copyrighted content.

import json
import os
import re
import sys
import time
from pathlib import Path

import streamlit as st

# #region agent log
def _agent_log(message: str, data: dict, hypothesis_id: str):
    try:
        Path("/Users/canale/Projects/exam-sim/.cursor").mkdir(parents=True, exist_ok=True)
        payload = {
            "sessionId": "debug-session",
            "runId": "pre-fix",
            "hypothesisId": hypothesis_id,
            "location": "apps/scraper_app.py:import",
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        with open("/Users/canale/Projects/exam-sim/.cursor/debug.log", "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass


_agent_log(
    "startup import context",
    {
        "cwd": os.getcwd(),
        "file": __file__,
        "sys_executable": sys.executable,
        "sys_version": sys.version,
        "sys_path_head": sys.path[:8],
    },
    "H1",
)

# Streamlit executes this script with `apps/` on sys.path, but not the repo root.
# Ensure the repo root is importable so `examtopics_helper` can be resolved.
_repo_root = str(Path(__file__).resolve().parents[1])
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)
    # #region agent log
    _agent_log(
        "injected repo root into sys.path",
        {"repo_root": _repo_root, "sys_path_head": sys.path[:8]},
        "H1",
    )
    # #endregion agent log
# #endregion agent log

try:
    from examtopics_helper.db import ParsedQuestion
    from examtopics_helper.http import FetchConfig
    from examtopics_helper.scrape import (
        collect_discussion_urls_from_list_pages,
        fetch_and_parse_discussion,
    )
    # #region agent log
    _agent_log(
        "import examtopics_helper ok",
        {
            "parsed_question_file": getattr(sys.modules.get("examtopics_helper.db"), "__file__", None),
            "sys_path_head": sys.path[:8],
        },
        "H1",
    )
    # #endregion agent log
except Exception as e:
    # #region agent log
    _agent_log(
        "import examtopics_helper failed",
        {
            "error_type": type(e).__name__,
            "error": str(e),
            "cwd": os.getcwd(),
            "file": __file__,
            "root_guess": str(Path(__file__).resolve().parents[1]),
            "root_exists": Path(__file__).resolve().parents[1].exists(),
            "sys_path_head": sys.path[:12],
        },
        "H1",
    )
    # #endregion agent log
    raise

st.set_page_config(page_title="scraper (local)", layout="wide")


def sidebar_config():
    st.sidebar.header("設定")
    set_id = st.sidebar.text_input("set_id（出力JSON）", value="AWS-SAP-C02").strip() or "set"

    st.sidebar.markdown("---")
    st.sidebar.subheader("URL収集（ディスカッション一覧）")
    category = st.sidebar.text_input("カテゴリ (例: amazon/)", value="amazon/")
    max_page = st.sidebar.number_input("最終ページ番号", min_value=1, value=575, step=1)
    keyword = st.sidebar.text_input("リンク検索キーワード（例: SAP-C02）", value="SAP-C02")

    st.sidebar.markdown("---")
    st.sidebar.subheader("アクセス設定（控えめ推奨）")
    ua = st.sidebar.text_input("User-Agent", value=FetchConfig().user_agent)
    min_delay = st.sidebar.slider("最小待機(s)", min_value=0.0, max_value=3.0, value=0.6, step=0.1)
    max_delay = st.sidebar.slider("最大待機(s)", min_value=0.0, max_value=5.0, value=1.6, step=0.1)

    return {
        "set_id": set_id,
        "category": category,
        "max_page": int(max_page),
        "keyword": keyword,
        "fetch_cfg": FetchConfig(user_agent=ua, min_delay_s=float(min_delay), max_delay_s=float(max_delay)),
    }


def _choice_id_for(label: str | None, idx0: int) -> str:
    if label and label.strip():
        return label.strip()
    # fallback: A, B, C...
    return chr(ord("A") + idx0)


def _question_id_from_url(url: str, q_index: int) -> str:
    # Typical: https://www.examtopics.com/discussions/<category>/<id>/
    import hashlib
    import re

    m = re.search(r"/discussions/[^/]+/(\d+)", url)
    if m:
        return f"et-{m.group(1)}-q{q_index}"
    return f"et-{hashlib.sha1(url.encode('utf-8')).hexdigest()[:10]}-q{q_index}"


def _parsed_to_question_dict(url: str, pq: ParsedQuestion) -> dict:
    choices = []
    answer_ids: list[str] = []
    for i, (label, text, is_correct) in enumerate(pq.choices):
        cid = _choice_id_for(label, i)
        choices.append({"id": cid, "text": text})
        if is_correct:
            answer_ids.append(cid)

    is_multi_select = bool(answer_ids and len(answer_ids) > 1) or bool(
        re.search(r"\(\s*Choose\s+(?:two|three|four|\d+)\s*\)", pq.text, flags=re.I)
    )

    return {
        "id": _question_id_from_url(url, pq.q_index),
        "text": pq.text,
        "choices": choices,
        "answer_choice_ids": answer_ids or None,
        "is_multi_select": is_multi_select,
        "explanation": pq.explanation,
        "tags": None,
    }

def _normalize_question_dict(q: dict) -> dict:
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
        # Explicit key for UI: multi if answer has multiple choices or text says "(Choose two.)" etc.
        out["is_multi_select"] = bool(out.get("answer_choice_ids") and len(out["answer_choice_ids"]) > 1) or bool(
            re.search(r"\(\s*Choose\s+(?:two|three|four|\d+)\s*\)", out.get("text", ""), flags=re.I)
        )

    # Explanation: keep only the highest-voted one if discussion dump is present
    expl = out.get("explanation")
    if isinstance(expl, str) and ("upvoted" in expl.lower()):
        s = expl.replace("\u00a0", " ").strip()
        vote_pat = re.compile(r"\bupvoted\s+(\d+)\s+times?\b", flags=re.I)
        matches = list(vote_pat.finditer(s))
        if matches:
            blocks: list[tuple[int, str]] = []
            start = 0
            for m in matches:
                block = s[start : m.start()].strip()
                block = re.sub(r"^\s*\.\.\.\s*", "", block)
                try:
                    votes = int(m.group(1))
                except Exception:
                    votes = 0
                if block:
                    blocks.append((votes, block))
                start = m.end()
            if blocks:
                votes, best = max(blocks, key=lambda x: x[0])
                best = best.replace(" ... ", "\n\n").replace("...", "\n\n")
                best = re.sub(r"\n{3,}", "\n\n", best)
                best = re.sub(r"[ \t]{2,}", " ", best).strip()

                author = None
                age = None
                selected = None
                body = best

                m_author = re.match(r"^([^\s]+)\s+(.*)$", best)
                rest = best
                if m_author:
                    author = m_author.group(1).strip()
                    rest = m_author.group(2).strip()
                rest = re.sub(r"\b(Highly\s+Voted|Most\s+Recent)\b", "", rest, flags=re.I).strip()

                m_age = re.search(r"(\d[\w\s,]*?\bago)\b", rest, flags=re.I)
                if m_age:
                    age = m_age.group(1).strip()
                m_sel = re.search(r"Selected\s+Answer\s*:\s*([A-Z]{1,6})", rest, flags=re.I)
                if m_sel:
                    selected = m_sel.group(1).strip().upper()
                    body = rest[m_sel.end() :].strip()
                else:
                    m_corr = re.search(r"\bCorrect\s+([A-Z]{1,6})\b", rest, flags=re.I)
                    if m_corr:
                        selected = m_corr.group(1).strip().upper()
                        body = rest[m_corr.end() :].strip()
                    else:
                        body = rest.strip()
                if age:
                    body = re.sub(rf"^\s*{re.escape(age)}\s*", "", body).strip()
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
                out["explanation"] = "\n".join(lines).strip()
    return out


cfg = sidebar_config()

if "discussion_urls" not in st.session_state:
    st.session_state.discussion_urls = []
if "scraped_by_url" not in st.session_state:
    st.session_state.scraped_by_url = {}

st.title("scraper (local)")
st.caption("ローカル用途の補助ツール。公開Web運用で問題本文を収集・配信する用途には使わないでください。")

tabs = st.tabs(["① URL収集", "② スクレイプ"])

with tabs[0]:
    st.subheader("① URL収集（ディスカッション一覧ページ → URLリストを生成）")
    base = f"https://www.examtopics.com/discussions/{cfg['category'].strip('/')}/"
    list_urls = [f"{base}{i}" for i in range(1, cfg["max_page"] + 1)]
    st.write("対象URL例:", list_urls[0] if list_urls else "")

    merge = st.checkbox("既存のURLリストに追加（merge）", value=True)
    if st.button("URLを収集してリストに反映", type="primary"):
        with st.spinner("収集中..."):
            urls = collect_discussion_urls_from_list_pages(
                list_page_urls=list_urls,
                target_exam_keyword=cfg["keyword"],
                fetch=cfg["fetch_cfg"],
            )
        if merge:
            merged = list(st.session_state.discussion_urls)
            seen = set(merged)
            for u in urls:
                if u not in seen:
                    seen.add(u)
                    merged.append(u)
            st.session_state.discussion_urls = merged
        else:
            st.session_state.discussion_urls = urls
        st.success(f"収集: {len(urls)}件 / 現在のURLリスト: {len(st.session_state.discussion_urls)}件")

    st.info(f"URLリスト: {len(st.session_state.discussion_urls)}件")
    if st.session_state.discussion_urls:
        st.dataframe(
            [{"url": u, "scraped": (u in st.session_state.scraped_by_url)} for u in st.session_state.discussion_urls],
            use_container_width=True,
        )
        if st.button("URLリストをクリア", type="secondary"):
            st.session_state.discussion_urls = []
            st.session_state.scraped_by_url = {}
            st.rerun()

with tabs[1]:
    st.subheader("② スクレイプ（ディスカッションURL → questions.json を作る）")

    urls: list[str] = list(st.session_state.discussion_urls)
    if not urls:
        st.warning("先に「① URL収集」でURLを取得してください。")
        st.stop()

    st.caption("ヒント: パーサ更新後に古い結果が残っている場合は「上書き」か「スクレイプ結果をクリア」を使ってください。")

    scraped_set = set(st.session_state.scraped_by_url.keys())
    scraped_count = sum(1 for u in urls if u in scraped_set)
    remaining_count = len(urls) - scraped_count

    mode = st.radio(
        "対象URLの選び方",
        options=[
            "未スクレイプのみ（おすすめ）",
            "全URL（既存は上書きしない）",
            "全URL（既存も上書き）",
        ],
        index=0,
        horizontal=True,
    )

    if mode == "未スクレイプのみ（おすすめ）":
        target_urls = [u for u in urls if u not in scraped_set]
        overwrite = True  # doesn't matter; none exist
    elif mode == "全URL（既存は上書きしない）":
        target_urls = list(urls)
        overwrite = False
    else:
        target_urls = list(urls)
        overwrite = True

    st.write(f"全URL: {len(urls)}件 / 済: {scraped_count}件 / 未: {remaining_count}件 / 今回対象: {len(target_urls)}件")

    if st.button("スクレイプ開始", type="primary", disabled=(len(target_urls) == 0)):
        prog = st.progress(0)
        ok = 0
        fail = 0
        for i, url in enumerate(target_urls, start=1):
            try:
                if (not overwrite) and (url in st.session_state.scraped_by_url):
                    ok += 1
                    prog.progress(i / max(1, len(target_urls)))
                    continue
                _url, pq = fetch_and_parse_discussion(url, cfg["fetch_cfg"])
                q = _parsed_to_question_dict(url, pq)
                st.session_state.scraped_by_url[url] = q
                ok += 1
            except Exception as e:
                fail += 1
                st.warning(f"失敗: {url} ({e})")
            prog.progress(i / max(1, len(target_urls)))
        st.success(f"完了: OK={ok}, FAIL={fail}")

    # Keep exported order stable: follow URL list order
    questions = [
        _normalize_question_dict(st.session_state.scraped_by_url[u])
        for u in urls
        if u in st.session_state.scraped_by_url
    ]
    st.info(f"スクレイプ済み: {len(questions)}問")

    if questions:
        export_obj = {
            "set_id": cfg["set_id"],
            "questions": questions,
        }
        export_bytes = json.dumps(export_obj, ensure_ascii=False, indent=2).encode("utf-8")
        st.download_button(
            "questions.json をダウンロード",
            data=export_bytes,
            file_name=f"{cfg['set_id']}.questions.json",
            mime="application/json",
            type="primary",
        )

        st.dataframe(
            [
                {
                    "url": u,
                    "question_id": st.session_state.scraped_by_url[u]["id"],
                    "has_answer": bool(st.session_state.scraped_by_url[u].get("answer_choice_ids")),
                }
                for u in urls
                if u in st.session_state.scraped_by_url
            ],
            use_container_width=True,
        )

        if st.button("スクレイプ結果をクリア", type="secondary"):
            st.session_state.scraped_by_url = {}
            st.rerun()

