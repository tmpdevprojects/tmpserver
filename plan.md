# TMP Server dashboard continuation plan

## Product scope
Continue the existing React + TypeScript + Vite control panel published as a static GitHub Pages site, with Supabase OTP owner authentication and the separate Python host agent behind `api.tmpserver.com`. Preserve the established dark infrastructure-console shell and keep live host operations distinct from browser-local records. Add `mail.tmpserver.com` as a dedicated owner-only TMP Mail surface by host-based routing in the existing build and a Cloudflare Worker reverse proxy to `tmpserver.com`; retain the compact mail client on the main dashboard. Do not modify the Linux host or private host configuration from this Sandbox.

## Project structure
- `client/src/pages/Home.tsx`: dashboard shell, owner session, navigation, live API state, and existing host-backed views.
- `client/src/pages/MailPanel.tsx`: Gmail-inspired TMP mailbox UI for the authenticated owner.
- `client/src/pages/TMPMailWorkspace.tsx` and `TMPMailWorkspace.css`: full-page Gmail-style presentation, scoped styles, and local preferences used only at `mail.tmpserver.com`.
- `client/src/pages/TMPMail.tsx`: separate mail-origin owner OTP gate and full-page shell reusing the existing Gmail client.
- `ops/tmp-mail-origin-worker.js`: Cloudflare Worker proxy source for the new mail hostname.
- `ops/TMP-MAIL-DEPLOY.md`: Linux host-agent update commands and Google OAuth origin requirements.
- `client/src/lib/tmp-data.ts`: shared host telemetry and dashboard types.
- `client/src/index.css`: shared dashboard and compact-client styles; the new full-page workspace imports its own scoped stylesheet.
- `host-agent.py`: authenticated host endpoints, including secure OAuth code exchange/access-token lifecycle; never proxy or log Gmail message bodies.
- `ops/tmpserver-minecraft-backup`: existing verified-HDD rolling backup; its rolling behavior remains separate from the new timestamped snapshots.
- `ops/tmpserver-minecraft-snapshot`: fail-closed verified-HDD snapshot command, with temporary save pause/resume while archiving.
- `ops/tmpserver-minecraft-snapshot.service` and `.timer`: Linux systemd units for the daily 22:00 local-time Minecraft snapshot.
- `ops/TMP-MINECRAFT-RESTORE.md`: safe restore guidance that preserves current data before replacing it.
- `ops/TMP-GMAIL-SETUP.md`, `ops/GMAIL-OAUTH-REFERENCE.md`, and `ops/tmpserver-host-agent-gmail.conf`: public-client/host setup instructions and private systemd environment wiring; no credentials are stored in the repository.
- `.github/workflows/deploy-pages.yml`: static GitHub Pages build and deployment.

## Requested behavior and implementation boundaries
Display the OS identity exactly as `TMP x Triumphant OS v27.13.0`. Keep website ZIP deployment separate from Cloud. Cloud accepts any file type up to 20 GB per file (20,000,000,000 bytes), with bounded sequential uploads and safe path handling.

Keep output logs on a separate Logs tab. Keep Google-Drive-like Cloud folders, breadcrumbs, type filters, multiple-file selection, and current per-file limits. Keep manually added off-platform services/sites editable and removable with explicit browser-local Running/Degraded/Stopped states; do not imply these controls execute host commands.

Cloud previews use the existing authenticated, verified-HDD API path. Support common raster images, PDFs in a sandboxed frame, and text/code shown as plain text only; limit image/PDF data to 10 MiB and text to 1 MiB, set no-store and nosniff headers, and do not render active SVG or uploaded HTML.

For the external HDD, recognize only UUID `7A404FAD470CB2A3` mounted at `/mnt/tmpserver-hdd` with `/opt/tmpserver/cloud` confirmed as the exact bind of `/mnt/tmpserver-hdd/tmpserver-cloud`. Cloud operations and backup writes must fail closed when those checks do not pass, retry mount activation safely, and never create/use a root-disk Cloud fallback. Preserve both Cloud trees and existing backup files; no format, repartition, erase, or migration without a reviewed non-destructive plan.

