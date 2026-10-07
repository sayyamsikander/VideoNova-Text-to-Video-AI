const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  engineReady: false,
  generating: false,
  history: []
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

function showView(name){
  $$('.view').forEach(v=>v.classList.remove('active'));
  const target=$(`#${name}View`);
  if(target) target.classList.add('active');
  $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  if(name==='history') renderHistory();
}
$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));

function showNotice(message, kind='info'){
  const el=$('#notice');
  el.textContent=message;
  el.dataset.kind=kind;
  el.classList.remove('hidden');
}
function hideNotice(){$('#notice').classList.add('hidden')}

function setStatus(text,tone='idle'){
  const el=$('#statusPill');
  el.textContent=text;
  el.className=`status ${tone}`;
}

function setProgress(percent,message){
  const p=Math.max(0,Math.min(100,Math.round(percent)));
  $('#progressBar').style.width=`${p}%`;
  $('#progressPercent').textContent=`${p}%`;
  if(message) $('#progressText').textContent=message;
}

function setGenerating(on){
  state.generating=on;
  $('#generateBtn').disabled=on || !state.engineReady;
  $('#progressState').classList.toggle('hidden',!on);
  if(on){
    $('#emptyState').classList.add('hidden');
    $('#video_container').classList.add('hidden');
    setStatus('Generating','running');
  }
}

function checkBrowser(){
  if(!window.isSecureContext){
    $('#providerBadge').textContent='HTTPS required';
    $('#providerBadge').style.color='#ff9ba5';
    $('#generateBtn').disabled=true;
    showNotice('This browser AI requires HTTPS. Open the GitHub Pages URL, not a downloaded HTML file.','error');
    return false;
  }
  if(!navigator.gpu){
    $('#providerBadge').textContent='WebGPU unavailable';
    $('#providerBadge').style.color='#ff9ba5';
    $('#generateBtn').disabled=true;
    showNotice('WebGPU is not available in this browser. Use current Chrome or Edge with hardware acceleration enabled.','error');
    return false;
  }
  $('#providerBadge').textContent='Loading browser AI…';
  $('#providerBadge').style.color='#ffcf70';
  setProgress(4,'Checking GPU and loading the model…');
  return true;
}

function progressFromStatus(text){
  const t=text.toLowerCase();
  if(t.includes('loading model')) return 8;
  if(t.includes('fetch') || t.includes('download')) return 18;
  if(t.includes('creating session')) return 34;
  if(t.includes('ready')) return 100;
  if(t.includes('phase 1')) return 12;
  if(t.includes('phase 2')) return 25;
  if(t.includes('phase 3')) return 38;
  if(t.includes('phase 4')) return 50;
  if(t.includes('phase 5')) return 60;
  if(t.includes('phase 6')) return 70;
  if(t.includes('phase 7')) return 80;
  if(t.includes('phase 8')) return 90;
  if(t.includes('phase 9')) return 97;
  if(t.includes('complete') || t.includes('done')) return 100;
  return state.generating ? 10 : 5;
}

function syncEngineStatus(){
  const statusEl=$('#status');
  const text=(statusEl?.innerText||'').trim();
  if(!text) return;

  const last=text.split('\n').filter(Boolean).at(-1)||text;
  setProgress(progressFromStatus(text),last);

  if(/doesn't support webgpu\/f16|does not support webgpu\/f16/i.test(text)){
    state.engineReady=false;
    $('#generateBtn').disabled=true;
    $('#providerBadge').textContent='GPU F16 unsupported';
    $('#providerBadge').style.color='#ff9ba5';
    setStatus('Unsupported','error');
    showNotice('Your GPU/browser does not support the WebGPU F16 feature required by this model. Try current Chrome or Edge on a newer GPU.','error');
    return;
  }

  if(/\bready\./i.test(text) && !state.generating){
    state.engineReady=true;
    $('#progressState').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    $('#generateBtn').disabled=false;
    $('#providerBadge').textContent='Browser AI ready';
    $('#providerBadge').style.color='#9ce7c3';
    setStatus('Ready','complete');
    hideNotice();
  }

  if(/generating/i.test(text)){
    setGenerating(true);
  }

  if(/complete!|\bdone\b/i.test(text) && state.generating){
    setGenerating(false);
    state.engineReady=true;
    $('#generateBtn').disabled=false;
    $('#progressState').classList.add('hidden');
    $('#video_container').classList.remove('hidden');
    setStatus('Ready','complete');
    setProgress(100,'Video animation ready');
    $('#downloadBtn').classList.remove('disabled');

    const prompt=$('#prompt').value.trim();
    state.history.unshift({prompt,createdAt:Date.now()});
    state.history=state.history.slice(0,12);
    showNotice('Video generated in your browser. Use Download WebM to save it.','success');
  }

  if(/error|failed|exception|out of memory|oom/i.test(last) && !/no error/i.test(last)){
    setGenerating(false);
    $('#providerBadge').textContent='Engine error';
    $('#providerBadge').style.color='#ff9ba5';
    setStatus('Error','error');
    showNotice(last,'error');
  }
}

