"use client";

import { useEffect, useMemo, useState } from "react";

import type { Question, QuestionSet } from "@/lib/questionSet";
import { loadQuestionSetFromJsonText } from "@/lib/questionSet";
import type { Attempt, ProgressState } from "@/lib/progress";
import { clearProgress, emptyProgressState, loadProgress, saveProgress } from "@/lib/progress";

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

  const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>([]);

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

  const summary = useMemo(() => {
    if (!qset) return { answered: 0, correct: 0, unknown: 0, total: 0 };
    let answered = 0;
    let correct = 0;
    let unknown = 0;
    for (const q of qset.questions) {
      const a = progress.attemptsByQuestionId[q.id];
      if (!hasAnswered(a)) continue;
      answered += 1;
      if (a.isCorrect === true) correct += 1;
      else if (a.isCorrect === null) unknown += 1;
    }
    return { answered, correct, unknown, total: qset.questions.length };
  }, [qset, progress]);

  const current = useMemo(() => {
    if (!qset) return null;
    const idx = clamp(progress.currentIndex ?? 0, 0, qset.questions.length - 1);
    return { index: idx, question: qset.questions[idx] };
  }, [qset, progress.currentIndex]);

  // Keep draft selection in sync with current question + stored attempt
  useEffect(() => {
    if (!current) return;
    const attempt = progress.attemptsByQuestionId[current.question.id];
    const ids = attempt?.selectedChoiceIds ?? [];
    setDraftSelectedIds(Array.isArray(ids) ? ids : []);
  }, [current?.question.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSample() {
    try {
      const res = await fetch("/examples/sample.questions.json", { cache: "no-store" });
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

  function gotoIndex(nextIndex: number) {
    if (!qset) return;
    setProgress((prev) => ({ ...prev, currentIndex: clamp(nextIndex, 0, qset.questions.length - 1) }));
  }

  function gotoFirstUnanswered() {
    if (!qset) return;
    const idx = qset.questions.findIndex((q) => !hasAnswered(progress.attemptsByQuestionId[q.id]));
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

  function onAnswer() {
    if (!current) return;
    const selected = draftSelectedIds;
    if (!selected.length) return;
    const q = current.question;
    const isCorrect = computeIsCorrect(q, selected);
    setProgress((prev) =>
      upsertAttempt(prev, q.id, {
        selectedChoiceIds: selected,
        isCorrect,
        answeredAt: new Date().toISOString(),
      }),
    );
  }

  function onResetToUnanswered() {
    if (!current) return;
    setDraftSelectedIds([]);
    setProgress((prev) =>
      upsertAttempt(prev, current.question.id, {
        selectedChoiceIds: null,
        isCorrect: null,
        answeredAt: null,
      }),
    );
  }

  function onClearProgress() {
    if (!qset) return;
    clearProgress({ userId, setId: qset.set_id });
    setProgress(emptyProgressState());
    setDraftSelectedIds([]);
  }

  const isMulti =
    current?.question.is_multi_select ??
    Boolean((current?.question.answer_choice_ids?.length ?? 0) > 1);
  const currentAttempt = current ? progress.attemptsByQuestionId[current.question.id] : undefined;

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[320px_1fr]">
        <aside className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/15 dark:bg-zinc-950">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">study (BYOS)</div>
              <div className="text-lg font-semibold">模試アプリ</div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-medium">ユーザーID（ローカル）</label>
              <input
                className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-300 dark:border-white/15 dark:bg-zinc-950 dark:focus:ring-zinc-700"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="local"
              />
            </div>

            <div className="rounded-xl border border-dashed border-black/15 p-3 dark:border-white/20">
              <div className="text-sm font-medium">問題セット（JSON / BYOS）</div>
              <div className="mt-2 flex flex-col gap-2">
                <input
                  type="file"
                  accept="application/json,.json"
                  className="block w-full text-sm"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadFile(f);
                    e.currentTarget.value = "";
                  }}
                />
                <button
                  className="h-9 rounded-lg border border-black/10 bg-white text-sm font-medium hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  onClick={loadSample}
                  type="button"
                >
                  サンプルを読み込む
                </button>
              </div>
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                問題本文はサーバに保存せず、ブラウザで読み込みます。
              </div>
            </div>

            {qsetError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-200">
                <div className="font-medium">読み込みエラー</div>
                <div className="mt-1 whitespace-pre-wrap">{qsetError}</div>
              </div>
            ) : null}

            {qset ? (
              <div className="space-y-2 rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-950">
                <div className="text-sm font-medium">セット情報</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  <div>
                    <span className="font-medium text-zinc-950 dark:text-zinc-50">set_id:</span> {qset.set_id}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-950 dark:text-zinc-50">title:</span> {qset.title}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-950 dark:text-zinc-50">questions:</span>{" "}
                    {qset.questions.length}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-950">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">進捗</div>
                <div className="text-lg font-semibold">
                  {summary.answered}/{summary.total}
                </div>
              </div>
              <div className="rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-950">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">正解数</div>
                <div className="text-lg font-semibold">{summary.correct}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-950">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">正誤不明</div>
                <div className="text-lg font-semibold">{summary.unknown}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-950">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">正答率</div>
                <div className="text-lg font-semibold">
                  {summary.answered ? `${((summary.correct / summary.answered) * 100).toFixed(1)}%` : "—"}
                </div>
              </div>
            </div>

            <button
              className="h-9 w-full rounded-lg border border-black/10 bg-white text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              onClick={onClearProgress}
              disabled={!qset}
              type="button"
            >
              進捗をリセット（このset_id + userId）
            </button>
          </div>
        </aside>

        <main className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/15 dark:bg-zinc-950">
          {!qset ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <div className="max-w-md text-center">
                <div className="text-lg font-semibold">問題セットJSONを読み込んでください</div>
                <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  例: <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">questions.json</code>
                </div>
              </div>
            </div>
          ) : !current ? (
            <div className="text-sm">No questions.</div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {qset.title} / Q {current.index + 1} / {qset.questions.length}{" "}
                <span className="text-xs">(id={current.question.id})</span>
              </div>

              <div className="rounded-xl border border-black/10 bg-zinc-50 p-3 dark:border-white/15 dark:bg-black">
                <div className="whitespace-pre-wrap text-base leading-7">{current.question.text}</div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">
                  回答を選択（{isMulti ? "複数選択" : "単一選択"}）
                </div>

                {isMulti ? (
                  <div className="space-y-2">
                    {current.question.choices.map((c) => {
                      const checked = draftSelectedIds.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 bg-white p-3 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? Array.from(new Set([...draftSelectedIds, c.id]))
                                : draftSelectedIds.filter((x) => x !== c.id);
                              setDraftSelectedIds(next);
                            }}
                          />
                          <div className="text-sm leading-6">
                            <span className="font-semibold">{c.id}</span> {c.text}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {current.question.choices.map((c) => {
                      const checked = draftSelectedIds[0] === c.id;
                      return (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 bg-white p-3 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                        >
                          <input
                            type="radio"
                            name={`q-${current.question.id}`}
                            className="mt-1"
                            checked={checked}
                            onChange={() => setDraftSelectedIds([c.id])}
                          />
                          <div className="text-sm leading-6">
                            <span className="font-semibold">{c.id}</span> {c.text}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {(() => {
                const answered = hasAnswered(currentAttempt);
                if (!answered) return null;
                if (currentAttempt?.isCorrect === true) {
                  return (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200">
                      正解
                    </div>
                  );
                }
                if (currentAttempt?.isCorrect === false) {
                  return (
                    <div className="rounded-xl border border-red-500/30 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-200">
                      不正解
                    </div>
                  );
                }
                return (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-950/40 dark:text-blue-200">
                    正誤不明（この問題セットに正答が含まれていません）
                  </div>
                );
              })()}

              {(() => {
                if (!hasAnswered(currentAttempt)) return null;
                const ans = current.question.answer_choice_ids ?? null;
                if (!ans || !ans.length) return null;
                return (
                  <div className="text-sm text-zinc-700 dark:text-zinc-300">
                    <span className="font-medium">正答:</span> {ans.join(", ")}
                  </div>
                );
              })()}

              {current.question.explanation ? (
                <details className="rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-950">
                  <summary className="cursor-pointer text-sm font-medium">解説（問題セットに含まれる場合）</summary>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                    {current.question.explanation}
                  </div>
                </details>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr]">
                <label className="flex items-center gap-2 rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-950">
                  <input
                    type="checkbox"
                    checked={Boolean(currentAttempt?.flagged)}
                    onChange={(e) => onToggleFlagged(e.target.checked)}
                  />
                  <span className="text-sm">見直しフラグ</span>
                </label>
                <div className="rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-950">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">メモ（任意）</div>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-300 dark:border-white/15 dark:bg-zinc-950 dark:focus:ring-zinc-700"
                    value={currentAttempt?.note ?? ""}
                    onChange={(e) => onChangeNote(e.target.value)}
                    placeholder="メモ..."
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                  onClick={onAnswer}
                  disabled={draftSelectedIds.length === 0}
                  type="button"
                >
                  回答
                </button>
                <button
                  className="h-10 rounded-lg border border-black/10 bg-white px-4 text-sm font-medium hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  onClick={onResetToUnanswered}
                  type="button"
                >
                  未回答に戻す
                </button>

                <div className="flex-1" />

                <button
                  className="h-10 rounded-lg border border-black/10 bg-white px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  onClick={() => gotoIndex(current.index - 1)}
                  disabled={current.index === 0}
                  type="button"
                >
                  ← 前へ
                </button>
                <button
                  className="h-10 rounded-lg border border-black/10 bg-white px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  onClick={() => gotoIndex(current.index + 1)}
                  disabled={!qset || current.index >= qset.questions.length - 1}
                  type="button"
                >
                  次へ →
                </button>
                <button
                  className="h-10 rounded-lg border border-black/10 bg-white px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  onClick={gotoFirstUnanswered}
                  disabled={!qset}
                  type="button"
                >
                  未回答へ
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

