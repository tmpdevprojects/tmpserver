import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Contact,
  ExternalLink,
  FileText,
  Grid2X2,
  Inbox,
  LoaderCircle,
  Mail,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  StickyNote,
  Tag,
  X,
  CheckSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  GmailLabel,
  GmailStatus,
  MailFolder,
  MailMessage,
} from "./MailPanel";
import "./TMPMailWorkspace.css";

type Theme = "light" | "dark";
type Density = "comfortable" | "compact";
type SettingsTab = "general" | "accounts" | "privacy";
type UtilityApp = "calendar" | "keep" | "tasks" | "contacts";

type TMPMailWorkspaceProps = {
  ownerEmail: string;
  status: GmailStatus | null;
  statusLoading: boolean;
  clientIdReady: boolean;
  isConfigured: boolean;
  isConnected: boolean;
  busy: boolean;
  error: string;
  notice: string;
  folder: MailFolder;
  labels: GmailLabel[];
  labelsLoading: boolean;
  labelsError: string;
  messages: MailMessage[];
  listLoading: boolean;
  nextPageToken: string | null;
  loadingMore: boolean;
  selected: MailMessage | null;
  searchDraft: string;
  activeQuery: string;
  composeOpen: boolean;
  recipient: string;
  subject: string;
  body: string;
  setSearchDraft: (value: string) => void;
  setComposeOpen: (value: boolean) => void;
  setRecipient: (value: string) => void;
  setSubject: (value: string) => void;
  setBody: (value: string) => void;
  onSearch: (query: string) => void;
  onChooseFolder: (folder: MailFolder) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenMessage: (message: MailMessage) => void;
  onBackToList: () => void;
  onStartReply: (message: MailMessage) => void;
  onToggleStar: (message: MailMessage) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSubmitCompose: (event: FormEvent) => void;
  onDismissError: () => void;
  onDismissNotice: () => void;
};

const systemFolders: Array<{ id: string; name: string; Icon: LucideIcon }> = [
  { id: "INBOX", name: "Inbox", Icon: Inbox },
  { id: "STARRED", name: "Starred", Icon: Star },
  { id: "SENT", name: "Sent", Icon: Send },
  { id: "DRAFT", name: "Drafts", Icon: FileText },
];

const moreFolders: Array<{ id: string; name: string; Icon: LucideIcon }> = [
  { id: "ALL", name: "All mail", Icon: Mail },
  { id: "IMPORTANT", name: "Important", Icon: Tag },
  { id: "SPAM", name: "Spam", Icon: CircleAlert },
  { id: "TRASH", name: "Trash", Icon: X },
];

const categories = [
  { id: "CATEGORY_PERSONAL", name: "Primary" },
  { id: "CATEGORY_SOCIAL", name: "Social" },
  { id: "CATEGORY_PROMOTIONS", name: "Promotions" },
  { id: "CATEGORY_UPDATES", name: "Updates" },
  { id: "CATEGORY_FORUMS", name: "Forums" },
];

const utilityApps: Array<{
  id: UtilityApp;
  name: string;
  href: string;
  description: string;
  Icon: LucideIcon;
}> = [
  {
    id: "calendar",
    name: "Calendar",
    href: "https://calendar.google.com/",
    description: "Open Google Calendar in a new tab.",
    Icon: CalendarDays,
  },
  {
    id: "keep",
    name: "Keep",
    href: "https://keep.google.com/",
    description: "Open Google Keep in a new tab.",
    Icon: StickyNote,
  },
  {
    id: "tasks",
    name: "Tasks",
    href: "https://tasks.google.com/",
    description: "Open Google Tasks in a new tab.",
    Icon: CheckSquare,
  },
  {
    id: "contacts",
    name: "Contacts",
    href: "https://contacts.google.com/",
    description: "Open Google Contacts in a new tab.",
    Icon: Contact,
  },
];

function localPreference<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[]
): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function folderTitle(folder: MailFolder, labels: GmailLabel[]): string {
  const known = [...systemFolders, ...moreFolders, ...categories].find(
    item => item.id === folder
  );
  if (known) return known.name;
  return labels.find(label => label.id === folder)?.name ?? "Label";
}

function unreadCount(id: string, labels: GmailLabel[]): number | undefined {
  const count = labels.find(label => label.id === id)?.messagesUnread;
  return typeof count === "number" && count > 0 ? count : undefined;
}

function formatDate(value: string, compact = false): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(
    undefined,
    compact
      ? { month: "short", day: "numeric" }
      : { dateStyle: "medium", timeStyle: "short" }
  ).format(date);
}

