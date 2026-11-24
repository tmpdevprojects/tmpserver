import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  CloudCog,
  Cpu,
  Database,
  Download,
  FileClock,
  Globe,
  HardDrive,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MemoryStick,
  Menu,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  Save as SaveIcon,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  Users,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  initialActivity,
  initialServices,
  type Activity,
  type CloudFile,
  type HostState,
  type LogEntry,
  type PluginFile,
  type SettingsSnapshot,
  type Website,
  type Service,
  type ServiceKind,
  type ServiceState,
} from "@/lib/tmp-data";
import { isAllowedSession, isOwnerSession, ownerEmail, sessionLabel, supabase, supabaseConfigured } from "@/lib/supabase";

const staticPages = import.meta.env.VITE_STATIC_ONLY === "true";
const hostApiUrl = (import.meta.env.VITE_HOST_API_URL as string | undefined)?.trim() ?? "";

type NavKey = "overview" | "services" | "nodes" | "logs" | "alerts" | "websites" | "cloud" | "plugins" | "diagnostics" | "admin" | "settings";

const navItems: { id: NavKey; label: string; icon: typeof LayoutDashboard; count?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "services", label: "Services", icon: Boxes },
  { id: "nodes", label: "Nodes", icon: Server },
  { id: "logs", label: "Logs", icon: FileClock },
  { id: "alerts", label: "Alerts", icon: TriangleAlert },
  { id: "websites", label: "Websites", icon: Globe },
  { id: "cloud", label: "Cloud", icon: Cloud },
  { id: "plugins", label: "MC Plugins", icon: Box },
  { id: "diagnostics", label: "Diagnostics", icon: ActivityIcon },
  { id: "admin", label: "Admin", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function Logo() {
  return <div className="brand"><span className="brand-mark"><span /></span><span><strong>TMP</strong><em>SERVER</em></span></div>;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatRate(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 B/s";
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatUptime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const MANUAL_SERVICES_KEY = "tmpserver.manual-services.v1";

function readManualServices(): Service[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(MANUAL_SERVICES_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    const allowedStates: ServiceState[] = ["running", "degraded", "stopped", "restarting"];
    const allowedKinds: ServiceKind[] = ["Minecraft", "Container", "Web app", "Database", "Proxy"];
    return saved.filter((item): item is Service => Boolean(
      item && typeof item === "object" &&
      (item as Service).manual === true && typeof (item as Service).id === "string" &&
      typeof (item as Service).name === "string" && allowedKinds.includes((item as Service).kind) &&
      allowedStates.includes((item as Service).state)
    )).map(item => ({ ...item, health: null, restarts: null, boot: null, uptime: "—", checkEvery: "Browser-local status", restartPolicy: "Not applicable · browser only" }));
  } catch {
    return [];
  }
}

function StatusDot({ state }: { state: ServiceState }) {
  return <span className={`status-dot ${state}`} aria-label={state} />;
}

function StateBadge({ state }: { state: ServiceState }) {
  const labels: Record<ServiceState, string> = { running: "Running", stopped: "Stopped", degraded: "Degraded", restarting: "Restarting" };
  return <span className={`state-badge ${state}`}><StatusDot state={state} />{labels[state]}</span>;
}

function MetricCard({ label, value, suffix, detail, tone = "blue", icon: Icon, children }: { label: string; value: string; suffix?: string; detail: string; tone?: string; icon: typeof Cpu; children?: React.ReactNode }) {
  return <div className="metric-card">
    <div className="metric-head"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={15} /></span></div>
    <div className="metric-value">{value}<small>{suffix}</small></div>
    <div className="metric-detail">{detail}</div>
    {children}
  </div>;
}

function ServiceIcon({ kind }: { kind: ServiceKind }) {
  const Icon = kind === "Minecraft" ? Box : kind === "Database" ? Database : kind === "Proxy" ? Network : kind === "Web app" ? CloudCog : Archive;
  return <span className="service-icon"><Icon size={16} /></span>;
}

function ConfigGate() {
  return <div className="gate-wrap"><div className="gate-card">
    <div className="gate-mark"><LockKeyhole size={26} /></div>
    <p className="eyebrow">TMP SERVER / SETUP REQUIRED</p>
    <h1>Connect your private control plane.</h1>
    <p className="gate-copy">Supabase credentials are not configured in this environment. TMP Server stays locked rather than creating a fake session or exposing service controls.</p>
    <div className="config-list">
      <div><code>VITE_SUPABASE_URL</code><span>Project URL</span></div>
      <div><code>VITE_SUPABASE_ANON_KEY</code><span>Browser-safe anon key</span></div>
      <div><code>VITE_SUPABASE_OWNER_EMAIL</code><span>Single owner allowlist</span></div>
    </div>
    <div className="gate-foot"><ShieldCheck size={15} /> No public registration · owner allowlist required</div>
  </div></div>;
}

function LoginGate({ session, onRefresh }: { session: Session | null; onRefresh: () => void }) {
  const [email, setEmail] = useState(ownerEmail);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const denied = Boolean(session && !isOwnerSession(session));

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !email) return;
    const normalizedEmail = email.trim().toLowerCase();
    setEmail(normalizedEmail);
    setBusy(true); setError("");
    const result = await supabase.auth.signInWithOtp({ email: normalizedEmail, options: { shouldCreateUser: false, emailRedirectTo: undefined } });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else setOtpSent(true);
  }

  async function verifyOtp(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedOtp = otp.replace(/\s/g, "");
    if (!supabase || !normalizedEmail || normalizedOtp.length < 6) return;
    setBusy(true); setError("");
    const result = await supabase.auth.verifyOtp({ email: normalizedEmail, token: normalizedOtp, type: "email" });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else onRefresh();
  }

  async function signOut() {
    await supabase?.auth.signOut();
    onRefresh();
  }

  return <div className="gate-wrap"><div className="gate-card login-card">
    <div className="gate-mark"><LockKeyhole size={26} /></div>
    <p className="eyebrow">TMP SERVER / OWNER ACCESS</p>
    <h1>Private infrastructure, by design.</h1>
    {denied ? <>
      <p className="gate-copy danger-copy">This Supabase account is not the configured TMP Server owner. The session has no access to the control plane.</p>
      <button className="button secondary full" onClick={signOut}><LogOut size={15} /> Sign out and try another account</button>
    </> : otpSent ? <>
      <p className="gate-copy">A verification code was sent to <b>{email}</b>. Enter the complete code below to continue. This console never exposes a public sign-up flow.</p>
      <form onSubmit={verifyOtp}><label className="field-label">Email verification code<input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ""))} placeholder="123456" required /></label>{error && <p className="form-error">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? "Verifying…" : "Verify code"}<ShieldCheck size={15} /></button><button type="button" className="button secondary full otp-back" onClick={() => { setOtpSent(false); setOtp(""); setError(""); }}>Use a different email</button></form>
    </> : <form onSubmit={sendMagicLink}>
      <label className="field-label">Owner email</label>
      <div className="input-row"><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="owner@example.com" required /><button className="button primary" disabled={busy}>{busy ? "Sending code…" : "Send email code"}<ArrowUpRight size={15} /></button></div>
      {error && <p className="form-error">{error}</p>}
      <p className="form-hint"><ShieldCheck size={14} /> Access is restricted to the configured owner account.</p>
    </form>}
  </div></div>;
}

function HostUnavailable() {
  return <div className="gate-wrap"><div className="gate-card login-card">
    <div className="gate-mark"><Server size={26} /></div>
    <p className="eyebrow">TMP SERVER / NO LIVE HOST</p>
    <h1>Connect a real service host.</h1>
    <p className="gate-copy">No supervisor agent is connected, so TMP Server is withholding service state, uptime, metrics, logs, user counts, and lifecycle controls. This screen will not show sample data.</p>
    <div className="config-list">
      <div><code>HOST AGENT</code><span>Not connected</span></div>
      <div><code>LIVE METRICS</code><span>Unavailable</span></div>
      <div><code>HOST CONTROLS</code><span>Disabled</span></div>
    </div>
    <div className="gate-foot"><ShieldCheck size={15} /> Connect a persistent Linux host with the TMP supervisor before enabling production controls.</div>
  </div></div>;
}

const CLOUD_FILE_MAX_BYTES = 20 * 1024 ** 3;
const CLOUD_CHUNK_BYTES = 64 * 1024 ** 2;

function CloudPanel({ files, usedBytes, busy, error, uploadProgress, onUpload, onBackup, onDownload, onDelete }: { files: CloudFile[]; usedBytes: number; busy: boolean; error: string; uploadProgress: number | null; onUpload: (file: File) => void; onBackup: () => void; onDownload: (file: CloudFile) => void; onDelete: (file: CloudFile) => void }) {
  return <section className="cloud-page"><div className="cloud-hero"><div><p className="eyebrow">PRIVATE VM STORAGE</p><h2>Cloud files</h2><p>Persistent files stored on the connected host at <code>/opt/tmpserver/cloud</code>. Any file type is supported, up to 20 GB per file. Large uploads are streamed in 64 MiB chunks instead of buffering the full file in memory.</p><p className="route-help"><strong>Minecraft backup:</strong> <code>minecraft-latest.tar.gz</code> is overwritten before controlled Minecraft stop/restart/update/settings actions. A shutdown-time backup requires a separately installed host hook; this panel does not verify that hook.</p><p className="route-help">Website deployments are separate and accept ZIP archives only (50 MB maximum).</p></div><div className="cloud-hero-actions"><button className="button secondary" onClick={onBackup} disabled={busy}><Archive size={15} /> {busy ? "Working…" : "Back up Minecraft"}</button><label className="button primary upload-button"><Upload size={15} /> {busy ? "Uploading…" : "Upload any file"}<input type="file" aria-label="Choose any file, up to 20 GB" onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} disabled={busy} /></label></div></div>{error && <p className="form-error">{error}</p>}{uploadProgress !== null && <div className="upload-progress"><div><b>Uploading Cloud file</b><span>{uploadProgress}% · 64 MiB chunks · do not close this page</span></div><div className="meter"><span style={{ width: `${uploadProgress}%` }} /></div></div>}<div className="cloud-stats"><div><span>FILES</span><b>{files.length}</b></div><div><span>USED</span><b>{formatBytes(usedBytes)}</b></div><div><span>MAX / FILE</span><b>20 GB</b></div></div><div className="cloud-table"><div className="cloud-row cloud-head"><span>NAME</span><span>SIZE</span><span>MODIFIED</span><span /></div>{files.length ? files.map(file => <div className="cloud-row" key={file.path}><span className="cloud-name"><Archive size={15} />{file.path}</span><span>{formatBytes(file.size)}</span><span>{new Date(file.modified * 1000).toLocaleString()}</span><span className="cloud-actions"><button className="icon-button" title="Download" aria-label={`Download ${file.name}`} onClick={() => onDownload(file)}><Download size={15} /></button><button className="icon-button" title="Delete" aria-label={`Delete ${file.name}`} onClick={() => onDelete(file)} disabled={busy}><Trash2 size={15} /></button></span></div>) : <div className="cloud-empty"><Cloud size={22} /><p>No files stored yet. Upload any file type up to 20 GB.</p></div>}</div><p className="route-help">Deleting a Cloud file removes that file from host storage after confirmation. Uploading a file with an existing name replaces it after confirmation.</p></section>;
}

