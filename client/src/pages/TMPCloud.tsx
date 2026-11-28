import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { isOwnerSession, ownerEmail, supabase, supabaseConfigured } from "@/lib/supabase";
import type { CloudFile } from "@/lib/tmp-data";
import CloudPanel, { type CloudCategory } from "./CloudPanel";
import "./TMPCloud.css";

const hostApiUrl = (import.meta.env.VITE_HOST_API_URL as string | undefined)?.trim().replace(/\/$/, "") ?? "";
const CLOUD_FILE_MAX_BYTES = 20_000_000_000;
const CLOUD_CHUNK_BYTES = 64 * 1024 ** 2;
type CloudUploadResult = { status: "uploaded" } | { status: "skipped" } | { status: "failed"; message: string };
type CloudListing = { files?: CloudFile[]; folders?: string[]; usedBytes?: number; storage?: { available?: boolean; message?: string } };
type CloudAppearance = "system" | "light" | "dark";
type CloudDensity = "comfortable" | "compact";

function readLocalChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? value as T : fallback;
  } catch {
    return fallback;
  }
}

function readLocalFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function routeError(response: Response, payload: { error?: unknown }, action: string) {
  if (response.status === 404) return `${action} route is missing from the connected host agent (HTTP 404). Update the Linux repository to origin/main and restart tmpserver-host-agent.`;
  return typeof payload.error === "string" ? payload.error : `${action} failed (HTTP ${response.status}).`;
}