function safeEmailFrame(html: string): string {
  const css =
    "body{margin:0;padding:16px;background:#fff;color:#202124;font-family:Arial,system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1155cc}";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${css}</style></head><body>${html}</body></html>`;
}

function searchPhrase(label: string, value: string): string {
  const clean = value.trim().replace(/["\\]/g, "");
  if (!clean) return "";
  return `${label}:"${clean}"`;
}

export default function TMPMailWorkspace(props: TMPMailWorkspaceProps) {
  const {
    ownerEmail,
    status,
    statusLoading,
    clientIdReady,
    isConfigured,
    isConnected,
    busy,
    error,
    notice,
    folder,
    labels,
    labelsLoading,
    labelsError,
    messages,
    listLoading,
    nextPageToken,
    loadingMore,
    selected,
    searchDraft,
    activeQuery,
    composeOpen,
    recipient,
    subject,
    body,
    setSearchDraft,
    setComposeOpen,
    setRecipient,
    setSubject,
    setBody,
    onSearch,
    onChooseFolder,
    onRefresh,
    onLoadMore,
    onOpenMessage,
    onBackToList,
    onStartReply,
    onToggleStar,
    onConnect,
    onDisconnect,
    onSubmitCompose,
    onDismissError,
    onDismissNotice,
  } = props;

  const [theme, setTheme] = useState<Theme>(() =>
    localPreference("tmp-mail-theme", "light", ["light", "dark"])
  );
  const [density, setDensity] = useState<Density>(() =>
    localPreference("tmp-mail-density", "comfortable", [
      "comfortable",
      "compact",
    ])
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [hasAttachment, setHasAttachment] = useState(false);
  const [afterFilter, setAfterFilter] = useState("");
  const [beforeFilter, setBeforeFilter] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [activeUtilityApp, setActiveUtilityApp] =
    useState<UtilityApp>("calendar");
  const searchRef = useRef<HTMLInputElement>(null);
  const userLabels = labels
    .filter(label => label.type === "user")
    .sort((a, b) => a.name.localeCompare(b.name));
  const title = folderTitle(folder, labels);
  const activeUtility =
    utilityApps.find(app => app.id === activeUtilityApp) ?? utilityApps[0];
  const showingInboxCategories =
    folder === "INBOX" || categories.some(category => category.id === folder);

  useEffect(() => {
    try {
      window.localStorage.setItem("tmp-mail-theme", theme);
    } catch {
      /* Private browsing may disable local storage. */
    }
  }, [theme]);
  useEffect(() => {
    try {
      window.localStorage.setItem("tmp-mail-density", density);
    } catch {
      /* Private browsing may disable local storage. */
    }
  }, [density]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setAccountMenuOpen(false);
        setSidePanelOpen(false);
        setAdvancedSearchOpen(false);
        setMobileNavOpen(false);
        if (composeOpen) setComposeOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composeOpen, setComposeOpen]);

  const selectFolder = (next: MailFolder) => {
    onChooseFolder(next);
    setMobileNavOpen(false);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    onSearch(searchDraft.trim());
    setAdvancedSearchOpen(false);
    setMobileNavOpen(false);
  };

  const submitAdvancedSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = [
      searchDraft.trim(),
      fromFilter.trim() ? `from:${fromFilter.trim()}` : "",
      toFilter.trim() ? `to:${toFilter.trim()}` : "",
      searchPhrase("subject", subjectFilter),
      hasAttachment ? "has:attachment" : "",
      afterFilter ? `after:${afterFilter.replace(/-/g, "/")}` : "",
      beforeFilter ? `before:${beforeFilter.replace(/-/g, "/")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    setSearchDraft(query);
    onSearch(query);
    setAdvancedSearchOpen(false);
  };

  const clearSearch = () => {
    setSearchDraft("");
    setFromFilter("");
    setToFilter("");
    setSubjectFilter("");
    setHasAttachment(false);
    setAfterFilter("");
    setBeforeFilter("");
    onSearch("");
  };

  const openCompose = () => {
    setRecipient("");
    setSubject("");
    setBody("");
    setComposeOpen(true);
  };

  const openSettings = (tab: SettingsTab = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
    setAccountMenuOpen(false);
  };

  const statusDescription =
    status?.error ||
    (isConfigured
      ? clientIdReady
        ? `Host setup is ready. Connect the Google account that matches ${ownerEmail || "the signed-in TMP owner"}.`
        : "The host is configured, but this build is missing VITE_GOOGLE_CLIENT_ID. Add it as a GitHub Actions repository variable and redeploy."
      : "Google OAuth is not configured on the host. Mail stays unavailable until the existing private host setup is complete.");

  const renderFolderButton = (item: {
    id: string;
    name: string;
    Icon: LucideIcon;
  }) => {
    const count = unreadCount(item.id, labels);
    return (
      <button
        key={item.id}
        type="button"
        className={`tmp-gmail-folder ${folder === item.id ? "is-active" : ""}`}
        aria-current={folder === item.id ? "page" : undefined}
        onClick={() => selectFolder(item.id)}
        title={sidebarCollapsed ? item.name : undefined}
      >
        <item.Icon size={18} aria-hidden="true" />
        <span className="tmp-gmail-folder-name">{item.name}</span>
        {count !== undefined && (
          <span className="tmp-gmail-count">
            {count > 999 ? "999+" : count}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={`tmp-gmail ${mobileNavOpen ? "mobile-nav-open" : ""}`}
      data-theme={theme}
      data-density={density}
    >
      <header className="tmp-gmail-topbar">
        <div className="tmp-gmail-brand-area">
          <button
            type="button"
            className="tmp-gmail-icon-button tmp-gmail-menu-toggle"
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(value => !value)}
          >
            <Menu size={20} />
          </button>
          <a
            href="https://tmpserver.com/"
            className="tmp-gmail-wordmark"
            aria-label="TMP Mail, return to TMP Server dashboard"
          >
            <span className="tmp-gmail-mark">
              <Mail size={18} />
            </span>
            <span>
              <strong>TMP</strong>
              <b>Mail</b>
            </span>
          </a>
        </div>
        <form
          className="tmp-gmail-search"
          role="search"
          onSubmit={submitSearch}
        >
          <Search size={19} aria-hidden="true" />
          <input
            ref={searchRef}
            aria-label="Search mail"
            value={searchDraft}
            onChange={event => setSearchDraft(event.target.value)}
            placeholder="Search mail"
            disabled={!isConnected}
          />
          {searchDraft && (
            <button
              type="button"
              className="tmp-gmail-search-clear"
              aria-label="Clear search"
              onClick={clearSearch}
            >
              <X size={17} />
            </button>
          )}
          <button
            type="button"
            className={`tmp-gmail-search-filter ${advancedSearchOpen ? "is-open" : ""}`}
            aria-label="Show advanced search options"
            aria-expanded={advancedSearchOpen}
            onClick={() => setAdvancedSearchOpen(value => !value)}
            disabled={!isConnected}
          >
            <SlidersHorizontal size={18} />
          </button>
        </form>
        <div className="tmp-gmail-top-actions">
          <button
            type="button"
            className="tmp-gmail-icon-button tmp-gmail-refresh"
            aria-label="Refresh mailbox"
            title="Refresh"
            onClick={onRefresh}
            disabled={!isConnected || listLoading}
          >
            <RefreshCw size={18} />
          </button>
          <button
            type="button"
            className="tmp-gmail-icon-button"
            aria-label="Mail privacy and help"
            title="Help and privacy"
            onClick={() => openSettings("privacy")}
          >
            <CircleHelp size={19} />
          </button>
          <button
            type="button"
            className="tmp-gmail-icon-button"
            aria-label="Mail settings"
            title="Settings"
            onClick={() => openSettings("general")}
          >
            <Settings size={19} />
          </button>
          <button
            type="button"
            className={`tmp-gmail-icon-button ${sidePanelOpen ? "is-selected" : ""}`}
            aria-label="Open Google apps side panel"
            aria-expanded={sidePanelOpen}
            title="Google apps"
            onClick={() => setSidePanelOpen(value => !value)}
          >
            <Grid2X2 size={18} />
          </button>
          <button
            type="button"
            className="tmp-gmail-profile-button"
            aria-label="Open account menu"
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen(value => !value)}
          >
            <span>
              {(status?.email || ownerEmail || "T").slice(0, 1).toUpperCase()}
            </span>
          </button>
          {accountMenuOpen && (
            <div
              className="tmp-gmail-account-menu"
              role="menu"
              aria-label="Account menu"
            >
              <div className="tmp-gmail-account-menu-header">
                <span className="tmp-gmail-profile-large">
                  {(status?.email || ownerEmail || "T")
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <strong>{status?.email || "Gmail not connected"}</strong>
                <small>TMP owner: {ownerEmail || "Not configured"}</small>
              </div>
              <a
                role="menuitem"
                href="https://myaccount.google.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Manage Google Account <ExternalLink size={14} />
              </a>
              <button
                role="menuitem"
                type="button"
                onClick={() => openSettings("accounts")}
              >
                TMP Mail account settings
              </button>
              {isConnected ? (
                <>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      onConnect();
                    }}
                  >
                    Re-authorize Google
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="is-danger"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      onDisconnect();
                    }}
                  >
                    Disconnect Gmail
                  </button>
                </>
              ) : (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onConnect();
                  }}
                  disabled={busy}
                >
                  Connect Google
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {advancedSearchOpen && (
        <form
          className="tmp-gmail-advanced-search"
          onSubmit={submitAdvancedSearch}
          aria-label="Advanced Gmail search"
        >
          <div className="tmp-gmail-advanced-heading">
            <strong>Search options</strong>
            <button
              type="button"
              className="tmp-gmail-icon-button"
              aria-label="Close search options"
              onClick={() => setAdvancedSearchOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <label>
            From
            <input
              value={fromFilter}
              onChange={event => setFromFilter(event.target.value)}
              placeholder="sender@example.com"
            />
          </label>
          <label>
            To
            <input
              value={toFilter}
              onChange={event => setToFilter(event.target.value)}
              placeholder="recipient@example.com"
            />
          </label>
          <label>
            Subject
            <input
              value={subjectFilter}
              onChange={event => setSubjectFilter(event.target.value)}
              placeholder="Words in the subject"
            />
          </label>
          <div className="tmp-gmail-date-filters">
            <label>
              After
              <input
                type="date"
                value={afterFilter}
                onChange={event => setAfterFilter(event.target.value)}
              />
            </label>
            <label>
              Before
              <input
                type="date"
                value={beforeFilter}
                onChange={event => setBeforeFilter(event.target.value)}
              />
            </label>
          </div>
          <label className="tmp-gmail-check-field">
            <input
              type="checkbox"
              checked={hasAttachment}
              onChange={event => setHasAttachment(event.target.checked)}
            />{" "}
            Has attachment
          </label>
          <button type="submit" className="tmp-gmail-primary-button">
            Search
          </button>
        </form>
      )}

      <div
        className={`tmp-gmail-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${sidePanelOpen ? "side-panel-open" : ""}`}
      >
        {mobileNavOpen && (
          <button
            type="button"
            className="tmp-gmail-nav-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <aside className="tmp-gmail-sidebar" aria-label="Mail navigation">
          <button
            type="button"
            className="tmp-gmail-compose-button"
            onClick={openCompose}
            disabled={!isConnected}
          >
            <span className="tmp-gmail-compose-icon">
              <Mail size={19} />
            </span>
            <span className="tmp-gmail-compose-label">Compose</span>
          </button>
          <nav className="tmp-gmail-folder-nav" aria-label="Folders">
            {systemFolders.map(renderFolderButton)}
            <button
              type="button"
              className="tmp-gmail-folder tmp-gmail-more-button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(value => !value)}
              title={
                sidebarCollapsed ? (moreOpen ? "Less" : "More") : undefined
              }
            >
              <ChevronDown size={18} className={moreOpen ? "is-rotated" : ""} />
              <span className="tmp-gmail-folder-name">
                {moreOpen ? "Less" : "More"}
              </span>
            </button>
            {moreOpen && moreFolders.map(renderFolderButton)}
          </nav>
          <div className="tmp-gmail-labels">
            <button
              type="button"
              className="tmp-gmail-section-toggle"
              aria-expanded={labelsOpen}
              onClick={() => setLabelsOpen(value => !value)}
              title={sidebarCollapsed ? "Labels" : undefined}
            >
              <span className="tmp-gmail-folder-name">Labels</span>
              <ChevronDown
                size={16}
                className={labelsOpen ? "is-rotated" : ""}
              />
            </button>
            {labelsOpen &&
              (labelsLoading ? (
                <span className="tmp-gmail-label-loading">
                  <LoaderCircle size={14} className="mail-spin" /> Loading
                  labels
                </span>
              ) : userLabels.length ? (
                userLabels.map(label =>
                  renderFolderButton({
                    id: label.id,
                    name: label.name,
                    Icon: Tag,
                  })
                )
              ) : (
                <span className="tmp-gmail-label-empty">
                  {labelsError ? "Labels unavailable" : "No custom labels"}
                </span>
              ))}
          </div>
          <div className="tmp-gmail-owner-note">
            <ShieldCheck size={14} />
            <span className="tmp-gmail-folder-name">Private owner mailbox</span>
          </div>
          {!sidebarCollapsed && (
            <p className="tmp-gmail-sidebar-note">
              Opening a message changes only its unread appearance here.
            </p>
          )}
        </aside>

        <main className="tmp-gmail-center" aria-label="Mailbox">
          {error && (
            <div className="tmp-gmail-feedback is-error" role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={onDismissError}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div
              className="tmp-gmail-feedback is-success"
              role="status"
              aria-live="polite"
            >
              <Check size={16} />
              <span>{notice}</span>
              <button
                type="button"
                aria-label="Dismiss message"
                onClick={onDismissNotice}
              >
                <X size={15} />
              </button>
            </div>
          )}

          {!isConnected ? (
            <section className="tmp-gmail-connect-state" aria-live="polite">
              <div className="tmp-gmail-connect-icon">
                <Mail size={28} />
              </div>
              <h1>
                {statusLoading
                  ? "Checking Gmail connection…"
                  : isConfigured
                    ? "Connect your Gmail account"
                    : "Gmail setup is not ready"}
              </h1>
              <p>
                {statusLoading
                  ? "Verifying the existing owner-only Google connection."
                  : statusDescription}
              </p>
              <div className="tmp-gmail-owner-check">
                <ShieldCheck size={16} />
                <span>
                  TMP Server owner session:{" "}
                  <strong>{ownerEmail || "Owner email unavailable"}</strong>
                </span>
              </div>
              {isConfigured && (
                <button
                  type="button"
                  className="tmp-gmail-primary-button"
                  onClick={onConnect}
                  disabled={busy || !clientIdReady}
                >
                  <ShieldCheck size={16} />
                  {busy ? "Waiting for Google…" : "Connect Google"}
                </button>
              )}
              {!isConfigured && (
                <button
                  type="button"
                  className="tmp-gmail-secondary-button"
                  onClick={onRefresh}
                  disabled={statusLoading}
                >
                  <RefreshCw size={15} /> Check again
                </button>
              )}
            </section>
          ) : composeOpen ? null : selected ? (
            <article
              className="tmp-gmail-reader"
              aria-labelledby="tmp-gmail-reading-subject"
            >
              <div className="tmp-gmail-reader-toolbar">
                <button
                  type="button"
                  className="tmp-gmail-icon-button"
                  aria-label="Back to message list"
                  onClick={onBackToList}
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="tmp-gmail-reader-actions">
                  <button
                    type="button"
                    className="tmp-gmail-icon-button"
                    aria-label={
                      selected.starred ? "Remove star" : "Star message"
                    }
                    title={selected.starred ? "Remove star" : "Star"}
                    onClick={() => onToggleStar(selected)}
                  >
                    <Star
                      size={18}
                      fill={selected.starred ? "currentColor" : "none"}
                      className={selected.starred ? "is-starred" : ""}
                    />
                  </button>
                  <button
                    type="button"
                    className="tmp-gmail-secondary-button tmp-gmail-reply-button"
                    onClick={() => onStartReply(selected)}
                  >
                    <Reply size={15} /> Reply
                  </button>
                </div>
              </div>
              <h1
                id="tmp-gmail-reading-subject"
                className="tmp-gmail-reading-subject"
              >
                {selected.subject}
              </h1>
              <div className="tmp-gmail-message-meta">
                <span className="tmp-gmail-sender-avatar">
                  {selected.sender.slice(0, 1).toUpperCase()}
                </span>
                <div className="tmp-gmail-sender-detail">
                  <strong>{selected.sender}</strong>
                  <small>
                    to {selected.recipient || (status?.email ?? "me")}
                  </small>
                </div>
                <time dateTime={selected.date || undefined}>
                  {formatDate(selected.date)}
                </time>
              </div>
              {selected.html ? (
                <iframe
                  className="tmp-gmail-message-frame"
                  title="Email message content"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  srcDoc={safeEmailFrame(selected.html)}
                />
              ) : (
                <div className="tmp-gmail-message-body">
                  {selected.plainText || (
                    <span className="tmp-gmail-no-body">
                      This message has no readable content.
                    </span>
                  )}
                </div>
              )}
              <div className="tmp-gmail-reader-footer">
                <button
                  type="button"
                  className="tmp-gmail-secondary-button"
                  onClick={() => onStartReply(selected)}
                >
                  <Reply size={15} /> Reply
                </button>
                <span>
                  Unread status is unchanged in Gmail when opened here.
                </span>
              </div>
            </article>
          ) : isConnected ? (
            <>
              <div className="tmp-gmail-list-toolbar">
                <div className="tmp-gmail-list-title">
                  <span className="tmp-gmail-page-eyebrow">TMP MAILBOX</span>
                  <h1>{title}</h1>
                </div>
                <div className="tmp-gmail-toolbar-actions">
                  <button
                    type="button"
                    className="tmp-gmail-icon-button"
                    aria-label="Refresh messages"
                    title="Refresh"
                    onClick={onRefresh}
                    disabled={listLoading}
                  >
                    <RefreshCw size={17} />
                  </button>
                  <button
                    type="button"
                    className="tmp-gmail-icon-button"
                    aria-label="Collapse navigation"
                    title={
                      sidebarCollapsed
                        ? "Expand navigation"
                        : "Collapse navigation"
                    }
                    onClick={() => setSidebarCollapsed(value => !value)}
                  >
                    {sidebarCollapsed ? (
                      <PanelLeftOpen size={17} />
                    ) : (
                      <PanelLeftClose size={17} />
                    )}
                  </button>
                  <span className="tmp-gmail-page-counter">
                    {messages.length ? `1–${messages.length}` : "0"}
                    {nextPageToken ? "+" : ""}
                  </span>
                </div>
              </div>
              {showingInboxCategories && (
                <div
                  className="tmp-gmail-category-tabs"
                  role="tablist"
                  aria-label="Inbox categories"
                >
                  {categories.map(category => {
                    const active =
                      folder === category.id ||
                      (folder === "INBOX" &&
                        category.id === "CATEGORY_PERSONAL");
                    return (
                      <button
                        key={category.id}
                        role="tab"
                        type="button"
                        aria-selected={active}
                        className={active ? "is-active" : ""}
                        onClick={() => selectFolder(category.id)}
                      >
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {activeQuery && (
                <div className="tmp-gmail-query-chip">
                  Search results for <strong>{activeQuery}</strong>
                  <button type="button" onClick={clearSearch}>
                    Clear search
                  </button>
                </div>
              )}
              {labelsError && (
                <div className="tmp-gmail-soft-warning" role="status">
                  Custom label counts are unavailable. You can still use the
                  loaded mailbox.
                </div>
              )}
              <div
                className="tmp-gmail-message-list"
                aria-live="polite"
                aria-busy={listLoading}
              >
                {listLoading ? (
                  <div className="tmp-gmail-empty">
                    <LoaderCircle size={22} className="mail-spin" />
                    <p>Loading messages from Gmail…</p>
                  </div>
                ) : messages.length ? (
                  messages.map(message => (
                    <div
                      key={message.id}
                      className={`tmp-gmail-message-row ${message.unread ? "is-unread" : ""}`}
                    >
                      <button
                        type="button"
                        className="tmp-gmail-message-open"
                        onClick={() => onOpenMessage(message)}
                        aria-label={`Read ${message.subject} from ${message.sender}`}
                      >
                        <span
                          className="tmp-gmail-unread-marker"
                          aria-hidden="true"
                        />
                        <span className="tmp-gmail-message-sender">
                          {message.sender}
                        </span>
                        <span className="tmp-gmail-message-summary">
                          <strong>{message.subject}</strong>
                          <span className="tmp-gmail-separator"> — </span>
                          <span>
                            {message.plainText
                              .replace(/\s+/g, " ")
                              .slice(0, 180)}
                          </span>
                        </span>
                        <time dateTime={message.date || undefined}>
                          {formatDate(message.date, true)}
                        </time>
                      </button>
                      <button
                        type="button"
                        className={`tmp-gmail-star-button ${message.starred ? "is-starred" : ""}`}
                        aria-label={
                          message.starred ? "Remove star" : "Star message"
                        }
                        title={message.starred ? "Remove star" : "Star"}
                        onClick={() => onToggleStar(message)}
                      >
                        <Star
                          size={18}
                          fill={message.starred ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="tmp-gmail-empty">
                    <Mail size={27} />
                    <strong>
                      {activeQuery
                        ? "No matching messages"
                        : `No messages in ${title}`}
                    </strong>
                    <p>
                      {activeQuery
                        ? "Try another Gmail search or clear the current search."
                        : "Messages from this Gmail view will appear here."}
                    </p>
                  </div>
                )}
              </div>
              <footer className="tmp-gmail-list-footer">
                <span>
                  {listLoading
                    ? "Loading messages"
                    : `${messages.length} message${messages.length === 1 ? "" : "s"} loaded`}
                </span>
                {nextPageToken && (
                  <button
                    type="button"
                    className="tmp-gmail-secondary-button"
                    disabled={loadingMore}
                    onClick={onLoadMore}
                  >
                    {loadingMore ? (
                      <LoaderCircle size={14} className="mail-spin" />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                )}
                <span className="tmp-gmail-search-hint">
                  Gmail search syntax supported
                </span>
              </footer>
            </>
          ) : null}
        </main>

        <aside
          className="tmp-gmail-app-rail"
          aria-label="Google apps side panel"
        >
          {utilityApps.map(app => (
            <button
              key={app.id}
              type="button"
              className={`tmp-gmail-app-rail-button ${sidePanelOpen && activeUtilityApp === app.id ? "is-active" : ""}`}
              aria-label={`${app.name} side panel`}
              aria-pressed={sidePanelOpen && activeUtilityApp === app.id}
              title={app.name}
              onClick={() => {
                setActiveUtilityApp(app.id);
                setSidePanelOpen(true);
              }}
            >
              <app.Icon size={19} />
            </button>
          ))}
        </aside>
        {sidePanelOpen && (
          <aside
            className="tmp-gmail-side-panel"
            aria-label={`${activeUtility.name} quick panel`}
          >
            <div className="tmp-gmail-side-panel-heading">
              <strong>{activeUtility.name}</strong>
              <button
                type="button"
                className="tmp-gmail-icon-button"
                aria-label="Close side panel"
                onClick={() => setSidePanelOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="tmp-gmail-side-panel-body">
              <span className="tmp-gmail-side-app-icon">
                <activeUtility.Icon size={24} />
              </span>
              <p>{activeUtility.description}</p>
              <p className="tmp-gmail-side-note">
                TMP Mail does not access or sync data from this Google app.
              </p>
              <a
                href={activeUtility.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {activeUtility.name}
                <ExternalLink size={15} />
              </a>
            </div>
            <div className="tmp-gmail-side-switcher">
              {utilityApps.map(app => (
                <button
                  key={app.id}
                  type="button"
                  aria-label={`Show ${app.name}`}
                  aria-pressed={activeUtilityApp === app.id}
                  className={activeUtilityApp === app.id ? "is-active" : ""}
                  onClick={() => setActiveUtilityApp(app.id)}
                >
                  <app.Icon size={17} />
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>

      {composeOpen && isConnected && (
        <div
          className="tmp-gmail-compose-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !busy)
              setComposeOpen(false);
          }}
        >
          <form
            className="tmp-gmail-compose"
            onSubmit={onSubmitCompose}
            aria-labelledby="tmp-gmail-compose-title"
            role="dialog"
            aria-modal="true"
          >
            <div className="tmp-gmail-compose-heading">
              <h2 id="tmp-gmail-compose-title">
                {subject.startsWith("Re:") ? "Reply" : "New message"}
              </h2>
              <button
                type="button"
                className="tmp-gmail-icon-button"
                aria-label="Close compose"
                onClick={() => setComposeOpen(false)}
                disabled={busy}
              >
                <X size={17} />
              </button>
            </div>
            <label className="tmp-gmail-compose-field">
              To
              <input
                type="email"
                required
                value={recipient}
                onChange={event => setRecipient(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />
            </label>
            <label className="tmp-gmail-compose-field">
              Subject
              <input
                value={subject}
                onChange={event => setSubject(event.target.value)}
                maxLength={998}
                placeholder="Subject"
              />
            </label>
            <label className="tmp-gmail-compose-field tmp-gmail-compose-body">
              Message
              <textarea
                value={body}
                onChange={event => setBody(event.target.value)}
                rows={12}
                placeholder="Write a plain-text message…"
              />
            </label>
            <div className="tmp-gmail-compose-footer">
              <span>Plain text · one recipient</span>
              <button
                className="tmp-gmail-primary-button"
                type="submit"
                disabled={busy}
              >
                <Send size={15} />
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}

      {settingsOpen && (
        <div
          className="tmp-gmail-settings-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="tmp-gmail-settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tmp-gmail-settings-title"
          >
            <header>
              <div>
                <span className="tmp-gmail-page-eyebrow">TMP MAIL</span>
                <h2 id="tmp-gmail-settings-title">Settings</h2>
              </div>
              <button
                type="button"
                className="tmp-gmail-icon-button"
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <nav
              className="tmp-gmail-settings-tabs"
              aria-label="Settings sections"
            >
              {(["general", "accounts", "privacy"] as SettingsTab[]).map(
                tab => (
                  <button
                    key={tab}
                    type="button"
                    aria-current={settingsTab === tab ? "page" : undefined}
                    className={settingsTab === tab ? "is-active" : ""}
                    onClick={() => setSettingsTab(tab)}
                  >
                    {tab === "general"
                      ? "General"
                      : tab === "accounts"
                        ? "Accounts"
                        : "Privacy"}
                  </button>
                )
              )}
            </nav>
            {settingsTab === "general" && (
              <div className="tmp-gmail-settings-content">
                <h3>Appearance</h3>
                <p>
                  Preferences are saved only in this browser on this device.
                </p>
                <fieldset>
                  <legend>Theme</legend>
                  <label>
                    <input
                      type="radio"
                      name="tmp-mail-theme"
                      checked={theme === "light"}
                      onChange={() => setTheme("light")}
                    />{" "}
                    Light
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="tmp-mail-theme"
                      checked={theme === "dark"}
                      onChange={() => setTheme("dark")}
                    />{" "}
                    Dark
                  </label>
                </fieldset>
                <fieldset>
                  <legend>Inbox density</legend>
                  <label>
                    <input
                      type="radio"
                      name="tmp-mail-density"
                      checked={density === "comfortable"}
                      onChange={() => setDensity("comfortable")}
                    />{" "}
                    Comfortable
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="tmp-mail-density"
                      checked={density === "compact"}
                      onChange={() => setDensity("compact")}
                    />{" "}
                    Compact
                  </label>
                </fieldset>
                <div className="tmp-gmail-settings-note">
                  <Check size={16} /> Search and folder choices still use your
                  connected Gmail account.
                </div>
              </div>
            )}
            {settingsTab === "accounts" && (
              <div className="tmp-gmail-settings-content">
                <h3>Connected accounts</h3>
                <div className="tmp-gmail-account-card">
                  <span className="tmp-gmail-profile-large">
                    {(status?.email || ownerEmail || "T")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <div>
                    <strong>{status?.email || "Gmail is not connected"}</strong>
                    <small>
                      {isConnected
                        ? "Google account connected"
                        : "Google account not connected"}
                    </small>
                  </div>
                </div>
                <div className="tmp-gmail-account-card is-owner">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>TMP Server owner</strong>
                    <small>{ownerEmail || "Owner email unavailable"}</small>
                  </div>
                </div>
                <p>
                  Only the existing owner session can use this mailbox. The
                  Google account must match the configured owner.
                </p>
                {isConnected ? (
                  <div className="tmp-gmail-settings-actions">
                    <button
                      type="button"
                      className="tmp-gmail-secondary-button"
                      onClick={onConnect}
                      disabled={busy}
                    >
                      <ShieldCheck size={15} /> Re-authorize Google
                    </button>
                    <button
                      type="button"
                      className="tmp-gmail-secondary-button is-danger"
                      onClick={onDisconnect}
                      disabled={busy}
                    >
                      Disconnect Gmail
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="tmp-gmail-primary-button"
                    onClick={onConnect}
                    disabled={busy || !clientIdReady}
                  >
                    <ShieldCheck size={15} /> Connect Google
                  </button>
                )}
              </div>
            )}
            {settingsTab === "privacy" && (
              <div className="tmp-gmail-settings-content">
                <h3>Privacy &amp; mailbox behavior</h3>
                <ul className="tmp-gmail-privacy-list">
                  <li>
                    <ShieldCheck size={16} />
                    <span>
                      TMP Mail is protected by the existing Supabase owner-only
                      sign-in.
                    </span>
                  </li>
                  <li>
                    <Mail size={16} />
                    <span>
                      Message content stays in this browser tab's memory; the
                      host agent does not store or log message bodies.
                    </span>
                  </li>
                  <li>
                    <Search size={16} />
                    <span>
                      Google access tokens are short-lived and held in browser
                      memory, not saved in local storage.
                    </span>
                  </li>
                  <li>
                    <FileText size={16} />
                    <span>
                      HTML email is isolated in a sandboxed frame and does not
                      send a referrer.
                    </span>
                  </li>
                  <li>
                    <Star size={16} />
                    <span>
                      Star/unstar is a Gmail action. Opening unread mail changes
                      only its appearance in this view; Gmail's unread label is
                      unchanged.
                    </span>
                  </li>
                  <li>
                    <CircleAlert size={16} />
                    <span>
                      Archive, delete, and mark-read actions are not available
                      in this version.
                    </span>
                  </li>
                </ul>
                <p className="tmp-gmail-settings-note">
                  Theme and density preferences are the only mailbox data saved
                  locally.
                </p>
              </div>
            )}
            <footer>
              <span>TMP Mail · private owner mailbox</span>
              <a href="https://tmpserver.com/" rel="noopener noreferrer">
                TMP Server dashboard
                <ExternalLink size={13} />
              </a>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
