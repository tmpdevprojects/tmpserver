# TMP Mail subdomain deployment

`mail.tmpserver.com` is served through a Cloudflare Worker proxy to the existing `https://tmpserver.com` GitHub Pages site. The same GitHub Actions build and browser-safe Supabase configuration are reused; the React app selects its dedicated mailbox view only when the hostname is exactly `mail.tmpserver.com`. The main dashboard and its compact Mail tab remain on `tmpserver.com`.

The Worker source is `ops/tmp-mail-origin-worker.js`. Its Cloudflare route is scoped to `mail.tmpserver.com/*`, and its upstream is only `https://tmpserver.com`. It does not connect to or read server-side secrets. Cloudflare DNS must have a proxied CNAME `mail` → `tmpserver.com` for the Worker route.

## Linux host agent update

After the repository deployment is available, run these commands on the Linux server. They update only the checked-out repository and restart the host agent so its CORS allowlist accepts the new mail origin. They do not touch Minecraft, Cloud storage, HDD contents, or the private digest sender.

```bash
cd /opt/tmpserver/app || exit 1
git fetch origin
git pull --ff-only origin main
python3 - <<'PY'
from pathlib import Path
compile(Path("host-agent.py").read_text(), "host-agent.py", "exec")
print("host-agent.py syntax OK")
PY
sudo systemctl restart tmpserver-host-agent
sleep 2
sudo systemctl is-active tmpserver-host-agent
curl -fsS --max-time 3 http://127.0.0.1:8787/api/health
```

Do not open or print `/etc/tmpserver/host-agent.env`. No hourly digest script is included or changed here.

## Google OAuth origin

The Google OAuth web client must list `https://mail.tmpserver.com` under **Authorized JavaScript origins**. Keep the existing Google client ID, redirect flow, owner-email match, and Gmail scopes unchanged. The host-agent update above adds the corresponding CORS and OAuth-exchange origin. Until both changes are active, owner sign-in can work but connecting or refreshing Gmail may be rejected by the host or Google.

The Supabase sign-in uses inline email-code entry (`signInWithOtp` followed by `verifyOtp`) and does not redirect through an email link. The mail origin has its own browser session storage and the same exact owner-email check. This deployment therefore does not change the Supabase project-wide Site URL or replace any existing redirect allowlist entries.

## Pulse email

`ops/tmpserver-hourly-digest-template.html` remains a standalone readable HTML template. The live private sender is intentionally not bundled or modified; integration requires the sender source file `ops/tmpserver-hourly-digest.py` only. Do not upload environment files, credentials, or `/etc/tmpserver/host-agent.env`.
