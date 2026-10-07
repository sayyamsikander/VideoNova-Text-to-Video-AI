const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SELFTEST_FALLBACK = SELFTEST_FALLBACK;

const state = {
  engineReady: false,
  runtimeFailed: false,
  compatReason: '',
  generating: false,
  compatRunning: false,
  history: [],
  latestDownloadUrl: '',
  latestFilename: '',
  currentPrompt: ''
};

const examples = [
  'A cinematic drone shot gliding over a futuristic coastal city at sunrise',
  'A friendly orange robot walking through a neon city at night',
  'A jellyfish moving gracefully through a glowing blue ocean',
  'A rocket launching into a dramatic sunset sky'
];

const styleHints = {
  cinematic: 'cinematic lighting, dramatic composition, smooth motion, coherent subject',
  anime: 'anime style, clean linework, vivid colors, expressive motion',
  photoreal: 'photorealistic, natural lighting, detailed textures, realistic movement',
  product: 'premium commercial lighting, clean composition, elegant motion',
  fantasy: 'fantasy atmosphere, magical light, rich detail, graceful motion'
};

function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = `#${name}View`;
  $(target)?.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'history') renderHistory();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

function showNotice(message, kind = 'info') {
  const el = $('#notice');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.remove('hidden');
}
function hideNotice() { $('#notice').classList.add('hidden'); }

function setStatus(text, tone = 'idle') {
  const el = $('#statusPill');
  el.textContent = text;
  el.className = `status ${tone}`;
}
function setProgress(percent, message) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  $('#progressBar').style.width = `${p}%`;
  $('#progressPercent').textContent = `${p}%`;
  if (message) $('#progressText').textContent = message;
}
function setGenerating(on) {
  state.generating = on;
  $('#generateBtn').disabled = on;
  $('#progressState').classList.toggle('hidden', !on);
  if (on) {
    $('#emptyState').classList.add('hidden');
    $('#video_container').classList.add('hidden');
    setStatus('Generating', 'running');
  }
}

function useCompatibilityMode(reason) {
  state.compatReason = reason || 'Browser AI is unavailable on this device.';
  $('#providerBadge').textContent = 'Universal mode ready';
  $('#providerBadge').style.color = '#9ce7c3';
  $('#statEngine').textContent = 'Universal browser';
  $('#generateBtn').disabled = false;
  if (!state.generating) {
    $('#progressState').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    setStatus('Ready', 'complete');
  }
  showNotice(
    `AI WebGPU mode is unavailable here, so VideoNova will use Universal mode. It still creates and downloads a prompt-driven animated video entirely in this website. Reason: ${state.compatReason}`,
    'warning'
  );
}

function checkBrowser() {
  if (!window.isSecureContext) {
    useCompatibilityMode('Secure HTTPS context is unavailable.');
    return;
  }
  if (!navigator.gpu) {
    useCompatibilityMode('WebGPU is unavailable in this browser/device.');
    return;
  }
  $('#providerBadge').textContent = 'Loading AI model…';
  $('#providerBadge').style.color = '#ffcf70';
  setProgress(4, 'Checking GPU and loading AI model files…');
}

function progressFromStatus(text) {
  const t = text.toLowerCase();
  if (t.includes('loading model')) return 8;
  if (t.includes('fetch') || t.includes('download')) return 18;
  if (t.includes('creating session')) return 34;
  if (t.includes('ready')) return 100;
  if (t.includes('phase 1')) return 12;
  if (t.includes('phase 2')) return 25;
  if (t.includes('phase 3')) return 38;
  if (t.includes('phase 4')) return 50;
  if (t.includes('phase 5')) return 60;
  if (t.includes('phase 6')) return 70;
  if (t.includes('phase 7')) return 80;
  if (t.includes('phase 8')) return 90;
  if (t.includes('phase 9')) return 97;
  if (t.includes('complete') || t.includes('done')) return 100;
  return state.generating ? 10 : 5;
}

