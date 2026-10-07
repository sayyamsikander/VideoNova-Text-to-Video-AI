const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const IS_GITHUB_PAGES = location.hostname.endsWith('.github.io');
const API_BASE = (localStorage.getItem('videonova-api-base') || '').replace(/\/+$/, '');
const apiUrl = (path) => `${API_BASE}${path}`;
const backendAssetUrl = (path) => !path ? path : (/^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`);

const state = { config: null, currentJob: null, poller: null, history: JSON.parse(localStorage.getItem('videonova-history') || '[]') };
const examples = [
  'A cinematic aerial shot gliding over emerald rice terraces after rain, morning mist drifting between hills, tiny farmers walking along the paths, realistic light, slow graceful camera movement.',
  'A tiny orange robot explores an abandoned moon base, dust floating in zero gravity, wide-angle lens, dramatic blue rim light, detailed sci-fi surfaces, gentle handheld movement.',
  'Luxury perfume bottle on black marble, soft golden reflections, slow turntable motion, macro lens, premium commercial lighting, shallow depth of field, elegant and minimal.',
  'A watercolor-style fox runs through a glowing enchanted forest at dusk, fireflies, flowing brush textures, dreamlike camera tracking, warm magical atmosphere.'
];
const styleHints = {
  cinematic: 'cinematic composition, natural motion, detailed lighting, realistic depth, subtle film grain',
  anime: 'high-quality anime aesthetic, expressive motion, clean linework, vibrant cel shading, dynamic composition',
  photoreal: 'photorealistic, physically plausible motion, natural textures, realistic lighting and reflections',
  product: 'premium product commercial, controlled studio lighting, crisp details, elegant camera movement, clean background',
  fantasy: 'epic fantasy atmosphere, magical particles, rich environmental detail, dramatic light, graceful cinematic movement'
};

function showView(name){
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#${name}View`).classList.add('active');
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  if(name==='history') renderHistory();
}
$$('.nav-btn').forEach(b=>b.onclick=()=>showView(b.dataset.view));

async function loadConfig(){
  try{
    if(IS_GITHUB_PAGES && !API_BASE){
      state.config={hf:{configured:false,models:['Wan-AI/Wan2.1-T2V-1.3B']},comfyui:{configured:false}};
      $('#providerBadge').textContent='Frontend ready · backend needed';
      $('#providerBadge').style.color='#ffcf70';
      updateModels();
      showNotice('The GitHub Pages frontend is working. To generate videos, deploy server.py on a backend host, then open Setup and save its HTTPS URL.');
      return;
    }
    const r=await fetch(apiUrl('/api/config')); 
    if(!r.ok) throw new Error(`Backend returned HTTP ${r.status}`);
    state.config=await r.json();
    const badge=$('#providerBadge');
    const ready=[]; if(state.config.hf.configured) ready.push('HF'); if(state.config.comfyui.configured) ready.push('ComfyUI');
    badge.textContent=ready.length?`${ready.join(' + ')} ready`:'Setup required';
    badge.style.color=ready.length?'#9ce7c3':'#ffb2bb';
    $('#provider').querySelector('option[value="hf"]').disabled=!state.config.hf.configured;
    $('#provider').querySelector('option[value="comfyui"]').disabled=!state.config.comfyui.configured;
    if(!state.config.hf.configured && state.config.comfyui.configured) $('#provider').value='comfyui';
    updateModels();
    if(!ready.length) showNotice('No generation engine is configured yet. Open Setup for instructions.');
  }catch(e){ showNotice('Could not load server configuration. Make sure you started server.py.'); }
}

function updateModels(){
  const provider=$('#provider').value; const sel=$('#model'); sel.innerHTML='';
  if(provider==='hf'){
    (state.config?.hf?.models||['Wan-AI/Wan2.1-T2V-1.3B']).forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m.split('/').pop();sel.appendChild(o)});
  } else {
    const o=document.createElement('option');o.value='workflow';o.textContent='Your ComfyUI workflow';sel.appendChild(o);
  }
  $('#statEngine').textContent=provider==='hf'?'Hugging Face':'ComfyUI'; $('#statModel').textContent=sel.options[sel.selectedIndex]?.textContent||'—';
}
$('#provider').onchange=updateModels; $('#model').onchange=()=>$('#statModel').textContent=$('#model').options[$('#model').selectedIndex]?.textContent||'—';

