"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Trial, TrialSummary } from "@/lib/progress";
import { listTrials, deleteTrial } from "@/lib/trialApi";
import { apiBaseUrl } from "@/lib/awsAuth";
import { HistoryIcon, TrashIcon, EyeIcon, CheckCircle2Icon, XCircleIcon, TrendingUpIcon } from "@/components/icons";

interface TrialHistoryPanelProps {
  setId: string;
  onViewTrial: (trial: Trial) => void;
  onTrialDeleted?: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "不明";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}秒`;
  return `${mins}分${secs}秒`;
}

function formatDate(dateString: string | null): string {
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

function SummaryDisplay({ summary }: { summary: TrialSummary | null }) {
  if (!summary) {
    return <span className="text-xs text-muted-foreground">サマリー未計算</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <div className="flex items-center gap-1">
        <CheckCircle2Icon className="h-3.5 w-3.5 text-success" />
        <span className="text-success font-medium">{summary.correctAnswers}</span>
      </div>
      <div className="flex items-center gap-1">
        <XCircleIcon className="h-3.5 w-3.5 text-destructive" />
        <span className="text-destructive font-medium">{summary.incorrectAnswers}</span>
      </div>
      <div className="flex items-center gap-1">
        <TrendingUpIcon className="h-3.5 w-3.5 text-primary" />
        <span className="text-primary font-medium">{summary.accuracyRate}%</span>
      </div>
    </div>
  );
}

export function TrialHistoryPanel({
  setId,
  onViewTrial,
  onTrialDeleted,
}: TrialHistoryPanelProps) {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadTrials() {
    const base = apiBaseUrl();
    if (!base) {
      setError("API未設定");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await listTrials(setId);
      setTrials(data.trials);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTrials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  async function handleDelete(trialId: string) {
    if (!confirm("このトライアルを削除しますか？この操作は取り消せません。")) {
      return;
    }

    setDeletingId(trialId);
    try {
      await deleteTrial(setId, trialId);
      setTrials((prev) => prev.filter((t) => t.trialId !== trialId));
      onTrialDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <Card className="border-2">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <HistoryIcon className="h-5 w-5" />
            トライアル履歴
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-8">
            読み込み中...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-2">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <HistoryIcon className="h-5 w-5" />
            トライアル履歴
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive text-center py-4">
            {error}
          </div>
          <Button variant="outline" onClick={loadTrials} className="w-full mt-2">
            再読み込み
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (trials.length === 0) {
    return (
      <Card className="border-2">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <HistoryIcon className="h-5 w-5" />
            トライアル履歴
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-8">
            まだトライアル履歴がありません
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <HistoryIcon className="h-5 w-5" />
          トライアル履歴
          <span className="text-sm font-normal text-muted-foreground">
            ({trials.length}件)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-0 divide-y divide-border">
            {trials.map((trial) => (
              <div
                key={trial.trialId}
                className="flex items-start justify-between gap-4 p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">
                      受験開始: {formatDate(trial.startedAt)}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        trial.status === "completed"
                          ? "bg-success/10 text-success"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      {trial.status === "completed" ? "完了" : "進行中"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {trial.completedAt && (
                      <>
                        完了: {formatDate(trial.completedAt)}
                      </>
                    )}
                    {trial.summary?.durationSeconds != null && (
                      <> ({formatDuration(trial.summary.durationSeconds)})</>
                    )}
                  </div>
                  <SummaryDisplay summary={trial.summary} />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onViewTrial(trial)}
                    title="閲覧"
                  >
                    <EyeIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(trial.trialId)}
                    disabled={deletingId === trial.trialId}
                    title="削除"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
