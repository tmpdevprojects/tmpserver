# TMP Server dashboard implementation status

Checked items below describe code present in this repository; they do not mean every authenticated host route has been tested. On 2026-11-24, the user fast-forwarded the host to `46b284d`, restarted `tmpserver-host-agent`, and confirmed local `/api/health` returns HTTP 200. Authenticated Cloud folder operations and other host routes remain to be tested.

## Owner access and public dashboard
- [x] Keep the Pages dashboard Supabase-authenticated and limit browser and host-agent access to `charliehenworth92@gmail.com`; do not restore member/invite access or expose host telemetry through the unauthenticated health endpoint.
- [x] Keep `tmpserver.com` as the admin panel domain, use `api.tmpserver.com` as the host-agent API origin, and retain `play.tmpserver.com` for the Minecraft connection.
- [x] Keep the dashboard free of fabricated live metrics, uptime, logs, activity, alerts, and service states; display live host data only from the authenticated agent.

## Minecraft, websites, and manual registry
- [ ] Keep Minecraft lifecycle, settings, console, whitelist and backup operations connected to allowlisted host-agent actions; confirm backups before controlled stop/restart/update/settings changes. Settings must read and update quoted as well as bare numeric YAML values in the existing Compose file without replacing unrelated configuration.
- [x] Keep static website deployment separate from Cloud: websites use ZIP archives only, with the existing 50 MiB limit and static `index.html` requirement; Node/PHP runtimes are not presented as available.
- [x] Persist manually added service/site entries in browser-local storage, merge them with live host polling, and offer manual Running/Degraded/Stopped statuses only for entries not linked to host-managed services. Make off-platform website entries findable and editable/removable directly from the Websites page; migrate valid older browser-local records so missing legacy flags do not hide their controls. Label these as browser-local display states that do not execute host commands.
- [x] Keep lifecycle actions read-only for Docker containers without configured operations; only expose real Minecraft and managed-website operations.

## OS identity and external storage
- [x] Display the OS identity exactly as `TMP x Triumphant OS v27.13.0` in host telemetry, diagnostics and settings/reporting.
- [x] Detect `/mnt/tmpserver-hdd` as mounted only when it is truly mounted; report capacity, used/free space, whether `/opt/tmpserver/cloud` is backed by that external drive, and the `/mnt/tmpserver-hdd/tmpserver-restic` target-directory path/presence without claiming backup history or repository integrity.
- [x] Do not erase, partition, format or migrate the 1 TB external HDD.

## Cloud file management
- [x] Support arbitrary Cloud file types up to 20 GiB per file through bounded sequential 64 MiB chunks; do not hold a 20 GiB request body or a second full-sized staging copy in memory. Let the user select multiple files in one picker action and upload them sequentially, with per-file progress, size checks, duplicate-destination protection, and a summary of successes/failures.
- [x] Keep Cloud upload, completion, cancellation, listing, download and deletion owner-authenticated and path-safe, including traversal and symlink rejection; Cloud deletion is distinct from website ZIP deployment.
- [x] Show upload progress and actionable size/network/storage errors. Use browser streaming download where available and explain the large-file browser compatibility limit otherwise.

## Plugins, logs, diagnostics and administration
- [x] Add an authenticated Minecraft plugin page backed by actual Paper plugin JARs; validate JAR archive descriptors, limit uploads, restrict changes to the configured owner, create uploaded JARs readable by Paper's UID 1000, delete only the JAR (not plugin data folders), and state that a Minecraft restart is needed.
- [x] Add logs, alerts, diagnostics, admin and settings views based on host/Minecraft/network/disk/external-drive/Docker/firewall/systemd/backup telemetry. Clearly mark native VM/Proxmox management unavailable unless supported by the host.
- [x] Bound Docker log retrieval, tolerate per-container timeouts, and globally order the returned log snapshot using the original container timestamps. State that Docker logs are not systemd journal, Caddy access logs or persistent history.
- [x] Audit visible controls and copy so unsupported operations are read-only/unavailable rather than portrayed as working.

## Cloud organization, logs, mail, and Bedrock connectivity
- [x] Put output logs in a separate tab so they are no longer duplicated on Overview, and retain the dedicated filtered Logs view. Docker logs poll only while the Logs page is selected.
- [x] Make Cloud look better and have separate tabs/folders for different items like Google does; preserve arbitrary file types, nested paths, 20 GiB per-file uploads, and safe authenticated file operations. Added authenticated folder listing/creation, breadcrumbs, local categories, current-folder uploads, responsive layout, and sequential multi-file selection. The updated host agent is deployed; authenticated folder behavior still needs an in-dashboard test.
- [ ] Configure in a Gmail-like mail client using the same info for the email pulse currently. Keep credentials server-side; implement inbox/read/search/send only if the existing provider configuration supports those operations, and do not represent SMTP-only sending as an inbox.
- [ ] Restore Bedrock access for the reported Terracotta initial-connection error. Verify Geyser/Floodgate, supported NetherNet transport, TCP signaling and UDP gameplay port exposure; make no world-data or HDD changes.

## Remaining activation and host-side work
- [ ] Cloudflare/API reachability is confirmed by the user's successful authenticated Cloud upload (2026-11-24); verify that the tunnel stays connected and separately test Cloud listing/deletion, plugin, settings, logs and state routes.
- [ ] The user fast-forwarded to `46b284d`, passed the host-agent syntax check and restarted `tmpserver-host-agent`; systemd is `active` and localhost health returns HTTP 200. Verify authenticated `/api/settings`, `/api/cloud/*`, `/api/minecraft/plugins`, `/api/logs`, and `/api/state` routes.
- [ ] Deploy the plugin-upload permission fix, then change only the existing `ArmorHUD.jar` from `root:root 0600` to a Paper-readable mode such as `0644`; do not recursively change plugin or world-data permissions. Restart Paper only after a successful backup and verify Geyser/Floodgate load.
- [ ] Verify or install the host-side shutdown/unplug backup trigger; no shutdown hook is present in this repository, and the dashboard does not claim that such a hook is active.
- [ ] Locate the Linux host's hourly digest script or add it to the repository before changing or claiming its OS label. `ops/tmpserver-hourly-digest.py` is absent from the repository; its host-side copy was not inspected or modified in this work.
