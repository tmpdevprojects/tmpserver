#!/usr/bin/env python3
import json
import cgi
import io
import mimetypes
import os
import re
import stat
import shlex
import shutil
import subprocess
import time
import tempfile
import zipfile
import selectors
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOST = "127.0.0.1"
PORT = int(os.environ.get("TMP_AGENT_PORT", "8787"))
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "").strip().lower()
ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get("ALLOWED_ORIGIN", "https://thekingofcode7712.github.io").split(",")
    if origin.strip()
}
ALLOWED_ORIGINS.update({"https://tmpserver.com", "https://www.tmpserver.com", "https://mail.tmpserver.com"})
PUBLIC_HOSTNAME = os.environ.get("PUBLIC_HOSTNAME", "140.238.70.11")
STARTED = time.time()
NETWORK_SAMPLE = None
USERNAME_RE = re.compile(r"^[A-Za-z0-9_\.]{3,16}$")
CONSOLE_RE = re.compile(r"^[^\x00-\x1f\x7f]{1,240}$")
COMPOSE_FILE = "/opt/tmpserver/minecraft/compose.yml"
BACKUP_SCRIPT = "/usr/local/bin/tmpserver-minecraft-backup"
CLOUD_ROOT = "/opt/tmpserver/cloud"
WEBSITES_ROOT = "/opt/tmpserver/websites"
WEBSITES_INDEX = os.path.join(WEBSITES_ROOT, "sites.json")
CADDYFILE = "/etc/caddy/Caddyfile"
MAX_CLOUD_FILE_SIZE = 20_000_000_000
CLOUD_UPLOAD_CHUNK_BYTES = 64 * 1024**2
MAX_CLOUD_UPLOAD_CHUNKS = (MAX_CLOUD_FILE_SIZE + CLOUD_UPLOAD_CHUNK_BYTES - 1) // CLOUD_UPLOAD_CHUNK_BYTES
MAX_CLOUD_PREVIEW_BYTES = 10 * 1024**2
MAX_CLOUD_TEXT_PREVIEW_BYTES = 1024 * 1024
CLOUD_IMAGE_PREVIEW_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}
CLOUD_TEXT_PREVIEW_EXTENSIONS = {
    ".txt", ".md", ".csv", ".tsv", ".log", ".json", ".yaml", ".yml", ".xml",
    ".html", ".htm", ".css", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".py",
    ".sh", ".bash", ".ini", ".conf", ".toml", ".properties", ".sql", ".java",
    ".c", ".h", ".cpp", ".hpp", ".rs", ".go", ".php", ".rb", ".ps1",
}
MAX_WEBSITE_UPLOAD = 50 * 1024**2
MAX_PLUGIN_UPLOAD = 50 * 1024**2
MAX_LOG_CONTAINERS = 32
MAX_LOG_LIST_BYTES = 32 * 1024
MAX_LOG_CONTAINER_BYTES = 64 * 1024
MAX_LOG_TOTAL_BYTES = 256 * 1024
MINECRAFT_DATA_ROOT = "/opt/tmpserver/minecraft/data"
MINECRAFT_PLUGINS_ROOT = os.path.join(MINECRAFT_DATA_ROOT, "plugins")
EXTERNAL_HDD_ROOT = "/mnt/tmpserver-hdd"
EXTERNAL_HDD_UUID = "7A404FAD470CB2A3"
EXTERNAL_CLOUD_ROOT = os.path.join(EXTERNAL_HDD_ROOT, "tmpserver-cloud")
CLOUD_UPLOADS_ROOT = os.path.join(CLOUD_ROOT, ".tmpserver-upload-staging")
os.makedirs(WEBSITES_ROOT, exist_ok=True)


def json_bytes(value):
    return json.dumps(value, separators=(",", ":")).encode()


def run(command, timeout=15):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def mount_info(path):
    code, output, _ = run(["findmnt", "-rn", "-T", path, "-o", "TARGET,SOURCE,FSTYPE,MAJ:MIN"], timeout=5)
    if code != 0:
        return None
    for line in reversed(output.splitlines()):
        fields = line.split()
        if len(fields) >= 4:
            return {"target": fields[0], "source": fields[1], "filesystem": fields[2], "device": fields[3]}
    return None


def cloud_storage_status():
    status = {
        "available": False,
        "hddMounted": False,
        "cloudMounted": False,
        "cloudOnExternal": False,
        "mount": CLOUD_ROOT,
        "hddMount": EXTERNAL_HDD_ROOT,
        "expectedHddUuid": EXTERNAL_HDD_UUID,
        "message": "Cloud storage is unavailable; no system-disk fallback is permitted.",
    }
    hdd = mount_info(EXTERNAL_HDD_ROOT)
    if not hdd or hdd["target"] != EXTERNAL_HDD_ROOT or hdd["filesystem"] == "autofs":
        status["message"] = f"The required external HDD is not mounted at {EXTERNAL_HDD_ROOT}; Cloud access is blocked and the system disk will not be used."
        return status
    source = hdd["source"].split("[", 1)[0]
    if not source.startswith("/dev/"):
        status["message"] = "The mounted path is not backed by a block device; Cloud access is blocked."
        return status
    uuid_code, uuid, _ = run(["blkid", "-s", "UUID", "-o", "value", source], timeout=5)
    if uuid_code != 0 or uuid.upper() != EXTERNAL_HDD_UUID:
        status["message"] = f"The mounted device at {EXTERNAL_HDD_ROOT} does not match the configured HDD UUID; Cloud access is blocked."
        return status
    status["hddMounted"] = True

    cloud = mount_info(CLOUD_ROOT)
    if not cloud or cloud["target"] != CLOUD_ROOT or cloud["filesystem"] == "autofs":
        status["message"] = f"The HDD is mounted, but its Cloud directory is not bound at {CLOUD_ROOT}; Cloud access is blocked."
        return status
    status["cloudMounted"] = True
    try:
        source_stat = os.stat(EXTERNAL_CLOUD_ROOT)
        cloud_stat = os.stat(CLOUD_ROOT)
    except OSError:
        status["message"] = "The expected Cloud directory on the external HDD is unavailable; Cloud access is blocked."
        return status
    if source_stat.st_dev != cloud_stat.st_dev or source_stat.st_ino != cloud_stat.st_ino or hdd["device"] != cloud["device"]:
        status["message"] = "The Cloud path is not the configured directory on the expected external HDD; Cloud access is blocked."
        return status

    status.update({"available": True, "cloudOnExternal": True, "message": "Cloud storage is mounted on the configured external HDD."})
    return status


def ensure_cloud_storage():
    status = cloud_storage_status()
    if status["available"]:
        return status
    device_link = f"/dev/disk/by-uuid/{EXTERNAL_HDD_UUID}"
    if not os.path.exists(device_link):
        status["message"] = f"The required external HDD {EXTERNAL_HDD_UUID} is not connected; Cloud and backup operations are blocked, with no system-disk fallback."
        return status

    unit_specs = ((EXTERNAL_HDD_ROOT, "automount"), (EXTERNAL_HDD_ROOT, "mount"), (CLOUD_ROOT, "mount"))
    units = []
    for path, suffix in unit_specs:
        escape_code, unit, _ = run(["systemd-escape", "--path", f"--suffix={suffix}", path], timeout=5)
        if escape_code != 0 or not unit:
            status["message"] = f"Could not resolve the systemd {suffix} unit for {path}; Cloud access is blocked."
            return status
        units.append(unit)

    for unit in units:
        state_code, state, _ = run(["systemctl", "show", unit, "--property=ActiveState", "--value"], timeout=5)
        if state_code == 0 and state == "failed":
            run(["systemctl", "reset-failed", unit], timeout=5)

    code, stdout, stderr = run(["systemctl", "start", units[1]], timeout=30)
    if code != 0:
        status["message"] = f"The external HDD could not be mounted; Cloud access is blocked. {stderr[-240:] or stdout[-240:]}"
        return status
    status = cloud_storage_status()
    if not status["hddMounted"]:
        return status

    code, stdout, stderr = run(["systemctl", "start", units[2]], timeout=30)
    if code != 0:
        status = cloud_storage_status()
        status["message"] = f"The HDD is connected, but its Cloud bind mount could not be activated; Cloud access is blocked. {stderr[-240:] or stdout[-240:]}"
        return status
    return cloud_storage_status()


def run_bounded_stdout(command, timeout=15, max_bytes=MAX_LOG_CONTAINER_BYTES):
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
    except OSError:
        return 127, "", False, 0
    output = bytearray()
    truncated = False
    timed_out = False
    started = time.monotonic()
    try:
        if process.stdout is None:
            process.kill()
            process.wait()
            return 127, "", False, 0
        os.set_blocking(process.stdout.fileno(), False)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    timed_out = True
                    break
                if not selector.select(min(remaining, 0.2)):
                    continue
                try:
                    chunk = os.read(process.stdout.fileno(), min(8192, max_bytes + 1 - len(output)))
                except BlockingIOError:
                    continue
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > max_bytes:
                    truncated = True
                    break
    finally:
        if process.poll() is None:
            process.kill()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        if process.stdout is not None:
            process.stdout.close()
    if timed_out:
        raise subprocess.TimeoutExpired(command, timeout)
    if truncated:
        del output[max_bytes:]
    return process.returncode or 0, output.decode("utf-8", errors="replace"), truncated, len(output)