function syncEngineStatus() {
  const text = ($('#status')?.innerText || '').trim();
  if (!text) return;
  const last = text.split('\n').filter(Boolean).at(-1) || text;

  if (!state.compatRunning) setProgress(progressFromStatus(text), last);

  if (/doesn't support webgpu\/f16|does not support webgpu\/f16/i.test(text)) {
    state.engineReady = false;
    useCompatibilityMode('The GPU does not support the shader-f16 feature required by the diffusion model.');
    return;
  }

  if (/\bready\./i.test(text) && !state.generating) {
    state.engineReady = true;
    state.runtimeFailed = false;
    state.compatReason = '';
    $('#generateBtn').disabled = false;
    $('#progressState').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    $('#providerBadge').textContent = 'AI WebGPU ready';
    $('#providerBadge').style.color = '#9ce7c3';
    $('#statEngine').textContent = 'WebGPU AI';
    setStatus('Ready', 'complete');
    hideNotice();
  }

  if (/generating/i.test(text) && !state.compatRunning) {
    setGenerating(true);
  }

  if (/complete!|\bdone\b/i.test(text) && state.generating && !state.compatRunning) {
    setGenerating(false);
    state.engineReady = true;
    $('#generateBtn').disabled = false;
    $('#progressState').classList.add('hidden');
    $('#video_container').classList.remove('hidden');
    setStatus('Ready', 'complete');
    setProgress(100, 'AI video animation ready');
    $('#downloadBtn').classList.remove('disabled');
    state.latestDownloadUrl = '';
    state.latestFilename = '';
    addHistory({ prompt: state.currentPrompt, createdAt: Date.now(), mode: 'AI WebGPU' });
    showNotice('AI video generated in your browser. Click Download Video to save it.', 'success');
  }

  if (/error|failed|exception|out of memory|oom/i.test(last) && !/no error/i.test(last)) {
    state.engineReady = false;
    if (state.generating && !state.compatRunning) {
      const prompt = state.currentPrompt;
      setGenerating(false);
      useCompatibilityMode(last);
      setTimeout(() => runCompatibilityVideo(prompt), 150);
    } else {
      useCompatibilityMode(last);
    }
  }
}

function initStatusObserver() {
  const statusEl = $('#status');
  if (!statusEl) return;
  const observer = new MutationObserver(syncEngineStatus);
  observer.observe(statusEl, { childList: true, subtree: true, characterData: true });
  syncEngineStatus();
}

window.addEventListener('videonova-engine-capability-error', event => {
  state.engineReady = false;
  useCompatibilityMode(event.detail || 'This browser/GPU cannot run the WebGPU AI model.');
});

window.addEventListener('videonova-engine-load-error', event => {
  state.engineReady = false;
  state.runtimeFailed = true;
  useCompatibilityMode(event.detail || 'The AI runtime could not be loaded.');
});

window.addEventListener('videonova-engine-script-loaded', () => {
  if (!state.compatReason) {
    $('#providerBadge').textContent = 'Loading AI model…';
    $('#providerBadge').style.color = '#ffcf70';
  }
});

setTimeout(() => {
  if (!state.engineReady && !state.generating && !state.compatReason) {
    useCompatibilityMode('The AI model is still loading. Universal mode is available immediately.');
  }
}, 30000);

$('#prompt').addEventListener('input', () => {
  $('#charCount').textContent = `${$('#prompt').value.length} / 4000`;
});
$('#randomPromptBtn').addEventListener('click', () => {
  $('#prompt').value = examples[Math.floor(Math.random() * examples.length)];
  $('#prompt').dispatchEvent(new Event('input'));
});
$('#copyPromptBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#prompt').value || '');
  const old = $('#copyPromptBtn').textContent;
  $('#copyPromptBtn').textContent = 'Copied';
  setTimeout(() => $('#copyPromptBtn').textContent = old, 1000);
});
$$('#stylePresets .chip').forEach(chip => chip.addEventListener('click', () => {
  $$('#stylePresets .chip').forEach(x => x.classList.remove('active'));
  chip.classList.add('active');
}));
$('#enhanceBtn').addEventListener('click', () => {
  const raw = $('#prompt').value.trim();
  if (!raw) {
    showNotice('Write a basic idea first, then enhance it.');
    return;
  }
  const style = $('#stylePresets .chip.active')?.dataset.style || 'cinematic';
  $('#prompt').value = `${raw.replace(/[.\s]+$/, '')}. ${styleHints[style]}. single coherent shot, temporal consistency, no abrupt cuts.`.slice(0, 4000);
  $('#prompt').dispatchEvent(new Event('input'));
  hideNotice();
});

