const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const ENGINE_IMPORT = 'https://esm.sh/@seanhogg/builderforce-studio@2026.10.1?bundle';
const MODEL = 'lcm-tiny-sd';

const state = {
  module: null,
  engine: null,
  engineKey: '',
  activeDevice: '',
  currentAbort: null,
  currentObjectUrl: null,
  history: []
};

const examples = [
  'A cinematic drone shot gliding over a futuristic coastal city at sunrise, soft fog between glass towers, realistic reflections, smooth camera motion.',
  'A friendly orange robot walking through a neon city at night, reflections on wet pavement, cinematic tracking shot, detailed sci-fi atmosphere.',
  'A luxury perfume bottle on black marble, warm studio reflections, slow elegant product camera movement, premium commercial lighting.',
  'A watercolor fox running through an enchanted forest at dusk, glowing fireflies, flowing brush textures, dreamlike motion.'
];

const styleHints = {
  cinematic: 'cinematic composition, natural motion, dramatic lighting, realistic depth, coherent subject, smooth camera movement',
  anime: 'high-quality anime aesthetic, clean linework, vibrant cel shading, expressive motion, coherent subject',
  photoreal: 'photorealistic, physically plausible motion, detailed textures, natural lighting, realistic reflections',
  product: 'premium product commercial, crisp details, controlled studio lighting, elegant camera motion, clean composition',
  fantasy: 'epic fantasy atmosphere, magical particles, rich environment, dramatic light, graceful cinematic movement'
};

function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $(`#${name}View`);
  if (target) target.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'history') renderHistory();
}

$$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

function showNotice(message, kind='info') {
  const el = $('#notice');
  el.textContent = message;
  el.classList.remove('hidden');
  el.dataset.kind = kind;
}
function hideNotice() { $('#notice').classList.add('hidden'); }

function aspectSize() {
  const aspect = $('#aspect').value;
  if (aspect === '9:16') return { width: 288, height: 512 };
  if (aspect === '1:1') return { width: 512, height: 512 };
  return { width: 512, height: 288 };
}

function frameCount() {
  const duration = Number($('#duration').value);
  const fps = Number($('#fps').value);
  return Math.min(24, Math.max(8, Math.round(duration * fps)));
}

function updatePreviewRatio() {
  const stage = $('#previewStage');
  stage.classList.remove('ratio-16-9', 'ratio-9-16', 'ratio-1-1');
  stage.classList.add($('#aspect').value === '9:16' ? 'ratio-9-16' : $('#aspect').value === '1:1' ? 'ratio-1-1' : 'ratio-16-9');
}
$('#aspect').addEventListener('change', updatePreviewRatio);

function setStatus(text, tone='idle') {
  const pill = $('#statusPill');
  pill.textContent = text;
  pill.className = `status ${tone}`;
}

function setProgress(percent, message) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  $('#progressBar').style.width = `${p}%`;
  $('#progressPercent').textContent = `${p}%`;
  if (message) $('#progressText').textContent = message;
}

function setGenerating(on) {
  $('#generateBtn').disabled = on;
  $('#cancelBtn').classList.toggle('hidden', !on);
  $('#emptyState').classList.toggle('hidden', on);
  $('#video').classList.add('hidden');
  $('#progressState').classList.toggle('hidden', !on);
  if (on) setStatus('Generating', 'running');
}

function mapProgressLabel(label) {
  const text = String(label || '');
  const l = text.toLowerCase();
  let p = 8;
  if (l.includes('probing')) p = 5;
  else if (l.includes('hardware ready')) p = 8;
  else if (l.includes('tokenizer')) p = 14;
  else if (l.includes('text-encoder') || l.includes('text encoder')) p = 24;
  else if (l.includes('unet')) p = 42;
  else if (l.includes('vae')) p = 58;
  else if (l.includes('encoding prompt')) p = 62;
  else if (l.includes('denoise step')) p = 72;
  else if (l.includes('frame')) p = 78;
  else if (l.includes('encoding') && l.includes('mp4')) p = 94;
  else if (l.includes('mp4 ready')) p = 100;
  setProgress(p, text);
}

