export type CognitoTokens = {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  obtained_at: string; // ISO
};

export type CognitoUser = {
  sub: string;
  email: string | null;
};

const STORAGE_KEY = "exam-sim:auth:cognitoTokens";

// IMPORTANT:
// Next.js exposes NEXT_PUBLIC_* to the client bundle only when accessed via
// static property access (process.env.NEXT_PUBLIC_...). Do not use dynamic
// access like process.env[name] or the client may see "undefined".
const COGNITO_DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN?.trim() || "";
const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID?.trim() || "";
const COGNITO_REDIRECT_URI = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI?.trim() || "";
const COGNITO_LOGOUT_URI = process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI?.trim() || "";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "";

export function isCognitoConfigured(): boolean {
  return Boolean(COGNITO_DOMAIN && COGNITO_CLIENT_ID && COGNITO_REDIRECT_URI);
}

export function apiBaseUrl(): string | null {
  return API_BASE_URL || null;
}

export function getCognitoConfig(): {
  domain: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string | null;
} {
  if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID || !COGNITO_REDIRECT_URI) {
    throw new Error("Missing Cognito env. See frontend/ENVIRONMENT.md.");
  }
  return {
    domain: COGNITO_DOMAIN,
    clientId: COGNITO_CLIENT_ID,
    redirectUri: COGNITO_REDIRECT_URI,
    logoutUri: COGNITO_LOGOUT_URI || null,
  };
}

function base64UrlDecode(input: string): string {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  if (typeof window === "undefined") return "";
  const bin = window.atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = base64UrlDecode(parts[1]);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getStoredTokens(): CognitoTokens | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CognitoTokens;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: CognitoTokens): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getCurrentUser(): CognitoUser | null {
  const tokens = getStoredTokens();
  if (!tokens?.id_token) return null;
  const claims = parseJwt(tokens.id_token);
  if (!claims) return null;
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) return null;
  const email = typeof claims.email === "string" ? claims.email : null;
  return { sub, email };
}

function readJwtExpMs(token: string): number | null {
  const claims = parseJwt(token);
  const exp = claims?.exp;
  if (typeof exp !== "number") return null;
  // JWT exp is seconds since epoch
  return exp * 1000;
}

function computeTokenExpiryMs(tokens: CognitoTokens): number | null {
  const fromJwt = tokens.id_token ? readJwtExpMs(tokens.id_token) : null;
  if (fromJwt) return fromJwt;

  // Fallback: obtained_at + expires_in (seconds)
  if (!tokens.obtained_at || typeof tokens.expires_in !== "number") return null;
  const obtained = Date.parse(tokens.obtained_at);
  if (!Number.isFinite(obtained)) return null;
  return obtained + tokens.expires_in * 1000;
}

function isExpiredOrNearExpiry(tokens: CognitoTokens, skewSeconds = 60): boolean {
  const expMs = computeTokenExpiryMs(tokens);
  if (!expMs) return false; // If unknown, assume valid and let server decide.
  return Date.now() >= expMs - skewSeconds * 1000;
}

async function refreshTokens(refreshToken: string): Promise<Pick<CognitoTokens, "id_token" | "access_token" | "token_type" | "expires_in">> {
  const { domain, clientId } = getCognitoConfig();
  const tokenUrl = `https://${domain}/oauth2/token`;

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("client_id", clientId);
  body.set("refresh_token", refreshToken);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);

  const data = (await res.json()) as Partial<CognitoTokens>;
  // Cognito refresh token grant typically returns a new id_token/access_token.
  if (!data.id_token || !data.access_token) throw new Error("token refresh response missing tokens");

  return {
    id_token: data.id_token,
    access_token: data.access_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
  };
}

export async function getValidTokens(): Promise<CognitoTokens | null> {
  const tokens = getStoredTokens();
  if (!tokens?.id_token) return null;

  if (!isExpiredOrNearExpiry(tokens)) return tokens;

  // No refresh token -> force re-login
  if (!tokens.refresh_token) {
    clearTokens();
    return null;
  }

  try {
    const refreshed = await refreshTokens(tokens.refresh_token);
    const next: CognitoTokens = {
      ...tokens,
      ...refreshed,
      refresh_token: tokens.refresh_token, // keep
      obtained_at: new Date().toISOString(),
    };
    storeTokens(next);
    return next;
  } catch {
    clearTokens();
    return null;
  }
}

export async function authHeader(): Promise<Record<string, string>> {
  const tokens = await getValidTokens();
  if (!tokens?.id_token) return {};
  return { Authorization: `Bearer ${tokens.id_token}` };
}

export function buildLoginUrl(): string {
  const { domain, clientId, redirectUri } = getCognitoConfig();
  const u = new URL(`https://${domain}/oauth2/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("redirect_uri", redirectUri);
  return u.toString();
}

export function buildLogoutUrl(): string {
  const { domain, clientId, logoutUri } = getCognitoConfig();
  const u = new URL(`https://${domain}/logout`);
  u.searchParams.set("client_id", clientId);
  if (logoutUri) u.searchParams.set("logout_uri", logoutUri);
  return u.toString();
}

export async function exchangeCodeForTokens(code: string): Promise<CognitoTokens> {
  const { domain, clientId, redirectUri } = getCognitoConfig();
  const tokenUrl = `https://${domain}/oauth2/token`;

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", clientId);
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (!data.id_token || !data.access_token) throw new Error("token exchange response missing tokens");
  return { ...data, obtained_at: new Date().toISOString() };
}