Create a separate daily Minecraft recovery snapshot at 22:00 local time (`Europe/London`) using a persistent systemd timer. It must write a timestamped, non-overwriting archive only to the verified HDD, include Minecraft `data/` and the Compose file, retain the existing rolling `minecraft-latest.tar.gz` behavior, create a checksum, preserve all prior snapshots, and never prune automatically. If the HDD is absent at schedule time, retry mount/readiness for up to five minutes and fail closed after the timeout. Flush saves and pause world saving only while archiving, then attempt to restore saving on normal exit and handled HUP/INT/TERM signals; SIGKILL or sudden power loss cannot run cleanup. Provide restore steps that preserve current files before replacement. These archives restore Minecraft service data and Compose configuration only; they are not a bootable Linux/system image and do not contain the dashboard, tunnel setup, credentials, or the full OS.

Implement a TMP-branded Gmail-inspired mailbox for the dashboard owner using Google Identity Services' popup authorization-code flow and the Gmail API. Preserve the currently configured `gmail.readonly`, `gmail.send`, and `gmail.modify` scopes without broadening them; `gmail.modify` is already used by the existing star/unstar action. Provide Inbox, Sent, Starred, Gmail search, safe message reading, local unread emphasis, and plain-text compose/send. Opening a message only changes local emphasis; do not imply that Gmail labels changed. Keep archive/delete and server-side mark-read actions absent unless separately implemented and verified. Check that the Google mailbox matches the signed-in owner. Keep the OAuth client secret and refresh token in private host-side storage; return only short-lived access tokens over authenticated HTTPS and keep them in browser memory only. Do not persist or log message content. The mailbox authorization is separate from the private SMTP digest sender and remains visibly unconfigured until Google Cloud OAuth/API setup is completed.

Improve the existing hourly digest HTML for desktop and mobile readability and add useful host/Minecraft/HDD/backup detail while preserving its current sender, schedule, and private status. Do not read `/etc/tmpserver/host-agent.env`. The current host copy of `tmpserver-hourly-digest.py` is absent from this repository; make changes to that exact script only after receiving a sanitized copy, or prepare a separate template without claiming the live digest changed.

## Design
The dedicated mail origin uses a Gmail desktop-inspired Material workspace while retaining explicit TMP Mail identity; the compact dashboard client stays in the established dark-console style. Use a familiar app/search bar, collapsible left navigation for system and user labels, a spacious central list/reader/composer, and a right utility rail. Default to a warm, low-glare light surface with restrained TMP cyan/blue accents; provide a local dark theme and density preference. Keep account/session controls visible, separate owner access from Google OAuth status, and label external Google app shortcuts as external. Keep local preferences device-local, avoid claiming unsupported Gmail actions, and preserve sandboxed, no-referrer HTML email rendering. Interaction should be calm and direct: obvious focus, generous click targets, small motion only for drawer/rail transitions, and responsive navigation on narrow screens.

## Host-side boundary
The last user-provided host output confirmed the tracked rolling backup script wrote a verified-HDD backup at `/opt/tmpserver/cloud/minecraft-latest.tar.gz` on 2026-11-25. This does not verify the new daily timer, a complete Minecraft restore, or a full-system image. DNS inspection found `play.tmpserver.com` resolving through a DNS-only A record to the previously reported `109.156.215.120`; the current host public IPv4 still needs confirmation, and no DNS record was changed. Repository changes made in this task still require a user-controlled pull/install/restart before they become active on the Linux host. Gmail OAuth likewise needs Google Cloud setup and host-side private configuration. Never read or print `/etc/tmpserver/host-agent.env`, request credentials in chat, or commit OAuth secrets.
