#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly backup_root=/var/backups/digibusca/evolution
readonly staging_root=/var/backups/digibusca/.evolution-staging
readonly recipient_file=/etc/digibusca/hostgator/evolution-backup.age-recipient
readonly volume_name=digibusca-hostgator-evolution-instances
readonly openclaw_state_volume=digibusca-hostgator-openclaw-state
readonly openbot_whatsapp_container_name=openbot-digibot-whatsapp
readonly openbot_ops_container_name=openbot-digibot-ops
readonly retention_days=14
readonly compose_project=digibusca-hostgator
paused_containers=()

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this backup as root." >&2
  exit 1
fi

install -d -o root -g root -m 0700 "$backup_root"
install -d -o root -g root -m 0700 "$staging_root"
if ! command -v age >/dev/null 2>&1 || [ ! -s "$recipient_file" ]; then
  echo "The age utility or backup recipient key is unavailable." >&2
  exit 1
fi
exec 9>/run/lock/digibusca-evolution-backup.lock
if ! flock -n 9; then
  echo "A DigiBusca Evolution backup is already running."
  exit 0
fi

find_service_container() {
  local service="$1"
  local container compose_service swarm_service
  local -a matches=()

  while IFS= read -r container; do
    [ -n "$container" ] || continue
    compose_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$container" 2>/dev/null || true)
    swarm_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.swarm.service.name" }}' "$container" 2>/dev/null || true)
    if [ "$compose_service" = "$service" ] || \
      [ "$swarm_service" = "$service" ] || \
      [ "$swarm_service" = "${compose_project}_${service}" ]; then
      matches+=("$container")
    fi
  done < <(docker ps --quiet)

  if [ "${#matches[@]}" -ne 1 ]; then
    echo "Expected one running DigiBusca $service container; found ${#matches[@]}." >&2
    return 1
  fi
  printf '%s\n' "${matches[0]}"
}

find_optional_service_container() {
  local service="$1"
  local container compose_service swarm_service
  local -a matches=()

  while IFS= read -r container; do
    [ -n "$container" ] || continue
    compose_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$container" 2>/dev/null || true)
    swarm_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.swarm.service.name" }}' "$container" 2>/dev/null || true)
    if [ "$compose_service" = "$service" ] || \
      [ "$swarm_service" = "$service" ] || \
      [ "$swarm_service" = "${compose_project}_${service}" ]; then
      matches+=("$container")
    fi
  done < <(docker ps --quiet)

  if [ "${#matches[@]}" -gt 1 ]; then
    echo "Expected at most one running DigiBusca $service container; found ${#matches[@]}." >&2
    return 1
  fi
  if [ "${#matches[@]}" -eq 1 ]; then
    printf '%s\n' "${matches[0]}"
  fi
}

pause_for_consistent_archive() {
  local container status paused
  container="$1"
  [ -n "$container" ] || return 0
  status=$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)
  paused=$(docker inspect --format '{{.State.Paused}}' "$container" 2>/dev/null || true)
  if [ "$status" = running ] && [ "$paused" = false ]; then
    docker pause "$container" >/dev/null
    paused_containers+=("$container")
  fi
}

resume_after_archive() {
  local container
  for container in "${paused_containers[@]}"; do
    docker unpause "$container" >/dev/null 2>&1 || true
  done
}

database_container=$(find_service_container evolution-db) || exit 1
readonly database_container
evolution_api_container=$(find_optional_service_container evolution-api) || exit 1
readonly evolution_api_container
volume_mount=$(docker volume inspect --format '{{ .Mountpoint }}' "$volume_name") || exit 1
readonly volume_mount
if [ ! -d "$volume_mount" ]; then
  echo "The Evolution instances volume is unavailable." >&2
  exit 1
fi

