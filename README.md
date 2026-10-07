# VideoNova — Self-Hosted Text-to-Video AI

VideoNova is a self-hosted text-to-video website. Generation runs on your own GPU with the open-source Wan 2.1 1.3B model.

**No API key. No hosted inference account. No Hugging Face login. No ComfyUI connection.**

## What is included

- Text-to-video generation on your own hardware
- Prompt and negative prompt
- Cinematic / anime / photoreal / product / fantasy prompt presets
- 16:9, 9:16 and 1:1 output
- 480p, 720p and 1080p controls
- Duration, FPS, seed, steps and guidance controls
- Generation status
- Video preview
- MP4 download
- Local browser history
- Responsive UI
- Automatic anonymous download of the public model on first use
- Manual model downloader for offline reuse

## Requirements

- Python 3.10+
- A supported GPU
- NVIDIA CUDA is recommended
- Apple Silicon / MPS can be attempted
- About 11GB+ VRAM is the practical target for the default Wan 2.1 1.3B model
- Enough disk space for the model files and generated videos

CPU-only video generation is intentionally disabled because it is not practical for this model.

## Fast start

### Windows

```bat
start.bat
```

### Linux / macOS

```bash
bash start.sh
```

Then open:

```text
http://127.0.0.1:8080
```

The first generation can automatically download the public model anonymously. No account or token is used.

## Download the model before starting

If you prefer to download it once before using the website:

```bash
python -m pip install -r requirements.txt
python download_model.py
python server.py
```

The model is stored at:

```text
models/Wan2.1-T2V-1.3B-Diffusers/
```

The `models/` folder is ignored by Git so the large weights are not uploaded to your repository.

## Configuration

Copy the example environment file if you want custom settings:

```bash
cp .env.example .env
```

Default configuration:

```env
HOST=127.0.0.1
PORT=8080
VIDEONOVA_MODEL_ID=Wan-AI/Wan2.1-T2V-1.3B-Diffusers
VIDEONOVA_MODEL_PATH=./models/Wan2.1-T2V-1.3B-Diffusers
VIDEONOVA_AUTO_DOWNLOAD=true
VIDEONOVA_DEVICE=
```

Set `VIDEONOVA_DEVICE=cuda` or `mps` only if automatic detection does not choose correctly.

## GitHub Pages

The GitHub Pages URL is a **static preview only**. GitHub Pages cannot run Python or provide the GPU compute required by a video diffusion model.

For the real generator, run this repository on your own GPU computer and use `http://127.0.0.1:8080`.

If you own a public GPU server, you can run the same repository there under your own domain. No external inference account is required.

## Privacy

Prompts and generated videos are handled by your local VideoNova process. Generated MP4 files are written to `outputs/`. The repository ignores model weights, generated outputs, virtual environments and `.env` files.

## Default AI model

The default model is `Wan-AI/Wan2.1-T2V-1.3B-Diffusers` using Diffusers' `WanPipeline`. It is downloaded anonymously as a public model and then loaded from local files for generation.

## License

VideoNova source code is provided under the MIT license in this repository. The included/default AI model has its own upstream license; review the model's license before redistribution or commercial deployment.
