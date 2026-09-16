#!/usr/bin/env bash
set -euo pipefail

COMFYUI_DIR="${COMFYUI_DIR:-/home/sxf/ComfyUI}"
EASY_USE_DIR="${EASY_USE_DIR:-$COMFYUI_DIR/custom_nodes/comfyui-easy-use}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/../patches/comfyui-easy-use-modelscope.patch"

if [[ ! -d "$EASY_USE_DIR/.git" && ! -f "$EASY_USE_DIR/py/config.py" ]]; then
  echo "ComfyUI-Easy-Use not found at: $EASY_USE_DIR" >&2
  exit 1
fi

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "Patch file not found: $PATCH_FILE" >&2
  exit 1
fi

cd "$EASY_USE_DIR"
patch -p1 --forward --batch <"$PATCH_FILE" || {
  echo "Patch may already be applied. Continuing." >&2
}

echo "Applied ModelScope patch to ComfyUI-Easy-Use."
