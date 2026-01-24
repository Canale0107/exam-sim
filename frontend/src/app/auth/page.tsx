"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildLoginUrl, buildLogoutUrl, clearTokens, getCurrentUser, isCognitoConfigured } from "@/lib/awsAuth";

export default function AuthPage() {
  const user = getCurrentUser();
  const email = user?.email ?? null;

  if (!isCognitoConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md p-8">
          <div className="mb-3 text-lg font-semibold">アカウント</div>
          <div className="rounded-md bg-warning/10 p-3 text-sm text-warning">
            Cognito 環境変数が未設定です。`frontend/ENVIRONMENT.md` を参照して `frontend/.env.local` を作成してください。
          </div>
          <Link href="/" className="mt-4 block text-center text-sm text-muted-foreground hover:underline">
            ホームへ戻る
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">アカウント</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Cognito でログインします。ログイン後はJWTでAPIを呼び出します。
          </p>
          <div className="mt-3 text-xs text-muted-foreground">
            {email ? `ログイン中: ${email}` : "現在: ゲスト"}
          </div>
        </div>

        {email ? (
          <div className="space-y-3">
            <Button
              className="w-full"
              onClick={() => {
                clearTokens();
                window.location.href = buildLogoutUrl();
              }}
            >
              ログアウト
            </Button>
            <Link href="/" className="block text-center text-sm text-muted-foreground hover:underline">
              ホームへ戻る
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <Button
              className="w-full"
              onClick={() => {
                window.location.href = buildLoginUrl();
              }}
            >
              Cognitoでログイン
            </Button>

            <Link href="/" className="block text-center text-sm text-muted-foreground hover:underline">
              ホームへ戻る
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}

