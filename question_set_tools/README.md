# question_set_tools

ExamTopics 等から取得して **問題セット JSON（`*.questions.json`）を生成するためのローカル専用ツール**です。

## 前提条件

- **用途**: ローカルでのスクレイピング/変換用途のみ（Webアプリ側とは分離）
- **注意**: 対象サイトの **利用規約/robots.txt** を確認し、過度なアクセスや公開運用はしないこと
- **必要ツール**:
  - Python **3.12+**
  - `uv`（依存解決/実行）
- **実行環境**:
  - インターネット接続（対象サイトへアクセスできること）
  - 取得量に応じたディスク容量（キャッシュ/出力）
- **作業ディレクトリ**:
  - `tmp/`（URLリストやキャッシュ置き場）
  - `output/`（生成した `*.questions.json` の出力先）
  - 例のコマンドをそのまま使う場合は、事前に `mkdir -p tmp output` を推奨

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
  --out tmp/urls.txt
```

スクレイプ（URLリスト → questions.json）:

```bash
uv run python -m question_set_tools.cli scrape \
  --set-id AWS-SAP-C02 \
  --urls tmp/urls.txt \
  --out output/AWS-SAP-C02.questions.json \
  --cache tmp/scrape-cache.json
```