function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seeded(seed) {
  let x = seed || 123456789;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}
function sceneType(prompt) {
  const p = prompt.toLowerCase();
  if (/ocean|sea|water|jellyfish|underwater|wave/.test(p)) return 'ocean';
  if (/city|street|neon|building|urban/.test(p)) return 'city';
  if (/space|rocket|moon|planet|star|galaxy/.test(p)) return 'space';
  if (/forest|tree|nature|jungle|fox/.test(p)) return 'forest';
  if (/fire|sunset|lava|flame/.test(p)) return 'fire';
  return 'abstract';
}

function drawFallbackFrame(ctx, canvas, prompt, elapsed, particles, type, baseHue) {
  const w = canvas.width, h = canvas.height;
  const t = elapsed / 1000;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${(baseHue + t * 8) % 360} 72% 20%)`);
  grad.addColorStop(0.5, `hsl(${(baseHue + 55 + t * 5) % 360} 66% 12%)`);
  grad.addColorStop(1, `hsl(${(baseHue + 120) % 360} 65% 8%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (type === 'city') {
    ctx.fillStyle = 'rgba(5,8,18,.85)';
    for (let i = 0; i < 18; i++) {
      const bw = 18 + (i % 5) * 5;
      const bh = 80 + ((i * 37) % 220);
      const x = i * 31 - ((t * 12) % 31);
      ctx.fillRect(x, h - bh, bw, bh);
      ctx.fillStyle = `hsla(${(baseHue + i * 17) % 360} 90% 65% / .7)`;
      for (let y = h - bh + 14; y < h - 10; y += 22) ctx.fillRect(x + 6, y, 4, 8);
      ctx.fillStyle = 'rgba(5,8,18,.85)';
    }
  } else if (type === 'ocean') {
    for (let layer = 0; layer < 5; layer++) {
      ctx.beginPath();
      const y0 = h * .48 + layer * 34;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 12) {
        ctx.lineTo(x, y0 + Math.sin(x * .024 + t * (1.2 + layer * .2)) * (12 + layer * 2));
      }
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = `hsla(${190 + layer * 8} 75% ${24 + layer * 5}% / .36)`;
      ctx.fill();
    }
  } else if (type === 'forest') {
    for (let i = 0; i < 24; i++) {
      const x = (i * 29 + Math.sin(t + i) * 5) % (w + 20) - 10;
      const height = 100 + (i * 31) % 220;
      ctx.fillStyle = `hsla(${110 + (i % 4) * 12} 55% 18% / .75)`;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 20, h - height);
      ctx.lineTo(x + 40, h);
      ctx.fill();
    }
  } else if (type === 'space') {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(t * .035);
    ctx.translate(-w / 2, -h / 2);
    for (let i = 0; i < 110; i++) {
      const x = (i * 73) % w;
      const y = (i * 151) % h;
      const s = 1 + (i % 3);
      ctx.fillStyle = `rgba(255,255,255,${.3 + (i % 7) / 10})`;
      ctx.fillRect(x, y, s, s);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(245,245,255,.9)';
    ctx.beginPath();
    ctx.arc(w * .74, h * .28, 52 + Math.sin(t) * 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'fire') {
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `hsla(${20 + i * 5} 95% ${45 + i * 3}% / .18)`;
      ctx.beginPath();
      ctx.arc(w * .5 + Math.sin(t * 1.4 + i) * 120, h * .62 - i * 14, 120 - i * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 12; i++) {
      const r = 30 + i * 14 + Math.sin(t * 1.5 + i) * 8;
      ctx.strokeStyle = `hsla(${(baseHue + i * 22) % 360} 85% 68% / .22)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.sin(t * .8 + i) * 70, h / 2 + Math.cos(t * .7 + i) * 70, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
    if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;
    ctx.fillStyle = `hsla(${(baseHue + p.h) % 360} 95% 75% / ${p.a})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }

  ctx.save();
  const zoom = 1 + Math.sin(t * .7) * .012;
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-w / 2, -h / 2);
  ctx.restore();

  const vignette = ctx.createRadialGradient(w/2,h/2,w*.18,w/2,h/2,w*.72);
  vignette.addColorStop(0,'rgba(0,0,0,0)');
  vignette.addColorStop(1,'rgba(0,0,0,.48)');
  ctx.fillStyle=vignette; ctx.fillRect(0,0,w,h);

  ctx.fillStyle='rgba(255,255,255,.9)';
  ctx.font='600 20px system-ui, sans-serif';
  ctx.textAlign='center';
  const caption = prompt.length > 58 ? prompt.slice(0,55) + '…' : prompt;
  ctx.fillText(caption, w/2, h-28);
}

async function runCompatibilityVideo(prompt) {
  if (state.compatRunning) return;
  state.compatRunning = true;
  state.currentPrompt = prompt;
  setGenerating(true);
  $('#progressTitle').textContent = 'Creating universal browser video…';
  $('#statEngine').textContent = 'Universal browser';
  setProgress(3, 'Preparing animated scene…');

  const container = $('#video_container');
  container.innerHTML = '';
  container.classList.remove('hidden');

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  canvas.style.maxWidth = '100%';
  canvas.style.borderRadius = '12px';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const seed = hashText(prompt);
  const rand = seeded(seed);
  const baseHue = seed % 360;
  const type = sceneType(prompt);
  const particles = Array.from({length: 48}, () => ({
    x: rand()*512, y: rand()*512,
    vx: (rand()-.5)*1.6, vy: (rand()-.5)*1.2,
    r: 1+rand()*4, a:.18+rand()*.62, h: rand()*120
  }));

  if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
    state.compatRunning = false;
    setGenerating(false);
    setStatus('Preview only','error');
    showNotice('This browser cannot record canvas video. Use current Chrome or Edge.', 'error');
    return;
  }

  const mimeCandidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  const mime = mimeCandidates.find(x => MediaRecorder.isTypeSupported(x)) || '';
  const stream = canvas.captureStream(24);
  let recorder;
  try {
    recorder = new MediaRecorder(stream, mime ? {mimeType:mime, videoBitsPerSecond:3_000_000} : undefined);
  } catch (e) {
    state.compatRunning = false;
    setGenerating(false);
    showNotice('Video recorder could not start in this browser: ' + e.message, 'error');
    return;
  }

  const chunks = [];
  recorder.addEventListener('dataavailable', e => { if (e.data && e.data.size) chunks.push(e.data); });
  const done = new Promise((resolve, reject) => {
    recorder.addEventListener('stop', resolve, {once:true});
    recorder.addEventListener('error', e => reject(e.error || new Error('MediaRecorder failed')), {once:true});
  });

  recorder.start(250);
  const duration = 4200;
  const started = performance.now();

  await new Promise(resolve => {
    const frame = now => {
      const elapsed = now - started;
      drawFallbackFrame(ctx, canvas, prompt, elapsed, particles, type, baseHue);
      setProgress(8 + (elapsed / duration) * 84, 'Rendering prompt-driven animation…');
      if (elapsed < duration) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });

  recorder.stop();
  try {
    await done;
  } catch (e) {
    state.compatRunning = false;
    setGenerating(false);
    showNotice('Video recording failed: ' + e.message, 'error');
    return;
  }
  stream.getTracks().forEach(t => t.stop());

  const blob = new Blob(chunks, {type: mime || 'video/webm'});
  if (!blob.size) {
    state.compatRunning = false;
    setGenerating(false);
    showNotice('The browser produced an empty video recording.', 'error');
    return;
  }

  if (state.latestDownloadUrl) {
    try { URL.revokeObjectURL(state.latestDownloadUrl); } catch {}
  }
  const url = URL.createObjectURL(blob);
  state.latestDownloadUrl = url;
  state.latestFilename = `videonova-${Date.now()}.webm`;

  container.innerHTML = '';
  const video = document.createElement('video');
  video.src = url;
  video.controls = true;
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  container.appendChild(video);

  state.compatRunning = false;
  setGenerating(false);
  $('#progressState').classList.add('hidden');
  $('#video_container').classList.remove('hidden');
  $('#downloadBtn').classList.remove('disabled');
  setProgress(100, 'Video ready');
  setStatus('Ready', 'complete');
  addHistory({prompt, createdAt: Date.now(), mode: 'Universal mode'});
  showNotice('Video created successfully in Universal mode. Click Download Video to save it.', 'success');
  if (SELFTEST_FALLBACK) {
    document.documentElement.dataset.videonovaSelftest = blob.size > 1000 ? 'pass' : 'fail';
    document.documentElement.dataset.videonovaBlobSize = String(blob.size);
  }
}

$('#generateBtn').addEventListener('click', () => {
  hideNotice();
  const prompt = $('#prompt').value.trim();
  if (prompt.length < 3) {
    showNotice('Please enter a text prompt.');
    return;
  }
  state.currentPrompt = prompt;
  state.latestDownloadUrl = '';
  state.latestFilename = '';
  $('#downloadBtn').classList.add('disabled');

  if (state.engineReady) {
    const hiddenInput = $('#user-input');
    const hiddenButton = $('#send-button');
    if (hiddenInput && hiddenButton) {
      hiddenInput.value = prompt;
      setGenerating(true);
      $('#progressTitle').textContent = 'Generating with WebGPU AI…';
      setProgress(2, 'Starting Text-to-Video Zero…');
      hiddenButton.click();
      return;
    }
  }
  runCompatibilityVideo(prompt);
});

$('#downloadBtn').addEventListener('click', () => {
  if (state.latestDownloadUrl) {
    const a = document.createElement('a');
    a.href = state.latestDownloadUrl;
    a.download = state.latestFilename || 'videonova.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const native = $('#download_webm_btn');
  if (native) native.click();
  else showNotice('Generate a video first.', 'warning');
});

function escapeHtml(value='') {
  return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
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
  grid.innerHTML = state.history.map((item,index) => `
    <article class="panel history-card">
      <p>${escapeHtml(item.prompt)}</p>
      <div class="history-meta"><span>${escapeHtml(item.mode || 'Browser')}</span><span>${new Date(item.createdAt).toLocaleString()}</span></div>
      <div class="history-actions"><button class="secondary reuse" data-index="${index}">Reuse prompt</button></div>
    </article>`).join('');
  $$('.reuse').forEach(btn => btn.addEventListener('click', () => {
    const item = state.history[Number(btn.dataset.index)];
    if (!item) return;
    $('#prompt').value = item.prompt;
    $('#prompt').dispatchEvent(new Event('input'));
    showView('create');
  }));
}
$('#clearHistoryBtn').addEventListener('click', () => {
  state.history = [];
  renderHistory();
});

checkBrowser();
initStatusObserver();
renderHistory();

if (SELFTEST_FALLBACK) {
  document.documentElement.dataset.videonovaSelftest = 'running';
  state.engineReady = false;
  state.runtimeFailed = true;
  state.compatReason = 'Automated compatibility test';
  $('#prompt').value = 'A glowing sphere moving through a star field';
  $('#prompt').dispatchEvent(new Event('input'));
  setTimeout(() => $('#generateBtn').click(), 250);
}
