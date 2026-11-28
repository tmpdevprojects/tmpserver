import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronRight,
  Cloud,
  Download,
  Eye,
  File,
  FileArchive,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  LoaderCircle,
  Music2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import type { CloudFile } from "@/lib/tmp-data";

export type CloudCategory = "all" | "folders" | "backups" | "documents" | "images" | "videos" | "audio" | "archives" | "other";
type CategoryRow = { id: CloudCategory; label: string };

const categories: CategoryRow[] = [
  { id: "all", label: "All files" },
  { id: "folders", label: "Folders" },
  { id: "backups", label: "Backups" },
  { id: "documents", label: "Documents" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "archives", label: "Archives" },
  { id: "other", label: "Other" },
];

const categoryIcons: Record<CloudCategory, typeof Cloud> = {
  all: Cloud,
  folders: Folder,
  backups: Archive,
  documents: FileText,
  images: ImageIcon,
  videos: Video,
  audio: Music2,
  archives: FileArchive,
  other: File,
};

type PreviewKind = "image" | "pdf" | "text";
type CloudPreview =
  | { file: CloudFile; kind: "image" | "pdf"; url: string }
  | { file: CloudFile; kind: "text"; text: string };

const CLOUD_PREVIEW_BYTES = 10 * 1024 * 1024;
const CLOUD_TEXT_PREVIEW_BYTES = 1024 * 1024;
const IMAGE_PREVIEW_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico", "tif", "tiff"]);
const TEXT_PREVIEW_EXTENSIONS = new Set(["txt", "md", "csv", "tsv", "log", "json", "yaml", "yml", "xml", "html", "htm", "css", "js", "mjs", "ts", "tsx", "jsx", "py", "sh", "bash", "ini", "conf", "toml", "properties", "sql", "java", "c", "h", "cpp", "hpp", "rs", "go", "php", "rb", "ps1"]);

function previewKind(file: CloudFile): PreviewKind | null {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (IMAGE_PREVIEW_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) return "text";
  return null;
}

