# ADR 0005: Multi-Trial Management（複数トライアル管理）

- Status: Proposed
- Date: 2026-01-25

## Context

現在の進捗管理は「1問題集 = 1つの進捗状態」であり、回答は常に上書きされる。
試験対策アプリとして、同じ問題集を **複数回** 解いて成績を比較したいニーズがある。

### 現状の課題

- 問題集を最初からやり直すと、過去の回答履歴が消える
- 「前回より正答率が上がったか」を確認できない
- 複数回チャレンジの記録が残らない

## Decision

**Trial Snapshots 方式**を採用する。

### 設計方針

1. **1問題集につき同時進行は1トライアルのみ**
   - アクティブなトライアルは常に1つ
   - 複数の「進行中」トライアルは持たない（状態管理をシンプルに）

2. **トライアル完了後はロック**
   - 完了したトライアルは編集不可（immutable）
   - 閲覧と削除のみ可能

3. **新規トライアルは自由に追加可能**
   - 前のトライアルが完了していれば、いつでも新規開始可能
   - 進行中のトライアルがある場合は、完了 or 破棄してから新規開始

---

## Data Model

### Trial（新規）

```typescript
type Trial = {
  trialId: string;              // UUID or timestamp-based ID
  trialNumber: number;          // 1, 2, 3... (人間が読める連番)
  status: 'in_progress' | 'completed';
  startedAt: string;            // ISO timestamp
  completedAt: string | null;   // ISO timestamp (null if in_progress)
  state: ProgressState;         // 既存の ProgressState をそのまま利用
  summary: TrialSummary | null; // 完了時に計算
};

type TrialSummary = {
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unknownAnswers: number;       // 正解が未設定の問題
  accuracyRate: number;         // percentage (0-100)
  flaggedCount: number;
  durationSeconds: number | null;
};
```

### ProgressState（既存・変更なし）

```typescript
type ProgressState = {
  currentIndex: number;
  attemptsByQuestionId: Record<string, Attempt>;
  updatedAt: string;
};
```

---

## Storage Design

### Option A: 単一テーブル拡張（推奨）

既存の `progress` テーブルを拡張し、トライアル情報を追加。

```
DynamoDB Table: {app-name}-progress

// 現行の進捗アイテム（トライアル内の状態）
Item = {
  pk: "USER#{sub}",
  sk: "SET#{setId}#TRIAL#{trialId}",

  // Trial metadata
  trial_id: "2026-01-25T10:00:00Z",
  trial_number: 1,
  status: "in_progress" | "completed",
  started_at: "2026-01-25T10:00:00Z",
  completed_at: null | "2026-01-25T10:15:00Z",

  // Progress state (既存)
  state_json: "{...ProgressState...}",
  updated_at: "2026-01-25T10:05:00Z",

  // Summary (completed 時のみ)
  summary: {...TrialSummary...} | null
}

// アクティブトライアル参照（問題集ごとに1つ）
Item = {
  pk: "USER#{sub}",
  sk: "SET#{setId}#ACTIVE",

  active_trial_id: "2026-01-25T10:00:00Z" | null,
  trial_count: 3,
  updated_at: "2026-01-25T10:05:00Z"
}
```

**Pros**:
- テーブル追加不要
- 既存インフラへの影響が小さい
- LSI で `SET#{setId}#TRIAL#` prefix クエリ可能

**Cons**:
- sk が長くなる

### Option B: 別テーブル（将来の拡張性重視）

`progress_trials` テーブルを新設。

現時点では Option A を採用（MVPシンプル優先）。

---

## API Design

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/progress/trials?setId=X` | トライアル一覧取得 |
| POST | `/progress/trials` | 新規トライアル開始 |
| GET | `/progress/trials/{trialId}?setId=X` | 特定トライアル取得 |
| PUT | `/progress/trials/{trialId}` | トライアル更新（進行中のみ） |
| POST | `/progress/trials/{trialId}/complete` | トライアル完了 |
| DELETE | `/progress/trials/{trialId}?setId=X` | トライアル削除 |

### Request/Response Examples

#### GET `/progress/trials?setId=X`

```json
{
  "setId": "aws-sap",
  "activeTrialId": "2026-01-25T10:00:00Z",
  "trials": [
    {
      "trialId": "2026-01-20T09:00:00Z",
      "trialNumber": 1,
      "status": "completed",
      "startedAt": "2026-01-20T09:00:00Z",
      "completedAt": "2026-01-20T10:30:00Z",
      "summary": {
        "totalQuestions": 50,
        "answeredQuestions": 50,
        "correctAnswers": 35,
        "accuracyRate": 70.0
      }
    },
    {
      "trialId": "2026-01-25T10:00:00Z",
      "trialNumber": 2,
      "status": "in_progress",
      "startedAt": "2026-01-25T10:00:00Z",
      "completedAt": null,
      "summary": null
    }
  ]
}
```

#### POST `/progress/trials`

```json
// Request
{ "setId": "aws-sap" }

