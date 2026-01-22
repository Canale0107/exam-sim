"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatsCard } from "@/components/stats-card";
import type { QuestionSet } from "@/lib/questionSet";
import type { ProgressState } from "@/lib/progress";
import {
  BookOpenIcon,
  CheckCircle2Icon,
  XCircleIcon,
  TrendingUpIcon,
  RotateCcwIcon,
  HomeIcon,
} from "@/components/icons";

interface ExamSidebarProps {
  questionSet: QuestionSet;
  progress: ProgressState;
  currentQuestionIndex: number;
  onQuestionSelect: (index: number) => void;
  onReset: () => void;
  onBackToHome: () => void;
}

export function ExamSidebar({
  questionSet,
  progress,
  currentQuestionIndex,
  onQuestionSelect,
  onReset,
  onBackToHome,
}: ExamSidebarProps) {
  const totalQuestions = questionSet.questions.length;
  const answeredQuestions = Object.keys(progress.attemptsByQuestionId).filter(
    (qId) => progress.attemptsByQuestionId[qId]?.selectedChoiceIds && progress.attemptsByQuestionId[qId].selectedChoiceIds!.length > 0
  ).length;
  const correctAnswers = Object.values(progress.attemptsByQuestionId).filter(
    (a) => a?.isCorrect === true
  ).length;
  const incorrectAnswers = Object.values(progress.attemptsByQuestionId).filter(
    (a) => a?.isCorrect === false
  ).length;
  const accuracyRate = answeredQuestions > 0 ? Math.round((correctAnswers / answeredQuestions) * 100) : 0;

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Header */}
      <div className="border-b border-sidebar-border p-6">
        <h2 className="text-lg font-semibold">{questionSet.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {questionSet.set_id} • {totalQuestions}問
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          {/* Statistics */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">統計情報</h3>
            <div className="space-y-3">
              <StatsCard
                title="進捗"
                value={`${answeredQuestions}/${totalQuestions}`}
                icon={BookOpenIcon}
                description={`${Math.round((answeredQuestions / totalQuestions) * 100)}% 完了`}
              />
              <StatsCard
                title="正解数"
                value={correctAnswers}
                icon={CheckCircle2Icon}
                className="border-success/20 bg-success/5"
              />
              <StatsCard
                title="不正解数"
                value={incorrectAnswers}
                icon={XCircleIcon}
                className="border-destructive/20 bg-destructive/5"
              />
              <StatsCard
                title="正答率"
                value={`${accuracyRate}%`}
                icon={TrendingUpIcon}
                className="border-primary/20 bg-primary/5"
              />
            </div>
          </div>

          {/* Question List */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">問題一覧</h3>
            <div className="grid grid-cols-5 gap-2">
              {questionSet.questions.map((question, index) => {
                const answer = progress.attemptsByQuestionId[question.id];
                const isCurrent = index === currentQuestionIndex;
                const hasAnswer = answer?.selectedChoiceIds && answer.selectedChoiceIds.length > 0;

                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => onQuestionSelect(index)}
                    className={`relative flex aspect-square items-center justify-center rounded-lg border-2 text-sm font-medium transition-all ${
                      isCurrent
                        ? "border-primary bg-primary text-primary-foreground shadow-lg"
                        : answer && hasAnswer
                          ? answer.isCorrect === true
                            ? "border-success/50 bg-success/10 text-success hover:border-success"
                            : answer.isCorrect === false
                              ? "border-destructive/50 bg-destructive/10 text-destructive hover:border-destructive"
                              : "border-muted bg-muted/50 text-muted-foreground hover:border-muted-foreground"
                          : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    {index + 1}
                    {answer?.flagged && (
                      <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-warning" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <Button variant="outline" className="w-full bg-transparent" onClick={onReset}>
              <RotateCcwIcon className="mr-2 h-4 w-4" />
              進捗をリセット
            </Button>
            <Button variant="outline" className="w-full bg-transparent" onClick={onBackToHome}>
              <HomeIcon className="mr-2 h-4 w-4" />
              ホームに戻る
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

