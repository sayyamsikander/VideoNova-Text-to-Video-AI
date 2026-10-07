#!/usr/bin/env python3
"""Download VideoNova's default open-source model without logging in."""

import os
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

ROOT = Path(__file__).resolve().parent
MODEL_ID = os.getenv("VIDEONOVA_MODEL_ID", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers")
MODEL_PATH = Path(os.getenv("VIDEONOVA_MODEL_PATH", str(ROOT / "models" / "Wan2.1-T2V-1.3B-Diffusers")))

def main():
    from huggingface_hub import snapshot_download

    MODEL_PATH.mkdir(parents=True, exist_ok=True)
    print(f"Downloading public model: {MODEL_ID}")
    print(f"Destination: {MODEL_PATH}")
    print("No account or API token is used.")
    snapshot_download(
        repo_id=MODEL_ID,
        local_dir=str(MODEL_PATH),
        token=False,
    )
    print("Model download complete.")
    print("Start VideoNova with: python server.py")

if __name__ == "__main__":
    main()
