/*
 * Fanouts — generieke interceptor (MAIN world).
 *
 * Patcht fetch en XHR één keer en delegeert alles wat provider-specifiek is naar
 * de adapter die bij deze host hoort (zie src/inject/providers/). Er wordt altijd
 * op een clone gelezen: de response die de pagina zelf krijgt blijft ongemoeid.
 */
(function () {
  'use strict';

  if (window.__FANOUT_INTERCEPTOR_ACTIVE__) return;
  window.__FANOUT_INTERCEPTOR_ACTIVE__ = true;

  var U = window.__FANOUT_UTIL__;
  var ORIGIN = window.location.origin;
  var PROVIDERS = window.__FANOUT_PROVIDERS__ || [];

  var provider = null;
  for (var i = 0; i < PROVIDERS.length; i++) {
    if (PROVIDERS[i].matchesHost(location.hostname)) { provider = PROVIDERS[i]; break; }
  }
  if (!provider) return;

  function emit(type, payload) {
    try {
      window.postMessage({ __fanout: true, type: type, payload: payload, ts: Date.now() }, ORIGIN);
    } catch (e) {
      // Payloads die niet te structured-clonen zijn stilletjes overslaan.
    }
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try { return String(input); } catch (e) { return ''; }
  }

  function readRequestBody(args) {
    var init = args[1];
    if (init && typeof init.body === 'string') return Promise.resolve(init.body);
    if (init && init.body instanceof URLSearchParams) return Promise.resolve(init.body.toString());
    if (init && init.body instanceof Uint8Array) {
      try { return Promise.resolve(new TextDecoder().decode(init.body)); } catch (e) { /* noop */ }
    }
    if (args[0] && typeof args[0] === 'object' && typeof args[0].clone === 'function') {
      try { return args[0].clone().text().catch(function () { return ''; }); } catch (e) { /* noop */ }
    }
    return Promise.resolve('');
  }

  /* --------------------------------------------------------------- fetch */

  var originalFetch = window.fetch;

  window.fetch = function () {
    var args = Array.prototype.slice.call(arguments);
    var url = urlOf(args[0]);
    var method = ((args[1] && args[1].method) || (args[0] && args[0].method) || 'GET').toUpperCase();

    var descriptor;
    try { descriptor = provider.match(url, method); } catch (e) { descriptor = null; }
    if (!descriptor) return originalFetch.apply(this, args);

    if (descriptor.type === 'stream') {
      var ctxPromise = readRequestBody(args).then(function (body) {
        try { return provider.promptFromRequest(body) || {}; } catch (e) { return {}; }
      });

      return originalFetch.apply(this, args).then(function (res) {
        try {
          if (res && res.ok && res.body) {
            var clone = res.clone();
            ctxPromise.then(function (ctx) {
              ctx.conversationId = ctx.conversationId || descriptor.conversationId || null;
              emit('turn-start', {
                provider: provider.id,
                conversationId: ctx.conversationId,
                prompt: ctx.prompt || '',
                promptId: ctx.promptId || null,
                promptTime: ctx.promptTime || Date.now(),
                pageUrl: location.href
              });
              if (clone.body) provider.consumeStream(clone.body, ctx, emit);
            });
          }
        } catch (e) { /* nooit de host-app breken */ }
        return res;
      });
    }

    return originalFetch.apply(this, args).then(function (res) {
      try {
        if (res && res.ok && provider.consumeJson) {
          res.clone().json().then(function (json) {
            provider.consumeJson(json, { conversationId: descriptor.conversationId || null }, emit);
          }).catch(function () {});
        }
      } catch (e) { /* noop */ }
      return res;
    });
  };

  /* ----------------------------------------------------------------- XHR */

  var XhrOpen = XMLHttpRequest.prototype.open;
  var XhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__fanoutUrl = url;
    this.__fanoutMethod = String(method || 'GET').toUpperCase();
    return XhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var self = this;
    var descriptor = null;
    try { descriptor = provider.match(self.__fanoutUrl || '', self.__fanoutMethod || 'GET'); } catch (e) { /* noop */ }

    if (descriptor) {
      self.addEventListener('load', function () {
        try {
          var ctx = {};
          if (typeof body === 'string' && provider.promptFromRequest) ctx = provider.promptFromRequest(body) || {};
          ctx.conversationId = ctx.conversationId || descriptor.conversationId || null;

          if (descriptor.type === 'json' && provider.consumeJson) {
            var json = U.safeParse(self.responseText);
            if (json) provider.consumeJson(json, ctx, emit);
            return;
          }
          // Een XHR levert geen leesbare stream meer; de tekst gaat als geheel
          // door dezelfde route zodat providers hun eigen parser kunnen draaien.
          if (descriptor.type === 'stream' && provider.consumeText) {
            provider.consumeText(self.responseText, ctx, emit);
          }
        } catch (e) { /* noop */ }
      });
    }
    return XhrSend.apply(this, arguments);
  };

  emit('interceptor-ready', { provider: provider.id, url: location.href });
})();
