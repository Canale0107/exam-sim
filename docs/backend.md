# backend (architecture)

公開アプリ化（ユーザー認証 + ユーザー単位の問題セット/進捗同期）に向けた **バックエンド方針** をまとめます。

設計判断は `docs/adr/` の ADR を正とします。

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

## デプロイ先（決定事項）

- フロントエンド: **AWS**（候補: Amplify Hosting）
- バックエンド（Auth/DB/Storage）: **AWS**

判断の経緯は ADR を参照:

- `docs/adr/0004-platform-strategy-aws-first.md`

---

## アーキテクチャ（MVPたたき台）

- **Next.js（AWS）**
  - 候補: Amplify Hosting
- **Amazon Cognito**
  - Auth（Email+Password）
- **API Gateway + Lambda**
  - BFF/API（進捗同期、問題セット管理）
- **DynamoDB**
  - 進捗（MVP: スナップショット保存）
- **S3（private）**
  - 問題セットJSON（署名付きURLで取得）

### “配信基盤”化しないためのガードレール

- S3 bucket は **private**（公開 URL を発行しない）
- 問題セットの一覧 API は **自分の所有物のみ**
- 共有リンク/公開/検索は作らない
- エクスポート/削除を用意（ユーザーがコントロールできる）

---

## データモデル（案 / たたき台）

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

### 1) 問題セット

- JSON本体: S3（private）
- メタデータ: DynamoDB（または将来RDS/Postgres）で管理

### 2) 進捗

進捗保存モデル（スナップショット/正規化）は ADR を参照:

- `docs/adr/0002-progress-storage-model.md`

---

## セキュリティ設計（最低限のチェックリスト）

- **認証**: Cognito の JWT を API Gateway/Lambda 側で検証
- **アクセス制御**: user sub をキーにして必ずユーザー単位でスコープ
- **S3**:
  - public bucket にしない
  - 署名付きURLは短寿命にする
- **アップロード制限**:
  - サイズ上限（例: 5–20MB など）を決める
  - JSON検証（想定スキーマ以外は弾く）

---

## 次にやること（MVP優先順）

1. Cognito（Email+Password）
2. API Gateway + Lambda（認証を通す `GET /me`）
3. DynamoDB（進捗スナップショット）
4. S3（問題セットJSON + 署名付きURL）
5. IaC（Terraform）で再現可能にする
