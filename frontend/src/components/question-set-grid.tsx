"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QuestionSet } from "@/lib/questionSet";
import { loadQuestionSetFromJsonText } from "@/lib/questionSet";
import { BookOpenIcon, UploadIcon, PlusIcon } from "@/components/icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiBaseUrl, authHeader, getCurrentUser, isCognitoConfigured } from "@/lib/awsAuth";

interface QuestionSetGridProps {
  onSetSelected: (set: QuestionSet) => void;
}

interface CloudQuestionSet {
  setId: string;
  lastModified?: string | null;
}

export function QuestionSetGrid({ onSetSelected }: QuestionSetGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [cloudItems, setCloudItems] = useState<CloudQuestionSet[]>([]);
  const [cloudLoading, setCloudLoading] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadSetId, setUploadSetId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadJsonText, setUploadJsonText] = useState<string>("");

  useEffect(() => {
    queueMicrotask(() => setUserEmail(getCurrentUser()?.email ?? null));
  }, []);

  async function refreshCloudList() {
    const base = apiBaseUrl();
    if (!base) return;
    if (!isCognitoConfigured() || !getCurrentUser()) return;
    setCloudLoading(true);
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/question-sets`, { headers: { ...(await authHeader()) } });
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      const data = (await res.json()) as { items?: CloudQuestionSet[] };
      setCloudItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      console.error("Failed to refresh cloud list:", e);
    } finally {
      setCloudLoading(false);
    }
  }

  useEffect(() => {
    if (!userEmail) return;
    refreshCloudList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = String(e.target?.result ?? "");
        const loaded = loadQuestionSetFromJsonText(text);
        setUploadJsonText(text);
        setUploadSetId(loaded.set_id);
        setError("");
      } catch (err) {
        setError(`ファイルの読み込みに失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`);
        setUploadFile(null);
        setUploadJsonText("");
      }
    };
    reader.readAsText(file);
  };

  async function handleUpload() {
    setUploadStatus("");
    const base = apiBaseUrl();
    if (!base) {
      setUploadStatus("API_BASE_URL が未設定です（frontend/.env.local）。");
      return;
    }
    if (!isCognitoConfigured() || !getCurrentUser()) {
      setUploadStatus("ログインしてください（/auth）。");
      return;
    }
    const setId = uploadSetId.trim();
    if (!setId) {
      setUploadStatus("setId を入力してください。");
      return;
    }
    if (!uploadJsonText.trim()) {
      setUploadStatus("先にJSONファイルを選択してください。");
      return;
    }

    try {
      setUploadStatus("署名付きURLを取得中...");
      const uploadUrlRes = await fetch(`${base.replace(/\/$/, "")}/question-sets/upload-url`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ setId }),
      });
      if (!uploadUrlRes.ok) throw new Error(`upload-url failed: ${uploadUrlRes.status}`);
      const data = (await uploadUrlRes.json()) as { uploadUrl: string };
      if (!data.uploadUrl) throw new Error("uploadUrl missing");

      setUploadStatus("アップロード中...");
      const putRes = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: uploadFile ?? uploadJsonText,
      });
      if (!putRes.ok) throw new Error(`S3 put failed: ${putRes.status}`);

      setUploadStatus("アップロード完了");
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadJsonText("");
      setUploadSetId("");
      await refreshCloudList();
    } catch (e) {
      setUploadStatus(e instanceof Error ? e.message : "アップロードに失敗しました");
    }
  }

  async function loadFromCloud(setId: string) {
    setUploadStatus("");
    const base = apiBaseUrl();
    if (!base) {
      setUploadStatus("API_BASE_URL が未設定です（frontend/.env.local）。");
      return;
    }
    if (!isCognitoConfigured() || !getCurrentUser()) {
      setUploadStatus("ログインしてください（/auth）。");
      return;
    }
    try {
      setUploadStatus("読み込み中...");
      const res = await fetch(
        `${base.replace(/\/$/, "")}/question-sets/download-url?setId=${encodeURIComponent(setId)}`,
        { headers: { ...(await authHeader()) } },
      );
      if (!res.ok) throw new Error(`download-url failed: ${res.status}`);
      const data = (await res.json()) as { downloadUrl: string };
      if (!data.downloadUrl) throw new Error("downloadUrl missing");

      const jsonRes = await fetch(data.downloadUrl, { cache: "no-store" });
      if (!jsonRes.ok) throw new Error(`download failed: ${jsonRes.status}`);
      const text = await jsonRes.text();
      const loaded = loadQuestionSetFromJsonText(text);
      onSetSelected(loaded);
      setUploadStatus("");
    } catch (e) {
      setUploadStatus(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }

  const handleLoadSample = async () => {
    try {
      const res = await fetch("/examples/questions.sample.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`failed to fetch sample: ${res.status}`);
      const text = await res.text();
      const loaded = loadQuestionSetFromJsonText(text);
      onSetSelected(loaded);
    } catch (err) {
      setError(`サンプルの読み込みに失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`);
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "日付不明";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
    } catch {
      return "日付不明";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BookOpenIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">模擬試験アプリ</h1>
              <p className="text-xs text-muted-foreground">問題セットを選択して学習を開始しましょう</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              {userEmail ? `ログイン中: ${userEmail}` : "ゲスト（未ログイン）"}
            </div>
            <Link href="/auth" className="text-xs text-muted-foreground hover:underline">
              アカウント
            </Link>
            {isCognitoConfigured() && getCurrentUser() && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowUploadModal(true);
                  setError("");
                  setUploadStatus("");
                }}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                アップロード
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {/* Sample Question Set */}
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">サンプル問題集</h2>
          <Card className="cursor-pointer transition-all hover:shadow-md" onClick={handleLoadSample}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpenIcon className="h-5 w-5" />
                サンプル問題セット
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">デモ用のサンプル問題集を試すことができます</p>
            </CardContent>
          </Card>
        </div>

        {/* Cloud Question Sets */}
        {isCognitoConfigured() && getCurrentUser() && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">クラウドの問題集</h2>
              <Button variant="outline" size="sm" onClick={refreshCloudList} disabled={cloudLoading}>
                {cloudLoading ? "読み込み中..." : "更新"}
              </Button>
            </div>
            {cloudItems.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  クラウドに問題セットがありません。アップロードボタンから問題集を追加してください。
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {cloudItems.map((item) => (
                  <Card
                    key={item.setId}
                    className="cursor-pointer transition-all hover:shadow-md"
                    onClick={() => loadFromCloud(item.setId)}
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 truncate">
                        <BookOpenIcon className="h-5 w-5 flex-shrink-0" />
                        <span className="truncate" title={item.setId}>
                          {item.setId}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">
                        最終更新: {formatDate(item.lastModified)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upload Modal */}
        {showUploadModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowUploadModal(false);
                setUploadFile(null);
                setUploadJsonText("");
                setUploadSetId("");
                setUploadStatus("");
                setError("");
              }
            }}
          >
            <Card className="w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
              <CardHeader>
                <CardTitle>問題集をアップロード</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="upload-file">JSONファイルを選択</Label>
                  <div className="mt-2">
                    <Input
                      id="upload-file"
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      className="w-full bg-transparent"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadIcon className="mr-2 h-4 w-4" />
                      {uploadFile ? uploadFile.name : "ファイルを選択"}
                    </Button>
                  </div>
                </div>

                {uploadJsonText && (
                  <div>
                    <Label htmlFor="upload-set-id">問題セットID</Label>
                    <Input
                      id="upload-set-id"
                      value={uploadSetId}
                      onChange={(e) => setUploadSetId(e.target.value)}
                      placeholder="example-set"
                      className="mt-2"
                    />
                  </div>
                )}

                {uploadStatus && (
                  <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{uploadStatus}</div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadFile(null);
                      setUploadJsonText("");
                      setUploadSetId("");
                      setUploadStatus("");
                      setError("");
                    }}
                  >
                    キャンセル
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleUpload}
                    disabled={!uploadJsonText || !uploadSetId.trim()}
                  >
                    アップロード
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