function showNotice(msg){$('#notice').textContent=msg;$('#notice').classList.remove('hidden')}
function hideNotice(){$('#notice').classList.add('hidden')}
$('#prompt').oninput=()=>$('#charCount').textContent=`${$('#prompt').value.length} / 4000`;
$('#randomPromptBtn').onclick=()=>{const p=examples[Math.floor(Math.random()*examples.length)];$('#prompt').value=p;$('#prompt').dispatchEvent(new Event('input'))};
$('#seedBtn').onclick=()=>{$('#seed').value=Math.floor(Math.random()*2147483647)};
$('#copyPromptBtn').onclick=async()=>{await navigator.clipboard.writeText($('#prompt').value||''); const old=$('#copyPromptBtn').textContent;$('#copyPromptBtn').textContent='Copied';setTimeout(()=>$('#copyPromptBtn').textContent=old,1200)};

$$('#stylePresets .chip').forEach(c=>c.onclick=()=>{$$('#stylePresets .chip').forEach(x=>x.classList.remove('active'));c.classList.add('active')});
$('#enhanceBtn').onclick=()=>{
  const raw=$('#prompt').value.trim(); if(!raw){showNotice('Write a basic idea first, then enhance it.');return}
  const style=$('#stylePresets .chip.active')?.dataset.style||'cinematic';
  const enhanced=`${raw.replace(/[.\s]+$/,'')}. ${styleHints[style]}. Single coherent scene, clear subject action, consistent appearance, smooth camera movement, no abrupt cuts.`;
  $('#prompt').value=enhanced.slice(0,4000); $('#prompt').dispatchEvent(new Event('input')); hideNotice();
};

$('#aspect').onchange=()=>{
  const stage=$('#previewStage'); stage.classList.remove('ratio-16-9','ratio-9-16','ratio-1-1');
  stage.classList.add($('#aspect').value==='9:16'?'ratio-9-16':$('#aspect').value==='1:1'?'ratio-1-1':'ratio-16-9');
};

function formPayload(){
  return {
    prompt:$('#prompt').value.trim(), negativePrompt:$('#negativePrompt').value.trim(), provider:$('#provider').value,
    model:$('#model').value, aspect:$('#aspect').value, quality:$('#quality').value,
    duration:Number($('#duration').value), fps:Number($('#fps').value), steps:Number($('#steps').value),
    guidance:Number($('#guidance').value), seed:$('#seed').value?Number($('#seed').value):null
  };
}

function setGenerating(on){
  $('#generateBtn').disabled=on; $('#cancelBtn').classList.toggle('hidden',!on);
  $('#emptyState').classList.add('hidden'); $('#video').classList.add('hidden'); $('#progressState').classList.toggle('hidden',!on);
  $('#statusPill').className=`status ${on?'running':'idle'}`; $('#statusPill').textContent=on?'Generating':'Ready';
}
function renderProgress(job){
  $('#progressBar').style.width=`${job.progress||0}%`; $('#progressPercent').textContent=`${job.progress||0}%`; $('#progressText').textContent=job.message||'Working…';
  $('#statusPill').textContent=job.status==='running'||job.status==='queued'?'Generating':job.status;
}

