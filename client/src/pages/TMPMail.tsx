import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, LoaderCircle, LockKeyhole, LogOut, Mail, ShieldCheck } from "lucide-react";
import MailPanel from "@/pages/MailPanel";
import { isOwnerSession, ownerEmail, supabase, supabaseConfigured } from "@/lib/supabase";
import "./TMPMailWorkspace.css";

const hostApiUrl = (import.meta.env.VITE_HOST_API_URL as string | undefined)?.trim().replace(/\/$/, "") ?? "";

export default function TMPMail() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState(ownerEmail);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "TMP Mail · TMP Server";
    if (!supabase) {
      setChecking(false);
      return;
    }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setChecking(false);
      }
    }).catch(() => {
      if (active) setChecking(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !ownerEmail) return;
    const normalized = email.trim().toLowerCase();
    if (normalized !== ownerEmail) {
      setError(`TMP Mail is restricted to ${ownerEmail}.`);
      return;
    }
    setBusy(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser: false, emailRedirectTo: undefined },
    });
    setBusy(false);
    if (authError) setError(authError.message);
    else setCodeSent(true);
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.replace(/\s/g, "");
    if (!supabase || normalizedEmail !== ownerEmail || normalizedCode.length < 6) return;
    setBusy(true);
    setError("");
    const { error: authError } = await supabase.auth.verifyOtp({ email: normalizedEmail, token: normalizedCode, type: "email" });
    setBusy(false);
    if (authError) setError(authError.message);
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setCode("");
    setCodeSent(false);
    setError("");
  };

  const request = useCallback(async (path: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("Sign in with the TMP Server owner account to access Gmail.");
    if (!hostApiUrl) throw new Error("The host API URL is not configured in this build.");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${session.access_token}`);
    return fetch(`${hostApiUrl}${path}`, { ...init, headers, credentials: "omit" });
  }, [session?.access_token]);

  const ownerSession = isOwnerSession(session);

  return <div className={`tm-mail-app${ownerSession ? " tm-mail-app-open" : ""}`}>
    <header className="tm-mail-topbar">
      <a className="tm-mail-brand" href="https://tmpserver.com/" aria-label="TMP Server dashboard">
        <span className="tm-mail-brand-mark"><Mail size={18} /></span>
        <span><strong>TMP</strong><b>MAIL</b><small>PRIVATE OWNER MAILBOX</small></span>
      </a>
      <div className="tm-mail-top-actions">
        <span className="tm-mail-private"><ShieldCheck size={14} /> Owner only</span>
        {ownerSession && <button className="button secondary" type="button" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button>}
      </div>
    </header>

    <main className="tm-mail-main">
      {!supabaseConfigured ? <section className="tm-mail-auth-card" role="alert">
        <LockKeyhole size={23} />
        <p className="eyebrow">TMP MAIL / SETUP REQUIRED</p>
        <h1>Private mailbox access is unavailable.</h1>
        <p>Supabase owner-auth settings are missing from this build. No mailbox data is loaded until the owner session is verified.</p>
      </section> : checking ? <div className="tm-mail-loading" role="status"><LoaderCircle size={19} className="mail-spin" /> Checking the owner session…</div>
        : ownerSession ? <MailPanel request={request} ownerEmail={ownerEmail} variant="workspace" />
          : <section className="tm-mail-auth-card" aria-labelledby="tm-mail-auth-title">
            <span className="tm-mail-lock"><LockKeyhole size={22} /></span>
            <p className="eyebrow">TMP MAIL / OWNER ACCESS</p>
            <h1 id="tm-mail-auth-title">Your mailbox, privately.</h1>
            {!ownerEmail ? <p>Owner email is not configured. Mail stays locked until the existing owner allowlist is restored.</p>
              : codeSent ? <>
                <p>A one-time code was sent to <strong>{ownerEmail}</strong>. Enter it here to open your mailbox.</p>
                <form className="tm-mail-auth-form" onSubmit={verifyCode}>
                  <label className="field-label" htmlFor="tm-mail-code">Email verification code</label>
                  <input id="tm-mail-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} placeholder="123456" maxLength={10} required />
                  {error && <p className="form-error" role="alert">{error}</p>}
                  <button className="button primary" type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify and open TMP Mail"}<ArrowRight size={15} /></button>
                  <button className="button secondary" type="button" onClick={() => { setCodeSent(false); setCode(""); setError(""); }}>Use a different email</button>
                </form>
              </> : <>
                <p>Sign in with the configured TMP Server owner account. Public sign-up is disabled.</p>
                <form className="tm-mail-auth-form" onSubmit={sendCode}>
                  <label className="field-label" htmlFor="tm-mail-email">Owner email</label>
                  <input id="tm-mail-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required />
                  {error && <p className="form-error" role="alert">{error}</p>}
                  <button className="button primary" type="submit" disabled={busy}>{busy ? "Sending code…" : "Send owner sign-in code"}<ArrowRight size={15} /></button>
                  <small><ShieldCheck size={13} /> Access is restricted to {ownerEmail}.</small>
                </form>
              </>}
          </section>}
    </main>
    <footer className="tm-mail-footer">TMP Server · Gmail data is fetched from Google only after owner sign-in · <a href="https://tmpserver.com/">Return to dashboard</a></footer>
  </div>;
}
