# TMP Server dashboard continuation plan

## Product scope
Continue the existing React + TypeScript + Vite control panel published as a static GitHub Pages site, with Supabase OTP authentication and the user's authenticated Python host agent behind `api.tmpserver.com`. Keep the live Minecraft service and website deployer distinct from browser-only manual registry entries. Preserve the existing high-contrast dark infrastructure-console visual language.

## Project structure
- `client/src/pages/Home.tsx`: authenticated dashboard pages, real API interactions, manual local service entries, Cloud, plugins, logs, alerts, diagnostics, settings and admin surfaces.
- `client/src/lib/tmp-data.ts`: shared live telemetry and UI contract types.
- `client/src/index.css`: shared responsive dashboard presentation.
- `host-agent.py`: owner-authenticated host telemetry and allowlisted file, plugin, website, Minecraft, backup, log and lifecycle APIs.
- `.github/workflows/deploy-pages.yml`: build and publish the static dashboard using the stable API hostname.

## Requested behavior and implementation boundaries
Display the operating-system identity exactly as `TMP x Triumphant OS v27.13.0` in dashboard telemetry and the host snapshot. Keep website ZIP deployment capped at 50 MiB and separate from Cloud files. Cloud accepts any file type up to 20 GiB per file; upload in bounded sequential chunks so neither the browser nor host agent buffers the full file in memory. Existing delete/download paths remain authenticated and path-safe.

Give Docker output logs their own Logs page instead of duplicating the log stream on Overview. Improve Cloud into a Google Drive-inspired file browser with real nested folders, breadcrumbs, file-type tabs/categories and a clear create-folder/upload flow, while retaining arbitrary file types and the existing 20 GiB per-file limit. Category filters must be views of the same Cloud files, not imply separate storage or integrations.

Diagnose and restore Bedrock connectivity for the reported Terracotta initial-connection error without touching Minecraft world data or the external HDD. Confirm the installed Geyser/Floodgate versions, NetherNet transport/configuration and host/container port exposure; current Geyser guidance for Bedrock 26.60 requires NetherNet support and TCP signaling as well as UDP gameplay. Change only the confirmed missing configuration and verify from a Bedrock client.

Add a Gmail-like mail-client surface only when the existing hourly email-pulse configuration supports the required mailbox actions. Keep all account credentials server-side and owner-authenticated. SMTP sending configuration alone cannot provide received mail, folders or search; do not claim a connected inbox until an incoming-mail API/IMAP/OAuth capability is confirmed and tested. Do not request or expose secrets in chat or frontend code.

Report the external HDD expected at `/mnt/tmpserver-hdd` only as mounted when the actual block-device UUID matches `7A404FAD470CB2A3`. Show its real filesystem capacity, free space, and whether `/opt/tmpserver/cloud` is the exact bind mount of `/mnt/tmpserver-hdd/tmpserver-cloud`. Cloud listing, upload, folder creation, download, deletion, Minecraft backups, and backup-dependent Minecraft restart/update/settings operations must fail closed unless that identity and bind mount are verified; retry systemd mount activation after reconnect and never create or use a root-disk Cloud fallback. Identify `/mnt/tmpserver-hdd/tmpserver-restic` as the system-snapshot target directory and report directory presence only; do not imply snapshot history or restic repository integrity is verified. Preserve both existing Cloud trees and backups. Do not format, repartition, erase, or migrate the drive without a verified non-destructive plan.

Manually added services/sites are browser-local registry records, persist across refreshes on the same browser, and offer explicit Running/Degraded/Stopped status choices. Their controls are clearly labeled manual-only and never execute host commands. Only host-backed services expose real operations. Add an authenticated Minecraft plugin page backed by actual JAR files in the Paper plugins folder; uploaded JARs must be readable by Paper's runtime UID 1000 without recursively changing plugin-directory or world-data permissions. Add logs, diagnostics and admin surfaces based on actual host, Minecraft, network, disk, Docker, firewall and backup telemetry. Any unsupported capability is explicitly unavailable rather than simulated.

## Design
Continue the established technical dark-console design: compact telemetry cards, restrained cyan/amber accents, dense but readable monospace labels, and responsive panels. Keep manual state controls visually distinct from live service actions. Make storage mount state, backup destinations, plugin restart requirements, file size limits, log scope and unavailable infrastructure capabilities unambiguous.

## Existing behavior to preserve
Existing Cloud files remain accessed at `/opt/tmpserver/cloud` only when it is verified as the HDD bind mount; Minecraft rolling backups remain `minecraft-latest.tar.gz`, created through the tracked mount-verifying backup script. The website publisher remains a separate ZIP-based static deployer with Caddy routes. Java and Bedrock endpoints, Supabase authentication, the stable API origin, and safe Minecraft lifecycle/settings operations remain unchanged.

## Host-side boundary
The Linux host must receive the updated `host-agent.py` and `ops/tmpserver-minecraft-backup` (installed as `/usr/local/bin/tmpserver-minecraft-backup`) and have `tmpserver-host-agent` restarted before host-backed changes are available. The user updated to commit `46b284d` and confirmed local `/api/health` returns HTTP 200; later repository changes include the separate plugin permission commit `987b42f`. The current HDD bind mount is inactive and the root Cloud backup differs from the HDD backup; no cutover or data copy has been done. The hourly email digest script is not tracked at `ops/tmpserver-hourly-digest.py` in this repository, so inspect only safe, redacted configuration metadata and do not claim the host's digest or a mailbox integration is verified. The Pages domain was verified separately; that does not verify host API or email access.
