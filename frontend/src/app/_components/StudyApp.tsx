"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { Question, QuestionSet } from "@/lib/questionSet";
import { loadQuestionSetFromJsonText } from "@/lib/questionSet";
import type { Attempt, ProgressState } from "@/lib/progress";
import { clearProgress, emptyProgressState, loadProgress, saveProgress } from "@/lib/progress";
import {
  apiBaseUrl,
  authHeader,
  exchangeCodeForTokens,
  getCurrentUser,
  isCognitoConfigured,
  storeTokens,
} from "@/lib/awsAuth";
import { QuestionSetSelector } from "@/components/question-set-selector";
import { ExamSidebar } from "@/components/exam-sidebar";
import { QuestionDisplay } from "@/components/question-display";
import { ResultsScreen } from "@/app/_components/ResultsScreen";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, SkipForwardIcon } from "@/components/icons";

const SESSION_LAST_QSET_JSON_KEY = "exam-sim:lastQuestionSetJson";

type AuthUser = { id: string; email: string | null; idToken: string | null };

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
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    const u = getCurrentUser();
    return u ? { id: u.sub, email: u.email, idToken: null } : null;
  });
  const [qset, setQset] = useState<QuestionSet | null>(() => {
    if (typeof window === "undefined") return null;
    const savedJson = window.sessionStorage.getItem(SESSION_LAST_QSET_JSON_KEY);
    if (!savedJson || !savedJson.trim()) return null;
    try {
      return loadQuestionSetFromJsonText(savedJson);
    } catch {
      // If we can't restore, clear the session to avoid failing every reload.
      window.sessionStorage.removeItem(SESSION_LAST_QSET_JSON_KEY);
      return null;
    }
  });

  const [progress, setProgress] = useState<ProgressState>(emptyProgressState());
  const [view, setView] = useState<"exam" | "results">("exam");

  const userId = authUser?.id ?? "local";

  useEffect(() => {
    // Handle Cognito hosted UI callback on "/?code=..."
    if (!isCognitoConfigured()) return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    if (error) {
      // Clear error params so we don't loop.
      params.delete("error");
      params.delete("error_description");
      window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }

    if (code) {
      exchangeCodeForTokens(code)
        .then((t) => {
          storeTokens(t);
          const u = getCurrentUser();
          setAuthUser(u ? { id: u.sub, email: u.email, idToken: t.id_token } : null);
        })
        .finally(() => {
          params.delete("code");
          params.delete("state");
          window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
        });
    }
  }, []);

  // Load progress whenever user/set changes
  useEffect(() => {
    if (!qset) return;
    const local = normalizeProgressForSet(qset, loadProgress({ userId, setId: qset.set_id }));
    queueMicrotask(() => {
      setProgress(local);
      setView("exam");
    });

    const base = apiBaseUrl();
    if (!base) return;
    if (userId === "local") return;

    const url = `${base.replace(/\/$/, "")}/progress?setId=${encodeURIComponent(qset.set_id)}`;
    fetch(url, { headers: { ...authHeader() } })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { state?: ProgressState | null };
      })
      .then((remote) => {
        const remoteState = remote?.state ?? null;
        if (!remoteState) return;
        const merged =
          String(remoteState.updatedAt ?? "") > String(local.updatedAt ?? "") ? remoteState : local;
        setProgress(normalizeProgressForSet(qset, merged));
      })
      .catch(() => {
        // ignore
      });
  }, [userId, qset]);

  // Persist progress
  useEffect(() => {
    if (!qset) return;
    saveProgress({ userId, setId: qset.set_id, state: progress });

    const base = apiBaseUrl();
    if (!base) return;
    if (userId === "local") return;
    const url = `${base.replace(/\/$/, "")}/progress`;
    fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({ setId: qset.set_id, state: progress }),
    }).catch(() => {
      // ignore
    });
  }, [progress, userId, qset]);

  const current = useMemo(() => {
    if (!qset) return null;
    const idx = clamp(progress.currentIndex ?? 0, 0, qset.questions.length - 1);
    return { index: idx, question: qset.questions[idx] };
  }, [qset, progress.currentIndex]);

  function handleSetSelected(set: QuestionSet) {
    window.sessionStorage.setItem(SESSION_LAST_QSET_JSON_KEY, JSON.stringify(set));
    setQset(set);
  }

  function gotoIndex(nextIndex: number) {
    if (!qset) return;
    setProgress((prev) => ({ ...prev, currentIndex: clamp(nextIndex, 0, qset.questions.length - 1) }));
    setView("exam");
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
      setView("exam");
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

  const totalQuestions = qset.questions.length;
  const answeredQuestions = Object.keys(progress.attemptsByQuestionId).filter((qId) =>
    hasAnswered(progress.attemptsByQuestionId[qId])
  ).length;
  const correctAnswers = Object.values(progress.attemptsByQuestionId).filter((a) => a?.isCorrect === true).length;
  const incorrectAnswers = Object.values(progress.attemptsByQuestionId).filter((a) => a?.isCorrect === false).length;
  const unknownAnswers = Math.max(0, answeredQuestions - correctAnswers - incorrectAnswers);
  const unansweredQuestions = Math.max(0, totalQuestions - answeredQuestions);
  const gradedAnswers = correctAnswers + incorrectAnswers;
  const accuracyRate = gradedAnswers > 0 ? Math.round((correctAnswers / gradedAnswers) * 100) : 0;

  const isLastQuestion = current.index >= totalQuestions - 1;

  function onFinish() {
    if (!qset) return;
    if (unansweredQuestions > 0) {
      const ok = confirm(
        `未回答が ${unansweredQuestions} 問あります。解答を終了して結果を表示しますか？`
      );
      if (!ok) return;
    }
    setView("results");
  }

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
        <div className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-3">
            <div className="min-w-0 truncate text-xs text-muted-foreground">
              {authUser ? `ログイン中: ${authUser.email ?? authUser.id}` : "ゲスト（未ログイン）"}
            </div>
            <Link href="/auth" className="text-xs text-muted-foreground hover:underline">
              アカウント
            </Link>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          {view === "exam" ? (
            <div className="mx-auto max-w-3xl px-6 py-8">
              <QuestionDisplay
                key={current.question.id}
                question={current.question}
                questionNumber={current.index + 1}
                totalQuestions={qset.questions.length}
                answeredQuestions={answeredQuestions}
                correctAnswers={correctAnswers}
                incorrectAnswers={incorrectAnswers}
                unknownAnswers={unknownAnswers}
                accuracyRate={accuracyRate}
                attempt={currentAttempt}
                onAnswerSubmit={onAnswer}
                onFlagToggle={onToggleFlagged}
                onNoteChange={onChangeNote}
                onResetAnswer={onResetToUnanswered}
              />
            </div>
          ) : (
            <ResultsScreen
              title={qset.title}
              totalQuestions={totalQuestions}
              answeredQuestions={answeredQuestions}
              correctAnswers={correctAnswers}
              incorrectAnswers={incorrectAnswers}
              unknownAnswers={unknownAnswers}
              unansweredQuestions={unansweredQuestions}
              accuracyRate={accuracyRate}
              onBackToExam={() => setView("exam")}
              onBackToHome={onBackToHome}
            />
          )}
        </div>

        {/* Navigation Bar */}
        {view === "exam" && (
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

              {isLastQuestion ? (
                <Button onClick={onFinish}>解答を終了する</Button>
              ) : (
                <Button onClick={() => gotoIndex(current.index + 1)}>
                  次の問題
                  <ChevronRightIcon className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
