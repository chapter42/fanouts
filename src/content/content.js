/*
 * Fanouts — content script (ISOLATED world).
 *
 * Ontvangt de ruwe payloads van de MAIN-world interceptor, laat ze door parser /
 * entities / analysis lopen en schrijft het resultaat naar chrome.storage.local.
 * Het paneel en dashboard luisteren daar op — geen eigen berichtenkanaal nodig.
 */
(function () {
  'use strict';

  var KEY_INDEX = 'fanout:index';
  var KEY_ACTIVE = 'fanout:active';
  var KEY_SETTINGS = 'fanout:settings';
  var TURN_PREFIX = 'fanout:turn:';
  var DEFAULT_MAX_TURNS = 800;

  var settings = { myDomains: [], maxTurns: DEFAULT_MAX_TURNS, capturePaused: false };
  var writeQueue = [];
  var writeTimer = null;

  (async () => {
    try {
      const stored = await chrome.storage.local.get(KEY_SETTINGS);
      if (stored && stored[KEY_SETTINGS]) settings = Object.assign(settings, stored[KEY_SETTINGS]);
    } catch (err) {
      console.warn('[Fanouts] kon instellingen niet lezen, gebruikt standaarden', err);
    }
  })();

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes[KEY_SETTINGS] && changes[KEY_SETTINGS].newValue) {
      settings = Object.assign(settings, changes[KEY_SETTINGS].newValue);
    }
  });

  /* --------------------------------------------------------------------- */

  var HOST = location.hostname;
  var PROVIDER =
    /(^|\.)perplexity\.ai$/.test(HOST) ? 'perplexity' :
    /(^|\.)(gemini|bard)\.google\.com$/.test(HOST) ? 'gemini' : 'chatgpt';

  function conversationIdFromUrl() {
    var m;
    if (PROVIDER === 'chatgpt') {
      m = /\/c\/([0-9a-fA-F-]{36})/.exec(location.pathname);
    } else if (PROVIDER === 'perplexity') {
      m = /\/search\/([^/?#]+)/.exec(location.pathname);
    } else {
      m = /\/app\/([0-9a-zA-Z_-]+)/.exec(location.pathname);
    }
    return m ? m[1] : null;
  }

  function pageTitle() {
    var t = document.title || '';
    return t.replace(/\s*[-|–|·]\s*(ChatGPT|Perplexity|Gemini)\s*$/i, '').trim();
  }

  function setActive() {
    var patch = {};
    patch[KEY_ACTIVE] = {
      provider: PROVIDER,
      conversationId: conversationIdFromUrl(),
      title: pageTitle(),
      url: location.href,
      at: Date.now()
    };
    chrome.storage.local.set(patch).catch(function (err) {
      console.warn('[Fanouts] kon de actieve conversatie niet vastleggen', err);
    });
  }

  /* --------------------------------------------------------------------- */
  /* Opslag                                                                */
  /* --------------------------------------------------------------------- */

  async function flush() {
    writeTimer = null;
    const batch = writeQueue.splice(0, writeQueue.length);
    if (!batch.length) return;

    // Dedupe per turn-id: alleen de laatste versie is relevant.
    const byId = {};
    batch.forEach((t) => { byId[t.id] = t; });
    const ids = Object.keys(byId);

    try {
      const stored = await chrome.storage.local.get(
        ids.map((id) => TURN_PREFIX + id).concat([KEY_INDEX])
      );
      const index = Array.isArray(stored[KEY_INDEX]) ? stored[KEY_INDEX] : [];
      const patch = {};
      let indexChanged = false;

      ids.forEach((id) => {
        const key = TURN_PREFIX + id;
        const merged = self.FanoutParser.mergeTurn(stored[key] || null, byId[id]);
        self.FanoutAnalysis.analyseTurn(merged, settings);
        patch[key] = merged;
        if (index.indexOf(id) === -1) { index.push(id); indexChanged = true; }
      });

      const max = settings.maxTurns || DEFAULT_MAX_TURNS;
      let removeKeys = [];
      if (index.length > max) {
        removeKeys = index.splice(0, index.length - max).map((id) => TURN_PREFIX + id);
        indexChanged = true;
      }

      if (indexChanged) patch[KEY_INDEX] = index;
      await chrome.storage.local.set(patch);
      if (removeKeys.length) await chrome.storage.local.remove(removeKeys);
    } catch (err) {
      // Quota vol of opslag onbereikbaar. De turns zijn uit de wachtrij, dus
      // deze batch is verloren — maar de volgende stream-update levert ze
      // opnieuw aan, dus doorgaan is beter dan de opname stilleggen.
      console.error('[Fanouts] wegschrijven mislukt; deze batch is niet opgeslagen', err);
    }
  }

  function queueTurns(turns) {
    if (!turns || !turns.length) return;
    turns.forEach(function (t) { writeQueue.push(t); });
    if (writeTimer) return;
    writeTimer = setTimeout(flush, 350);
  }

  /* --------------------------------------------------------------------- */
  /* Inkomende payloads                                                    */
  /* --------------------------------------------------------------------- */

  function handlePayload(type, payload) {
    if (settings.capturePaused) return;
    if (!payload) return;

    if (type === 'turn-start') {
      setActive();
      return;
    }

    if (type === 'turn-update' || type === 'conversation-detail') {
      if (!payload.provider) payload.provider = PROVIDER;
      if (!payload.conversationId) payload.conversationId = conversationIdFromUrl() || 'unknown';
      if (!payload.title) payload.title = pageTitle();
      var turns;
      try {
        turns = self.FanoutParser.buildTurns(payload);
      } catch (e) {
        console.warn('[Fanouts] parse-fout', e);
        return;
      }
      queueTurns(turns);
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    var d = event.data;
    if (!d || d.__fanout !== true || !d.type) return;
    handlePayload(d.type, d.payload);
  });

  /* --------------------------------------------------------------------- */
  /* Handmatig de historie van de huidige conversatie ophalen              */
  /* --------------------------------------------------------------------- */

  async function accessToken() {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (!res.ok) return null;
      const json = await res.json();
      return (json && json.accessToken) || null;
    } catch (err) {
      // Zonder token proberen we het alsnog op de cookies alleen.
      return null;
    }
  }

  async function resync(conversationId) {
    if (PROVIDER !== 'chatgpt') {
      throw new Error('Historie ophalen werkt alleen op ChatGPT — bij Perplexity en Gemini wordt live meegelezen');
    }
    const id = conversationId || conversationIdFromUrl();
    if (!id) throw new Error('Geen conversatie geopend');

    const token = await accessToken();
    const headers = { accept: '*/*' };
    if (token) headers.authorization = 'Bearer ' + token;

    const res = await fetch('/backend-api/conversation/' + id, { credentials: 'include', headers: headers });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' van ChatGPT');

    const json = await res.json();
    if (!json || !json.mapping) throw new Error('Onverwacht antwoord van ChatGPT');

    const turns = self.FanoutParser.buildTurns({
      provider: 'chatgpt',
      source: 'history',
      conversationId: json.conversation_id || id,
      title: json.title || pageTitle(),
      pageUrl: location.href,
      mapping: json.mapping
    });
    queueTurns(turns);
    await flush();
    return { turns: turns.length };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'fanout:resync') return;
    (async () => {
      try {
        const res = await resync(msg.conversationId);
        sendResponse({ ok: true, turns: res.turns });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true; // houdt het antwoordkanaal open
  });

  /* --------------------------------------------------------------------- */

  setActive();
  var lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname !== lastPath) { lastPath = location.pathname; setActive(); }
  }, 1000);

  document.addEventListener('DOMContentLoaded', setActive);
})();