def network_state():
    global NETWORK_SAMPLE
    counters = {}
    try:
        with open("/proc/net/dev", "r", encoding="utf-8") as file:
            for line in file:
                if ":" not in line:
                    continue
                interface, values = line.split(":", 1)
                interface = interface.strip()
                fields = values.split()
                if interface == "lo" or len(fields) < 16:
                    continue
                counters[interface] = {"rxBytes": int(fields[0]), "rxPackets": int(fields[1]), "rxDropped": int(fields[3]), "txBytes": int(fields[8]), "txPackets": int(fields[9]), "txDropped": int(fields[11])}
    except (OSError, ValueError):
        return {"interface": "—", "linkMbps": 0, "sampleSeconds": 0, "rxBytes": 0, "txBytes": 0, "rxBytesPerSecond": 0, "txBytesPerSecond": 0, "rxPacketsPerSecond": 0, "txPacketsPerSecond": 0, "rxDropped": 0, "txDropped": 0}
    interface = next(iter(counters), "—")
    try:
        with open(f"/sys/class/net/{interface}/speed", "r", encoding="utf-8") as file:
            link_mbps = max(0, int(file.read().strip()))
    except (OSError, ValueError):
        link_mbps = 0
    current = counters.get(interface, {"rxBytes": 0, "rxPackets": 0, "rxDropped": 0, "txBytes": 0, "txPackets": 0, "txDropped": 0})
    now = time.monotonic()
    previous = NETWORK_SAMPLE
    elapsed = now - previous["time"] if previous else 0
    if previous and elapsed > 0 and previous["interface"] == interface:
        rx_rate = max(0, current["rxBytes"] - previous["rxBytes"]) / elapsed
        tx_rate = max(0, current["txBytes"] - previous["txBytes"]) / elapsed
        rx_packets_rate = max(0, current["rxPackets"] - previous["rxPackets"]) / elapsed
        tx_packets_rate = max(0, current["txPackets"] - previous["txPackets"]) / elapsed
    else:
        rx_rate = tx_rate = rx_packets_rate = tx_packets_rate = 0
    NETWORK_SAMPLE = {"time": now, "interface": interface, **current}
    return {"interface": interface, "linkMbps": link_mbps, "sampleSeconds": round(elapsed, 1), **current, "rxBytesPerSecond": round(rx_rate, 1), "txBytesPerSecond": round(tx_rate, 1), "rxPacketsPerSecond": round(rx_packets_rate, 1), "txPacketsPerSecond": round(tx_packets_rate, 1)}


