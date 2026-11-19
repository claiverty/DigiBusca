#!/usr/bin/env bash
set -euo pipefail

instance_dir=/opt/openbot-docker/instances
manager="$instance_dir/openbot-instance"
override="$instance_dir/digibot-whatsapp.compose.yaml"
network=digibusca-whatsapp-agent
subnet=10.0.4.0/24
instance_env="$instance_dir/digibot-whatsapp.env"
backend_env=/etc/digibusca/hostgator/backend.env
automation_dir=/srv/openbot/digibot-whatsapp/data/.config/OpenBot/automation

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [ ! -f "$override" ] || [ ! -f "$manager" ]; then
  echo "The OpenBot WhatsApp Compose override or manager is missing." >&2
  exit 1
fi

if [ ! -f "$instance_dir/digibot-whatsapp.network.compose.yaml" ]; then
  echo "Install the fixed-address OpenBot network override before configuring the bridge." >&2
  exit 1
fi

if [ ! -f "$instance_env" ] || [ ! -f "$backend_env" ]; then
  echo "Configure the root-only OpenBot instance and backend environment files first." >&2
  exit 1
fi

if ! docker inspect --format '{{.State.Running}}' openbot-digibot-whatsapp 2>/dev/null | grep -qx true; then
  echo "The dedicated DigiBot WhatsApp OpenBot instance must be running." >&2
  exit 1
fi

if docker network inspect "$network" >/dev/null 2>&1; then
  network_state=$(docker network inspect --format '{{.Driver}}|{{.Internal}}|{{.Attachable}}|{{range .IPAM.Config}}{{.Subnet}}{{end}}' "$network")
  if [ "$network_state" != "overlay|true|true|$subnet" ]; then
    echo "The existing private WhatsApp network has an unexpected configuration." >&2
    exit 1
  fi
fi

python3 - "$instance_env" "$backend_env" "$automation_dir" <<'PY'
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlsplit

instance_file, backend_file, automation_dir = map(Path, sys.argv[1:])

def read_env(path):
    info = path.stat()
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o077:
        raise SystemExit("Backend and OpenBot environment files must remain root-owned and inaccessible to group/other users.")
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator and re.fullmatch(r"[A-Z][A-Z0-9_]*", key.strip()):
            values[key.strip()] = value.strip().strip("\"'")
    return values

instance = read_env(instance_file)
backend = read_env(backend_file)
image = instance.get("DIGIBUSCA_BACKEND_IMAGE", "")
agent = instance.get("WHATSAPP_OPENBOT_AGENT_ID", "")
token = instance.get("WHATSAPP_OPENBOT_BRIDGE_TOKEN", "")
if not re.fullmatch(r"[^\s@]+(?:/[^\s@]+)*@sha256:[a-f0-9]{64}", image):
    raise SystemExit("Set DIGIBUSCA_BACKEND_IMAGE to a reviewed image digest in the OpenBot instance environment.")
if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", agent) or agent.startswith("REPLACE_"):
    raise SystemExit("Set the actual Cristhian agent ID in the OpenBot instance environment.")
if not re.fullmatch(r"[a-f0-9]{64}", token):
    raise SystemExit("Set a separate 64-character bridge token in both root-only environment files.")
if backend.get("WHATSAPP_OPENBOT_AGENT_ID") != agent or backend.get("WHATSAPP_OPENBOT_BRIDGE_TOKEN") != token:
    raise SystemExit("The OpenBot instance and backend must use the same agent ID and bridge token.")
if not automation_dir.is_dir():
    raise SystemExit("Enable Local scripts for Cristhian in OpenBot first; the protected automation files are absent.")
for filename in ("url", "headers"):
    path = automation_dir / filename
    if not path.is_file():
        raise SystemExit("Enable Local scripts for Cristhian in OpenBot first; the protected automation files are absent.")
    info = path.stat()
    if info.st_uid != 1000 or stat.S_IMODE(info.st_mode) & 0o077:
        raise SystemExit("OpenBot Local scripts files must stay owned by UID 1000 and inaccessible to group/other users.")

url = (automation_dir / "url").read_text().strip()
parts = urlsplit(url)
if parts.scheme != "http" or parts.hostname != "127.0.0.1" or parts.path not in ("", "/") or parts.query or parts.fragment:
    raise SystemExit("OpenBot Local scripts URL must point to its loopback API root.")
if not re.search(r"(?im)^Authorization:\s*Bearer\s+\S+\s*$", (automation_dir / "headers").read_text()):
    raise SystemExit("OpenBot Local scripts authorization header is missing or invalid.")
PY

python3 - "$manager" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
marker = 'files+=(--file "$HERE/digibot-whatsapp.compose.yaml")'
if marker in source:
    raise SystemExit(0)
needle = '  local files=(--file "$COMPOSE")\n'
if source.count(needle) != 1:
    raise SystemExit("Could not safely locate the OpenBot Compose selector; no manager changes were made.")
backup = Path("/etc/digibusca/hostgator/openbot-instance.before-whatsapp-bridge")
if not backup.exists():
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_bytes(path.read_bytes())
    backup.chmod(0o600)
replacement = needle + '  if [ "$name" = "digibot-whatsapp" ]; then\n' \
    '    files+=(--file "$HERE/digibot-whatsapp.compose.yaml")\n' \
    '  fi\n'
path.write_text(source.replace(needle, replacement, 1))
path.chmod(0o755)
PY

bash -n "$manager"

if ! docker network inspect "$network" >/dev/null 2>&1; then
  docker network create --driver overlay --attachable --internal --subnet "$subnet" "$network" >/dev/null
fi

network_state=$(docker network inspect --format '{{.Driver}}|{{.Internal}}|{{.Attachable}}|{{range .IPAM.Config}}{{.Subnet}}{{end}}' "$network")
if [ "$network_state" != "overlay|true|true|$subnet" ]; then
  echo "The existing $network network has an unexpected configuration." >&2
  exit 1
fi

echo "Private bridge configuration is valid. Restart the dedicated OpenBot instance to apply its Compose sidecar."
