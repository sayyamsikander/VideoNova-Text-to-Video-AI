#!/usr/bin/env python3
import json
import mimetypes
import os
import secrets
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load_env_file(path: Path):
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env_file(ROOT / ".env")

STATIC = ROOT / "static"
OUTPUTS = ROOT / "outputs"
MODELS = ROOT / "models"
OUTPUTS.mkdir(exist_ok=True)
MODELS.mkdir(exist_ok=True)

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8080"))
MODEL_ID = os.getenv("VIDEONOVA_MODEL_ID", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers")
MODEL_PATH = Path(os.getenv("VIDEONOVA_MODEL_PATH", str(MODELS / "Wan2.1-T2V-1.3B-Diffusers")))
AUTO_DOWNLOAD = os.getenv("VIDEONOVA_AUTO_DOWNLOAD", "true").lower() in {"1", "true", "yes", "on"}
DEVICE_OVERRIDE = os.getenv("VIDEONOVA_DEVICE", "").strip().lower()

JOBS = {}
JOBS_LOCK = threading.Lock()
PIPELINE = None
PIPELINE_LOCK = threading.Lock()

def now_ms():
    return int(time.time() * 1000)

def set_job(job_id, **changes):
    with JOBS_LOCK:
        job = JOBS.setdefault(job_id, {"id": job_id, "createdAt": now_ms()})
        job.update(changes)
        job["updatedAt"] = now_ms()
        return dict(job)

def get_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        return dict(job) if job else None

def local_status():
    status = {
        "engine": "local-wan",
        "model": MODEL_PATH.name if MODEL_PATH.exists() else MODEL_ID,
        "modelPresent": MODEL_PATH.exists(),
        "autoDownload": AUTO_DOWNLOAD,
        "device": "unknown",
        "torchInstalled": False,
        "diffusersInstalled": False,
        "ready": False,
    }
    try:
        import torch
        status["torchInstalled"] = True
        if DEVICE_OVERRIDE:
            device = DEVICE_OVERRIDE
        elif torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
        status["device"] = device
    except Exception:
        device = "unknown"
    try:
        import diffusers  # noqa: F401
        status["diffusersInstalled"] = True
    except Exception:
        pass
    status["ready"] = bool(status["torchInstalled"] and status["diffusersInstalled"] and (status["modelPresent"] or AUTO_DOWNLOAD))
    return status

def build_dimensions(aspect: str, quality: str):
    # Wan 1.3B is most practical around 480p. Higher modes are allowed on stronger GPUs.
    presets = {
        "480p": {"16:9": (832, 480), "9:16": (480, 832), "1:1": (640, 640)},
        "720p": {"16:9": (1280, 720), "9:16": (720, 1280), "1:1": (896, 896)},
        "1080p": {"16:9": (1920, 1088), "9:16": (1088, 1920), "1:1": (1088, 1088)},
    }
    return presets.get(quality, presets["480p"]).get(aspect, (832, 480))

def download_model_if_needed(job_id=None):
    if MODEL_PATH.exists() and (MODEL_PATH / "model_index.json").exists():
        return
    if not AUTO_DOWNLOAD:
        raise RuntimeError(
            f"Local model not found at {MODEL_PATH}. Run: python download_model.py"
        )
    if job_id:
        set_job(job_id, progress=6, message="Downloading the open-source model for first use…")
    from huggingface_hub import snapshot_download
    MODEL_PATH.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=MODEL_ID,
        local_dir=str(MODEL_PATH),
        token=False,
    )

def choose_device(torch):
    if DEVICE_OVERRIDE:
        return DEVICE_OVERRIDE
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"

def load_pipeline(job_id=None):
    global PIPELINE
    if PIPELINE is not None:
        return PIPELINE
    with PIPELINE_LOCK:
        if PIPELINE is not None:
            return PIPELINE
        download_model_if_needed(job_id)
        if job_id:
            set_job(job_id, progress=12, message="Loading the local AI model into memory…")
        import torch
        from diffusers import AutoModel, WanPipeline
        from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler

        device = choose_device(torch)
        if device == "cpu":
            raise RuntimeError(
                "No supported GPU was detected. Video generation on CPU is not practical. "
                "Use an NVIDIA CUDA GPU, Apple Silicon (MPS), or set VIDEONOVA_DEVICE explicitly."
            )

        dtype = torch.bfloat16
        vae = AutoModel.from_pretrained(
            str(MODEL_PATH),
            subfolder="vae",
            torch_dtype=torch.float32,
            local_files_only=True,
        )
        pipe = WanPipeline.from_pretrained(
            str(MODEL_PATH),
            vae=vae,
            torch_dtype=dtype,
            local_files_only=True,
        )
        flow_shift = 3.0
        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config, flow_shift=flow_shift)

        if device == "cuda":
            # CPU offload lowers VRAM use. The smaller Wan 1.3B model is documented around ~11GB VRAM.
            pipe.enable_model_cpu_offload()
        else:
            pipe.to(device)

        PIPELINE = pipe
        return PIPELINE

