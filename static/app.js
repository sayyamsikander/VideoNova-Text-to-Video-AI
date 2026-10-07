const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const IS_GITHUB_PAGES = location.hostname.endsWith('.github.io');
const state = {
  config: null,
  currentJob: null,
  poller: null,
  history: JSON.parse(localStorage.getItem('videonova-history') || '[]')
};

const examples = [
  'A cinematic aerial shot gliding over emerald rice terraces after rain, morning mist drifting between hills, realistic light, slow graceful camera movement.',
  'A small friendly robot walks through a neon city at night, reflections on wet pavement, cinematic tracking shot, realistic motion.',
  'A luxury perfume bottle on dark marble, warm studio reflections, slow turntable motion, macro lens, premium commercial lighting.',
  'A watercolor fox runs through an enchanted forest at dusk, glowing fireflies, flowing brush textures, dreamlike camera tracking.'
];

const styleHints = {
  cinematic: 'cinematic composition, natural motion, detailed lighting, realistic depth, subtle film grain',
  anime: 'high-quality anime aesthetic, expressive motion, clean linework, vibrant cel shading',
  photoreal: 'photorealistic, physically plausible motion, natural textures, realistic lighting and reflections',
  product: 'premium product commercial, controlled studio lighting, crisp details, elegant camera movement',
  fantasy: 'epic fantasy atmosphere, magical particles, rich environmental detail, dramatic light'
};

function showView(name){
  $$('.view').forEach(v=>v.classList.remove('active'));
  const target=$(`#${name}View`);
  if(target) target.classList.add('active');
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  if(name==='history') renderHistory();
}
$$('.nav-btn').forEach(b=>b.onclick=()=>showView(b.dataset.view));

function showNotice(msg){
  $('#notice').textContent=msg;
  $('#notice').classList.remove('hidden');
}
function hideNotice(){ $('#notice').classList.add('hidden'); }

function setOfflinePreview(){
  state.config={local:{ready:false,model:'Wan2.1 T2V 1.3B',device:'GPU on your machine'}};
  $('#providerBadge').textContent='Static preview';
  $('#providerBadge').style.color='#ffcf70';
  $('#generateBtn').disabled=true;
  updateModels();
  showNotice('This GitHub Pages URL is only the static interface. No third-party account is required: clone the repo and run start.bat or start.sh on your own GPU, then open http://127.0.0.1:8080 for the working generator.');
}

