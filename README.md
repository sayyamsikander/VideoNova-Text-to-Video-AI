# VideoNova — Browser Text-to-Video AI

VideoNova is a GitHub Pages text-to-video website that runs generation in the visitor's browser with WebGPU.

**No account. No API key. No Python. No backend. No install.**

## Live site

https://sayyamsikander.github.io/VideoNova-Text-to-Video-AI/

## Current browser engine

VideoNova uses the WebGPU Text-to-Video Zero implementation from:

- WebGPU-Video-Diffusion/WebGPU-Video-Diffusion
- Stable Diffusion 1.5 ONNX
- Text-to-Video Zero
- ONNX Runtime WebGPU
- Transformers.js tokenizer

The engine produces 8 temporally linked 512×512 frames and animates them in the browser. The generated animation can be downloaded as WebM or as individual frames.

## How it works

1. Open the GitHub Pages site.
2. VideoNova checks for WebGPU.
3. The browser runtime loads.
4. Public model files download automatically.
5. When the model reports **Ready**, the Generate button becomes enabled.
6. Enter a prompt and click **Generate video**.
7. The browser GPU runs Text-to-Video Zero.
8. Preview the animation and click **Download WebM**.

No user account or API key is requested.

## Browser requirements

The current model path requires:

- HTTPS
- Recent Chrome or Edge
- WebGPU
- GPU support for the `shader-f16` WebGPU feature
- Hardware acceleration enabled
- Enough GPU/system memory for Stable Diffusion ONNX weights

If the GPU does not support WebGPU/F16, the site now shows that exact error instead of incorrectly saying there is an internet problem.

## First load

The first load is large. Stable Diffusion model files and the ONNX WebGPU runtime are downloaded from public hosting. Initial model loading can take several minutes depending on network speed and hardware.

## Important implementation detail

The previous VideoNova version used a generic ESM import of `@seanhogg/builderforce-studio`. That package has external/workspace dependencies that a generic browser CDN cannot reliably resolve, which caused a misleading "internet connection" error.

That dependency has been removed.

VideoNova now loads the already-built WebGPU Text-to-Video Zero browser runtime from its working GitHub Pages deployment and uses a pinned Transformers.js 2.17.2 tokenizer import.

## Privacy

VideoNova has no generation backend. The prompt is used by browser-side model code. Public runtime/model files still need to be downloaded from the internet.

## Limitations

This is real browser-side diffusion and is computationally heavy. The upstream implementation reports roughly 8–10 minutes for 8 frames on an RTX 5070 Ti laptop, with performance varying substantially by GPU.

Phones, older integrated GPUs, browsers without WebGPU, and GPUs without `shader-f16` may not be able to run it.

## Credits

Browser Text-to-Video Zero runtime:
https://github.com/WebGPU-Video-Diffusion/WebGPU-Video-Diffusion

Transformers.js:
https://github.com/huggingface/transformers.js

VideoNova UI/source is maintained in this repository.
