# VideoNova — Text-to-Video AI Website

A complete, responsive text-to-video web app starter with:

- Text prompt + negative prompt
- Prompt enhancer and style presets
- Hugging Face Inference Providers integration
- Local ComfyUI integration
- Model selector
- Aspect ratios: 16:9, 9:16, 1:1
- Duration, FPS, quality, seed, steps and guidance controls
- Generation progress + cancellation
- Video preview
- Direct video download
- Local browser generation history
- Responsive desktop/mobile UI
- Server-side secrets (tokens are not exposed to the browser)

## GitHub Pages — working static mode

The published GitHub Pages frontend can generate video directly from the browser:

1. Open the site and choose **Setup**.
2. Paste a Hugging Face token that has **Inference Providers** permission.
3. Click **Use token**.
4. Return to **Create**, enter a prompt, and generate.

The token is kept in `sessionStorage` for the current browser tab only; it is not committed to GitHub. This is suitable for personal testing. For a public production app, use the Python backend/proxy so a personal token is not exposed to browser JavaScript.

Live site: `https://sayyamsikander.github.io/VideoNova-Text-to-Video-AI/`

## Option 1 — Online generation with Hugging Face

Requirements: Python 3.10+.

```bash
python -m pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` and add your token:

```env
HF_TOKEN=hf_your_token_here
HF_PROVIDER=fal-ai
```

Then run:

```bash
./start.sh
```

On Windows, set the environment variables in your shell/system and run `start.bat`, or run `python server.py`.

Open: `http://127.0.0.1:8080`

The default model list includes:

- `Wan-AI/Wan2.2-TI2V-5B`
- `tencent/HunyuanVideo`
- `Lightricks/LTX-Video-0.9.8-13B-distilled`

Provider/model availability can change. If a chosen provider does not support a particular model, switch the model or the `HF_PROVIDER` value.

## Option 2 — Local generation with ComfyUI

This avoids per-request API charges, but you need hardware capable of running the selected video model.

1. Install and start ComfyUI, normally on `http://127.0.0.1:8188`.
2. Load a text-to-video workflow (for example a Wan workflow from ComfyUI's Video templates).
3. Export/save the workflow in **API format**.
4. Replace values in the API JSON that you want the website to control with these exact placeholders:

```text
__PROMPT__
__NEGATIVE_PROMPT__
__SEED__
__WIDTH__
__HEIGHT__
__FRAMES__
__FPS__
```

5. Save the result as `config/comfyui_api_workflow.json`.
6. Make sure the workflow saves the finished video file (MP4 or WebM). The site detects the saved video from ComfyUI history and makes it downloadable.

Example `.env`:

```env
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW=./config/comfyui_api_workflow.json
```

## Security notes

- Never put API keys in `static/app.js` or any browser-visible file.
- Keep `HF_TOKEN` only in the environment on the server.
- The included server binds to `127.0.0.1` by default. If you expose it publicly, add authentication, HTTPS, rate limiting, persistent job storage, abuse controls, and a reverse proxy.

## Production upgrades you may add

- User login/accounts
- Database-backed history
- Credits/billing
- Queue workers (Celery/RQ/Redis)
- Object storage (S3/R2)
- WebSocket progress
- Moderation and upload scanning
- Admin dashboard
- Multiple provider adapters
- CDN delivery

## Important cost note

The website code is free. Hosted video generation is compute-heavy and generally costs money after free credits are used. The truly no-API-cost route is local/open-source generation through ComfyUI on your own GPU.
