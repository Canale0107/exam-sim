# question_set_tools

ExamTopics 等から取得して **問題セット JSON（`*.questions.json`）を生成するためのローカル専用ツール**です。

## Setup

```bash
cd question_set_tools
uv venv .venv
source .venv/bin/activate
uv sync
```

## Usage

URL収集（ディスカッション一覧ページ → URLリスト）:

```bash
uv run python -m question_set_tools.cli collect-urls \
  --category amazon/ \
  --max-page 575 \
  --keyword SAP-C02 \
  --out urls.txt
```

スクレイプ（URLリスト → questions.json）:

```bash
uv run python -m question_set_tools.cli scrape \
  --set-id AWS-SAP-C02 \
  --urls urls.txt \
  --out AWS-SAP-C02.questions.json \
  --cache scrape-cache.json
```

