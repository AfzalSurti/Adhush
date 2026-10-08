const DEFAULTS = { enabled: true, skipAds: true, returnAfterAd: false, notifyEpisodeEnd: true, notifyAdEnd: false, debug: false };
const $ = (id) => document.getElementById(id);

function fmt(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ask(type) {
  const tab = await activeTab();
  if (!tab) return null;
  try { return await chrome.tabs.sendMessage(tab.id, { type }); } catch (e) { return null; }
}

function setStatus(cls, text) {
  $('status').className = `status ${cls}`;
  $('statusText').textContent = text;
}

async function refreshStatus() {
  const res = await ask('get-status');
  if (!res) return setStatus('idle', 'Open an episode on mxplayer.in');
  if (!res.enabled) return setStatus('off', 'Auto-mute is off');
  if (res.inAd) return setStatus('ad', res.skipAction ? `Ad — muted, ${res.skipAction}` : 'Ad playing — tab muted');
  if (res.hasContent) return setStatus('ok', 'Watching — sound on');
  return setStatus('idle', 'Waiting for the video…');
}

async function refreshStats() {
  const s = await chrome.storage.local.get({ adsMuted: 0, mutedMs: 0 });
  $('adsMuted').textContent = s.adsMuted;
  $('mutedTime').textContent = fmt(s.mutedMs);
}

async function copyDiagnostics() {
  const data = await ask('diagnostics');
  if (!data) { $('diagMsg').textContent = 'Open an MX Player tab first'; return; }
  await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  $('diagMsg').textContent = 'Copied ✓';
  setTimeout(() => { $('diagMsg').textContent = ''; }, 2500);
}

async function init() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  for (const key of Object.keys(DEFAULTS)) {
    const el = $(key);
    el.checked = !!s[key];
    el.addEventListener('change', async () => {
      await chrome.storage.sync.set({ [key]: el.checked });
      refreshStatus();
    });
  }
  $('diag').addEventListener('click', copyDiagnostics);
  refreshStatus();
  refreshStats();
  setInterval(() => { refreshStatus(); refreshStats(); }, 1000);
}

init();
