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

  /*
   * Elke stream krijgt één vaste sleutel mee. Ontbreken prompt en prompt-id
   * (opnieuw genereren, of een route zonder request body), dan valt parser.js
   * daarop terug in plaats van op de klok — anders levert elke tussentijdse
   * update een nieuwe, lege turn op.
   */
  function keyedEmit() {
    var streamKey = 'stream-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    return function (type, payload) {
      if (payload && !payload.streamKey) payload.streamKey = streamKey;
      emit(type, payload);
    };
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try { return String(input); } catch (e) { return ''; }
  }

  async function readRequestBody(args, requestClone) {
    if (requestClone) {
      try { return await requestClone.text(); } catch (e) { return ''; }
    }
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

  /* ------------------------------------------------------ één keer tappen */

  /*
   * Een response en al zijn clones vormen één "familie" die we hooguit één keer
   * aftappen. Dat is nodig omdat er twee routes naar dezelfde stream zijn (de
   * fetch-wrapper en het Response-vangnet hieronder) en omdat de pagina zelf ook
   * clones maakt, die dezelfde url dragen.
   */
  var families = new WeakMap();
  var nativeClone = Response.prototype.clone;

  function familyOf(res) {
    var f = families.get(res);
    if (!f) { f = { tapped: false }; families.set(res, f); }
    return f;
  }

  function claim(res) {
    var f = familyOf(res);
    if (f.tapped) return false;
    f.tapped = true;
    return true;
  }

  Response.prototype.clone = function () {
    var copy = nativeClone.apply(this, arguments);
    try { families.set(copy, familyOf(this)); } catch (e) { /* noop */ }
    return copy;
  };

  // De clone waarop wíj lezen hoort ook bij de familie. Anders herkent het
  // vangnet hem aan zijn url als een nieuwe response en tapt hem nog eens af.
  function ownClone(res) {
    var copy = nativeClone.call(res);
    families.set(copy, familyOf(res));
    return copy;
  }

  /* --------------------------------------------------------------- fetch */

  var originalFetch = window.fetch;

  /*
   * Het meelezen gebeurt in losse async-helpers die we bewust NIET awaiten: de
   * response gaat direct terug naar de pagina en de analyse loopt ernaast. Zo
   * kan onze code de host-app niet vertragen, ook niet met één microtask.
   */
  async function tapStream(res, args, descriptor, requestClone) {
    // Eerst claimen: res.body uitlezen loopt zelf al door het Response-vangnet.
    if (!res || !res.ok || !claim(res) || !res.body) return;
    var clone = ownClone(res);
    var ctx = {};
    try {
      ctx = provider.promptFromRequest(await readRequestBody(args, requestClone)) || {};
    } catch (e) {
      ctx = {};
    }
    ctx.conversationId = ctx.conversationId || descriptor.conversationId || null;
    ctx.descriptor = descriptor;
    emit('turn-start', {
      provider: provider.id,
      conversationId: ctx.conversationId,
      prompt: ctx.prompt || '',
      promptId: ctx.promptId || null,
      promptTime: ctx.promptTime || Date.now(),
      pageUrl: location.href
    });
    var body = bodyDescriptor && bodyDescriptor.get ? bodyDescriptor.get.call(clone) : clone.body;
    if (body) provider.consumeStream(body, ctx, keyedEmit());
  }

  async function tapJson(res, descriptor) {
    if (!res || !res.ok || !provider.consumeJson || !claim(res)) return;
    var json = await ownClone(res).json();
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

    // Krijgt fetch een Request-object, dan verbruikt de aanroep de body ervan en
    // is de prompt daarna onleesbaar. De clone moet dus vóór de aanroep bestaan.
    var requestClone = null;
    if (descriptor.type === 'stream' && !(args[1] && args[1].body) &&
        args[0] && typeof args[0] === 'object' && typeof args[0].clone === 'function') {
      try { requestClone = args[0].clone(); } catch (e) { requestClone = null; }
    }

    var pending = originalFetch.apply(this, args);
    pending.then(function (res) {
      var tap = descriptor.type === 'stream' ? tapStream(res, args, descriptor, requestClone) : tapJson(res, descriptor);
      tap.catch(function (err) {
        // Meelezen mag nooit de pagina raken; loggen en verder.
        console.debug('[Fanouts] meelezen mislukt', err);
      });
    }, function () { /* de pagina handelt zijn eigen fout af */ });
    return pending;
  };

  /* ------------------------------------------------- Response-vangnet */

  /*
   * De fetch-wrapper hierboven werkt alleen zolang hij in de keten blijft. Dat
   * is niet gegarandeerd: een andere extensie die window.fetch als accessor
   * installeert (getter geeft haar wrapper, setter onthoudt alleen de laatste
   * toewijzing) laat ons vallen zodra de pagina zelf fetch opnieuw toewijst.
   * We zijn dan onzichtbaar zonder dat er iets faalt.
   *
   * Daarom een tweede route die niet van window.fetch afhangt: hoe de aanroep
   * ook gelopen is, de pagina moet de body van de response lezen. Op dat moment
   * herkennen we de response aan zijn url en lezen een clone mee. De request
   * body is hier niet beschikbaar; de provider haalt de prompt dan uit de stream.
   */
  var inspected = new WeakSet();
  var bodyDescriptor = Object.getOwnPropertyDescriptor(Response.prototype, 'body');

  function lateTap(res) {
    if (inspected.has(res)) return;
    inspected.add(res);
    if (!res.ok || res.bodyUsed || !res.url) return;

    // De methode staat niet op een response. De stream-endpoints zijn POST's,
    // de historie-endpoints GET's, en de url-patronen overlappen niet.
    var descriptor = provider.match(res.url, 'POST') || provider.match(res.url, 'GET');
    if (!descriptor || !claim(res)) return;

    var clone = ownClone(res);
    if (descriptor.type === 'stream') {
      var now = Date.now();
      var ctx = {
        prompt: '', promptId: null, promptTime: now,
        conversationId: descriptor.conversationId || null, descriptor: descriptor
      };
      emit('turn-start', {
        provider: provider.id,
        conversationId: ctx.conversationId,
        prompt: '',
        promptId: null,
        promptTime: now,
        pageUrl: location.href
      });
      provider.consumeStream(bodyDescriptor.get.call(clone), ctx, keyedEmit());
      return;
    }
    if (provider.consumeJson) readJsonClone(clone, descriptor);
  }

  async function readJsonClone(clone, descriptor) {
    try {
      provider.consumeJson(await clone.json(), { conversationId: descriptor.conversationId || null }, emit);
    } catch (err) {
      console.debug('[Fanouts] meelezen mislukt', err);
    }
  }

  function guardedTap(res) {
    try { lateTap(res); } catch (err) { console.debug('[Fanouts] meelezen mislukt', err); }
  }

  if (bodyDescriptor && bodyDescriptor.get && bodyDescriptor.configurable) {
    Object.defineProperty(Response.prototype, 'body', {
      configurable: true,
      enumerable: bodyDescriptor.enumerable,
      get: function () {
        guardedTap(this);
        return bodyDescriptor.get.call(this);
      }
    });

    ['text', 'json', 'arrayBuffer'].forEach(function (name) {
      var original = Response.prototype[name];
      if (typeof original !== 'function') return;
      Response.prototype[name] = function () {
        guardedTap(this);
        return original.apply(this, arguments);
      };
    });
  }

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
          ctx.descriptor = descriptor;

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