function WebsitesPanel({ sites, busy, error, name, setName, domain, setDomain, onCreate, onDeploy, onLifecycle, onDelete }: { sites: Website[]; busy: boolean; error: string; name: string; setName: (value: string) => void; domain: string; setDomain: (value: string) => void; onCreate: (event: React.FormEvent) => void; onDeploy: (site: Website, file: File) => void; onLifecycle: (site: Website, action: "start" | "stop") => void; onDelete: (site: Website) => void }) {
  return <section className="cloud-page"><div className="cloud-hero"><div><p className="eyebrow">STATIC WEBSITE HOSTING</p><h2>Websites</h2><p>Deploy static HTML/CSS/JS sites to the connected TMP Server Linux host. Caddy serves managed static files over HTTPS; visitor access follows each site’s public DNS and Caddy configuration.</p><p className="route-help"><strong>Safe scope:</strong> ZIP deployments must contain <code>index.html</code>. Node/PHP runtimes are not enabled by this panel yet.</p></div></div><form className="website-create" onSubmit={onCreate}><input value={name} onChange={event => setName(event.target.value)} placeholder="Site name" required /><input value={domain} onChange={event => setDomain(event.target.value)} placeholder="www.example.com" required /><button className="button primary" type="submit" disabled={busy}><Plus size={15} /> Create website</button></form>{error && <p className="form-error">{error}</p>}<div className="cloud-stats"><div><span>SITES</span><b>{sites.length}</b></div><div><span>ACTIVE</span><b>{sites.filter(site => site.active).length}</b></div><div><span>DEPLOYMENT</span><b>ZIP / 50 MB</b></div></div><div className="website-grid">{sites.length ? sites.map(site => <article className="website-card" key={site.slug}><div className="website-card-head"><div><p className="eyebrow">{site.active ? "ACTIVE" : "STOPPED"}</p><h3>{site.name}</h3></div><span className={`status-dot ${site.active ? "running" : "stopped"}`} /></div><p className="website-domain">{site.domain}</p><div className="website-meta"><span>{site.files} files</span><span>{formatBytes(site.bytes)}</span></div><div className="website-actions"><label className="button secondary upload-button"><Upload size={14} /> Deploy ZIP<input type="file" accept=".zip,application/zip" onChange={event => { const file = event.target.files?.[0]; if (file) onDeploy(site, file); event.currentTarget.value = ""; }} disabled={busy} /></label><button className="button secondary" onClick={() => onLifecycle(site, site.active ? "stop" : "start")} disabled={busy}>{site.active ? <Square size={14} /> : <Play size={14} />}{site.active ? "Stop" : "Start"}</button><button className="icon-button" title="Delete website" onClick={() => onDelete(site)} disabled={busy}><Trash2 size={15} /></button></div></article>) : <div className="cloud-empty"><Globe size={22} /><p>No websites yet. Create a site, point DNS at 140.238.70.11, then deploy a ZIP.</p></div>}</div></section>;
}

function LogsPanel({ logs, error, filter, onFilter, onRefresh }: { logs: LogEntry[]; error: string; filter: string; onFilter: (value: string) => void; onRefresh: () => void }) {
  const services = Array.from(new Set(logs.map(log => log.service))).sort();
  const visible = logs.filter(log => filter === "all" || log.service === filter);
  return <section className="settings-page"><div className="cloud-hero"><div><p className="eyebrow">LIVE / DOCKER OUTPUT</p><h2>Container logs</h2><p>Recent output from running Docker containers, fetched directly from the host. This view does not include systemd journal, Caddy access logs, or persistent log history.</p></div><button className="button secondary" onClick={onRefresh}><RefreshCw size={15} /> Refresh logs</button></div><article className="panel log-page-panel"><div className="panel-header compact"><div><p className="eyebrow">LATEST SNAPSHOT</p><h2>{visible.length} lines shown <span>{logs.length} total</span></h2></div><div className="log-controls"><select aria-label="Filter live logs by container" value={filter} onChange={event => onFilter(event.target.value)}><option value="all">All containers</option>{services.map(service => <option key={service} value={service}>{service}</option>)}</select><TerminalSquare size={15} /></div></div><div className="log-list">{visible.map((log, index) => <div className="log-line" key={`${log.timestamp ?? log.time}-${log.service}-${index}`}><span>{log.time}</span><b className={log.level === "WARN" ? "warn" : log.level === "ERROR" ? "error" : "info"}>{log.level}</b><strong>{log.service}</strong><p>{log.message}</p></div>)}{!visible.length && <div className="log-empty">{error || "No recent Docker container logs were returned by the host agent."}</div>}</div><p className="route-help">Refresh polls the host agent for the latest bounded container output; it does not run commands inside containers.</p></article></section>;
}

type HostAlert = { title: string; detail: string; tone: "warning" | "danger" };

function getHostAlerts(hostState: HostState, settings: SettingsSnapshot | null): HostAlert[] {
  const alerts: HostAlert[] = [];
  if (hostState.minecraft.health !== "healthy") alerts.push({ title: "Minecraft health is not healthy", detail: `Current Docker health state: ${hostState.minecraft.health}.`, tone: "danger" });
  if (hostState.memory.usedPercent >= 90) alerts.push({ title: "System memory is critically high", detail: `${hostState.memory.usedPercent}% of host memory is in use.`, tone: "danger" });
  if (hostState.disk.usedPercent >= 90) alerts.push({ title: "System disk is critically full", detail: `${hostState.disk.usedPercent}% of the root disk is in use.`, tone: "danger" });
  for (const service of hostState.services.filter(item => /unhealthy|restarting|dead|exited/i.test(item.status))) alerts.push({ title: `${service.name} needs attention`, detail: `Host-reported status: ${service.status}.`, tone: /unhealthy|dead|exited/i.test(service.status) ? "danger" : "warning" });
  if (settings?.admin.failedUnits.length) alerts.push({ title: "Failed systemd units reported", detail: settings.admin.failedUnits.join(", "), tone: "danger" });
  const external = settings?.admin.externalStorage;
  if (external && !external.mounted) alerts.push({ title: "External backup HDD is not mounted", detail: "The configured /mnt/tmpserver-hdd backup target is unavailable until the drive is mounted.", tone: "warning" });
  if (external?.mounted && !external.cloudOnExternal) alerts.push({ title: "Cloud storage is not on the mounted HDD", detail: "The host reports that /opt/tmpserver/cloud is backed by a different device.", tone: "warning" });
  return alerts;
}

function AlertsPanel({ hostState, settings, onNavigate }: { hostState: HostState; settings: SettingsSnapshot | null; onNavigate: (page: NavKey) => void }) {
  const alerts = getHostAlerts(hostState, settings);
  return <section className="settings-page"><div className="cloud-hero"><div><p className="eyebrow">CURRENT / TELEMETRY RULES</p><h2>Host attention</h2><p>These warnings are derived from the latest authenticated host snapshot. This dashboard does not yet send notifications or keep alert history.</p></div><button className="button secondary" onClick={() => onNavigate("diagnostics")}><ActivityIcon size={15} /> Open diagnostics</button></div><article className="panel alerts-page-panel"><div className="panel-header compact"><div><p className="eyebrow">CURRENT CONDITIONS</p><h2>{alerts.length ? `${alerts.length} condition${alerts.length === 1 ? "" : "s"}` : "No current conditions"}</h2></div><ShieldCheck size={17} className="settings-icon" /></div>{alerts.length ? alerts.map((alert, index) => <div className="alert-item" key={`${alert.title}-${index}`}><span className={`alert-icon ${alert.tone}`}><AlertTriangle size={15} /></span><div><b>{alert.title}</b><p>{alert.detail}</p></div></div>) : <div className="alerts-clear"><ShieldCheck size={20} /><p>No configured threshold was crossed in the current host snapshot.</p></div>}</article></section>;
}

