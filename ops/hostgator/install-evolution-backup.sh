#!/usr/bin/env bash
set -Eeuo pipefail

source_dir=/opt/digibusca/ops/hostgator
readonly backup_script=backup-evolution.sh
readonly volume_name=digibusca-hostgator-evolution-instances
readonly recipient_file=/etc/digibusca/hostgator/evolution-backup.age-recipient
readonly required_paths=(/etc/digibusca/hostgator /opt/digibusca/ops/hostgator /opt/openbot-docker/instances)

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root." >&2
  exit 1
fi

for file in "$backup_script" digibusca-evolution-backup.service digibusca-evolution-backup.timer; do
  if [ ! -f "$source_dir/$file" ]; then
    echo "Required backup file is missing: $source_dir/$file" >&2
    exit 1
  fi
done

docker volume inspect "$volume_name" >/dev/null
for path in "${required_paths[@]}"; do
  if [ ! -d "$path" ]; then
    echo "Required encrypted-backup recovery directory is missing: $path" >&2
    exit 1
  fi
done
if ! command -v age >/dev/null 2>&1 || [ ! -s "$recipient_file" ]; then
  echo "Install age and the public backup recipient key before enabling backups." >&2
  exit 1
fi
mapfile -t database_containers < <(docker ps --filter label=com.docker.compose.service=evolution-db --quiet)
if [ "${#database_containers[@]}" -eq 0 ]; then
  while IFS= read -r container; do
    [ -n "$container" ] || continue
    service_name=$(docker inspect --format '{{ index .Config.Labels "com.docker.swarm.service.name" }}' "$container" 2>/dev/null || true)
    if [ "$service_name" = 'digibusca-hostgator_evolution-db' ]; then
      database_containers+=("$container")
    fi
  done < <(docker ps --quiet)
fi
if [ "${#database_containers[@]}" -ne 1 ]; then
  echo "Expected one running DigiBusca Evolution database before enabling backups." >&2
  exit 1
fi
for container_name in openbot-digibot-ops openbot-digibot-whatsapp; do
  openbot_container=$(docker ps --filter "name=^/${container_name}$" --format '{{.ID}}')
  if [ -z "$openbot_container" ]; then
    echo "Required OpenBot container must be running before enabling backups: $container_name" >&2
    exit 1
  fi
  openbot_data_mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$openbot_container")
  if [ ! -d "$openbot_data_mount" ]; then
    echo "The OpenBot data volume is unavailable: $container_name" >&2
    exit 1
  fi
done

install -d -o root -g root -m 0700 /var/backups/digibusca/evolution /var/backups/digibusca/.evolution-staging
install -o root -g root -m 0700 "$source_dir/$backup_script" /usr/local/sbin/digibusca-evolution-backup.sh
install -o root -g root -m 0644 "$source_dir/digibusca-evolution-backup.service" /etc/systemd/system/
install -o root -g root -m 0644 "$source_dir/digibusca-evolution-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now digibusca-evolution-backup.timer
if ! systemctl start digibusca-evolution-backup.service; then
  systemctl --no-pager --full status digibusca-evolution-backup.service || true
  exit 1
fi
if [ "$(systemctl show --property=Result --value digibusca-evolution-backup.service)" != "success" ]; then
  systemctl --no-pager --full status digibusca-evolution-backup.service || true
  exit 1
fi
systemctl --no-pager --full show --property=ActiveState --property=SubState --property=ExecMainStatus digibusca-evolution-backup.service
