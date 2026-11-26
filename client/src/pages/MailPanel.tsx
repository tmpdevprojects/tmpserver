import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Inbox,
  LoaderCircle,
  Mail,
  MailPlus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";

type MailPanelProps = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  ownerEmail: string;
};

type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email?: string;
  error?: string;
};

type GoogleCodeResponse = { code?: string; error?: string };
type GoogleCodeErrorResponse = { type?: string };
type GoogleCodeClient = { requestCode: () => void };
type GoogleIdentity = {
  accounts: {
    oauth2: {
      initCodeClient: (options: {
        client_id: string;
        scope: string;
        ux_mode: "popup";
        callback: (response: GoogleCodeResponse) => void;
        error_callback: (response: GoogleCodeErrorResponse) => void;
      }) => GoogleCodeClient;
    };
  };
};

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessageResponse = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[]; mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
};
type MailMessage = {
  id: string;
  sender: string;
  recipient: string;
  subject: string;
  date: string;
  plainText: string;
  html: string;
  unread: boolean;
};
type MailFolder = "INBOX" | "SENT" | "STARRED";

type MemoryToken = { value: string; expiresAt: number };

let googleScriptPromise: Promise<void> | null = null;

function googleIdentity(): GoogleIdentity | undefined {
  return (window as unknown as { google?: GoogleIdentity }).google;
}

function loadGoogleIdentity(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google sign-in is available only in a browser."));
  if (googleIdentity()?.accounts.oauth2) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existing ?? document.createElement("script");
    const onLoad = () => {
      if (googleIdentity()?.accounts.oauth2) resolve();
      else reject(new Error("Google sign-in did not initialize. Check the Google OAuth setup and try again."));
    };
    const onError = () => reject(new Error("Google sign-in could not load. Check your connection and try again."));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (googleIdentity()?.accounts.oauth2) {
      resolve();
    }
  }).catch(error => {
    googleScriptPromise = null;
    throw error;
  });
  return googleScriptPromise;
}

async function responseJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
  }
}

function decodeBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function bodyParts(part: GmailPart | undefined): { plain: string[]; html: string[] } {
  if (!part) return { plain: [], html: [] };
  const plain: string[] = [];
  const html: string[] = [];
  if (part.body?.data) {
    try {
      const decoded = decodeBase64Url(part.body.data);
      if (part.mimeType?.toLowerCase() === "text/plain") plain.push(decoded);
      else if (part.mimeType?.toLowerCase() === "text/html") html.push(decoded);
    } catch {
      // Skip malformed individual MIME parts; other valid alternatives may still be readable.
    }
  }
  for (const child of part.parts ?? []) {
    const nested = bodyParts(child);
    plain.push(...nested.plain);
    html.push(...nested.html);
  }
  return { plain, html };
}

