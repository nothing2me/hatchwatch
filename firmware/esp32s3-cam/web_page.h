// The camera page served at "/". Kept in its own file so the C++ stays readable.
#pragma once

static const char WEB_PAGE[] = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NestTrace ESP32-S3 camera</title>
<style>
  :root { --bg:#0b1016; --panel:#121a23; --line:#1f2b38; --text:#e6edf3; --muted:#8b98a5;
          --accent:#f5b84a; --live:#ff4d5e; --ok:#34d399; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:radial-gradient(circle at 20% 0%,#16212d,var(--bg) 60%);
         color:var(--text); font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:880px; margin:0 auto; padding:24px 16px 40px; }
  header { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .eyebrow { letter-spacing:.24em; font-size:12px; color:var(--muted); text-transform:uppercase; }
  h1 { margin:4px 0 0; font-size:24px; font-weight:600; }
  .badge { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px;
           border:1px solid var(--line); color:var(--muted); font-size:13px; }
  .badge::before { content:""; width:8px; height:8px; border-radius:50%; background:currentColor; }
  .badge.live { color:var(--live); border-color:#5b2129; background:#2a1317; }
  .viewer { margin-top:16px; position:relative; aspect-ratio:4/3; border-radius:14px; overflow:hidden;
            background:#05080b; border:1px solid var(--line); }
  .viewer img { width:100%; height:100%; object-fit:contain; display:block; }
  .viewer .empty { position:absolute; inset:0; display:grid; place-items:center; color:var(--muted); }
  .controls { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  button { font:inherit; padding:10px 16px; border-radius:10px; border:1px solid var(--line);
           background:var(--panel); color:var(--text); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#1b1204; font-weight:600; }
  button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  dl { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin:16px 0 0; }
  dl div { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:10px 12px; }
  dt { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
  dd { margin:2px 0 0; font-family:ui-monospace,Menlo,monospace; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="eyebrow">NestTrace</div>
      <h1>ESP32-S3 camera</h1>
    </div>
    <span id="badge" class="badge">Stopped</span>
  </header>

  <div class="viewer">
    <img id="view" alt="Camera picture">
    <div id="empty" class="empty">Press Start to watch the camera.</div>
  </div>

  <div class="controls">
    <button id="start" class="primary">Start</button>
    <button id="stop">Stop</button>
    <button id="snap">Snapshot</button>
    <button id="save">Save snapshot</button>
  </div>

  <dl>
    <div><dt>Sensor</dt><dd id="sensor">-</dd></div>
    <div><dt>Mode</dt><dd id="mode">-</dd></div>
    <div><dt>Picture</dt><dd id="size">-</dd></div>
    <div><dt>Stream</dt><dd id="fps">-</dd></div>
    <div><dt>Wi-Fi</dt><dd id="rssi">-</dd></div>
    <div><dt>Up</dt><dd id="uptime">-</dd></div>
  </dl>
</main>
<script>
  const $ = id => document.getElementById(id);
  const view = $('view'), empty = $('empty'), badge = $('badge');
  const streamUrl = () => `http://${location.hostname}:81/stream?t=${Date.now()}`;

  function show(state, text) {
    badge.textContent = text;
    badge.classList.toggle('live', state === 'live');
    empty.hidden = state !== 'stopped';
  }
  function start() { view.src = streamUrl(); show('live', 'Live'); }
  function stop() { view.removeAttribute('src'); show('stopped', 'Stopped'); }
  function snapshot() {
    stop();
    view.src = `/capture?t=${Date.now()}`;
    show('still', 'Snapshot');
  }
  view.onerror = () => { if (view.getAttribute('src')) show('stopped', 'Camera not reachable'); };

  $('start').onclick = start;
  $('stop').onclick = stop;
  $('snap').onclick = snapshot;
  $('save').onclick = () => { const a = document.createElement('a'); a.href = `/capture?download=1&t=${Date.now()}`; a.download = 'snapshot.jpg'; a.click(); };

  async function refreshStatus() {
    try {
      const s = await (await fetch('/status', { cache: 'no-store' })).json();
      $('sensor').textContent = `${s.sensor} (0x${s.pid.toString(16)})`;
      $('mode').textContent = s.mode;
      $('size').textContent = `${s.width}×${s.height}`;
      $('fps').textContent = s.fps > 0 ? `${s.fps.toFixed(1)} fps` : 'idle';
      $('rssi').textContent = `${s.rssi} dBm`;
      const m = Math.floor(s.uptime / 60);
      $('uptime').textContent = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    } catch (e) { /* camera busy or rebooting; try again next tick */ }
  }
  refreshStatus();
  setInterval(refreshStatus, 3000);
  start();
</script>
</body>
</html>
)HTML";