export default function TMPCloud() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState(ownerEmail);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageAvailable, setStorageAvailable] = useState<boolean | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [category, setCategory] = useState<CloudCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearance] = useState<CloudAppearance>(() => readLocalChoice("tmp-cloud-appearance", ["system", "light", "dark"], "system"));
  const [density, setDensity] = useState<CloudDensity>(() => readLocalChoice("tmp-cloud-density", ["comfortable", "compact"], "comfortable"));
  const [autoPreviews, setAutoPreviews] = useState(() => readLocalFlag("tmp-cloud-auto-previews", true));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const effectiveTheme = appearance === "system" ? systemDark ? "dark" : "light" : appearance;

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("tmp-cloud-appearance", appearance); } catch { /* Browser storage is optional. */ }
  }, [appearance]);

  useEffect(() => {
    try {
      window.localStorage.setItem("tmp-cloud-density", density);
      window.localStorage.setItem("tmp-cloud-auto-previews", String(autoPreviews));
    } catch { /* Browser storage is optional. */ }
  }, [density, autoPreviews]);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    document.title = "TMP Cloud · TMP Server";
    if (!supabase) {
      setChecking(false);
      return;
    }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setChecking(false);
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

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !ownerEmail) return;
    const normalized = email.trim().toLowerCase();
    if (normalized !== ownerEmail) {
      setAuthError(`TMP Cloud is restricted to ${ownerEmail}.`);
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const { error: authFailure } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser: false, emailRedirectTo: undefined },
    });
    setAuthBusy(false);
    if (authFailure) setAuthError(authFailure.message);
    else setCodeSent(true);
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.replace(/\s/g, "");
    if (!supabase || normalizedEmail !== ownerEmail || normalizedCode.length < 6) return;
    setAuthBusy(true);
    setAuthError("");
    const { error: authFailure } = await supabase.auth.verifyOtp({ email: normalizedEmail, token: normalizedCode, type: "email" });
    setAuthBusy(false);
    if (authFailure) setAuthError(authFailure.message);
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setCode("");
    setCodeSent(false);
    setAuthError("");
    setFiles([]);
    setFolders([]);
    setUsedBytes(0);
    setStorageAvailable(null);
  };

  const cloudRequest = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!isOwnerSession(session) || !session?.access_token) throw new Error("Sign in with the TMP Server owner account to access Cloud.");
    if (!hostApiUrl) throw new Error("The host API URL is not configured in this build.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${session.access_token}`);
    return fetch(`${hostApiUrl}${path}`, { ...init, headers, credentials: "omit" });
  }, [session]);

  const loadCloudFiles = useCallback(async (): Promise<boolean> => {
    let unavailable = false;
    try {
      const response = await cloudRequest("/api/cloud/files", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as CloudListing & { error?: unknown };
      if (!response.ok) {
        unavailable = response.status === 503 || payload.storage?.available === false;
        if (unavailable) {
          setStorageAvailable(false);
          setFiles([]);
          setFolders([]);
          setUsedBytes(0);
        }
        throw new Error(routeError(response, payload, "Cloud file listing"));
      }
      if (payload.storage?.available !== true) {
        unavailable = true;
        setStorageAvailable(false);
        setFiles([]);
        setFolders([]);
        setUsedBytes(0);
        throw new Error("The host agent has not confirmed the external HDD Cloud mount. Cloud operations remain disabled until HDD storage is verified.");
      }
      setStorageAvailable(true);
      setFiles(Array.isArray(payload.files) ? payload.files : []);
      setFolders(Array.isArray(payload.folders) ? payload.folders : []);
      setUsedBytes(Number(payload.usedBytes) || 0);
      setError("");
      return true;
    } catch (failure) {
      if (!unavailable) setStorageAvailable(null);
      setFiles([]);
      setFolders([]);
      setUsedBytes(0);
      setError(failure instanceof Error ? failure.message : "Could not load Cloud files.");
      return false;
    }
  }, [cloudRequest]);

  useEffect(() => {
    if (!isOwnerSession(session) || !hostApiUrl) return;
    void loadCloudFiles();
    const timer = window.setInterval(() => void loadCloudFiles(), 15000);
    return () => window.clearInterval(timer);
  }, [session, loadCloudFiles]);

  async function refreshCloud() {
    setBusy(true);
    await loadCloudFiles();
    setBusy(false);
  }

  async function createFolder(path: string): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const response = await cloudRequest("/api/cloud/folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(routeError(response, payload, "Cloud folder creation"));
      await loadCloudFiles();
      setNotice(`Folder ${path} created.`);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create Cloud folder.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function uploadOne(file: File, folder: string): Promise<CloudUploadResult> {
    if (file.size > CLOUD_FILE_MAX_BYTES) return { status: "failed", message: "Cloud files are limited to 20 GB per file." };
    const targetPath = folder ? `${folder}/${file.name}` : file.name;
    if (files.some(item => item.path === targetPath) && !window.confirm(`Replace the existing Cloud file ${targetPath}?`)) return { status: "skipped" };
    const uploadId = crypto.randomUUID().replace(/-/g, "");
    const totalChunks = Math.ceil(file.size / CLOUD_CHUNK_BYTES);
    setUploadProgress(0);
    try {
      for (let index = 0; index < totalChunks; index += 1) {
        const params = new URLSearchParams({ uploadId, index: String(index), total: String(totalChunks), path: targetPath });
        const response = await cloudRequest(`/api/cloud/upload-chunk?${params.toString()}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file.slice(index * CLOUD_CHUNK_BYTES, Math.min(file.size, (index + 1) * CLOUD_CHUNK_BYTES)) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(routeError(response, payload, `Cloud upload chunk ${index + 1} of ${totalChunks}`));
        setUploadProgress(totalChunks ? Math.min(99, Math.floor(((index + 1) / totalChunks) * 100)) : 99);
      }
      const response = await cloudRequest("/api/cloud/upload-complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId, path: targetPath, size: file.size, totalChunks }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(routeError(response, payload, "Cloud upload completion"));
      setUploadProgress(100);
      return { status: "uploaded" };
    } catch (failure) {
      try {
        await cloudRequest("/api/cloud/upload-cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId }) });
      } catch {
        // Failed connections can prevent cleanup; the host removes stale staging data.
      }
      return { status: "failed", message: failure instanceof Error ? failure.message : "Cloud upload failed." };
    }
  }

  async function uploadFiles(selected: File[], folder: string) {
    if (!selected.length) return;
    const names = new Set<string>();
    const duplicates = new Set<string>();
    for (const file of selected) {
      const path = folder ? `${folder}/${file.name}` : file.name;
      if (names.has(path)) duplicates.add(path);
      names.add(path);
    }
    if (duplicates.size) {
      setError(`The selection contains duplicate destination names: ${Array.from(duplicates).join(", ")}. Rename them or choose another folder.`);
      return;
    }
    setBusy(true);
    setError("");
    let uploaded = 0;
    let skipped = 0;
    const failures: string[] = [];
    try {
      for (const [index, file] of selected.entries()) {
        setUploadStatus(selected.length > 1 ? `File ${index + 1} of ${selected.length} · ${file.name}` : `Uploading ${file.name}`);
        const result = await uploadOne(file, folder);
        if (result.status === "uploaded") uploaded += 1;
        else if (result.status === "skipped") skipped += 1;
        else failures.push(`${file.name}: ${result.message}`);
      }
      const refreshed = await loadCloudFiles();
      const summary = [failures.length ? `${failures.length} failed (${failures.join(" · ")})` : "", skipped ? `${skipped} skipped` : ""].filter(Boolean).join("; ");
      if (summary || !refreshed) setError([summary, !refreshed ? "The upload finished, but the file list could not be refreshed." : ""].filter(Boolean).join(" "));
      if (uploaded) setNotice(`${uploaded} file${uploaded === 1 ? "" : "s"} uploaded to TMP Cloud${summary ? ` · ${summary}` : ""}.`);
      else if (skipped && !failures.length) setNotice(`No replacement made; ${skipped} file${skipped === 1 ? "" : "s"} skipped.`);
      else if (failures.length) setNotice("Cloud upload batch finished with errors.");
    } finally {
      setBusy(false);
      setUploadProgress(null);
      setUploadStatus("");
    }
  }

  async function backupMinecraft() {
    setBusy(true);
    setError("");
    try {
      const response = await cloudRequest("/api/minecraft/backup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(routeError(response, payload, "Minecraft backup"));
      await loadCloudFiles();
      setNotice("Minecraft rolling backup saved to the verified external HDD.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Minecraft backup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadFile(file: CloudFile) {
    try {
      type FilePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<FileSystemWritableFileStream> }> };
      const picker = (window as FilePickerWindow).showSaveFilePicker;
      const handle = picker ? await picker.call(window, { suggestedName: file.name }) : null;
      const response = await cloudRequest(`/api/cloud/download?path=${encodeURIComponent(file.path)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(routeError(response, payload, "Cloud download"));
      }
      if (handle && response.body) {
        await response.body.pipeTo(await handle.createWritable());
        setNotice(`${file.name} downloaded.`);
        return;
      }
      if (file.size > 1024 ** 3) throw new Error("This browser cannot safely stream downloads larger than 1 GiB. Use a browser with the save-file picker or download directly on the host.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setError(failure instanceof Error ? failure.message : "Cloud download failed.");
    }
  }

  const previewFile = useCallback(async (file: CloudFile): Promise<Blob> => {
    const response = await cloudRequest(`/api/cloud/preview?path=${encodeURIComponent(file.path)}`, { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(routeError(response, payload, "Cloud preview"));
    }
    return response.blob();
  }, [cloudRequest]);

  async function deleteFile(file: CloudFile) {
    if (!window.confirm(`Delete ${file.path} from TMP Cloud? This permanently removes the file from host storage.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await cloudRequest("/api/cloud/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: file.path }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(routeError(response, payload, "Cloud delete"));
      await loadCloudFiles();
      setNotice(`${file.name} deleted.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Cloud delete failed.");
    } finally {
      setBusy(false);
    }
  }

  const owner = isOwnerSession(session);

  if (!supabaseConfigured) return <div className="tmp-cloud-gate" data-theme={effectiveTheme}><section className="tmp-cloud-auth-card" role="alert"><span className="tmp-cloud-auth-icon"><LockKeyhole size={23} /></span><p className="tmp-cloud-eyebrow">TMP CLOUD / SETUP REQUIRED</p><h1>Private Cloud access is unavailable.</h1><p>Supabase owner-auth settings are missing from this build. No Cloud data is loaded until the existing owner allowlist is configured.</p></section></div>;
  if (checking) return <div className="tmp-cloud-gate" data-theme={effectiveTheme}><div className="tmp-cloud-loading" role="status"><LoaderCircle size={19} className="tmp-cloud-spin" /> Checking the owner session…</div></div>;
  if (session && !owner) return <div className="tmp-cloud-gate" data-theme={effectiveTheme}><section className="tmp-cloud-auth-card"><span className="tmp-cloud-auth-icon"><LockKeyhole size={23} /></span><p className="tmp-cloud-eyebrow">TMP CLOUD / ACCESS DENIED</p><h1>This Cloud is owner-only.</h1><p>The signed-in Supabase account is not the configured TMP Server owner. No Cloud files have been requested.</p><button className="tmp-cloud-button" onClick={() => void signOut()}><LogOut size={15} /> Sign out and use owner account</button></section></div>;
  if (!owner) return <div className="tmp-cloud-gate" data-theme={effectiveTheme}><section className="tmp-cloud-auth-card" aria-labelledby="tmp-cloud-auth-title"><span className="tmp-cloud-auth-icon"><LockKeyhole size={23} /></span><p className="tmp-cloud-eyebrow">TMP CLOUD / OWNER ACCESS</p><h1 id="tmp-cloud-auth-title">Your files, privately.</h1>{!ownerEmail ? <p>Owner email is not configured. Cloud stays locked until the existing owner allowlist is restored.</p> : codeSent ? <><p>A one-time code was sent to <strong>{ownerEmail}</strong>. Enter it here to open TMP Cloud.</p><form className="tmp-cloud-auth-form" onSubmit={verifyCode}><label htmlFor="tmp-cloud-code">Email verification code</label><input id="tmp-cloud-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} placeholder="123456" maxLength={10} required />{authError && <p className="tmp-cloud-error" role="alert">{authError}</p>}<button className="tmp-cloud-button primary" type="submit" disabled={authBusy}>{authBusy ? "Verifying…" : "Verify and open TMP Cloud"}<ArrowRight size={15} /></button><button className="tmp-cloud-button secondary" type="button" onClick={() => { setCodeSent(false); setCode(""); setAuthError(""); }}>Use a different email</button></form></> : <><p>Sign in with the configured TMP Server owner account. Public sign-up is disabled.</p><form className="tmp-cloud-auth-form" onSubmit={sendCode}><label htmlFor="tmp-cloud-email">Owner email</label><input id="tmp-cloud-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required />{authError && <p className="tmp-cloud-error" role="alert">{authError}</p>}<button className="tmp-cloud-button primary" type="submit" disabled={authBusy}>{authBusy ? "Sending code…" : "Send owner sign-in code"}<ArrowRight size={15} /></button><small><ShieldCheck size={14} /> Access restricted to {ownerEmail}.</small></form></>}</section></div>;

  return <div className="tmp-cloud-root" data-theme={effectiveTheme} data-density={density}>
    <header className="tmp-cloud-topbar">
      <a className="tmp-cloud-brand" href="https://cloud.tmpserver.com/" aria-label="TMP Cloud home"><span className="tmp-cloud-brand-mark"><Cloud size={19} /></span><span><strong>TMP</strong><b>CLOUD</b><small>PRIVATE FILE CONSOLE</small></span></a>
      <label className="tmp-cloud-top-search"><Search size={17} /><input ref={searchInputRef} value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search files in this folder" aria-label="Search TMP Cloud files and folders" /><kbd>/</kbd></label>
      <div className="tmp-cloud-top-actions"><span className="tmp-cloud-owner"><ShieldCheck size={14} /> Owner only</span><button type="button" className="tmp-cloud-refresh" onClick={() => void refreshCloud()} disabled={busy || storageAvailable !== true} aria-label="Refresh Cloud files" title="Refresh"><RefreshCw size={16} /></button><div className="tmp-cloud-account-area" ref={accountMenuRef}><button type="button" className="tmp-cloud-avatar" onClick={() => setAccountMenuOpen(value => !value)} title={`Account settings for ${ownerEmail}`} aria-label={`Open account menu for ${ownerEmail}`} aria-haspopup="menu" aria-expanded={accountMenuOpen}><span>{ownerEmail.slice(0, 1).toUpperCase()}</span><ChevronDown size={12} /></button>{accountMenuOpen && <div className="tmp-cloud-account-menu" role="menu" aria-label="TMP Cloud account"><div className="tmp-cloud-account-summary"><span className="tmp-cloud-avatar-large">{ownerEmail.slice(0, 1).toUpperCase()}</span><span><strong>{ownerEmail}</strong><small>TMP Server owner</small></span></div><button type="button" role="menuitem" onClick={() => { setSettingsOpen(true); setAccountMenuOpen(false); }}><Settings2 size={16} /><span>Account settings</span><ChevronRight size={15} /></button><button type="button" role="menuitem" onClick={() => void signOut()}><LogOut size={16} /><span>Sign out</span></button></div>}</div></div>
    </header>
    <div className="tmp-cloud-breadcrumb-strip"><div className="tmp-cloud-path-label"><Cloud size={14} /><span>Storage</span><span className="tmp-cloud-separator">/</span><strong>My Cloud</strong></div><div className="tmp-cloud-security"><HardDrive size={13} /> {storageAvailable === true ? "Verified external HDD" : storageAvailable === false ? "External HDD unavailable" : "Storage status pending"}</div></div>
    <main className="tmp-cloud-main">
      {notice && <div className="tmp-cloud-notice" role="status">{notice}</div>}
      {error && <div className="tmp-cloud-global-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      <CloudPanel
        files={files}
        folders={folders}
        usedBytes={usedBytes}
        busy={busy}
        error=""
        storageAvailable={storageAvailable}
        uploadProgress={uploadProgress}
        uploadStatus={uploadStatus}
        onUpload={uploadFiles}
        onCreateFolder={createFolder}
        onBackup={() => void backupMinecraft()}
        onDownload={file => void downloadFile(file)}
        onPreview={previewFile}
        onDelete={file => void deleteFile(file)}
        standalone
        autoPreviewsEnabled={autoPreviews}
        category={category}
        onCategoryChange={setCategory}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onRefresh={() => void refreshCloud()}
      />
    </main>
    {settingsOpen && <div className="tmp-cloud-settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="tmp-cloud-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="tmp-cloud-settings-title"><header><div><p className="tmp-cloud-eyebrow">TMP CLOUD / PREFERENCES</p><h2 id="tmp-cloud-settings-title">Account settings</h2></div><button type="button" className="tmp-cloud-settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close account settings"><X size={18} /></button></header><div className="tmp-cloud-settings-profile"><span className="tmp-cloud-avatar-large">{ownerEmail.slice(0, 1).toUpperCase()}</span><span><strong>{ownerEmail}</strong><small><ShieldCheck size={13} /> Owner account · protected access</small></span></div><section className="tmp-cloud-settings-section"><div><h3>Appearance</h3><p>Choose how TMP Cloud looks on this device.</p></div><div className="tmp-cloud-choice-grid" role="radiogroup" aria-label="Appearance"><button type="button" role="radio" aria-checked={appearance === "light"} className={appearance === "light" ? "selected" : ""} onClick={() => setAppearance("light")}><Sun size={17} /><strong>Light</strong><small>Bright surfaces</small>{appearance === "light" && <Check size={15} className="selected-check" />}</button><button type="button" role="radio" aria-checked={appearance === "dark"} className={appearance === "dark" ? "selected" : ""} onClick={() => setAppearance("dark")}><Moon size={17} /><strong>Dark</strong><small>Low-light comfort</small>{appearance === "dark" && <Check size={15} className="selected-check" />}</button><button type="button" role="radio" aria-checked={appearance === "system"} className={appearance === "system" ? "selected" : ""} onClick={() => setAppearance("system")}><Monitor size={17} /><strong>System</strong><small>Follow device setting</small>{appearance === "system" && <Check size={15} className="selected-check" />}</button></div></section><section className="tmp-cloud-settings-section"><div><h3>Display density</h3><p>Adjust the space used by file cards.</p></div><div className="tmp-cloud-segmented" role="radiogroup" aria-label="Display density"><button type="button" role="radio" aria-checked={density === "comfortable"} className={density === "comfortable" ? "selected" : ""} onClick={() => setDensity("comfortable")}>Comfortable</button><button type="button" role="radio" aria-checked={density === "compact"} className={density === "compact" ? "selected" : ""} onClick={() => setDensity("compact")}>Compact</button></div></section><section className="tmp-cloud-settings-section"><div><h3>File previews</h3><p>Safe image, PDF, and text previews stay within the existing size limits.</p></div><label className="tmp-cloud-switch"><span><strong>Automatic inline previews</strong><small>Load previews as eligible files enter view.</small></span><input type="checkbox" role="switch" checked={autoPreviews} onChange={event => setAutoPreviews(event.target.checked)} /><span className="tmp-cloud-switch-track" aria-hidden="true" /></label></section><p className="tmp-cloud-settings-note">These preferences are saved only in this browser. They do not change your owner sign-in, Gmail settings, server configuration, or files.</p></section></div>}
    <footer className="tmp-cloud-footer"><span><ShieldCheck size={13} /> Private TMP Server storage · content stays on the verified external HDD</span><a href="https://tmpserver.com/">Return to TMP Server</a></footer>
  </div>;
}
