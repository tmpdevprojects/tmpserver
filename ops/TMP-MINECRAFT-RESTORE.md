# TMP Server Minecraft snapshot and restore guide

Each snapshot contains the Minecraft `data/` directory and `/opt/tmpserver/minecraft/compose.yml`. It can restore the Minecraft service on a working Linux installation with Docker Compose. It is **not** a bootable system image and does not include the operating system, TMP Server dashboard, Cloudflare tunnel configuration, credentials, email configuration, or unrelated Cloud files.

The snapshot command writes only under `/opt/tmpserver/cloud/minecraft-snapshots`, and only after confirming HDD UUID `7A404FAD470CB2A3` at `/mnt/tmpserver-hdd` plus the exact bind from `/mnt/tmpserver-hdd/tmpserver-cloud` to `/opt/tmpserver/cloud`. It does not format, repartition, erase, migrate, overwrite earlier snapshots, or prune the HDD. It leaves the existing rolling `minecraft-latest.tar.gz` backup alone.

## Install the snapshot command and timer

After the repository changes have been pulled onto the Linux host, run:

```bash
cd /opt/tmpserver/app || exit 1
sudo install -m 0750 ops/tmpserver-minecraft-snapshot /usr/local/bin/tmpserver-minecraft-snapshot
sudo install -m 0644 ops/tmpserver-minecraft-snapshot.service /etc/systemd/system/tmpserver-minecraft-snapshot.service
sudo install -m 0644 ops/tmpserver-minecraft-snapshot.timer /etc/systemd/system/tmpserver-minecraft-snapshot.timer
sudo systemd-analyze verify /etc/systemd/system/tmpserver-minecraft-snapshot.service /etc/systemd/system/tmpserver-minecraft-snapshot.timer
sudo systemctl daemon-reload
sudo systemctl enable --now tmpserver-minecraft-snapshot.timer
sudo systemctl list-timers tmpserver-minecraft-snapshot.timer --no-pager
```

The timer is scheduled daily at 22:00 in `Europe/London`, with `Persistent=true`. At its scheduled run, the service retries HDD activation and exact-mount verification for up to five minutes. If the expected HDD or Cloud bind is not ready, it fails closed without writing a fallback to the root disk. The script handles HUP, INT, and TERM by running cleanup and attempting to re-enable world saving; no handler can run after SIGKILL or sudden power loss. Installation/enabling alone does not prove a successful snapshot; check the service journal after its first scheduled run.

Snapshots are timestamped as `minecraft-YYYYMMDDTHHMMSS+ZZZZ.tar.gz` in `/opt/tmpserver/cloud/minecraft-snapshots/`, with an adjacent `.sha256` checksum. Existing names are never replaced, and snapshots are never automatically removed.

## Restore a Minecraft snapshot

Only follow these steps on the original TMP Linux host or a compatible Linux host where the HDD is mounted and verified. Substitute the exact archive path you intend to restore, then verify its adjacent checksum. The checksum command changes to the archive directory, so it works regardless of your current shell directory:

```bash
set -Eeuo pipefail
SNAPSHOT='/opt/tmpserver/cloud/minecraft-snapshots/REPLACE_WITH_EXACT_ARCHIVE.tar.gz'
SNAPSHOT_DIR="$(dirname "$SNAPSHOT")"
SNAPSHOT_NAME="$(basename "$SNAPSHOT")"
sudo test -f "$SNAPSHOT" || { echo 'Snapshot not found'; exit 1; }
sudo sh -c 'cd "$1" && sha256sum -c "$2.sha256"' sh "$SNAPSHOT_DIR" "$SNAPSHOT_NAME"
```

Before stopping Paper, create a fresh timestamped snapshot. It must report `Verified-HDD Minecraft snapshot written` and print the archive and checksum paths. If it fails or reports that the verified HDD is unavailable, stop here. This creates a unique recovery point and does not overwrite the rolling backup. Then preserve current files before changing anything:

Keep the same terminal session for the code blocks below so `SNAPSHOT`, `STAMP`, and other variables remain set.

