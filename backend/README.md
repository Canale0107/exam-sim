# backend

この `backend/` は、公開アプリ化（ユーザー認証 + ユーザー単位の問題セット/進捗同期）に向けた **バックエンド方針** をまとめます。

## 設計判断（ADR）

設計判断は `backend/adr/` に **ADR（Architecture Decision Record）** として記録します。

- ADR一覧: `backend/adr/README.md`

---

## 目標 / 非目標

### 目標（公開アプリで必要なこと）

- ユーザー認証（ログイン/ログアウト、将来のアカウント削除）
- ユーザーごとの **問題セット（複数JSON）** のアップロード/一覧/削除
- ユーザーごとの **進捗（回答・正誤・見直しフラグ・メモ等）** の永続化と端末間同期

### 非目標（意図的に作らない）

- 問題セットの公開共有・検索・ランキングなど **配布に近い機能**
- 運営側が問題本文を収集/配信する仕組み（ユーザーが自分のデータを自分のアカウントに保存するのみ）

---

## デプロイ先の検討（フロントエンド / バックエンド）

### 決定事項

- フロントエンド: **Vercel**
- バックエンド（Auth/DB/Storage）: **Supabase**

選択肢（代替案）と判断理由は ADR に記録しています。

- `backend/adr/0001-hosting-platform.md`

---

## アーキテクチャ（たたき台）

### コンポーネント

- **Next.js (Vercel)**
  - UI（既存）
  - Route Handlers（`/api/**`）: 認証済みユーザーとして Supabase にアクセスし、JSON検証や署名付きURL発行などを実施
- **Supabase**
  - Auth: ユーザー管理
  - Postgres: 問題セットメタデータ、進捗、履歴
  - Storage: 問題セットJSON（private bucket）

### “配信基盤”化しないためのガードレール（実装上の制約）

- Storage bucket は **private**（公開 URL を発行しない）
- 問題セットの一覧 API は **自分の所有物のみ**
- 共有リンク/公開/検索は作らない
- エクスポート/削除を用意（ユーザーがコントロールできる）

---

## データモデル（案 / たたき台）

最初の設計は「MVPで必要なこと」と「後で破綻しないこと」の両立を優先します。

### 現フロントの進捗モデル（参考）

`frontend/src/lib/progress.ts` の現状:

- `ProgressState`
  - `currentIndex: number`
  - `attemptsByQuestionId: Record<string, Attempt>`（= 各問題の “最新状態”）
  - `updatedAt: string`（ISO）
- `Attempt`
  - `selectedChoiceIds: string[] | null`
  - `isCorrect: boolean | null`
  - `flagged: boolean`
  - `note: string | null`
  - `answeredAt: string | null`（ISO）

### 1) 問題セット（JSON本体 + メタデータ）

- JSON本体: Supabase Storage
- メタデータ: Postgres `question_sets` テーブル

`question_sets`（案）

- `id` (uuid, pk)
- `user_id` (uuid, fk -> auth.users)
- `set_id` (text) - JSON の `set_id`（UI側キーとしても利用）
- `title` (text) - 表示名（無ければ `set_id`）
- `question_count` (int)
- `sha256` (text) - JSON 本体のハッシュ（重複検知/同一判定）
- `storage_path` (text) - `question-sets/{user_id}/{id}.json` など
- `created_at`, `updated_at`

ポイント:

- JSONは **そのまま全文をDBに入れない**（容量/コスト/取り回しの観点）
- UIは「一覧→選択→JSON取得（署名付きURL）」で読み込む

### 2) 進捗（最新状態）と履歴（イベント）

MVPは「最新状態」だけでも成立しますが、統計・復習・振り返りを作るなら履歴があると強いです。
そこで “イベント（attempts） + 最新状態（question_progress）” の二層を推奨します。

進捗保存モデルの「選択肢（JSONBスナップショット vs 正規化）」は ADR に分離しています。