$('#generateBtn').onclick=async()=>{
  hideNotice(); const payload=formPayload(); if(payload.prompt.length<3){showNotice('Please enter a text prompt.');return}
  if(payload.provider==='hf' && !state.config?.hf?.configured){showNotice('Hugging Face is not configured. Add HF_TOKEN or switch to ComfyUI.');return}
  if(payload.provider==='comfyui' && !state.config?.comfyui?.configured){showNotice('ComfyUI workflow is not configured. Open Setup for instructions.');return}
  setGenerating(true); $('#progressTitle').textContent='Generating your video…';
  $('#statEngine').textContent=payload.provider==='hf'?'Hugging Face':'ComfyUI'; $('#statModel').textContent=$('#model').options[$('#model').selectedIndex]?.textContent||'Workflow'; $('#statSeed').textContent=payload.seed??'random';
  try{
    const r=await fetch(apiUrl('/api/generate'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const data=await r.json();
    if(!r.ok) throw new Error(data.error||'Generation request failed');
    state.currentJob=data.jobId; pollJob(data.jobId,payload);
  }catch(e){generationError(e.message)}
};

function pollJob(id,payload){
  clearInterval(state.poller);
  const tick=async()=>{
    try{
      const r=await fetch(apiUrl(`/api/jobs/${id}`)); const job=await r.json(); if(!r.ok) throw new Error(job.error||'Job lookup failed'); renderProgress(job);
      if(job.status==='complete'){
        clearInterval(state.poller); state.poller=null; state.currentJob=null; setGenerating(false);
        $('#progressState').classList.add('hidden'); $('#video').src=backendAssetUrl(job.videoUrl); $('#video').classList.remove('hidden'); $('#video').load();
        $('#downloadBtn').href=backendAssetUrl(job.downloadUrl); $('#downloadBtn').classList.remove('disabled'); $('#statusPill').className='status complete'; $('#statusPill').textContent='Ready';
        $('#statSeed').textContent=job.seed??payload.seed??'—'; $('#statModel').textContent=(job.model||payload.model||'workflow').split('/').pop();
        addHistory({...job,prompt:payload.prompt,provider:payload.provider,settings:{aspect:payload.aspect,quality:payload.quality,duration:payload.duration,fps:payload.fps}});
      } else if(job.status==='error'){clearInterval(state.poller);state.poller=null;state.currentJob=null;generationError(job.message||'Generation failed')}
      else if(job.status==='cancelled'){clearInterval(state.poller);state.poller=null;state.currentJob=null;setGenerating(false);$('#progressState').classList.add('hidden');$('#emptyState').classList.remove('hidden');$('#statusPill').textContent='Cancelled'}
    }catch(e){clearInterval(state.poller);state.poller=null;generationError(e.message)}
  };
  tick(); state.poller=setInterval(tick,1800);
}

function generationError(msg){setGenerating(false);$('#progressState').classList.add('hidden');$('#emptyState').classList.remove('hidden');$('#statusPill').className='status error';$('#statusPill').textContent='Error';showNotice(msg)}
$('#cancelBtn').onclick=async()=>{if(!state.currentJob)return;await fetch(apiUrl(`/api/jobs/${state.currentJob}/cancel`),{method:'POST'}).catch(()=>{});};

function addHistory(job){
  state.history=[{id:job.id,createdAt:job.createdAt||Date.now(),prompt:job.prompt,videoUrl:job.videoUrl,downloadUrl:job.downloadUrl,provider:job.provider,model:job.model||'',seed:job.seed??'',settings:job.settings||{}},...state.history.filter(x=>x.id!==job.id)].slice(0,30);
  localStorage.setItem('videonova-history',JSON.stringify(state.history));
}
function escapeHtml(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function renderHistory(){
  const grid=$('#historyGrid'); if(!state.history.length){grid.innerHTML='<div class="history-empty">No generated videos yet. Create your first clip and it will appear here.</div>';return}
  grid.innerHTML=state.history.map(item=>`<article class="panel history-card"><div class="history-thumb"><video src="${item.videoUrl}" muted preload="metadata" controls></video></div><p>${escapeHtml(item.prompt)}</p><div class="history-meta"><span>${item.provider==='comfyui'?'ComfyUI':'Hugging Face'}</span><span>${new Date(item.createdAt).toLocaleString()}</span></div><div class="history-actions"><a class="primary" href="${item.downloadUrl}" download>Download</a><button class="secondary reuse" data-id="${item.id}">Reuse</button></div></article>`).join('');
  $$('.reuse').forEach(b=>b.onclick=()=>{const item=state.history.find(x=>x.id===b.dataset.id);if(!item)return;$('#prompt').value=item.prompt;$('#prompt').dispatchEvent(new Event('input'));showView('create')});
}
$('#clearHistoryBtn').onclick=()=>{state.history=[];localStorage.removeItem('videonova-history');renderHistory()};

const backendInput=$('#backendUrl');
if(backendInput) backendInput.value=API_BASE;
const saveBackendBtn=$('#saveBackendBtn');
if(saveBackendBtn) saveBackendBtn.onclick=()=>{
  const value=(backendInput?.value||'').trim().replace(/\/+$/, '');
  if(value && !/^https:\/\//i.test(value) && IS_GITHUB_PAGES){
    showNotice('For GitHub Pages, the backend URL must use HTTPS.');
    showView('create');
    return;
  }
  if(value) localStorage.setItem('videonova-api-base', value);
  else localStorage.removeItem('videonova-api-base');
  location.reload();
};

loadConfig(); renderHistory();
