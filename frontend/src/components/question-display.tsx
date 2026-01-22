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
  attempt?: Attempt;
  onAnswerSubmit: (selectedChoiceIds: string[]) => void;
  onFlagToggle: (flagged: boolean) => void;
  onNoteChange: (note: string) => void;
  onResetAnswer: () => void;
}

export function QuestionDisplay({
  question,
  questionNumber,
  totalQuestions,
  answeredQuestions,
  attempt,
  onAnswerSubmit,
  onFlagToggle,
  onNoteChange,
  onResetAnswer,
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

  const handleChoiceClick = (choiceId: string) => {
    if (isAnswered) return;

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

  const handleReset = () => {
    setSelectedChoiceIds([]);
    onResetAnswer();
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
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>進捗</span>
          <span>
            {answeredQuestions}/{totalQuestions}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Question Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              問題 {questionNumber} / {totalQuestions}
            </span>
            {isMultiple && (
              <span className="rounded-md bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
                複数選択
              </span>
            )}
          </div>
          {/* Note Editor (opened by pencil icon) */}
          {isNoteEditing && (
            <Card className="mb-3 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label htmlFor="note" className="block text-sm font-medium">
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
              />
              <p className="mt-2 text-xs text-muted-foreground">Ctrl+Enter / Cmd+Enter で保存</p>
            </Card>
          )}
          <h2 className="whitespace-pre-wrap text-lg font-medium leading-relaxed">{question.text}</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onFlagToggle(!attempt?.flagged)}
            className={attempt?.flagged ? "text-warning" : ""}
          >
            <FlagIcon className={`h-5 w-5 ${attempt?.flagged ? "fill-current" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={openNoteEditor}
            className={hasSavedNote ? "text-primary" : "text-muted-foreground"}
            aria-label="メモを編集"
          >
            <PencilIcon className="h-5 w-5" />
          </Button>
        </div>
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
              disabled={isAnswered}
              className={`w-full rounded-lg border-2 p-4 text-left transition-all ${
                status === "correct"
                  ? "border-success bg-success/10"
                  : status === "incorrect"
                    ? "border-destructive bg-destructive/10"
                    : isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/50"
              } ${isAnswered ? "cursor-default" : "cursor-pointer"}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                    isMultiple ? "rounded-sm" : "rounded-full"
                  } border-2 ${
                    status === "correct"
                      ? "border-success bg-success"
                      : status === "incorrect"
                        ? "border-destructive bg-destructive"
                        : isSelected
                          ? "border-primary bg-primary"
                          : "border-muted-foreground"
                  }`}
                >
                  {isSelected && status === "default" && (
                    <div className="h-2 w-2 rounded-full bg-white" />
                  )}
                  {status === "correct" && <CheckCircle2Icon className="h-4 w-4 text-white" />}
                  {status === "incorrect" && <XCircleIcon className="h-4 w-4 text-white" />}
                </div>
                <span className="flex-1 leading-relaxed">
                  <span className="font-semibold">{choice.id}</span> {choice.text}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Submit Button */}
      {!isAnswered && (
        <Button onClick={handleSubmit} disabled={selectedChoiceIds.length === 0} className="w-full" size="lg">
          回答を送信
        </Button>
      )}

      {/* Answer Status */}
      {isAnswered && attempt && (
        <Card
          className={`border-2 p-4 ${
            attempt.isCorrect
              ? "border-success bg-success/5"
              : attempt.isCorrect === false
                ? "border-destructive bg-destructive/5"
                : "border-muted"
          }`}
        >
          <div className="flex items-center gap-2">
            {attempt.isCorrect ? (
              <>
                <CheckCircle2Icon className="h-5 w-5 text-success" />
                <span className="font-medium text-success">正解です！</span>
              </>
            ) : attempt.isCorrect === false ? (
              <>
                <XCircleIcon className="h-5 w-5 text-destructive" />
                <span className="font-medium text-destructive">不正解です</span>
              </>
            ) : (
              <span className="font-medium text-muted-foreground">正誤不明（この問題セットに正答が含まれていません）</span>
            )}
          </div>
          {question.answer_choice_ids && question.answer_choice_ids.length > 0 && (
            <div className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium">正答:</span> {question.answer_choice_ids.join(", ")}
            </div>
          )}
        </Card>
      )}

      {/* Explanation */}
      {isAnswered && question.explanation && (
        <Card className="border-primary/20 bg-primary/5">
          <button
            type="button"
            onClick={() => setShowExplanation(!showExplanation)}
            className="flex w-full items-center justify-between p-4 text-left"
          >
            <span className="font-medium">解説</span>
            {showExplanation ? (
              <ChevronUpIcon className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDownIcon className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
          {showExplanation && (
            <div className="border-t border-border px-4 pb-4 pt-3">
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {question.explanation}
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Reset Button */}
      {isAnswered && (
        <Button variant="outline" onClick={handleReset} className="w-full bg-transparent">
          未回答に戻す
        </Button>
      )}
    </div>
  );
}

