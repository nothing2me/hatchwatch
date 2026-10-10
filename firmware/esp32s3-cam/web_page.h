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
  .box { position:absolute; border:2px solid var(--accent); border-radius:4px; pointer-events:none; display:none; }
  .panel { margin-top:16px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px; }
  .panel h2 { margin:0 0 8px; font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px; }
  .meter { height:8px; border-radius:999px; background:#0b1118; overflow:hidden; }
  .meter span { display:block; height:100%; width:0; background:var(--accent); transition:width .3s; }
  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:10px; color:var(--muted); font-size:14px; }
  .row input[type=range] { flex:1; min-width:160px; accent-color:var(--accent); }
  .mask { width:160px; aspect-ratio:4/3; image-rendering:pixelated; border-radius:8px; border:1px solid var(--line); background:#000; }
  .note { color:var(--muted); font-size:13px; margin:8px 0 0; }
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
    <div id="box" class="box"></div>
  </div>

  <div class="controls">
    <button id="start" class="primary">Start</button>
    <button id="stop">Stop</button>
    <button id="snap">Snapshot</button>
    <button id="save">Save snapshot</button>
  </div>

  <section class="panel" aria-labelledby="motion-title">
    <h2 id="motion-title"><span id="motionBadge" class="badge">Still</span> Motion on the board</h2>
    <div class="meter" aria-hidden="true"><span id="meter"></span></div>
    <div class="row">
      <span><b id="percent">0.0</b>% of the picture moving</span>
      <span id="since">no motion yet</span>
    </div>
    <div class="row">
      <label for="threshold">Threshold</label>
      <input id="threshold" type="range" min="5" max="100" value="20">
      <span id="thresholdValue">20</span>
    </div>
    <div class="row">
      <label><input id="overlay" type="checkbox" checked> Box on picture</label>
      <button id="resetBg">Reset background</button>
    </div>
    <div class="row"><img id="mask" class="mask" alt="Motion mask"></div>
    <p class="note">Viewing aid only. This is not the digging detector and raises no alerts.</p>
  </section>

  <dl>
    <div><dt>Sensor</dt><dd id="sensor">-</dd></div>
    <div><dt>Mode</dt><dd id="mode">-</dd></div>
    <div><dt>Picture</dt><dd id="size">-</dd></div>
    <div><dt>Stream</dt><dd id="fps">-</dd></div>
    <div><dt>Wi-Fi</dt><dd id="rssi">-</dd></div>
    <div><dt>Up</dt><dd id="uptime">-</dd></div>
    <div><dt>Dashboard</dt><dd id="uplink">-</dd></div>
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

  let cam = { width: 320, height: 240 };
  const box = $('box');
  function placeBox(m) {
    if (!$('overlay').checked || !m.active || !view.getAttribute('src')) { box.style.display = 'none'; return; }
    // the picture is letterboxed inside the 4:3 viewer
    const vw = view.clientWidth, vh = view.clientHeight;
    const scale = Math.min(vw / cam.width, vh / cam.height);
    const ox = (vw - cam.width * scale) / 2, oy = (vh - cam.height * scale) / 2;
    const [x, y, w, h] = m.box;
    Object.assign(box.style, { display: 'block', left: `${ox + x * scale}px`, top: `${oy + y * scale}px`,
                               width: `${w * scale}px`, height: `${h * scale}px` });
  }
  function showMotion(m) {
    $('percent').textContent = m.percent.toFixed(1);
    $('meter').style.width = `${Math.min(100, m.percent * 4)}%`;
    $('motionBadge').textContent = m.active ? 'Moving' : 'Still';
    $('motionBadge').classList.toggle('live', m.active);
    $('since').textContent = m.secondsSince < 0 ? 'no motion yet' : m.secondsSince < 2 ? 'moving now' : `last motion ${m.secondsSince} s ago`;
    if (document.activeElement !== $('threshold')) { $('threshold').value = m.threshold; $('thresholdValue').textContent = m.threshold; }
    placeBox(m);
  }
  let slider;
  $('threshold').oninput = e => {
    $('thresholdValue').textContent = e.target.value;
    clearTimeout(slider);
    slider = setTimeout(() => fetch(`/motion/settings?threshold=${e.target.value}`, { method: 'POST' }), 250);
  };
  $('resetBg').onclick = () => fetch('/motion/settings?reset=1', { method: 'POST' });
  $('overlay').onchange = () => { if (!$('overlay').checked) box.style.display = 'none'; };
  setInterval(() => { $('mask').src = `/motion?t=${Date.now()}`; }, 1000);

  async function refreshStatus() {
    try {
      const s = await (await fetch('/status', { cache: 'no-store' })).json();
      $('sensor').textContent = `${s.sensor} (0x${s.pid.toString(16)})`;
      $('mode').textContent = s.mode;
      $('size').textContent = `${s.width}×${s.height}`;
      cam = { width: s.width, height: s.height };
      if (s.motion) showMotion(s.motion);
      $('fps').textContent = s.fps > 0 ? `${s.fps.toFixed(1)} fps` : 'idle';
      $('rssi').textContent = `${s.rssi} dBm`;
      const m = Math.floor(s.uptime / 60);
      $('uptime').textContent = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
      if (s.uplink) {
        const u = s.uplink;
        $('uplink').textContent = u.state === 'off' ? (u.lastError ? `off: ${u.lastError}` : 'off (standalone)')
          : u.state === 'sending' ? `sending · ${u.sent} frames${u.lastError ? ` · last problem: ${u.lastError}` : ''}`
          : `${u.state}${u.lastError ? `: ${u.lastError}` : ''}`;
      }
    } catch (e) { /* camera busy or rebooting; try again next tick */ }
  }
  refreshStatus();
  setInterval(refreshStatus, 1000);
  start();
</script>
</body>
</html>
)HTML";
