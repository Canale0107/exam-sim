"use client";

import { useEffect, useMemo, useState } from "react";

import type { Question, QuestionSet } from "@/lib/questionSet";
import { loadQuestionSetFromJsonText } from "@/lib/questionSet";
import type { Attempt, ProgressState } from "@/lib/progress";
import { clearProgress, emptyProgressState, loadProgress, saveProgress } from "@/lib/progress";
import { QuestionSetSelector } from "@/components/question-set-selector";
import { ExamSidebar } from "@/components/exam-sidebar";
import { QuestionDisplay } from "@/components/question-display";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeftIcon, ChevronRightIcon, SkipForwardIcon } from "@/components/icons";

const SESSION_USER_ID_KEY = "exam-sim:userId";
const SESSION_LAST_QSET_JSON_KEY = "exam-sim:lastQuestionSetJson";

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function hasAnswered(a: Attempt | undefined): boolean {
  return Boolean(a?.selectedChoiceIds && a.selectedChoiceIds.length > 0);
}

function setEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  if (sa.size !== b.length) return false;
  return b.every((x) => sa.has(x));
}

function computeIsCorrect(q: Question, selectedChoiceIds: string[]): boolean | null {
  const answerIds = q.answer_choice_ids ?? null;
  if (!answerIds || answerIds.length === 0) return null;
  return setEq([...answerIds], [...selectedChoiceIds]);
}

function normalizeProgressForSet(qset: QuestionSet, state: ProgressState): ProgressState {
  const maxIndex = Math.max(0, qset.questions.length - 1);
  const currentIndex = clamp(state.currentIndex ?? 0, 0, maxIndex);
  return {
    ...state,
    currentIndex,
    attemptsByQuestionId: state.attemptsByQuestionId ?? {},
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
  };
}