find_openbot_data_mount() {
  local container_name="$1"
  local expected_mount="$2"
  local mount
  local -a containers=()
  mapfile -t containers < <(docker ps --all --filter "name=^/${container_name}$" --format '{{.ID}}')
  if [ "${#containers[@]}" -eq 0 ]; then
    return 0
  fi
  if [ "${#containers[@]}" -ne 1 ]; then
    echo "Expected at most one OpenBot container named $container_name; found ${#containers[@]}." >&2
    return 1
  fi
  mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "${containers[0]}")
  if [ "$mount" != "$expected_mount" ] || [ ! -d "$mount" ]; then
    echo "The expected OpenBot data volume is unavailable: $container_name" >&2
    return 1
  fi
  printf '%s\n' "$mount"
}

openbot_whatsapp_mount=$(find_openbot_data_mount "$openbot_whatsapp_container_name" /srv/openbot/digibot-whatsapp/data) || exit 1
readonly openbot_whatsapp_mount
openbot_ops_mount=$(find_openbot_data_mount "$openbot_ops_container_name" /srv/openbot/digibot-ops/data) || exit 1
readonly openbot_ops_mount
openclaw_container=$(find_optional_service_container openclaw-gateway) || exit 1
readonly openclaw_container
if docker volume inspect "$openclaw_state_volume" >/dev/null 2>&1; then
  if [ -z "$openclaw_container" ]; then
    echo "The OpenClaw state volume exists, but its Gateway is not running; refusing to skip its backup." >&2
    exit 1
  fi
elif [ -n "$openclaw_container" ]; then
  echo "The OpenClaw Gateway is running without its required persistent state volume." >&2
  exit 1
fi

config_paths=(
  etc/digibusca/hostgator
  opt/digibusca/ops/hostgator
)
if [ -d /opt/openbot-docker/instances ]; then
  config_paths+=(opt/openbot-docker/instances)
fi
readonly config_paths
for path in "${config_paths[@]}"; do
  if [ ! -e "/$path" ]; then
    echo "Required DigiBusca recovery configuration is unavailable: /$path" >&2
    exit 1
  fi
done

timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
temporary_dir=$(mktemp -d "$staging_root/${timestamp}.XXXXXX")
trap 'resume_after_archive; rm -rf -- "$temporary_dir"' EXIT

# Freeze the services that can mutate files while the encrypted archive reads
# their volumes. They resume automatically, including when a later backup step fails.
pause_for_consistent_archive "$evolution_api_container"
pause_for_consistent_archive "$openbot_whatsapp_container_name"
pause_for_consistent_archive "$openbot_ops_container_name"

openbot_container_names=()
if [ -n "$openbot_ops_mount" ]; then
  openbot_container_names+=("$openbot_ops_container_name")
fi
if [ -n "$openbot_whatsapp_mount" ]; then
  openbot_container_names+=("$openbot_whatsapp_container_name")
fi
openbot_container_list=none
if [ "${#openbot_container_names[@]}" -gt 0 ]; then
  openbot_container_list=$(IFS=,; printf '%s' "${openbot_container_names[*]}")
fi

docker exec "$database_container" sh -ec \
  'PGPASSWORD="${POSTGRES_PASSWORD:?}" pg_dump --no-password --format=custom --username="${POSTGRES_USER:?}" --dbname="${POSTGRES_DB:?}"' \
  | age -R "$recipient_file" -o "$temporary_dir/evolution-postgres.dump.age" -
if [ ! -s "$temporary_dir/evolution-postgres.dump.age" ]; then
  echo "The encrypted Evolution database dump is empty." >&2
  exit 1
fi
if [ "$(head -n 1 "$temporary_dir/evolution-postgres.dump.age")" != 'age-encryption.org/v1' ]; then
  echo "The encrypted Evolution database dump failed its format check." >&2
  exit 1
fi

tar --numeric-owner --xattrs --acls -czf - -C "$volume_mount" . \
  | age -R "$recipient_file" -o "$temporary_dir/evolution-instances.tar.gz.age" -
