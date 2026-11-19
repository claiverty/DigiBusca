#!/usr/bin/env bash
set -euo pipefail

source_dir=/opt/digibusca/ops/hostgator
instance_dir=/opt/openbot-docker/instances
manager="$instance_dir/openbot-instance"
backup=/etc/digibusca/hostgator/openbot-instance.before-static-addresses

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [ "$(docker network inspect openbot --format '{{.Driver}}|{{(index .IPAM.Config 0).Subnet}}' 2>/dev/null || true)" != "bridge|172.30.0.0/16" ]; then
  echo "The OpenBot bridge must be the expected 172.30.0.0/16 network." >&2
  exit 1
fi

for file in openbot-ops.network.compose.yaml openbot-whatsapp-network.compose.yaml; do
  if [ ! -f "$source_dir/$file" ]; then
    echo "Required network override is missing: $source_dir/$file" >&2
    exit 1
  fi
done

python3 - "$manager" "$backup" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
backup = Path(sys.argv[2])
source = path.read_text()
ops_marker = 'files+=(--file "$HERE/digibot-ops.network.compose.yaml")'
whatsapp_marker = 'files+=(--file "$HERE/digibot-whatsapp.network.compose.yaml")'
ops_present = ops_marker in source
whatsapp_present = whatsapp_marker in source
if ops_present != whatsapp_present:
    raise SystemExit("Only one static-network override is installed; inspect the manager before changing it.")
if ops_present and whatsapp_present:
    raise SystemExit(0)

needle = '  local files=(--file "$COMPOSE")\n'
if source.count(needle) != 1:
    raise SystemExit("Could not safely locate the OpenBot Compose selector; no manager changes were made.")

if not backup.exists():
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_bytes(path.read_bytes())
    backup.chmod(0o600)

replacement = needle + \
    '  if [ "$name" = "digibot-ops" ]; then\n' \
    '    files+=(--file "$HERE/digibot-ops.network.compose.yaml")\n' \
    '  elif [ "$name" = "digibot-whatsapp" ]; then\n' \
    '    files+=(--file "$HERE/digibot-whatsapp.network.compose.yaml")\n' \
    '  fi\n'
path.write_text(source.replace(needle, replacement, 1))
path.chmod(0o755)
PY

install -m 0644 "$source_dir/openbot-ops.network.compose.yaml" "$instance_dir/digibot-ops.network.compose.yaml"
install -m 0644 "$source_dir/openbot-whatsapp-network.compose.yaml" "$instance_dir/digibot-whatsapp.network.compose.yaml"

bash -n "$manager"
echo "Pinned OpenBot Ops to 172.30.0.2 and WhatsApp to 172.30.0.4."
