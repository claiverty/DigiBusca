#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_url=https://github.com/ErgoCodes/evolution-api.git
source_branch=fix/baileys-pairing-main
source_commit=d0198733da3cb133bd0c64d24fc4d1e7720696b1
image_tag=digibusca-evolution-api:2.3.7-pairing-rc14-d0198733
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/digibusca-evolution-candidate.XXXXXX")
source_dir="$temporary_root/source"

git clone --depth 1 --branch "$source_branch" "$source_url" "$source_dir"
checked_out_commit=$(git -C "$source_dir" rev-parse HEAD)
if [ "$checked_out_commit" != "$source_commit" ]; then
  echo "A revisão do candidato mudou. Revise e fixe o novo commit antes de compilar."
  exit 1
fi

cp "$project_root/evolution/patches/baileys+7.0.0-rc14.patch" "$source_dir/patches/baileys+7.0.0-rc14.patch"
docker build --pull \
  --label "org.opencontainers.image.source=$source_url" \
  --label "org.opencontainers.image.revision=$source_commit" \
  --tag "$image_tag" \
  "$source_dir"

echo "Imagem Evolution compilada: $image_tag"