function SettingsPanel({ settings, viewDistance, setViewDistance, simulationDistance, setSimulationDistance, maxPlayers, setMaxPlayers, busy, error, onSaveMinecraft, onBackup, onRefresh }: { settings: SettingsSnapshot | null; viewDistance: string; setViewDistance: (value: string) => void; simulationDistance: string; setSimulationDistance: (value: string) => void; maxPlayers: string; setMaxPlayers: (value: string) => void; busy: boolean; error: string; onSaveMinecraft: (event: React.FormEvent) => void; onBackup: () => void; onRefresh: () => void }) {
  if (!settings) return <div className="loading-screen"><div className="loading-orbit" /><span>Loading live settings…</span></div>;
  return <section className="settings-page"><div className="cloud-hero"><div><p className="eyebrow">DATACENTER / NODE CONFIGURATION</p><h2>Settings</h2><p>Live administration for the connected VM. Values below are read from the connected host and protected by the Supabase owner access policy.</p></div><button className="button secondary" onClick={onRefresh} disabled={busy}><RefreshCw size={15} /> Refresh live values</button></div>{error && <p className="form-error">{error}</p>}<div className="settings-grid"><div className="panel settings-card"><div className="panel-header compact"><div><p className="eyebrow">NODE IDENTITY</p><h2>{settings.host.hostname}</h2></div><span className="online-pill"><span /> {settings.agent.status}</span></div><div className="settings-list"><div><span>OPERATING SYSTEM</span><b>{settings.host.os}</b></div><div><span>ARCHITECTURE</span><b>{settings.host.architecture}</b></div><div><span>HOST UPTIME</span><b>{formatUptime(settings.host.uptimeSeconds)}</b></div><div><span>AGENT UPTIME</span><b>{formatUptime(settings.agent.uptimeSeconds)}</b></div></div></div><div className="panel settings-card"><div className="panel-header compact"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Supabase policy</h2></div><ShieldCheck size={17} className="settings-icon" /></div><div className="settings-list"><div><span>SESSION</span><b>Authenticated</b></div><div><span>ROLE</span><b>{settings.permissions.owner ? "Owner" : "Read-only"}</b></div><div><span>PUBLIC REGISTRATION</span><b>Disabled</b></div><div><span>HOST MUTATIONS</span><b>{settings.permissions.owner ? "Owner enabled" : "Read-only"}</b></div></div></div></div><div className="panel settings-card"><div className="panel-header compact"><div><p className="eyebrow">MINECRAFT / PAPER</p><h2>Runtime configuration</h2></div><Box size={17} className="settings-icon" /></div><form className="settings-form" onSubmit={onSaveMinecraft}><label className="field-label">View distance <span className="field-help">2–32 chunks</span><input type="number" min="2" max="32" value={viewDistance} onChange={event => setViewDistance(event.target.value)} disabled={!settings.permissions.owner || busy} /></label><label className="field-label">Simulation distance <span className="field-help">2–32 chunks</span><input type="number" min="2" max="32" value={simulationDistance} onChange={event => setSimulationDistance(event.target.value)} disabled={!settings.permissions.owner || busy} /></label><label className="field-label">Maximum players <span className="field-help">1–1000</span><input type="number" min="1" max="1000" value={maxPlayers} onChange={event => setMaxPlayers(event.target.value)} disabled={!settings.permissions.owner || busy} /></label><div className="settings-readonly"><span>WHITELIST ENFORCEMENT</span><b>{settings.minecraft.whitelist ? "Enabled" : "Disabled"}</b></div><button className="button primary" type="submit" disabled={!settings.permissions.owner || busy}><SaveIcon size={15} /> {busy ? "Applying safely…" : "Save and restart Minecraft"}</button></form><p className="route-help">Saving stops the server, confirms a rolling backup, updates Compose, and restarts Paper. The change is rejected if the backup fails.</p></div><div className="panel settings-card"><div className="panel-header compact"><div><p className="eyebrow">BACKUPS / RECOVERY</p><h2>Cloud protection</h2></div><Archive size={17} className="settings-icon" /></div><div className="settings-list"><div><span>ROLLING BACKUP</span><b>{settings.backup.present ? "Available" : "Not created"}</b></div><div><span>BACKUP SIZE</span><b>{settings.backup.present ? formatBytes(settings.backup.bytes) : "—"}</b></div><div><span>LOCATION</span><b>/opt/tmpserver/cloud</b></div><div><span>EXTERNAL HDD</span><b>{settings.admin.externalStorage?.mounted ? `${formatBytes(settings.admin.externalStorage.freeBytes)} free` : "Not mounted at /mnt/tmpserver-hdd"}</b></div></div><button className="button secondary full" onClick={onBackup} disabled={busy}><Archive size={15} /> Create backup now</button></div><div className="panel settings-card infrastructure-card"><div className="panel-header compact"><div><p className="eyebrow">NODE INFRASTRUCTURE</p><h2>VM-backed capabilities</h2></div><Server size={17} className="settings-icon" /></div><div className="capability-grid"><div><span>DOCKER</span><b>{settings.admin.capabilities.docker ? `Active · ${settings.admin.docker.version}` : "Unavailable"}</b><small>{settings.admin.docker.cpus} CPUs · {formatBytes(settings.admin.docker.memoryBytes)} RAM</small></div><div><span>EXTERNAL HDD</span><b>{settings.admin.externalStorage?.mounted ? `${settings.admin.externalStorage.usedPercent}% used` : "Not mounted"}</b><small>{settings.admin.externalStorage?.mounted ? `${formatBytes(settings.admin.externalStorage.freeBytes)} free · ${settings.admin.externalStorage.mount}` : "/mnt/tmpserver-hdd is not mounted"}</small></div><div><span>UFW FIREWALL</span><b>{settings.admin.firewall.active ? `Active · incoming ${settings.admin.firewall.defaultIncoming}` : settings.admin.firewall.defaultIncoming === "unknown" ? "Unavailable" : "Inactive"}</b><small>{settings.admin.firewall.rules.length} visible rules</small></div><div><span>NATIVE VMS</span><b>{settings.admin.capabilities.nativeVmManagement ? "Available" : "Not implemented by agent"}</b><small>{settings.admin.capabilities.kvm ? "/dev/kvm detected" : "Not detected"}</small></div></div>{settings.admin.failedUnits.length ? <p className="form-error">Failed systemd units: {settings.admin.failedUnits.join(", ")}</p> : <p className="route-help"><ShieldCheck size={13} /> No failed systemd units were reported in this snapshot. Native VM manager actions are not implemented by this host agent.</p>}</div></section>;
}

function PluginsPanel({ plugins, busy, error, owner, onUpload, onDelete, onRestart }: { plugins: PluginFile[]; busy: boolean; error: string; owner: boolean; onUpload: (file: File) => void; onDelete: (plugin: PluginFile) => void; onRestart: () => void }) {
  return <section className="cloud-page"><div className="cloud-hero"><div><p className="eyebrow">PAPER / MINECRAFT</p><h2>Plugin manager</h2><p>Manage actual <code>/opt/tmpserver/minecraft/data/plugins</code> JAR files on the connected Paper server. Changes require a Minecraft restart before Paper loads or unloads a plugin.</p><p className="route-help">Upload accepts valid Java archive files up to 50 MiB. Deleting a JAR leaves the plugin’s configuration and data folders untouched. Plugin changes are limited to the configured server owner.</p></div><div className="cloud-hero-actions"><label className="button primary upload-button"><Upload size={15} /> {busy ? "Working…" : "Upload plugin JAR"}<input type="file" accept=".jar,application/java-archive" aria-label="Choose a Minecraft plugin JAR" onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} disabled={busy || !owner} /></label><button className="button secondary" onClick={onRestart} disabled={busy}><RefreshCw size={15} /> Restart Minecraft</button></div></div>{error && <p className="form-error">{error}</p>}<div className="cloud-stats"><div><span>PLUGIN JARS</span><b>{plugins.length}</b></div><div><span>LOCATION</span><b className="compact-stat">Paper data folder</b></div><div><span>ACCESS</span><b className="compact-stat">{owner ? "Owner controls" : "Read-only"}</b></div></div><div className="cloud-table"><div className="cloud-row plugin-row plugin-head"><span>PLUGIN JAR</span><span>SIZE</span><span>MODIFIED</span><span /></div>{plugins.length ? plugins.map(plugin => <div className="cloud-row plugin-row" key={plugin.name}><span className="cloud-name"><Box size={15} />{plugin.name}</span><span>{formatBytes(plugin.size)}</span><span>{new Date(plugin.modified * 1000).toLocaleString()}</span><span className="cloud-actions"><button className="icon-button" title={`Delete ${plugin.name}`} aria-label={`Delete ${plugin.name}`} onClick={() => onDelete(plugin)} disabled={busy || !owner}><Trash2 size={15} /></button></span></div>) : <div className="cloud-empty"><Box size={22} /><p>No plugin JARs are installed in the Paper plugins folder.</p></div>}</div><p className="route-help">Installing or removing plugins runs no third-party installer: the selected JAR is copied to or deleted from the Paper plugins folder. Only install plugins you trust.</p></section>;
}

