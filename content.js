// AdHush — content script for mxplayer.in
// Watches the player, decides "ad" vs "show", and tells the background worker
// to mute/unmute the tab. Detection combines several independent signals so it
// doesn't depend on one class name that MX Player might rename tomorrow.
(() => {
  'use strict';

  const DEFAULTS = { enabled: true, skipAds: true, returnAfterAd: false, notifyEpisodeEnd: true, notifyAdEnd: false, debug: false };

  const AD_SPEED = 16;               // Chrome's max playbackRate: a 30s ad ends in ~2s
  const SKIP_CLICK_GAP_MS = 1000;    // don't hammer the skip button
  // Visible "Skip" buttons: "Skip", "Skip Ad", "Skip Ads ›", "Skip >>"
  const SKIP_TEXT_RE = /^skip(\s+ads?)?\s*[›»>▶︎→]*$/i;

  const POLL_MS = 500;               // fallback heartbeat
  const MIN_TICK_GAP_MS = 250;       // media events can fire fast; don't over-check
  const AD_MAX_SECONDS = 180;        // a short clip playing like a video = likely ad
  const CONTENT_MIN_SECONDS = 600;   // episodes / movies are longer than 10 minutes
  const EXIT_GRACE_SHOW_BACK_MS = 500;   // show is playing again -> unmute quickly
  const EXIT_GRACE_NO_SIGNAL_MS = 4000;  // gap between ads in a break -> stay muted a bit
  const TEXT_CONFIRM_TICKS = 2;      // an "Ad" label must persist before we trust it alone

  // Text the player shows on top of ads: "Ad", "Ad 1 of 2", "Ad : 0:15", "Skip Ad", ...
  const AD_TEXT_RE = /^(ad|ads|advertisement|sponsored)$|^ad\s*[:•·|-]?\s*\d|^ad\s*\d+\s*(of|\/)\s*\d+|skip\s*ads?\b|ad\s+will\s+end|video\s+will\s+(play|resume)\s+after/i;
  // id/class fragments that ad containers usually carry (IMA SDK, VAST, VPAID ...)
  const AD_ATTR_RE = /(^|[\s_-])(ad|ads|advert|advertisement|ima|preroll|midroll|postroll|vast|vpaid)([\s_-]|$)|adcontainer|ad-container|ad_container|adsmanager|imacontainer|imasdk|ad-overlay|adoverlay/i;

  let settings = { ...DEFAULTS };
  const state = {
    url: location.href,
    contentVideo: null,
    contentDuration: 0,
    lastProgress: 0,
    title: '',
    inAd: false,
    reason: '',
    textTicks: 0,
    lastSignalAt: 0,
    adStartedAt: 0,
    endedNotifiedFor: null,
    adVideo: null,            // the <video> element currently playing the ad, if we can reach it
    spedUp: new Map(),        // video element -> playbackRate it had before we sped it up
    lastSkipClickAt: 0,
    skipAction: '',
  };
  let alive = true;

  // ---------- settings ----------
  chrome.storage.sync.get(DEFAULTS).then((s) => { settings = { ...DEFAULTS, ...s }; renderPill(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
    if (!settings.enabled && state.inAd) setAd(false, 'AdHush turned off');
    if (!settings.skipAds) restoreSpeed();
    renderPill();
  });

  // ---------- helpers ----------
  const finite = (n) => Number.isFinite(n) && n > 0;
  const isPlaying = (v) => !v.paused && !v.ended && v.readyState > 2;

  function isVisible(el, minW = 40, minH = 20) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < minW || r.height < minH) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
  }

  function classOf(n) {
    if (typeof n.className === 'string') return n.className;
    return (n.className && n.className.baseVal) || '';
  }

  // Returns the id/class string of the nearest ad-looking ancestor, or null.
  function adAncestor(el, depth = 8) {
    for (let n = el; n && depth-- > 0 && n !== document.body; n = n.parentElement) {
      const sig = `${n.id || ''} ${classOf(n)}`;
      if (AD_ATTR_RE.test(sig)) return sig.trim().slice(0, 80);
    }
    return null;
  }

  // Climb from the video to the element that wraps the player UI (overlays, labels).
  function playerRoot(video) {
    if (!video || !video.parentElement) return null;
    const vr = video.getBoundingClientRect();
    const vArea = Math.max(1, vr.width * vr.height);
    let root = video.parentElement;
    for (let n = root, i = 0; n && n !== document.body && i < 8; n = n.parentElement, i++) {
      const r = n.getBoundingClientRect();
      if (r.width * r.height > vArea * 2.5) break;
      root = n;
    }
    return root;
  }

  function findAdText(root) {
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let t = walker.nextNode(); t && seen < 500; t = walker.nextNode(), seen++) {
      const s = t.nodeValue.trim();
      if (!s || s.length > 40) continue;
      if (AD_TEXT_RE.test(s) && isVisible(t.parentElement, 4, 4)) return s;
    }
    return null;
  }

  function log(...args) { if (settings.debug) console.log('%c[AdHush]', 'color:#f59e0b;font-weight:bold', ...args); }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (e) {
      // Extension was reloaded/updated: this old copy of the script must stop.
      alive = false;
    }
  }

  // ---------- core decision ----------
  function attachContent(v) {
    state.contentVideo = v;
    state.title = document.title;
    log('content video found', Math.round(v.duration) + 's');
  }

  function onUrlChange() {
    // MX often auto-starts the next episode; if the last one was ~done, report it.
    if (state.lastProgress > 0.9) maybeNotifyEpisodeEnd(state.url);
    if (state.inAd) setAd(false, 'page changed');
    state.url = location.href;
    state.contentVideo = null;
    state.contentDuration = 0;
    state.lastProgress = 0;
    state.textTicks = 0;
  }

  function collectSignals(videos) {
    const signals = [];
    const cv = state.contentVideo;
    state.adVideo = null;

    // 1) The main <video> element is suddenly carrying a short clip (ad stitched in place).
    if (cv && cv.isConnected && state.contentDuration >= CONTENT_MIN_SECONDS &&
        finite(cv.duration) && cv.duration < AD_MAX_SECONDS && isPlaying(cv)) {
      signals.push(`main video swapped to a ${Math.round(cv.duration)}s clip`);
      state.adVideo = cv;
    }

    // 2) A separate short video is playing (ad player laid over the paused show).
    for (const v of videos) {
      if (v === cv) continue;
      if (!isPlaying(v) || !isVisible(v)) continue;
      if (!finite(v.duration) || v.duration >= AD_MAX_SECONDS) continue;
      const anc = adAncestor(v);
      if (anc) {
        signals.push(`short video in ad container "${anc}"`);
        state.adVideo = state.adVideo || v;
      } else if (cv && cv.paused && !v.muted && v.volume > 0) {
        // Muted autoplay previews in rails are ignored by the !muted check.
        signals.push(`second video playing (${Math.round(v.duration)}s) while show is paused`);
        state.adVideo = state.adVideo || v;
      }
    }

    // 3) Google ad frame visible over a paused show.
    if (cv && cv.paused) {
      const frame = [...document.querySelectorAll('iframe')].find((f) =>
        /imasdk|googlesyndication|doubleclick|googleads/i.test(f.src || '') &&
        isVisible(f, 200, 100));
      if (frame) signals.push('Google ad frame over paused show');
    }

    // 4) "Ad" / "Ad 1 of 2" / "Skip Ad" label on the player.
    const anchor = cv || videos.find((v) => isVisible(v));
    const text = anchor ? findAdText(playerRoot(anchor)) : null;
    if (text) {
      state.textTicks++;
      if (state.textTicks >= TEXT_CONFIRM_TICKS) signals.push(`"${text}" label on player`);
    } else {
      state.textTicks = 0;
    }

    return signals;
  }

  function tick() {
    if (!alive) return;
    if (location.href !== state.url) onUrlChange();

    const videos = [...document.querySelectorAll('video')];

    // Identify the episode/movie video: the long one.
    for (const v of videos) {
      if (finite(v.duration) && v.duration >= CONTENT_MIN_SECONDS) {
        if (v !== state.contentVideo) attachContent(v);
        state.contentDuration = v.duration;
        state.lastProgress = v.currentTime / v.duration;
        break;
      }
    }

    const cv = state.contentVideo;
    const now = Date.now();
    const signals = settings.enabled ? collectSignals(videos) : [];

    // Safety net: never leave the episode itself running at ad speed.
    if (cv && cv.playbackRate === AD_SPEED && finite(cv.duration) && cv.duration >= CONTENT_MIN_SECONDS) {
      const original = state.spedUp.get(cv) || 1;
      try { cv.playbackRate = original; } catch (e) { /* ignore */ }
      state.spedUp.delete(cv);
    }

    if (signals.length) {
      state.lastSignalAt = now;
      const reason = signals.join(' + ');
      if (!state.inAd) setAd(true, reason);
      else state.reason = reason;
    } else if (state.inAd) {
      const showBack = cv && isPlaying(cv) && finite(cv.duration) && cv.duration >= CONTENT_MIN_SECONDS;
      const grace = showBack ? EXIT_GRACE_SHOW_BACK_MS : EXIT_GRACE_NO_SIGNAL_MS;
      if (now - state.lastSignalAt > grace) setAd(false, showBack ? 'show resumed' : 'ad signals gone');
    }

    if (state.inAd && settings.skipAds) skipAd(cv);

    // Episode finished?
    if (cv && !state.inAd && finite(cv.duration) && cv.duration >= CONTENT_MIN_SECONDS && cv.currentTime > 60 &&
        (cv.ended || cv.duration - cv.currentTime < 1.5)) {
      maybeNotifyEpisodeEnd(state.url);
    }

    renderPill();
  }

  // ---------- skipping ----------
  function findSkipButton(cv) {
    const scope = (cv && playerRoot(cv)) || document.body;
    const candidates = scope.querySelectorAll('button, [role="button"], [class*="skip" i], [id*="skip" i]');
    for (const el of candidates) {
      const text = (el.innerText || el.textContent || '').trim();
      const label = (el.getAttribute('aria-label') || '').trim();
      if (!SKIP_TEXT_RE.test(text) && !SKIP_TEXT_RE.test(label)) continue;
      if (!isVisible(el, 10, 10)) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      return el;
    }
    return null;
  }

  function skipAd(cv) {
    const now = Date.now();

    // 1) A real "Skip Ad" button is the cleanest way out.
    if (now - state.lastSkipClickAt > SKIP_CLICK_GAP_MS) {
      const btn = findSkipButton(cv);
      if (btn) {
        state.lastSkipClickAt = now;
        btn.click();
        state.skipAction = 'clicked Skip';
        log('clicked skip button', btn);
        return;
      }
    }

    // 2) Otherwise fast-forward the ad video we can reach.
    const v = state.adVideo;
    if (v && v.isConnected) {
      if (!state.spedUp.has(v)) state.spedUp.set(v, v.playbackRate || 1);
      if (v.playbackRate !== AD_SPEED) {
        try { v.playbackRate = AD_SPEED; } catch (e) { /* some players refuse */ }
      }
      state.skipAction = `${AD_SPEED}× speed`;
      return;
    }

    // 3) Ad lives inside Google's protected frame: we can only keep it muted.
    state.skipAction = 'mute only (ad frame unreachable)';
  }

  // Put every video we touched back to the speed it had before the ad.
  function restoreSpeed() {
    for (const [v, rate] of state.spedUp) {
      if (v.isConnected && v.playbackRate !== rate) {
        try { v.playbackRate = rate; } catch (e) { /* ignore */ }
      }
    }
    state.spedUp.clear();
    state.skipAction = '';
  }

  function setAd(on, reason) {
    const durationMs = on ? 0 : Date.now() - state.adStartedAt;
    state.inAd = on;
    state.reason = reason;
    if (on) state.adStartedAt = Date.now();
    else restoreSpeed();
    log(on ? 'AD START →' : 'AD END →', reason);
    send({ type: 'ad-state', inAd: on, reason, durationMs });
    renderPill();
  }

  function maybeNotifyEpisodeEnd(key) {
    if (state.endedNotifiedFor === key) return;
    state.endedNotifiedFor = key;
    if (!settings.notifyEpisodeEnd) return;
    const title = (state.title || document.title).replace(/\s*[-|].*MX Player.*$/i, '').trim();
    send({ type: 'notify', title: 'Episode finished', message: title || 'Your episode on MX Player has ended.' });
  }

  // ---------- scheduling ----------
  // Timers get throttled in background tabs, but media events keep firing,
  // so we tick on video events too (timeupdate fires ~4×/s while playing).
  let lastTick = 0;
  let pending = null;
  function safeTick() {
    lastTick = Date.now();
    try { tick(); } catch (e) { log('tick error', e); }
  }
  function requestTick() {
    const wait = MIN_TICK_GAP_MS - (Date.now() - lastTick);
    if (wait <= 0) { safeTick(); return; }
    if (pending) return;
    pending = setTimeout(() => { pending = null; safeTick(); }, wait);
  }
  ['playing', 'play', 'pause', 'ended', 'emptied', 'durationchange', 'loadedmetadata', 'timeupdate', 'volumechange']
    .forEach((ev) => document.addEventListener(ev, requestTick, true));
  const heartbeat = setInterval(() => { if (!alive) clearInterval(heartbeat); else requestTick(); }, POLL_MS);

  // ---------- debug pill ----------
  let pill = null;
  function renderPill() {
    if (!settings.debug) { if (pill) { pill.remove(); pill = null; } return; }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'adhush-debug-pill';
      Object.assign(pill.style, {
        position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483647',
        padding: '6px 12px', borderRadius: '999px', color: '#fff', pointerEvents: 'none',
        font: '600 12px/1.3 system-ui, sans-serif', maxWidth: '70vw', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', boxShadow: '0 2px 10px rgba(0,0,0,.45)',
      });
      document.documentElement.appendChild(pill);
    }
    pill.style.background = state.inAd ? '#c2410c' : '#15803d';
    pill.textContent = state.inAd
      ? `AdHush · AD (muted${state.skipAction ? ', ' + state.skipAction : ''}) — ${state.reason}`
      : `AdHush · ${state.contentVideo ? 'show playing' : 'waiting for video'}${settings.enabled ? '' : ' · OFF'}`;
  }

  // ---------- popup / diagnostics ----------
  function describeChain(el) {
    const chain = [];
    for (let n = el, i = 0; n && i < 7 && n !== document.body; n = n.parentElement, i++) {
      const cls = classOf(n).trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.');
      chain.push(`${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${cls ? '.' + cls : ''}`);
    }
    return chain;
  }

  function diagnostics() {
    const size = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
    const videos = [...document.querySelectorAll('video')].map((v) => ({
      isContent: v === state.contentVideo,
      duration: finite(v.duration) ? Math.round(v.duration) : String(v.duration),
      currentTime: Math.round(v.currentTime),
      paused: v.paused, muted: v.muted, volume: v.volume, readyState: v.readyState,
      visible: isVisible(v), size: size(v),
      src: (v.currentSrc || '').slice(0, 80),
      ancestors: describeChain(v),
    }));
    const iframes = [...document.querySelectorAll('iframe')].map((f) => {
      let host = '';
      try { host = new URL(f.src, location.href).host; } catch (e) { /* ignore */ }
      return { host, visible: isVisible(f), size: size(f), ancestors: describeChain(f).slice(0, 3) };
    });
    const anchor = state.contentVideo || document.querySelector('video');
    const root = anchor ? playerRoot(anchor) : null;
    const playerTexts = [];
    if (root) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t && playerTexts.length < 80; t = w.nextNode()) {
        const s = t.nodeValue.trim();
        if (s && s.length <= 40) playerTexts.push(s);
      }
    }
    return {
      extension: 'AdHush ' + chrome.runtime.getManifest().version,
      time: new Date().toISOString(),
      url: location.href,
      state: {
        inAd: state.inAd, reason: state.reason, skipAction: state.skipAction,
        adVideoFound: !!state.adVideo, contentDuration: Math.round(state.contentDuration),
      },
      settings,
      videos,
      iframes,
      playerRoot: root ? describeChain(root).slice(0, 2) : null,
      playerTexts,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'get-status') {
      sendResponse({
        inAd: state.inAd, reason: state.reason, skipAction: state.skipAction,
        hasContent: !!state.contentVideo, enabled: settings.enabled,
      });
    } else if (msg.type === 'diagnostics') {
      sendResponse(diagnostics());
    }
  });

  safeTick();
})();
