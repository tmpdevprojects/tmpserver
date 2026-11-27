# TMP Server dashboard implementation status

Checked items describe repository code or documentation only. They do not mean the changes are installed on the Linux host, the Gmail account is connected, a scheduled snapshot has run, or a restore has been tested. The latest user-provided host output on 2026-11-25 showed the separate rolling verified-HDD backup writing successfully.

## Owner access and dashboard
- [x] Keep the Pages dashboard Supabase-authenticated and restrict browser/host-agent access to `charliehenworth92@gmail.com`; do not restore member/invite access or expose host telemetry through unauthenticated health.
- [x] Keep `tmpserver.com` as the admin panel, `api.tmpserver.com` as host-agent API, and `play.tmpserver.com` as Minecraft domain.
- [x] Keep live metrics based on authenticated host telemetry and separate browser-local manual service/site states from actual host operations.
- [x] Keep the OS label exactly `TMP x Triumphant OS v27.13.0`.

## Cloud and file handling
- [x] Support arbitrary Cloud file types up to 20 GB per file, enforced in the browser and host agent with bounded sequential 64 MiB chunks; accept multiple selected files and show per-file progress/errors.
- [x] Keep upload, completion, cancellation, listing, folder creation, download, and deletion owner-authenticated and path-safe; do not conflate Cloud files with website ZIP deployment.
- [x] Organize Cloud with nested folders, breadcrumbs, categories/type views, and sequential multi-file uploads.
- [x] Add owner-authenticated previews for raster images, sandboxed PDFs, and text/code rendered only as escaped plain text; cap image/PDF previews at 10 MiB and text at 1 MiB, send no-store responses, exclude active SVG, and keep unsupported or oversized files download-only.
- [ ] Fail closed for Cloud actions unless UUID `7A404FAD470CB2A3` is mounted at `/mnt/tmpserver-hdd` and `/opt/tmpserver/cloud` is the exact bind of `/mnt/tmpserver-hdd/tmpserver-cloud`; retry mount activation after reconnect and never use a root-disk fallback. End-to-end authenticated dashboard verification is still required.
- [x] Keep the tracked `ops/tmpserver-minecraft-backup` fail-closed on verified HDD identity and exact Cloud bind. The user installed it and supplied output showing a successful verified-HDD rolling backup; this confirms neither a daily timer nor a restore.
- [x] Preserve existing root-disk and HDD rolling backup contents with unique copies and matching SHA-256 values as shown in the user's 2026-11-25 output. Do not overwrite, merge, or migrate Cloud trees without a reviewed plan.

## Daily Minecraft snapshots and recovery
- [x] Add a separate systemd oneshot service and persistent timer for every day at 22:00 local `Europe/London`; if the drive is absent, retry for at most five minutes and fail closed unless the expected HDD UUID and exact Cloud bind are verified.
- [x] Write a unique timestamped archive on the HDD containing Minecraft `data/` and `compose.yml`, plus a SHA-256 checksum; preserve `minecraft-latest.tar.gz` and all prior snapshots, and do not prune automatically. The snapshot flushes saves, pauses world saving while archiving, and uses EXIT cleanup plus HUP/INT/TERM traps to attempt `save-on`; SIGKILL or power loss cannot run cleanup.
- [x] Provide safe restore guidance that verifies the checksum and preserves current data before replacement. State that these are Minecraft service snapshots, not a bootable Linux image or full-system backup.
- [ ] Install/enable the new systemd units on the Linux host and confirm a successful timer run; this Sandbox has not installed or run them.
- [ ] Complete and verify an actual restore before claiming Minecraft recovery from a snapshot has been proven.

## Mail and email digest
- [ ] Add `mail.tmpserver.com` as a standalone full-page TMP Mail experience, owner-only via the existing Supabase code-entry flow and exact owner-email allowlist; reuse the current Gmail client and server-side Gmail token integration; retain the existing compact client on `tmpserver.com`; require matching Google OAuth origin and host-agent CORS allowlists; do not broaden Gmail scopes or expose message content.
- [ ] Deploy the mail hostname through the Cloudflare Worker proxy to the existing `tmpserver.com` GitHub Pages build so the existing build-time Supabase and Google client settings remain shared; keep the mail hostname out of indexing; do not alter the main site DNS or Minecraft DNS.
- [x] Provide the user Linux commands to fast-forward `origin/main`, compile `host-agent.py`, restart only `tmpserver-host-agent`, and verify `/api/health`; do not execute host changes here or read the private host environment file. The instructions are saved in `ops/TMP-MAIL-DEPLOY.md` and do not touch Minecraft, the external HDD, or the private digest sender.
- [x] Add a TMP-branded Gmail-inspired Mail page for the signed-in owner using Google Identity Services popup authorization-code flow. Match the connected Google account to the dashboard owner; request only `gmail.readonly` and `gmail.send`; support Inbox, Sent, Starred, Gmail search, message reading, and plain-text compose/send.
- [x] Keep the Google client secret and refresh token in private host-side files, return short-lived access tokens only to the authenticated owner, keep them in browser memory, and never persist/log email content. Show Gmail as unconfigured until OAuth client/API setup and authorization are complete.
- [ ] Complete Google Cloud OAuth/Gmail API setup, set the public client ID in GitHub Actions, install private host environment settings, and authorize the matching Gmail account. No credentials were requested or entered here; the mailbox is not connected yet.
- [ ] Restyle the existing private hourly HTML digest for desktop/mobile scanning and add real host/Minecraft/HDD/backup detail while preserving its existing sender and cadence. Keep plain-text fallback and escape untrusted values; never read or print `/etc/tmpserver/host-agent.env` and never commit the private digest script.
- [ ] The host-side `tmpserver-hourly-digest.py` is not available in this repository. The separate responsive template at `ops/tmpserver-hourly-digest-template.html` is authorized and prepared, but is not wired to the live sender. Integrate only after receiving a sanitized script copy; preserve the existing sender, schedule, and private settings.

## DNS and remaining host work
- [x] Inspect `play.tmpserver.com` read-only: the active Cloudflare zone has a DNS-only A record to `109.156.215.120`, matching the previously reported host IP. No AAAA, CNAME, or Minecraft SRV record was found. Findings and official Cloudflare source URLs are saved in `/tmp/dns-play-tmpserver-findings-2026-11-26.md`; the host's current public IPv4 is not verified and no DNS record was changed.
- [ ] Resolve Bedrock's Terracotta initial-connection failure after checking the current host WAN IPv4 and Geyser/Floodgate/NetherNet response; earlier supplied captures show UDP reaches host port 19132, so DNS resolution alone does not establish or fix the server response.
- [ ] Verify authenticated Cloud folders/files, settings, plugins, logs, and state after the latest host-agent changes are deployed.
- [ ] Change only individual plugin JAR modes if required; never recursively change plugin/world ownership or permissions. Restart Paper only after a successful verified-HDD backup.
- [ ] Confirm the existing Cloudflare tunnel and current upload/listing/deletion behavior separately; do not infer these from the API health endpoint.