```bash
sudo /usr/local/bin/tmpserver-minecraft-snapshot || exit 1
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PRESERVE="/opt/tmpserver/cloud/minecraft-restore-preserved-$STAMP"
sudo test ! -e "$PRESERVE" || { echo 'Preservation destination already exists; stop'; exit 1; }
sudo mkdir -m 0700 -- "$PRESERVE" || exit 1
sudo docker compose -f /opt/tmpserver/minecraft/compose.yml stop minecraft || exit 1
sudo cp -a /opt/tmpserver/minecraft/data "$PRESERVE/" || exit 1
sudo cp -a /opt/tmpserver/minecraft/compose.yml "$PRESERVE/" || exit 1
sudo test -d "$PRESERVE/data" && sudo test -f "$PRESERVE/compose.yml" || { echo 'Preserved copies are incomplete; leave Paper stopped and do not continue'; exit 1; }
sudo diff -qr --no-dereference /opt/tmpserver/minecraft/data "$PRESERVE/data" >/dev/null || { echo 'Preserved Minecraft data differs from the stopped source; leave Paper stopped'; exit 1; }
sudo cmp -s /opt/tmpserver/minecraft/compose.yml "$PRESERVE/compose.yml" || { echo 'Preserved Compose file differs from the source; leave Paper stopped'; exit 1; }
sudo sync
```

Extract into a new staging directory and validate the restored Compose file before replacing the current one. This extracts as root while restoring the ownership and modes recorded inside the trusted snapshot; it is not a recursive `chown`/`chmod` workaround. If restoring onto a different Linux machine, check that its container UID/GID expectations match before starting the service.

```bash
STAGE="/opt/tmpserver/minecraft/.restore-stage-$STAMP"
OLD="/opt/tmpserver/minecraft/data.before-restore-$STAMP"
sudo test ! -e "$STAGE" && sudo test ! -e "$OLD" || { echo 'A restore destination already exists; stop'; exit 1; }
sudo mkdir -m 0700 -- "$STAGE"
sudo tar -xzf "$SNAPSHOT" -C "$STAGE" --same-owner
sudo test -d "$STAGE/data" && sudo test -f "$STAGE/compose.yml" || { echo 'Snapshot contents are incomplete; nothing was swapped'; exit 1; }
sudo docker compose -f "$STAGE/compose.yml" config
sudo mv -Tn -- /opt/tmpserver/minecraft/data "$OLD"
sudo test ! -e /opt/tmpserver/minecraft/data && sudo test -d "$OLD" || { echo 'Current data was not moved to its unique preservation path'; exit 1; }
sudo mv -Tn -- "$STAGE/data" /opt/tmpserver/minecraft/data
sudo test ! -e "$STAGE/data" && sudo test -d /opt/tmpserver/minecraft/data || { echo 'Restored data was not moved into place; leave Paper stopped'; exit 1; }
COMPOSE_CANDIDATE="$(sudo mktemp /opt/tmpserver/minecraft/.compose-restore-candidate-$STAMP.XXXXXX)"
sudo cp --preserve=mode -- "$STAGE/compose.yml" "$COMPOSE_CANDIDATE"
sudo cmp -s "$STAGE/compose.yml" "$COMPOSE_CANDIDATE" || { echo 'Compose candidate does not match the snapshot'; exit 1; }
sudo docker compose -f "$COMPOSE_CANDIDATE" config
sudo mv -T -- "$COMPOSE_CANDIDATE" /opt/tmpserver/minecraft/compose.yml
sudo cmp -s "$STAGE/compose.yml" /opt/tmpserver/minecraft/compose.yml || { echo 'Restored Compose file does not match the snapshot; leave Paper stopped'; exit 1; }
sudo docker compose -f /opt/tmpserver/minecraft/compose.yml config
```

Review the Compose validation output before starting Paper. Then:

```bash
sudo docker compose -f /opt/tmpserver/minecraft/compose.yml up -d minecraft
sudo docker compose -f /opt/tmpserver/minecraft/compose.yml ps
sudo docker logs --tail 100 tmpserver-minecraft
```

Keep the `/opt/tmpserver/cloud/minecraft-restore-preserved-*` directory and `/opt/tmpserver/minecraft/data.before-restore-*` directory until the restored world and server have been checked. If restoration fails, leave Paper stopped and use the preserved copy to plan a deliberate rollback. Do not delete snapshots or backups, and do not use recursive ownership or permission changes as a shortcut.