- `backend/adr/0002-progress-storage-model.md`

`attempts`（案：履歴）

- `id` (uuid, pk)
- `user_id` (uuid)
- `question_set_id` (uuid) - `question_sets.id`
- `question_id` (text) - JSONの `questions[].id`
- `selected_choice_ids` (jsonb) - 将来の複数選択も考慮して配列
- `is_correct` (bool, nullable) - 正答不明なら null
- `flagged` (bool)
- `note` (text, nullable)
- `answered_at` (timestamptz)
- `client_id` (text, nullable) - 端末識別（同期/衝突解決に使う場合）

`question_progress`（案：最新状態）

- `user_id` (uuid)
- `question_set_id` (uuid)
- `question_id` (text)
- `last_selected_choice_ids` (jsonb)
- `last_is_correct` (bool, nullable)
- `last_answered_at` (timestamptz)
- `correct_count` (int)
- `incorrect_count` (int)
- `flagged` (bool)
- `note` (text, nullable)
- `updated_at` (timestamptz)
- primary key: (`user_id`, `question_set_id`, `question_id`)

---

## API（BFF）設計（案）

Next.js Route Handlers（`/api/**`）として実装する想定です。

### 問題セット

- `GET /api/question-sets`
  - 自分の問題セット一覧（メタデータ）
- `POST /api/question-sets`
  - JSONアップロード
  - サーバー側で JSON schema 検証、`question_count` 等のメタ生成、ハッシュ計算
  - Storage に保存して `question_sets` を作成
- `GET /api/question-sets/:id/download`
  - private bucket の **署名付きURL** を返す（短寿命）
- `DELETE /api/question-sets/:id`
  - メタデータ削除 + Storage の実体削除

### 進捗

最小:

- `GET /api/progress?questionSetId=...`
  - `question_progress` を返す（必要なら差分/ページング）
- `PUT /api/progress`
  - `question_progress` の upsert（複数件まとめて送れる設計推奨）

履歴を取る場合:

- `POST /api/attempts`
  - 回答イベントを追加し、サーバー側で `question_progress` を更新（可能ならトランザクション）

---

## 同期戦略（ローカル `localStorage` → サーバー）

MVP移行で現実的な方針:

- **ログイン前**: 従来通り `localStorage` で進捗を持てる（オフライン/体験維持）
- **ログイン後**:
  - サーバーから `question_progress` を取得してローカルとマージ
  - クライアント側は “未同期イベント” をキュー（`attempts` を採用するなら特に有効）
  - サーバー優先 or 最新 `updated_at` 優先など、衝突解決ルールを固定する

（実装詳細は、実際に同期UIを作る段階で `frontend/` 側と合わせて詰める）

補足（現フロント実装との接続）:

- 進捗キーは `exam-sim:progress:${userId}:${setId}`（未ログインは `userId=local`）
- `ProgressState.updatedAt`（ISO）をサーバー側の `updated_at` と対応させる
- 進捗の保存モデル（JSONBスナップショット/正規化）は ADR を参照: `backend/adr/0002-progress-storage-model.md`

---

## セキュリティ設計（最低限のチェックリスト）

- **認証**: Supabase Auth のセッションを使い、BFF で検証
- **RLS**:
  - `question_sets.user_id = auth.uid()` のみ read/write
  - `attempts` / `question_progress` も同様
- **Storage policy**:
  - 自分の `storage_path` のみ read/write
  - public bucket にしない
- **アップロード制限**:
  - サイズ上限（例: 5–20MB など）を決める
  - JSON検証（想定スキーマ以外は弾く）

---

## 今後の決定事項（このREADMEで固めたい）

- Supabase へのアクセス方式（BFF経由にするか、クライアント直結にするか）
- 認証方式（Email / OAuth どれを MVP に入れるか）
- JSONアップロード上限・バリデーション仕様（スキーマv1を確定）
- 進捗の保存モデル（`question_progress` のみ / `attempts` も持つ）