async function detectBrowser() {
  const webgpu = !!navigator.gpu;
  const webcodecs = typeof VideoEncoder !== 'undefined';
  const secure = window.isSecureContext;
  const badge = $('#providerBadge');

  if (!secure) {
    badge.textContent = 'HTTPS required';
    badge.style.color = '#ff9ba5';
    $('#generateBtn').disabled = true;
    showNotice('This browser AI needs a secure HTTPS page. GitHub Pages already provides HTTPS.', 'error');
    return;
  }

  if (!webgpu) {
    badge.textContent = 'WebGPU unavailable';
    badge.style.color = '#ff9ba5';
    $('#generateBtn').disabled = true;
    showNotice('Your browser does not expose WebGPU. Use a recent Chrome or Edge browser with hardware acceleration enabled.', 'error');
    return;
  }

  if (!webcodecs) {
    badge.textContent = 'WebCodecs unavailable';
    badge.style.color = '#ffcf70';
    showNotice('Your browser has WebGPU but not the required video encoder. A recent Chrome or Edge build is recommended.', 'warning');
  } else {
    badge.textContent = 'Browser AI ready';
    badge.style.color = '#9ce7c3';
  }
  $('#generateBtn').disabled = false;
}

async function loadModule() {
  if (state.module) return state.module;
  setProgress(3, 'Loading browser AI runtime…');
  try {
    state.module = await import(ENGINE_IMPORT);
    return state.module;
  } catch (error) {
    throw new Error('Could not load the browser AI runtime. Check your internet connection and reload the page.');
  }
}

async function ensureEngine() {
  const { width, height } = aspectSize();
  const key = `${MODEL}:${width}x${height}`;
  if (state.engine && state.engineKey === key) return state.engine;

  if (state.engine) {
    try { await state.engine.dispose(); } catch {}
    state.engine = null;
  }

  const { VideoEngine } = await loadModule();
  setProgress(5, 'Preparing WebGPU and downloading model files when needed…');

  const engine = await VideoEngine.create({
    apiKey: '',
    model: MODEL,
    device: 'auto',
    weightSources: ['huggingface-cdn'],
    width,
    height,
    onProgress: mapProgressLabel
  });

  if (!engine) {
    throw new Error('No compatible browser AI device was found. Use Chrome/Edge with WebGPU and enough GPU memory.');
  }

  state.engine = engine;
  state.engineKey = key;
  state.activeDevice = engine.activeDevice || 'browser GPU';
  $('#providerBadge').textContent = `Ready · ${state.activeDevice}`;
  $('#providerBadge').style.color = '#9ce7c3';
  $('#statEngine').textContent = state.activeDevice;
  $('#statModel').textContent = 'LCM Tiny SD';
  return engine;
}

$('#prompt').addEventListener('input', () => {
  $('#charCount').textContent = `${$('#prompt').value.length} / 4000`;
});

$('#randomPromptBtn').addEventListener('click', () => {
  $('#prompt').value = examples[Math.floor(Math.random() * examples.length)];
  $('#prompt').dispatchEvent(new Event('input'));
});

$('#seedBtn').addEventListener('click', () => {
  $('#seed').value = Math.floor(Math.random() * 2147483647);
});

$('#copyPromptBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#prompt').value || '');
  const old = $('#copyPromptBtn').textContent;
  $('#copyPromptBtn').textContent = 'Copied';
  setTimeout(() => $('#copyPromptBtn').textContent = old, 1000);
});

$$('#stylePresets .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('#stylePresets .chip').forEach(x => x.classList.remove('active'));
    chip.classList.add('active');
  });
});

$('#enhanceBtn').addEventListener('click', () => {
  const raw = $('#prompt').value.trim();
  if (!raw) {
    showNotice('Write a basic idea first, then enhance it.');
    return;
  }
  const style = $('#stylePresets .chip.active')?.dataset.style || 'cinematic';
  $('#prompt').value = `${raw.replace(/[.\s]+$/, '')}. ${styleHints[style]}. Single coherent shot, consistent appearance, smooth temporal motion, no abrupt cuts.`.slice(0, 4000);
  $('#prompt').dispatchEvent(new Event('input'));
  hideNotice();
});

function addHistory(item) {
  state.history.unshift(item);
  state.history = state.history.slice(0, 12);
  renderHistory();
}

