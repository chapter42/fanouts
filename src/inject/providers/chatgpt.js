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
    if (op === 'append') {
      if (typeof value === 'string') cur[last] = (typeof cur[last] === 'string' ? cur[last] : '') + value;
      else if (Array.isArray(cur[last])) cur[last].push(value);
      else cur[last] = value;
    } else if (op === 'remove') {
      if (Array.isArray(cur)) cur.splice(Number(last), 1);
      else delete cur[last];
    } else {
      cur[last] = value;
    }
  }

  function Accumulator(ctx) {
    this.ctx = ctx;
    this.state = null;
    this.lastPath = null;
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
    this.lastPath = null;
    this.track();
  };

  Accumulator.prototype.handle = function (data) {
    if (data === '[DONE]') return;
    var obj = U.safeParse(data);
    if (obj === null || typeof obj !== 'object') return;

    // 1. Nieuwe root — beide varianten die ChatGPT gebruikt
    var isRootAdd = (obj.p === '' || obj.p === '/') && obj.v && typeof obj.v === 'object' && obj.v.message;
    if (isRootAdd || (obj.type === 'delta' && obj.v && typeof obj.v === 'object' && obj.p === undefined)) {
      this.newRoot(obj.v);
      return;
    }
    // 2. Legacy: volledig snapshot per event
    if (obj.message && typeof obj.message === 'object' && obj.type === undefined) {
      this.newRoot(obj);
      return;
    }
    // 3. Batch-patch
    if (obj.o === 'patch' && Array.isArray(obj.v)) {
      for (var i = 0; i < obj.v.length; i++) {
        var op = obj.v[i];
        if (!op || typeof op !== 'object') continue;
        if (this.state) applyOp(this.state, op.p, op.o || 'replace', op.v);
        this.lastPath = op.p;
      }
      this.track();
      return;
    }
    // 4. Enkelvoudige op met pad
    if (obj.p !== undefined && this.state) {
      applyOp(this.state, obj.p, obj.o || 'append', obj.v);
      this.lastPath = obj.p;
      this.track();
      return;
    }
    // 5. "Sticky path": alleen { v: "…" } → append op het laatste pad
    if (obj.v !== undefined && obj.p === undefined && obj.o === undefined && this.lastPath && this.state) {
      applyOp(this.state, this.lastPath, 'append', obj.v);
      this.track();
      return;
    }
    // 6. Overige getypeerde events
    if (obj.type === 'title_generation' && obj.title) this.title = obj.title;
    if (obj.conversation_id) this.conversationId = obj.conversation_id;
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
      prompt: this.ctx.prompt || '',
      promptId: this.ctx.promptId || null,
      promptTime: this.ctx.promptTime || Date.now(),
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
        var parts = (m.content && m.content.parts) || [];
        ctx.prompt = parts.map(function (p) {
          if (typeof p === 'string') return p;
          if (p && typeof p.text === 'string') return p.text;
          if (p && p.content_type) return '[' + p.content_type + ']';
          return '';
        }).filter(Boolean).join('\n').trim();
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