function htmlToText(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  documentNode.querySelectorAll("script, style, noscript, template").forEach(node => node.remove());
  return documentNode.body.textContent?.replace(/[\t\u00a0 ]+\n/g, "\n").trim() ?? "";
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find(header => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function makeMessage(item: GmailMessageResponse): MailMessage {
  const headers = item.payload?.headers;
  const parts = bodyParts(item.payload);
  const plainText = parts.plain.length ? parts.plain.join("\n\n") : parts.html.map(htmlToText).filter(Boolean).join("\n\n");
  const timestamp = Number(item.internalDate);
  return {
    id: item.id,
    sender: headerValue(headers, "From") || "Unknown sender",
    recipient: headerValue(headers, "To"),
    subject: headerValue(headers, "Subject") || "(no subject)",
    date: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : "",
    plainText,
    html: parts.html.join("<br>"),
    unread: item.labelIds?.includes("UNREAD") ?? false,
  };
}

function emailFrameDoc(html: string): string {
  const css = "body{margin:0;padding:12px;background:#fff;color:#111;font-family:system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${css}</style></head><body>${html}</body></html>`;
}

function formatDate(value: string, compact = false): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, compact
    ? { month: "short", day: "numeric" }
    : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return window.btoa(binary);
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]{0,60}$/.test(value)) return `Subject: ${value}`;
  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const character of value) {
    const characterBytes = new TextEncoder().encode(character).length;
    if (chunk && chunkBytes + characterBytes > 42) {
      chunks.push(`=?UTF-8?B?${base64Utf8(chunk)}?=`);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) chunks.push(`=?UTF-8?B?${base64Utf8(chunk)}?=`);
  let line = "Subject:";
  const folded: string[] = [];
  for (const word of chunks) {
    if (`${line} ${word}`.length > 76) {
      folded.push(line);
      line = ` ${word}`;
    } else {
      line += ` ${word}`;
    }
  }
  folded.push(line);
  return folded.join("\r\n");
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function makeRawMessage(to: string, subject: string, body: string): string {
  const normalizedBody = body.replace(/\r\n|\r|\n/g, "\r\n");
  const bodyBase64 = wrapBase64(base64Utf8(normalizedBody));
  const mime = [
    `To: ${to}`,
    encodeHeader(subject),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    bodyBase64,
  ].join("\r\n");
  return base64Utf8(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isSingleEmailAddress(value: string): boolean {
  if (/[\r\n,;]/.test(value)) return false;
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(value);
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isBrowserNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && /load failed|failed to fetch|networkerror|network request failed/i.test(error.message);
}

function requestErrorMessage(error: unknown, endpoint: string, fallback: string): string {
  if (isBrowserNetworkFailure(error)) {
    return `No response was received while contacting ${endpoint}. Check the browser connection, then use Refresh before trying Google sign-in again.`;
  }
  return safeErrorMessage(error, fallback);
}

export default function MailPanel({ request, ownerEmail }: { request: (path: string, init?: RequestInit) => Promise<Response>; ownerEmail: string }) {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [oauthReady, setOauthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [folder, setFolder] = useState<MailFolder>("INBOX");
  const [searchDraft, setSearchDraft] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const tokenRef = useRef<MemoryToken | null>(null);
  const pendingTokenRef = useRef<Promise<string> | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const stableRequest = useCallback((path: string, init?: RequestInit) => requestRef.current(path, init), []);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await stableRequest("/api/gmail/status");
      const payload = await responseJson<GmailStatus & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `Unable to check Gmail setup (HTTP ${response.status}).`);
      setStatus(payload);
      setError("");
      if (!payload.connected) {
        tokenRef.current = null;
        pendingTokenRef.current = null;
        setMessages([]);
        setSelected(null);
      }
      return payload;
    } catch (cause) {
      setStatus(null);
      setError(requestErrorMessage(cause, "/api/gmail/status", "Unable to check Gmail connection status."));
      return null;
    } finally {
      setStatusLoading(false);
    }
  }, [stableRequest]);

  useEffect(() => {
    void loadStatus();
    let active = true;
    void loadGoogleIdentity().then(() => {
      if (active) setOauthReady(true);
    }).catch(() => {
      if (active) setOauthReady(false);
    });
    return () => { active = false; };
  }, [loadStatus]);

  const getAccessToken = useCallback(async (force = false): Promise<string> => {
    const cached = tokenRef.current;
    if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    if (pendingTokenRef.current) return pendingTokenRef.current;
    const pending = (async () => {
      let response: Response;
      try {
        response = await stableRequest("/api/gmail/access-token", { method: "POST" });
      } catch (cause) {
        throw new Error(requestErrorMessage(cause, "/api/gmail/access-token", "Could not obtain Gmail access."));
      }
      const payload = await responseJson<{ accessToken?: string; expiresIn?: number; error?: string }>(response);
      if (!response.ok || !payload.accessToken) throw new Error(payload.error || `Could not obtain Gmail access (HTTP ${response.status}).`);
      const lifetime = Math.max(0, Number(payload.expiresIn) || 0) * 1000;
      tokenRef.current = { value: payload.accessToken, expiresAt: Date.now() + lifetime };
      return payload.accessToken;
    })();
    pendingTokenRef.current = pending;
    try {
      return await pending;
    } finally {
      if (pendingTokenRef.current === pending) pendingTokenRef.current = null;
    }
  }, [stableRequest]);

  const gmailFetch = useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    let accessToken = await getAccessToken();
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}` },
      });
    } catch (cause) {
      if (isBrowserNetworkFailure(cause)) throw new Error("No response was received from the Gmail API. Check the browser connection to Google and try again.");
      throw cause;
    }
    if (response.status === 401) {
      accessToken = await getAccessToken(true);
      try {
        response = await fetch(url, {
          ...init,
          headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}` },
        });
      } catch (cause) {
        if (isBrowserNetworkFailure(cause)) throw new Error("No response was received from the Gmail API after refreshing access. Check the browser connection to Google and try again.");
        throw cause;
      }
    }
    return response;
  }, [getAccessToken]);

  const loadMessages = useCallback(async (nextFolder = folder, query = activeQuery, pageToken?: string) => {
    if (!status?.connected) return;
    const append = Boolean(pageToken);
    if (append) {
      setLoadingMore(true);
    } else {
      setListLoading(true);
      setSelected(null);
      setNextPageToken(null);
    }
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ maxResults: "50", labelIds: nextFolder });
      if (query.trim()) params.set("q", query.trim());
      if (pageToken) params.set("pageToken", pageToken);
      const listResponse = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`);
      if (!listResponse.ok) throw new Error(`Gmail could not load this mailbox view (HTTP ${listResponse.status}). Try refreshing or reconnecting.`);
      const list = await responseJson<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(listResponse);
      const ids = (list.messages ?? []).filter(message => typeof message.id === "string");
      const details: MailMessage[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const loaded = await Promise.all(chunk.map(async ({ id }) => {
          const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
          if (!response.ok) throw new Error(`A message could not be loaded (HTTP ${response.status}). Refresh to try again.`);
          return makeMessage(await responseJson<GmailMessageResponse>(response));
        }));
        details.push(...loaded);
      }
      setMessages(current => append ? [...current, ...details] : details);
      setNextPageToken(list.nextPageToken ?? null);
    } catch (cause) {
      if (!append) setMessages([]);
      setError(safeErrorMessage(cause, "Unable to load Gmail messages."));
    } finally {
      setListLoading(false);
      setLoadingMore(false);
    }
  }, [activeQuery, folder, gmailFetch, status?.connected]);

  useEffect(() => {
    if (status?.connected) void loadMessages(folder, activeQuery);
  }, [status?.connected, folder, activeQuery, loadMessages]);

  const connect = () => {
    setError("");
    setNotice("");
    if (!clientId?.trim()) {
      setError("Google OAuth is not configured in this public build. Complete the Google OAuth and Gmail API host setup, then reload this page.");
      return;
    }
    const identity = googleIdentity();
    if (!oauthReady || !identity?.accounts.oauth2) {
      setError("Google sign-in is still loading. Please try Connect again in a moment.");
      void loadGoogleIdentity().then(() => setOauthReady(true)).catch(cause => setError(safeErrorMessage(cause, "Google sign-in could not load.")));
      return;
    }
    try {
      const codeClient = identity.accounts.oauth2.initCodeClient({
        client_id: clientId.trim(),
        scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        ux_mode: "popup",
        callback: response => {
          if (response.error || !response.code) {
            setBusy(false);
            setError(response.error ? `Google sign-in was not completed (${response.error}).` : "Google did not return an authorization code. Please try again.");
            return;
          }
          void (async () => {
            setBusy(true);
            setError("");
            try {
              const exchange = await stableRequest("/api/gmail/oauth/exchange", {
                method: "POST",
                headers: { "content-type": "application/json", "X-Requested-With": "XmlHttpRequest" },
                body: JSON.stringify({ code: response.code, redirectUri: window.location.origin }),
              });
              const result = await responseJson<{ connected?: boolean; email?: string; error?: string }>(exchange);
              if (!exchange.ok || !result.connected) throw new Error(result.error || `Google connection could not be completed (HTTP ${exchange.status}).`);
              const latest = await loadStatus();
              if (latest?.connected) setNotice(`Gmail connected${latest.email ? ` as ${latest.email}` : ""}.`);
              else if (latest) setError(latest.error || "Google authorization finished, but Gmail setup is not yet reported as connected by the host.");
            } catch (cause) {
              setError(requestErrorMessage(cause, "/api/gmail/oauth/exchange", "Unable to complete Google sign-in."));
            } finally {
              setBusy(false);
            }
          })();
        },
        error_callback: response => {
          setBusy(false);
          setError(response.type === "popup_closed" ? "Google sign-in was closed before authorization finished." : "Google could not open the sign-in popup. Allow popups for this site and try again.");
        },
      });
      setBusy(true);
      codeClient.requestCode();
    } catch (cause) {
      setBusy(false);
      setError(safeErrorMessage(cause, "Google sign-in could not start. Check your OAuth client configuration."));
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Gmail from TMP Server? The server-side refresh token will be revoked and removed.")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await stableRequest("/api/gmail/disconnect", { method: "POST" });
      const payload = await responseJson<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Gmail could not be disconnected (HTTP ${response.status}).`);
      tokenRef.current = null;
      setMessages([]);
      setSelected(null);
      setNotice("Gmail disconnected. The server-side refresh token was removed.");
      await loadStatus();
    } catch (cause) {
      setError(safeErrorMessage(cause, "Unable to disconnect Gmail."));
    } finally {
      setBusy(false);
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSelected(null);
    setActiveQuery(searchDraft.trim());
  };

  const submitCompose = async (event: FormEvent) => {
    event.preventDefault();
    const cleanRecipient = recipient.trim();
    const cleanSubject = subject.trim();
    if (!isSingleEmailAddress(cleanRecipient)) {
      setError("Enter one valid recipient email address (no comma-separated recipients). ");
      return;
    }
    if (/[\r\n]/.test(subject)) {
      setError("Subject cannot contain line breaks.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw: makeRawMessage(cleanRecipient, cleanSubject, body) }),
      });
      if (!response.ok) throw new Error(`Gmail could not send this message (HTTP ${response.status}). Check the connection and try again.`);
      setRecipient("");
      setSubject("");
      setBody("");
      setComposeOpen(false);
      setNotice("Message sent successfully.");
      if (folder === "SENT") void loadMessages("SENT", activeQuery);
    } catch (cause) {
      setError(safeErrorMessage(cause, "Unable to send this message."));
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = (next: MailFolder) => {
    setFolder(next);
    setSelected(null);
    setNotice("");
  };

  const openMessage = (message: MailMessage) => {
    setSelected(message);
    if (message.unread) {
      setMessages(current => current.map(item => item.id === message.id ? { ...item, unread: false } : item));
    }
  };

  const isConfigured = status?.configured === true;
  const isConnected = status?.connected === true;
  const unavailable = !statusLoading && status !== null && (!isConfigured || !isConnected);

  return <section className="mail-page" aria-labelledby="mail-page-title">
    <header className="mail-hero">
      <div className="mail-hero-copy">
        <p className="eyebrow">PRIVATE SERVER MAIL</p>
        <h1 id="mail-page-title">Mailbox</h1>
        <p>Read and send mail from your connected Google account, directly in this browser.</p>
      </div>
      <div className="mail-hero-actions">
        {isConnected && <span className="mail-connection-pill"><span aria-hidden="true" /> Gmail connected</span>}
        <button className="button secondary" type="button" onClick={() => void loadStatus()} disabled={statusLoading || busy} aria-label="Refresh Gmail connection status"><RefreshCw size={14} /> Refresh</button>
      </div>
    </header>

    {statusLoading && <div className="mail-status-card" role="status" aria-live="polite"><LoaderCircle size={17} className="mail-spin" /><span>Checking Gmail connection status…</span></div>}
    {unavailable && <div className="mail-status-card mail-status-pending" role="status">
      <CircleAlert size={19} aria-hidden="true" />
      <div><strong>{isConfigured ? "Gmail is not connected" : "Gmail is not configured"}</strong>
        <p>{status?.error || (isConfigured
          ? clientId?.trim()
            ? `Host setup is ready. Select Connect Google and authorize ${ownerEmail || "the Google account for the signed-in TMP Server owner"}.`
            : "The host is configured, but this dashboard build is missing VITE_GOOGLE_CLIENT_ID. Add it as a GitHub Actions repository variable and redeploy."
          : "The host agent has not loaded both Gmail OAuth settings. Configure GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in its private environment, then restart the service.")}</p>
        {ownerEmail && <small>TMP Server owner session: {ownerEmail}</small>}
      </div>
      {isConfigured && <button className="button primary" type="button" onClick={connect} disabled={busy || !clientId?.trim()}><ShieldCheck size={15} /> {busy ? "Waiting for Google…" : "Connect Google"}</button>}
    </div>}
    {!statusLoading && status === null && <div className="mail-status-card mail-status-pending" role="status"><CircleAlert size={19} /><div><strong>Connection status unavailable</strong><p>Could not verify Gmail setup. Check the host connection, then refresh status.</p></div></div>}

    {error && <div className="mail-feedback mail-feedback-error" role="alert"><CircleAlert size={15} /><span>{error}</span><button type="button" className="mail-feedback-dismiss" aria-label="Dismiss error" onClick={() => setError("")}><X size={14} /></button></div>}
    {notice && <div className="mail-feedback mail-feedback-success" role="status" aria-live="polite"><Check size={15} /><span>{notice}</span><button type="button" className="mail-feedback-dismiss" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={14} /></button></div>}

    {isConnected && <>
      <div className="mail-account-bar"><div className="mail-account-ident"><span className="mail-account-avatar" aria-hidden="true">{(status.email || "G").charAt(0).toUpperCase()}</span><span><strong>{status.email || "Connected Google account"}</strong><small>Connected securely through TMP Server</small></span></div>
        <div className="mail-account-actions"><button type="button" className="button secondary" onClick={() => { setComposeOpen(true); setSelected(null); setError(""); }}><MailPlus size={14} /> Compose</button><button type="button" className="mail-disconnect" onClick={() => void disconnect()} disabled={busy}>Disconnect</button></div>
      </div>

      <div className="mail-workspace">
        <nav className="mail-nav" aria-label="Mailbox folders">
          <button type="button" className={`mail-nav-item ${folder === "INBOX" ? "active" : ""}`} aria-current={folder === "INBOX" ? "page" : undefined} onClick={() => chooseFolder("INBOX")}><Inbox size={17} /><span>Inbox</span></button>
          <button type="button" className={`mail-nav-item ${folder === "SENT" ? "active" : ""}`} aria-current={folder === "SENT" ? "page" : undefined} onClick={() => chooseFolder("SENT")}><Send size={16} /><span>Sent</span></button>
          <button type="button" className={`mail-nav-item ${folder === "STARRED" ? "active" : ""}`} aria-current={folder === "STARRED" ? "page" : undefined} onClick={() => chooseFolder("STARRED")}><Star size={16} /><span>Starred</span></button>
          <div className="mail-nav-note"><ShieldCheck size={14} /><span>Read messages and send email. Opening a message only changes its local emphasis; Gmail labels are unchanged. Delete/archive controls are not enabled.</span></div>
        </nav>

        <div className="mail-content panel">
          {composeOpen ? <form className="mail-compose" onSubmit={submitCompose} aria-labelledby="mail-compose-title">
            <div className="mail-pane-heading"><div><p className="eyebrow">NEW MESSAGE</p><h2 id="mail-compose-title">Compose</h2></div><button type="button" className="icon-button" aria-label="Close compose" onClick={() => setComposeOpen(false)}><X size={17} /></button></div>
            <label className="mail-compose-field">To<input type="email" required value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="name@example.com" autoComplete="email" /></label>
            <label className="mail-compose-field">Subject<input value={subject} onChange={event => setSubject(event.target.value)} maxLength={998} placeholder="Subject" /></label>
            <label className="mail-compose-field mail-compose-body">Message<textarea value={body} onChange={event => setBody(event.target.value)} rows={12} placeholder="Write a plain-text message…" /></label>
            <div className="mail-compose-footer"><span>Plain text only · one recipient</span><button className="button primary" type="submit" disabled={busy}><Send size={14} /> {busy ? "Sending…" : "Send"}</button></div>
          </form> : selected ? <article className="mail-reading" aria-labelledby="mail-reading-subject">
            <div className="mail-reading-toolbar"><button type="button" className="mail-back" onClick={() => setSelected(null)}><ArrowLeft size={15} /> Back to {folder === "INBOX" ? "Inbox" : folder === "SENT" ? "Sent" : "Starred"}</button><span>{formatDate(selected.date)}</span></div>
            <h2 id="mail-reading-subject" className="mail-reading-subject">{selected.subject}</h2>
            <div className="mail-message-meta"><span className="mail-sender-avatar" aria-hidden="true">{selected.sender.charAt(0).toUpperCase()}</span><div><strong>{selected.sender}</strong>{selected.recipient && <small>to {selected.recipient}</small>}</div><time dateTime={selected.date || undefined}>{formatDate(selected.date)}</time></div>
            {selected.html ? <iframe title="Message content" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={emailFrameDoc(selected.html)} style={{ width: "100%", height: "70vh", border: 0, background: "#fff", borderRadius: 8 }} /> : <div className="mail-message-body">{selected.plainText ? selected.plainText : <span className="mail-no-body">This message has no readable content.</span>}</div>}
          </article> : <>
            <div className="mail-list-toolbar"><div><p className="eyebrow">YOUR MAIL</p><h2>{folder === "INBOX" ? "Inbox" : folder === "SENT" ? "Sent" : "Starred"}</h2></div><form className="mail-search" role="search" onSubmit={submitSearch}><Search size={15} aria-hidden="true" /><input aria-label="Search Gmail" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Search mail" /><button type="submit" aria-label="Submit Gmail search"><ChevronRight size={15} /></button></form><button type="button" className="icon-button mail-reload" title="Refresh messages" aria-label="Refresh messages" disabled={listLoading} onClick={() => void loadMessages(folder, activeQuery)}><RefreshCw size={15} /></button></div>
            {activeQuery && <div className="mail-query-indicator">Search: <strong>{activeQuery}</strong><button type="button" onClick={() => { setSearchDraft(""); setActiveQuery(""); }}>Clear search</button></div>}
            <div className="mail-message-list" aria-live="polite" aria-busy={listLoading}>
              {listLoading ? <div className="mail-empty"><LoaderCircle size={21} className="mail-spin" /><p>Loading messages from Google…</p></div>
                : error && !messages.length ? <div className="mail-empty"><CircleAlert size={22} /><p>Messages could not be loaded. Review the alert above or retry.</p><button className="button secondary" type="button" onClick={() => void loadMessages(folder, activeQuery)}>Try again</button></div>
                  : messages.length ? messages.map(message => <button className={`mail-message-row ${message.unread ? "unread" : ""}`} type="button" key={message.id} onClick={() => openMessage(message)} aria-label={`Read ${message.subject} from ${message.sender}`}>
                    <span className="mail-row-icon" aria-hidden="true"><Mail size={16} /></span><span className="mail-row-main"><strong>{message.sender}</strong><span className="mail-row-subject">{message.subject}</span><span className="mail-row-preview">{message.plainText.replace(/\s+/g, " ").slice(0, 150)}</span></span><time dateTime={message.date || undefined}>{formatDate(message.date, true)}</time><ChevronRight size={15} className="mail-row-chevron" aria-hidden="true" />
                  </button>)
                    : <div className="mail-empty"><Mail size={25} /><strong>{activeQuery ? "No matching messages" : `No messages in ${folder === "INBOX" ? "Inbox" : folder === "SENT" ? "Sent" : "Starred"}`}</strong><p>{activeQuery ? "Try different search terms or clear the search." : "When messages are available, they will appear here."}</p></div>}
            </div>
            <footer className="mail-list-footer"><span>{listLoading ? "Loading" : `${messages.length} message${messages.length === 1 ? "" : "s"}`}{nextPageToken ? " · more available" : ""}</span>{nextPageToken && <button type="button" className="button secondary" disabled={loadingMore} onClick={() => void loadMessages(folder, activeQuery, nextPageToken)}>{loadingMore ? "Loading…" : "Load more"}</button>}<span>Search uses Gmail query syntax</span></footer>
          </>}
        </div>
      </div>
    </>}
  </section>;
}
