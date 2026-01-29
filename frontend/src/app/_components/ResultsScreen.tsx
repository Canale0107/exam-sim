"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/stats-card";
import { Button } from "@/components/ui/button";
import { BookOpenIcon, CheckCircle2Icon, TrendingUpIcon, XCircleIcon } from "@/components/icons";
import type { TrialStatus } from "@/lib/progress";

type Segment = {
  label: string;
  value: number;
  className: string;
  dotClassName: string;
};

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function donutSegments(segments: Segment[], total: number): Array<Segment & { pct: number; offset: number }> {
  if (total <= 0) {
    return segments.map((s) => ({ ...s, pct: 0, offset: 0 }));
  }

  // Convert to percentages (0..100) on a pathLength=100 circle
  const pctSegments = segments.map((s) => ({
    ...s,
    pct: clamp((s.value / total) * 100, 0, 100),
  }));

  // Accumulate offsets so arcs continue from previous end.
  let acc = 0;
  return pctSegments.map((s) => {
    const offset = acc;
    acc += s.pct;
    return { ...s, offset };
  });
}

function ResultDonutChart(props: {
  segments: Segment[];
  total: number;
  centerLabel: string;
  centerValue: string;
}) {
  const arcs = donutSegments(props.segments, props.total);
  const hasAny = props.total > 0 && arcs.some((a) => a.pct > 0);

  return (
    <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center">
      <div className="relative h-48 w-48 shrink-0">
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          {/* Track */}
          <circle
            cx="18"
            cy="18"
            r="14"
            pathLength={100}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            className="text-muted/30"
          />

          {/* Segments */}
          {hasAny &&
            arcs
              .filter((a) => a.pct > 0)
              .map((a, index) => (
                <circle
                  key={a.label}
                  cx="18"
                  cy="18"
                  r="14"
                  pathLength={100}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={`${a.pct} ${100 - a.pct}`}
                  strokeDashoffset={-a.offset}
                  className={a.className}
                  style={{
                    animation: `fadeIn 0.5s ease-out ${index * 0.1}s both`,
                  }}
                />
              ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-sm font-medium text-muted-foreground">{props.centerLabel}</div>
            <div className="text-3xl font-bold mt-1">{props.centerValue}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 w-full space-y-3">
        {props.segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${s.dotClassName} shadow-sm`} />
              <span className="text-base font-medium">{s.label}</span>
            </div>
            <span className="text-lg font-bold tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTrialDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  } catch {
    return isoString;
  }
}

export function ResultsScreen(props: {
  title: string;
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unknownAnswers: number;
  unansweredQuestions: number;
  accuracyRate: number;
  trialStartedAt: string | null;
  trialStatus: TrialStatus | null;
  onBackToExam: () => void;
  onBackToHome: () => void;
}) {
  const segments: Segment[] = [
    { label: "正解", value: props.correctAnswers, className: "text-success", dotClassName: "bg-success" },
    {
      label: "不正解",
      value: props.incorrectAnswers,
      className: "text-destructive",
      dotClassName: "bg-destructive",
    },
    { label: "正誤不明", value: props.unknownAnswers, className: "text-warning", dotClassName: "bg-warning" },
    {
      label: "未回答",
      value: props.unansweredQuestions,
      className: "text-muted-foreground",
      dotClassName: "bg-muted-foreground",
    },
  ];

  const isCompleted = props.trialStatus === "completed";

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">結果</h1>
          {props.trialStartedAt !== null && (
            <span className={`text-sm px-3 py-1 rounded-full ${
              isCompleted
                ? "bg-success/10 text-success"
                : "bg-primary/10 text-primary"
            }`}>
              受験開始: {formatTrialDate(props.trialStartedAt)}
              {isCompleted && " (完了)"}
            </span>
          )}
        </div>
        <p className="mt-2 text-base text-muted-foreground">{props.title}</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-3 mb-8">
        <StatsCard
          title="回答数"
          value={`${props.answeredQuestions}/${props.totalQuestions}`}
          icon={BookOpenIcon}
          description={`${Math.round((props.answeredQuestions / Math.max(1, props.totalQuestions)) * 100)}% 完了`}
        />
        <StatsCard
          title="正解数"
          value={props.correctAnswers}
          icon={CheckCircle2Icon}
          className="border-success/30 bg-success/10 shadow-sm"
        />
        <StatsCard
          title="正答率"
          value={`${props.accuracyRate}%`}
          icon={TrendingUpIcon}
          className="border-primary/30 bg-primary/10 shadow-sm"
          description="（正誤判定できる回答の中での正答率）"
        />
      </div>

      <div className="mb-8">
        <Card className="border-2 shadow-md">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-xl">
              <XCircleIcon className="h-6 w-6 text-muted-foreground" />
              内訳
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <ResultDonutChart
              segments={segments}
              total={props.totalQuestions}
              centerLabel="正答率"
              centerValue={`${props.accuracyRate}%`}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          className="bg-transparent h-11 hover:bg-muted/50 transition-all"
          onClick={props.onBackToExam}
        >
          問題に戻る
        </Button>
        <Button
          className="h-11 shadow-md hover:shadow-lg transition-all"
          onClick={props.onBackToHome}
        >
          ホームに戻る
        </Button>
      </div>
    </div>
  );
}