function DiagnosticsPanel({ hostState, settings, error, onRefresh, busy }: { hostState: HostState; settings: SettingsSnapshot | null; error: string; onRefresh: () => void; busy: boolean }) {
  const external = settings?.admin.externalStorage;
  const load = settings?.admin.loadAverage ?? [];
  return <section className="settings-page"><div className="cloud-hero"><div><p className="eyebrow">HOST / READ-ONLY DIAGNOSTICS</p><h2>Node diagnostics</h2><p>Read-only host state and admin capability snapshots. This agent does not provide host-level virtualization controls.</p></div><button className="button secondary" onClick={onRefresh} disabled={busy}><RefreshCw size={15} /> Refresh diagnostics</button></div>{error && <div className="alert-item" role="alert"><span className="alert-icon warning"><AlertTriangle size={15} /></span><div><b>{settings ? "One or more host snapshots may be stale" : "Admin telemetry is unavailable"}</b><p>{settings ? "Showing the last successful host/admin snapshots; values may be outdated." : "No successful admin snapshot is available yet."} {error}</p></div></div>}<div className="diagnostic-grid"><article className="panel diagnostic-card"><p className="eyebrow">OPERATING SYSTEM</p><h3>{hostState.host.os}</h3><div className="diagnostic-lines"><div><span>HOSTNAME</span><b>{hostState.host.hostname}</b></div><div><span>ARCHITECTURE</span><b>{hostState.host.architecture}</b></div><div><span>UPTIME</span><b>{formatUptime(hostState.host.uptimeSeconds)}</b></div><div><span>CPU CORES</span><b>{settings?.admin.cpuCount ?? "Not reported"}</b></div><div><span>LOAD AVERAGE</span><b>{load.length ? load.map(value => Number(value).toFixed(2)).join(" · ") : "Not reported"}</b></div></div></article><article className="panel diagnostic-card"><p className="eyebrow">MEMORY / SYSTEM DISK</p><h3>Resource utilization</h3><div className="diagnostic-lines"><div><span>RAM USED</span><b>{hostState.memory.usedPercent}% · {formatBytes(hostState.memory.totalBytes - hostState.memory.availableBytes)} / {formatBytes(hostState.memory.totalBytes)}</b></div><div><span>RAM AVAILABLE</span><b>{formatBytes(hostState.memory.availableBytes)}</b></div><div><span>ROOT DISK USED</span><b>{hostState.disk.usedPercent}% · {formatBytes(hostState.disk.totalBytes - hostState.disk.freeBytes)} / {formatBytes(hostState.disk.totalBytes)}</b></div><div><span>ROOT FREE</span><b>{formatBytes(hostState.disk.freeBytes)}</b></div></div></article><article className="panel diagnostic-card"><p className="eyebrow">NETWORK</p><h3>{hostState.network.interface}</h3><div className="diagnostic-lines"><div><span>LINK SPEED</span><b>{hostState.network.linkMbps ? `${hostState.network.linkMbps} Mbps` : "Not reported"}</b></div><div><span>RECEIVE RATE</span><b>{formatRate(hostState.network.rxBytesPerSecond)}</b></div><div><span>TRANSMIT RATE</span><b>{formatRate(hostState.network.txBytesPerSecond)}</b></div><div><span>DROPPED PACKETS</span><b>{hostState.network.rxDropped + hostState.network.txDropped}</b></div><div><span>SAMPLE AGE</span><b>{hostState.network.sampleSeconds}s</b></div></div></article><article className="panel diagnostic-card"><p className="eyebrow">EXTERNAL HDD</p><h3>{external?.mounted ? "Mounted" : "Not mounted"}</h3><div className="diagnostic-lines"><div><span>MOUNT</span><b>{external?.mount ?? "/mnt/tmpserver-hdd"}</b></div><div><span>CAPACITY</span><b>{external?.mounted ? formatBytes(external.totalBytes) : "Unavailable until mounted"}</b></div><div><span>FREE SPACE</span><b>{external?.mounted ? formatBytes(external.freeBytes) : "—"}</b></div><div><span>CLOUD ON HDD</span><b>{external?.mounted ? (external.cloudOnExternal ? "Yes" : "No · check bind mount") : "Not applicable"}</b></div><div><span>SYSTEM BACKUP DIRECTORY</span><b>{external?.mounted ? (external.systemBackupDirectoryPresent ? "Directory exists; contents unverified" : "Directory not found") : external?.systemBackupPath ?? "/mnt/tmpserver-hdd/tmpserver-restic"}</b></div></div></article><article className="panel diagnostic-card"><p className="eyebrow">DOCKER / VIRTUALIZATION</p><h3>{settings ? (settings.admin.capabilities.docker ? `Docker ${settings.admin.docker.version}` : "Docker unavailable") : "Not reported"}</h3><div className="diagnostic-lines"><div><span>DOCKER ROOT</span><b>{settings?.admin.docker.root ?? "Not reported"}</b></div><div><span>CONTAINERS REPORTED</span><b>{hostState.services.length}</b></div><div><span>KVM DEVICE</span><b>{settings ? (settings.admin.capabilities.kvm ? "/dev/kvm detected" : "Not detected") : "Not reported"}</b></div><div><span>NATIVE VM MANAGER</span><b>{settings ? (settings.admin.capabilities.nativeVmManagement ? "Available" : "Not implemented by agent") : "Not reported"}</b></div></div><p className="route-help">This host agent does not implement native VM manager actions; Docker and /dev/kvm entries report detected capabilities only.</p></article><article className="panel diagnostic-card"><p className="eyebrow">FIREWALL / FAILED UNITS</p><h3>{settings ? (settings.admin.firewall.active ? "Firewall active" : settings.admin.firewall.defaultIncoming === "unknown" ? "Firewall status unavailable" : "Firewall inactive") : "Firewall status unavailable"}</h3><div className="diagnostic-lines"><div><span>DEFAULT INCOMING</span><b>{settings?.admin.firewall.defaultIncoming ?? "Not reported"}</b></div><div><span>VISIBLE RULES</span><b>{settings ? settings.admin.firewall.rules.length : "Not reported"}</b></div><div><span>FAILED SYSTEMD UNITS</span><b>{settings ? settings.admin.failedUnits.length : "Not reported"}</b></div></div>{!settings ? <p className="route-help">No admin snapshot is available for failed systemd units.</p> : settings.admin.failedUnits.length ? <p className="form-error">{settings.admin.failedUnits.join(", ")}</p> : <p className="route-help">No failed systemd units were reported in this snapshot.</p>}</article></div><article className="panel diagnostic-card"><p className="eyebrow">HOST-REPORTED CONTAINERS / SITES</p><h3>Host-reported workloads</h3>{hostState.services.length ? <div className="diagnostic-lines">{hostState.services.map(service => <div key={service.name}><span>{service.name}</span><b>{service.status}{service.ports ? ` · ${service.ports}` : ""}</b></div>)}</div> : <p className="route-help">No Docker containers or managed websites were reported.</p>}</article></section>;
}

function AdminPanel({ settings, busy, error, isOwner, onRefresh, onBackup, onConsole, onNavigate }: { settings: SettingsSnapshot | null; busy: boolean; error: string; isOwner: boolean; onRefresh: () => void; onBackup: () => void; onConsole: () => void; onNavigate: (page: NavKey) => void }) {
  if (!settings) return <div className="loading-screen"><div className="loading-orbit" /><span>Loading admin capabilities…</span></div>;
  const external = settings.admin.externalStorage;
  return <section className="settings-page"><div className="cloud-hero"><div><p className="eyebrow">CONTROL PLANE / ADMINISTRATION</p><h2>Admin console</h2><p>Owner-authorized actions and live host capabilities. Controls are enabled only when a real backend action is available.</p></div><button className="button secondary" onClick={onRefresh} disabled={busy}><RefreshCw size={15} /> Refresh snapshot</button></div>{error && <p className="form-error">{error}</p>}<div className="settings-grid"><div className="panel settings-card"><div className="panel-header compact"><div><p className="eyebrow">ACCESS / SAFETY</p><h2>Control permissions</h2></div><ShieldCheck size={17} className="settings-icon" /></div><div className="settings-list"><div><span>SESSION</span><b>Authenticated</b></div><div><span>ROLE</span><b>{settings.permissions.owner ? "Owner" : "Read-only"}</b></div><div><span>HOST MUTATIONS</span><b>{isOwner ? "Owner controls enabled" : "Read-only"}</b></div><div><span>NATIVE VM ACTIONS</span><b>{settings.admin.capabilities.nativeVmManagement ? "Available" : "Not implemented by agent"}</b></div></div><p className="route-help">No host reboot or Proxmox-like VM controls are exposed unless the connected host reports a supported, allowlisted operation.</p></div><div className="panel settings-card"><div className="panel-header compact"><div><p className="eyebrow">BACKUPS / RECOVERY</p><h2>Backup destinations</h2></div><Archive size={17} className="settings-icon" /></div><div className="settings-list"><div><span>MINECRAFT ROLLING BACKUP</span><b>{settings.backup.present ? formatBytes(settings.backup.bytes) : "Not created"}</b></div><div><span>CLOUD PATH</span><b>/opt/tmpserver/cloud</b></div><div><span>EXTERNAL HDD</span><b>{external?.mounted ? `${formatBytes(external.freeBytes)} free` : "Not mounted"}</b></div><div><span>SYSTEM SNAPSHOT PATH</span><b>{external?.systemBackupPath ?? "/mnt/tmpserver-hdd/tmpserver-restic"}</b></div></div><button className="button secondary full" onClick={onBackup} disabled={busy || !isOwner}><Archive size={15} /> Create Minecraft backup now</button><p className="route-help">This panel reports only whether the target directory exists on the mounted HDD; it does not verify restic repository integrity or backup history.</p></div></div><div className="panel settings-card"><div className="panel-header compact"><div><p className="eyebrow">ADMIN PAGES</p><h2>Management tools</h2></div><Server size={17} className="settings-icon" /></div><div className="admin-tool-grid"><button className="button secondary" onClick={() => onNavigate("settings")}><Settings2 size={15} /> Minecraft settings</button><button className="button secondary" onClick={() => onNavigate("plugins")}><Box size={15} /> Plugin manager</button><button className="button secondary" onClick={() => onNavigate("diagnostics")}><ActivityIcon size={15} /> Node diagnostics</button><button className="button secondary" onClick={onConsole}><TerminalSquare size={15} /> Live RCON console</button><button className="button secondary" onClick={() => onNavigate("cloud")}><Cloud size={15} /> Cloud files</button><button className="button secondary" onClick={() => onNavigate("websites")}><Globe size={15} /> Managed websites</button></div></div></section>;
}

function MinecraftConsole({ command, setCommand, output, busy, error, onClose, onSubmit }: { command: string; setCommand: (value: string) => void; output: string[]; busy: boolean; error: string; onClose: () => void; onSubmit: (event: React.FormEvent) => void }) {
  return <><div className="drawer-head"><div><p className="eyebrow">MINECRAFT CONSOLE</p><h2>Live server console</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="console-warning"><ShieldCheck size={16} /><span>Commands run as the authenticated TMP operator through RCON. Never paste passwords or secrets.</span></div><div className="console-output">{output.length ? output.map((line, index) => <div key={`${index}-${line}`}><span>&gt;</span>{line}</div>) : <span className="console-empty">No commands sent this session.</span>}</div><form className="console-form" onSubmit={onSubmit}><input value={command} onChange={event => setCommand(event.target.value)} placeholder="say Hello from TMP Server" maxLength={240} autoFocus /><button className="button primary" type="submit" disabled={busy}><TerminalSquare size={15} /> {busy ? "Sending…" : "Send"}</button></form>{error && <p className="form-error">{error}</p>}</>;
}

