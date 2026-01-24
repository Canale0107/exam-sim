"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QuestionSet } from "@/lib/questionSet";
import { loadQuestionSetFromJsonText } from "@/lib/questionSet";
import { BookOpenIcon, UploadIcon } from "@/components/icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

interface QuestionSetSelectorProps {
  onSetSelected: (set: QuestionSet) => void;
}

export function QuestionSetSelector({ onSetSelected }: QuestionSetSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUserEmail(data.session?.user?.email ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = String(e.target?.result ?? "");
        const loaded = loadQuestionSetFromJsonText(text);
        onSetSelected(loaded);
        setError("");
      } catch (err) {
        setError(`ファイルの読み込みに失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`);
      }
    };
    reader.readAsText(file);
  };

  const handleLoadSample = async () => {
    try {
      const res = await fetch("/examples/questions.sample.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`failed to fetch sample: ${res.status}`);
      const text = await res.text();
      const loaded = loadQuestionSetFromJsonText(text);
      onSetSelected(loaded);
      setError("");
    } catch (err) {
      setError(`サンプルの読み込みに失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg p-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {!isSupabaseConfigured()
              ? "Supabase未設定（ゲスト）"
              : userEmail
                ? `ログイン中: ${userEmail}`
                : "ゲスト（未ログイン）"}
          </div>
          <Link href="/auth" className="text-xs text-muted-foreground hover:underline">
            アカウント
          </Link>
        </div>

        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <BookOpenIcon className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">模擬試験アプリ</h1>
          <p className="mt-2 text-sm text-muted-foreground">問題セットを読み込んで学習を開始しましょう</p>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="file-upload" className="text-base">
              JSONファイルをアップロード
            </Label>
            <div className="mt-2">
              <Input
                id="file-upload"
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full bg-transparent"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon className="mr-2 h-4 w-4" />
                ファイルを選択
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">または</span>
            </div>
          </div>

          <Button className="w-full" onClick={handleLoadSample}>
            <BookOpenIcon className="mr-2 h-4 w-4" />
            サンプル問題を読み込む
          </Button>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
        </div>
      </Card>
    </div>
  );
}

