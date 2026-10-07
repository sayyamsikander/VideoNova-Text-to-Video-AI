const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPage() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const pages = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
      const page = pages.find(p => String(p.url).includes('selftest=fallback'));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('Could not find fallback test page in Chrome');
}

const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send('Runtime.enable');

for (let i = 0; i < 30; i++) {
  const result = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      state: document.documentElement.dataset.videonovaSelftest || '',
      size: Number(document.documentElement.dataset.videonovaBlobSize || 0),
      notice: document.querySelector('#notice')?.textContent || '',
      status: document.querySelector('#statusPill')?.textContent || ''
    })`,
    returnByValue: true
  });

  const value = JSON.parse(result.result.value || '{}');
  console.log('selftest', value);

  if (value.state === 'pass' && value.size > 1000) {
    console.log('Universal fallback video recording passed with blob bytes:', value.size);
    ws.close();
    process.exit(0);
  }
  if (value.state === 'fail') {
    throw new Error('Fallback explicitly failed: ' + JSON.stringify(value));
  }
  await sleep(1000);
}

throw new Error('Fallback video did not complete within test window');