async function loadConfig(){
  if(IS_GITHUB_PAGES){
    setOfflinePreview();
    return;
  }
  try{
    const r=await fetch('/api/config',{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    state.config=await r.json();
    const cfg=state.config.local;
    $('#providerBadge').textContent=cfg.ready?`Local AI · ${cfg.device}`:'Local setup needed';
    $('#providerBadge').style.color=cfg.ready?'#9ce7c3':'#ffb2bb';
    $('#generateBtn').disabled=!cfg.ready;
    updateModels();

    if(!cfg.torchInstalled || !cfg.diffusersInstalled){
      showNotice('Local AI dependencies are missing. Run: pip install -r requirements.txt');
    } else if(!cfg.modelPresent && cfg.autoDownload){
      showNotice('Ready. The open-source model will download anonymously on the first generation, then run from your local model files.');
    } else if(!cfg.modelPresent){
      showNotice('Model files are missing. Run: python download_model.py');
    }
  }catch(e){
    $('#providerBadge').textContent='Server offline';
    $('#providerBadge').style.color='#ff9ba5';
    $('#generateBtn').disabled=true;
    showNotice('VideoNova local server is not running. Start it with start.bat (Windows) or ./start.sh (Linux/macOS).');
  }
}

function updateModels(){
  const sel=$('#model');
  sel.innerHTML='';
  const model=state.config?.local?.model || 'Wan2.1-T2V-1.3B-Diffusers';
  const o=document.createElement('option');
  o.value=model;
  o.textContent=model.split('/').pop();
  sel.appendChild(o);
  $('#statEngine').textContent='Self-hosted';
  $('#statModel').textContent=o.textContent;
}

$('#prompt').oninput=()=>$('#charCount').textContent=`${$('#prompt').value.length} / 4000`;
$('#randomPromptBtn').onclick=()=>{
  $('#prompt').value=examples[Math.floor(Math.random()*examples.length)];
  $('#prompt').dispatchEvent(new Event('input'));
};
$('#seedBtn').onclick=()=>{$('#seed').value=Math.floor(Math.random()*2147483647)};
$('#copyPromptBtn').onclick=async()=>{
  await navigator.clipboard.writeText($('#prompt').value||'');
  const old=$('#copyPromptBtn').textContent;
  $('#copyPromptBtn').textContent='Copied';
  setTimeout(()=>$('#copyPromptBtn').textContent=old,1000);
};

$$('#stylePresets .chip').forEach(c=>c.onclick=()=>{
  $$('#stylePresets .chip').forEach(x=>x.classList.remove('active'));
  c.classList.add('active');
});

$('#enhanceBtn').onclick=()=>{
  const raw=$('#prompt').value.trim();
  if(!raw){showNotice('Write a basic idea first, then enhance it.');return}
  const style=$('#stylePresets .chip.active')?.dataset.style||'cinematic';
  $('#prompt').value=`${raw.replace(/[.\s]+$/,'')}. ${styleHints[style]}. Single coherent scene, clear subject action, consistent appearance, smooth camera movement, no abrupt cuts.`.slice(0,4000);
  $('#prompt').dispatchEvent(new Event('input'));
  hideNotice();
};

$('#aspect').onchange=()=>{
  const stage=$('#previewStage');
  stage.classList.remove('ratio-16-9','ratio-9-16','ratio-1-1');
  stage.classList.add($('#aspect').value==='9:16'?'ratio-9-16':$('#aspect').value==='1:1'?'ratio-1-1':'ratio-16-9');
};

function formPayload(){
  return {
    prompt:$('#prompt').value.trim(),
    negativePrompt:$('#negativePrompt').value.trim(),
    provider:'local',
    model:$('#model').value,
    aspect:$('#aspect').value,
    quality:$('#quality').value,
    duration:Number($('#duration').value),
    fps:Number($('#fps').value),
    steps:Number($('#steps').value),
    guidance:Number($('#guidance').value),
    seed:$('#seed').value?Number($('#seed').value):null
  };
}

function setGenerating(on){
  $('#generateBtn').disabled=on;
  $('#cancelBtn').classList.toggle('hidden',!on);
  $('#emptyState').classList.add('hidden');
  $('#video').classList.add('hidden');
  $('#progressState').classList.toggle('hidden',!on);
  $('#statusPill').className=`status ${on?'running':'idle'}`;
  $('#statusPill').textContent=on?'Generating':'Ready';
}

function renderProgress(job){
  const p=Math.max(0,Math.min(100,job.progress||0));
  $('#progressBar').style.width=`${p}%`;
  $('#progressPercent').textContent=`${p}%`;
  $('#progressText').textContent=job.message||'Working…';
  $('#statusPill').textContent=['running','queued'].includes(job.status)?'Generating':job.status;
}

$('#generateBtn').onclick=async()=>{
  hideNotice();
  if(IS_GITHUB_PAGES){
    showNotice('GitHub Pages cannot run the AI model. Run the repository on your own GPU and open http://127.0.0.1:8080.');
    return;
  }
  const payload=formPayload();
  if(payload.prompt.length<3){showNotice('Please enter a text prompt.');return}

  setGenerating(true);
  $('#progressTitle').textContent='Generating on your machine…';
  $('#statEngine').textContent='Self-hosted';
  $('#statModel').textContent=$('#model').options[$('#model').selectedIndex]?.textContent||'Wan';
  $('#statSeed').textContent=payload.seed??'random';

  try{
    const r=await fetch('/api/generate',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||'Generation request failed');
    state.currentJob=data.jobId;
    pollJob(data.jobId,payload);
  }catch(e){
    generationError(e.message);
  }
};

function pollJob(id,payload){
  clearInterval(state.poller);
  const tick=async()=>{
    try{
      const r=await fetch(`/api/jobs/${id}`,{cache:'no-store'});
      const job=await r.json();
      if(!r.ok) throw new Error(job.error||'Job lookup failed');
      renderProgress(job);

      if(job.status==='complete'){
        clearInterval(state.poller);
        state.poller=null;
        state.currentJob=null;
        setGenerating(false);
        $('#progressState').classList.add('hidden');
        $('#video').src=job.videoUrl;
        $('#video').classList.remove('hidden');
        $('#video').load();
        $('#downloadBtn').href=job.downloadUrl;
        $('#downloadBtn').classList.remove('disabled');
        $('#statusPill').className='status complete';
        $('#statusPill').textContent='Ready';
        $('#statSeed').textContent=job.seed??payload.seed??'—';
        $('#statModel').textContent=(job.model||payload.model||'Wan').split('/').pop();
        addHistory({...job,prompt:payload.prompt,provider:'local'});
      }else if(job.status==='error'){
        clearInterval(state.poller);
        state.poller=null;
        state.currentJob=null;
        generationError(job.message||'Generation failed');
      }else if(job.status==='cancelled'){
        clearInterval(state.poller);
        state.poller=null;
        state.currentJob=null;
        setGenerating(false);
        $('#progressState').classList.add('hidden');
        $('#emptyState').classList.remove('hidden');
        $('#statusPill').textContent='Cancelled';
      }
    }catch(e){
      clearInterval(state.poller);
      state.poller=null;
      generationError(e.message);
    }
  };
  tick();
  state.poller=setInterval(tick,1800);
}

function generationError(msg){
  setGenerating(false);
  $('#progressState').classList.add('hidden');
  $('#emptyState').classList.remove('hidden');
  $('#statusPill').className='status error';
  $('#statusPill').textContent='Error';
  showNotice(msg);
}

$('#cancelBtn').onclick=async()=>{
  if(!state.currentJob)return;
  await fetch(`/api/jobs/${state.currentJob}/cancel`,{method:'POST'}).catch(()=>{});
};

function addHistory(job){
  state.history=[{
    id:job.id,
    createdAt:job.createdAt||Date.now(),
    prompt:job.prompt,
    videoUrl:job.videoUrl,
    downloadUrl:job.downloadUrl,
    provider:'local',
    model:job.model||'',
    seed:job.seed??''
  },...state.history.filter(x=>x.id!==job.id)].slice(0,30);
  localStorage.setItem('videonova-history',JSON.stringify(state.history));
}

function escapeHtml(s=''){
  return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function renderHistory(){
  const grid=$('#historyGrid');
  if(!state.history.length){
    grid.innerHTML='<div class="history-empty">No generated videos yet.</div>';
    return;
  }
  grid.innerHTML=state.history.map(item=>`
    <article class="panel history-card">
      <div class="history-thumb"><video src="${item.videoUrl}" muted preload="metadata" controls></video></div>
      <p>${escapeHtml(item.prompt)}</p>
      <div class="history-meta"><span>Self-hosted</span><span>${new Date(item.createdAt).toLocaleString()}</span></div>
      <div class="history-actions">
        <a class="primary" href="${item.downloadUrl}" download>Download</a>
        <button class="secondary reuse" data-id="${item.id}">Reuse</button>
      </div>
    </article>`).join('');
  $$('.reuse').forEach(b=>b.onclick=()=>{
    const item=state.history.find(x=>x.id===b.dataset.id);
    if(!item)return;
    $('#prompt').value=item.prompt;
    $('#prompt').dispatchEvent(new Event('input'));
    showView('create');
  });
}

$('#clearHistoryBtn').onclick=()=>{
  state.history=[];
  localStorage.removeItem('videonova-history');
  renderHistory();
};

loadConfig();
renderHistory();
