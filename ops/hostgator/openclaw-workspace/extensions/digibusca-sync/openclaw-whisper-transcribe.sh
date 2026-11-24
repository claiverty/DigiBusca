#!/bin/sh
set -eu

input_path=${1:-}
if [ -z "$input_path" ] || [ ! -f "$input_path" ]; then
  printf '%s\n' 'Whisper transcription input file is missing.' >&2
  exit 2
fi

work_dir=$(mktemp -d /tmp/openclaw-whisper.XXXXXX)
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

ffmpeg -nostdin -hide_banner -loglevel error -y \
  -i "$input_path" -t 300 -vn -ac 1 -ar 16000 -c:a pcm_s16le \
  "$work_dir/audio.wav"

/opt/whisper/bin/whisper-cli \
  --model /opt/whisper/models/ggml-base.bin \
  --file "$work_dir/audio.wav" \
  --language pt \
  --threads 2 \
  --no-timestamps \
  --no-prints \
  --no-gpu
