from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .http import FetchConfig
from .scrape import CollectUrlsConfig, collect_discussion_urls_from_list_pages, fetch_and_parse_discussion
from .scraper_export import export_question_set, normalize_question_dict, parsed_to_question_dict


def _cmd_collect_urls(args: argparse.Namespace) -> int:
    base = f"https://www.examtopics.com/discussions/{args.category.strip('/')}/"
    list_urls = [f"{base}{i}" for i in range(1, args.max_page + 1)]

    fetch = FetchConfig(
        user_agent=args.user_agent,
        timeout_s=args.timeout_s,
        min_delay_s=args.min_delay_s,
        max_delay_s=args.max_delay_s,
    )
    urls = collect_discussion_urls_from_list_pages(
        list_page_urls=list_urls,
        target_exam_keyword=args.keyword,
        fetch=fetch,
        cfg=CollectUrlsConfig(max_workers=args.max_workers),
    )

    if args.out:
        Path(args.out).write_text("\n".join(urls) + "\n", encoding="utf-8")
    else:
        for u in urls:
            print(u)
    return 0


def _read_urls(path: str) -> list[str]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"urls file not found: {path}")
    raw = p.read_text(encoding="utf-8")
    out: list[str] = []
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        out.append(s)
    return out


def _cmd_scrape(args: argparse.Namespace) -> int:
    try:
        urls = _read_urls(args.urls)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 2
    if not urls:
        print("no urls found", file=sys.stderr)
        return 2

    fetch = FetchConfig(
        user_agent=args.user_agent,
        timeout_s=args.timeout_s,
        min_delay_s=args.min_delay_s,
        max_delay_s=args.max_delay_s,
    )

    cache_path = Path(args.cache) if args.cache else None
    scraped_by_url: dict[str, dict] = {}
    if cache_path and cache_path.exists() and not args.no_resume:
        try:
            scraped_by_url = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            scraped_by_url = {}

    ok = 0
    fail = 0
    for url in urls:
        if (not args.overwrite) and (url in scraped_by_url):
            ok += 1
            continue
        try:
            _url, pq = fetch_and_parse_discussion(url, fetch)
            q = parsed_to_question_dict(url, pq)
            scraped_by_url[url] = q
            ok += 1
        except Exception as e:
            fail += 1
            print(f"failed: {url} ({type(e).__name__}: {e})", file=sys.stderr)

        if cache_path:
            cache_path.write_text(
                json.dumps(scraped_by_url, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    # Keep exported order stable: follow URL list order
    questions = [normalize_question_dict(scraped_by_url[u]) for u in urls if u in scraped_by_url]
    out_obj = export_question_set(args.set_id, questions)
    out_bytes = json.dumps(out_obj, ensure_ascii=False, indent=2).encode("utf-8")

    Path(args.out).write_bytes(out_bytes)

    print(f"done: ok={ok}, fail={fail}, questions={len(questions)} -> {args.out}", file=sys.stderr)
    return 0 if fail == 0 else 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="exam-sim", description="Local-only scraper/convert CLI (do not host publicly)."
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    p_collect = sub.add_parser("collect-urls", help="Collect discussion URLs from list pages.")
    p_collect.add_argument("--category", required=True, help="e.g. amazon/")
    p_collect.add_argument("--max-page", type=int, required=True, help="last page number (inclusive)")
    p_collect.add_argument("--keyword", default="", help="filter by anchor text keyword (e.g. SAP-C02)")
    p_collect.add_argument("--max-workers", type=int, default=10)
    p_collect.add_argument("--user-agent", default=FetchConfig().user_agent)
    p_collect.add_argument("--timeout-s", type=int, default=FetchConfig().timeout_s)
    p_collect.add_argument("--min-delay-s", type=float, default=FetchConfig().min_delay_s)
    p_collect.add_argument("--max-delay-s", type=float, default=FetchConfig().max_delay_s)
    p_collect.add_argument("--out", help="output path (txt). If omitted, prints to stdout.")
    p_collect.set_defaults(func=_cmd_collect_urls)

    p_scrape = sub.add_parser("scrape", help="Scrape discussions and export questions.json.")
    p_scrape.add_argument("--set-id", required=True, help="set_id for exported JSON")
    p_scrape.add_argument("--urls", required=True, help="path to urls.txt (one per line)")
    p_scrape.add_argument("--out", required=True, help="output JSON path (e.g. AWS-SAP-C02.questions.json)")
    p_scrape.add_argument(
        "--cache", help="optional cache JSON path to resume (maps url -> question dict)"
    )
    p_scrape.add_argument("--no-resume", action="store_true", help="ignore existing cache even if provided")
    p_scrape.add_argument("--overwrite", action="store_true", help="overwrite cached entries")
    p_scrape.add_argument("--user-agent", default=FetchConfig().user_agent)
    p_scrape.add_argument("--timeout-s", type=int, default=FetchConfig().timeout_s)
    p_scrape.add_argument("--min-delay-s", type=float, default=FetchConfig().min_delay_s)
    p_scrape.add_argument("--max-delay-s", type=float, default=FetchConfig().max_delay_s)
    p_scrape.set_defaults(func=_cmd_scrape)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