if [ ! -s "$temporary_dir/evolution-instances.tar.gz.age" ] || \
  [ "$(head -n 1 "$temporary_dir/evolution-instances.tar.gz.age")" != 'age-encryption.org/v1' ]; then
  echo "The encrypted Evolution instances archive failed its format check." >&2
  exit 1
fi

if [ -n "$openclaw_container" ]; then
  readonly openclaw_archive_path="/tmp/digibusca-openclaw-${timestamp}.tar.gz"
  docker exec "$openclaw_container" openclaw backup create --output "$openclaw_archive_path" --verify
  if ! docker cp "$openclaw_container:$openclaw_archive_path" "$temporary_dir/openclaw-state.tar.gz"; then
    docker exec "$openclaw_container" rm -f "$openclaw_archive_path" || true
    exit 1
  fi
  docker exec "$openclaw_container" rm -f "$openclaw_archive_path" || true
  age -R "$recipient_file" -o "$temporary_dir/openclaw-state.tar.gz.age" "$temporary_dir/openclaw-state.tar.gz"
  rm -f -- "$temporary_dir/openclaw-state.tar.gz"
  if [ ! -s "$temporary_dir/openclaw-state.tar.gz.age" ] || \
    [ "$(head -n 1 "$temporary_dir/openclaw-state.tar.gz.age")" != 'age-encryption.org/v1' ]; then
    echo "The encrypted OpenClaw state archive failed its format check." >&2
    exit 1
  fi
fi

recovery_archive_args=(--numeric-owner --xattrs --acls -czf -)
if [ -n "$openbot_ops_mount" ]; then
  recovery_archive_args+=(-C "$openbot_ops_mount" --transform='s,^,openbot-ops-data/,' .)
fi
if [ -n "$openbot_whatsapp_mount" ]; then
  recovery_archive_args+=(-C "$openbot_whatsapp_mount" --transform='s,^,openbot-whatsapp-data/,' .)
fi
recovery_archive_args+=(-C / --transform='s,^,host-recovery/,' "${config_paths[@]}")
tar "${recovery_archive_args[@]}" \
  | age -R "$recipient_file" -o "$temporary_dir/openbot-and-service-config.tar.gz.age" -
if [ ! -s "$temporary_dir/openbot-and-service-config.tar.gz.age" ] || \
  [ "$(head -n 1 "$temporary_dir/openbot-and-service-config.tar.gz.age")" != 'age-encryption.org/v1' ]; then
  echo "The encrypted OpenBot and service configuration archive failed its format check." >&2
  exit 1
fi

cat > "$temporary_dir/manifest.txt" <<EOF
created_at_utc=$timestamp
database_container=$database_container
instances_volume=$volume_name
openbot_containers=$openbot_container_list
openbot_ops_data_mount=${openbot_ops_mount:-not_running}
openbot_whatsapp_data_mount=${openbot_whatsapp_mount:-not_running}
openclaw_container=${openclaw_container:-not_running}
openclaw_state_volume=$openclaw_state_volume
recovery_config=backend,evolution,cloudflare_tunnel,dokploy_mcp,openbot_if_present,openclaw_if_present,ops
EOF
(
  cd "$temporary_dir"
  checksum_files=(evolution-postgres.dump.age evolution-instances.tar.gz.age openbot-and-service-config.tar.gz.age)
  if [ -f openclaw-state.tar.gz.age ]; then
    checksum_files+=(openclaw-state.tar.gz.age)
  fi
  sha256sum "${checksum_files[@]}" > SHA256SUMS
)

readonly completed_dir="$backup_root/$timestamp"
chmod 0700 "$temporary_dir"
mv -- "$temporary_dir" "$completed_dir"
resume_after_archive
paused_containers=()
trap - EXIT

find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$retention_days" \
  -exec rm -rf -- {} +

echo "DigiBusca WhatsApp and agent backup completed: $completed_dir"