function previewLimit(kind: PreviewKind) {
  return kind === "text" ? CLOUD_TEXT_PREVIEW_BYTES : CLOUD_PREVIEW_BYTES;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function categoryFor(file: CloudFile): Exclude<CloudCategory, "all" | "folders"> {
  const path = file.name.toLowerCase();
  if (path === "minecraft-latest.tar.gz" || /(?:backup|snapshot|\.bak(?:\.|$))/.test(path)) return "backups";
  if (/\.(pdf|doc|docx|odt|rtf|txt|md|csv|xls|xlsx|ppt|pptx|json|yaml|yml|xml|html|css|js|ts|py|log)$/.test(path)) return "documents";
  if (/\.(png|jpe?g|gif|webp|svg|bmp|tif?f|heic|avif)$/.test(path)) return "images";
  if (/\.(mp4|m4v|mov|mkv|webm|avi|mpeg|mpg|3gp)$/.test(path)) return "videos";
  if (/\.(mp3|m4a|wav|ogg|flac|aac|opus)$/.test(path)) return "audio";
  if (/\.(zip|tar|gz|tgz|bz2|xz|7z|rar|zst)$/.test(path)) return "archives";
  return "other";
}

function fileIcon(file: CloudFile) {
  const category = categoryFor(file);
  if (category === "backups" || category === "archives") return FileArchive;
  if (category === "documents") return FileText;
  if (category === "images") return ImageIcon;
  if (category === "videos") return Video;
  if (category === "audio") return Music2;
  return File;
}

function CloudInlinePreview({ file, kind, enabled, onPreview }: { file: CloudFile; kind: PreviewKind | null; enabled: boolean; onPreview: (file: CloudFile) => Promise<Blob> }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [content, setContent] = useState<{ url?: string; text?: string; error?: string; loading: boolean }>({ loading: false });

  useEffect(() => {
    const element = elementRef.current;
    if (!enabled || !kind || !element) return;
    if (!("IntersectionObserver" in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "280px 0px", threshold: 0.01 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, kind, file.path]);

  useEffect(() => {
    if (!enabled || !kind || !nearViewport || file.size > previewLimit(kind)) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setContent({ loading: true });
    void onPreview(file).then(async blob => {
      if (blob.size > previewLimit(kind)) throw new Error("This file exceeds the safe preview size limit.");
      if (kind === "text") {
        const text = await blob.text();
        if (!cancelled) setContent({ text, loading: false });
      } else {
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setContent({ url: objectUrl, loading: false });
      }
    }).catch(failure => {
      if (!cancelled) setContent({ error: failure instanceof Error ? failure.message : "Preview unavailable.", loading: false });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, kind, nearViewport, file, onPreview]);

  if (!kind || file.size > previewLimit(kind)) return <div ref={elementRef} className="cloud-inline-placeholder"><File size={20} /><span>{kind ? "Over preview limit · download to view" : "No safe inline preview · download to view"}</span></div>;
  if (!enabled) return <div ref={elementRef} className="cloud-inline-placeholder"><HardDrive size={20} /><span>Preview waits for verified Cloud storage</span></div>;
  if (!nearViewport || content.loading) return <div ref={elementRef} className="cloud-inline-placeholder" aria-live="polite"><LoaderCircle size={18} className="cloud-preview-spin" /><span>Loading safe preview…</span></div>;
  if (content.error) return <div ref={elementRef} className="cloud-inline-placeholder has-error"><File size={20} /><span>{content.error}</span></div>;
  if (kind === "image" && content.url) return <div ref={elementRef} className="cloud-inline-preview"><img loading="lazy" src={content.url} alt={file.name} /></div>;
  if (kind === "pdf" && content.url) return <div ref={elementRef} className="cloud-inline-preview pdf-preview"><iframe title={`Safe inline PDF preview: ${file.name}`} src={content.url} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" /></div>;
  return <div ref={elementRef} className="cloud-inline-preview text-preview"><pre>{content.text ?? ""}</pre></div>;
}

type CloudPanelProps = {
  files: CloudFile[];
  folders: string[];
  usedBytes: number;
  busy: boolean;
  error: string;
  storageAvailable: boolean | null;
  uploadProgress: number | null;
  uploadStatus: string;
  onUpload: (files: File[], folder: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<boolean>;
  onBackup: () => void;
  onDownload: (file: CloudFile) => void;
  onPreview: (file: CloudFile) => Promise<Blob>;
  onDelete: (file: CloudFile) => void;
  standalone?: boolean;
  category?: CloudCategory;
  onCategoryChange?: (category: CloudCategory) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onRefresh?: () => void;
};

export default function CloudPanel({ files, folders, usedBytes, busy, error, storageAvailable, uploadProgress, uploadStatus, onUpload, onCreateFolder, onBackup, onDownload, onPreview, onDelete, standalone = false, category: controlledCategory, onCategoryChange, searchQuery, onSearchQueryChange, onRefresh }: CloudPanelProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [localCategory, setLocalCategory] = useState<CloudCategory>("all");
  const [localQuery, setLocalQuery] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [preview, setPreview] = useState<CloudPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const category = controlledCategory ?? localCategory;
  const query = searchQuery ?? localQuery;
  const setQuery = (value: string) => onSearchQueryChange ? onSearchQueryChange(value) : setLocalQuery(value);
  const setCategory = (next: CloudCategory) => {
    if (onCategoryChange) onCategoryChange(next);
    else setLocalCategory(next);
  };
  const prefix = currentPath ? `${currentPath}/` : "";
  const directFolders = useMemo(() => folders
    .filter(folder => folder.startsWith(prefix) && folder.slice(prefix.length).length > 0 && !folder.slice(prefix.length).includes("/"))
    .map(path => ({ path, name: path.slice(prefix.length) }))
    .sort((a, b) => a.name.localeCompare(b.name)), [folders, prefix]);
  const directFiles = useMemo(() => files.filter(file => file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes("/")), [files, prefix]);
  const visibleFiles = useMemo(() => directFiles
    .filter(file => category === "all" || category === "folders" ? category !== "folders" : categoryFor(file) === category)
    .filter(file => !query || file.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [directFiles, category, query]);
  const visibleFolders = category === "all" || category === "folders"
    ? directFolders.filter(folder => !query || folder.name.toLowerCase().includes(query.toLowerCase()))
    : [];
  const crumbs = currentPath ? currentPath.split("/").map((name, index, segments) => ({ name, path: segments.slice(0, index + 1).join("/") })) : [];

  useEffect(() => {
    if (!preview || preview.kind === "text") return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPreview(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  async function openPreview(file: CloudFile) {
    const kind = previewKind(file);
    if (!kind || file.size > previewLimit(kind)) return;
    setPreviewLoading(file.path);
    setPreviewError("");
    try {
      const blob = await onPreview(file);
      if (blob.size > previewLimit(kind)) throw new Error("This file exceeds the safe preview size limit. Download it to view it.");
      if (kind === "text") setPreview({ file, kind, text: await blob.text() });
      else setPreview({ file, kind, url: URL.createObjectURL(blob) });
    } catch (previewFailure) {
      setPreviewError(previewFailure instanceof Error ? previewFailure.message : "Could not preview this file.");
    } finally {
      setPreviewLoading(null);
    }
  }

  async function submitFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = folderDraft.trim();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.length > 80) return;
    const path = `${prefix}${name}`;
    if (!await onCreateFolder(path)) return;
    setFolderDraft("");
    setFolderFormOpen(false);
    setCategory("all");
  }

  return <section className={`cloud-page${standalone ? " tmp-cloud-explorer" : ""}`}>
    <div className={`cloud-hero cloud-drive-hero${standalone ? " tmp-cloud-hero" : ""}`}>
      <div>
        <p className="eyebrow">PRIVATE VM STORAGE</p>
        <h2>My Cloud</h2>
        <p>One secure space for files and folders on your server. Select multiple files at once; each file can be any type up to 20 GB and uploads run sequentially in 64 MiB chunks.</p>
        <p className="cloud-preview-help">Safe previews load as files enter view: images and PDFs up to 10 MiB, text/code up to 1 MiB. Uploaded HTML is shown as plain text; SVG is download-only.</p>
        <div className={`cloud-path-note ${storageAvailable === true ? "ready" : storageAvailable === false ? "unavailable" : ""}`}><HardDrive size={13} /><span>{storageAvailable === true ? <>HDD verified · <code>/opt/tmpserver/cloud</code> is bound to the external drive</> : storageAvailable === false ? "External HDD unavailable · Cloud is blocked and will not fall back to the system disk" : "HDD status not verified · Cloud operations remain disabled"} · website ZIP publishing stays separate</span></div>
      </div>
      <div className="cloud-hero-actions">
        {standalone && onRefresh && <button className="button secondary" type="button" onClick={onRefresh} disabled={busy || storageAvailable !== true}><RefreshCw size={15} /> Refresh</button>}
        <button className="button secondary" type="button" onClick={onBackup} disabled={busy || storageAvailable !== true}><Archive size={15} /> {busy ? "Working…" : "Back up Minecraft"}</button>
        <button className="button secondary" type="button" onClick={() => setFolderFormOpen(value => !value)} disabled={busy || storageAvailable !== true}><FolderPlus size={15} /> New folder</button>
        <label className={`button primary upload-button ${storageAvailable === true ? "" : "disabled"}`} aria-disabled={storageAvailable !== true}><Upload size={15} /> {busy ? "Uploading…" : "Upload files"}<input type="file" multiple aria-label="Choose one or more files, up to 20 GB each" onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (selected.length) void onUpload(selected, currentPath); }} disabled={busy || storageAvailable !== true} /></label>
      </div>
    </div>
    {error && !standalone && <p className="form-error" role="alert">{error}</p>}
    {uploadProgress !== null && <div className="upload-progress" aria-live="polite"><div><b>{uploadStatus || `Uploading to ${currentPath || "My Cloud"}`}</b><span>{uploadProgress}% of current file · 64 MiB chunks · keep this page open</span></div><div className="meter"><span style={{ width: `${uploadProgress}%` }} /></div></div>}
    {folderFormOpen && <form className="cloud-new-folder panel" onSubmit={submitFolder}><FolderPlus size={17} /><label className="field-label">Folder name<input autoFocus maxLength={80} value={folderDraft} onChange={event => setFolderDraft(event.target.value)} placeholder="e.g. Server backups" required /></label><span className="cloud-folder-destination">{currentPath || "My Cloud"}</span><button className="button primary" disabled={busy || storageAvailable !== true || !folderDraft.trim()} type="submit"><Plus size={14} /> Create</button><button className="icon-button" type="button" title="Cancel" aria-label="Cancel new folder" onClick={() => { setFolderFormOpen(false); setFolderDraft(""); }}><X size={16} /></button></form>}
    <div className="cloud-stats cloud-drive-stats"><div><span>FILES</span><b>{files.length}</b></div><div><span>FOLDERS</span><b>{folders.length}</b></div><div><span>STORAGE USED</span><b>{formatBytes(usedBytes)}</b></div><div><span>MAX / FILE</span><b>20 GB</b></div></div>
    <div className={`cloud-drive panel${standalone ? " tmp-cloud-drive" : ""}`}>
      <div className="cloud-drive-toolbar">
        <div className="cloud-breadcrumbs" aria-label="Cloud folder path"><button type="button" onClick={() => { setCurrentPath(""); setCategory("all"); }} className={!currentPath ? "current" : ""}><Cloud size={14} /> My Cloud</button>{crumbs.map(crumb => <span key={crumb.path}><ChevronRight size={13} /><button type="button" className={crumb.path === currentPath ? "current" : ""} onClick={() => { setCurrentPath(crumb.path); setCategory("all"); }}>{crumb.name}</button></span>)}</div>
        {!standalone && <label className="cloud-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this folder" aria-label="Search current Cloud folder" /></label>}
      </div>
      <div className={`cloud-category-tabs${standalone ? " tmp-cloud-category-nav" : ""}`} role="navigation" aria-label="Browse Cloud categories">{categories.map(item => { const Icon = categoryIcons[item.id]; return <button key={item.id} type="button" className={category === item.id ? "active" : ""} aria-current={category === item.id ? "page" : undefined} onClick={() => setCategory(item.id)}><Icon size={15} />{item.label}{item.id === "folders" && <span>{directFolders.length}</span>}</button>; })}</div>
      <div className="cloud-current-path"><div><p className="eyebrow">{currentPath ? "CURRENT FOLDER" : "ROOT FOLDER"}</p><h3>{currentPath.split("/").at(-1) || "My Cloud"}</h3></div><span>{visibleFolders.length} folder{visibleFolders.length === 1 ? "" : "s"} · {visibleFiles.length} file{visibleFiles.length === 1 ? "" : "s"}</span></div>
      {standalone ? <div className="cloud-inline-grid" aria-label="Cloud files and inline previews">
        {visibleFolders.map(folder => <button type="button" className="cloud-inline-folder" key={folder.path} onClick={() => { setCurrentPath(folder.path); setCategory("all"); setQuery(""); }}><span><Folder size={18} /><strong>{folder.name}</strong></span><small>Folder <ChevronRight size={14} /></small></button>)}
        {visibleFiles.map(file => {
          const Icon = fileIcon(file);
          const kind = previewKind(file);
          const tooLarge = kind !== null && file.size > previewLimit(kind);
          return <article className="cloud-inline-card" key={file.path}>
            <header><button type="button" className="cloud-inline-name" onClick={() => void openPreview(file)} disabled={!kind || tooLarge || storageAvailable !== true} title={!kind ? "No safe preview available" : tooLarge ? "Over the safe preview limit" : "Open full preview"}><Icon size={16} /><span>{file.name}</span></button><button type="button" className="icon-button" title="Open full preview" aria-label={`Open full preview for ${file.name}`} onClick={() => void openPreview(file)} disabled={!kind || tooLarge || storageAvailable !== true || previewLoading === file.path}>{previewLoading === file.path ? <LoaderCircle size={15} className="cloud-preview-spin" /> : <Eye size={15} />}</button></header>
            <CloudInlinePreview file={file} kind={kind} enabled={storageAvailable === true} onPreview={onPreview} />
            <footer><span>{formatBytes(file.size)} · {new Date(file.modified * 1000).toLocaleDateString()}</span><span><button type="button" className="cloud-inline-action" onClick={() => onDownload(file)} disabled={storageAvailable !== true} aria-label={`Download ${file.name}`} title="Download"><Download size={15} /></button><button type="button" className="cloud-inline-action" onClick={() => onDelete(file)} disabled={busy || storageAvailable !== true} aria-label={`Delete ${file.name}`} title="Delete"><Trash2 size={15} /></button></span></footer>
          </article>;
        })}
        {!visibleFolders.length && !visibleFiles.length && <div className="cloud-empty"><Cloud size={24} /><p>{storageAvailable !== true ? "Cloud contents are hidden until the external HDD and bind mount are verified." : query ? "No matching files or folders." : category === "folders" ? "This folder has no subfolders." : category === "all" && !currentPath ? "Your Cloud is ready. Create a folder or upload any file type." : `No ${category === "all" ? "files" : category} here yet.`}</p></div>}
      </div> : <div className="cloud-table cloud-drive-table"><div className="cloud-row cloud-head"><span>NAME</span><span>SIZE</span><span>MODIFIED</span><span /></div>
        {visibleFolders.map(folder => <div className="cloud-row cloud-folder-row" key={folder.path}><button type="button" className="cloud-name cloud-folder-name" onClick={() => { setCurrentPath(folder.path); setCategory("all"); setQuery(""); }}><Folder size={17} />{folder.name}<ChevronRight size={14} className="cloud-folder-open" /></button><span>Folder</span><span>—</span><span /></div>)}
        {visibleFiles.map(file => {
          const Icon = fileIcon(file);
          const kind = previewKind(file);
          const tooLarge = kind !== null && file.size > previewLimit(kind);
          const canPreview = kind !== null && !tooLarge && storageAvailable === true;
          const previewTitle = tooLarge ? "File exceeds the preview limit; download it to view" : storageAvailable === true ? "Click to preview" : "Preview is unavailable until Cloud storage is connected";
          return <div className="cloud-row" key={file.path}>
            {kind ? <button type="button" className="cloud-name cloud-file-open" title={previewTitle} aria-label={`Open preview for ${file.name}`} onClick={() => void openPreview(file)} disabled={!canPreview || previewLoading === file.path}><Icon size={16} /><span>{file.name}</span></button> : <span className="cloud-name"><Icon size={16} />{file.name}</span>}
            <span>{formatBytes(file.size)}</span>
            <span>{new Date(file.modified * 1000).toLocaleString()}</span>
            <span className="cloud-actions">{kind && <button type="button" className="icon-button" title={tooLarge ? "File exceeds the preview limit" : "Preview"} aria-label={`Preview ${file.name}`} onClick={() => void openPreview(file)} disabled={storageAvailable !== true || tooLarge || previewLoading === file.path}>{previewLoading === file.path ? <LoaderCircle size={15} className="cloud-preview-spin" /> : <Eye size={15} />}</button>}<button type="button" className="icon-button" title="Download" aria-label={`Download ${file.name}`} onClick={() => onDownload(file)} disabled={storageAvailable !== true}><Download size={15} /></button><button type="button" className="icon-button" title="Delete" aria-label={`Delete ${file.name}`} onClick={() => onDelete(file)} disabled={busy || storageAvailable !== true}><Trash2 size={15} /></button></span>
          </div>;
        })}
        {!visibleFolders.length && !visibleFiles.length && <div className="cloud-empty"><Cloud size={24} /><p>{storageAvailable !== true ? "Cloud contents are hidden until the external HDD and bind mount are verified." : query ? "No matching files or folders." : category === "folders" ? "This folder has no subfolders." : category === "all" && !currentPath ? "Your Cloud is ready. Create a folder or upload any file type." : `No ${category === "all" ? "files" : category} here yet.`}</p></div>}
      </div>}
      <div className="cloud-drive-footer"><span>{files.length} files · {folders.length} folders across Cloud</span><span>Uploads replace same-path files only after confirmation.</span></div>
    </div>
    {!standalone && <p className="route-help">Click a supported image, PDF, or text/code filename to open its preview; search is optional. Other file types stay downloadable, Minecraft rolling backups remain in Cloud, and website deployments use the separate ZIP-only flow.</p>}
    {previewError && <div className="cloud-preview-error" role="alert"><span>{previewError}</span><button type="button" className="icon-button" onClick={() => setPreviewError("")} aria-label="Dismiss preview error"><X size={15} /></button></div>}
    {preview && <div className="cloud-preview-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null); }}>
      <section className="cloud-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-preview-title">
        <header className="cloud-preview-header"><div><p className="eyebrow">PRIVATE CLOUD PREVIEW</p><h2 id="cloud-preview-title">{preview.file.name}</h2><span>{formatBytes(preview.file.size)} · {preview.kind === "text" ? "plain text" : preview.kind === "pdf" ? "PDF document" : "image"}</span></div><button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label="Close preview"><X size={18} /></button></header>
        <div className={`cloud-preview-content ${preview.kind === "text" ? "text-preview" : ""}`}>
          {preview.kind === "image" && <img src={preview.url} alt={preview.file.name} />}
          {preview.kind === "pdf" && <iframe title={`PDF preview: ${preview.file.name}`} src={preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer" />}
          {preview.kind === "text" && <pre>{preview.text}</pre>}
        </div>
      </section>
    </div>}
  </section>;
}
