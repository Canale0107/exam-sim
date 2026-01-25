# infra (Terraform)

AWS-first のインフラを Terraform で構築します。

## 前提

- IAMユーザー（exam-sim用）を用意
- ローカルで AWS 認証が通る（推奨: SSO/AssumeRole）
- `terraform` が入っている

## 使い方（最短: Cognito + /me）

1. `infra/` に移動して init

```bash
cd infra
terraform init
```

1. 変数を設定（例）

```bash
export TF_VAR_project_name="exam-sim"
export TF_VAR_region="ap-northeast-1"
export TF_VAR_cognito_domain_prefix="exam-sim"
export TF_VAR_callback_urls='["http://localhost:3000/"]'
export TF_VAR_logout_urls='["http://localhost:3000/"]'
```

1. plan/apply

```bash
terraform plan
terraform apply
```

1. 出力された値で動作確認

- Cognito User Pool / App Client を使ってログイン（Hosted UI or SRP等）
- `GET /me` を Authorization: Bearer <id_token> で叩き、JWTが検証できることを確認（`http_api_me_url`）

AWS CLI での簡易テスト例:

```bash
# サインアップ（メール確認が必要な場合あり）
aws cognito-idp sign-up \
  --client-id "<cognito_user_pool_client_id>" \
  --username "you@example.com" \
  --password "<YourPassword123>" \
  --user-attributes Name=email,Value="you@example.com"

# （開発用）管理者権限で確認済みにする
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id "<cognito_user_pool_id>" \
  --username "you@example.com"

# ID token取得
ID_TOKEN="$(
  aws cognito-idp initiate-auth \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "<cognito_user_pool_client_id>" \
    --auth-parameters USERNAME="you@example.com",PASSWORD="<YourPassword123>" \
  | jq -r '.AuthenticationResult.IdToken'
)"

curl -sS -H "Authorization: Bearer ${ID_TOKEN}" "<http_api_me_url>" | jq
```

## 構築順（MVP）

1. Cognito（Email+Password）
2. API Gateway + Lambda（認証を通す `GET /me`）
3. DynamoDB（進捗スナップショット / `GET/PUT /progress`）
4. S3（問題セットJSON + 署名付きURL）

## 進捗APIの簡易テスト（`/progress`）

`setId` を固定して保存→取得:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"setId":"example-set","state":{"currentIndex":0,"attemptsByQuestionId":{},"updatedAt":"'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"}}' \
  "<http_api_progress_url>" | jq

curl -sS \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  "<http_api_progress_url>?setId=example-set" | jq
```

`setId` を削除（リセット）:

```bash
curl -sS -X DELETE \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  "<http_api_progress_url>?setId=example-set" | jq
```

## 問題セットAPIの簡易テスト（S3 + 署名付きURL）

1. 一覧を取得:

```bash
curl -sS \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  "<http_api_question_sets_list_url>" | jq
```

1. 署名付きアップロードURLを取得:

```bash
UPLOAD="$(
  curl -sS -X POST \
    -H "Authorization: Bearer ${ID_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"setId":"example-set"}' \
    "<http_api_question_sets_upload_url>"
)"
echo "$UPLOAD" | jq
PUT_URL="$(echo "$UPLOAD" | jq -r .uploadUrl)"
```

1. JSONをS3へアップロード（PUT）:

```bash
curl -sS -X PUT \
  -H "Content-Type: application/json" \
  --data-binary @../examples/sample.questions.json \
  "$PUT_URL"
```

1. 署名付きダウンロードURLを取得して確認:

```bash
DOWNLOAD="$(
  curl -sS \
    -H "Authorization: Bearer ${ID_TOKEN}" \
    "<http_api_question_sets_download_url>?setId=example-set"
)"
GET_URL="$(echo "$DOWNLOAD" | jq -r .downloadUrl)"
curl -sS "$GET_URL" | jq '.set_id'
```

1. 問題セットを削除（S3から削除）:

```bash
curl -sS -X DELETE \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  "<http_api_question_sets_list_url>?setId=example-set" | jq
```
