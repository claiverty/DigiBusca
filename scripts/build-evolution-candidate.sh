#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_url=https://github.com/ErgoCodes/evolution-api.git
source_branch=fix/baileys-pairing-main
source_commit=d0198733da3cb133bd0c64d24fc4d1e7720696b1
image_tag=${EVOLUTION_CANDIDATE_IMAGE_TAG:-digibusca-evolution-api:2.3.7-pairing-rc14-d0198733}
push_image=${EVOLUTION_CANDIDATE_PUSH:-false}
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/digibusca-evolution-candidate.XXXXXX")
source_dir="$temporary_root/source"

case "$image_tag" in
  *[!A-Za-z0-9._:/-]*|'') echo "EVOLUTION_CANDIDATE_IMAGE_TAG contains unsupported characters." >&2; exit 1 ;;
esac
case "$push_image" in
  true|false) ;;
  *) echo "EVOLUTION_CANDIDATE_PUSH must be true or false." >&2; exit 1 ;;
esac

git clone --depth 1 --branch "$source_branch" "$source_url" "$source_dir"
checked_out_commit=$(git -C "$source_dir" rev-parse HEAD)
if [ "$checked_out_commit" != "$source_commit" ]; then
  echo "A revisão do candidato mudou. Revise e fixe o novo commit antes de compilar."
  exit 1
fi

cp "$project_root/evolution/patches/baileys+7.0.0-rc14.patch" "$source_dir/patches/baileys+7.0.0-rc14.patch"
git -C "$source_dir" apply --check "$project_root/evolution/patches/redact-database-url.patch"
git -C "$source_dir" apply "$project_root/evolution/patches/redact-database-url.patch"
docker build --pull \
  --label "org.opencontainers.image.source=$source_url" \
  --label "org.opencontainers.image.revision=$source_commit" \
  --tag "$image_tag" \
  "$source_dir"

if [ "$push_image" = true ]; then
  docker push "$image_tag"
fi

echo "Imagem Evolution compilada: $image_tag"
