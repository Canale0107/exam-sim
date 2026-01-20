from __future__ import annotations

# NOTE:
# This app is intentionally separated from the study UI.
# It may store and handle scraped content locally for conversion/export purposes.
# Do NOT host this as a public web service that collects/stores/distributes copyrighted content.

import streamlit as st

from examtopics_helper import db as dbmod
from examtopics_helper.db import ParsedQuestion
from examtopics_helper.http import FetchConfig
from examtopics_helper.scrape import (
    collect_discussion_urls_from_list_pages,
    fetch_and_parse_discussion,
)

st.set_page_config(page_title="scraper (local)", layout="wide")


def get_conn(db_path: str):
    conn = dbmod.connect(db_path)
    dbmod.init_db(conn)
    return conn


def sidebar_config():
    st.sidebar.header("設定")
    db_path = st.sidebar.text_input("DBパス", value=dbmod.default_db_path())
    exam_name = st.sidebar.text_input("試験名 (DBキー)", value="AWS-SAA-C03")

    st.sidebar.markdown("---")
    st.sidebar.subheader("URL収集（ディスカッション一覧）")
    category = st.sidebar.text_input("カテゴリ (例: amazon-aws/)", value="amazon-aws/")
    max_page = st.sidebar.number_input("最終ページ番号", min_value=1, value=3, step=1)
    keyword = st.sidebar.text_input("リンク検索キーワード", value=exam_name)

    st.sidebar.markdown("---")
    st.sidebar.subheader("アクセス設定（控えめ推奨）")
    ua = st.sidebar.text_input("User-Agent", value=FetchConfig().user_agent)
    min_delay = st.sidebar.slider("最小待機(s)", min_value=0.0, max_value=3.0, value=0.6, step=0.1)
    max_delay = st.sidebar.slider("最大待機(s)", min_value=0.0, max_value=5.0, value=1.6, step=0.1)

    return {
        "db_path": db_path,
        "exam_name": exam_name,
        "category": category,
        "max_page": int(max_page),
        "keyword": keyword,
        "fetch_cfg": FetchConfig(user_agent=ua, min_delay_s=float(min_delay), max_delay_s=float(max_delay)),
    }


def upsert_from_parsed(conn, discussion_id: int, pq: ParsedQuestion):
    return dbmod.upsert_question_with_choices(conn, discussion_id, pq)


cfg = sidebar_config()
conn = get_conn(cfg["db_path"])
exam_id = dbmod.upsert_exam(conn, cfg["exam_name"])

st.title("scraper (local)")
st.caption("ローカル用途の補助ツール。公開Web運用で問題本文を収集・配信する用途には使わないでください。")

tabs = st.tabs(["① URL収集", "② スクレイプ"])

with tabs[0]:
    st.subheader("① URL収集（ディスカッション一覧ページ → URLをDBへ）")
    base = f"https://www.examtopics.com/discussions/{cfg['category'].strip('/')}/"
    list_urls = [f"{base}{i}" for i in range(1, cfg["max_page"] + 1)]
    st.write("対象URL例:", list_urls[0] if list_urls else "")

    if st.button("URLを収集してDBに保存", type="primary"):
        with st.spinner("収集中..."):
            urls = collect_discussion_urls_from_list_pages(
                list_page_urls=list_urls,
                target_exam_keyword=cfg["keyword"],
                fetch=cfg["fetch_cfg"],
            )
        inserted = dbmod.insert_discussion_urls(conn, exam_id, urls)
        st.success(f"収集: {len(urls)}件 / 新規DB保存: {inserted}件")

    discussions = dbmod.list_discussions(conn, exam_id)
    st.info(f"DB内ディスカッションURL: {len(discussions)}件")
    if discussions:
        st.dataframe(
            [{"id": int(d["id"]), "url": d["url"], "title": d["title"], "scraped_at": d["scraped_at"]} for d in discussions],
            use_container_width=True,
        )

with tabs[1]:
    st.subheader("② スクレイプ（ディスカッションURL → 問題/選択肢/正答(可能なら)）")
    discussions = dbmod.list_discussions(conn, exam_id)
    if not discussions:
        st.warning("先に「① URL収集」でURLをDBへ保存してください。")
    else:
        only_unscraped = st.checkbox("未スクレイプのみ", value=True)
        target = [d for d in discussions if (not only_unscraped or not d["scraped_at"])]
        st.write(f"対象: {len(target)}件")

        if st.button("スクレイプ開始", type="primary", disabled=(len(target) == 0)):
            prog = st.progress(0)
            ok = 0
            fail = 0
            for i, d in enumerate(target, start=1):
                try:
                    url, pq = fetch_and_parse_discussion(d["url"], cfg["fetch_cfg"])
                    upsert_from_parsed(conn, int(d["id"]), pq)
                    # title best-effort
                    title = pq.text[:120]
                    dbmod.mark_discussion_scraped(conn, int(d["id"]), title=title)
                    ok += 1
                except Exception as e:
                    fail += 1
                    st.warning(f"失敗: {d['url']} ({e})")
                prog.progress(i / max(1, len(target)))
            st.success(f"完了: OK={ok}, FAIL={fail}")

        qs = dbmod.list_questions(conn, exam_id)
        st.info(f"DB内の問題: {len(qs)}件")