function upsertAttempt(
  prev: ProgressState,
  questionId: string,
  patch: Partial<Attempt>,
): ProgressState {
  const existing = prev.attemptsByQuestionId[questionId];
  const base: Attempt =
    existing ?? ({
      questionId,
      selectedChoiceIds: null,
      isCorrect: null,
      flagged: false,
      note: null,
      answeredAt: null,
    } satisfies Attempt);
  const nextAttempt: Attempt = { ...base, ...patch, questionId };
  return {
    ...prev,
    attemptsByQuestionId: {
      ...prev.attemptsByQuestionId,
      [questionId]: nextAttempt,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function StudyApp() {
  const [userId, setUserId] = useState<string>("local");
  const [qset, setQset] = useState<QuestionSet | null>(null);
  const [qsetError, setQsetError] = useState<string | null>(null);

  const [progress, setProgress] = useState<ProgressState>(emptyProgressState());

  // Restore userId + last loaded set (session only)
  useEffect(() => {
    const savedUser = window.sessionStorage.getItem(SESSION_USER_ID_KEY);
    if (savedUser && savedUser.trim()) setUserId(savedUser.trim());

    const savedJson = window.sessionStorage.getItem(SESSION_LAST_QSET_JSON_KEY);
    if (savedJson && savedJson.trim()) {
      try {
        const loaded = loadQuestionSetFromJsonText(savedJson);
        setQset(loaded);
        setQsetError(null);
      } catch (e) {
        setQset(null);
        setQsetError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(SESSION_USER_ID_KEY, userId);
  }, [userId]);

  // Load progress whenever user/set changes
  useEffect(() => {
    if (!qset) return;
    const loaded = loadProgress({ userId, setId: qset.set_id });
    setProgress(normalizeProgressForSet(qset, loaded));
  }, [userId, qset?.set_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist progress
  useEffect(() => {
    if (!qset) return;
    saveProgress({ userId, setId: qset.set_id, state: progress });
  }, [progress, userId, qset]);

  const current = useMemo(() => {
    if (!qset) return null;
    const idx = clamp(progress.currentIndex ?? 0, 0, qset.questions.length - 1);
    return { index: idx, question: qset.questions[idx] };
  }, [qset, progress.currentIndex]);

  async function loadSample() {
    try {
      const res = await fetch("/examples/questions.sample.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`failed to fetch sample: ${res.status}`);
      const text = await res.text();
      const loaded = loadQuestionSetFromJsonText(text);
      window.sessionStorage.setItem(SESSION_LAST_QSET_JSON_KEY, text);
      setQset(loaded);
      setQsetError(null);
    } catch (e) {
      setQset(null);
      setQsetError(e instanceof Error ? e.message : String(e));
    }
  }

  function onUploadFile(file: File) {
    const reader = new FileReader();
    reader.onerror = () => setQsetError("failed to read file");
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const loaded = loadQuestionSetFromJsonText(text);
        window.sessionStorage.setItem(SESSION_LAST_QSET_JSON_KEY, text);
        setQset(loaded);
        setQsetError(null);
      } catch (e) {
        setQset(null);
        setQsetError(e instanceof Error ? e.message : String(e));
      }
    };
    reader.readAsText(file);
  }

  function handleSetSelected(set: QuestionSet) {
    window.sessionStorage.setItem(SESSION_LAST_QSET_JSON_KEY, JSON.stringify(set));
    setQset(set);
    setQsetError(null);
  }

  function gotoIndex(nextIndex: number) {
    if (!qset) return;
    setProgress((prev) => ({ ...prev, currentIndex: clamp(nextIndex, 0, qset.questions.length - 1) }));
  }

  function gotoFirstUnanswered() {
    if (!qset) return;
    const idx = qset.questions.findIndex(
      (q) => !hasAnswered(progress.attemptsByQuestionId[q.id])
    );
    if (idx >= 0) gotoIndex(idx);
  }

  function onToggleFlagged(flagged: boolean) {
    if (!current) return;
    setProgress((prev) => upsertAttempt(prev, current.question.id, { flagged }));
  }

  function onChangeNote(noteText: string) {
    if (!current) return;
    const note = noteText.trim() ? noteText : "";
    setProgress((prev) => upsertAttempt(prev, current.question.id, { note: note ? note : null }));
  }

  function onAnswer(selectedChoiceIds: string[]) {
    if (!current) return;
    if (!selectedChoiceIds.length) return;
    const q = current.question;
    const isCorrect = computeIsCorrect(q, selectedChoiceIds);
    setProgress((prev) =>
      upsertAttempt(prev, q.id, {
        selectedChoiceIds,
        isCorrect,
        answeredAt: new Date().toISOString(),
      })
    );
  }

  function onResetToUnanswered() {
    if (!current) return;
    setProgress((prev) =>
      upsertAttempt(prev, current.question.id, {
        selectedChoiceIds: null,
        isCorrect: null,
        answeredAt: null,
      })
    );
  }

  function onClearProgress() {
    if (!qset) return;
    if (confirm("進捗をリセットしてもよろしいですか？この操作は取り消せません。")) {
      clearProgress({ userId, setId: qset.set_id });
      setProgress(emptyProgressState());
    }
  }

  function onBackToHome() {
    if (confirm("ホームに戻りますか？進捗は保存されます。")) {
      window.sessionStorage.removeItem(SESSION_LAST_QSET_JSON_KEY);
      setQset(null);
      setProgress(emptyProgressState());
    }
  }

  if (!qset) {
    return <QuestionSetSelector onSetSelected={handleSetSelected} />;
  }

  if (!current) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm">No questions.</div>
      </div>
    );
  }

  const currentAttempt = progress.attemptsByQuestionId[current.question.id];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="hidden w-80 border-r border-sidebar-border lg:block">
        <ExamSidebar
          questionSet={qset}
          progress={progress}
          currentQuestionIndex={current.index}
          onQuestionSelect={gotoIndex}
          onReset={onClearProgress}
          onBackToHome={onBackToHome}
        />
      </aside>

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <QuestionDisplay
              question={current.question}
              questionNumber={current.index + 1}
              totalQuestions={qset.questions.length}
              attempt={currentAttempt}
              onAnswerSubmit={onAnswer}
              onFlagToggle={onToggleFlagged}
              onNoteChange={onChangeNote}
              onResetAnswer={onResetToUnanswered}
            />
          </div>
        </div>

        {/* Navigation Bar */}
        <div className="border-t border-border bg-card p-4">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={() => gotoIndex(current.index - 1)}
              disabled={current.index === 0}
            >
              <ChevronLeftIcon className="mr-2 h-4 w-4" />
              前の問題
            </Button>

            <Button variant="outline" onClick={gotoFirstUnanswered}>
              <SkipForwardIcon className="mr-2 h-4 w-4" />
              未回答へ
            </Button>

            <Button
              onClick={() => gotoIndex(current.index + 1)}
              disabled={!qset || current.index >= qset.questions.length - 1}
            >
              次の問題
              <ChevronRightIcon className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </main>

      {/* Mobile Stats (visible only on small screens) */}
      <div className="lg:hidden">
        <Card className="fixed bottom-20 right-4 p-4 shadow-lg">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">進捗</p>
            <p className="text-lg font-semibold">
              {Object.keys(progress.attemptsByQuestionId).filter(
                (qId) => hasAnswered(progress.attemptsByQuestionId[qId])
              ).length}
              /{qset.questions.length}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
