/*
 * Fanouts — ChatGPT provider (MAIN world).
 *
 * Tapt de streaming POST naar /backend-api/conversation af en reconstrueert
 * ChatGPT's delta-encoding tot complete message-objecten. De inhoudelijke
 * extractie (queries, bronnen) gebeurt aan de content-script-kant in parser.js,
 * omdat die ook de historie-route bedient.
 */
(function () {
  'use strict';

  var U = window.__FANOUT_UTIL__;
  var RE_CONV_POST = /\/backend-api\/(?:f\/)?conversation\/?(?:\?|$)/;
  var RE_CONV_GET = /\/backend-api\/(?:f\/)?conversation\/([0-9a-fA-F-]{36})(?:\/|\?|$)/;
  var EMIT_INTERVAL = 400;

  /* ------------------------------------------------------ delta-encoding */

  function pointerKeys(path) {
    if (!path || path === '/') return [];
    return String(path).split('/').slice(1).map(function (k) {
      return k.replace(/~1/g, '/').replace(/~0/g, '~');
    });
  }

  function applyOp(root, path, op, value) {
    var keys = pointerKeys(path);
    if (!keys.length) return;
    var cur = root;
    for (var i = 0; i < keys.length - 1; i++) {
      var k = keys[i];
      if (cur[k] === null || typeof cur[k] !== 'object') {
        cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      }
      cur = cur[k];
    }
    var last = keys[keys.length - 1];
    var target = cur[last];
    if (op === 'append') {
      // "append" betekent per type iets anders: tekst plakt, een array groeit
      // (met een array als waarde: element voor element), een object neemt de
      // sleutels over. Een array als één element pushen of een object vervangen
      // gooit bronnen weg die ChatGPT stukje bij beetje aanlevert.
      if (typeof value === 'string') cur[last] = (typeof target === 'string' ? target : '') + value;
      else if (Array.isArray(target)) {
        if (Array.isArray(value)) Array.prototype.push.apply(target, value);
        else target.push(value);
      } else if (isPlainObject(target) && isPlainObject(value)) {
        for (var vk in value) {
          if (Object.prototype.hasOwnProperty.call(value, vk)) target[vk] = value[vk];
        }
      } else cur[last] = value;
    } else if (op === 'remove') {
      if (Array.isArray(cur)) cur.splice(Number(last), 1);
      else delete cur[last];
    } else if (op === 'truncate') {
      if ((typeof target === 'string' || Array.isArray(target)) && typeof value === 'number') {
        cur[last] = target.slice(0, value);
      }
    } else if (op === 'add' && Array.isArray(cur) && /^\d+$/.test(last)) {
      cur.splice(Number(last), 0, value);
    } else {
      cur[last] = value;
    }
  }

  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function isRoot(v) { return isPlainObject(v) && isPlainObject(v.message); }

  function textOfParts(msg) {
    var parts = (msg && msg.content && msg.content.parts) || [];
    return parts.map(function (p) {
      if (typeof p === 'string') return p;
      if (p && typeof p.text === 'string') return p.text;
      if (p && p.content_type) return '[' + p.content_type + ']';
      return '';
    }).filter(Boolean).join('\n').trim();
  }

  function Accumulator(ctx) {
    this.ctx = ctx;
    this.state = null;
    this.lastPath = null;
    this.lastOp = null;
    this.input = null;
    this.byId = new Map();
    this.order = [];
    this.conversationId = ctx.conversationId || null;
    this.title = null;
    this.model = null;
    this.dirty = false;
  }

  Accumulator.prototype.track = function () {
    var msg = this.state && this.state.message;
    if (!msg || !msg.id) return;
    if (!this.byId.has(msg.id)) this.order.push(msg.id);
    this.byId.set(msg.id, msg);
    if (this.state.conversation_id) this.conversationId = this.state.conversation_id;
    if (msg.metadata && msg.metadata.model_slug) this.model = msg.metadata.model_slug;
    this.dirty = true;
  };

  Accumulator.prototype.newRoot = function (obj) {
    this.state = obj;
    // Pad en operatie blijven "plakken": een volgend event zonder p en o is
    // opnieuw een compleet bericht op de root.
    this.lastPath = '';
    this.lastOp = 'add';
    this.track();
  };

  Accumulator.prototype.handle = function (data) {
    if (data === '[DONE]') return;
    var obj = U.safeParse(data);
    if (obj === null || typeof obj !== 'object') return;

    // 1. Getypeerde events zonder delta
    if (obj.type === 'input_message' && isPlainObject(obj.input_message)) this.input = obj.input_message;
    if (obj.type === 'title_generation' && obj.title) this.title = obj.title;
    if (obj.conversation_id) this.conversationId = obj.conversation_id;

    // 2. Legacy: volledig snapshot per event
    if (obj.message && typeof obj.message === 'object' && obj.type === undefined) {
      this.newRoot(obj);
      return;
    }
    if (obj.v === undefined) return;

    /*
     * 3. Delta. Ontbreken p én o, dan gelden die van het vorige event. ChatGPT
     * stuurt zo een reeks complete berichten ({p:'',o:'add'} en daarna alleen
     * {v:{message}}) en een reeks patches ({o:'patch'} en daarna alleen {v:[…]}).
     * Wie dat niet volgt, houdt alleen het eerste bericht van de stream over.
     */
    var hasPath = obj.p !== undefined;
    var hasOp = obj.o !== undefined;
    var path = hasPath ? obj.p : (hasOp ? null : this.lastPath);
    var op = hasOp ? obj.o : (hasPath ? 'append' : this.lastOp);

    if (isRoot(obj.v) && (!hasPath || path === '' || path === '/')) {
      this.newRoot(obj.v);
      return;
    }
    if (!this.state) return;

    if (Array.isArray(obj.v) && (op === 'patch' || (!hasPath && !hasOp && this.lastOp === 'patch'))) {
      for (var i = 0; i < obj.v.length; i++) {
        var item = obj.v[i];
        if (!item || typeof item !== 'object') continue;
        applyOp(this.state, item.p, item.o || 'replace', item.v);
        this.lastPath = item.p;
      }
      this.lastOp = 'patch';
      this.track();
      return;
    }

    if (path === null || path === undefined) return;
    // Na een batch-patch hoort een kale { v: "…" } bij het laatste pad daarin.
    if (op === 'patch') op = 'append';
    applyOp(this.state, path, op || 'append', obj.v);
    this.lastPath = path;
    this.lastOp = op || 'append';
    this.track();
  };

  Accumulator.prototype.snapshot = function (done) {
    if (!this.dirty && !done) return null;
    this.dirty = false;
    var msgs = [];
    for (var i = 0; i < this.order.length; i++) {
      var m = this.byId.get(this.order[i]);
      if (m) msgs.push(m);
    }
    if (!msgs.length && !done) return null;
    return {
      provider: 'chatgpt',
      source: 'stream',
      done: !!done,
      conversationId: this.conversationId,
      title: this.title,
      model: this.model,
      // Zonder request body (de Response-route in interceptor.js) komt de prompt
      // uit het input_message-event dat ChatGPT zelf terugstuurt. Het id daaruit
      // gaat voor: het is hetzelfde id dat de historie-route gebruikt.
      prompt: this.ctx.prompt || textOfParts(this.input),
      promptId: (this.input && this.input.id) || this.ctx.promptId || null,
      promptTime: (this.input && this.input.create_time && Math.round(this.input.create_time * 1000)) ||
        this.ctx.promptTime || Date.now(),
      pageUrl: location.href,
      messages: JSON.parse(JSON.stringify(msgs))
    };
  };

  /* ------------------------------------------------------------ provider */

  window.__FANOUT_PROVIDERS__ = window.__FANOUT_PROVIDERS__ || [];
  window.__FANOUT_PROVIDERS__.push({
    id: 'chatgpt',

    matchesHost: function (host) {
      return /(^|\.)chatgpt\.com$/.test(host) || /(^|\.)chat\.openai\.com$/.test(host);
    },

    match: function (url, method) {
      if (method === 'POST' && RE_CONV_POST.test(url)) return { type: 'stream' };
      var m = method === 'GET' ? RE_CONV_GET.exec(url) : null;
      if (m) return { type: 'json', conversationId: m[1] };
      return null;
    },

    promptFromRequest: function (bodyText) {
      var ctx = { prompt: '', promptId: null, promptTime: Date.now(), conversationId: null };
      var body = U.safeParse(bodyText);
      if (!body) return ctx;
      if (body.conversation_id) ctx.conversationId = body.conversation_id;
      var msgs = body.messages;
      if (!Array.isArray(msgs)) return ctx;
      for (var i = msgs.length - 1; i >= 0; i--) {
        var m = msgs[i];
        if (!m || !m.author || m.author.role !== 'user') continue;
        ctx.prompt = textOfParts(m);
        ctx.promptId = m.id || null;
        break;
      }
      return ctx;
    },

    consumeStream: function (body, ctx, emit) {
      var acc = new Accumulator(ctx);
      var timer = setInterval(function () {
        var snap = acc.snapshot(false);
        if (snap) emit('turn-update', snap);
      }, EMIT_INTERVAL);

      U.readSse(body, function (data) { acc.handle(data); }, function () {
        clearInterval(timer);
        var snap = acc.snapshot(true);
        if (snap) emit('turn-update', snap);
      });
    },

    consumeText: function (text, ctx, emit) {
      var acc = new Accumulator(ctx);
      U.splitSseText(text).forEach(function (data) { acc.handle(data); });
      var snap = acc.snapshot(true);
      if (snap) emit('turn-update', snap);
    },

    consumeJson: function (json, ctx, emit) {
      if (!json || !json.mapping) return;
      emit('conversation-detail', {
        provider: 'chatgpt',
        source: 'history',
        conversationId: json.conversation_id || ctx.conversationId,
        title: json.title || '',
        pageUrl: location.href,
        mapping: json.mapping
      });
    }
  });
})();