def run_local(job_id, payload):
    try:
        import torch
        from diffusers.utils import export_to_video

        prompt = payload["prompt"].strip()
        negative = payload.get("negativePrompt", "").strip()
        seed = int(payload.get("seed") or secrets.randbelow(2_147_483_647))
        duration = max(1, min(8, int(payload.get("duration") or 4)))
        fps = max(8, min(30, int(payload.get("fps") or 16)))
        steps = max(4, min(60, int(payload.get("steps") or 24)))
        guidance = max(1.0, min(15.0, float(payload.get("guidance") or 5.0)))
        width, height = build_dimensions(payload.get("aspect", "16:9"), payload.get("quality", "480p"))

        # Wan expects 4*k+1 frames.
        requested = max(17, duration * fps + 1)
        frames = ((requested - 1) // 4) * 4 + 1

        set_job(job_id, status="running", progress=4, message="Preparing local generation…", seed=seed)
        pipe = load_pipeline(job_id)

        if get_job(job_id).get("status") == "cancelled":
            return

        set_job(
            job_id,
            progress=20,
            message=f"Generating locally on {local_status()['device']}…",
            width=width,
            height=height,
            frames=frames,
        )

        generator_device = "cuda" if torch.cuda.is_available() else "cpu"
        generator = torch.Generator(device=generator_device).manual_seed(seed)

        result = pipe(
            prompt=prompt,
            negative_prompt=negative or None,
            height=height,
            width=width,
            num_frames=frames,
            guidance_scale=guidance,
            num_inference_steps=steps,
            generator=generator,
        ).frames[0]

        if get_job(job_id).get("status") == "cancelled":
            return

        set_job(job_id, progress=92, message="Encoding MP4…")
        filename = f"{job_id}.mp4"
        export_to_video(result, str(OUTPUTS / filename), fps=fps)

        set_job(
            job_id,
            status="complete",
            progress=100,
            message="Video ready",
            videoUrl=f"/api/video/{filename}",
            downloadUrl=f"/api/download/{filename}",
            model=MODEL_PATH.name,
        )
    except Exception as exc:
        if get_job(job_id) and get_job(job_id).get("status") == "cancelled":
            return
        set_job(job_id, status="error", progress=0, message=str(exc))

class Handler(SimpleHTTPRequestHandler):
    server_version = "VideoNovaLocal/2.0"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 100_000:
            raise ValueError("Invalid request size")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/config":
            self.send_json({"app": "VideoNova", "local": local_status()})
            return

        if path.startswith("/api/jobs/"):
            job = get_job(path.split("/")[-1])
            self.send_json(job or {"error": "Job not found"}, 200 if job else 404)
            return

        if path.startswith("/api/video/") or path.startswith("/api/download/"):
            filename = Path(path.split("/")[-1]).name
            file_path = OUTPUTS / filename
            if not file_path.exists():
                self.send_error(404, "Video not found")
                return
            mime = mimetypes.guess_type(filename)[0] or "video/mp4"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(file_path.stat().st_size))
            if path.startswith("/api/download/"):
                self.send_header("Content-Disposition", f'attachment; filename="videonova-{filename}"')
            self.end_headers()
            with file_path.open("rb") as f:
                while chunk := f.read(1024 * 1024):
                    self.wfile.write(chunk)
            return

        if path == "/":
            path = "/index.html"
        candidate = (STATIC / path.lstrip("/")).resolve()
        if not str(candidate).startswith(str(STATIC.resolve())) or not candidate.is_file():
            self.send_error(404)
            return
        data = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/generate":
            try:
                payload = self.read_json()
                prompt = str(payload.get("prompt", "")).strip()
                if len(prompt) < 3:
                    raise ValueError("Prompt must contain at least 3 characters.")
                if len(prompt) > 4000:
                    raise ValueError("Prompt is too long (max 4000 characters).")

                job_id = secrets.token_hex(10)
                set_job(
                    job_id,
                    status="queued",
                    progress=2,
                    message="Queued",
                    provider="local",
                    prompt=prompt,
                    settings={
                        "aspect": payload.get("aspect", "16:9"),
                        "quality": payload.get("quality", "480p"),
                        "duration": payload.get("duration", 4),
                        "fps": payload.get("fps", 16),
                    },
                )
                threading.Thread(target=run_local, args=(job_id, payload), daemon=True).start()
                self.send_json({"jobId": job_id, "status": "queued"}, 202)
            except Exception as exc:
                self.send_json({"error": str(exc)}, 400)
            return

        if path.startswith("/api/jobs/") and path.endswith("/cancel"):
            parts = path.strip("/").split("/")
            if len(parts) != 4:
                self.send_json({"error": "Invalid path"}, 400)
                return
            job_id = parts[2]
            if not get_job(job_id):
                self.send_json({"error": "Job not found"}, 404)
                return
            set_job(job_id, status="cancelled", progress=0, message="Cancelled")
            self.send_json({"ok": True})
            return

        self.send_error(404)

if __name__ == "__main__":
    status = local_status()
    print(f"VideoNova self-hosted AI running at http://{HOST}:{PORT}")
    print(f"Device: {status['device']}")
    print(f"Model: {status['model']}")
    print("No API key or third-party account is required.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