function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [nav, setNav] = useState<NavKey>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [services, setServices] = useState<Service[]>(initialServices);
  const [manualServices, setManualServices] = useState<Service[]>(() => readManualServices());
  const [activity, setActivity] = useState<Activity[]>(initialActivity);
  const [selected, setSelected] = useState<Service | null>(initialServices[0] ?? null);
  const [drawer, setDrawer] = useState<"service" | "add" | "console" | null>(null);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [logFilter, setLogFilter] = useState("all");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logError, setLogError] = useState("");
  const [newService, setNewService] = useState({ name: "", kind: "Web app" as ServiceKind, port: "8088", domain: "" });
  const [hostState, setHostState] = useState<HostState | null>(null);
  const [hostError, setHostError] = useState("");
  const [consoleCommand, setConsoleCommand] = useState("");
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [consoleBusy, setConsoleBusy] = useState(false);
  const [consoleError, setConsoleError] = useState("");
  const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([]);
  const [cloudUsedBytes, setCloudUsedBytes] = useState(0);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [cloudUploadProgress, setCloudUploadProgress] = useState<number | null>(null);
  const [plugins, setPlugins] = useState<PluginFile[]>([]);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [pluginError, setPluginError] = useState("");
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteName, setWebsiteName] = useState("");
  const [websiteDomain, setWebsiteDomain] = useState("");
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [websiteError, setWebsiteError] = useState("");
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [settingsViewDistance, setSettingsViewDistance] = useState("32");
  const [settingsSimulationDistance, setSettingsSimulationDistance] = useState("16");
  const [settingsMaxPlayers, setSettingsMaxPlayers] = useState("1000");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setAuthReady(true); });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(""), 3400); return () => window.clearTimeout(timer); } }, [notice]);

  useEffect(() => { window.localStorage.setItem(MANUAL_SERVICES_KEY, JSON.stringify(manualServices)); }, [manualServices]);

  useEffect(() => {
    if (!hostApiUrl || !session) return;
    let active = true;
    async function loadHostState() {
      try {
        const response = await fetch(`${hostApiUrl}/api/state`, { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Host agent rejected the session.");
        if (active) {
          const state = payload as HostState;
          const minecraft: Service = { id: "minecraft", name: "Minecraft", kind: "Minecraft", source: "minecraft", state: state.minecraft.health === "healthy" ? "running" : "degraded", health: null, cpu: -1, memory: -1, memoryLimit: 0, port: state.minecraft.portJava, domain: undefined, uptime: "—", restarts: null, boot: null, checkEvery: "Docker health status", restartPolicy: "Not reported", dependencies: [], accent: "green", description: `Paper + Geyser · Java ${state.minecraft.portJava} · Bedrock ${state.minecraft.portBedrock}` };
          const hostedServices: Service[] = state.services.filter(item => item.name !== "tmpserver-minecraft").map(item => {
            const runningState = item.status === "running" || /^up\b/i.test(item.status);
            const unhealthy = /unhealthy|restarting|dead|exited/i.test(item.status);
            const isWebsite = Boolean(item.slug);
            const slug = item.slug ?? item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            return { id: `${isWebsite ? "website" : "container"}-${slug}`, name: item.name, kind: item.kind ?? "Container", source: isWebsite ? "website" : "container", websiteSlug: item.slug, state: unhealthy ? "degraded" : runningState ? "running" : "stopped", health: null, cpu: -1, memory: -1, memoryLimit: 0, port: 443, domain: item.domain, uptime: "—", restarts: null, boot: null, checkEvery: isWebsite ? "Caddy route" : "Docker status", restartPolicy: "Not reported", dependencies: isWebsite ? ["caddy"] : [], accent: unhealthy ? "amber" : runningState ? "green" : "slate", description: isWebsite ? `Host-managed static site · ${item.domain}` : `Live Docker telemetry · lifecycle controls are not linked for ${item.name}` };
          });
          const liveServices = [minecraft, ...hostedServices];
          const liveIds = new Set(liveServices.map(item => item.id));
          const mergedServices = [...liveServices, ...manualServices.filter(item => !liveIds.has(item.id))];
          setHostState(state); setServices(mergedServices); setSelected(current => current ? mergedServices.find(item => item.id === current.id) ?? current : mergedServices[0] ?? null); setHostError("");
        }
      } catch (error) { if (active) setHostError(error instanceof Error ? error.message : "Unable to reach host agent."); }
    }
    loadHostState();
    const timer = window.setInterval(loadHostState, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session, manualServices]);

  async function cloudRequest(path: string, init: RequestInit = {}) {
    if (!hostApiUrl || !supabase) throw new Error("Live host agent is not configured.");
    const { data } = await supabase.auth.getSession();
    const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${data.session?.access_token ?? ""}`);
    return fetch(`${hostApiUrl}${path}`, { ...init, headers });
  }

  async function loadLogs() {
    try { const response = await cloudRequest("/api/logs"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Could not load Docker logs."); setLogs(payload.logs ?? []); setLogError(""); }
    catch (error) { setLogError(error instanceof Error ? error.message : "Could not load Docker logs."); }
  }

  useEffect(() => {
    if (!session || !hostApiUrl) return;
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 15000);
    return () => window.clearInterval(timer);
  }, [session]);

  async function loadCloudFiles() {
    try { const response = await cloudRequest("/api/cloud/files"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Could not load cloud files."); setCloudFiles(payload.files ?? []); setCloudUsedBytes(payload.usedBytes ?? 0); setCloudError(""); }
    catch (error) { setCloudError(error instanceof Error ? error.message : "Could not load cloud files."); }
  }

  useEffect(() => { if (session && hostApiUrl) void loadCloudFiles(); }, [session]);

  async function loadWebsites() {
    try { const response = await cloudRequest("/api/websites"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Could not load websites."); setWebsites(payload.sites ?? []); setWebsiteError(""); }
    catch (error) { setWebsiteError(error instanceof Error ? error.message : "Could not load websites."); }
  }

  useEffect(() => { if (session && hostApiUrl) void loadWebsites(); }, [session]);

  async function loadSettings() {
    try { const response = await cloudRequest("/api/settings"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Could not load live settings."); const next = payload as SettingsSnapshot; setSettingsViewDistance(value => !settings || value === String(settings.minecraft.viewDistance) ? String(next.minecraft.viewDistance) : value); setSettingsSimulationDistance(value => !settings || value === String(settings.minecraft.simulationDistance) ? String(next.minecraft.simulationDistance) : value); setSettingsMaxPlayers(value => !settings || value === String(settings.minecraft.maxPlayers) ? String(next.minecraft.maxPlayers) : value); setSettings(next); setSettingsError(""); }
    catch (error) { setSettingsError(error instanceof Error ? error.message : "Could not load live settings."); }
  }

  useEffect(() => {
    if (!session || !hostApiUrl) return;
    void loadSettings();
    const timer = window.setInterval(() => void loadSettings(), 30000);
    return () => window.clearInterval(timer);
  }, [session]);

  async function saveMinecraftSettings(event: React.FormEvent) {
    event.preventDefault(); if (!settings?.permissions.owner) return;
    if (!window.confirm("Save these Minecraft settings? The server will stop, back up the world, and restart.")) return;
    setSettingsBusy(true); setSettingsError("");
    try { const response = await cloudRequest("/api/minecraft/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewDistance: Number(settingsViewDistance), simulationDistance: Number(settingsSimulationDistance), maxPlayers: Number(settingsMaxPlayers) }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Minecraft settings update failed."); await loadSettings(); if (payload.state) setHostState(payload.state as HostState); setNotice("Minecraft settings saved and server restarted safely."); }
    catch (error) { setSettingsError(error instanceof Error ? error.message : "Minecraft settings update failed."); }
    finally { setSettingsBusy(false); }
  }

  async function backupFromSettings() {
    setSettingsBusy(true); setSettingsError("");
    try { const response = await cloudRequest("/api/minecraft/backup", { method: "POST", headers: { "content-type": "application/json" } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error ?? "Minecraft backup failed."); await loadSettings(); await loadCloudFiles(); setNotice("Minecraft backup created in Cloud."); }
    catch (error) { setSettingsError(error instanceof Error ? error.message : "Minecraft backup failed."); }
    finally { setSettingsBusy(false); }
  }

  async function createWebsite(event: React.FormEvent) {
    event.preventDefault(); setWebsiteBusy(true); setWebsiteError("");
    try { const response = await cloudRequest("/api/websites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: websiteName, domain: websiteDomain }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Could not create website."); setWebsiteName(""); setWebsiteDomain(""); await loadWebsites(); setNotice(`Website ${payload.site.name} created.`); }
    catch (error) { setWebsiteError(error instanceof Error ? error.message : "Could not create website."); }
    finally { setWebsiteBusy(false); }
  }

  async function deployWebsite(site: Website, file: File) {
    if (!file.name.toLowerCase().endsWith(".zip")) { setWebsiteError("Choose a ZIP file."); return; }
    setWebsiteBusy(true); setWebsiteError("");
    try { const form = new FormData(); form.append("file", file); const response = await cloudRequest(`/api/websites/${site.slug}/deploy`, { method: "POST", body: form }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Website deployment failed."); await loadWebsites(); setNotice(`${site.name} deployed.`); }
    catch (error) { setWebsiteError(error instanceof Error ? error.message : "Website deployment failed."); }
    finally { setWebsiteBusy(false); }
  }

  async function websiteLifecycle(site: Website, action: "start" | "stop") {
    setWebsiteBusy(true); setWebsiteError("");
    try { const response = await cloudRequest(`/api/websites/${site.slug}/lifecycle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Website lifecycle action failed."); await loadWebsites(); setNotice(`${site.name} ${action}ed.`); }
    catch (error) { setWebsiteError(error instanceof Error ? error.message : "Website lifecycle action failed."); }
    finally { setWebsiteBusy(false); }
  }

  async function deleteWebsite(site: Website) {
    if (!window.confirm(`Delete ${site.name} and all deployed files?`)) return;
    setWebsiteBusy(true); setWebsiteError("");
    try { const response = await cloudRequest(`/api/websites/${site.slug}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Website deletion failed."); await loadWebsites(); setNotice(`${site.name} deleted.`); }
    catch (error) { setWebsiteError(error instanceof Error ? error.message : "Website deletion failed."); }
    finally { setWebsiteBusy(false); }
  }

  async function uploadCloudFile(file: File) {
    if (file.size > CLOUD_FILE_MAX_BYTES) { setCloudError("Cloud files are limited to 20 GB per file."); return; }
    if (cloudFiles.some(item => item.path === file.name) && !window.confirm(`Replace the existing Cloud file ${file.name}?`)) return;
    const uploadId = crypto.randomUUID().replace(/-/g, "");
    const totalChunks = Math.ceil(file.size / CLOUD_CHUNK_BYTES);
    setCloudBusy(true); setCloudError(""); setCloudUploadProgress(0);
    try {
      for (let index = 0; index < totalChunks; index += 1) {
        const query = new URLSearchParams({ uploadId, index: String(index), total: String(totalChunks), path: file.name });
        const response = await cloudRequest(`/api/cloud/upload-chunk?${query.toString()}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file.slice(index * CLOUD_CHUNK_BYTES, Math.min(file.size, (index + 1) * CLOUD_CHUNK_BYTES)) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? `Upload failed at chunk ${index + 1} of ${totalChunks}.`);
        setCloudUploadProgress(totalChunks ? Math.min(99, Math.floor(((index + 1) / totalChunks) * 100)) : 99);
      }
      const response = await cloudRequest("/api/cloud/upload-complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId, path: file.name, size: file.size, totalChunks }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Cloud upload could not be completed.");
      setCloudUploadProgress(100); await loadCloudFiles(); setNotice(`${file.name} uploaded to the VM Cloud.`);
    } catch (error) {
      try { await cloudRequest("/api/cloud/upload-cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId }) }); } catch { /* a failed connection may prevent cleanup; stale chunks are removed after 24 hours */ }
      setCloudError(error instanceof Error ? error.message : "Cloud upload failed.");
    } finally { setCloudBusy(false); setCloudUploadProgress(null); }
  }

  async function loadPlugins() {
    try { const response = await cloudRequest("/api/minecraft/plugins"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Could not load Minecraft plugins."); setPlugins(payload.plugins ?? []); setPluginError(""); }
    catch (error) { setPluginError(error instanceof Error ? error.message : "Could not load Minecraft plugins."); }
  }

  useEffect(() => { if (session && hostApiUrl) void loadPlugins(); }, [session]);

  async function uploadPlugin(file: File) {
    if (!isOwnerSession(session)) { setPluginError("Only the configured server owner can change Minecraft plugins."); return; }
    if (!file.name.toLowerCase().endsWith(".jar")) { setPluginError("Choose a Java plugin .jar file."); return; }
    if (file.size > 50 * 1024 ** 2) { setPluginError("Minecraft plugin JARs are limited to 50 MiB."); return; }
    if (plugins.some(plugin => plugin.name === file.name) && !window.confirm(`Replace plugin ${file.name}?`)) return;
    setPluginBusy(true); setPluginError("");
    try { const response = await cloudRequest(`/api/minecraft/plugins/upload?filename=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "content-type": "application/java-archive" }, body: file }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error ?? "Plugin upload failed."); await loadPlugins(); setNotice(`${file.name} uploaded. Restart Minecraft to load it.`); }
    catch (error) { setPluginError(error instanceof Error ? error.message : "Plugin upload failed."); }
    finally { setPluginBusy(false); }
  }

  async function deletePlugin(plugin: PluginFile) {
    if (!isOwnerSession(session)) { setPluginError("Only the configured server owner can change Minecraft plugins."); return; }
    if (!window.confirm(`Remove ${plugin.name}? Only the JAR is deleted; plugin configuration/data folders remain.`)) return;
    setPluginBusy(true); setPluginError("");
    try { const response = await cloudRequest("/api/minecraft/plugins/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: plugin.name }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error ?? "Plugin deletion failed."); await loadPlugins(); setNotice(`${plugin.name} removed. Restart Minecraft to apply the change.`); }
    catch (error) { setPluginError(error instanceof Error ? error.message : "Plugin deletion failed."); }
    finally { setPluginBusy(false); }
  }

  async function backupMinecraft() {
    setCloudBusy(true); setCloudError("");
    try {
      const response = await cloudRequest("/api/minecraft/backup", { method: "POST", headers: { "content-type": "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Minecraft backup failed.");
      await loadCloudFiles();
      setNotice("Minecraft backup saved and the previous backup was overwritten.");
    } catch (error) { setCloudError(error instanceof Error ? error.message : "Minecraft backup failed."); }
    finally { setCloudBusy(false); }
  }
  async function downloadCloudFile(file: CloudFile) {
    try {
      type FilePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<FileSystemWritableFileStream> }> };
      const saveFilePicker = (window as FilePickerWindow).showSaveFilePicker;
      const handle = saveFilePicker ? await saveFilePicker.call(window, { suggestedName: file.name }) : null;
      const response = await cloudRequest(`/api/cloud/download?path=${encodeURIComponent(file.path)}`);
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? "Download failed."); }
      if (handle && response.body) {
        const writable = await handle.createWritable();
        await response.body.pipeTo(writable);
        setNotice(`${file.name} downloaded.`);
        return;
      }
      if (file.size > 1024 ** 3) throw new Error("This browser cannot safely stream downloads larger than 1 GiB. Use a browser with the save-file picker or download directly on the host.");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = file.name; link.style.display = "none"; document.body.appendChild(link); link.click(); window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
    } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; setCloudError(error instanceof Error ? error.message : "Download failed."); }
  }

  async function deleteCloudFile(file: CloudFile) {
    if (!window.confirm(`Delete ${file.path} from the VM Cloud? This removes it from host storage.`)) return;
    setCloudBusy(true); setCloudError("");
    try { const response = await cloudRequest("/api/cloud/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: file.path }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Delete failed."); await loadCloudFiles(); setNotice(`${file.name} deleted.`); }
    catch (error) { setCloudError(error instanceof Error ? error.message : "Delete failed."); }
    finally { setCloudBusy(false); }
  }

  const visibleServices = useMemo(() => services.filter(service => `${service.name} ${service.kind}`.toLowerCase().includes(search.toLowerCase())), [services, search]);
  const running = services.filter(service => service.state === "running").length;
  const degraded = services.filter(service => service.state === "degraded").length;

  async function controlMinecraft(operation: "start" | "stop" | "restart" | "update") {
    if (!hostApiUrl || !supabase || !window.confirm(`${operation[0].toUpperCase()}${operation.slice(1)} the live Minecraft server?`)) return;
    setNotice(`${operation[0].toUpperCase()}${operation.slice(1)} request sent…`);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`${hostApiUrl}/api/minecraft/lifecycle`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ action: operation }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Minecraft lifecycle request failed.");
      setHostState(payload.state as HostState); setNotice(`Minecraft ${operation} completed.`); setDrawer(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Minecraft lifecycle request failed."); }
  }

  async function sendMinecraftCommand(event: React.FormEvent) {
    event.preventDefault();
    const command = consoleCommand.trim();
    if (!hostApiUrl || !supabase || !command) return;
    setConsoleBusy(true); setConsoleError("");
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`${hostApiUrl}/api/minecraft/command`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ command }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Console command failed.");
      setConsoleOutput(current => [...current, `$ ${command}`, payload.output || "(command accepted)"]); setConsoleCommand("");
    } catch (error) { setConsoleError(error instanceof Error ? error.message : "Console command failed."); }
    finally { setConsoleBusy(false); }
  }

  async function operate(service: Service, operation: "start" | "stop" | "restart" | "update") {
    if (service.manual) { setNotice("Manual entries change status locally; no host operation was run."); return; }
    if (service.source === "minecraft") { void controlMinecraft(operation); return; }
    if (service.source === "website" && service.websiteSlug && (operation === "start" || operation === "stop")) {
      if (!window.confirm(`${operation[0].toUpperCase()}${operation.slice(1)} the managed website ${service.name}?`)) return;
      try { const response = await cloudRequest(`/api/websites/${service.websiteSlug}/lifecycle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: operation }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error ?? "Website lifecycle action failed."); const nextState: ServiceState = operation === "start" ? "running" : "stopped"; setServices(current => current.map(item => item.id === service.id ? { ...item, state: nextState } : item)); setSelected(current => current?.id === service.id ? { ...current, state: nextState } : current); await loadWebsites(); setNotice(`${service.name} ${operation === "start" ? "started" : "stopped"} on the host.`); }
      catch (error) { setWebsiteError(error instanceof Error ? error.message : "Website lifecycle action failed."); }
      return;
    }
    setNotice(`No host lifecycle control is linked for ${service.name}; live telemetry is read-only.`);
  }

  function updateManualState(service: Service, state: ServiceState) {
    if (!service.manual) return;
    setManualServices(current => current.map(item => item.id === service.id ? { ...item, state } : item));
    setServices(current => current.map(item => item.id === service.id ? { ...item, state } : item));
    setSelected(current => current?.id === service.id ? { ...current, state } : current);
    const tone: Activity["tone"] = state === "degraded" ? "warning" : state === "stopped" ? "info" : "success";
    setActivity(current => [{ id: Date.now(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), service: service.name, message: `manual status set to ${state} in this browser`, tone }, ...current].slice(0, 6));
    setNotice(`${service.name} marked ${state} (manual status only).`);
  }

  function deleteManualService(service: Service) {
    if (!service.manual || !window.confirm(`Remove the browser-local registry entry for ${service.name}?`)) return;
    setManualServices(current => current.filter(item => item.id !== service.id));
    setServices(current => current.filter(item => item.id !== service.id));
    setSelected(current => current?.id === service.id ? null : current);
    setDrawer(null); setNotice(`${service.name} removed from this browser's registry.`);
  }


  function addService(event: React.FormEvent) {
    event.preventDefault();
    if (!newService.name.trim()) return;
    const normalizedId = newService.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const normalizedDomain = newService.domain.trim().toLowerCase();
    if (!normalizedId || services.some(item => item.id === normalizedId)) { setNotice("A service with that name already exists"); return; }
    if (normalizedDomain && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(normalizedDomain)) { setNotice("Enter a valid hostname, for example app.example.com"); return; }
    const service: Service = { id: normalizedId, name: newService.name.trim(), kind: newService.kind, state: "stopped", health: null, cpu: -1, memory: -1, memoryLimit: 0, port: Number(newService.port) || 8088, domain: normalizedDomain || undefined, uptime: "—", restarts: null, boot: null, checkEvery: "Browser-local status", restartPolicy: "Not applicable · browser only", dependencies: [], accent: "blue", description: "Manual entry · status is stored in this browser and does not control a host process", manual: true };
    setManualServices(current => [...current, service]);
    setServices(current => [...current, service]);
    setActivity(current => [{ id: Date.now(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), service: service.name, message: "browser-local registry entry created · no host binding requested", tone: "info" }, ...current]);
    setNewService({ name: "", kind: "Web app", port: "8088", domain: "" }); setDrawer(null); setNotice(`${service.name} added to registry`);
  }

  if (!authReady) return <div className="loading-screen"><div className="loading-orbit" /><span>Checking owner session…</span></div>;
  if (!supabaseConfigured) return <ConfigGate />;
  if (!session || !isAllowedSession(session)) return <LoginGate session={session} onRefresh={() => setSession(null)} />;
  if (!hostApiUrl) return <HostUnavailable />;
  if (!hostState) return <div className="loading-screen"><div className="loading-orbit" /><span>{hostError || "Connecting to live host…"}</span></div>;
  const liveAlerts = getHostAlerts(hostState, settings);

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="sidebar-top"><Logo /><button className="mobile-menu" onClick={() => setSidebarOpen(value => !value)} aria-label="Toggle navigation"><Menu size={18} /></button></div>
      <div className="node-switcher"><span className={`node-pulse ${hostError ? "stale" : ""}`} /><span><b>{hostState.host.hostname}</b><small>Linux host · TMP Server</small></span><ChevronDown size={14} /></div>
      <nav className="nav-group">
        <p className="nav-caption">CONTROL PLANE</p>
        {navItems.map(item => <button key={item.id} className={`nav-item ${nav === item.id ? "active" : ""}`} onClick={() => { setNav(item.id); setSidebarOpen(false); }}><item.icon size={16} /><span>{item.label}</span>{item.count && <b>{item.count}</b>}</button>)}
      </nav>
      <div className="sidebar-tree"><p className="nav-caption">FLEET</p><div className="tree-line"><ChevronDown size={13} /><Server size={14} /><span>{hostState.host.hostname}</span><span className={hostError ? "tree-stale" : "tree-live"}>{hostError ? "stale" : "online"}</span></div><div className="tree-children"><div><StatusDot state="running" /> host workloads <b>{hostState.services.length}</b></div><div><StatusDot state={hostState.minecraft.health === "healthy" ? "running" : "degraded"} /> Minecraft <b>{hostState.minecraft.health}</b></div><div><StatusDot state={hostError ? "degraded" : "running"} /> agent <b>{hostError ? "unreachable" : "connected"}</b></div></div></div>
      <div className="sidebar-bottom"><button className={`nav-item ${nav === "settings" ? "active" : ""}`} onClick={() => { setNav("settings"); setSidebarOpen(false); }}><Settings2 size={16} /><span>Settings</span></button><div className="owner-chip"><div className="avatar">{(session.user.email?.[0] ?? "O").toUpperCase()}</div><span><b>{session.user.email?.split("@")[0] ?? "member"}</b><small>{sessionLabel(session)} / authenticated</small></span><MoreHorizontal size={16} /></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><button className="mobile-top-menu" onClick={() => setSidebarOpen(value => !value)} aria-label="Open navigation"><Menu size={18} /></button><div className="breadcrumbs"><span>Cluster</span><ChevronRight size={14} /><b>{hostState.host.hostname}</b><span className="slash">/</span><strong>{nav === "overview" ? "Overview" : nav === "plugins" ? "Minecraft Plugins" : nav[0].toUpperCase() + nav.slice(1)}</strong></div><div className="top-actions"><div className={`heartbeat ${hostError ? "stale" : ""}`}><span className="heartbeat-dot" /> {hostError ? "stale · last host snapshot" : "live · VM agent"}</div><a className="icon-button" title="Email infrastructure support" aria-label="Email infrastructure support" href="mailto:infrastructure@tmp-inc.uk"><CircleHelp size={17} /></a><button className="icon-button" title="Sign out" onClick={() => supabase?.auth.signOut()}><LogOut size={17} /></button></div></header>
      <div className="content-scroll">{nav === "settings" ? <SettingsPanel settings={settings} viewDistance={settingsViewDistance} setViewDistance={setSettingsViewDistance} simulationDistance={settingsSimulationDistance} setSimulationDistance={setSettingsSimulationDistance} maxPlayers={settingsMaxPlayers} setMaxPlayers={setSettingsMaxPlayers} busy={settingsBusy} error={settingsError} onSaveMinecraft={saveMinecraftSettings} onBackup={backupFromSettings} onRefresh={loadSettings} /> : nav === "cloud" ? <CloudPanel files={cloudFiles} usedBytes={cloudUsedBytes} busy={cloudBusy} error={cloudError} uploadProgress={cloudUploadProgress} onUpload={uploadCloudFile} onBackup={backupMinecraft} onDownload={downloadCloudFile} onDelete={deleteCloudFile} /> : nav === "websites" ? <WebsitesPanel sites={websites} busy={websiteBusy} error={websiteError} name={websiteName} setName={setWebsiteName} domain={websiteDomain} setDomain={setWebsiteDomain} onCreate={createWebsite} onDeploy={deployWebsite} onLifecycle={websiteLifecycle} onDelete={deleteWebsite} /> : nav === "plugins" ? <PluginsPanel plugins={plugins} busy={pluginBusy} error={pluginError} owner={isOwnerSession(session)} onUpload={uploadPlugin} onDelete={deletePlugin} onRestart={() => void controlMinecraft("restart")} /> : nav === "diagnostics" ? <DiagnosticsPanel hostState={hostState} settings={settings} error={[settingsError, hostError].filter(Boolean).join(" · ")} onRefresh={loadSettings} busy={settingsBusy} /> : nav === "admin" ? <AdminPanel settings={settings} busy={settingsBusy} error={settingsError} isOwner={isOwnerSession(session)} onRefresh={loadSettings} onBackup={backupFromSettings} onConsole={() => setDrawer("console")} onNavigate={setNav} /> : nav === "logs" ? <LogsPanel logs={logs} error={logError} filter={logFilter} onFilter={setLogFilter} onRefresh={() => void loadLogs()} /> : nav === "alerts" ? <AlertsPanel hostState={hostState} settings={settings} onNavigate={setNav} /> : <><section className="page-heading"><div><p className="eyebrow">CONTROL PLANE / PRIVATE HOST</p><h1>{nav === "overview" ? "Overview" : nav === "services" ? "Services" : "Node telemetry"}</h1><p className="page-subtitle">Latest host snapshot from the authenticated TMP host agent.{staticPages && <><br /><span>GitHub Pages shell · commands run on the authenticated VM agent</span></>}</p></div><div className="heading-actions"><button className="button secondary" onClick={() => setDrawer("console")}><TerminalSquare size={15} /> Minecraft terminal</button><button className="button secondary" onClick={() => window.location.reload()}><RefreshCw size={15} /> Refresh</button>{staticPages && <span className="backend-note">{hostError ? "Stale snapshot" : "Live agent connected"}</span>}{isOwnerSession(session) && <button className="button primary" onClick={() => setDrawer("add")}><Plus size={16} /> Add service or site</button>}</div></section>
        <div className="security-strip"><ShieldCheck size={15} /><span><b>Owner access active</b> · Supabase session verified against the configured allowlist</span><span className="strip-end">{hostError ? "host agent unreachable · displayed metrics are from the last successful poll" : "authenticated VM agent connected · commands are sent via protected RCON"}</span></div>{hostError && <div className="alert-item" role="alert"><span className="alert-icon warning"><AlertTriangle size={15} /></span><div><b>Host snapshot is stale</b><p>Showing the last successful poll. Host-connected actions may fail until the API connection recovers. {hostError}</p></div></div>}{settingsError && <div className="alert-item" role="alert"><span className="alert-icon warning"><AlertTriangle size={15} /></span><div><b>Admin telemetry snapshot is stale</b><p>External HDD, Docker, firewall, and systemd details are from the last successful admin poll. {settingsError}</p></div></div>}
        <section className="metric-grid"><MetricCard label="LIVE SERVICES" value={`${running}`} suffix={` / ${services.length}`} detail={`${degraded} degraded`} tone="cyan" icon={ActivityIcon} /><MetricCard label="ONLINE PLAYERS" value={`${hostState.minecraft.onlinePlayers}`} suffix={` / ${hostState.minecraft.maxPlayers || "—"}`} detail="Live RCON count" icon={Users} /><MetricCard label="MEMORY" value={`${hostState.memory.usedPercent}`} suffix="%" detail={`${formatBytes(hostState.memory.totalBytes - hostState.memory.availableBytes)} used · ${formatBytes(hostState.memory.totalBytes)} total`} tone="violet" icon={MemoryStick}><div className="meter"><span style={{ width: `${hostState.memory.usedPercent}%` }} /></div></MetricCard><MetricCard label={settings?.admin.externalStorage?.mounted ? "EXTERNAL HDD" : "SYSTEM STORAGE"} value={`${settings?.admin.externalStorage?.mounted ? settings.admin.externalStorage.usedPercent : hostState.disk.usedPercent}`} suffix="%" detail={`${formatBytes(settings?.admin.externalStorage?.mounted ? settings.admin.externalStorage.freeBytes : hostState.disk.freeBytes)} free · ${settings?.admin.externalStorage?.mounted ? "external HDD" : "root disk"}`} tone="amber" icon={HardDrive}><div className="meter amber"><span style={{ width: `${settings?.admin.externalStorage?.mounted ? settings.admin.externalStorage.usedPercent : hostState.disk.usedPercent}%` }} /></div></MetricCard></section>
        <section className="main-grid"><div className="panel service-panel"><div className="panel-header"><div><p className="eyebrow">SERVICE REGISTRY</p><h2>Running services <span>{visibleServices.length} visible</span></h2></div><div className="panel-tools"><div className="search-input"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter services" /></div></div></div><div className="table-wrap"><table><thead><tr><th>SERVICE</th><th>STATE</th><th>HEALTH</th><th>CPU</th><th>MEMORY</th><th>UPTIME</th><th /></tr></thead><tbody>{visibleServices.map(service => <tr key={service.id} className={selected?.id === service.id ? "selected-row" : ""} onClick={() => { setSelected(service); setDrawer("service"); }}><td><div className="service-name"><ServiceIcon kind={service.kind} /><span><b>{service.name}</b><small>{service.manual ? "Manual · browser only · " : service.domain ? `${service.domain} · ` : ""}{service.description}</small></span></div></td><td><StateBadge state={service.state} /></td><td><div className="health-cell">{service.health === null ? <small>Not reported</small> : <><span className="health-bar"><i className={service.health < 80 ? "warning" : ""} style={{ width: `${service.health}%` }} /></span><small>{service.health}%</small></>}</div></td><td className="mono">{service.cpu < 0 ? "—" : `${service.cpu}%`}</td><td><div className="memory-cell"><span>{service.memory < 0 ? "—" : `${service.memory}%`}</span><span className="memory-bar"><i style={{ width: `${Math.max(0, service.memory)}%` }} /></span></div></td><td className="mono muted">{service.uptime}</td><td><button className="row-menu" onClick={event => { event.stopPropagation(); setSelected(service); setDrawer("service"); }}><MoreHorizontal size={16} /></button></td></tr>)}</tbody></table></div><div className="panel-footer"><span><span className="green-dot" /> {running} running</span><span><span className="amber-dot" /> {degraded} attention</span><button className="text-button" onClick={() => setNav("services")}>Open full registry <ArrowUpRight size={14} /></button></div></div>
          <div className="side-stack"><div className="panel node-panel"><div className="panel-header compact"><div><p className="eyebrow">NODE TELEMETRY</p><h2>{hostState.host.hostname}</h2></div><span className={`online-pill ${hostError ? "stale" : ""}`}><span /> {hostError ? "last snapshot · stale" : "live telemetry"}</span></div><div className="node-meta"><span><HardDrive size={14} /> {hostState.host.os}</span><span><Network size={14} /> {hostState.host.architecture} · {hostState.minecraft.publicHostname}</span><span><Server size={14} /> Java {hostState.minecraft.publicHostname}:{hostState.minecraft.portJava} · Bedrock {hostState.minecraft.publicHostname}:{hostState.minecraft.portBedrock}</span></div><div className="util-chart"><div className="history-unavailable"><b>Historical utilization not collected</b><span>The host agent reports current resource telemetry, not a 12-hour time series.</span></div></div><div className="node-stat-row"><div><span>UPTIME</span><b>{formatUptime(hostState.host.uptimeSeconds)}</b><small>host uptime</small></div><div><span>MEMORY</span><b>{hostState.memory.usedPercent}%</b><small>used</small></div><div><span>DISK</span><b>{hostState.disk.usedPercent}%</b><small>used</small></div></div><div className="network-stats"><div className="network-stats-head"><span><Network size={13} /> NETWORK · CURRENT TRAFFIC</span><b>{hostState.network.interface} · {hostState.network.linkMbps > 0 ? `${hostState.network.linkMbps} Mbps link` : "virtual link capacity not reported"}</b></div><div className="network-rate"><div><span>DOWNLOAD NOW</span><b>{formatRate(hostState.network.rxBytesPerSecond)}</b><small>{formatBytes(hostState.network.rxBytes)} received · {hostState.network.sampleSeconds}s sample</small></div><div><span>UPLOAD NOW</span><b>{formatRate(hostState.network.txBytesPerSecond)}</b><small>{formatBytes(hostState.network.txBytes)} sent · {hostState.network.rxDropped + hostState.network.txDropped} dropped</small></div></div></div></div><div className="panel alert-panel"><div className="panel-header compact"><div><p className="eyebrow">OWNER ALERTS</p><h2>Attention queue <span className="count-badge">{liveAlerts.length}</span></h2></div><button className="icon-button" onClick={() => setNav("alerts")}><ArrowUpRight size={16} /></button></div>{liveAlerts.length ? liveAlerts.slice(0, 3).map((alert, index) => <div className="alert-item" key={`${alert.title}-${index}`}><span className={`alert-icon ${alert.tone}`}><AlertTriangle size={15} /></span><div><b>{alert.title}</b><p>{alert.detail}</p></div></div>) : <div className="alerts-clear"><ShieldCheck size={18} /><p>No current threshold warnings from host telemetry.</p></div>}</div></div></section>
        <section className="bottom-grid"><div className="panel activity-panel"><div className="panel-header compact"><div><p className="eyebrow">EVENT STREAM</p><h2>Recent operations</h2></div></div><div className="activity-list">{activity.slice(0, 5).map(item => <div className="activity-item" key={item.id}><span className={`activity-marker ${item.tone}`} /><span className="activity-time">{item.time}</span><span className="activity-service">{item.service}</span><span className="activity-message">{item.message}</span></div>)}</div></div><div className="panel log-panel"><div className="panel-header compact"><div><p className="eyebrow">LOG STREAM</p><h2>Latest output</h2></div><div className="log-controls"><select aria-label="Filter live logs by container" value={logFilter} onChange={event => setLogFilter(event.target.value)}><option value="all">All services</option>{Array.from(new Set(logs.map(log => log.service))).sort().map(service => <option key={service} value={service}>{service}</option>)}</select><TerminalSquare size={15} /></div></div><div className="log-list">{logs.filter(log => logFilter === "all" || log.service === logFilter).map((log, index) => <div className="log-line" key={`${log.timestamp ?? log.time}-${log.service}-${index}`}><span>{log.time}</span><b className={log.level === "WARN" ? "warn" : log.level === "ERROR" ? "error" : "info"}>{log.level}</b><strong>{log.service}</strong><p>{log.message}</p></div>)}{!logs.length && <div className="log-empty">{logError || "No recent Docker container logs were returned by the host agent."}</div>}</div></div></section>
        </>}
      </div>
    </main>
    {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(null)}><aside className="drawer" onClick={event => event.stopPropagation()}>{drawer === "service" && selected ? <><div className="drawer-head"><div><p className="eyebrow">SERVICE INSPECTOR</p><h2>{selected.name}</h2></div><button className="icon-button" onClick={() => setDrawer(null)}><X size={18} /></button></div><div className="drawer-status"><ServiceIcon kind={selected.kind} /><div><StateBadge state={selected.state} /><p>{selected.description}</p></div></div>{selected.manual ? <div className="manual-status-panel"><p className="eyebrow">MANUAL STATUS OVERRIDE</p><label className="field-label">Display status<select value={selected.state === "restarting" ? "running" : selected.state} onChange={event => updateManualState(selected, event.target.value as ServiceState)}><option value="running">Running</option><option value="degraded">Degraded</option><option value="stopped">Stopped</option></select></label><p>This status is stored only in this browser. It does not start, stop, restart, or monitor a process or website.</p><button className="button danger-button full" onClick={() => deleteManualService(selected)}><Trash2 size={14} /> Remove manual entry</button></div> : selected.source === "minecraft" ? <div className="drawer-actions"><button className="button primary" onClick={() => operate(selected, "start")}><Play size={14} /> Start</button><button className="button secondary" onClick={() => operate(selected, "restart")}><RefreshCw size={14} /> Restart</button><button className="button secondary" onClick={() => operate(selected, "update")}><CloudCog size={14} /> Update</button><button className="button danger-button" onClick={() => operate(selected, "stop")}><Square size={13} /> Stop</button></div> : selected.source === "website" ? <div className="drawer-actions"><button className="button primary" onClick={() => operate(selected, selected.state === "running" ? "stop" : "start")}>{selected.state === "running" ? <Square size={14} /> : <Play size={14} />}{selected.state === "running" ? "Stop site" : "Start site"}</button></div> : <div className="drawer-note"><ShieldCheck size={15} /><span>Live Docker telemetry is available, but host lifecycle actions are not linked for this container. Controls are read-only rather than simulated.</span></div>}<div className="detail-section"><p className="eyebrow">RUNTIME</p><div className="detail-grid"><div><span>PORT</span><b>{selected.port}</b></div><div><span>UPTIME</span><b>{selected.uptime}</b></div><div><span>RESTARTS</span><b>{selected.restarts ?? "Not reported"}</b></div><div><span>HEALTH</span><b>{selected.health === null ? "Not reported" : `${selected.health}%`}</b></div></div></div><div className="detail-section"><p className="eyebrow">DOMAIN ROUTE</p><div className="route-row"><div><span>{selected.kind === "Minecraft" ? "SERVER ADDRESS" : "HOSTNAME"}</span><b>{selected.kind === "Minecraft" ? `${hostState.minecraft.publicHostname} · Java ${hostState.minecraft.portJava} · Bedrock ${hostState.minecraft.portBedrock}` : selected.domain ?? "not linked"}</b></div>{selected.domain && <a href={`https://${selected.domain}`} target="_blank" rel="noreferrer"><ArrowUpRight size={15} /> Open</a>}</div><p className="route-help">{selected.kind === "Minecraft" ? "Use the same IP for Java and Bedrock; Bedrock uses UDP port 19132." : selected.manual ? "Manual entry only; this hostname is not checked by the host." : selected.source === "website" ? "This managed static site is routed through the host Caddy configuration." : "This live container has telemetry only; lifecycle actions are not configured."}</p></div><div className="detail-section"><p className="eyebrow">RECOVERY POLICY</p><div className="policy-row"><span>Boot startup</span><b>{selected.manual ? "Not applicable · browser only" : selected.boot === null ? "Not reported" : selected.boot ? "enabled" : "disabled"}</b></div><div className="policy-row"><span>Telemetry source</span><b>{selected.checkEvery}</b></div><div className="policy-row"><span>Restart policy</span><b>{selected.restartPolicy}</b></div><div className="policy-row"><span>Dependencies</span><b>{selected.dependencies.length ? selected.dependencies.join(", ") : "none"}</b></div></div>{selected.manual && <div className="drawer-note"><ShieldCheck size={15} /><span>Manual registry entries are saved in this browser only and are never sent to the host agent.</span></div>}</> : drawer === "console" ? <MinecraftConsole command={consoleCommand} setCommand={setConsoleCommand} output={consoleOutput} busy={consoleBusy} error={consoleError} onClose={() => setDrawer(null)} onSubmit={sendMinecraftCommand} /> : <><div className="drawer-head"><div><p className="eyebrow">SERVICE REGISTRY</p><h2>Add service</h2></div><button className="icon-button" onClick={() => setDrawer(null)}><X size={18} /></button></div><form className="add-form" onSubmit={addService}><label className="field-label">Service name<input value={newService.name} onChange={event => setNewService({ ...newService, name: event.target.value })} placeholder="my-service" required /></label><label className="field-label">Service type<select value={newService.kind} onChange={event => setNewService({ ...newService, kind: event.target.value as ServiceKind })}><option>Web app</option><option>Container</option><option>Database</option><option>Proxy</option><option>Minecraft</option></select></label><label className="field-label">Internal port<input type="number" min="1" max="65535" value={newService.port} onChange={event => setNewService({ ...newService, port: event.target.value })} /></label><label className="field-label">Domain route <span className="field-help">Optional hostname</span><input value={newService.domain} onChange={event => setNewService({ ...newService, domain: event.target.value })} placeholder="service.example.com" /></label><div className="add-policy"><div><b>Browser-local manual entry</b><span>no host operation runs · status is stored in this browser</span></div><ShieldCheck size={17} /></div><button className="button primary full" type="submit"><Plus size={15} /> Add to registry</button></form></>}</aside></div>}
    {notice && <div className="toast"><ShieldCheck size={15} /><span>{notice}</span></div>}
  </div>;
}

export default Home;