function renderHistory() {
  const grid = $('#historyGrid');
  if (!state.history.length) {
    grid.innerHTML = '<div class="history-empty">No videos generated in this browser session yet.</div>';
    return;
  }

  grid.innerHTML = state.history.map((item, idx) => `
    <article class="panel history-card">
      <div class="history-thumb"><video src="${item.url}" muted preload="metadata" controls></video></div>
      <p>${escapeHtml(item.prompt)}</p>
      <div class="history-meta"><span>Browser AI</span><span>${item.frames} frames · ${item.fps} fps</span></div>
      <div class="history-actions">
        <a class="primary" href="${item.url}" download="${item.filename}">Download</a>
        <button class="secondary reuse" data-index="${idx}">Reuse</button>
      </div>
    </article>`).join('');

  $$('.reuse').forEach(btn => btn.addEventListener('click', () => {
    const item = state.history[Number(btn.dataset.index)];
    if (!item) return;
    $('#prompt').value = item.prompt;
    $('#prompt').dispatchEvent(new Event('input'));
    showView('create');
  }));
}

function escapeHtml(value='') {
  return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

$('#clearHistoryBtn').addEventListener('click', () => {
  for (const item of state.history) {
    try { URL.revokeObjectURL(item.url); } catch {}
  }
  state.history = [];
  renderHistory();
});

$('#cancelBtn').addEventListener('click', () => {
  if (state.currentAbort) {
    state.currentAbort.abort();
    state.currentAbort = null;
    setGenerating(false);
    $('#progressState').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    setStatus('Cancelled', 'idle');
    showNotice('Generation cancelled.');
  }
});

$('#generateBtn').addEventListener('click', async () => {
  hideNotice();
  const prompt = $('#prompt').value.trim();
  if (prompt.length < 3) {
    showNotice('Please enter a text prompt.');
    return;
  }

  const fps = Number($('#fps').value);
  const frames = frameCount();
  const seed = $('#seed').value ? Number($('#seed').value) : Math.floor(Math.random() * 2147483647);
  const steps = Number($('#steps').value);
  const guidance = Number($('#guidance').value);
  const negativePrompt = $('#negativePrompt').value.trim();

  state.currentAbort = new AbortController();
  setGenerating(true);
  setProgress(1, 'Starting browser AI…');
  $('#progressTitle').textContent = 'Generating entirely in your browser…';
  $('#statSeed').textContent = seed;
  $('#statModel').textContent = 'LCM Tiny SD';

  try {
    const engine = await ensureEngine();
    let completedFrames = 0;

    const result = await engine.generate({
      prompt,
      skipPromptExpansion: true,
      negativePrompt: negativePrompt || undefined,
      frames,
      fps,
      steps,
      guidance,
      seed,
      coherence: 'prompt-bias',
      coherenceStrength: 0.58,
      motionAmount: 0.18,
      imgToImgStrength: 0.5,
      anchorRefreshInterval: 8,
      interpolationFactor: 1,
      onProgress: mapProgressLabel,
      onFrame: (index) => {
        completedFrames = Math.max(completedFrames, index + 1);
        const base = 65;
        const spread = 27;
        setProgress(base + (completedFrames / frames) * spread, `Generated frame ${completedFrames}/${frames}`);
      },
      signal: state.currentAbort.signal
    });

    state.currentAbort = null;
    if (state.currentObjectUrl) {
      try { URL.revokeObjectURL(state.currentObjectUrl); } catch {}
    }

    const url = URL.createObjectURL(result.blob);
    state.currentObjectUrl = url;

    setGenerating(false);
    $('#progressState').classList.add('hidden');
    $('#video').src = url;
    $('#video').classList.remove('hidden');
    $('#video').load();

    const filename = `videonova-${Date.now()}.mp4`;
    $('#downloadBtn').href = url;
    $('#downloadBtn').download = filename;
    $('#downloadBtn').classList.remove('disabled');

    $('#statEngine').textContent = result.activeDevice || state.activeDevice || 'browser GPU';
    $('#statSeed').textContent = seed;
    setProgress(100, 'MP4 ready');
    setStatus('Ready', 'complete');

    addHistory({ prompt, url, filename, frames, fps, seed, createdAt: Date.now() });
    showNotice('Video generated locally in your browser. No account, API key, or backend was used.', 'success');
  } catch (error) {
    state.currentAbort = null;
    setGenerating(false);
    $('#progressState').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    setStatus('Error', 'error');

    const message = String(error?.message || error);
    if (/abort/i.test(message)) {
      showNotice('Generation cancelled.');
    } else if (/memory|out of memory|buffer|allocation/i.test(message)) {
      showNotice('Your browser/GPU ran out of memory. Close other GPU-heavy tabs, use 16:9 or 1:1, and try fewer frames.', 'error');
    } else {
      showNotice(message, 'error');
    }
  }
});

detectBrowser();
renderHistory();
