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

  chrome.storage.local.get(KEY_SETTINGS, function (r) {
    if (r && r[KEY_SETTINGS]) settings = Object.assign(settings, r[KEY_SETTINGS]);
  });

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
    chrome.storage.local.set(patch);
  }

  /* --------------------------------------------------------------------- */
  /* Opslag                                                                */
  /* --------------------------------------------------------------------- */

  function flush() {
    writeTimer = null;
    var batch = writeQueue.splice(0, writeQueue.length);
    if (!batch.length) return;

    // Dedupe per turn-id: alleen de laatste versie is relevant.
    var byId = {};
    batch.forEach(function (t) { byId[t.id] = t; });
    var ids = Object.keys(byId);
    var keys = ids.map(function (id) { return TURN_PREFIX + id; }).concat([KEY_INDEX]);

    chrome.storage.local.get(keys, function (stored) {
      var index = Array.isArray(stored[KEY_INDEX]) ? stored[KEY_INDEX] : [];
      var patch = {};
      var indexChanged = false;

      ids.forEach(function (id) {
        var key = TURN_PREFIX + id;
        var merged = self.FanoutParser.mergeTurn(stored[key] || null, byId[id]);
        self.FanoutAnalysis.analyseTurn(merged, settings);
        patch[key] = merged;
        var pos = index.indexOf(id);
        if (pos === -1) { index.push(id); indexChanged = true; }
      });

      var max = settings.maxTurns || DEFAULT_MAX_TURNS;
      var removeKeys = [];
      if (index.length > max) {
        var drop = index.splice(0, index.length - max);
        removeKeys = drop.map(function (id) { return TURN_PREFIX + id; });
        indexChanged = true;
      }

      if (indexChanged) patch[KEY_INDEX] = index;
      chrome.storage.local.set(patch, function () {
        if (removeKeys.length) chrome.storage.local.remove(removeKeys);
      });
    });
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

  function accessToken() {
    return fetch('/api/auth/session', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.accessToken) || null; })
      .catch(function () { return null; });
  }

  function resync(conversationId) {
    if (PROVIDER !== 'chatgpt') {
      return Promise.reject(new Error('Historie ophalen werkt alleen op ChatGPT — bij Perplexity en Gemini wordt live meegelezen'));
    }
    var id = conversationId || conversationIdFromUrl();
    if (!id) return Promise.reject(new Error('Geen conversatie geopend'));
    return accessToken().then(function (token) {
      var headers = { accept: '*/*' };
      if (token) headers.authorization = 'Bearer ' + token;
      return fetch('/backend-api/conversation/' + id, { credentials: 'include', headers: headers });
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (json) {
      if (!json || !json.mapping) throw new Error('Onverwacht antwoord van ChatGPT');
      var turns = self.FanoutParser.buildTurns({
        provider: 'chatgpt',
        source: 'history',
        conversationId: json.conversation_id || id,
        title: json.title || pageTitle(),
        pageUrl: location.href,
        mapping: json.mapping
      });
      queueTurns(turns);
      flush();
      return { turns: turns.length };
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'fanout:resync') return;
    resync(msg.conversationId).then(function (res) {
      sendResponse({ ok: true, turns: res.turns });
    }).catch(function (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    });
    return true; // async
  });

  /* --------------------------------------------------------------------- */

  setActive();
  var lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname !== lastPath) { lastPath = location.pathname; setActive(); }
  }, 1000);

  document.addEventListener('DOMContentLoaded', setActive);
})();
