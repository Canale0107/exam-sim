# ADR 0002: progress storage model (jsonb snapshot vs normalized tables)

- Status: Proposed
- Date: 2026-01-23

## Context

現フロントエンドは進捗を `localStorage` に保存しており、データモデルは概ね以下。

- `ProgressState`
  - `currentIndex: number`
  - `attemptsByQuestionId: Record<string, Attempt>`
  - `updatedAt: string` (ISO)
- `Attempt`
  - `selectedChoiceIds: string[] | null`
  - `isCorrect: boolean | null`
  - `flagged: boolean`
  - `note: string | null`
  - `answeredAt: string | null`

公開アプリではユーザーごとの進捗同期が必要。MVP速度と、将来の統計/復習機能の拡張性のバランスを取る必要がある。

## Decision

TBD（未決定）

## Options

### Option A: JSONB snapshot（`ProgressState` を丸ごと保存）

例: `progress_states(user_id, question_set_id, state jsonb, updated_at)`

- Pros
  - フロントの既存モデルに合わせやすく、移行が最短
  - スキーマ変更に強い（柔軟）
- Cons
  - 分析/集計クエリが弱い（後で正規化が必要になりやすい）
  - 部分更新や差分同期の設計が必要になる場合がある

### Option B: 正規化（`attempts` + `question_progress`）

例:

- `attempts`: 回答イベント（履歴）
- `question_progress`: 各問題の最新状態（集計済み）

- Pros
  - 統計/復習（弱点分析、間隔反復など）のクエリが作りやすい
  - イベントログが残る
- Cons
  - MVPの実装が重くなる（テーブル/トランザクション/集計の設計が必要）

## Consequences

Decision 確定後に追記する。
