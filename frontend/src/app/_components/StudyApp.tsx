"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import type { Question, QuestionSet } from "@/lib/questionSet";
import { loadQuestionSetFromJsonText } from "@/lib/questionSet";
import type { Attempt, ProgressState, TrialStatus, LocalTrialInfo } from "@/lib/progress";
import {
  clearProgress,
  emptyProgressState,
  loadProgress,
  saveProgress,
  loadActiveTrialInfo,
  saveActiveTrialInfo,
  loadTrialProgress,
  saveTrialProgress,
  clearTrialProgress,
} from "@/lib/progress";
import {
  apiBaseUrl,
  authHeader,
  exchangeCodeForTokens,
  getCurrentUser,
  isCognitoConfigured,
  storeTokens,
} from "@/lib/awsAuth";
import { listTrials, createTrial, getTrial, updateTrial, completeTrial } from "@/lib/trialApi";
import { QuestionSetGrid } from "@/components/question-set-grid";
import { ExamSidebar } from "@/components/exam-sidebar";
import { QuestionDisplay } from "@/components/question-display";
import { ResultsScreen } from "@/app/_components/ResultsScreen";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, SkipForwardIcon } from "@/components/icons";

const SESSION_LAST_QSET_JSON_KEY = "exam-sim:lastQuestionSetJson";

type AuthUser = { id: string; email: string | null; idToken: string | null };

