#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly env_file='/etc/digibusca/hostgator/compose.env'
readonly compose_file='/opt/digibusca/ops/hostgator/compose.yaml'
readonly project_name='digibusca-hostgator'
readonly container_name='digibusca-hostgator-digibusca-backend-1'
readonly lock_file='/run/lock/digibusca-backend-deploy.lock'

exec 9>"$lock_file"
flock -n 9 || { echo 'Já existe um deploy do backend em andamento.' >&2; exit 1; }

IFS= read -r image_ref || { echo 'Referência da imagem ausente.' >&2; exit 1; }
IFS= read -r expected_sha || { echo 'Checksum da imagem ausente.' >&2; exit 1; }

if [[ ! "$image_ref" =~ ^ghcr\.io/claiverty/digibusca/digibusca-backend:[a-f0-9]{40}$ ]]; then
  echo 'Referência da imagem fora do formato permitido.' >&2
  exit 1
fi
if [[ ! "$expected_sha" =~ ^[a-f0-9]{64}$ ]]; then
  echo 'Checksum fora do formato permitido.' >&2
  exit 1
fi

archive="$(mktemp /tmp/digibusca-backend-image.XXXXXX.tar.gz)"
trap 'rm -f "$archive"' EXIT
cat >"$archive"
actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo 'Checksum do artefato não confere.' >&2
  exit 1
fi
gzip -t "$archive"

old_ref="$(awk -F= '$1 == "DIGIBUSCA_BACKEND_IMAGE" { print substr($0, index($0, "=") + 1); count++ } END { if (count != 1) exit 1 }' "$env_file")"
if [[ ! "$old_ref" =~ ^ghcr\.io/claiverty/digibusca/digibusca-backend:[a-f0-9]{40}$ ]]; then
  echo 'A imagem atual no compose.env não está no formato esperado.' >&2
  exit 1
fi
if ! docker image inspect "$old_ref" >/dev/null 2>&1; then
  echo 'A imagem anterior não está disponível para rollback.' >&2
  exit 1
fi

docker load -i "$archive" >/dev/null
revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_ref")"
if [[ "$revision" != "${image_ref##*:}" ]]; then
  echo 'A revisão declarada pela imagem não confere com a tag.' >&2
  exit 1
fi

set_backend_image() {
  local image="$1" temporary
  temporary="$(mktemp "${env_file}.XXXXXX")"
  if ! awk -v image="$image" '
    BEGIN { count = 0 }
    /^DIGIBUSCA_BACKEND_IMAGE=/ { print "DIGIBUSCA_BACKEND_IMAGE=" image; count++; next }
    { print }
    END { if (count != 1) exit 1 }
  ' "$env_file" >"$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  chown --reference="$env_file" "$temporary"
  chmod --reference="$env_file" "$temporary"
  mv -f "$temporary" "$env_file"
}

compose_backend() {
  docker compose --env-file "$env_file" -p "$project_name" -f "$compose_file" \
    --profile evolution --profile tunnel up -d --no-deps digibusca-backend
}

wait_healthy() {
  local attempt status
  for attempt in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_name" 2>/dev/null || true)"
    if [[ "$status" == 'healthy' ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if [[ "$old_ref" == "$image_ref" ]]; then
  wait_healthy || { echo 'Backend já está na imagem solicitada, mas não ficou saudável.' >&2; exit 1; }
  echo "Backend já está saudável na revisão ${image_ref##*:}."
  exit 0
fi

backup_file="${env_file}.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$env_file" "$backup_file"
echo "Atualizando backend de ${old_ref##*:} para ${image_ref##*:}."
set_backend_image "$image_ref"

if compose_backend && wait_healthy; then
  echo "Backend atualizado e saudável na revisão ${image_ref##*:}."
  exit 0
fi

echo 'O backend novo não ficou saudável; restaurando a imagem anterior.' >&2
cp -p "$backup_file" "$env_file"
if compose_backend && wait_healthy; then
  echo "Rollback concluído; backend saudável na revisão ${old_ref##*:}." >&2
else
  echo 'Falha também ao restaurar o backend anterior. Verifique a VPS.' >&2
fi
exit 1
