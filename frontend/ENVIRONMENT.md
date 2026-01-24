# Environment variables

ローカル開発では `frontend/.env.local` を作成して、Cognito と API Gateway の値を設定してください。

```
# Cognito (Hosted UI)
NEXT_PUBLIC_COGNITO_DOMAIN=exam-sim.auth.ap-northeast-1.amazoncognito.com
NEXT_PUBLIC_COGNITO_CLIENT_ID=...
NEXT_PUBLIC_COGNITO_REDIRECT_URI=http://localhost:3000/
NEXT_PUBLIC_COGNITO_LOGOUT_URI=http://localhost:3000/

# API Gateway base URL (Terraform output: http_api_base_url)
NEXT_PUBLIC_API_BASE_URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com
```

