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

export type TrialStatus = "in_progress" | "completed";

export type TrialSummary = {
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unknownAnswers: number;
  accuracyRate: number;
  flaggedCount: number;
  durationSeconds: number | null;
};

export type Trial = {
  trialId: string;
  trialNumber: number;
  status: TrialStatus;
  startedAt: string;
  completedAt: string | null;
  state: ProgressState | null;
  summary: TrialSummary | null;
};

export type TrialListResponse = {
  setId: string;
  activeTrialId: string | null;
  trialCount: number;
  trials: Trial[];
};

export function progressKey(params: { userId: string; setId: string }): string {
  const user = (params.userId || "local").trim() || "local";
  const set = params.setId.trim();
  return `exam-sim:progress:${user}:${set}`;
}

export function trialProgressKey(params: { userId: string; setId: string; trialId: string }): string {
  const user = (params.userId || "local").trim() || "local";
  const set = params.setId.trim();
  const trial = params.trialId.trim();
  return `exam-sim:trial:${user}:${set}:${trial}`;
}

export function activeTrialKey(params: { userId: string; setId: string }): string {
  const user = (params.userId || "local").trim() || "local";
  const set = params.setId.trim();
  return `exam-sim:active-trial:${user}:${set}`;
}

export type LocalTrialInfo = {
  trialId: string;
  trialNumber: number;
  status: TrialStatus;
  startedAt: string;
};

export function loadActiveTrialInfo(params: { userId: string; setId: string }): LocalTrialInfo | null {
  if (typeof window === "undefined") return null;
  const key = activeTrialKey(params);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalTrialInfo;
  } catch {
    return null;
  }
}

export function saveActiveTrialInfo(params: { userId: string; setId: string; info: LocalTrialInfo | null }): void {
  if (typeof window === "undefined") return;
  const key = activeTrialKey(params);
  if (params.info === null) {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, JSON.stringify(params.info));
  }
}

export function loadTrialProgress(params: { userId: string; setId: string; trialId: string }): ProgressState {
  if (typeof window === "undefined") return emptyProgressState();
  const key = trialProgressKey(params);
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

export function saveTrialProgress(params: { userId: string; setId: string; trialId: string; state: ProgressState }): void {
  if (typeof window === "undefined") return;
  const key = trialProgressKey(params);
  window.localStorage.setItem(key, JSON.stringify(params.state));
}

export function clearTrialProgress(params: { userId: string; setId: string; trialId: string }): void {
  if (typeof window === "undefined") return;
  const key = trialProgressKey(params);
  window.localStorage.removeItem(key);
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
