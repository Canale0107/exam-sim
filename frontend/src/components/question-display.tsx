"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Question } from "@/lib/questionSet";
import type { Attempt } from "@/lib/progress";
import {
  CheckCircle2Icon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FlagIcon,
  PencilIcon,
} from "@/components/icons";
import { useState } from "react";

interface QuestionDisplayProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unknownAnswers: number;
  accuracyRate: number;
  attempt?: Attempt;
  isReadOnly?: boolean;
  onAnswerSubmit: (selectedChoiceIds: string[]) => void;
  onFlagToggle: (flagged: boolean) => void;
  onNoteChange: (note: string) => void;
}

export function QuestionDisplay({
  question,
  questionNumber,
  totalQuestions,
  answeredQuestions,
  correctAnswers,
  incorrectAnswers,
  unknownAnswers,
  accuracyRate,
  attempt,
  isReadOnly = false,
  onAnswerSubmit,
  onFlagToggle,
  onNoteChange,
}: QuestionDisplayProps) {
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>(
    attempt?.selectedChoiceIds ?? []
  );
  const [showExplanation, setShowExplanation] = useState(false);
  const [isNoteEditing, setIsNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string>("");

  const isAnswered = (attempt?.selectedChoiceIds?.length ?? 0) > 0;
  const isMultiple = question.is_multi_select ?? Boolean((question.answer_choice_ids?.length ?? 0) > 1);
  const progressPct =
    totalQuestions > 0 ? Math.max(0, Math.min(100, (answeredQuestions / totalQuestions) * 100)) : 0;
  const positionPct =
    totalQuestions > 0
      ? Math.max(0, Math.min(100, (questionNumber / totalQuestions) * 100))
      : 0;

  const handleChoiceClick = (choiceId: string) => {
    if (isAnswered || isReadOnly) return;

    if (isMultiple) {
      setSelectedChoiceIds((prev) =>
        prev.includes(choiceId) ? prev.filter((id) => id !== choiceId) : [...prev, choiceId]
      );
    } else {
      setSelectedChoiceIds([choiceId]);
    }
  };

  const handleSubmit = () => {
    if (selectedChoiceIds.length === 0) return;
    onAnswerSubmit(selectedChoiceIds);
  };

  const getChoiceStatus = (choiceId: string) => {
    if (!isAnswered || !question.answer_choice_ids) return "default";

    const correctAnswers = question.answer_choice_ids;
    const isCorrect = correctAnswers.includes(choiceId);
    const isSelected = selectedChoiceIds.includes(choiceId);

    if (isCorrect) return "correct";
    if (isSelected && !isCorrect) return "incorrect";
    return "default";
  };

  const hasSavedNote = Boolean(attempt?.note && attempt.note.trim());

  const openNoteEditor = () => {
    setNoteDraft(attempt?.note ?? "");
    setIsNoteEditing(true);
  };

  const saveNote = () => {
    onNoteChange(noteDraft);
    setIsNoteEditing(false);
  };

  const cancelNote = () => {
    setIsNoteEditing(false);
    setNoteDraft("");
  };

  return (
    <div className="space-y-8">
      {/* Sticky header (stays visible while scrolling long question text) */}
      <div className="sticky top-0 z-10 -mx-6 border-b border-border bg-background/95 px-6 py-5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
              問題 {questionNumber} / {totalQuestions}
            </span>
            {isMultiple && (
              <span className="rounded-lg bg-warning/10 px-3 py-1.5 text-sm font-semibold text-warning">
                複数選択
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onFlagToggle(!attempt?.flagged)}
              className={`transition-colors ${attempt?.flagged ? "text-warning hover:text-warning/80" : "hover:text-warning"}`}
              aria-label={attempt?.flagged ? "フラグを解除" : "フラグを設定"}
            >
              <FlagIcon className={`h-5 w-5 transition-transform ${attempt?.flagged ? "fill-current scale-110" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={openNoteEditor}
              className={`transition-colors ${hasSavedNote ? "text-primary hover:text-primary/80" : "text-muted-foreground hover:text-primary"}`}
              aria-label="メモを編集"
            >
              <PencilIcon className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted">
              <div 
                className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-500 ease-out" 
                style={{ width: `${progressPct}%` }} 
              />
              {/* Current position marker */}
              <div
                className="pointer-events-none absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/60 shadow-sm"
                style={{ left: `${positionPct}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
              {answeredQuestions}/{totalQuestions}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-success" />
              <span className="text-xs text-muted-foreground">
                正解 <span className="font-semibold text-success">{correctAnswers}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-destructive" />
              <span className="text-xs text-muted-foreground">
                不正解 <span className="font-semibold text-destructive">{incorrectAnswers}</span>
              </span>
            </div>
            {unknownAnswers > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-warning" />
                <span className="text-xs text-muted-foreground">
                  正誤不明 <span className="font-semibold text-warning">{unknownAnswers}</span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-primary" />
              <span className="text-xs text-muted-foreground">
                正答率 <span className="font-semibold text-primary">{accuracyRate}%</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Question text */}
      <div className="space-y-4">
        {/* Note Editor (opened by pencil icon) */}
        {isNoteEditing && (
          <Card className="border-primary/30 bg-primary/5 p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Label htmlFor="note" className="text-sm font-semibold">
                メモ
              </Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={cancelNote}>
                  キャンセル
                </Button>
                <Button size="sm" onClick={saveNote}>
                  保存
                </Button>
              </div>
            </div>
            <Textarea
              id="note"
              placeholder="メモを入力..."
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveNote();
                }
              }}
              rows={4}
              autoFocus
              className="resize-none"
            />
            <p className="mt-2 text-xs text-muted-foreground">Ctrl+Enter / Cmd+Enter で保存</p>
          </Card>
        )}
        <h2 className="whitespace-pre-wrap text-xl font-semibold leading-relaxed tracking-tight">{question.text}</h2>
      </div>

      {/* Choices */}
      <div className="space-y-3">
        {question.choices.map((choice) => {
          const status = getChoiceStatus(choice.id);
          const isSelected = selectedChoiceIds.includes(choice.id);

          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => handleChoiceClick(choice.id)}
              disabled={isAnswered || isReadOnly}
              className={`group relative w-full rounded-xl border-2 p-5 text-left transition-all duration-200 ${
                status === "correct"
                  ? "border-success bg-success/10 shadow-sm shadow-success/20"
                  : status === "incorrect"
                    ? "border-destructive bg-destructive/10 shadow-sm shadow-destructive/20"
                    : isSelected
                      ? "border-primary bg-primary/10 shadow-sm shadow-primary/10 hover:border-primary/80"
                      : "border-border bg-card hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm"
              } ${isAnswered || isReadOnly ? "cursor-default" : "cursor-pointer active:scale-[0.98]"}`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-all ${
                    isMultiple ? "rounded-md" : "rounded-full"
                  } border-2 ${
                    status === "correct"
                      ? "border-success bg-success shadow-sm"
                      : status === "incorrect"
                        ? "border-destructive bg-destructive shadow-sm"
                        : isSelected
                          ? "border-primary bg-primary shadow-sm"
                          : "border-muted-foreground/50 group-hover:border-primary/50"
                  }`}
                >
                  {isSelected && status === "default" && (
                    <div className="h-2.5 w-2.5 rounded-full bg-white shadow-sm" />
                  )}
                  {status === "correct" && <CheckCircle2Icon className="h-4 w-4 text-white" />}
                  {status === "incorrect" && <XCircleIcon className="h-4 w-4 text-white" />}
                </div>
                <span className="flex-1 leading-relaxed">
                  <span className="font-bold text-base">{choice.id}.</span>{" "}
                  <span className="text-base">{choice.text}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Submit Button */}
      {!isAnswered && !isReadOnly && (
        <Button
          onClick={handleSubmit}
          disabled={selectedChoiceIds.length === 0}
          className="w-full h-12 text-base font-semibold shadow-md transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          size="lg"
        >
          回答を送信
        </Button>
      )}

      {/* Answer Status */}
      {isAnswered && attempt && (
        <Card
          className={`border-2 p-5 shadow-sm transition-all ${
            attempt.isCorrect
              ? "border-success/50 bg-success/10"
              : attempt.isCorrect === false
                ? "border-destructive/50 bg-destructive/10"
                : "border-muted bg-muted/30"
          }`}
        >
          <div className="flex items-center gap-3">
            {attempt.isCorrect ? (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success shadow-sm">
                  <CheckCircle2Icon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <span className="text-lg font-semibold text-success">正解です！</span>
                  {question.answer_choice_ids && question.answer_choice_ids.length > 0 && (
                    <div className="mt-1 text-sm text-success/80">
                      <span className="font-medium">正答:</span> {question.answer_choice_ids.join(", ")}
                    </div>
                  )}
                </div>
              </>
            ) : attempt.isCorrect === false ? (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive shadow-sm">
                  <XCircleIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <span className="text-lg font-semibold text-destructive">不正解です</span>
                  {question.answer_choice_ids && question.answer_choice_ids.length > 0 && (
                    <div className="mt-1 text-sm text-destructive/80">
                      <span className="font-medium">正答:</span> {question.answer_choice_ids.join(", ")}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted shadow-sm">
                  <span className="text-sm font-bold text-muted-foreground">?</span>
                </div>
                <span className="text-base font-medium text-muted-foreground">
                  正誤不明（この問題セットに正答が含まれていません）
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Explanation */}
      {isAnswered && question.explanation && (
        <Card className="border-primary/30 bg-primary/5 shadow-sm">
          <button
            type="button"
            onClick={() => setShowExplanation(!showExplanation)}
            className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-primary/10 rounded-t-lg"
          >
            <span className="font-semibold text-base">解説</span>
            <div className={`transition-transform duration-200 ${showExplanation ? "rotate-180" : ""}`}>
              <ChevronDownIcon className="h-5 w-5 text-muted-foreground" />
            </div>
          </button>
          {showExplanation && (
            <div className="border-t border-primary/20 px-5 pb-5 pt-4 animate-in slide-in-from-top-2 duration-200">
              <p className="whitespace-pre-wrap leading-relaxed text-base text-foreground/90">
                {question.explanation}
              </p>
            </div>
          )}
        </Card>
      )}

    </div>
  );
}