// Response
{
  "trialId": "2026-01-25T14:00:00Z",
  "trialNumber": 3,
  "status": "in_progress"
}
```

#### POST `/progress/trials/{trialId}/complete`

```json
// Request
{ "setId": "aws-sap" }

// Response
{
  "trialId": "2026-01-25T10:00:00Z",
  "status": "completed",
  "summary": {
    "totalQuestions": 50,
    "answeredQuestions": 48,
    "correctAnswers": 42,
    "accuracyRate": 87.5
  }
}
```

---

## Frontend Changes

### State Management

```typescript
// StudyApp.tsx に追加
const [currentTrialId, setCurrentTrialId] = useState<string | null>(null);
const [trialStatus, setTrialStatus] = useState<'in_progress' | 'completed'>('in_progress');

// 完了済みトライアルは読み取り専用
const isReadOnly = trialStatus === 'completed';
```

### UI Components

#### QuestionSetGrid

- トライアル数を表示（例: "3回チャレンジ済み"）
- 「続きから」ボタン（進行中トライアルがある場合）
- 「新規トライアル開始」ボタン

#### StudyApp

- 現在のトライアル番号を表示
- 完了済みの場合は「閲覧モード」バナー表示
- 回答変更を無効化（isReadOnly 時）

#### ResultsScreen

- 「トライアル完了」ボタン追加
- 過去トライアルとの比較表示（将来）

#### TrialHistory（新規コンポーネント）

- 過去トライアル一覧
- 各トライアルの概要（正答率、所要時間）
- 削除ボタン

---

## State Transitions

```
[問題集選択]
     │
     ▼
┌─────────────────────────────────────────────┐
│  アクティブトライアルあり？                    │
│                                             │
│  YES → 「続きから」 or 「新規開始」選択       │
│  NO  → 自動的に新規トライアル作成            │
└─────────────────────────────────────────────┘
     │
     ▼
[学習画面: in_progress]
     │
     ├── 回答 → state 更新 → PUT /progress/trials/{id}
     │
     └── 結果画面へ
            │
            ├── 「トライアル完了」
            │      │
            │      ▼
            │   POST /complete → status = completed
            │      │
            │      ▼
            │   [完了済み: 閲覧のみ可能]
            │
            └── 「学習を続ける」 → 学習画面に戻る
```

---

## Migration Strategy

### Phase 1: 既存進捗の移行

既存の `progress` データを Trial #1 として移行:

```python
# Lambda migration script
def migrate_existing_progress(user_id, set_id, existing_state):
    trial_id = existing_state.get('updatedAt', datetime.now().isoformat())

    # Create trial item
    table.put_item(Item={
        'pk': f'USER#{user_id}',
        'sk': f'SET#{set_id}#TRIAL#{trial_id}',
        'trial_id': trial_id,
        'trial_number': 1,
        'status': 'in_progress',  # or 'completed' if all answered
        'started_at': trial_id,
        'state_json': json.dumps(existing_state),
        ...
    })

    # Create active reference
    table.put_item(Item={
        'pk': f'USER#{user_id}',
        'sk': f'SET#{set_id}#ACTIVE',
        'active_trial_id': trial_id,
        'trial_count': 1,
        ...
    })
```

### Phase 2: 旧 API との互換性

移行期間中は旧 API（`GET /progress?setId=X`）も維持:
- 内部的にアクティブトライアルの state を返す
- 新 API への段階的移行を可能にする

---

## Consequences

### Pros

- 複数回の学習履歴を保持できる
- 成績の推移を確認可能
- シンプルな状態管理（同時進行は1つのみ）

### Cons

- ストレージ使用量が増加（トライアル数 × 問題数）
- 既存データの移行が必要
- API エンドポイントが増える

### Future Considerations

- トライアル間の比較機能
- 学習曲線の可視化
- 古いトライアルの自動アーカイブ/削除

---

## Implementation Priority

1. **Phase 1: Core Trial Management**
   - [ ] DynamoDB スキーマ変更
   - [ ] Trial CRUD API 実装
   - [ ] 既存データ移行スクリプト

2. **Phase 2: Frontend Integration**
   - [ ] StudyApp にトライアル状態追加
   - [ ] QuestionSetGrid にトライアル情報表示
   - [ ] 完了ボタンと閲覧モード

3. **Phase 3: Trial History**
   - [ ] トライアル一覧画面
   - [ ] 削除機能
   - [ ] 過去トライアルの閲覧

---

## Open Questions

1. **進行中トライアルの破棄**:
   - 新規開始時に破棄確認ダイアログを出すか、自動破棄するか？

2. **トライアル数の上限**:
   - 無制限か、一定数（例: 10回）で古いものを自動削除するか？

3. **オフライン対応**:
   - localStorage にもトライアル情報を保持するか？
   - 現状と同様のオフライン優先を維持するか？
