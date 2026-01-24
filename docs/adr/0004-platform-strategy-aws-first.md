# ADR 0004: build MVP on AWS (AWS-first)

- Status: Accepted
- Date: 2026-01-24

## Context

exam-sim の公開アプリ化に向けて、バックエンド基盤を以下で比較していた。

- Vercel + Supabase（Auth/DB/Storageが一体でMVP速度が高い）
- AWS完結（キャリア上の学習価値が高く、運用/基盤をAWSに寄せられる）

ユーザー要件は「ユーザー認証」「ユーザー単位の問題セット保存（private）」「ユーザー単位の進捗同期」。

既に CloudFront / ACM / S3 および Cognito / API Gateway / Lambda / DynamoDB を使ったサーバレスCRUDの経験があり、
今回の優先順位は「AWSで完結させた構成で実運用に近い経験を積む」へ寄せる。

## Decision

バックエンドは **AWS完結（AWS-first）** でMVPを構築する。

## Proposed architecture (MVP)

- Frontend: Next.js（まずは **AWS Amplify Hosting** を第一候補）
- Auth: **Amazon Cognito User Pool**（Email+Password、確認メール、リセット）
- API: **API Gateway + Lambda**
- Progress sync (MVP): **DynamoDB** に `ProgressState` をスナップショット保存
  - PK: `USER#<sub>` / SK: `SET#<setId>` / `state` / `updatedAt`
- Question sets: **S3 private** + 署名付きURL
- Observability / ops: CloudWatch Logs、IAM最小権限、タグ、Budget

## Consequences

### Positive

- AWSで一気通貫（Auth/API/DB/Storage/運用）を経験でき、キャリア上の学習効果が高い
- 既存経験の延長（Cognito + APIGW/Lambda + DynamoDB + S3/CloudFront）で実装できる

### Negative / Trade-offs

- Supabaseに比べてMVPの立ち上げ・運用設計が重くなる（サービス数/設定が増える）
- Next.jsのホスティング方式（Amplify/CloudFront+S3/SSRの扱い）で難易度が変わる

## Supersedes

- `0003-platform-strategy-supabase-first.md`