function initStatusObserver(){
  const statusEl=$('#status');
  if(!statusEl) return;
  const observer=new MutationObserver(syncEngineStatus);
  observer.observe(statusEl,{childList:true,subtree:true,characterData:true});
  syncEngineStatus();
}

window.addEventListener('videonova-engine-capability-error',(event)=>{
  state.engineReady=false;
  $('#generateBtn').disabled=true;
  $('#progressState').classList.add('hidden');
  $('#emptyState').classList.remove('hidden');
  $('#providerBadge').textContent='Browser/GPU unsupported';
  $('#providerBadge').style.color='#ff9ba5';
  setStatus('Unsupported','error');
  showNotice(event.detail||'This browser/GPU cannot run the WebGPU video model.','error');
});

window.addEventListener('videonova-engine-load-error',(event)=>{
  state.engineReady=false;
  $('#generateBtn').disabled=true;
  $('#providerBadge').textContent='Runtime load failed';
  $('#providerBadge').style.color='#ff9ba5';
  setStatus('Error','error');
  const detail=event.detail||'Browser runtime failed to load.';
  showNotice(`Runtime load failed: ${detail}`,'error');
});

window.addEventListener('videonova-engine-script-loaded',()=>{
  $('#providerBadge').textContent='Loading model…';
  $('#providerBadge').style.color='#ffcf70';
});

$('#prompt').addEventListener('input',()=>{
  $('#charCount').textContent=`${$('#prompt').value.length} / 4000`;
});

$('#randomPromptBtn').addEventListener('click',()=>{
  $('#prompt').value=examples[Math.floor(Math.random()*examples.length)];
  $('#prompt').dispatchEvent(new Event('input'));
});

$('#copyPromptBtn').addEventListener('click',async()=>{
  await navigator.clipboard.writeText($('#prompt').value||'');
  const old=$('#copyPromptBtn').textContent;
  $('#copyPromptBtn').textContent='Copied';
  setTimeout(()=>$('#copyPromptBtn').textContent=old,1000);
});

$$('#stylePresets .chip').forEach(chip=>chip.addEventListener('click',()=>{
  $$('#stylePresets .chip').forEach(x=>x.classList.remove('active'));
  chip.classList.add('active');
}));

$('#enhanceBtn').addEventListener('click',()=>{
  const raw=$('#prompt').value.trim();
  if(!raw){
    showNotice('Write a basic idea first, then enhance it.');
    return;
  }
  const style=$('#stylePresets .chip.active')?.dataset.style||'cinematic';
  $('#prompt').value=`${raw.replace(/[.\s]+$/,'')}. ${styleHints[style]}. single coherent shot, temporal consistency, no abrupt cuts.`.slice(0,4000);
  $('#prompt').dispatchEvent(new Event('input'));
  hideNotice();
});

$('#generateBtn').addEventListener('click',()=>{
  hideNotice();
  if(!state.engineReady){
    showNotice('The browser AI model is still loading. Generate will enable automatically when the status says Ready.','warning');
    return;
  }
  const prompt=$('#prompt').value.trim();
  if(prompt.length<3){
    showNotice('Please enter a text prompt.');
    return;
  }
  const hiddenInput=$('#user-input');
  const hiddenButton=$('#send-button');
  if(!hiddenInput||!hiddenButton){
    showNotice('Browser engine bridge is missing. Reload the page.','error');
    return;
  }
  hiddenInput.value=prompt;
  setGenerating(true);
  setProgress(2,'Starting Text-to-Video Zero…');
  $('#downloadBtn').classList.add('disabled');
  hiddenButton.click();
});

$('#downloadBtn').addEventListener('click',()=>{
  const native=$('#download_webm_btn');
  if(native) native.click();
  else showNotice('Generate a video first, then Download WebM will be available.','warning');
});

function escapeHtml(value=''){
  return value.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function renderHistory(){
  const grid=$('#historyGrid');
  if(!state.history.length){
    grid.innerHTML='<div class="history-empty">No videos generated in this browser session yet.</div>';
    return;
  }
  grid.innerHTML=state.history.map((item,index)=>`
    <article class="panel history-card">
      <p>${escapeHtml(item.prompt)}</p>
      <div class="history-meta"><span>Browser WebGPU</span><span>${new Date(item.createdAt).toLocaleString()}</span></div>
      <div class="history-actions"><button class="secondary reuse" data-index="${index}">Reuse prompt</button></div>
    </article>`).join('');
  $$('.reuse').forEach(btn=>btn.addEventListener('click',()=>{
    const item=state.history[Number(btn.dataset.index)];
    if(!item)return;
    $('#prompt').value=item.prompt;
    $('#prompt').dispatchEvent(new Event('input'));
    showView('create');
  }));
}

$('#clearHistoryBtn').addEventListener('click',()=>{
  state.history=[];
  renderHistory();
});

checkBrowser();
initStatusObserver();
renderHistory();
