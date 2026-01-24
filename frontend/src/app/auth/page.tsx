"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthUser = {
  id: string;
  email: string | null;
};

export default function AuthPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const u = data.session?.user ?? null;
      setUser(u ? { id: u.id, email: u.email ?? null } : null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u ? { id: u.id, email: u.email ?? null } : null);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.length >= 6;
  }, [email, password]);

  async function signIn() {
    if (!supabase) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function signUp() {
    if (!supabase) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setMessage("サインアップしました。Email確認が有効な場合は受信箱を確認してください。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "サインアップに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ログアウトに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md p-8">
          <div className="mb-3 text-lg font-semibold">アカウント</div>
          <div className="rounded-md bg-warning/10 p-3 text-sm text-warning">
            Supabase 環境変数が未設定です。`frontend/ENVIRONMENT.md` を参照して `frontend/.env.local` を作成してください。
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
            ログインすると進捗をユーザー単位で同期できるようになります（実装中）。
          </p>
          <div className="mt-3 text-xs text-muted-foreground">
            {user ? `ログイン中: ${user.email ?? user.id}` : "現在: ゲスト"}
          </div>
        </div>

        {user ? (
          <div className="space-y-3">
            <Button className="w-full" onClick={signOut} disabled={loading}>
              ログアウト
            </Button>
            <Link href="/" className="block text-center text-sm text-muted-foreground hover:underline">
              ホームへ戻る
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6文字以上"
              />
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={signIn} disabled={loading || !canSubmit}>
                ログイン
              </Button>
              <Button variant="outline" className="flex-1 bg-transparent" onClick={signUp} disabled={loading || !canSubmit}>
                新規登録
              </Button>
            </div>

            {message && <div className="rounded-md bg-success/10 p-3 text-sm text-success">{message}</div>}
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

            <Link href="/" className="block text-center text-sm text-muted-foreground hover:underline">
              ホームへ戻る
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}

