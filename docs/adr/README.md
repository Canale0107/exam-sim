# Architecture Decision Records (ADR)

このディレクトリには、本プロジェクトの **設計判断（アーキテクチャ意思決定）** を ADR として記録します。

## ルール

- 1つの判断につき 1つのADR（`0001-...md` のように連番）
- **選択肢（代替案）** と **採用した判断** と **理由/トレードオフ** を必ず書く
- 概要（結論・次の作業）は `docs/backend.md` を正とする

## ADR一覧

- `0001-hosting-platform.md`: フロントエンド/バックエンドのデプロイ先（当時の判断を含む）
- `0002-progress-storage-model.md`: 進捗データの保存モデル（提案/検討中）
- `0003-platform-strategy-supabase-first.md`: Supabase優先（現在は置き換え済み）
- `0004-platform-strategy-aws-first.md`: AWS完結でMVPを作る（AWS-first）
- `0005-multi-trial-management.md`: 複数トライアル管理機能の設計
