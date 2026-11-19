#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly backup_root=/var/backups/digibusca/evolution
readonly staging_root=/var/backups/digibusca/.evolution-staging
readonly recipient_file=/etc/digibusca/hostgator/evolution-backup.age-recipient
readonly volume_name=digibusca-hostgator-evolution-instances
readonly openbot_whatsapp_container_name=openbot-digibot-whatsapp
readonly openbot_ops_container_name=openbot-digibot-ops
readonly retention_days=14
readonly compose_project=digibusca-hostgator

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

database_container=$(find_service_container evolution-db) || exit 1
readonly database_container
volume_mount=$(docker volume inspect --format '{{ .Mountpoint }}' "$volume_name") || exit 1
readonly volume_mount
if [ ! -d "$volume_mount" ]; then
  echo "The Evolution instances volume is unavailable." >&2
  exit 1
fi

find_openbot_data_mount() {
  local container_name="$1"
  local expected_mount="$2"
  local container mount
  container=$(docker ps --filter "name=^/${container_name}$" --format '{{.ID}}')
  if [ -z "$container" ]; then
    echo "Required OpenBot container is not running: $container_name" >&2
    return 1
  fi
  mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$container")
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

readonly config_paths=(
  etc/digibusca/hostgator
  opt/digibusca/ops/hostgator
  opt/openbot-docker/instances
)
for path in "${config_paths[@]}"; do
  if [ ! -e "/$path" ]; then
    echo "Required DigiBusca recovery configuration is unavailable: /$path" >&2
    exit 1
  fi
done

timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
temporary_dir=$(mktemp -d "$staging_root/${timestamp}.XXXXXX")
trap 'rm -rf -- "$temporary_dir"' EXIT

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

tar --numeric-owner --xattrs --acls -czf - \
  -C "$openbot_ops_mount" --transform='s,^,openbot-ops-data/,' . \
  -C "$openbot_whatsapp_mount" --transform='s,^,openbot-whatsapp-data/,' . \
  -C / --transform='s,^,host-recovery/,' "${config_paths[@]}" \
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
openbot_containers=$openbot_ops_container_name,$openbot_whatsapp_container_name
openbot_ops_data_mount=$openbot_ops_mount
openbot_whatsapp_data_mount=$openbot_whatsapp_mount
recovery_config=backend,evolution,cloudflare_tunnel,dokploy_mcp,openbot,ops
EOF
(
  cd "$temporary_dir"
  sha256sum evolution-postgres.dump.age evolution-instances.tar.gz.age openbot-and-service-config.tar.gz.age > SHA256SUMS
)

readonly completed_dir="$backup_root/$timestamp"
chmod 0700 "$temporary_dir"
mv -- "$temporary_dir" "$completed_dir"
trap - EXIT

find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$retention_days" \
  -exec rm -rf -- {} +

echo "DigiBusca Evolution backup completed: $completed_dir"
