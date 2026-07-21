#!/usr/bin/env bash
set -euo pipefail

COMFYUI_DIR="${COMFYUI_DIR:-/home/sxf/ComfyUI}"
COMFYUI_PYTHON="${COMFYUI_PYTHON:-/home/sxf/comfyui-env/bin/python}"
BRIDGE_ENV_FILE="${XIAOFEIXIANG_BRIDGE_ENV_FILE:-$COMFYUI_DIR/.xiaofeixiang-bridge.env}"

if [[ ! -f "$BRIDGE_ENV_FILE" ]]; then
  echo "Missing bridge environment file: $BRIDGE_ENV_FILE" >&2
  exit 1
fi

set -a
source "$BRIDGE_ENV_FILE"
set +a

cd "$COMFYUI_DIR"
exec "$COMFYUI_PYTHON" main.py --listen 0.0.0.0 --port 8188
