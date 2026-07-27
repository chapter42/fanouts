/*
 * Minimale chrome.* stub zodat paneel en dashboard buiten de extensie te
 * bekijken zijn. Alleen voor development — wordt niet meegeleverd in de
 * extensie zelf (staat buiten manifest.json).
 */
(function () {
  'use strict';

  var DATA = window.__FANOUT_FIXTURE__ || {};
  var listeners = [];

  window.chrome = {
    storage: {
      local: {
        get: function (keys) {
          return new Promise(function (resolve) {
            var out = {};
            if (keys === null || keys === undefined) { resolve(Object.assign({}, DATA)); return; }
            var list = typeof keys === 'string' ? [keys] : keys;
            list.forEach(function (k) { if (k in DATA) out[k] = DATA[k]; });
            resolve(out);
          });
        },
        set: function (obj) {
          return new Promise(function (resolve) {
            var changes = {};
            Object.keys(obj).forEach(function (k) {
              changes[k] = { oldValue: DATA[k], newValue: obj[k] };
              DATA[k] = obj[k];
            });
            listeners.forEach(function (fn) { fn(changes, 'local'); });
            resolve();
          });
        },
        remove: function (keys) {
          return new Promise(function (resolve) {
            (typeof keys === 'string' ? [keys] : keys).forEach(function (k) { delete DATA[k]; });
            resolve();
          });
        },
        getBytesInUse: function (keys, cb) { cb(JSON.stringify(DATA).length); }
      },
      onChanged: { addListener: function (fn) { listeners.push(fn); } }
    },
    runtime: {
      getURL: function (p) { return '../' + p.replace(/^src\//, 'src/'); },
      sendMessage: function (msg, cb) { if (cb) cb({ ok: false, error: 'dev-preview: geen ChatGPT-tab' }); },
      onMessage: { addListener: function () {} },
      lastError: null
    },
    tabs: { create: function (o) { window.open(o.url, '_blank'); }, query: function () {} },
    sidePanel: { setPanelBehavior: function () { return Promise.resolve(); } }
  };
})();
