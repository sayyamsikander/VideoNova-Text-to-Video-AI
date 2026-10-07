#!/usr/bin/env python3
import json
import mimetypes
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
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
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)

load_env_file(ROOT / ".env")

STATIC = ROOT / "static"
OUTPUTS = ROOT / "outputs"
CONFIG_DIR = ROOT / "config"
OUTPUTS.mkdir(exist_ok=True)

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8080"))
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
HF_PROVIDER = os.getenv("HF_PROVIDER", "fal-ai").strip() or "fal-ai"
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
COMFYUI_WORKFLOW = Path(os.getenv("COMFYUI_WORKFLOW", str(CONFIG_DIR / "comfyui_api_workflow.json")))
CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*").strip() or "*"

JOBS = {}
JOBS_LOCK = threading.Lock()

def comfy_workflow_configured():
    if not COMFYUI_WORKFLOW.exists():
        return False
    try:
        data = json.loads(COMFYUI_WORKFLOW.read_text(encoding="utf-8"))
        graph = data.get("prompt", data) if isinstance(data, dict) else None
        return isinstance(graph, dict) and any(
            isinstance(v, dict) and "class_type" in v for v in graph.values()
        )
    except Exception:
        return False

HF_MODELS = [
    "Wan-AI/Wan2.1-T2V-1.3B",
    "tencent/HunyuanVideo",
    "Lightricks/LTX-Video-0.9.8-13B-distilled",
]


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


def detect_video_ext(data: bytes):
    if data[:4] == b"\x1aE\xdf\xa3":
        return ".webm", "video/webm"
    if len(data) > 12 and data[4:8] == b"ftyp":
        return ".mp4", "video/mp4"
    return ".mp4", "video/mp4"


def build_dimensions(aspect: str, quality: str):
    base = {"480p": 480, "720p": 720, "1080p": 1080}.get(quality, 720)
    if aspect == "9:16":
        return int(base * 9 / 16) // 8 * 8, base
    if aspect == "1:1":
        return base, base
    return base * 16 // 9 // 8 * 8, base


