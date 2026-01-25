"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QuestionSet } from "@/lib/questionSet";
import { loadQuestionSetFromJsonText } from "@/lib/questionSet";
import { BookOpenIcon, UploadIcon, PlusIcon, XCircleIcon } from "@/components/icons";
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
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [cloudItems, setCloudItems] = useState<CloudQuestionSet[]>([]);
  const [cloudLoading, setCloudLoading] = useState<boolean>(false);
  const [cloudQuestionCounts, setCloudQuestionCounts] = useState<Record<string, number>>({});
  const [cloudQuestionCountLoading, setCloudQuestionCountLoading] = useState<Record<string, boolean>>({});
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadSetId, setUploadSetId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadJsonText, setUploadJsonText] = useState<string>("");
  const [sampleQuestionCount, setSampleQuestionCount] = useState<number | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const user = getCurrentUser();
      setUserEmail(user?.email ?? null);
      setIsLoggedIn(isCognitoConfigured() && user !== null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/examples/questions.sample.json", { cache: "no-store" });
        if (!res.ok) return;
        const text = await res.text();
        const loaded = loadQuestionSetFromJsonText(text);
        if (!cancelled) setSampleQuestionCount(loaded.questions.length);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshCloudList() {
    const base = apiBaseUrl();
    if (!base) return;
    if (!isLoggedIn) return;
    setCloudLoading(true);
    setError("");
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/question-sets`, { headers: { ...(await authHeader()) } });
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      const data = (await res.json()) as { items?: CloudQuestionSet[] };
      setCloudItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      console.error("Failed to refresh cloud list:", e);
      setError(`クラウド一覧の更新に失敗しました: ${e instanceof Error ? e.message : "不明なエラー"}`);
    } finally {
      setCloudLoading(false);
    }
  }

  useEffect(() => {
    if (!userEmail) return;
    refreshCloudList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  async function fetchCloudQuestionCount(setId: string) {
    const base = apiBaseUrl();
    if (!base) return;
    if (!isLoggedIn) return;
    if (cloudQuestionCounts[setId] !== undefined) return;
    if (cloudQuestionCountLoading[setId]) return;

    setCloudQuestionCountLoading((prev) => ({ ...prev, [setId]: true }));
    try {
      const res = await fetch(
        `${base.replace(/\/$/, "")}/question-sets/download-url?setId=${encodeURIComponent(setId)}`,
        { headers: { ...(await authHeader()) } },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { downloadUrl: string };
      if (!data.downloadUrl) return;

      const jsonRes = await fetch(data.downloadUrl, { cache: "no-store" });
      if (!jsonRes.ok) return;
      const text = await jsonRes.text();
      const loaded = loadQuestionSetFromJsonText(text);
      setCloudQuestionCounts((prev) => ({ ...prev, [setId]: loaded.questions.length }));
    } catch {
      // ignore
    } finally {
      setCloudQuestionCountLoading((prev) => ({ ...prev, [setId]: false }));
    }
  }

  useEffect(() => {
    if (!isLoggedIn) return;
    if (cloudItems.length === 0) return;
    cloudItems.forEach((it) => {
      void fetchCloudQuestionCount(it.setId);
    });
    // Intentionally omit fetchCloudQuestionCount from deps to avoid reruns on state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, cloudItems]);

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
    if (!isLoggedIn) {
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
    if (!isLoggedIn) {
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

  async function deleteFromCloud(setId: string) {
    setUploadStatus("");
    const base = apiBaseUrl();
    if (!base) {
      setUploadStatus("API_BASE_URL が未設定です（frontend/.env.local）。");
      return;
    }
    if (!isLoggedIn) {
      setUploadStatus("ログインしてください（/auth）。");
      return;
    }
    const ok = confirm(`クラウドから「${setId}」を削除しますか？（復元できません）`);
    if (!ok) return;

    try {
      setUploadStatus("削除中...");
      const res = await fetch(
        `${base.replace(/\/$/, "")}/question-sets?setId=${encodeURIComponent(setId)}`,
        { method: "DELETE", headers: { ...(await authHeader()) } },
      );
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
      setUploadStatus("削除しました");
      // Optimistically remove from UI even if list refresh fails.
      setCloudItems((prev) => prev.filter((it) => it.setId !== setId));
      setCloudQuestionCounts((prev) => {
        const next = { ...prev };
        delete next[setId];
        return next;
      });
      setCloudQuestionCountLoading((prev) => {
        const next = { ...prev };
        delete next[setId];
        return next;
      });
      await refreshCloudList();
    } catch (e) {
      setUploadStatus(e instanceof Error ? e.message : "削除に失敗しました");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 shadow-sm">
              <BookOpenIcon className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">模擬試験アプリ</h1>
              <p className="text-sm text-muted-foreground mt-0.5">問題セットを選択して学習を開始しましょう</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-muted-foreground hidden sm:block">
              {userEmail ? `ログイン中: ${userEmail}` : "ゲスト（未ログイン）"}
            </div>
            <Link href="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              アカウント
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-6 py-10">
        {error && (
          <div className="mb-6 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive shadow-sm">
            {error}
          </div>
        )}
        {uploadStatus && (
          <div className="mb-6 rounded-lg bg-muted/50 border border-border p-4 text-sm text-foreground shadow-sm">
            {uploadStatus}
          </div>
        )}

        {/* Sample Question Set */}
        <div className="mb-10">
          <h2 className="mb-5 text-xl font-bold tracking-tight">サンプル問題集</h2>
          <Card 
            className="cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] border-2 group" 
            onClick={handleLoadSample}
          >
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-lg">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <BookOpenIcon className="h-5 w-5 text-primary" />
                </div>
                サンプル問題セット
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">デモ用のサンプル問題集を試すことができます</p>
              <p className="mt-2 text-xs text-muted-foreground">
                問題数: {sampleQuestionCount !== null ? `${sampleQuestionCount}問` : "読み込み中..."}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Cloud Question Sets */}
        {isLoggedIn && (
          <div>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight">自分の問題集</h2>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={refreshCloudList} 
                disabled={cloudLoading}
                className="shadow-sm hover:shadow-md transition-all"
              >
                {cloudLoading ? "読み込み中..." : "更新"}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {/* Upload card (always first) */}
              <Card
                className="cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] border-2 border-dashed group flex flex-col"
                onClick={() => {
                  setShowUploadModal(true);
                  setError("");
                  setUploadStatus("");
                }}
              >
                <CardContent className="flex flex-1 flex-col items-center justify-center !p-6 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <PlusIcon className="h-7 w-7 text-primary" />
                  </div>
                  <p className="mt-3 text-sm font-semibold">アップロード</p>
                  <p className="mt-1 text-xs text-muted-foreground">JSONの問題集を追加</p>
                </CardContent>
              </Card>

              {cloudItems.map((item) => (
                <Card
                  key={item.setId}
                  className="cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] border-2 group"
                  onClick={() => loadFromCloud(item.setId)}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-3 truncate text-base">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
                        <BookOpenIcon className="h-5 w-5 text-primary" />
                      </div>
                      <span className="truncate" title={item.setId}>
                        {item.setId}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="mt-1 text-xs text-muted-foreground">
                          問題数:{" "}
                          {cloudQuestionCounts[item.setId] !== undefined
                            ? `${cloudQuestionCounts[item.setId]}問`
                            : cloudQuestionCountLoading[item.setId]
                              ? "読み込み中..."
                              : "読み込み中..."}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">最終更新: {formatDate(item.lastModified)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteFromCloud(item.setId);
                        }}
                        aria-label={`delete ${item.setId}`}
                      >
                        <XCircleIcon className="mr-1 h-4 w-4" />
                        削除
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Upload Modal */}
        {showUploadModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
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
            <Card className="w-full max-w-lg border-2 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">問題集をアップロード</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <Label htmlFor="upload-file" className="text-sm font-semibold">JSONファイルを選択</Label>
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
                      className="w-full h-11 bg-transparent hover:bg-muted/50 transition-all"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadIcon className="mr-2 h-4 w-4" />
                      {uploadFile ? uploadFile.name : "ファイルを選択"}
                    </Button>
                  </div>
                </div>

                {uploadJsonText && (
                  <div>
                    <Label htmlFor="upload-set-id" className="text-sm font-semibold">問題セットID</Label>
                    <Input
                      id="upload-set-id"
                      value={uploadSetId}
                      onChange={(e) => setUploadSetId(e.target.value)}
                      placeholder="example-set"
                      className="mt-2 h-11"
                    />
                  </div>
                )}

                {uploadStatus && (
                  <div className="rounded-lg bg-muted/50 border border-border p-4 text-sm text-foreground">
                    {uploadStatus}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1 h-11 bg-transparent hover:bg-muted/50 transition-all"
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
                    className="flex-1 h-11 shadow-md hover:shadow-lg transition-all"
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
