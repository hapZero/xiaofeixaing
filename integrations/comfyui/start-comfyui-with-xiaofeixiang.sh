#!/usr/bin/env bash
set -euo pipefail

COMFYUI_DIR="${COMFYUI_DIR:-/home/sxf/ComfyUI}"
COMFYUI_PYTHON="${COMFYUI_PYTHON:-/home/sxf/comfyui-env/bin/python}"
BRIDGE_ENV_FILE="${XIAOFEIXIANG_BRIDGE_ENV_FILE:-$COMFYUI_DIR/.xiaofeixiang-bridge.env}"
INTEGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_REMBG="${XIAOFEIXIANG_INSTALL_REMBG:-1}"
APPLY_EASY_USE_MODELSCOPE_PATCH="${XIAOFEIXIANG_APPLY_EASY_USE_MODELSCOPE_PATCH:-1}"

if [[ ! -f "$BRIDGE_ENV_FILE" ]]; then
  echo "Missing bridge environment file: $BRIDGE_ENV_FILE" >&2
  exit 1
fi

set -a
source "$BRIDGE_ENV_FILE"
set +a

if [[ "$APPLY_EASY_USE_MODELSCOPE_PATCH" == "1" ]]; then
  bash "$INTEGRATIONS_DIR/scripts/apply-easy-use-modelscope-patch.sh" || true
fi

if [[ "$INSTALL_REMBG" == "1" ]]; then
  RMBG_DIR="$COMFYUI_DIR/models/rembg/RMBG-2.0"
  if [[ ! -f "$RMBG_DIR/config.json" && ! -f "$RMBG_DIR/model.safetensors" && ! -f "$RMBG_DIR/pytorch_model.bin" ]]; then
    "$COMFYUI_PYTHON" -m pip install -q modelscope || true
    "$COMFYUI_PYTHON" "$INTEGRATIONS_DIR/scripts/install-rembg-modelscope.py" --comfyui-dir "$COMFYUI_DIR" --variant RMBG-2.0 || {
      echo "Warning: failed to pre-install RMBG-2.0 from ModelScope; ComfyUI will retry on first run." >&2
    }
  fi
fi

cd "$COMFYUI_DIR"
exec "$COMFYUI_PYTHON" main.py --listen 0.0.0.0 --port 8188
