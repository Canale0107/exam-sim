"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { QuestionSet } from "@/lib/questionSet";
import { loadQuestionSetFromJsonText } from "@/lib/questionSet";
import {
  BookOpenIcon,
  RotateCcwIcon,
  UploadIcon,
  PlusIcon,
  XCircleIcon,
  PlayIcon,
  HistoryIcon,
  CheckCircle2Icon,
  TrendingUpIcon,
  TrashIcon,
  PlusCircleIcon,
  MoreVerticalIcon,
  UserIcon,
} from "@/components/icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiBaseUrl, authHeader, getCurrentUser, isCognitoConfigured } from "@/lib/awsAuth";
import { listTrials, deleteTrial, createTrial } from "@/lib/trialApi";
import type { Trial, TrialStatus, TrialSummary } from "@/lib/progress";

type TrialInfo = {
  trialId: string;
  trialNumber: number;
  status: TrialStatus;
  startedAt: string;
};

interface QuestionSetGridProps {
  onSetSelected: (set: QuestionSet, trialInfo?: TrialInfo) => void;
}

interface CloudQuestionSet {
  setId: string;
  lastModified?: string | null;
}

interface TrialListData {
  activeTrialId: string | null;
  trialCount: number;
  trials: Trial[];
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "不明";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "不明";
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}秒`;
  return `${mins}分${secs}秒`;
}

function SummaryBadges({ summary }: { summary: TrialSummary | null }) {
  if (!summary) return null;

  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1">
        <CheckCircle2Icon className="h-3.5 w-3.5 text-success" />
        <span className="font-medium">{summary.correctAnswers}</span>
      </div>
      <div className="flex items-center gap-1">
        <XCircleIcon className="h-3.5 w-3.5 text-destructive" />
        <span className="font-medium">{summary.incorrectAnswers}</span>
      </div>
      <div className="flex items-center gap-1">
        <TrendingUpIcon className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">{summary.accuracyRate}%</span>
      </div>
    </div>
  );
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
  const [trialDataCache, setTrialDataCache] = useState<Record<string, TrialListData>>({});
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadSetId, setUploadSetId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadJsonText, setUploadJsonText] = useState<string>("");
  const [sampleQuestionCount, setSampleQuestionCount] = useState<number | null>(null);

  // Trial selection modal
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [selectedSetQuestionSet, setSelectedSetQuestionSet] = useState<QuestionSet | null>(null);
  const [trialModalLoading, setTrialModalLoading] = useState<boolean>(false);
  const [trialModalTrials, setTrialModalTrials] = useState<Trial[]>([]);
  const [trialModalActiveId, setTrialModalActiveId] = useState<string | null>(null);
  const [deletingTrialId, setDeletingTrialId] = useState<string | null>(null);
  const [creatingTrial, setCreatingTrial] = useState<boolean>(false);
  const [openMenuSetId, setOpenMenuSetId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const user = getCurrentUser();
      setUserEmail(user?.email ?? null);
      setIsLoggedIn(isCognitoConfigured() && user !== null);
    });
  }, []);

  // Close dropdown menu when clicking outside
  useEffect(() => {
    if (!openMenuSetId) return;
    const handleClickOutside = () => setOpenMenuSetId(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [openMenuSetId]);

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

  async function fetchTrialData(setId: string) {
    const base = apiBaseUrl();
    if (!base) return;
    if (!isLoggedIn) return;
    if (trialDataCache[setId] !== undefined) return;

    try {
      const data = await listTrials(setId);
      setTrialDataCache((prev) => ({
        ...prev,
        [setId]: {
          activeTrialId: data.activeTrialId,
          trialCount: data.trialCount,
          trials: data.trials,
        },
      }));
    } catch {
      // ignore - trial info is optional
    }
  }

  useEffect(() => {
    if (!isLoggedIn) return;
    if (cloudItems.length === 0) return;
    cloudItems.forEach((it) => {
      void fetchCloudQuestionCount(it.setId);
      void fetchTrialData(it.setId);
    });
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

  async function loadQuestionSetFromCloud(setId: string): Promise<QuestionSet | null> {
    const base = apiBaseUrl();
    if (!base) return null;
    if (!isLoggedIn) return null;

    try {
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
      return loadQuestionSetFromJsonText(text);
    } catch {
      return null;
    }
  }

  async function openTrialModal(setId: string) {
    setSelectedSetId(setId);
    setTrialModalLoading(true);
    setTrialModalTrials([]);
    setTrialModalActiveId(null);
    setSelectedSetQuestionSet(null);

    try {
      // Load question set and trials in parallel
      const [qset, trialsData] = await Promise.all([
        loadQuestionSetFromCloud(setId),
        listTrials(setId),
      ]);

      setSelectedSetQuestionSet(qset);

      // Sort trials: active first, then by trialNumber descending
      const sorted = [...trialsData.trials].sort((a, b) => {
        if (a.trialId === trialsData.activeTrialId) return -1;
        if (b.trialId === trialsData.activeTrialId) return 1;
        return b.trialNumber - a.trialNumber;
      });

      setTrialModalTrials(sorted);
      setTrialModalActiveId(trialsData.activeTrialId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      setSelectedSetId(null);
    } finally {
      setTrialModalLoading(false);
    }
  }

  function closeTrialModal() {
    setSelectedSetId(null);
    setSelectedSetQuestionSet(null);
    setTrialModalTrials([]);
    setTrialModalActiveId(null);
  }

  function selectTrial(trial: Trial) {
    if (!selectedSetQuestionSet) return;

    const trialInfo: TrialInfo = {
      trialId: trial.trialId,
      trialNumber: trial.trialNumber,
      status: trial.status,
      startedAt: trial.startedAt,
    };
    onSetSelected(selectedSetQuestionSet, trialInfo);
    closeTrialModal();
  }

  async function handleCreateNewTrial() {
    if (!selectedSetId || !selectedSetQuestionSet) return;

    setCreatingTrial(true);
    try {
      const totalQuestions = selectedSetQuestionSet.questions.length;
      const res = await createTrial({ setId: selectedSetId, totalQuestions });

      const trialInfo: TrialInfo = {
        trialId: res.trialId,
        trialNumber: res.trialNumber,
        status: "in_progress",
        startedAt: res.startedAt,
      };
      onSetSelected(selectedSetQuestionSet, trialInfo);
      closeTrialModal();

      // Update cache
      setTrialDataCache((prev) => {
        const existing = prev[selectedSetId];
        return {
          ...prev,
          [selectedSetId]: {
            activeTrialId: res.trialId,
            trialCount: (existing?.trialCount ?? 0) + 1,
            trials: [
              {
                trialId: res.trialId,
                trialNumber: res.trialNumber,
                status: "in_progress",
                startedAt: res.startedAt,
                completedAt: null,
                state: res.state,
                summary: null,
              },
              ...(existing?.trials ?? []),
            ],
          },
        };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("active_trial_exists:")) {
        setError("進行中のトライアルがあります。先にそれを完了させてください。");
      } else {
        setError(msg || "トライアル作成に失敗しました");
      }
    } finally {
      setCreatingTrial(false);
    }
  }

  async function handleDeleteTrial(trialId: string) {
    if (!selectedSetId) return;
    if (!confirm("このトライアルを削除しますか？この操作は取り消せません。")) return;

    setDeletingTrialId(trialId);
    try {
      await deleteTrial(selectedSetId, trialId);
      setTrialModalTrials((prev) => prev.filter((t) => t.trialId !== trialId));
      if (trialModalActiveId === trialId) {
        setTrialModalActiveId(null);
      }

      // Update cache
      setTrialDataCache((prev) => {
        const existing = prev[selectedSetId];
        if (!existing) return prev;
        return {
          ...prev,
          [selectedSetId]: {
            ...existing,
            activeTrialId: existing.activeTrialId === trialId ? null : existing.activeTrialId,
            trialCount: Math.max(0, existing.trialCount - 1),
            trials: existing.trials.filter((t) => t.trialId !== trialId),
          },
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingTrialId(null);
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

  async function deleteQuestionSetFromCloud(setId: string) {
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
      setTrialDataCache((prev) => {
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
            <Link
              href="/auth"
              className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="アカウント"
            >
              <UserIcon className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-6 py-10">
        {error && (
          <div className="mb-6 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive shadow-sm">
            {error}
            <button className="ml-2 underline" onClick={() => setError("")}>
              閉じる
            </button>
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
                size="icon"
                onClick={refreshCloudList}
                disabled={cloudLoading}
                className="h-9 w-9 shadow-sm hover:shadow-md transition-all"
                aria-label="更新"
              >
                <RotateCcwIcon className={`h-4 w-4 ${cloudLoading ? "animate-spin" : ""}`} />
                <span className="sr-only">{cloudLoading ? "更新中" : "更新"}</span>
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

              {cloudItems.map((item) => {
                const data = trialDataCache[item.setId];
                const trialCount = data?.trialCount ?? 0;
                const hasActiveTrial = data?.activeTrialId != null;

                return (
                  <Card
                    key={item.setId}
                    className="cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] border-2 group relative"
                    onClick={() => openTrialModal(item.setId)}
                  >
                    <div className="absolute right-3 top-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpenMenuSetId(openMenuSetId === item.setId ? null : item.setId);
                        }}
                        aria-label={`メニューを開く`}
                      >
                        <MoreVerticalIcon className="h-4 w-4" />
                      </Button>
                      {openMenuSetId === item.setId && (
                        <div
                          className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setOpenMenuSetId(null);
                              deleteQuestionSetFromCloud(item.setId);
                            }}
                          >
                            <TrashIcon className="h-4 w-4" />
                            問題集を削除
                          </button>
                        </div>
                      )}
                    </div>
                    <CardHeader className="pb-3 pr-12">
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
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs text-muted-foreground">
                          問題数:{" "}
                          {cloudQuestionCounts[item.setId] !== undefined
                            ? `${cloudQuestionCounts[item.setId]}問`
                            : "読み込み中..."}
                        </p>

                        {/* Trial info */}
                        <div className="flex items-center gap-2 pt-2">
                          <HistoryIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {trialCount > 0 ? `${trialCount}件の履歴` : "履歴なし"}
                          </span>
                          {hasActiveTrial && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                              進行中
                            </span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
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

        {/* Trial Selection Modal */}
        {selectedSetId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                closeTrialModal();
              }
            }}
          >
            <Card className="w-full max-w-lg border-2 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl">
                  <BookOpenIcon className="h-6 w-6 text-primary" />
                  {selectedSetId}
                </CardTitle>
                {selectedSetQuestionSet && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedSetQuestionSet.questions.length}問
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {trialModalLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    読み込み中...
                  </div>
                ) : (
                  <>
                    {/* New Trial Button */}
                    <Button
                      className="w-full h-12 shadow-md hover:shadow-lg transition-all"
                      onClick={handleCreateNewTrial}
                      disabled={creatingTrial || trialModalActiveId != null}
                    >
                      <PlusCircleIcon className="mr-2 h-5 w-5" />
                      {trialModalActiveId
                        ? "進行中のトライアルがあります"
                        : "新しいトライアルを開始"}
                    </Button>

                    {/* Trial List */}
                    {trialModalTrials.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <HistoryIcon className="h-4 w-4" />
                          トライアル履歴
                        </h3>
                        <ScrollArea className="max-h-[300px]">
                          <div className="space-y-2">
                            {trialModalTrials.map((trial) => {
                              const isActive = trial.trialId === trialModalActiveId;
                              const isCompleted = trial.status === "completed";

                              return (
                                <div
                                  key={trial.trialId}
                                  className={`rounded-lg border-2 p-4 transition-all ${
                                    isActive
                                      ? "border-primary bg-primary/5"
                                      : "border-border hover:border-primary/50"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="font-medium">
                                          受験開始: {formatDate(trial.startedAt)}
                                        </span>
                                        {isActive && (
                                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                            進行中
                                          </span>
                                        )}
                                        {isCompleted && (
                                          <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">
                                            完了
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-muted-foreground mb-2">
                                        {trial.summary?.durationSeconds != null && (
                                          <span>
                                            所要時間: {formatDuration(trial.summary.durationSeconds)}
                                          </span>
                                        )}
                                      </div>
                                      <SummaryBadges summary={trial.summary} />
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        size="sm"
                                        variant={isActive ? "default" : "outline"}
                                        className="h-8"
                                        onClick={() => selectTrial(trial)}
                                      >
                                        {isActive ? (
                                          <>
                                            <PlayIcon className="mr-1 h-3.5 w-3.5" />
                                            続ける
                                          </>
                                        ) : (
                                          "閲覧"
                                        )}
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        onClick={() => handleDeleteTrial(trial.trialId)}
                                        disabled={deletingTrialId === trial.trialId}
                                      >
                                        <TrashIcon className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </div>
                    )}

                    {trialModalTrials.length === 0 && (
                      <div className="text-center py-4 text-muted-foreground text-sm">
                        まだトライアル履歴がありません
                      </div>
                    )}
                  </>
                )}

                <div className="pt-2">
                  <Button
                    variant="outline"
                    className="w-full h-11 bg-transparent hover:bg-muted/50 transition-all"
                    onClick={closeTrialModal}
                  >
                    閉じる
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
