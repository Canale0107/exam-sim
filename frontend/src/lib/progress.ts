export type Attempt = {
  questionId: string;
  selectedChoiceIds: string[] | null;
  isCorrect: boolean | null;
  flagged: boolean;
  note: string | null;
  answeredAt: string | null; // ISO string
};

export type ProgressState = {
  currentIndex: number;
  attemptsByQuestionId: Record<string, Attempt>;
  updatedAt: string; // ISO string
};

export function progressKey(params: { userId: string; setId: string }): string {
  const user = (params.userId || "local").trim() || "local";
  const set = params.setId.trim();
  return `exam-sim:progress:${user}:${set}`;
}

export function emptyProgressState(): ProgressState {
  return {
    currentIndex: 0,
    attemptsByQuestionId: {},
    updatedAt: new Date().toISOString(),
  };
}

export function loadProgress(params: { userId: string; setId: string }): ProgressState {
  if (typeof window === "undefined") return emptyProgressState();
  const key = progressKey(params);
  const raw = window.localStorage.getItem(key);
  if (!raw) return emptyProgressState();
  try {
    const obj = JSON.parse(raw) as ProgressState;
    if (
      typeof obj !== "object" ||
      obj === null ||
      typeof obj.currentIndex !== "number" ||
      typeof obj.attemptsByQuestionId !== "object" ||
      obj.attemptsByQuestionId === null
    ) {
      return emptyProgressState();
    }
    return {
      currentIndex: Number.isFinite(obj.currentIndex) ? obj.currentIndex : 0,
      attemptsByQuestionId: obj.attemptsByQuestionId ?? {},
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
    };
  } catch {
    return emptyProgressState();
  }
}

export function saveProgress(params: { userId: string; setId: string; state: ProgressState }): void {
  if (typeof window === "undefined") return;
  const key = progressKey(params);
  window.localStorage.setItem(key, JSON.stringify(params.state));
}

export function clearProgress(params: { userId: string; setId: string }): void {
  if (typeof window === "undefined") return;
  const key = progressKey(params);
  window.localStorage.removeItem(key);
}