def replace_placeholders(value, mapping):
    if isinstance(value, dict):
        return {k: replace_placeholders(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [replace_placeholders(v, mapping) for v in value]
    if isinstance(value, str):
        if value in mapping:
            return mapping[value]
        out = value
        for key, repl in mapping.items():
            if isinstance(repl, (str, int, float)):
                out = out.replace(key, str(repl))
        return out
    return value


def http_json(url, method="GET", payload=None, timeout=30):
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return json.loads(raw.decode("utf-8")) if raw else {}


def run_hf(job_id, payload):
    try:
        if not HF_TOKEN:
            raise RuntimeError("HF_TOKEN is not configured. Add it to your environment or .env launcher.")
        set_job(job_id, status="running", progress=8, message="Connecting to Hugging Face Inference Providers…")
        from huggingface_hub import InferenceClient

        prompt = payload["prompt"].strip()
        model = payload.get("model") or HF_MODELS[0]
        seed = int(payload.get("seed") or secrets.randbelow(2_147_483_647))
        negative = payload.get("negativePrompt", "").strip()
        duration = max(2, min(12, int(payload.get("duration") or 4)))
        fps = max(8, min(30, int(payload.get("fps") or 16)))
        frames = min(161, max(33, duration * fps + 1))
        steps = max(4, min(60, int(payload.get("steps") or 24)))
        guidance = max(1.0, min(15.0, float(payload.get("guidance") or 6.0)))

        client = InferenceClient(provider=HF_PROVIDER, api_key=HF_TOKEN)
        set_job(job_id, progress=20, message=f"Generating with {model}…")
        kwargs = {
            "model": model,
            "seed": seed,
            "num_frames": frames,
            "num_inference_steps": steps,
            "guidance_scale": guidance,
        }
        if negative:
            kwargs["negative_prompt"] = [negative]

        video = client.text_to_video(prompt, **kwargs)
        set_job(job_id, progress=86, message="Saving generated video…")

        if isinstance(video, bytes):
            data = video
        elif hasattr(video, "read"):
            data = video.read()
        else:
            try:
                data = bytes(video)
            except Exception as exc:
                raise RuntimeError(f"Unexpected video response type: {type(video).__name__}") from exc

        if not data:
            raise RuntimeError("Provider returned an empty video.")

        ext, mime = detect_video_ext(data)
        filename = f"{job_id}{ext}"
        path = OUTPUTS / filename
        path.write_bytes(data)
        if get_job(job_id).get("status") == "cancelled":
            return
        set_job(
            job_id,
            status="complete",
            progress=100,
            message="Video ready",
            videoUrl=f"/api/video/{filename}",
            downloadUrl=f"/api/download/{filename}",
            mime=mime,
            seed=seed,
            model=model,
        )
    except Exception as exc:
        if get_job(job_id) and get_job(job_id).get("status") == "cancelled":
            return
        set_job(job_id, status="error", progress=0, message=str(exc))


def find_comfy_asset(history_entry):
    outputs = history_entry.get("outputs", {}) if isinstance(history_entry, dict) else {}
    preferred_keys = ("videos", "gifs", "images", "audio")
    for node in outputs.values():
        if not isinstance(node, dict):
            continue
        for key in preferred_keys:
            assets = node.get(key)
            if isinstance(assets, list):
                for asset in assets:
                    if not isinstance(asset, dict) or not asset.get("filename"):
                        continue
                    name = asset.get("filename", "")
                    if key in ("videos", "gifs") or name.lower().endswith((".mp4", ".webm", ".mov", ".mkv")):
                        return asset
    return None


def run_comfy(job_id, payload):
    try:
        if not comfy_workflow_configured():
            raise RuntimeError(
                f"ComfyUI API workflow not found: {COMFYUI_WORKFLOW}. Export a workflow in API format and save it there."
            )
        raw = json.loads(COMFYUI_WORKFLOW.read_text(encoding="utf-8"))
        prompt_graph = raw.get("prompt", raw)
        width, height = build_dimensions(payload.get("aspect", "16:9"), payload.get("quality", "720p"))
        duration = max(2, min(12, int(payload.get("duration") or 4)))
        fps = max(8, min(30, int(payload.get("fps") or 16)))
        frames = duration * fps + 1
        seed = int(payload.get("seed") or secrets.randbelow(2_147_483_647))
        mapping = {
            "__PROMPT__": payload["prompt"].strip(),
            "__NEGATIVE_PROMPT__": payload.get("negativePrompt", "").strip(),
            "__SEED__": seed,
            "__WIDTH__": width,
            "__HEIGHT__": height,
            "__FRAMES__": frames,
            "__FPS__": fps,
        }
        prompt_graph = replace_placeholders(prompt_graph, mapping)
        set_job(job_id, status="running", progress=8, message="Sending workflow to ComfyUI…")
        queued = http_json(f"{COMFYUI_URL}/prompt", method="POST", payload={"prompt": prompt_graph}, timeout=30)
        prompt_id = queued.get("prompt_id")
        if not prompt_id:
            raise RuntimeError(f"ComfyUI rejected the workflow: {queued}")
        set_job(job_id, progress=18, message="ComfyUI is generating…", providerJobId=prompt_id, seed=seed)

        start = time.time()
        while time.time() - start < 3600:
            job = get_job(job_id)
            if job and job.get("status") == "cancelled":
                try:
                    http_json(f"{COMFYUI_URL}/interrupt", method="POST", payload={}, timeout=10)
                except Exception:
                    pass
                return
            history = http_json(f"{COMFYUI_URL}/history/{urllib.parse.quote(prompt_id)}", timeout=20)
            entry = history.get(prompt_id)
            if entry:
                asset = find_comfy_asset(entry)
                status = entry.get("status", {}) if isinstance(entry, dict) else {}
                completed = bool(status.get("completed")) or asset is not None
                if completed and asset:
                    qs = urllib.parse.urlencode({
                        "filename": asset.get("filename", ""),
                        "subfolder": asset.get("subfolder", ""),
                        "type": asset.get("type", "output"),
                    })
                    req = urllib.request.Request(f"{COMFYUI_URL}/view?{qs}")
                    with urllib.request.urlopen(req, timeout=120) as resp:
                        data = resp.read()
                        content_type = resp.headers.get("Content-Type", "video/mp4")
                    if not data:
                        raise RuntimeError("ComfyUI returned an empty output file.")
                    ext = Path(asset.get("filename", "video.mp4")).suffix or ".mp4"
                    filename = f"{job_id}{ext}"
                    (OUTPUTS / filename).write_bytes(data)
                    set_job(
                        job_id,
                        status="complete",
                        progress=100,
                        message="Video ready",
                        videoUrl=f"/api/video/{filename}",
                        downloadUrl=f"/api/download/{filename}",
                        mime=content_type,
                    )
                    return
                if completed and not asset:
                    raise RuntimeError("ComfyUI finished but no video output was found. Ensure your workflow saves a video file.")
            elapsed = time.time() - start
            progress = min(92, 18 + int(elapsed / 6))
            set_job(job_id, progress=progress, message="ComfyUI is generating…")
            time.sleep(2)
        raise RuntimeError("Generation timed out after 60 minutes.")
    except Exception as exc:
        if get_job(job_id) and get_job(job_id).get("status") == "cancelled":
            return
        set_job(job_id, status="error", progress=0, message=str(exc))


class Handler(SimpleHTTPRequestHandler):
    server_version = "VideoNova/1.0"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 100_000:
            raise ValueError("Invalid request size")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/config":
            self.send_json({
                "app": "VideoNova",
                "hf": {
                    "configured": bool(HF_TOKEN),
                    "provider": HF_PROVIDER,
                    "models": HF_MODELS,
                },
                "comfyui": {
                    "configured": comfy_workflow_configured(),
                    "url": COMFYUI_URL,
                    "workflow": str(COMFYUI_WORKFLOW.name),
                },
            })
            return
        if path.startswith("/api/jobs/"):
            job_id = path.split("/")[-1]
            job = get_job(job_id)
            if not job:
                self.send_json({"error": "Job not found"}, 404)
            else:
                self.send_json(job)
            return
        if path.startswith("/api/video/") or path.startswith("/api/download/"):
            filename = Path(path.split("/")[-1]).name
            file_path = OUTPUTS / filename
            if not file_path.exists() or not file_path.is_file():
                self.send_error(404, "Video not found")
                return
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(file_path.stat().st_size))
            self.send_header("Accept-Ranges", "bytes")
            if path.startswith("/api/download/"):
                self.send_header("Content-Disposition", f'attachment; filename="videonova-{filename}"')
            self.send_cors_headers()
            self.end_headers()
            with file_path.open("rb") as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            return

        if path == "/":
            path = "/index.html"
        candidate = (STATIC / path.lstrip("/")).resolve()
        if not str(candidate).startswith(str(STATIC.resolve())) or not candidate.exists() or not candidate.is_file():
            self.send_error(404)
            return
        mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        data = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/generate":
            try:
                payload = self.read_json()
                prompt = str(payload.get("prompt", "")).strip()
                if len(prompt) < 3:
                    raise ValueError("Prompt must contain at least 3 characters.")
                if len(prompt) > 4000:
                    raise ValueError("Prompt is too long (max 4000 characters).")
                provider = payload.get("provider", "hf")
                if provider not in ("hf", "comfyui"):
                    raise ValueError("Unsupported provider.")
                job_id = secrets.token_hex(10)
                set_job(
                    job_id,
                    status="queued",
                    progress=2,
                    message="Queued",
                    provider=provider,
                    prompt=prompt,
                    settings={
                        "aspect": payload.get("aspect", "16:9"),
                        "quality": payload.get("quality", "720p"),
                        "duration": payload.get("duration", 4),
                        "fps": payload.get("fps", 16),
                    },
                )
                target = run_hf if provider == "hf" else run_comfy
                threading.Thread(target=target, args=(job_id, payload), daemon=True).start()
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
            job = get_job(job_id)
            if not job:
                self.send_json({"error": "Job not found"}, 404)
                return
            set_job(job_id, status="cancelled", progress=0, message="Cancelled")
            self.send_json({"ok": True})
            return
        self.send_error(404)


if __name__ == "__main__":
    print(f"VideoNova running at http://{HOST}:{PORT}")
    print("Hugging Face:", "configured" if HF_TOKEN else "not configured")
    print("ComfyUI workflow:", COMFYUI_WORKFLOW if comfy_workflow_configured() else "not configured")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
