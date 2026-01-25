"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { QuestionSet } from "@/lib/questionSet";
import type { ProgressState } from "@/lib/progress";
import { HomeIcon, RotateCcwIcon } from "@/components/icons";

interface ExamSidebarProps {
  questionSet: QuestionSet;
  progress: ProgressState;
  currentQuestionIndex: number;
  trialNumber: number | null;
  isReadOnly: boolean;
  onQuestionSelect: (index: number) => void;
  onReset: () => void;
  onBackToHome: () => void;
}

export function ExamSidebar({
  questionSet,
  progress,
  currentQuestionIndex,
  trialNumber,
  isReadOnly,
  onQuestionSelect,
  onReset,
  onBackToHome,
}: ExamSidebarProps) {
  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Trial Header */}
      {trialNumber !== null && (
        <div className="border-b border-sidebar-border px-6 py-4">
          <div className={`text-sm font-medium px-3 py-1.5 rounded-lg text-center ${
            isReadOnly
              ? "bg-success/10 text-success"
              : "bg-primary/10 text-primary"
          }`}>
            トライアル #{trialNumber}
            {isReadOnly && " (閲覧のみ)"}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-sidebar-foreground uppercase tracking-wide">問題一覧</h3>
          <div className="grid grid-cols-5 gap-2.5">
            {questionSet.questions.map((question, index) => {
              const answer = progress.attemptsByQuestionId[question.id];
              const isCurrent = index === currentQuestionIndex;
              const hasAnswer = answer?.selectedChoiceIds && answer.selectedChoiceIds.length > 0;

              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => onQuestionSelect(index)}
                  className={`relative flex aspect-square items-center justify-center rounded-lg border-2 text-sm font-semibold transition-all duration-200 ${
                    isCurrent
                      ? "border-primary bg-primary text-primary-foreground shadow-lg scale-105 z-10"
                      : answer && hasAnswer
                        ? answer.isCorrect === true
                          ? "border-success/60 bg-success/15 text-success hover:border-success hover:bg-success/25 hover:scale-105"
                          : answer.isCorrect === false
                            ? "border-destructive/60 bg-destructive/15 text-destructive hover:border-destructive hover:bg-destructive/25 hover:scale-105"
                            : "border-warning/60 bg-warning/15 text-warning hover:border-warning hover:bg-warning/25 hover:scale-105"
                        : "border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:border-primary/50 hover:bg-primary/10 hover:scale-105"
                  }`}
                >
                  {index + 1}
                  {answer?.flagged && (
                    <div className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-warning shadow-sm border-2 border-sidebar" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-6 bg-sidebar-accent/30">
        <div className="space-y-2.5">
          <Button
            variant="outline"
            className="w-full h-10 bg-transparent hover:bg-sidebar-accent transition-all shadow-sm hover:shadow-md disabled:opacity-50"
            onClick={onReset}
            disabled={isReadOnly}
            title={isReadOnly ? "完了済みトライアルはリセットできません" : undefined}
          >
            <RotateCcwIcon className="mr-2 h-4 w-4" />
            進捗をリセット
          </Button>
          <Button
            variant="outline"
            className="w-full h-10 bg-transparent hover:bg-sidebar-accent transition-all shadow-sm hover:shadow-md"
            onClick={onBackToHome}
          >
            <HomeIcon className="mr-2 h-4 w-4" />
            ホームに戻る
          </Button>
        </div>
      </div>
    </div>
  );
}
