# exam-sim

このプロジェクトは “問題を配るサービス” ではなく、ユーザーが手元に持っている問題セットを使って学習するための **試験風UI＋進捗管理** ツールを目指します。

- **模試アプリ（学習UI・進捗管理）**: 問題セットJSONを読み込み、回答・正誤・履歴などの進捗だけを保存
- **（別アプリ）スクレイピング/変換ツール**: どこかのサイトからの取得・整形は将来的に別プロダクト/別ツールとして分離（運営リスク低減）

## 設計方針（README叩き台）

### 目的

資格試験の学習用に、本番試験に近い体験で問題演習できるUI（試験風UI）と、進捗・復習管理（正誤、履歴、弱点、復習キューなど）を提供する。

- **PCとモバイル**の両方で使える
- **自分だけでなく他の人も使える形（SaaS/公開Webアプリ）**も視野
- ただし、特定サイト由来の問題本文は権利/規約の観点でグレーになり得るため、運営が問題本文を **収集・保管・配信** する構造は避ける

### 前提と課題認識

- **課題1（運営リスク）**: 問題本文をサーバーに置くと「配信基盤」に見えやすく、運営リスクが上がる
- **課題2（端末間同期）**: Webだけで端末間同期を実現したい（毎回JSONアップロードはUXが悪い）

### 採用する結論：BYOS（Bring Your Own Storage）

問題本文は **ユーザーのストレージ** に置き、Webアプリはユーザー権限で参照する。

- **サーバーが持つのは進捗データのみ**
- 問題本文は **ユーザーの外部ストレージ**（例: Google Drive）に置く（BYOS）
- ログイン時に **自動で問題セットを取得＋進捗同期** を目指す

### セーフティ/ガードレール（意図的に“配信基盤”化しない）

- Webアプリは問題本文をホストしない（サーバー保存しない）
- 共有リンク配布・公開ライブラリ・全文検索など **配布に近い機能** は作らない
- ログ/解析基盤にも問題本文を残さない（収集しない）

### システム全体像（将来像）

- **公開Webアプリ（学習UI・進捗管理）**

- 試験風UI（選択、見直しフラグ、タイマー、ナビゲーションなど）
- 進捗・統計（正答率、分野別弱点、履歴）
- 復習（例: 間隔反復キュー）
- ログイン（ユーザー別に進捗同期）

- **ユーザーの外部ストレージ（例: Google Drive）**

- 問題セットファイル `questions.json` をユーザーが保存
- Webアプリは Drive API をユーザー権限で取得（サーバー保管しない）

- **（任意）ローカル変換ツール（スクレイピング/整形）**

- Webアプリとは分離（別プロダクト/別ツール）
- できるだけ汎用インポータ/クリッパとして設計（特定サイト名を前面に出しにくい形）

### Google Drive連携（なぜURLではなく fileId か）

- 共有リンクURLは設定変更・公開範囲・リンク形式揺れ・403/CORS等で壊れやすい
- Drive API の `fileId` 参照が安定

想定フロー:

1. ユーザーがDrive連携（OAuth）
2. ファイルピッカーで `questions.json` を選択
3. Webアプリは `fileId` を保存（本文は保存しない）
4. ログイン時に `fileId` でDriveから取得 → ローカルキャッシュ → 試験UI表示

### データの持ち方

- **サーバー（公開Webアプリ側）**: 認証、進捗・履歴、問題セット参照情報（例: provider/google_drive fileId など）
- **問題本文（問題文/選択肢/解説/正解）**: 原則サーバーに保持しない（BYOS）
- **クライアント（ブラウザ）**: 問題本文＋キャッシュ（IndexedDB等、将来）

## このリポジトリの「いま」（ローカルMVP）

現時点は “将来のBYOS Webアプリ” へ移行しやすいように、まずローカルで以下を分離しています。

- `web/`: **Webアプリ（Next.js）**（問題セットJSONを読み込み、進捗はブラウザに保存）
- `examtopics_helper/`: **スクレイピング/変換ツール（CLI / ローカル専用）**

## 問題セットJSON形式（v1）

模試アプリは、ユーザーが用意した `questions.json` を読み込みます。

最小構成:

```json
{
  "set_id": "example-set",
  "questions": [
    {
      "id": "q1",
      "text": "Question text...",
      "choices": [
        { "id": "A", "text": "Choice A" },
        { "id": "B", "text": "Choice B" }
      ],
      "answer_choice_ids": ["A"],
      "explanation": "Optional explanation",
      "tags": ["optional", "tags"]
    }
  ]
}
```

- `answer_choice_ids` が無い/`null` の場合、正誤は **不明** として扱います（学習UIは回せる）
- 現状のUIは **単一選択** を前提（将来、複数選択に拡張可能）

## セットアップ

```bash
uv venv .venv
source .venv/bin/activate
uv sync
```

依存関係の追加/更新は `pyproject.toml` を唯一の正として `uv` で行います。

```bash
uv add <package>
uv remove <package>
uv sync
```

## 起動

### Webアプリ（Next.js / BYOS / ローカル進捗）

`web/` 配下に Next.js 版の学習UI（MVP）があります。

- 問題セットJSONは **ブラウザで読み込み**（サーバーに保存しません）
- 進捗は **ブラウザの localStorage** に保存（キー: `set_id + userId`）

```bash
cd web
npm install
npm run dev
```

起動後、画面左の「サンプルを読み込む」またはJSONアップロードで学習を開始できます。

### スクレイピングツール（CLI / ローカル）

ローカル専用のCLIです（公開Web運用で問題本文を収集・配信する用途には使わないでください）。

URL収集（ディスカッション一覧ページ → URLリスト）:

```bash
uv run python -m examtopics_helper.cli collect-urls \
  --category amazon/ \
  --max-page 575 \
  --keyword SAP-C02 \
  --out urls.txt
```

スクレイプ（URLリスト → questions.json）:

```bash
uv run python -m examtopics_helper.cli scrape \
  --set-id AWS-SAP-C02 \
  --urls urls.txt \
  --out AWS-SAP-C02.questions.json \
  --cache scrape-cache.json
```

## 今後の実装ステップ（MVP優先順位）

1. Webアプリ（試験UI + 進捗同期）を先に完成
2. Google Drive連携（fileId取得→読込→キャッシュ）
3. 統計・復習（弱点分析、間隔反復）
4. （任意）問題セット変換ツール（別プロダクト/別ツールとして分離）
