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

  async function readRequestBody(args) {
    var init = args[1];
    if (init && typeof init.body === 'string') return init.body;
    if (init && init.body instanceof URLSearchParams) return init.body.toString();
    if (init && init.body instanceof Uint8Array) {
      try { return new TextDecoder().decode(init.body); } catch (e) { /* noop */ }
    }
    if (args[0] && typeof args[0] === 'object' && typeof args[0].clone === 'function') {
      try { return await args[0].clone().text(); } catch (e) { /* noop */ }
    }
    return '';
  }

  /* --------------------------------------------------------------- fetch */

  var originalFetch = window.fetch;

  /*
   * Het meelezen gebeurt in losse async-helpers die we bewust NIET awaiten: de
   * response gaat direct terug naar de pagina en de analyse loopt ernaast. Zo
   * kan onze code de host-app niet vertragen, ook niet met één microtask.
   */
  async function tapStream(res, args, descriptor) {
    if (!res || !res.ok || !res.body) return;
    var clone = res.clone();
    var ctx = {};
    try {
      ctx = provider.promptFromRequest(await readRequestBody(args)) || {};
    } catch (e) {
      ctx = {};
    }
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
  }

  async function tapJson(res, descriptor) {
    if (!res || !res.ok || !provider.consumeJson) return;
    var json = await res.clone().json();
    provider.consumeJson(json, { conversationId: descriptor.conversationId || null }, emit);
  }

  window.fetch = function () {
    var args = Array.prototype.slice.call(arguments);
    var url = urlOf(args[0]);
    var method = ((args[1] && args[1].method) || (args[0] && args[0].method) || 'GET').toUpperCase();

    var descriptor;
    try { descriptor = provider.match(url, method); } catch (e) { descriptor = null; }

    // Alles wat ons niet aangaat gaat ongewijzigd en zonder extra tick door.
    if (!descriptor) return originalFetch.apply(this, args);

    var pending = originalFetch.apply(this, args);
    pending.then(function (res) {
      var tap = descriptor.type === 'stream' ? tapStream(res, args, descriptor) : tapJson(res, descriptor);
      tap.catch(function (err) {
        // Meelezen mag nooit de pagina raken; loggen en verder.
        console.debug('[Fanouts] meelezen mislukt', err);
      });
    }, function () { /* de pagina handelt zijn eigen fout af */ });
    return pending;
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
