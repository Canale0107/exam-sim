# ADR 0001: deploy frontend to Vercel and backend to Supabase

- Status: Accepted
- Date: 2026-01-23

## Context

公開アプリ化に向けて、以下を満たすホスティング/バックエンド基盤が必要。

- Next.js フロントエンドを安定してデプロイ/運用できる
- ユーザー認証
- ユーザーごとの問題セットJSONアップロード（プライベート保存）
- ユーザーごとの進捗同期（DB）
- “問題配信基盤”化しないガードレール（private storage / user isolation）

## Decision

- フロントエンド: **Vercel**
- バックエンド（Auth/DB/Storage）: **Supabase**

## Consequences

### Positive

- Next.js のデプロイが簡単（Preview/環境変数/ドメイン等）
- Auth/DB/Storage を一体で持て、RLS を前提に **ユーザー単位の分離** を実装しやすい
- private storage + policy で “配布” 寄りの機能を作りにくくできる

### Negative / Trade-offs

- Supabase の制約（機能/料金/リージョン）に依存する
- 将来、より自由度の高い構成へ移行する場合は移行コストが発生する

## Alternatives considered

### Frontend alternatives

- Cloudflare Pages
  - Pros: コスト面で強い
  - Cons: Node実行環境や Next.js 機能に制約が出る可能性がある（要調査事項が増える）

- AWS Amplify
  - Pros: AWS に寄せやすい
  - Cons: 設定/運用が相対的に重くなりがち（MVP速度が落ちる）

### Backend alternatives

- FastAPI + Postgres + S3（or S3互換）
  - Pros: 自由度が高い（API/DB/運用を細かく制御可能）
  - Cons: 運用対象が増える（認証、DB、ストレージ、デプロイの組み合わせ）

- Firebase Auth + Firestore + Storage
  - Pros: MVPが速い
  - Cons: 進捗や統計など、集計クエリが増えると設計制約が出やすい
