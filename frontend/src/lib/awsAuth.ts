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

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export function isCognitoConfigured(): boolean {
  return Boolean(env("NEXT_PUBLIC_COGNITO_DOMAIN") && env("NEXT_PUBLIC_COGNITO_CLIENT_ID") && env("NEXT_PUBLIC_COGNITO_REDIRECT_URI"));
}

export function apiBaseUrl(): string | null {
  return env("NEXT_PUBLIC_API_BASE_URL");
}

export function getCognitoConfig(): {
  domain: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string | null;
} {
  const domain = env("NEXT_PUBLIC_COGNITO_DOMAIN");
  const clientId = env("NEXT_PUBLIC_COGNITO_CLIENT_ID");
  const redirectUri = env("NEXT_PUBLIC_COGNITO_REDIRECT_URI");
  const logoutUri = env("NEXT_PUBLIC_COGNITO_LOGOUT_URI");
  if (!domain || !clientId || !redirectUri) {
    throw new Error("Missing Cognito env. See frontend/ENVIRONMENT.md.");
  }
  return { domain, clientId, redirectUri, logoutUri };
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

export function authHeader(): Record<string, string> {
  const tokens = getStoredTokens();
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

