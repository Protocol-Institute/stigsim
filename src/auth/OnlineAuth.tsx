import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { OnlineIdentity } from "../../shared/auth-contract";

const TOKEN_KEY = "stigsim-online-session";
const SERVER_URL = (import.meta.env.VITE_INFINITE_SERVER_URL ?? "").replace(/\/$/, "");
const apiUrl = (path: string) => `${SERVER_URL}${path}`;

interface OnlineAuthValue { token: string; identity: OnlineIdentity; signOut: () => void }
const OnlineAuthContext = createContext<OnlineAuthValue | null>(null);

async function sessionFor(token: string): Promise<OnlineIdentity | null> {
  const response = await fetch(apiUrl("/api/auth/session"), { headers: { Authorization: `Bearer ${token}` } });
  return response.ok ? response.json() as Promise<OnlineIdentity> : null;
}

export function useOnlineAuth(): OnlineAuthValue {
  const value = useContext(OnlineAuthContext);
  if (!value) throw new Error("Online authentication is unavailable outside OnlineAuthGate");
  return value;
}

export default function OnlineAuthGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [identity, setIdentity] = useState<OnlineIdentity | null>(null);
  const [checking, setChecking] = useState(Boolean(token));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");

  useEffect(() => {
    if (!token) { setChecking(false); return; }
    let active = true;
    void sessionFor(token).then(session => {
      if (!active) return;
      if (session) setIdentity(session);
      else { localStorage.removeItem(TOKEN_KEY); setToken(""); }
      setChecking(false);
    }).catch(() => { if (active) { setError("Could not reach the authentication server."); setChecking(false); } });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    const expire = () => { localStorage.removeItem(TOKEN_KEY); setToken(""); setIdentity(null); setStep("email"); setError("Your session expired. Request a new code to continue."); };
    window.addEventListener("stigsim-auth-expired", expire);
    return () => window.removeEventListener("stigsim-auth-expired", expire);
  }, []);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(apiUrl("/api/auth/request-code"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json() as { error?: string; developmentCode?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not send a code");
      setDevelopmentCode(result.developmentCode ?? ""); setStep("code");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send a code"); }
    finally { setBusy(false); }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(apiUrl("/api/auth/verify-code"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
      const result = await response.json() as { error?: string; token?: string };
      if (!response.ok || !result.token) throw new Error(result.error ?? "Could not verify that code");
      const session = await sessionFor(result.token);
      if (!session) throw new Error("The new session could not be verified");
      localStorage.setItem(TOKEN_KEY, result.token); setToken(result.token); setIdentity(session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not verify that code"); }
    finally { setBusy(false); }
  };

  const value = useMemo<OnlineAuthValue | null>(() => token && identity ? {
    token, identity, signOut: () => { localStorage.removeItem(TOKEN_KEY); setToken(""); setIdentity(null); setStep("email"); setCode(""); },
  } : null, [identity, token]);

  if (checking) return <main className="online-auth"><div className="online-auth__card"><p>Checking your session…</p></div></main>;
  if (!value) return <main className="online-auth"><section className="online-auth__card">
    <span className="online-auth__eyebrow">ONLINE MODES</span>
    <h1>{step === "email" ? "Sign in to play online" : "Check your email"}</h1>
    <p>{step === "email" ? "We’ll email you a six-digit sign-in code. No password required." : `Enter the six-digit code sent to ${email}.`}</p>
    {step === "email" ? <form onSubmit={requestCode}>
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <button disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
    </form> : <form onSubmit={verify}>
      <label>Sign-in code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} placeholder="123456" /></label>
      {developmentCode && <p className="online-auth__dev-code">Local development code: <strong>{developmentCode}</strong></p>}
      <button disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Continue"}</button>
      <button type="button" className="online-auth__secondary" onClick={() => { setStep("email"); setCode(""); setError(""); }}>Use a different email</button>
    </form>}
    {error && <p className="online-auth__error">{error}</p>}
  </section></main>;

  return <OnlineAuthContext.Provider value={value}>{children}<button className="online-auth__signout" onClick={value.signOut}>Sign out · {value.identity.email}</button></OnlineAuthContext.Provider>;
}
