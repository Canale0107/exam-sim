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
import { apiBaseUrl, authHeader, getCurrentUser, isCognitoConfigured } from "@/lib/awsAuth";

interface QuestionSetSelectorProps {
  onSetSelected: (set: QuestionSet) => void;
}

export function QuestionSetSelector({ onSetSelected }: QuestionSetSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [cloudSetId, setCloudSetId] = useState<string>("example-set");
  const [cloudStatus, setCloudStatus] = useState<string>("");
  const [selectedJsonText, setSelectedJsonText] = useState<string>("");

  useEffect(() => {
    // Avoid hydration mismatch by reading localStorage after hydration.
    queueMicrotask(() => setUserEmail(getCurrentUser()?.email ?? null));
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = String(e.target?.result ?? "");
        const loaded = loadQuestionSetFromJsonText(text);
        setSelectedJsonText(text);
        setCloudSetId(loaded.set_id);
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
      setSelectedJsonText(text);
      setCloudSetId(loaded.set_id);
      onSetSelected(loaded);
      setError("");
    } catch (err) {
      setError(`サンプルの読み込みに失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`);
    }
  };

  async function uploadToCloud() {
    setCloudStatus("");
    const base = apiBaseUrl();
    if (!base) {
      setCloudStatus("API_BASE_URL が未設定です（frontend/.env.local）。");
      return;
    }
    if (!isCognitoConfigured() || !userEmail) {
      setCloudStatus("ログインしてください（/auth）。");
      return;
    }
    const setId = cloudSetId.trim();
    if (!setId) {
      setCloudStatus("setId を入力してください。");
      return;
    }
    if (!selectedJsonText.trim()) {
      setCloudStatus("先にJSONを読み込んでください（ローカル or サンプル）。");
      return;
    }

    try {
      setCloudStatus("署名付きURLを取得中...");
      const uploadUrlRes = await fetch(`${base.replace(/\/$/, "")}/question-sets/upload-url`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({ setId }),
      });
      if (!uploadUrlRes.ok) throw new Error(`upload-url failed: ${uploadUrlRes.status}`);
      const data = (await uploadUrlRes.json()) as { uploadUrl: string };
      if (!data.uploadUrl) throw new Error("uploadUrl missing");

      setCloudStatus("アップロード中...");
      const putRes = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: selectedJsonText,
      });
      if (!putRes.ok) throw new Error(`S3 put failed: ${putRes.status}`);

      setCloudStatus("アップロード完了");
    } catch (e) {
      setCloudStatus(e instanceof Error ? e.message : "アップロードに失敗しました");
    }
  }

  async function loadFromCloud() {
    setCloudStatus("");
    const base = apiBaseUrl();
    if (!base) {
      setCloudStatus("API_BASE_URL が未設定です（frontend/.env.local）。");
      return;
    }
    if (!isCognitoConfigured() || !userEmail) {
      setCloudStatus("ログインしてください（/auth）。");
      return;
    }
    const setId = cloudSetId.trim();
    if (!setId) {
      setCloudStatus("setId を入力してください。");
      return;
    }
    try {
      setCloudStatus("署名付きURLを取得中...");
      const res = await fetch(
        `${base.replace(/\/$/, "")}/question-sets/download-url?setId=${encodeURIComponent(setId)}`,
        { headers: { ...authHeader() } },
      );
      if (!res.ok) throw new Error(`download-url failed: ${res.status}`);
      const data = (await res.json()) as { downloadUrl: string };
      if (!data.downloadUrl) throw new Error("downloadUrl missing");

      setCloudStatus("ダウンロード中...");
      const jsonRes = await fetch(data.downloadUrl, { cache: "no-store" });
      if (!jsonRes.ok) throw new Error(`download failed: ${jsonRes.status}`);
      const text = await jsonRes.text();
      const loaded = loadQuestionSetFromJsonText(text);
      setSelectedJsonText(text);
      setCloudSetId(loaded.set_id);
      onSetSelected(loaded);
      setCloudStatus("読み込み完了");
    } catch (e) {
      setCloudStatus(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg p-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {userEmail ? `ログイン中: ${userEmail}` : "ゲスト（未ログイン）"}
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

          <div className="rounded-lg border border-border p-4">
            <div className="text-sm font-medium">クラウド（S3）</div>
            <div className="mt-2 space-y-2">
              <Label htmlFor="cloud-set-id" className="text-xs text-muted-foreground">
                setId
              </Label>
              <Input
                id="cloud-set-id"
                value={cloudSetId}
                onChange={(e) => setCloudSetId(e.target.value)}
                placeholder="example-set"
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 bg-transparent" onClick={uploadToCloud}>
                  クラウドにアップロード
                </Button>
                <Button variant="outline" className="flex-1 bg-transparent" onClick={loadFromCloud}>
                  クラウドから読み込む
                </Button>
              </div>
              {cloudStatus && <div className="text-xs text-muted-foreground">{cloudStatus}</div>}
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
        </div>
      </Card>
    </div>
  );
}

