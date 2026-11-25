import { useMemo, useState } from "react";
import {
  Archive,
  ChevronRight,
  Cloud,
  Download,
  File,
  FileArchive,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Music2,
  Plus,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import type { CloudFile } from "@/lib/tmp-data";

type Category = "all" | "folders" | "backups" | "documents" | "images" | "videos" | "audio" | "archives" | "other";
type CategoryRow = { id: Category; label: string };

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

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function categoryFor(file: CloudFile): Exclude<Category, "all" | "folders"> {
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
  onDelete: (file: CloudFile) => void;
};

export default function CloudPanel({ files, folders, usedBytes, busy, error, storageAvailable, uploadProgress, uploadStatus, onUpload, onCreateFolder, onBackup, onDownload, onDelete }: CloudPanelProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [folderFormOpen, setFolderFormOpen] = useState(false);
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

  return <section className="cloud-page">
    <div className="cloud-hero cloud-drive-hero">
      <div>
        <p className="eyebrow">PRIVATE VM STORAGE</p>
        <h2>My Cloud</h2>
        <p>One secure space for files and folders on your server. Select multiple files at once; each file can be any type up to 20 GB and uploads run sequentially in 64 MiB chunks.</p>
        <div className={`cloud-path-note ${storageAvailable === true ? "ready" : storageAvailable === false ? "unavailable" : ""}`}><HardDrive size={13} /><span>{storageAvailable === true ? <>HDD verified · <code>/opt/tmpserver/cloud</code> is bound to the external drive</> : storageAvailable === false ? "External HDD unavailable · Cloud is blocked and will not fall back to the system disk" : "HDD status not verified · Cloud operations remain disabled"} · website ZIP publishing stays separate</span></div>
      </div>
      <div className="cloud-hero-actions">
        <button className="button secondary" onClick={onBackup} disabled={busy || storageAvailable !== true}><Archive size={15} /> {busy ? "Working…" : "Back up Minecraft"}</button>
        <button className="button secondary" onClick={() => setFolderFormOpen(value => !value)} disabled={busy || storageAvailable !== true}><FolderPlus size={15} /> New folder</button>
        <label className={`button primary upload-button ${storageAvailable === true ? "" : "disabled"}`} aria-disabled={storageAvailable !== true}><Upload size={15} /> {busy ? "Uploading…" : "Upload files"}<input type="file" multiple aria-label="Choose one or more files, up to 20 GB each" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (files.length) void onUpload(files, currentPath); }} disabled={busy || storageAvailable !== true} /></label>
      </div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {uploadProgress !== null && <div className="upload-progress" aria-live="polite"><div><b>{uploadStatus || `Uploading to ${currentPath || "My Cloud"}`}</b><span>{uploadProgress}% of current file · 64 MiB chunks · keep this page open</span></div><div className="meter"><span style={{ width: `${uploadProgress}%` }} /></div></div>}
    {folderFormOpen && <form className="cloud-new-folder panel" onSubmit={submitFolder}><FolderPlus size={17} /><label className="field-label">Folder name<input autoFocus maxLength={80} value={folderDraft} onChange={event => setFolderDraft(event.target.value)} placeholder="e.g. Server backups" required /></label><span className="cloud-folder-destination">{currentPath || "My Cloud"}</span><button className="button primary" disabled={busy || storageAvailable !== true || !folderDraft.trim()} type="submit"><Plus size={14} /> Create</button><button className="icon-button" type="button" title="Cancel" aria-label="Cancel new folder" onClick={() => { setFolderFormOpen(false); setFolderDraft(""); }}><X size={16} /></button></form>}
    <div className="cloud-stats cloud-drive-stats"><div><span>FILES</span><b>{files.length}</b></div><div><span>FOLDERS</span><b>{folders.length}</b></div><div><span>STORAGE USED</span><b>{formatBytes(usedBytes)}</b></div><div><span>MAX / FILE</span><b>20 GB</b></div></div>
    <div className="cloud-drive panel">
      <div className="cloud-drive-toolbar">
        <div className="cloud-breadcrumbs" aria-label="Cloud folder path"><button onClick={() => { setCurrentPath(""); setCategory("all"); }} className={!currentPath ? "current" : ""}><Cloud size={14} /> My Cloud</button>{crumbs.map(crumb => <span key={crumb.path}><ChevronRight size={13} /><button className={crumb.path === currentPath ? "current" : ""} onClick={() => { setCurrentPath(crumb.path); setCategory("all"); }}>{crumb.name}</button></span>)}</div>
        <label className="cloud-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this folder" aria-label="Search current Cloud folder" /></label>
      </div>
      <div className="cloud-category-tabs" role="tablist" aria-label="Filter Cloud files">{categories.map(item => <button key={item.id} className={category === item.id ? "active" : ""} role="tab" aria-selected={category === item.id} onClick={() => setCategory(item.id)}>{item.label}{item.id === "folders" && <span>{directFolders.length}</span>}</button>)}</div>
      <div className="cloud-current-path"><div><p className="eyebrow">{currentPath ? "CURRENT FOLDER" : "ROOT FOLDER"}</p><h3>{currentPath.split("/").at(-1) || "My Cloud"}</h3></div><span>{visibleFolders.length} folder{visibleFolders.length === 1 ? "" : "s"} · {visibleFiles.length} file{visibleFiles.length === 1 ? "" : "s"}</span></div>
      <div className="cloud-table cloud-drive-table"><div className="cloud-row cloud-head"><span>NAME</span><span>SIZE</span><span>MODIFIED</span><span /></div>
        {visibleFolders.map(folder => <div className="cloud-row cloud-folder-row" key={folder.path}><button className="cloud-name cloud-folder-name" onClick={() => { setCurrentPath(folder.path); setCategory("all"); setQuery(""); }}><Folder size={17} />{folder.name}<ChevronRight size={14} className="cloud-folder-open" /></button><span>Folder</span><span>—</span><span /></div>)}
        {visibleFiles.map(file => { const Icon = fileIcon(file); return <div className="cloud-row" key={file.path}><span className="cloud-name"><Icon size={16} />{file.name}</span><span>{formatBytes(file.size)}</span><span>{new Date(file.modified * 1000).toLocaleString()}</span><span className="cloud-actions"><button className="icon-button" title="Download" aria-label={`Download ${file.name}`} onClick={() => onDownload(file)} disabled={storageAvailable !== true}><Download size={15} /></button><button className="icon-button" title="Delete" aria-label={`Delete ${file.name}`} onClick={() => onDelete(file)} disabled={busy || storageAvailable !== true}><Trash2 size={15} /></button></span></div>; })}
        {!visibleFolders.length && !visibleFiles.length && <div className="cloud-empty"><Cloud size={24} /><p>{storageAvailable !== true ? "Cloud contents are hidden until the external HDD and bind mount are verified." : query ? "No matching files or folders." : category === "folders" ? "This folder has no subfolders." : category === "all" && !currentPath ? "Your Cloud is ready. Create a folder or upload any file type." : `No ${category === "all" ? "files" : category} here yet.`}</p></div>}
      </div>
      <div className="cloud-drive-footer"><span>{files.length} files · {folders.length} folders across Cloud</span><span>Uploads replace same-path files only after confirmation.</span></div>
    </div>
    <p className="route-help">Minecraft rolling backups stay in this Cloud storage, and website deployments remain a separate ZIP-only feature. Deleting a file removes it from host storage after confirmation.</p>
  </section>;
}
