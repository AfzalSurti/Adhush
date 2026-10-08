// AdHush — background service worker
// Mutes/unmutes the tab on request from the content script, shows the badge,
// fires notifications, and keeps simple stats.

const DEFAULTS = { enabled: true, skipAds: true, returnAfterAd: false, notifyEpisodeEnd: true, notifyAdEnd: false, debug: false };
const MUTED_KEY = 'mutedByUs'; // { [tabId]: true } — tabs WE muted (survives worker restarts)

async function getMutedByUs() {
  const o = await chrome.storage.session.get(MUTED_KEY);
  return o[MUTED_KEY] || {};
}
async function setMutedByUs(map) {
  await chrome.storage.session.set({ [MUTED_KEY]: map });
}

function setBadge(tabId, on) {
  chrome.action.setBadgeText({ tabId, text: on ? 'AD' : '' }).catch(() => {});
  if (on) chrome.action.setBadgeBackgroundColor({ tabId, color: '#c2410c' }).catch(() => {});
}

function notify(tabId, title, message) {
  chrome.notifications.create(`adhush:${tabId}:${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 1,
  });
}

// Switch to the MX Player tab and raise its window.
async function bringToFront(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
  } catch (e) { /* tab or window gone */ }
}

async function recordStats(durationMs) {
  const s = await chrome.storage.local.get({ adsMuted: 0, mutedMs: 0 });
  const ms = Math.max(0, Math.min(durationMs || 0, 15 * 60 * 1000)); // ignore absurd values
  await chrome.storage.local.set({ adsMuted: s.adsMuted + 1, mutedMs: s.mutedMs + ms });
}

async function handleAdState(tabId, msg) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const map = await getMutedByUs();
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch (e) { return; }

  if (msg.inAd) {
    if (!settings.enabled) return;
    if (tab.mutedInfo && tab.mutedInfo.muted) return; // already muted (by you) — leave it alone
    await chrome.tabs.update(tabId, { muted: true });
    map[tabId] = true;
    await setMutedByUs(map);
    setBadge(tabId, true);
    return;
  }

  // Ad over
  if (map[tabId]) {
    // Only unmute if it is still muted because of us. If you muted it yourself
    // in the meantime (reason "user"), we keep it muted.
    if (tab.mutedInfo && tab.mutedInfo.muted && tab.mutedInfo.reason !== 'user') {
      await chrome.tabs.update(tabId, { muted: false });
    }
    delete map[tabId];
    await setMutedByUs(map);
    await recordStats(msg.durationMs);
    if (msg.reason === 'show resumed') {
      if (settings.returnAfterAd) {
        await bringToFront(tabId);
      } else if (settings.notifyAdEnd) {
        notify(tabId, 'Ad break over', 'Your show is back on with sound.');
      }
    }
  }
  setBadge(tabId, false);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;
  if (msg.type === 'ad-state') {
    handleAdState(tabId, msg).finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'notify') {
    notify(tabId, msg.title, msg.message);
  }
});

// Clicking a notification jumps to the MX Player tab.
chrome.notifications.onClicked.addListener(async (id) => {
  const tabId = Number(id.split(':')[1]);
  chrome.notifications.clear(id);
  await bringToFront(tabId);
});

// Safety net: if a tab we muted reloads or navigates, give it its sound back.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'loading') return;
  const map = await getMutedByUs();
  if (!map[tabId]) return;
  delete map[tabId];
  await setMutedByUs(map);
  chrome.tabs.update(tabId, { muted: false }).catch(() => {});
  setBadge(tabId, false);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const map = await getMutedByUs();
  if (map[tabId]) { delete map[tabId]; await setMutedByUs(map); }
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(s); // write defaults on first install
});
