"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/stats-card";
import { Button } from "@/components/ui/button";
import { BookOpenIcon, CheckCircle2Icon, TrendingUpIcon, XCircleIcon } from "@/components/icons";

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
    <div className="flex items-center gap-6">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          {/* Track */}
          <circle
            cx="18"
            cy="18"
            r="14"
            pathLength={100}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="text-muted"
          />

          {/* Segments */}
          {hasAny &&
            arcs
              .filter((a) => a.pct > 0)
              .map((a) => (
                <circle
                  key={a.label}
                  cx="18"
                  cy="18"
                  r="14"
                  pathLength={100}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="butt"
                  strokeDasharray={`${a.pct} ${100 - a.pct}`}
                  strokeDashoffset={-a.offset}
                  className={a.className}
                />
              ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{props.centerLabel}</div>
            <div className="text-2xl font-semibold">{props.centerValue}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-2">
        {props.segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${s.dotClassName}`} />
              <span className="text-muted-foreground">{s.label}</span>
            </div>
            <span className="font-medium">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">結果</h1>
        <p className="mt-1 text-sm text-muted-foreground">{props.title}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
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
          className="border-success/20 bg-success/5"
        />
        <StatsCard
          title="正答率"
          value={`${props.accuracyRate}%`}
          icon={TrendingUpIcon}
          className="border-primary/20 bg-primary/5"
          description="（正誤判定できる回答の中での正答率）"
        />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircleIcon className="h-5 w-5 text-muted-foreground" />
              内訳
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResultDonutChart
              segments={segments}
              total={props.totalQuestions}
              centerLabel="正答率"
              centerValue={`${props.accuracyRate}%`}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" className="bg-transparent" onClick={props.onBackToExam}>
          問題に戻る
        </Button>
        <Button onClick={props.onBackToHome}>ホームに戻る</Button>
      </div>
    </div>
  );
}

