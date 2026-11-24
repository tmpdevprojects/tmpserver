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
Display the operating-system identity exactly as `TMP x Triumphant OS v27.13.0.` in dashboard telemetry and the host snapshot. Keep website ZIP deployment capped at 50 MiB and separate from Cloud files. Cloud accepts any file type up to 20 GiB per file; upload in bounded sequential chunks so neither the browser nor host agent buffers the full file in memory. Existing delete/download paths remain authenticated and path-safe.

Report the external HDD expected at `/mnt/tmpserver-hdd` only as mounted when it is actually mounted. Show its real filesystem capacity, free space, and whether `/opt/tmpserver/cloud` is actually backed by that device. Identify `/mnt/tmpserver-hdd/tmpserver-restic` as the system-snapshot target directory and report directory presence only; do not imply snapshot history or restic repository integrity is verified. Do not format, repartition, or mutate the drive while gathering telemetry.

Manually added services/sites are browser-local registry records, persist across refreshes on the same browser, and offer explicit Running/Degraded/Stopped status choices. Their controls are clearly labeled manual-only and never execute host commands. Only host-backed services expose real operations. Add an authenticated Minecraft plugin page backed by actual JAR files in the Paper plugins folder. Add logs, diagnostics and admin surfaces based on actual host, Minecraft, network, disk, Docker, firewall and backup telemetry. Any unsupported capability is explicitly unavailable rather than simulated.

## Design
Continue the established technical dark-console design: compact telemetry cards, restrained cyan/amber accents, dense but readable monospace labels, and responsive panels. Keep manual state controls visually distinct from live service actions. Make storage mount state, backup destinations, plugin restart requirements, file size limits, log scope and unavailable infrastructure capabilities unambiguous.

## Existing behavior to preserve
Cloud files remain in `/opt/tmpserver/cloud`; Minecraft rolling backups remain `minecraft-latest.tar.gz`, created through the existing controlled backup script. The website publisher remains a separate ZIP-based static deployer with Caddy routes. Java and Bedrock endpoints, Supabase authentication, the stable API origin, and safe Minecraft lifecycle/settings operations remain unchanged.

## Host-side boundary
The Linux host must receive the updated `host-agent.py` and have `tmpserver-host-agent` restarted before the new Cloud chunk, plugin, log and expanded diagnostics routes are available. On 2026-11-24, the Pages domain and `https://api.tmpserver.com/api/health` both returned HTTP 200; that verifies basic reachability only, not owner-authenticated routes or deployment of the updated host agent. The hourly email digest script is not tracked at `ops/tmpserver-hourly-digest.py` in this repository, so this project does not claim to have changed or verified the host's digest copy.
