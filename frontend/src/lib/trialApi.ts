import { apiBaseUrl, authHeader } from "./awsAuth";
import type { ProgressState, Trial, TrialListResponse, TrialSummary } from "./progress";

export type ListTrialsResponse = TrialListResponse;

export type CreateTrialRequest = {
  setId: string;
  totalQuestions?: number;
};

export type CreateTrialResponse = {
  trialId: string;
  trialNumber: number;
  status: "in_progress";
  startedAt: string;
  state: ProgressState;
};

export type GetTrialResponse = Trial & {
  setId: string;
  updatedAt: string;
};

export type UpdateTrialRequest = {
  setId: string;
  state: ProgressState;
};

export type UpdateTrialResponse = {
  ok: boolean;
  trialId: string;
  updatedAt: string;
};

export type CompleteTrialRequest = {
  setId: string;
  totalQuestions?: number;
};

export type CompleteTrialResponse = {
  trialId: string;
  status: "completed";
  completedAt: string;
  summary: TrialSummary;
};

export type DeleteTrialResponse = {
  ok: boolean;
  trialId: string;
};

function getBase(): string {
  const base = apiBaseUrl();
  if (!base) throw new Error("API_BASE_URL is not configured");
  return base.replace(/\/$/, "");
}

export async function listTrials(setId: string): Promise<ListTrialsResponse> {
  const base = getBase();
  const url = `${base}/progress/trials?setId=${encodeURIComponent(setId)}`;
  const res = await fetch(url, { headers: { ...(await authHeader()) } });
  if (!res.ok) {
    if (res.status === 404) {
      return { setId, activeTrialId: null, trialCount: 0, trials: [] };
    }
    throw new Error(`listTrials failed: ${res.status}`);
  }
  return (await res.json()) as ListTrialsResponse;
}

export async function createTrial(params: CreateTrialRequest): Promise<CreateTrialResponse> {
  const base = getBase();
  const url = `${base}/progress/trials`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string; activeTrialId?: string };
    if (res.status === 400 && data.activeTrialId) {
      throw new Error(`active_trial_exists:${data.activeTrialId}`);
    }
    throw new Error(`createTrial failed: ${res.status} - ${data.message || "unknown"}`);
  }
  return (await res.json()) as CreateTrialResponse;
}

export async function getTrial(setId: string, trialId: string): Promise<GetTrialResponse> {
  const base = getBase();
  const url = `${base}/progress/trials/${encodeURIComponent(trialId)}?setId=${encodeURIComponent(setId)}`;
  const res = await fetch(url, { headers: { ...(await authHeader()) } });
  if (!res.ok) {
    throw new Error(`getTrial failed: ${res.status}`);
  }
  return (await res.json()) as GetTrialResponse;
}

export async function updateTrial(trialId: string, params: UpdateTrialRequest): Promise<UpdateTrialResponse> {
  const base = getBase();
  const url = `${base}/progress/trials/${encodeURIComponent(trialId)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`updateTrial failed: ${res.status}`);
  }
  return (await res.json()) as UpdateTrialResponse;
}

export async function completeTrial(trialId: string, params: CompleteTrialRequest): Promise<CompleteTrialResponse> {
  const base = getBase();
  const url = `${base}/progress/trials/${encodeURIComponent(trialId)}/complete`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`completeTrial failed: ${res.status}`);
  }
  return (await res.json()) as CompleteTrialResponse;
}

export async function deleteTrial(setId: string, trialId: string): Promise<DeleteTrialResponse> {
  const base = getBase();
  const url = `${base}/progress/trials/${encodeURIComponent(trialId)}?setId=${encodeURIComponent(setId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) {
    throw new Error(`deleteTrial failed: ${res.status}`);
  }
  return (await res.json()) as DeleteTrialResponse;
}
