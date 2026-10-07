const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const IS_GITHUB_PAGES = location.hostname.endsWith('.github.io');
const API_BASE = (localStorage.getItem('videonova-api-base') || '').replace(/\/+$/, '');
const apiUrl = (path) => `${API_BASE}${path}`;
const backendAssetUrl = (path) => !path ? path : (/^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`);
const HF_SESSION_KEY = 'videonova-hf-token';
const getBrowserToken = () => sessionStorage.getItem(HF_SESSION_KEY) || '';
const usingBrowserHF = () => IS_GITHUB_PAGES && !API_BASE && !!getBrowserToken();

const state = { config: null, currentJob: null, poller: null, browserCancelled: false, activeObjectUrl: null, history: JSON.parse(localStorage.getItem('videonova-history') || '[]') };
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
      const hasToken=!!getBrowserToken();
      state.config={hf:{configured:hasToken,models:['Wan-AI/Wan2.2-TI2V-5B','tencent/HunyuanVideo','Lightricks/LTX-Video-0.9.8-13B-distilled']},comfyui:{configured:false}};
      $('#provider').value='hf';
      $('#provider').querySelector('option[value="comfyui"]').disabled=true;
      $('#providerBadge').textContent=hasToken?'HF browser mode ready':'Add HF token in Setup';
      $('#providerBadge').style.color=hasToken?'#9ce7c3':'#ffcf70';
      updateModels();
      if(!hasToken) showNotice('GitHub Pages is loaded correctly. Open Setup, add a Hugging Face token, then Generate will work directly in this browser tab.');
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
    if(IS_GITHUB_PAGES && !API_BASE){
      await runBrowserHf(payload);
      return;
    }
    const r=await fetch(apiUrl('/api/generate'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const data=await r.json();
    if(!r.ok) throw new Error(data.error||'Generation request failed');
    state.currentJob=data.jobId; pollJob(data.jobId,payload);
  }catch(e){generationError(e.message)}
};

async function runBrowserHf(payload){
  const token=getBrowserToken();
  if(!token){ setGenerating(false); showNotice('Open Setup and add your Hugging Face token first.'); showView('setup'); return; }
  state.currentJob='browser-hf';
  state.browserCancelled=false;
  $('#progressText').textContent='Loading Hugging Face client…';
  $('#progressBar').style.width='8%';
  $('#progressPercent').textContent='8%';

  let fakeProgress=8;
  const ticker=setInterval(()=>{
    if(fakeProgress<88 && !state.browserCancelled){
      fakeProgress += fakeProgress<45 ? 3 : 1;
      $('#progressBar').style.width=`${fakeProgress}%`;
      $('#progressPercent').textContent=`${fakeProgress}%`;
      $('#progressText').textContent=fakeProgress<30?'Submitting to Hugging Face…':fakeProgress<70?'Generating frames…':'Finalizing video…';
    }
  },1800);

  try{
    const mod=await import('https://esm.sh/@huggingface/inference@4.13.30');
    const client=new mod.InferenceClient(token);
    const seed=payload.seed ?? Math.floor(Math.random()*2147483647);
    const frames=Math.min(161,Math.max(33,payload.duration*payload.fps+1));
    const parameters={
      seed,
      num_frames:frames,
      num_inference_steps:payload.steps,
      guidance_scale:payload.guidance
    };
    if(payload.negativePrompt) parameters.negative_prompt=[payload.negativePrompt];

    const videoBlob=await client.textToVideo({
      model:payload.model || 'Wan-AI/Wan2.2-TI2V-5B',
      provider:'fal-ai',
      inputs:payload.prompt,
      parameters
    });

    if(state.browserCancelled){ clearInterval(ticker); setGenerating(false); return; }
    if(!(videoBlob instanceof Blob) || !videoBlob.size) throw new Error('Hugging Face returned an empty video.');

    clearInterval(ticker);
    if(state.activeObjectUrl) URL.revokeObjectURL(state.activeObjectUrl);
    const objectUrl=URL.createObjectURL(videoBlob);
    state.activeObjectUrl=objectUrl;
    state.currentJob=null;
    setGenerating(false);
    $('#progressState').classList.add('hidden');
    $('#video').src=objectUrl;
    $('#video').classList.remove('hidden');
    $('#video').load();
    $('#downloadBtn').href=objectUrl;
    $('#downloadBtn').download=`videonova-${Date.now()}.mp4`;
    $('#downloadBtn').classList.remove('disabled');
    $('#statusPill').className='status complete';
    $('#statusPill').textContent='Ready';
    $('#statSeed').textContent=seed;
    $('#statModel').textContent=(payload.model||'Wan2.2-TI2V-5B').split('/').pop();
    $('#progressBar').style.width='100%';
    $('#progressPercent').textContent='100%';
    addHistory({
      id:`browser-${Date.now()}`,
      createdAt:Date.now(),
      prompt:payload.prompt,
      videoUrl:objectUrl,
      downloadUrl:objectUrl,
      provider:'hf-browser',
      model:payload.model,
      seed,
      ephemeral:true,
      settings:{aspect:payload.aspect,quality:payload.quality,duration:payload.duration,fps:payload.fps}
    });
  }catch(e){
    clearInterval(ticker);
    const msg=String(e?.message||e);
    if(/401|unauthorized|token/i.test(msg)) throw new Error('Hugging Face rejected the token. Create a token with Inference Providers permission, then save it again in Setup.');
    if(/402|payment|credit|quota|balance/i.test(msg)) throw new Error('Hugging Face credits/quota are not available for this request. Check your Inference Providers balance or try another supported model.');
    throw e;
  }
}

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
$('#cancelBtn').onclick=async()=>{
  if(!state.currentJob)return;
  if(state.currentJob==='browser-hf'){
    state.browserCancelled=true;
    state.currentJob=null;
    setGenerating(false);
    $('#progressState').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    $('#statusPill').textContent='Cancelled';
    return;
  }
  await fetch(apiUrl(`/api/jobs/${state.currentJob}/cancel`),{method:'POST'}).catch(()=>{});
};

function addHistory(job){
  state.history=[{id:job.id,createdAt:job.createdAt||Date.now(),prompt:job.prompt,videoUrl:job.videoUrl,downloadUrl:job.downloadUrl,provider:job.provider,model:job.model||'',seed:job.seed??'',ephemeral:!!job.ephemeral,settings:job.settings||{}},...state.history.filter(x=>x.id!==job.id)].slice(0,30);
  const persistent=state.history.filter(x=>!x.ephemeral && !String(x.videoUrl||'').startsWith('blob:'));
  localStorage.setItem('videonova-history',JSON.stringify(persistent));
}
function escapeHtml(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function renderHistory(){
  const grid=$('#historyGrid'); if(!state.history.length){grid.innerHTML='<div class="history-empty">No generated videos yet. Create your first clip and it will appear here.</div>';return}
  grid.innerHTML=state.history.map(item=>`<article class="panel history-card"><div class="history-thumb"><video src="${backendAssetUrl(item.videoUrl)}" muted preload="metadata" controls></video></div><p>${escapeHtml(item.prompt)}</p><div class="history-meta"><span>${item.provider==='comfyui'?'ComfyUI':item.provider==='hf-browser'?'HF Browser':'Hugging Face'}</span><span>${new Date(item.createdAt).toLocaleString()}</span></div><div class="history-actions"><a class="primary" href="${backendAssetUrl(item.downloadUrl)}" download>Download</a><button class="secondary reuse" data-id="${item.id}">Reuse</button></div></article>`).join('');
  $$('.reuse').forEach(b=>b.onclick=()=>{const item=state.history.find(x=>x.id===b.dataset.id);if(!item)return;$('#prompt').value=item.prompt;$('#prompt').dispatchEvent(new Event('input'));showView('create')});
}
$('#clearHistoryBtn').onclick=()=>{state.history=[];localStorage.removeItem('videonova-history');renderHistory()};

const hfTokenInput=$('#hfBrowserToken');
const hfTokenState=$('#hfTokenState');
if(hfTokenState) hfTokenState.textContent=getBrowserToken()?'Token active for this tab.':'No browser token saved.';
const saveHfTokenBtn=$('#saveHfTokenBtn');
if(saveHfTokenBtn) saveHfTokenBtn.onclick=()=>{
  const token=(hfTokenInput?.value||'').trim();
  if(!token.startsWith('hf_')){ if(hfTokenState) hfTokenState.textContent='Enter a valid Hugging Face token beginning with hf_.'; return; }
  sessionStorage.setItem(HF_SESSION_KEY,token);
  if(hfTokenInput) hfTokenInput.value='';
  location.reload();
};
const clearHfTokenBtn=$('#clearHfTokenBtn');
if(clearHfTokenBtn) clearHfTokenBtn.onclick=()=>{sessionStorage.removeItem(HF_SESSION_KEY);location.reload();};

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