type TrialInfo = {
  trialId: string;
  trialNumber: number; // kept for internal use
  status: TrialStatus;
  startedAt: string;
};

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
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [qset, setQset] = useState<QuestionSet | null>(null);

  const [progress, setProgress] = useState<ProgressState>(emptyProgressState());
  const [view, setView] = useState<"exam" | "results">("exam");
  const isLoadingRemoteRef = useRef(false);
  const skipNextRemoteSaveRef = useRef(false);

  // Trial state
  const [trialInfo, setTrialInfo] = useState<TrialInfo | null>(null);
  const isReadOnly = trialInfo?.status === "completed";

  const userId = authUser?.id ?? "local";

  // Load question set from sessionStorage after hydration to avoid hydration mismatch
  useEffect(() => {
    queueMicrotask(() => {
      const savedJson = window.sessionStorage.getItem(SESSION_LAST_QSET_JSON_KEY);
      if (!savedJson || !savedJson.trim()) return;
      try {
        const loaded = loadQuestionSetFromJsonText(savedJson);
        setQset(loaded);
      } catch {
        // If we can't restore, clear the session to avoid failing every reload.
        window.sessionStorage.removeItem(SESSION_LAST_QSET_JSON_KEY);
      }
    });
  }, []);

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

  useEffect(() => {
    // Avoid hydration mismatch by reading localStorage after hydration.
    queueMicrotask(() => {
      const u = getCurrentUser();
      setAuthUser(u ? { id: u.sub, email: u.email, idToken: null } : null);
    });
  }, []);

  // Load progress whenever user/set changes
  useEffect(() => {
    if (!qset) return;

    // Check for local active trial first
    const localTrialInfo = loadActiveTrialInfo({ userId, setId: qset.set_id });

    if (localTrialInfo) {
      // Load trial progress from localStorage
      const trialProgress = loadTrialProgress({ userId, setId: qset.set_id, trialId: localTrialInfo.trialId });
      const normalized = normalizeProgressForSet(qset, trialProgress);

      queueMicrotask(() => {
        setTrialInfo({
          trialId: localTrialInfo.trialId,
          trialNumber: localTrialInfo.trialNumber,
          status: localTrialInfo.status,
          startedAt: localTrialInfo.startedAt,
        });
        setProgress(normalized);
        setView("exam");
      });
    } else {
      // Fall back to legacy progress format
      const local = normalizeProgressForSet(qset, loadProgress({ userId, setId: qset.set_id }));

      queueMicrotask(() => {
        setTrialInfo(null);
        setProgress(local);
        setView("exam");
      });
    }

    const base = apiBaseUrl();
    if (!base) {
      isLoadingRemoteRef.current = false;
      return;
    }
    if (userId === "local") {
      isLoadingRemoteRef.current = false;
      return;
    }

    // Mark that we're loading from remote to prevent premature saves
    isLoadingRemoteRef.current = true;

    // Check for remote trials
    (async () => {
      try {
        const trialsRes = await listTrials(qset.set_id);

        if (trialsRes.activeTrialId) {
          // Load the active trial
          const trialRes = await getTrial(qset.set_id, trialsRes.activeTrialId);
          const remoteState = trialRes.state ?? emptyProgressState();

          // Compare with local
          const localInfo = loadActiveTrialInfo({ userId, setId: qset.set_id });
          const localState = localInfo?.trialId === trialsRes.activeTrialId
            ? loadTrialProgress({ userId, setId: qset.set_id, trialId: trialsRes.activeTrialId })
            : emptyProgressState();

          const localTime = new Date(localState.updatedAt || 0).getTime();
          const remoteTime = new Date(remoteState.updatedAt || 0).getTime();
          const merged = remoteTime > localTime ? remoteState : localState;

          setTrialInfo({
            trialId: trialsRes.activeTrialId,
            trialNumber: trialRes.trialNumber,
            status: trialRes.status,
            startedAt: trialRes.startedAt,
          });
          setProgress(normalizeProgressForSet(qset, merged));

          // Save to local storage
          saveActiveTrialInfo({
            userId,
            setId: qset.set_id,
            info: {
              trialId: trialsRes.activeTrialId,
              trialNumber: trialRes.trialNumber,
              status: trialRes.status,
              startedAt: trialRes.startedAt,
            },
          });
          saveTrialProgress({
            userId,
            setId: qset.set_id,
            trialId: trialsRes.activeTrialId,
            state: merged,
          });

          isLoadingRemoteRef.current = false;
          return;
        }

        // No active trial on server, try legacy format
        const url = `${base.replace(/\/$/, "")}/progress?setId=${encodeURIComponent(qset.set_id)}`;
        const res = await fetch(url, { headers: { ...(await authHeader()) } });
        if (!res.ok) {
          isLoadingRemoteRef.current = false;
          return;
        }
        const remote = (await res.json()) as {
          state?: ProgressState | null;
          trialId?: string;
          trialNumber?: number;
          trialStatus?: TrialStatus;
        };
        const remoteState = remote?.state ?? null;
        if (!remoteState) {
          isLoadingRemoteRef.current = false;
          return;
        }

        // If server returned trial info, use it
        if (remote.trialId) {
          setTrialInfo({
            trialId: remote.trialId,
            trialNumber: remote.trialNumber ?? 1,
            status: remote.trialStatus ?? "in_progress",
            startedAt: (remote as { startedAt?: string }).startedAt ?? new Date().toISOString(),
          });
        }

        // Compare timestamps
        const localInfo = loadActiveTrialInfo({ userId, setId: qset.set_id });
        const localProgress = localInfo
          ? loadTrialProgress({ userId, setId: qset.set_id, trialId: localInfo.trialId })
          : loadProgress({ userId, setId: qset.set_id });

        const localTime = new Date(localProgress.updatedAt || 0).getTime();
        const remoteTime = new Date(remoteState.updatedAt || 0).getTime();
        const merged = remoteTime > localTime ? remoteState : localProgress;

        setProgress(normalizeProgressForSet(qset, merged));
        isLoadingRemoteRef.current = false;
      } catch {
        isLoadingRemoteRef.current = false;
      }
    })();
  }, [userId, qset]);

  // Persist progress
  useEffect(() => {
    if (!qset) return;

    // Save to localStorage
    if (trialInfo) {
      saveTrialProgress({ userId, setId: qset.set_id, trialId: trialInfo.trialId, state: progress });
    } else {
      saveProgress({ userId, setId: qset.set_id, state: progress });
    }

    const base = apiBaseUrl();
    if (!base) return;
    if (userId === "local") return;

    // Don't save to remote while loading from remote to avoid race conditions
    if (isLoadingRemoteRef.current) return;
    if (skipNextRemoteSaveRef.current) {
      skipNextRemoteSaveRef.current = false;
      return;
    }

    // Don't save if read-only (completed trial)
    if (isReadOnly) return;

    (async () => {
      try {
        if (trialInfo) {
          // Update trial via new API
          await updateTrial(trialInfo.trialId, { setId: qset.set_id, state: progress });
        } else {
          // Use legacy API
          const url = `${base.replace(/\/$/, "")}/progress`;
          await fetch(url, {
            method: "PUT",
            headers: { "content-type": "application/json", ...(await authHeader()) },
            body: JSON.stringify({ setId: qset.set_id, state: progress }),
          });
        }
      } catch {
        // ignore
      }
    })();
  }, [progress, userId, qset, trialInfo, isReadOnly]);

  const current = useMemo(() => {
    if (!qset) return null;
    const idx = clamp(progress.currentIndex ?? 0, 0, qset.questions.length - 1);
    return { index: idx, question: qset.questions[idx] };
  }, [qset, progress.currentIndex]);

  function handleSetSelected(set: QuestionSet, existingTrialInfo?: TrialInfo) {
    window.sessionStorage.setItem(SESSION_LAST_QSET_JSON_KEY, JSON.stringify(set));
    setQset(set);
    if (existingTrialInfo) {
      setTrialInfo(existingTrialInfo);
    }
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
    if (!current || isReadOnly) return;
    setProgress((prev) => upsertAttempt(prev, current.question.id, { flagged }));
  }

  function onChangeNote(noteText: string) {
    if (!current || isReadOnly) return;
    const note = noteText.trim() ? noteText : "";
    setProgress((prev) => upsertAttempt(prev, current.question.id, { note: note ? note : null }));
  }

  function onAnswer(selectedChoiceIds: string[]) {
    if (!current || isReadOnly) return;
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
    if (!current || isReadOnly) return;
    setProgress((prev) =>
      upsertAttempt(prev, current.question.id, {
        selectedChoiceIds: null,
        isCorrect: null,
        answeredAt: null,
      })
    );
  }

  async function onClearProgress() {
    if (!qset) return;
    if (isReadOnly) return;

    if (confirm("進捗をリセットしてもよろしいですか？この操作は取り消せません。")) {
      if (trialInfo) {
        clearTrialProgress({ userId, setId: qset.set_id, trialId: trialInfo.trialId });
        saveActiveTrialInfo({ userId, setId: qset.set_id, info: null });
        setTrialInfo(null);
      }

      clearProgress({ userId, setId: qset.set_id });
      skipNextRemoteSaveRef.current = true;
      setProgress(emptyProgressState());

      const base = apiBaseUrl();
      if (!base) return;
      if (userId === "local") return;

      const url = `${base.replace(/\/$/, "")}/progress?setId=${encodeURIComponent(qset.set_id)}`;
      try {
        await fetch(url, { method: "DELETE", headers: { ...(await authHeader()) } });
      } catch {
        // ignore
      }
    }
  }

  function onBackToHome() {
    if (confirm("ホームに戻りますか？進捗は保存されます。")) {
      window.sessionStorage.removeItem(SESSION_LAST_QSET_JSON_KEY);
      setQset(null);
      setProgress(emptyProgressState());
      setTrialInfo(null);
      setView("exam");
    }
  }

  async function onCompleteTrial() {
    if (!qset || !trialInfo) return;
    if (trialInfo.status === "completed") return;

    const totalQuestions = qset.questions.length;

    if (confirm(`受験開始日 ${formatTrialDate(trialInfo.startedAt)} のトライアルを完了しますか？完了後は変更できなくなります。`)) {
      const base = apiBaseUrl();
      if (base && userId !== "local") {
        try {
          await completeTrial(trialInfo.trialId, { setId: qset.set_id, totalQuestions });
        } catch {
          // ignore remote error
        }
      }

      // Update local state
      saveActiveTrialInfo({ userId, setId: qset.set_id, info: null });
      setTrialInfo({ ...trialInfo, status: "completed" });
    }
  }

  async function onStartNewTrial() {
    if (!qset) return;

    const base = apiBaseUrl();
    const totalQuestions = qset.questions.length;
    const now = new Date().toISOString();

    let newTrialId = now;
    let newTrialNumber = (trialInfo?.trialNumber ?? 0) + 1;

    if (base && userId !== "local") {
      try {
        const res = await createTrial({ setId: qset.set_id, totalQuestions });
        newTrialId = res.trialId;
        newTrialNumber = res.trialNumber;
      } catch (e) {
        // Check if it's an active trial exists error
        const msg = e instanceof Error ? e.message : "";
        if (msg.startsWith("active_trial_exists:")) {
          alert("進行中のトライアルがあります。先にそれを完了させてください。");
          return;
        }
        // For other errors, continue with local-only creation
      }
    }

    const newState = emptyProgressState();
    const newInfo: LocalTrialInfo = {
      trialId: newTrialId,
      trialNumber: newTrialNumber,
      status: "in_progress",
      startedAt: now,
    };

    saveActiveTrialInfo({ userId, setId: qset.set_id, info: newInfo });
    saveTrialProgress({ userId, setId: qset.set_id, trialId: newTrialId, state: newState });

    setTrialInfo({
      trialId: newTrialId,
      trialNumber: newTrialNumber,
      status: "in_progress",
      startedAt: now,
    });
    setProgress(newState);
    setView("exam");
  }

  if (!qset) {
    return <QuestionSetGrid onSetSelected={handleSetSelected} />;
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
      <aside className="hidden w-80 border-r border-sidebar-border lg:block shadow-sm">
        <ExamSidebar
          questionSet={qset}
          progress={progress}
          currentQuestionIndex={current.index}
          trialStartedAt={trialInfo?.startedAt ?? null}
          isReadOnly={isReadOnly}
          onQuestionSelect={gotoIndex}
          onReset={onClearProgress}
          onBackToHome={onBackToHome}
        />
      </aside>

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border bg-card shadow-sm">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-4">
            <div className="min-w-0 flex items-center gap-3">
              <div className="truncate text-sm text-muted-foreground">
                {authUser ? `ログイン中: ${authUser.email ?? authUser.id}` : "ゲスト（未ログイン）"}
              </div>
              {trialInfo && (
                <div className={`text-xs px-2 py-1 rounded-full ${
                  trialInfo.status === "completed"
                    ? "bg-success/10 text-success"
                    : "bg-primary/10 text-primary"
                }`}>
                  受験開始: {formatTrialDate(trialInfo.startedAt)}
                  {trialInfo.status === "completed" && " (閲覧のみ)"}
                </div>
              )}
            </div>
            <Link href="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              アカウント
            </Link>
          </div>
        </div>

        {/* Read-only banner */}
        {isReadOnly && (
          <div className="bg-warning/10 border-b border-warning/30 px-6 py-2">
            <div className="mx-auto max-w-3xl text-sm text-warning text-center">
              このトライアルは完了済みです。閲覧のみ可能です。
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          {view === "exam" ? (
            <div className="mx-auto max-w-3xl px-6 py-10">
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
                isReadOnly={isReadOnly}
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
              trialStartedAt={trialInfo?.startedAt ?? null}
              trialStatus={trialInfo?.status ?? null}
              onBackToExam={() => setView("exam")}
              onBackToHome={onBackToHome}
              onCompleteTrial={onCompleteTrial}
              onStartNewTrial={onStartNewTrial}
            />
          )}
        </div>

        {/* Navigation Bar */}
        {view === "exam" && (
          <div className="border-t border-border bg-card shadow-lg p-5">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
              <Button
                variant="outline"
                onClick={() => gotoIndex(current.index - 1)}
                disabled={current.index === 0}
                className="h-11 shadow-sm hover:shadow-md transition-all disabled:opacity-50"
              >
                <ChevronLeftIcon className="mr-2 h-4 w-4" />
                前の問題
              </Button>

              <Button
                variant="outline"
                onClick={gotoFirstUnanswered}
                className="h-11 shadow-sm hover:shadow-md transition-all"
              >
                <SkipForwardIcon className="mr-2 h-4 w-4" />
                未回答へ
              </Button>

              {isLastQuestion ? (
                <Button
                  onClick={onFinish}
                  className="h-11 shadow-md hover:shadow-lg transition-all"
                >
                  解答を終了する
                </Button>
              ) : (
                <Button
                  onClick={() => gotoIndex(current.index + 1)}
                  className="h-11 shadow-md hover:shadow-lg transition-all"
                >
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
