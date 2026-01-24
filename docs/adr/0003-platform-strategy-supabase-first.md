# ADR 0003: build MVP on Supabase first (defer AWS implementation)

- Status: Superseded by ADR 0004
- Date: 2026-01-24

## Context

exam-sim を公開アプリ化するにあたり、バックエンド基盤として Supabase と AWS のどちらも候補になった。

- Supabase: Auth + Postgres + Storage + RLS が一体で、MVP速度が高い
- AWS: キャリア上の学習価値が高く、1社（AWS）に寄せられるが、サービス（Cognito/Lambda/S3/DB等）を組み合わせる必要がある

現時点の優先順位は「まず公開できる形（MVP）を作って学習UI/同期UXを固める」。

## Decision

まずは **Supabase をバックエンド基盤としてMVPを完成**させる。
AWS版の実装は、MVP後に「必要性（要件/コスト/運用/学習目的）」が明確になった段階で検討・移行する。

## Superseded by

- `0004-platform-strategy-aws-first.md`

## Consequences

### Positive

- Auth/DB/Storage の立ち上げが速く、端末間同期の価値を早期に検証できる
- Postgres + RLS により「ユーザー単位の分離」と「将来の集計」を同時に扱いやすい

### Negative / Trade-offs

- AWS（Cognito/Lambda/S3/DB等）の学習効果は一旦後回しになる
- 将来AWSへ寄せる場合、移行コストが発生する（ただしPostgres中心なら移行は比較的現実的）

