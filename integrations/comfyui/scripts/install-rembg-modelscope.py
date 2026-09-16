#!/usr/bin/env python3
"""Download RMBG models from ModelScope into ComfyUI models/rembg."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


MODELSCOPE_MODELS = {
    "RMBG-2.0": "AI-ModelScope/RMBG-2.0",
    "RMBG-1.4": "AI-ModelScope/RMBG-1.4",
}


def _model_ready(model_dir: Path, variant: str) -> bool:
    if not model_dir.is_dir():
        return False
    if variant == "RMBG-1.4":
        return (model_dir / "RMBG-1.4.pth").is_file() or (model_dir / "model.pth").is_file()
    markers = ("config.json", "model.safetensors", "pytorch_model.bin")
    return any((model_dir / name).is_file() for name in markers)


def _ensure_modelscope() -> None:
    try:
        import modelscope  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "modelscope is not installed. Run:\n"
            "  pip install modelscope\n"
            f"Original error: {exc}"
        ) from exc


def download_variant(variant: str, rembg_dir: Path, force: bool = False) -> Path:
    repo_id = MODELSCOPE_MODELS[variant]
    if variant == "RMBG-2.0":
        target = rembg_dir / "RMBG-2.0"
    else:
        target = rembg_dir

    if not force and _model_ready(target if variant == "RMBG-2.0" else rembg_dir, variant):
        print(f"[skip] {variant} already present under {target}")
        return target

    _ensure_modelscope()
    from modelscope import snapshot_download

    print(f"[download] {repo_id} -> {target}")
    target.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id, local_dir=str(target))

    if variant == "RMBG-1.4":
        for candidate in (target / "model.pth", target / "RMBG-1.4.pth"):
            if candidate.is_file():
                canonical = rembg_dir / "RMBG-1.4.pth"
                if candidate != canonical and not canonical.exists():
                    candidate.replace(canonical)
                break

    if not _model_ready(target if variant == "RMBG-2.0" else rembg_dir, variant):
        raise SystemExit(f"Download finished but {variant} files are still missing under {target}")

    print(f"[ok] {variant} ready at {target}")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--comfyui-dir",
        default=os.environ.get("COMFYUI_DIR", "/home/sxf/ComfyUI"),
        help="ComfyUI root directory",
    )
    parser.add_argument(
        "--variant",
        choices=("RMBG-2.0", "RMBG-1.4", "all"),
        default="RMBG-2.0",
        help="Which RMBG model to install",
    )
    parser.add_argument("--force", action="store_true", help="Re-download even if files exist")
    args = parser.parse_args()

    rembg_dir = Path(args.comfyui_dir).expanduser().resolve() / "models" / "rembg"
    rembg_dir.mkdir(parents=True, exist_ok=True)

    variants = ["RMBG-2.0", "RMBG-1.4"] if args.variant == "all" else [args.variant]
    for variant in variants:
        download_variant(variant, rembg_dir, force=args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
