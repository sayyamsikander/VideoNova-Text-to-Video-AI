# VideoNova — Browser Text-to-Video AI

VideoNova is a **static GitHub Pages text-to-video app**. It runs AI generation in the visitor's browser using WebGPU/WebNN and creates an MP4 with WebCodecs.

**No account. No API key. No Python. No backend. No local install.**

## Live site

https://sayyamsikander.github.io/VideoNova-Text-to-Video-AI/

## How it works

1. Open the GitHub Pages website.
2. Enter a text prompt.
3. Click **Generate video**.
4. On first use, the browser automatically downloads the public model files and caches them.
5. Diffusion generation runs on the visitor's own compatible GPU.
6. Frames are encoded to MP4 in the browser.
7. Preview or download the video.

There is no VideoNova generation server and there are no user credentials.

## Browser AI engine

The site uses the MIT-licensed `@seanhogg/builderforce-studio` browser video engine. VideoNova calls it with:

- `apiKey: ''`
- `weightSources: ['huggingface-cdn']`
- `skipPromptExpansion: true`

This disables the engine's optional hosted prompt-expansion path and loads public model weights anonymously.

The default model is the browser-friendly `lcm-tiny-sd` profile. The engine generates temporally coherent frames in-browser and muxes them into an MP4.

## Requirements

A visitor does not need to install anything, but their browser/device must be capable of running browser AI:

- HTTPS (GitHub Pages already provides it)
- Recent Chrome or Edge recommended
- WebGPU-capable GPU and enabled hardware acceleration
- WebCodecs support for MP4 output
- Sufficient browser/GPU memory
- Internet connection for the first model download

The first generation is slower because the model must download and initialize. Model files are cached by the browser for later use when storage is available.

## Privacy

The prompt is used by the model running in the browser. VideoNova has no backend that receives prompts or videos.

Public model/runtime files are downloaded from their public distribution locations. No account or API key is required.

## Features

- Text-to-video generation
- Browser WebGPU/WebNN execution
- MP4 output
- 16:9, 9:16 and 1:1
- Duration and FPS controls
- Negative prompt
- Seed
- Steps and guidance
- Prompt style presets
- Live progress
- Cancel generation
- Video preview
- MP4 download
- Session history
- Responsive GitHub Pages UI

## Important limitation

GitHub Pages itself supplies only the static HTML/CSS/JavaScript. The heavy AI computation happens on the visitor's GPU through WebGPU. Older browsers, low-memory devices, and some phones may not be able to generate video.

## Credits and licenses

- VideoNova UI/source: MIT
- Browser video engine: `@seanhogg/builderforce-studio`, MIT
- ONNX Runtime Web / Transformers.js and model assets retain their own licenses
- The public model files are downloaded at runtime and are not copied into this Git repository