def auth_user(handler):
    header = handler.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    if not token:
        return None
    request = Request(f"{SUPABASE_URL}/auth/v1/user", headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"})
    try:
        with urlopen(request, timeout=8) as response:
            user = json.loads(response.read())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return None
    email = str(user.get("email", "")).strip().lower()
    if OWNER_EMAIL and email == OWNER_EMAIL:
        return user
    return None


GMAIL_SCOPES = {
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
}


class GmailStorageError(Exception):
    pass


class GmailProviderError(Exception):
    def __init__(self, message, diagnostic="provider error"):
        super().__init__(message)
        self.diagnostic = diagnostic


def gmail_diagnostic(event):
    # Fixed event labels only: never include authorization codes, tokens, headers, or mailbox data.
    print(f"tmpserver-gmail: {event}", flush=True)


def gmail_config():
    client_id = os.environ.get("GMAIL_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GMAIL_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        return None
    return client_id, client_secret


def gmail_token_path():
    path = os.path.abspath(os.environ.get("GMAIL_TOKEN_PATH", "/var/lib/tmpserver-gmail/oauth.json"))
    if not os.path.basename(path) or path == os.path.abspath(os.sep):
        raise GmailStorageError("Gmail token storage is unavailable.")
    return path


def gmail_secure_directory(create=False):
    path = os.path.dirname(gmail_token_path())
    try:
        if create and not os.path.exists(path):
            os.makedirs(path, mode=0o700, exist_ok=True)
        info = os.lstat(path)
    except OSError as error:
        raise GmailStorageError("Gmail token storage is unavailable.") from error
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.geteuid():
        raise GmailStorageError("Gmail token storage permissions are unsafe.")
    return path


def gmail_read_token():
    path = gmail_token_path()
    if not os.path.lexists(path):
        parent = os.path.dirname(path)
        if not os.path.lexists(parent):
            return None
    directory = gmail_secure_directory()
    try:
        info = os.lstat(path)
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.geteuid():
            raise GmailStorageError("Gmail token storage permissions are unsafe.")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as file:
            opened = os.fstat(file.fileno())
            if not stat.S_ISREG(opened.st_mode) or opened.st_ino != info.st_ino or opened.st_dev != info.st_dev:
                raise GmailStorageError("Gmail token storage is unsafe.")
            raw = file.read(16385)
    except FileNotFoundError:
        return None
    except GmailStorageError:
        raise
    except OSError as error:
        raise GmailStorageError("Gmail token storage is unavailable.") from error
    if len(raw) > 16384:
        raise GmailStorageError("Gmail token storage is invalid.")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GmailStorageError("Gmail token storage is invalid.") from error
    if (not isinstance(value, dict) or set(value) != {"refresh_token", "email", "scopes", "timestamp"}
            or not isinstance(value.get("refresh_token"), str) or not value["refresh_token"]
            or not isinstance(value.get("email"), str) or not value["email"]
            or not isinstance(value.get("scopes"), list) or set(value["scopes"]) != GMAIL_SCOPES
            or not isinstance(value.get("timestamp"), str)):
        raise GmailStorageError("Gmail token storage is invalid.")
    return value


def gmail_write_token(refresh_token, email, scopes):
    path = gmail_token_path()
    directory = gmail_secure_directory(create=True)
    if not isinstance(scopes, list) or set(scopes) != GMAIL_SCOPES:
        raise GmailStorageError("Gmail authorization scopes are invalid.")
    try:
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            info = None
        if info is not None and (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.geteuid()):
            raise GmailStorageError("Gmail token storage permissions are unsafe.")
        value = {"refresh_token": refresh_token, "email": email, "scopes": scopes, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        fd, temporary_path = tempfile.mkstemp(prefix=".oauth-", dir=directory)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(value, file, separators=(",", ":"))
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary_path, path)
            directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except Exception:
            try:
                os.remove(temporary_path)
            except OSError:
                pass
            raise
    except GmailStorageError:
        raise
    except OSError as error:
        raise GmailStorageError("Gmail token storage could not be updated securely.") from error


def gmail_remove_token():
    path = gmail_token_path()
    if not os.path.lexists(path) and not os.path.lexists(os.path.dirname(path)):
        return
    gmail_secure_directory()
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    except OSError as error:
        raise GmailStorageError("Gmail token storage is unavailable.") from error
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.geteuid():
        raise GmailStorageError("Gmail token storage permissions are unsafe.")
    try:
        os.unlink(path)
    except OSError as error:
        raise GmailStorageError("Gmail token storage could not be removed.") from error


def gmail_provider_json(url, data=None, headers=None):
    request = Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read(65537)
    except HTTPError as error:
        diagnostic = f"Google HTTP {error.code}"
        try:
            provider_error = json.loads(error.read(65537)).get("error")
            if isinstance(provider_error, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", provider_error):
                diagnostic += f" ({provider_error})"
            elif isinstance(provider_error, dict):
                status = provider_error.get("status")
                if isinstance(status, str) and re.fullmatch(r"[A-Z_]{1,64}", status):
                    diagnostic += f" ({status})"
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            pass
        raise GmailProviderError("Google could not complete the Gmail authorization request.", diagnostic) from error
    except (URLError, TimeoutError, OSError) as error:
        raise GmailProviderError("Google could not complete the Gmail authorization request.", "Google network request failed") from error
    if len(raw) > 65536:
        raise GmailProviderError("Google returned an invalid authorization response.", "Google response exceeded the size limit")
    try:
        result = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GmailProviderError("Google returned an invalid authorization response.", "Google returned invalid JSON") from error
    if not isinstance(result, dict):
        raise GmailProviderError("Google returned an invalid authorization response.", "Google response had an unexpected shape")
    return result


def gmail_exchange_code(code, redirect_uri, config):
    client_id, client_secret = config
    data = urlencode({"code": code, "client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect_uri, "grant_type": "authorization_code"}).encode()
    result = gmail_provider_json("https://oauth2.googleapis.com/token", data, {"Content-Type": "application/x-www-form-urlencoded"})
    access_token = result.get("access_token")
    refresh_token = result.get("refresh_token")
    scope_value = result.get("scope")
    if scope_value is None:
        # OAuth permits omitting scope when it is identical to the requested scope set.
        scopes = sorted(GMAIL_SCOPES)
    else:
        scopes = scope_value.split() if isinstance(scope_value, str) else []
    if not isinstance(access_token, str) or not access_token or not isinstance(refresh_token, str) or not refresh_token or set(scopes) != GMAIL_SCOPES:
        missing = []
        if not isinstance(access_token, str) or not access_token:
            missing.append("access token")
        if not isinstance(refresh_token, str) or not refresh_token:
            missing.append("refresh token")
        if set(scopes) != GMAIL_SCOPES:
            missing.append("required scopes")
        raise GmailProviderError("Google did not grant the required Gmail access.", "Google response missing " + ", ".join(missing))
    profile = gmail_provider_json("https://gmail.googleapis.com/gmail/v1/users/me/profile", headers={"Authorization": f"Bearer {access_token}"})
    email = profile.get("emailAddress")
    if not isinstance(email, str) or not email:
        raise GmailProviderError("Google could not verify the Gmail account.")
    return refresh_token, email, sorted(GMAIL_SCOPES)


def gmail_refresh_token(refresh_token, config, scopes):
    client_id, client_secret = config
    data = urlencode({"refresh_token": refresh_token, "client_id": client_id, "client_secret": client_secret, "grant_type": "refresh_token"}).encode()
    result = gmail_provider_json("https://oauth2.googleapis.com/token", data, {"Content-Type": "application/x-www-form-urlencoded"})
    access_token = result.get("access_token")
    expires_in = result.get("expires_in")
    returned_scopes = result.get("scope")
    if returned_scopes is not None and set(str(returned_scopes).split()) != set(scopes):
        raise GmailProviderError("Google returned an invalid Gmail authorization response.")
    if not isinstance(access_token, str) or not access_token or type(expires_in) is not int or expires_in <= 0:
        raise GmailProviderError("Google could not refresh Gmail access.")
    return access_token, expires_in


def host_state():
    with open("/proc/uptime", "r", encoding="utf-8") as file:
        uptime = float(file.read().split()[0])
    mem = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as file:
        for line in file:
            key, value = line.split(":", 1)
            mem[key] = int(value.strip().split()[0]) * 1024
    total = mem.get("MemTotal", 0)
    available = mem.get("MemAvailable", 0)
    disk = shutil.disk_usage("/")
    network = network_state()
    health_code, health, _ = run(["docker", "inspect", "--format", "{{.State.Health.Status}}", "tmpserver-minecraft"])
    if health_code != 0:
        health = "unknown"
    list_code, list_output, _ = run(["docker", "exec", "tmpserver-minecraft", "rcon-cli", "list"])
    player_match = re.search(r"There are\s+(\d+)\s+of a max of\s+(\d+)\s+players online", list_output, re.IGNORECASE)
    online_players = int(player_match.group(1)) if player_match else 0
    max_players = int(player_match.group(2)) if player_match else 0
    ps_code, ps_out, _ = run(["docker", "ps", "--format", "{{.Names}}|{{.Status}}|{{.Ports}}"])
    services = []
    if ps_code == 0:
        for row in ps_out.splitlines():
            name, status, ports = (row.split("|", 2) + ["", ""])[:3]
            services.append({"name": name, "status": status, "ports": ports})
    for site in read_websites():
        services.append({"name": site["name"], "slug": site["slug"], "status": "running" if site.get("active") else "stopped", "ports": f"HTTPS · {site['domain']}", "kind": "Web app", "domain": site["domain"], "files": website_state(site)["files"], "bytes": website_state(site)["bytes"]})
    return {
        "host": {"hostname": os.uname().nodename, "os": "TMP x Triumphant OS v27.13.0", "architecture": os.uname().machine, "uptimeSeconds": round(uptime), "agentUptimeSeconds": round(time.time() - STARTED)},
        "memory": {"totalBytes": total, "availableBytes": available, "usedPercent": round((total - available) / total * 100, 1) if total else 0},
        "disk": {"totalBytes": disk.total, "freeBytes": disk.free, "usedPercent": round((disk.total - disk.free) / disk.total * 100, 1) if disk.total else 0},
        "network": network,
        "minecraft": {"container": "tmpserver-minecraft", "health": health, "portJava": 25565, "portBedrock": 19132, "onlinePlayers": online_players, "maxPlayers": max_players, "publicHostname": PUBLIC_HOSTNAME},
        "services": services,
    }


def safe_cloud_path(value):
    candidate = os.path.normpath(str(value or "").strip().lstrip("/"))
    if not candidate or candidate == "." or candidate.startswith("..") or "/../" in f"/{candidate}/" or "\\" in candidate:
        return None
    parts = candidate.split(os.sep)
    reserved = os.path.basename(CLOUD_UPLOADS_ROOT)
    if any(part == reserved or part.startswith(".tmpserver-upload-") for part in parts):
        return None
    lexical = os.path.abspath(os.path.join(CLOUD_ROOT, candidate))
    root_real = os.path.realpath(CLOUD_ROOT)
    full = os.path.realpath(lexical)
    if full == root_real or not full.startswith(root_real + os.sep):
        return None
    cursor = CLOUD_ROOT
    for part in parts:
        cursor = os.path.join(cursor, part)
        if os.path.islink(cursor):
            return None
    return full


def cloud_preview_type(path):
    extension = os.path.splitext(path)[1].lower()
    if extension in CLOUD_IMAGE_PREVIEW_TYPES:
        return "image", CLOUD_IMAGE_PREVIEW_TYPES[extension], MAX_CLOUD_PREVIEW_BYTES
    if extension == ".pdf":
        return "pdf", "application/pdf", MAX_CLOUD_PREVIEW_BYTES
    if extension in CLOUD_TEXT_PREVIEW_EXTENSIONS:
        return "text", "text/plain; charset=utf-8", MAX_CLOUD_TEXT_PREVIEW_BYTES
    return None


def cloud_files():
    result = []
    for root, directories, names in os.walk(CLOUD_ROOT):
        directories[:] = [name for name in directories if name != os.path.basename(CLOUD_UPLOADS_ROOT)]
        for name in names:
            full = os.path.join(root, name)
            if name.startswith(".tmpserver-upload-") or os.path.islink(full):
                continue
            relative = os.path.relpath(full, CLOUD_ROOT).replace(os.sep, "/")
            stat = os.stat(full)
            result.append({"path": relative, "name": name, "size": stat.st_size, "modified": int(stat.st_mtime)})
    return sorted(result, key=lambda item: item["path"].lower())


def cloud_directories():
    result = []
    for root, directories, _ in os.walk(CLOUD_ROOT, followlinks=False):
        directories[:] = [name for name in directories if name != os.path.basename(CLOUD_UPLOADS_ROOT) and not name.startswith(".tmpserver-upload-") and not os.path.islink(os.path.join(root, name))]
        for name in directories:
            relative = os.path.relpath(os.path.join(root, name), CLOUD_ROOT).replace(os.sep, "/")
            result.append(relative)
    return sorted(result, key=str.lower)


def valid_upload_id(value):
    value = str(value or "")
    return value if re.fullmatch(r"[a-f0-9]{32}", value) else None


def cleanup_stale_cloud_uploads():
    cutoff = time.time() - 24 * 60 * 60
    try:
        for entry in os.scandir(CLOUD_UPLOADS_ROOT):
            try:
                if entry.stat(follow_symlinks=False).st_mtime < cutoff:
                    shutil.rmtree(entry.path, ignore_errors=True)
            except OSError:
                continue
    except OSError:
        pass


def receive_cloud_upload_chunk(upload_id, index, total, target, stream, length):
    if not valid_upload_id(upload_id):
        raise ValueError("Invalid upload identifier.")
    if not 1 <= length <= CLOUD_UPLOAD_CHUNK_BYTES:
        raise ValueError("Each upload chunk must be between 1 byte and 64 MiB.")
    if not 1 <= total <= MAX_CLOUD_UPLOAD_CHUNKS or not 0 <= index < total:
        raise ValueError("Invalid upload chunk number or count.")
    if index < total - 1 and length != CLOUD_UPLOAD_CHUNK_BYTES:
        raise ValueError("Every non-final upload chunk must be exactly 64 MiB.")
    if not target or target == os.path.realpath(CLOUD_ROOT):
        raise ValueError("Choose a safe Cloud file path.")
    if shutil.disk_usage(CLOUD_UPLOADS_ROOT).free < length:
        raise OSError("Not enough free space on Cloud storage for the next upload chunk.")
    stage = os.path.join(CLOUD_UPLOADS_ROOT, upload_id)
    os.makedirs(stage, mode=0o700, exist_ok=True)
    relative = os.path.relpath(target, os.path.realpath(CLOUD_ROOT)).replace(os.sep, "/")
    metadata_path = os.path.join(stage, "metadata.json")
    metadata = {"path": relative, "total": total}
    if os.path.exists(metadata_path):
        with open(metadata_path, "r", encoding="utf-8") as file:
            existing = json.load(file)
        if existing != metadata:
            raise ValueError("Upload identifier was already used for a different file.")
    else:
        temp_metadata = os.path.join(stage, "metadata.tmp")
        with open(temp_metadata, "w", encoding="utf-8") as file:
            json.dump(metadata, file)
        os.replace(temp_metadata, metadata_path)
    data_path = os.path.join(stage, "payload.part")
    marker_path = os.path.join(stage, f"{index:05d}.done")
    marker_tmp = marker_path + ".tmp"
    remaining = length
    try:
        mode = "r+b" if os.path.exists(data_path) else "w+b"
        with open(data_path, mode) as output:
            output.seek(index * CLOUD_UPLOAD_CHUNK_BYTES)
            while remaining:
                block = stream.read(min(1024 * 1024, remaining))
                if not block:
                    raise OSError("The upload connection ended before the chunk was complete.")
                output.write(block)
                remaining -= len(block)
            output.flush()
            os.fsync(output.fileno())
        with open(marker_tmp, "w", encoding="ascii") as marker:
            marker.write(str(length))
        os.replace(marker_tmp, marker_path)
    except Exception:
        try:
            os.remove(marker_tmp)
        except OSError:
            pass
        raise
    os.utime(stage, None)


def finish_cloud_upload(upload_id, target, expected_size, total):
    if not valid_upload_id(upload_id):
        raise ValueError("Invalid upload identifier.")
    if type(expected_size) is not int or not 0 <= expected_size <= MAX_CLOUD_FILE_SIZE:
        raise ValueError("Cloud files may be up to 20 GB each.")
    expected_total = (expected_size + CLOUD_UPLOAD_CHUNK_BYTES - 1) // CLOUD_UPLOAD_CHUNK_BYTES
    if type(total) is not int or total != expected_total:
        raise ValueError("Upload chunk count does not match the file size.")
    if not target or target == os.path.realpath(CLOUD_ROOT):
        raise ValueError("Choose a safe Cloud file path.")
    stage = os.path.join(CLOUD_UPLOADS_ROOT, upload_id)
    os.makedirs(stage, mode=0o700, exist_ok=True)
    relative = os.path.relpath(target, os.path.realpath(CLOUD_ROOT)).replace(os.sep, "/")
    metadata_path = os.path.join(stage, "metadata.json")
    metadata = {"path": relative, "total": total}
    if total == 0 and not os.path.exists(metadata_path):
        with open(metadata_path, "w", encoding="utf-8") as file:
            json.dump(metadata, file)
    if not os.path.isfile(metadata_path):
        raise ValueError("Upload is incomplete: no chunks were received.")
    with open(metadata_path, "r", encoding="utf-8") as file:
        existing = json.load(file)
    if existing != metadata:
        raise ValueError("Upload details do not match the received chunks.")
    for index in range(total):
        marker_path = os.path.join(stage, f"{index:05d}.done")
        expected_part_size = min(CLOUD_UPLOAD_CHUNK_BYTES, expected_size - index * CLOUD_UPLOAD_CHUNK_BYTES)
        try:
            with open(marker_path, "r", encoding="ascii") as marker:
                received_part_size = int(marker.read())
        except (OSError, ValueError):
            raise ValueError(f"Upload is incomplete: chunk {index + 1} of {total} is missing.")
        if received_part_size != expected_part_size:
            raise ValueError(f"Upload chunk {index + 1} has an unexpected size.")
    data_path = os.path.join(stage, "payload.part")
    if total == 0 and not os.path.exists(data_path):
        open(data_path, "wb").close()
    if not os.path.isfile(data_path) or os.path.getsize(data_path) != expected_size:
        raise ValueError("Uploaded size does not match the selected file.")
    parent = os.path.dirname(target)
    os.makedirs(parent, exist_ok=True)
    stage_device = os.stat(stage).st_dev
    target_device = os.stat(parent).st_dev
    if stage_device == target_device:
        os.replace(data_path, target)
    else:
        if shutil.disk_usage(parent).free < expected_size:
            raise OSError("Not enough free space to place this upload on the target Cloud volume.")
        fd, temporary_path = tempfile.mkstemp(prefix=".tmpserver-upload-", dir=parent)
        try:
            with os.fdopen(fd, "wb") as output, open(data_path, "rb") as source:
                shutil.copyfileobj(source, output, length=1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary_path, target)
        except Exception:
            try:
                os.remove(temporary_path)
            except OSError:
                pass
            raise
    shutil.rmtree(stage, ignore_errors=True)
    return next((entry for entry in cloud_files() if os.path.realpath(os.path.join(CLOUD_ROOT, entry["path"])) == target), None)



def plugin_archive_valid(path):
    try:
        with zipfile.ZipFile(path) as archive:
            entries = set(archive.namelist())
        return "plugin.yml" in entries or "paper-plugin.yml" in entries
    except (OSError, zipfile.BadZipFile):
        return False


def plugin_files():
    if os.path.islink(MINECRAFT_PLUGINS_ROOT) or not os.path.isdir(MINECRAFT_PLUGINS_ROOT):
        return []
    result = []
    for entry in os.scandir(MINECRAFT_PLUGINS_ROOT):
        if entry.is_file(follow_symlinks=False) and entry.name.lower().endswith(".jar"):
            stat = entry.stat(follow_symlinks=False)
            result.append({"name": entry.name, "size": stat.st_size, "modified": int(stat.st_mtime)})
    return sorted(result, key=lambda item: item["name"].lower())


def log_timestamp_sort_key(value):
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})", value)
    if not match:
        return value
    base, fraction, zone = match.groups()
    return f"{base}.{(fraction or '').ljust(9, '0')[:9]}{zone}"


def container_logs():
    try:
        code, output, list_truncated, _ = run_bounded_stdout(["docker", "ps", "--format", "{{.Names}}"], timeout=4, max_bytes=MAX_LOG_LIST_BYTES)
    except subprocess.TimeoutExpired as error:
        raise TimeoutError("Docker did not respond while listing containers for logs.") from error
    if code != 0:
        return []
    entries = []
    output_truncated = list_truncated
    total_log_bytes = 0
    deadline = time.monotonic() + 12
    containers = sorted(set(output.splitlines()))
    if len(containers) > MAX_LOG_CONTAINERS:
        output_truncated = True
    for container in containers[:MAX_LOG_CONTAINERS]:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", container):
            continue
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            output_truncated = True
            break
        remaining_bytes = MAX_LOG_TOTAL_BYTES - total_log_bytes
        if remaining_bytes <= 0:
            output_truncated = True
            break
        byte_limit = min(MAX_LOG_CONTAINER_BYTES, remaining_bytes)
        try:
            log_code, text, truncated, bytes_read = run_bounded_stdout(["docker", "logs", "--tail", "40", "--timestamps", container], timeout=min(3, remaining), max_bytes=byte_limit)
        except subprocess.TimeoutExpired:
            continue
        if log_code not in {0, 1} and not truncated:
            continue
        total_log_bytes += bytes_read
        output_truncated = output_truncated or truncated
        for line in deque(io.StringIO(text), maxlen=40):
            line = line.rstrip("\r\n")
            if not line.strip():
                continue
            timestamp = "—"
            sortable_timestamp = ""
            message = line
            match = re.match(r"^(\S+)\s+(.*)$", line)
            if match:
                stamp, message = match.groups()
                sortable_timestamp = stamp
                timestamp = stamp.split("T")[-1].split(".")[0].rstrip("Z")
            lowered = message.lower()
            level = "ERROR" if re.search(r"\b(error|fatal|exception)\b", lowered) else "WARN" if re.search(r"\b(warn|warning)\b", lowered) else "INFO"
            entries.append({"time": timestamp, "timestamp": sortable_timestamp, "level": level, "service": container, "message": message[:1000]})
        if total_log_bytes >= MAX_LOG_TOTAL_BYTES:
            output_truncated = True
            break
    entries.sort(key=lambda entry: (log_timestamp_sort_key(entry["timestamp"]), entry["service"]))
    entries = entries[-200:]
    if output_truncated and entries:
        entries[-1]["message"] = entries[-1]["message"][:900] + " [some log output omitted at host-agent safety limit]"
    return entries


def website_slug(value):
    slug = re.sub(r"[^a-z0-9-]+", "-", str(value or "").strip().lower()).strip("-")
    return slug[:48] or None
def website_domain(value):
    domain = str(value or "").strip().lower().rstrip(".")
    if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
        return None
    return domain
def read_websites():
    try:
        with open(WEBSITES_INDEX, "r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []
def write_websites(sites):
    temp = f"{WEBSITES_INDEX}.tmp"
    with open(temp, "w", encoding="utf-8") as file:
        json.dump(sites, file, indent=2)
    os.replace(temp, WEBSITES_INDEX)
def website_state(site):
    public_root = os.path.join(WEBSITES_ROOT, site["slug"], "public")
    return {**site, "files": sum(len(names) for _, _, names in os.walk(public_root)) if os.path.isdir(public_root) else 0, "bytes": sum(os.path.getsize(os.path.join(root, name)) for root, _, names in os.walk(public_root) for name in names) if os.path.isdir(public_root) else 0}
def reload_caddy(sites):
    try:
        with open(CADDYFILE, "r", encoding="utf-8") as file:
            base = file.read().split("\n# TMP_SERVER_WEBSITES\n", 1)[0].rstrip()
        blocks = []
        for site in sites:
            if site.get("active"):
                root = os.path.join(WEBSITES_ROOT, site["slug"], "public")
                blocks.append(f"{site['domain']} {{\n    root * {root}\n    encode gzip\n    file_server\n}}")
        content = base + "\n\n# TMP_SERVER_WEBSITES\n" + ("\n\n".join(blocks) if blocks else "") + "\n"
        fd, path = tempfile.mkstemp(prefix="tmpserver-caddy-", text=True)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            file.write(content)
        code, stdout, stderr = run(["caddy", "validate", "--config", path, "--adapter", "caddyfile"], timeout=20)
        if code != 0:
            os.remove(path)
            return False, stderr[-500:] or stdout[-500:]
        shutil.copyfile(path, CADDYFILE)
        os.remove(path)
        code, stdout, stderr = run(["systemctl", "reload", "caddy"], timeout=20)
        return code == 0, stderr[-500:] or stdout[-500:]
    except (OSError, subprocess.SubprocessError) as error:
        return False, str(error)
def owner_user(user):
    return bool(user and str(user.get("email", "")).strip().lower() == OWNER_EMAIL)
def minecraft_settings():
    values = {"viewDistance": 0, "simulationDistance": 0, "maxPlayers": 0, "whitelist": False}
    try:
        with open(COMPOSE_FILE, "r", encoding="utf-8") as file:
            text = file.read()
        for key, setting in [("viewDistance", "VIEW_DISTANCE"), ("simulationDistance", "SIMULATION_DISTANCE"), ("maxPlayers", "MAX_PLAYERS")]:
            pattern = rf"(?m)^[ \t]*{re.escape(setting)}[ \t]*:[ \t]*(?P<quote>['\"]?)(\d+)(?P=quote)[ \t]*(?:#.*)?$"
            match = re.search(pattern, text)
            if match:
                values[key] = int(match.group(2))
        values["whitelist"] = bool(re.search(r"(?mi)^[ \t]*ENABLE_WHITELIST[ \t]*:[ \t]*(?P<quote>['\"]?)true(?P=quote)[ \t]*(?:#.*)?$", text))
    except (OSError, ValueError):
        pass
    return values
def update_minecraft_settings(payload):
    try:
        view_distance = int(payload.get("viewDistance"))
        simulation_distance = int(payload.get("simulationDistance"))
        max_players = int(payload.get("maxPlayers"))
    except (TypeError, ValueError):
        raise ValueError("Minecraft settings must be whole numbers.")
    if not 2 <= view_distance <= 32:
        raise ValueError("View distance must be between 2 and 32 chunks.")
    if not 2 <= simulation_distance <= 32:
        raise ValueError("Simulation distance must be between 2 and 32 chunks.")
    if not 1 <= max_players <= 1000:
        raise ValueError("Max players must be between 1 and 1000.")
    with open(COMPOSE_FILE, "r", encoding="utf-8") as file:
        text = file.read()
    replacements = [("VIEW_DISTANCE", view_distance), ("SIMULATION_DISTANCE", simulation_distance), ("MAX_PLAYERS", max_players)]
    for setting, value in replacements:
        pattern = rf"(?m)^([ \t]*{setting}[ \t]*:[ \t]*)(?P<quote>['\"]?)(\d+)(?P=quote)([ \t]*(?:#.*)?)$"
        text, count = re.subn(pattern, lambda match: f"{match.group(1)}{match.group('quote')}{value}{match.group('quote')}{match.group(4)}", text, count=1)
        if count != 1:
            raise ValueError("Minecraft compose file is missing a supported setting.")
    backup_path = f"{COMPOSE_FILE}.settings.bak"
    shutil.copy2(COMPOSE_FILE, backup_path)
    with open(COMPOSE_FILE, "w", encoding="utf-8") as file:
        file.write(text)
    return minecraft_settings()
def admin_snapshot():
    def storage_row(path, label, role, available=True):
        row = {"label": label, "role": role, "filesystem": "unknown", "mount": path, "available": bool(available), "mounted": bool(available and os.path.ismount(path)), "totalBytes": 0, "usedBytes": 0, "freeBytes": 0, "usedPercent": 0}
        if not available or not os.path.exists(path):
            row["available"] = False
            row["mounted"] = False
            return row
        try:
            usage = shutil.disk_usage(path)
            row.update({"totalBytes": usage.total, "usedBytes": usage.used, "freeBytes": usage.free, "usedPercent": round(usage.used / usage.total * 100, 1) if usage.total else 0})
            code, output, _ = run(["df", "-P", "-B1", path])
            if code == 0:
                fields = output.splitlines()[-1].split()
                if fields:
                    row["filesystem"] = fields[0]
        except OSError:
            row["available"] = False
            row["mounted"] = False
        return row

    cloud_status = cloud_storage_status()
    external_mounted = cloud_status["hddMounted"]
    root_storage = storage_row("/", "System disk", "system")
    cloud_storage = storage_row(CLOUD_ROOT, "Cloud files and Minecraft rolling backup", "cloud", cloud_status["available"])
    website_storage = storage_row(WEBSITES_ROOT, "Website deployments", "websites")
    external = storage_row(EXTERNAL_HDD_ROOT, "External HDD · Cloud and backups", "external", external_mounted)
    external.update({
        "cloudOnExternal": cloud_status["cloudOnExternal"],
        "cloudStorageAvailable": cloud_status["available"],
        "cloudStorageMessage": cloud_status["message"],
        "cloudPath": CLOUD_ROOT,
        "systemBackupPath": os.path.join(EXTERNAL_HDD_ROOT, "tmpserver-restic"),
        "systemBackupDirectoryPresent": bool(external_mounted and os.path.isdir(os.path.join(EXTERNAL_HDD_ROOT, "tmpserver-restic"))),
        "minecraftBackupPath": os.path.join(CLOUD_ROOT, "minecraft-latest.tar.gz"),
    })
    storage = [root_storage, cloud_storage, website_storage, external]
    firewall = {"active": False, "defaultIncoming": "unknown", "rules": []}
    code, output, _ = run(["ufw", "status", "verbose"])
    if code == 0:
        firewall["active"] = output.startswith("Status: active")
        match = re.search(r"Default:\s+([^,]+),", output)
        firewall["defaultIncoming"] = match.group(1).strip() if match else "unknown"
        for line in output.splitlines():
            if re.match(r"^\d", line.strip()):
                firewall["rules"].append(line.strip())
    docker_version = "unknown"
    docker_root = "unknown"
    docker_cpus = 0
    docker_memory = 0
    code, output, _ = run(["docker", "info", "--format", "{{.ServerVersion}}|{{.DockerRootDir}}|{{.NCPU}}|{{.MemTotal}}"])
    if code == 0:
        fields = output.split("|")
        if len(fields) == 4:
            docker_version, docker_root = fields[0], fields[1]
            try:
                docker_cpus, docker_memory = int(fields[2]), int(fields[3])
            except ValueError:
                pass
    failed_units = []
    code, output, _ = run(["systemctl", "--failed", "--no-legend"])
    if code == 0:
        failed_units = [line.split()[0] for line in output.splitlines() if line.split()]
    try:
        load_average = list(os.getloadavg())
    except (AttributeError, OSError):
        load_average = [0, 0, 0]
    return {"storage": storage, "externalStorage": external, "loadAverage": load_average, "cpuCount": os.cpu_count() or 0, "docker": {"version": docker_version, "root": docker_root, "cpus": docker_cpus, "memoryBytes": docker_memory}, "firewall": firewall, "capabilities": {"kvm": os.path.exists("/dev/kvm"), "lxcInstalled": shutil.which("lxc") is not None, "docker": docker_version != "unknown", "nativeVmManagement": False}, "failedUnits": failed_units}


class Handler(BaseHTTPRequestHandler):
    server_version = "TMPHostAgent/1.0"

    def log_message(self, format, *args):
        return

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self.cors_origin())
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        size = os.path.getsize(path)
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Disposition", f'attachment; filename="{os.path.basename(path)}"')
        self.send_header("Access-Control-Allow-Origin", self.cors_origin())
        self.send_header("Vary", "Origin")
        self.end_headers()
        with open(path, "rb") as file:
            shutil.copyfileobj(file, self.wfile)

    def send_cloud_preview(self, path, content_type, size):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        # Fetch clients can use the response as a Blob; direct navigation still downloads it.
        self.send_header("Content-Disposition", "attachment")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Allow-Origin", self.cors_origin())
        self.send_header("Vary", "Origin")
        self.end_headers()
        with open(path, "rb") as file:
            remaining = size
            while remaining:
                chunk = file.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def cors_origin(self):
        origin = self.headers.get("Origin", "").rstrip("/")
        return origin if origin in ALLOWED_ORIGINS else "https://tmpserver.com"

    def do_OPTIONS(self):
        if urlparse(self.path).path == "/api/gmail/oauth/exchange":
            gmail_diagnostic("exchange preflight received")
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.cors_origin())
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/gmail/status":
            user = auth_user(self)
            if not user or not owner_user(user):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            config = gmail_config()
            if not config:
                self.send_json(200, {"configured": False, "connected": False})
                return
            try:
                saved = gmail_read_token()
            except GmailStorageError:
                self.send_json(503, {"error": "Gmail connection storage is unavailable or has unsafe permissions."})
                return
            owner_email = str(user.get("email", "")).strip().casefold()
            mailbox_matches_owner = bool(saved and saved["email"].strip().casefold() == owner_email)
            result = {"configured": True, "connected": mailbox_matches_owner}
            if saved:
                result["email"] = saved["email"]
                if not mailbox_matches_owner:
                    result["error"] = "The stored Google account does not match the authenticated owner."
            self.send_json(200, result)
            return
        if parsed.path == "/api/minecraft/plugins":
            if not auth_user(self):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            self.send_json(200, {"plugins": plugin_files(), "pluginsPath": MINECRAFT_PLUGINS_ROOT})
            return
        if parsed.path == "/api/logs":
            if not auth_user(self):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            try:
                entries = container_logs()
            except TimeoutError as error:
                self.send_json(504, {"error": str(error)})
                return
            self.send_json(200, {"logs": entries, "source": "docker containers", "limit": 200})
            return
        if self.path == "/api/health":
            self.send_json(200, {"ok": True, "service": "tmpserver-host-agent"})
            return
        if self.path == "/api/cloud/files":
            if not auth_user(self):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            storage = ensure_cloud_storage()
            if not storage["available"]:
                self.send_json(503, {"error": storage["message"], "storage": storage})
                return
            try:
                files = cloud_files()
                self.send_json(200, {"files": files, "folders": cloud_directories(), "usedBytes": sum(item["size"] for item in files), "storage": storage})
            except OSError as error:
                self.send_json(503, {"error": f"Cloud storage became unavailable; no system-disk fallback was used. {error}", "storage": cloud_storage_status()})
            return
        if self.path == "/api/websites":
            if not auth_user(self):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            self.send_json(200, {"sites": [website_state(site) for site in read_websites()]})
            return
        if parsed.path == "/api/cloud/download":
            if not auth_user(self):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            storage = ensure_cloud_storage()
            if not storage["available"]:
                self.send_json(503, {"error": storage["message"], "storage": storage})
                return
            path = safe_cloud_path(parse_qs(parsed.query).get("path", [""])[0])
            if not path or not os.path.isfile(path):
                self.send_json(404, {"error": "file not found"})
                return
            self.send_file(path)
            return
        if parsed.path == "/api/cloud/preview":
            if not auth_user(self):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            storage = ensure_cloud_storage()
            if not storage["available"]:
                self.send_json(503, {"error": storage["message"], "storage": storage})
                return
            path = safe_cloud_path(parse_qs(parsed.query).get("path", [""])[0])
            if not path or not os.path.isfile(path):
                self.send_json(404, {"error": "file not found"})
                return
            preview = cloud_preview_type(path)
            if not preview:
                self.send_json(415, {"error": "Preview is available only for supported image, PDF, and text files."})
                return
            _, content_type, size_limit = preview
            try:
                size = os.path.getsize(path)
            except OSError:
                self.send_json(404, {"error": "file not found"})
                return
            if size > size_limit:
                limit_label = "1 MiB" if content_type.startswith("text/") else "10 MiB"
                self.send_json(413, {"error": f"This file is larger than the {limit_label} preview limit. Download it to view it."})
                return
            self.send_cloud_preview(path, content_type, size)
            return
        if self.path == "/api/state":
            if not auth_user(self):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            self.send_json(200, host_state())
            return
        if self.path == "/api/settings":
            user = auth_user(self)
            if not user:
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            ensure_cloud_storage()
            admin = admin_snapshot()
            backup_path = os.path.join(CLOUD_ROOT, "minecraft-latest.tar.gz")
            cloud_available = bool(admin["externalStorage"].get("cloudStorageAvailable"))
            backup_stat = os.stat(backup_path) if cloud_available and os.path.isfile(backup_path) else None
            self.send_json(200, {"host": host_state()["host"], "minecraft": minecraft_settings(), "agent": {"status": "connected", "uptimeSeconds": round(time.time() - STARTED)}, "backup": {"present": bool(backup_stat), "bytes": backup_stat.st_size if backup_stat else 0, "modified": int(backup_stat.st_mtime) if backup_stat else 0}, "permissions": {"owner": owner_user(user)}, "admin": admin})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        gmail_routes = {"/api/gmail/oauth/exchange", "/api/gmail/access-token", "/api/gmail/disconnect"}
        if parsed.path in gmail_routes:
            is_exchange = parsed.path == "/api/gmail/oauth/exchange"
            if is_exchange:
                gmail_diagnostic("exchange POST received")
            user = auth_user(self)
            if not user or not owner_user(user):
                if is_exchange:
                    gmail_diagnostic("exchange rejected: owner session")
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            origin = self.headers.get("Origin", "")
            if origin != origin.rstrip("/") or origin not in ALLOWED_ORIGINS:
                if is_exchange:
                    gmail_diagnostic("exchange rejected: origin")
                self.send_json(403, {"error": "Request origin is not allowed."})
                return
            if parsed.path == "/api/gmail/oauth/exchange":
                if self.headers.get("X-Requested-With") != "XmlHttpRequest":
                    gmail_diagnostic("exchange rejected: request header")
                    self.send_json(400, {"error": "Gmail authorization request is invalid."})
                    return
                content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                try:
                    length = int(self.headers.get("Content-Length", "-1"))
                except ValueError:
                    length = -1
                if content_type != "application/json" or not 1 <= length <= 4096:
                    gmail_diagnostic("exchange rejected: request size or content type")
                    self.send_json(400 if length <= 4096 else 413, {"error": "Gmail authorization request must be a small JSON object."})
                    return
                try:
                    raw = self.rfile.read(length)
                    payload = json.loads(raw)
                    if len(raw) != length or not isinstance(payload, dict) or set(payload) != {"code", "redirectUri"}:
                        raise ValueError
                except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
                    gmail_diagnostic("exchange rejected: request body")
                    self.send_json(400, {"error": "Gmail authorization request is invalid."})
                    return
                code = payload.get("code")
                redirect_uri = payload.get("redirectUri")
                if (not isinstance(code, str) or not code or len(code) > 3000
                        or not isinstance(redirect_uri, str) or redirect_uri != origin):
                    gmail_diagnostic("exchange rejected: request fields")
                    self.send_json(400, {"error": "Gmail authorization request is invalid."})
                    return
                config = gmail_config()
                if not config:
                    gmail_diagnostic("exchange failed: OAuth host configuration")
                    self.send_json(503, {"error": "Gmail OAuth is not configured on this host."})
                    return
                try:
                    gmail_diagnostic("exchange contacting Google")
                    refresh_token, email, scopes = gmail_exchange_code(code, redirect_uri, config)
                    if email.strip().casefold() != str(user.get("email", "")).strip().casefold():
                        gmail_diagnostic("exchange rejected: mailbox owner mismatch")
                        self.send_json(403, {"error": "The Google account must match the authenticated owner account."})
                        return
                    gmail_write_token(refresh_token, email, scopes)
                except GmailProviderError as error:
                    diagnostic = error.diagnostic
                    if not re.fullmatch(r"[A-Za-z0-9 (),:_-]{1,180}", diagnostic):
                        diagnostic = "Google authorization failed with an unclassified provider error"
                    gmail_diagnostic(f"exchange failed: {diagnostic}")
                    self.send_json(502, {"error": "Google could not verify the Gmail authorization."})
                    return
                except GmailStorageError:
                    gmail_diagnostic("exchange failed: secure token storage")
                    self.send_json(503, {"error": "Gmail connection could not be stored securely."})
                    return
                gmail_diagnostic("exchange succeeded: connection stored")
                self.send_json(200, {"connected": True, "email": email})
                return
            if parsed.path == "/api/gmail/access-token":
                config = gmail_config()
                if not config:
                    self.send_json(503, {"error": "Gmail OAuth is not configured on this host."})
                    return
                try:
                    saved = gmail_read_token()
                    if not saved:
                        self.send_json(409, {"error": "Gmail is not connected."})
                        return
                    if saved["email"].strip().casefold() != str(user.get("email", "")).strip().casefold():
                        self.send_json(403, {"error": "The stored Google account does not match the authenticated owner."})
                        return
                    access_token, expires_in = gmail_refresh_token(saved["refresh_token"], config, saved["scopes"])
                except GmailStorageError:
                    self.send_json(503, {"error": "Gmail connection storage is unavailable or has unsafe permissions."})
                    return
                except GmailProviderError:
                    self.send_json(502, {"error": "Google could not refresh Gmail access."})
                    return
                self.send_json(200, {"accessToken": access_token, "expiresIn": expires_in})
                return
            try:
                saved = gmail_read_token()
                if saved:
                    request = Request("https://oauth2.googleapis.com/revoke", data=urlencode({"token": saved["refresh_token"]}).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
                    try:
                        with urlopen(request, timeout=12) as response:
                            response.read(4096)
                    except (HTTPError, URLError, TimeoutError, OSError) as error:
                        raise GmailProviderError("Google could not revoke the Gmail connection.") from error
                gmail_remove_token()
            except GmailStorageError:
                self.send_json(503, {"error": "Gmail connection storage is unavailable or has unsafe permissions."})
                return
            except GmailProviderError:
                self.send_json(502, {"error": "Google could not revoke the Gmail connection."})
                return
            self.send_json(200, {"ok": True, "connected": False})
            return
        if parsed.path in {"/api/minecraft/plugins/upload", "/api/minecraft/plugins/delete"}:
            user = auth_user(self)
            if not user:
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            if not owner_user(user):
                self.send_json(403, {"error": "Only the configured TMP Server owner can change Minecraft plugins."})
                return
            try:
                if parsed.path.endswith("/upload"):
                    filename = parse_qs(parsed.query).get("filename", [""])[0]
                    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,190}\.jar", filename, re.IGNORECASE):
                        self.send_json(400, {"error": "Plugin filenames must be safe .jar filenames."})
                        return
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 1 <= length <= MAX_PLUGIN_UPLOAD:
                        self.send_json(413, {"error": "Minecraft plugin JARs must be between 1 byte and 50 MiB."})
                        return
                    if os.path.islink(MINECRAFT_DATA_ROOT) or os.path.islink(MINECRAFT_PLUGINS_ROOT):
                        raise ValueError("The configured Minecraft plugins path must not be a symbolic link.")
                    os.makedirs(MINECRAFT_PLUGINS_ROOT, exist_ok=True)
                    fd, temporary_path = tempfile.mkstemp(prefix=".tmpserver-plugin-", suffix=".jar", dir=MINECRAFT_PLUGINS_ROOT)
                    try:
                        remaining = length
                        with os.fdopen(fd, "wb") as output:
                            os.fchmod(output.fileno(), 0o644)
                            while remaining:
                                block = self.rfile.read(min(1024 * 1024, remaining))
                                if not block:
                                    raise OSError("The plugin upload ended before it was complete.")
                                output.write(block)
                                remaining -= len(block)
                            output.flush()
                            os.fsync(output.fileno())
                        if not plugin_archive_valid(temporary_path):
                            raise ValueError("The selected JAR is not a valid Bukkit/Paper plugin archive (plugin.yml or paper-plugin.yml is missing).")
                        os.replace(temporary_path, os.path.join(MINECRAFT_PLUGINS_ROOT, filename))
                    except Exception:
                        try:
                            os.remove(temporary_path)
                        except OSError:
                            pass
                        raise
                    self.send_json(200, {"ok": True, "plugin": next(item for item in plugin_files() if item["name"] == filename), "restartRequired": True})
                    return
                length = int(self.headers.get("Content-Length", "0"))
                if length > 4096:
                    self.send_json(413, {"error": "Invalid plugin deletion request."})
                    return
                payload = json.loads(self.rfile.read(length) or b"{}")
                filename = str(payload.get("name", ""))
                if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,190}\.jar", filename, re.IGNORECASE):
                    self.send_json(400, {"error": "Choose a safe plugin JAR filename."})
                    return
                if os.path.islink(MINECRAFT_DATA_ROOT) or os.path.islink(MINECRAFT_PLUGINS_ROOT):
                    raise ValueError("The configured Minecraft plugins path must not be a symbolic link.")
                target = os.path.join(MINECRAFT_PLUGINS_ROOT, filename)
                if not os.path.isfile(target) or os.path.islink(target):
                    self.send_json(404, {"error": "Plugin JAR not found."})
                    return
                os.remove(target)
                self.send_json(200, {"ok": True, "name": filename, "restartRequired": True, "note": "Only the JAR was removed; plugin configuration/data folders were left untouched."})
                return
            except (OSError, ValueError, json.JSONDecodeError) as error:
                self.send_json(400, {"error": f"Minecraft plugin operation failed: {error}"})
                return
        if parsed.path in {"/api/cloud/upload", "/api/cloud/upload-chunk", "/api/cloud/upload-complete", "/api/cloud/upload-cancel", "/api/cloud/delete", "/api/cloud/folder"}:
            if not auth_user(self):
                self.send_json(401, {"error": "authenticated owner session required"})
                return
            try:
                storage = ensure_cloud_storage()
                if not storage["available"]:
                    self.send_json(503, {"error": storage["message"], "storage": storage})
                    return
                length = int(self.headers.get("Content-Length", "0"))
                if parsed.path == "/api/cloud/folder":
                    if not 0 <= length <= 4096:
                        self.send_json(413, {"error": "Invalid Cloud folder request."})
                        return
                    payload = json.loads(self.rfile.read(length) or b"{}")
                    if not isinstance(payload, dict):
                        raise ValueError("Cloud folder request must be a JSON object.")
                    target = safe_cloud_path(payload.get("path"))
                    if not target:
                        raise ValueError("Choose a valid folder path inside Cloud storage.")
                    if not os.path.isdir(os.path.dirname(target)):
                        raise ValueError("The parent folder does not exist in Cloud storage.")
                    if os.path.lexists(target):
                        raise ValueError("A file or folder with that name already exists.")
                    os.mkdir(target)
                    self.send_json(200, {"ok": True, "folder": os.path.relpath(target, CLOUD_ROOT).replace(os.sep, "/")})
                    return
                if parsed.path == "/api/cloud/upload-chunk":
                    query = parse_qs(parsed.query)
                    target = safe_cloud_path(query.get("path", [""])[0])
                    try:
                        index = int(query.get("index", [""])[0])
                        total = int(query.get("total", [""])[0])
                    except ValueError:
                        raise ValueError("Invalid upload chunk number or count.")
                    if index == 0:
                        cleanup_stale_cloud_uploads()
                    receive_cloud_upload_chunk(query.get("uploadId", [""])[0], index, total, target, self.rfile, length)
                    self.send_json(200, {"ok": True, "index": index, "total": total})
                    return
                if parsed.path == "/api/cloud/upload-complete":
                    if length > 4096:
                        self.send_json(413, {"error": "Invalid Cloud upload completion request."})
                        return
                    payload = json.loads(self.rfile.read(length) or b"{}")
                    target = safe_cloud_path(payload.get("path"))
                    entry = finish_cloud_upload(str(payload.get("uploadId", "")), target, payload.get("size"), payload.get("totalChunks"))
                    if entry is None:
                        raise ValueError("Completed file could not be found in Cloud storage.")
                    self.send_json(200, {"ok": True, "file": entry})
                    return
                if parsed.path == "/api/cloud/upload-cancel":
                    if length > 4096:
                        self.send_json(413, {"error": "Invalid Cloud upload cancellation request."})
                        return
                    payload = json.loads(self.rfile.read(length) or b"{}")
                    upload_id = valid_upload_id(payload.get("uploadId"))
                    if not upload_id:
                        self.send_json(400, {"error": "Invalid upload identifier."})
                        return
                    shutil.rmtree(os.path.join(CLOUD_UPLOADS_ROOT, upload_id), ignore_errors=True)
                    self.send_json(200, {"ok": True})
                    return
                if parsed.path == "/api/cloud/upload":
                    if length > MAX_CLOUD_FILE_SIZE + 1024 * 1024:
                        self.send_json(413, {"error": "Cloud files may be up to 20 GB each."})
                        return
                    content_type = self.headers.get("Content-Type", "")
                    if "multipart/form-data" not in content_type.lower():
                        self.send_json(400, {"error": "Upload the file using multipart/form-data."})
                        return
                    form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type, "CONTENT_LENGTH": str(length)})
                    item = form["file"] if "file" in form else None
                    if isinstance(item, list):
                        self.send_json(400, {"error": "Upload one file at a time."})
                        return
                    target = safe_cloud_path(form.getfirst("path", "") if "path" in form else (item.filename if item else ""))
                    if not item or not target or not getattr(item, "file", None):
                        self.send_json(400, {"error": "Choose a file and a safe Cloud path."})
                        return
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    fd, temporary_path = tempfile.mkstemp(prefix=".tmpserver-upload-", dir=os.path.dirname(target))
                    try:
                        with os.fdopen(fd, "wb") as output:
                            shutil.copyfileobj(item.file, output, length=1024 * 1024)
                            output.flush()
                            os.fsync(output.fileno())
                        if os.path.getsize(temporary_path) > MAX_CLOUD_FILE_SIZE:
                            raise ValueError("Cloud files may be up to 20 GB each.")
                        os.replace(temporary_path, target)
                    except Exception:
                        try:
                            os.remove(temporary_path)
                        except OSError:
                            pass
                        raise
                    entry = next((entry for entry in cloud_files() if os.path.realpath(os.path.join(CLOUD_ROOT, entry["path"])) == target), None)
                    self.send_json(200, {"ok": True, "file": entry})
                    return
                if length > 4096:
                    self.send_json(413, {"error": "Invalid Cloud deletion request."})
                    return
                payload = json.loads(self.rfile.read(length) or b"{}")
                target = safe_cloud_path(payload.get("path"))
                if not target or not os.path.isfile(target) or os.path.islink(target):
                    self.send_json(404, {"error": "file not found"})
                    return
                os.remove(target)
                self.send_json(200, {"ok": True, "path": payload.get("path")})
                return
            except Exception as error:
                self.send_json(400, {"error": f"Cloud operation failed: {error}"})
                return
        website_match = re.fullmatch(r"/api/websites/([a-z0-9-]+)/(deploy|lifecycle|delete)", self.path)
        if self.path not in {"/api/minecraft/whitelist", "/api/minecraft/command", "/api/minecraft/lifecycle", "/api/minecraft/backup", "/api/minecraft/settings", "/api/websites"} and not website_match:
            self.send_json(404, {"error": "not found"})
            return
        if not auth_user(self):
            self.send_json(401, {"error": "authenticated owner session required"})
            return
        if self.path == "/api/minecraft/settings":
            user = auth_user(self)
            if not owner_user(user):
                self.send_json(403, {"error": "Only the configured TMP Server owner can change Minecraft settings."})
                return
            storage = ensure_cloud_storage()
            if not storage["available"]:
                self.send_json(503, {"error": f"Minecraft settings were not changed because a verified external-HDD backup destination is unavailable. {storage['message']}", "storage": storage})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                backup_code, backup_stdout, backup_stderr = run([BACKUP_SCRIPT], timeout=240)
                if backup_code != 0:
                    self.send_json(502, {"error": "Minecraft backup failed; settings were not applied and the server was left running.", "detail": backup_stderr[-300:] or backup_stdout[-300:]})
                    return
                stop_code, stop_stdout, stop_stderr = run(["docker", "compose", "-f", COMPOSE_FILE, "stop", "minecraft"], timeout=60)
                if stop_code != 0:
                    self.send_json(502, {"error": "Minecraft could not be stopped safely after backup; settings were not changed.", "detail": stop_stderr[-300:] or stop_stdout[-300:]})
                    return
                try:
                    settings = update_minecraft_settings(payload)
                except (OSError, ValueError) as error:
                    run(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d", "minecraft"], timeout=90)
                    raise error
                stop_code, stop_stdout2, stop_stderr2 = run(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d", "minecraft"], timeout=90)
                stop_stdout = f"{stop_stdout}\n{stop_stdout2}"; stop_stderr = f"{stop_stderr}\n{stop_stderr2}"
                if stop_code != 0:
                    self.send_json(502, {"error": "Minecraft restart failed after settings change.", "detail": stop_stderr[-300:] or stop_stdout[-300:]})
                    return
                self.send_json(200, {"ok": True, "settings": settings, "state": host_state()})
                return
            except (OSError, ValueError, json.JSONDecodeError) as error:
                self.send_json(400, {"error": str(error)})
                return
        if self.path == "/api/websites" or website_match:
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > MAX_WEBSITE_UPLOAD + 4096:
                    self.send_json(413, {"error": "website ZIP upload is larger than the 50 MB limit"})
                    return
                sites = read_websites()
                if website_match and website_match.group(2) == "deploy":
                    content_type = self.headers.get("Content-Type", "")
                    if "multipart/form-data" not in content_type:
                        self.send_json(400, {"error": "Upload a ZIP file using multipart/form-data."})
                        return
                    form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type, "CONTENT_LENGTH": str(length)})
                    item = form["file"] if "file" in form else None
                    slug = website_match.group(1)
                    site = next((entry for entry in sites if entry["slug"] == slug), None)
                    if not item or not site or not str(item.filename or "").lower().endswith(".zip"):
                        self.send_json(400, {"error": "Choose a ZIP file for an existing website."})
                        return
                    target_root = os.path.join(WEBSITES_ROOT, slug, "public")
                    with tempfile.TemporaryDirectory(prefix="tmpserver-site-") as temp_root:
                        archive_path = os.path.join(temp_root, "site.zip")
                        with open(archive_path, "wb") as archive_file:
                            shutil.copyfileobj(item.file, archive_file)
                        with zipfile.ZipFile(archive_path) as archive:
                            members = archive.infolist()
                            if len(members) > 10000 or any(member.file_size > MAX_WEBSITE_UPLOAD for member in members):
                                self.send_json(413, {"error": "ZIP contains too many or too-large files."})
                                return
                            for member in members:
                                member_path = os.path.realpath(os.path.join(temp_root, "unzipped", member.filename))
                                safe_root = os.path.realpath(os.path.join(temp_root, "unzipped"))
                                if not member_path.startswith(safe_root + os.sep):
                                    self.send_json(400, {"error": "ZIP contains an unsafe path."})
                                    return
                            archive.extractall(os.path.join(temp_root, "unzipped"))
                        extracted = os.path.join(temp_root, "unzipped")
                        candidate = os.path.join(extracted, "index.html")
                        if not os.path.isfile(candidate):
                            children = [name for name in os.listdir(extracted) if os.path.isdir(os.path.join(extracted, name))]
                            if len(children) == 1 and os.path.isfile(os.path.join(extracted, children[0], "index.html")):
                                extracted = os.path.join(extracted, children[0])
                            else:
                                self.send_json(400, {"error": "ZIP must contain index.html at its root."})
                                return
                        new_root = os.path.join(target_root, ".new")
                        shutil.rmtree(new_root, ignore_errors=True)
                        shutil.copytree(extracted, new_root)
                        old_root = os.path.join(target_root, ".old")
                        shutil.rmtree(old_root, ignore_errors=True)
                        if os.path.isdir(target_root):
                            os.rename(target_root, old_root)
                        os.rename(new_root, target_root)
                        shutil.rmtree(old_root, ignore_errors=True)
                    site["updated"] = int(time.time())
                    write_websites(sites)
                    self.send_json(200, {"ok": True, "site": website_state(site)})
                    return
                payload = json.loads(self.rfile.read(length) or b"{}")
                if self.path == "/api/websites":
                    name = str(payload.get("name", "")).strip()
                    slug = website_slug(payload.get("slug") or name)
                    domain = website_domain(payload.get("domain"))
                    if not name or not slug or not domain:
                        self.send_json(400, {"error": "Enter a site name and a valid domain."})
                        return
                    if any(site["slug"] == slug or site["domain"] == domain for site in sites):
                        self.send_json(409, {"error": "A website with that name or domain already exists."})
                        return
                    os.makedirs(os.path.join(WEBSITES_ROOT, slug, "public"), exist_ok=True)
                    site = {"name": name[:80], "slug": slug, "domain": domain, "active": False, "created": int(time.time()), "updated": int(time.time())}
                    sites.append(site)
                    write_websites(sites)
                    self.send_json(201, {"ok": True, "site": website_state(site)})
                    return
                slug, action = website_match.group(1), website_match.group(2)
                site = next((item for item in sites if item["slug"] == slug), None)
                if not site:
                    self.send_json(404, {"error": "Website not found."})
                    return
                if action == "lifecycle":
                    operation = str(payload.get("action", "")).strip().lower()
                    if operation not in {"start", "stop"}:
                        self.send_json(400, {"error": "Website action must be start or stop."})
                        return
                    site["active"] = operation == "start"
                    site["updated"] = int(time.time())
                    ok, detail = reload_caddy(sites)
                    if not ok:
                        site["active"] = not site["active"]
                        self.send_json(502, {"error": "Caddy rejected the website route.", "detail": detail})
                        return
                    write_websites(sites)
                    self.send_json(200, {"ok": True, "site": website_state(site)})
                    return
                if action == "delete":
                    ok, detail = reload_caddy([item for item in sites if item["slug"] != slug])
                    if not ok:
                        self.send_json(502, {"error": "Could not remove the website route.", "detail": detail})
                        return
                    shutil.rmtree(os.path.join(WEBSITES_ROOT, slug), ignore_errors=True)
                    write_websites([item for item in sites if item["slug"] != slug])
                    self.send_json(200, {"ok": True, "slug": slug})
                    return
                self.send_json(400, {"error": "Unsupported website operation."})
                return
            except (OSError, ValueError, json.JSONDecodeError) as error:
                self.send_json(400, {"error": f"Website operation failed: {error}"})
                return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            username = str(payload.get("username", "")).strip()
            action = str(payload.get("action", "add")).strip().lower()
            command = str(payload.get("command", "")).strip()
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "invalid JSON"})
            return
        if self.path == "/api/minecraft/backup":
            storage = ensure_cloud_storage()
            if not storage["available"]:
                self.send_json(503, {"error": storage["message"], "storage": storage})
                return
            code, stdout, stderr = run([BACKUP_SCRIPT], timeout=240)
            if code != 0:
                self.send_json(502, {"error": "Minecraft backup failed", "detail": stderr[-300:] or stdout[-300:]})
                return
            self.send_json(200, {"ok": True, "action": "backup", "output": stdout[-1000:]})
            return
        if self.path == "/api/minecraft/whitelist":
            if not USERNAME_RE.fullmatch(username):
                self.send_json(400, {"error": "Minecraft username must be 3–16 letters, numbers, underscore, or dot"})
                return
            if action not in {"add", "remove"}:
                self.send_json(400, {"error": "action must be add or remove"})
                return
            command_args = ["whitelist", action, username]
        elif self.path == "/api/minecraft/command":
            if not CONSOLE_RE.fullmatch(command) or not command:
                self.send_json(400, {"error": "Enter one Minecraft command under 240 characters"})
                return
            try:
                command_args = shlex.split(command.lstrip("/"))
            except ValueError:
                self.send_json(400, {"error": "Invalid command quoting"})
                return
            if not command_args:
                self.send_json(400, {"error": "Command cannot be empty"})
                return
        else:
            lifecycle = action
            if lifecycle not in {"start", "stop", "restart", "update"}:
                self.send_json(400, {"error": "action must be start, stop, restart, or update"})
                return
            if lifecycle in {"stop", "restart", "update"}:
                storage = ensure_cloud_storage()
                if not storage["available"]:
                    self.send_json(503, {"error": f"Minecraft {lifecycle} was not run because a verified external-HDD backup destination is unavailable. {storage['message']}", "storage": storage})
                    return
                backup_code, backup_stdout, backup_stderr = run([BACKUP_SCRIPT], timeout=240)
                if backup_code != 0:
                    self.send_json(502, {"error": "Minecraft backup failed; lifecycle action was not run", "detail": backup_stderr[-300:] or backup_stdout[-300:]})
                    return
            if lifecycle == "update":
                code, stdout, stderr = run(["docker", "compose", "-f", COMPOSE_FILE, "pull", "minecraft"], timeout=180)
                if code == 0:
                    code, stdout2, stderr2 = run(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d", "minecraft"], timeout=60)
                    stdout = f"{stdout}\n{stdout2}"; stderr = f"{stderr}\n{stderr2}"
            else:
                compose_action = "up -d" if lifecycle == "start" else lifecycle
                code, stdout, stderr = run(["docker", "compose", "-f", COMPOSE_FILE, *compose_action.split(), "minecraft"], timeout=45)
            if code != 0:
                self.send_json(502, {"error": "Minecraft lifecycle command failed", "detail": stderr[-300:]})
                return
            self.send_json(200, {"ok": True, "action": lifecycle, "state": host_state()})
            return
        code, stdout, stderr = run(["docker", "exec", "tmpserver-minecraft", "rcon-cli", *command_args])
        if code != 0:
            self.send_json(502, {"error": "Minecraft command failed", "detail": stderr[-300:]})
            return
        self.send_json(200, {"ok": True, "action": action if self.path.endswith("whitelist") else "command", "username": username if self.path.endswith("whitelist") else None, "output": stdout[-1000:]})


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
