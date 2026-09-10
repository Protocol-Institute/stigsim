import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { OnlineIdentity } from "../../shared/auth-contract";

const CODE_TTL_MS = 10 * 60 * 1_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const REQUEST_COOLDOWN_MS = 60 * 1_000;
const MAX_ATTEMPTS = 5;
const SOURCE_WINDOW_MS = 10 * 60 * 1_000;
const MAX_REQUESTS_PER_SOURCE = 5;

interface PendingCode {
  digest: string;
  expiresAt: number;
  attempts: number;
  requestedAt: number;
}

const pendingCodes = new Map<string, PendingCode>();
const sourceRequests = new Map<string, number[]>();

function secret(): string | null {
  return process.env.AUTH_SECRET?.trim() || (process.env.NODE_ENV === "production" ? null : "stigsim-local-auth-secret");
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function digest(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function equalDigest(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueCode(email: string, now = Date.now()): { code: string; retryAfterMs?: number } {
  const key = secret();
  if (!key) throw new Error("Email authentication is not configured");
  for (const [pendingEmail, pending] of pendingCodes) {
    if (pending.expiresAt < now) pendingCodes.delete(pendingEmail);
  }
  const existing = pendingCodes.get(email);
  if (existing && now - existing.requestedAt < REQUEST_COOLDOWN_MS) {
    return { code: "", retryAfterMs: REQUEST_COOLDOWN_MS - (now - existing.requestedAt) };
  }
  const code = randomInt(100_000, 1_000_000).toString();
  pendingCodes.set(email, {
    digest: digest(`${email}:${code}`, key),
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    requestedAt: now,
  });
  return { code };
}

export function allowCodeRequest(source: string, now = Date.now()): boolean {
  for (const [otherSource, requests] of sourceRequests) {
    const live = requests.filter(at => now - at < SOURCE_WINDOW_MS);
    if (live.length) sourceRequests.set(otherSource, live);
    else sourceRequests.delete(otherSource);
  }
  const recent = (sourceRequests.get(source) ?? []).filter(at => now - at < SOURCE_WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_SOURCE) {
    sourceRequests.set(source, recent);
    return false;
  }
  recent.push(now);
  sourceRequests.set(source, recent);
  return true;
}

export function verifyCode(email: string, code: unknown, now = Date.now()): string | null {
  const key = secret();
  const pending = pendingCodes.get(email);
  if (!key || !pending || pending.expiresAt < now || pending.attempts >= MAX_ATTEMPTS) {
    pendingCodes.delete(email);
    return null;
  }
  pending.attempts++;
  if (typeof code !== "string" || !/^\d{6}$/.test(code)
      || !equalDigest(pending.digest, digest(`${email}:${code}`, key))) return null;
  pendingCodes.delete(email);
  const payload = Buffer.from(JSON.stringify({
    sub: digest(email, key).slice(0, 24),
    email,
    exp: now + SESSION_TTL_MS,
  })).toString("base64url");
  return `${payload}.${digest(payload, key)}`;
}

export function verifySession(token: unknown, now = Date.now()): OnlineIdentity | null {
  const key = secret();
  if (!key || typeof token !== "string") return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !equalDigest(signature, digest(payload, key))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<OnlineIdentity> & { sub?: unknown; exp?: unknown };
    return typeof parsed.sub === "string" && typeof parsed.email === "string"
      && typeof parsed.exp === "number" && parsed.exp > now
      ? { userId: parsed.sub, email: parsed.email }
      : null;
  } catch {
    return null;
  }
}

export function bearerIdentity(request: Request): OnlineIdentity | null {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? verifySession(header.slice(7)) : null;
}

export async function deliverCode(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured");
    console.info(`[auth] Development sign-in code for ${email}: ${code}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Stigsim sign-in code",
      text: `Your Stigsim sign-in code is ${code}. It expires in 10 minutes.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}

export function resetAuthForTests(): void {
  pendingCodes.clear();
  sourceRequests.clear();
}
