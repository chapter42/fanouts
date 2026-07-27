/*
 * Fanouts — opslaglaag voor UI-contexten (paneel en dashboard).
 */
;(function (root) {
  'use strict';

  var KEY_INDEX = 'fanout:index';
  var KEY_ACTIVE = 'fanout:active';
  var KEY_SETTINGS = 'fanout:settings';
  var TURN_PREFIX = 'fanout:turn:';

  var DEFAULT_SETTINGS = { myDomains: [], maxTurns: 800, capturePaused: false, theme: 'light' };

  function getSettings() {
    return chrome.storage.local.get(KEY_SETTINGS).then(function (r) {
      return Object.assign({}, DEFAULT_SETTINGS, r[KEY_SETTINGS] || {});
    });
  }

  function setSettings(patch) {
    return getSettings().then(function (cur) {
      var next = Object.assign({}, cur, patch);
      var o = {}; o[KEY_SETTINGS] = next;
      return chrome.storage.local.set(o).then(function () { return next; });
    });
  }

  function getActive() {
    return chrome.storage.local.get(KEY_ACTIVE).then(function (r) { return r[KEY_ACTIVE] || null; });
  }

  function getTurns() {
    return chrome.storage.local.get(KEY_INDEX).then(function (r) {
      var index = Array.isArray(r[KEY_INDEX]) ? r[KEY_INDEX] : [];
      if (!index.length) return [];
      var keys = index.map(function (id) { return TURN_PREFIX + id; });
      return chrome.storage.local.get(keys).then(function (all) {
        var out = [];
        index.forEach(function (id) {
          var t = all[TURN_PREFIX + id];
          if (t) out.push(t);
        });
        out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return out;
      });
    });
  }

  function deleteTurn(id) {
    return chrome.storage.local.get(KEY_INDEX).then(function (r) {
      var index = (r[KEY_INDEX] || []).filter(function (x) { return x !== id; });
      var o = {}; o[KEY_INDEX] = index;
      return chrome.storage.local.set(o).then(function () {
        return chrome.storage.local.remove(TURN_PREFIX + id);
      });
    });
  }

  function clearAll() {
    return chrome.storage.local.get(KEY_INDEX).then(function (r) {
      var keys = (r[KEY_INDEX] || []).map(function (id) { return TURN_PREFIX + id; });
      var o = {}; o[KEY_INDEX] = [];
      return chrome.storage.local.set(o).then(function () {
        return keys.length ? chrome.storage.local.remove(keys) : null;
      });
    });
  }

  function clearConversation(conversationId) {
    return getTurns().then(function (turns) {
      var drop = turns.filter(function (t) { return t.conversationId === conversationId; }).map(function (t) { return t.id; });
      return chrome.storage.local.get(KEY_INDEX).then(function (r) {
        var index = (r[KEY_INDEX] || []).filter(function (x) { return drop.indexOf(x) === -1; });
        var o = {}; o[KEY_INDEX] = index;
        return chrome.storage.local.set(o).then(function () {
          return drop.length ? chrome.storage.local.remove(drop.map(function (id) { return TURN_PREFIX + id; })) : null;
        });
      });
    });
  }

  /* Her-analyseert alle turns, bv. na wijziging van "mijn domeinen". */
  function reanalyseAll() {
    return Promise.all([getTurns(), getSettings()]).then(function (res) {
      var turns = res[0], settings = res[1];
      var patch = {};
      turns.forEach(function (t) {
        root.FanoutAnalysis.analyseTurn(t, settings);
        patch[TURN_PREFIX + t.id] = t;
      });
      return chrome.storage.local.set(patch).then(function () { return turns; });
    });
  }

  function onChange(cb) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      var relevant = Object.keys(changes).some(function (k) {
        return k === KEY_INDEX || k === KEY_ACTIVE || k.indexOf(TURN_PREFIX) === 0;
      });
      if (relevant) cb(changes);
    });
  }

  function usage() {
    if (!chrome.storage.local.getBytesInUse) return Promise.resolve(null);
    return new Promise(function (resolve) {
      chrome.storage.local.getBytesInUse(null, function (bytes) { resolve(bytes); });
    });
  }

  /* Zet het thema op <html>; licht is de standaard. */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  }

  root.FanoutStore = {
    applyTheme: applyTheme,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    getTurns: getTurns,
    getActive: getActive,
    getSettings: getSettings,
    setSettings: setSettings,
    deleteTurn: deleteTurn,
    clearAll: clearAll,
    clearConversation: clearConversation,
    reanalyseAll: reanalyseAll,
    onChange: onChange,
    usage: usage,
    KEY_INDEX: KEY_INDEX,
    TURN_PREFIX: TURN_PREFIX
  };
})(typeof self !== 'undefined' ? self : this);
