/*
 * Fanouts — Perplexity provider (MAIN world).
 *
 * Perplexity streamt via SSE op /rest/sse/perplexity_ask. Elk event bevat een
 * cumulatieve snapshot van de hele beurt, maar het formaat verschilt per versie:
 * de oudere vorm stopt een JSON-string in `text` met `step_type`-blokken, de
 * nieuwere gebruikt `blocks` met `plan_block` / `web_result_block` /
 * `markdown_block`.
 *
 * Daarom extraheren we hier niet op een vast pad maar op herkenbare sleutels,
 * na de payload eerst volledig uit te pakken (JSON-in-JSON). Dat overleeft een
 * herschikking van de structuur.
 */
(function () {
  'use strict';

  var U = window.__FANOUT_UTIL__;
  var EMIT_INTERVAL = 500;

  var QUERY_KEYS = /^(queries|search_queries|web_search_queries|sub_queries|expanded_queries|search_query)$/i;
  var RELATED_KEYS = /^(related_queries|related_questions|followup_queries)$/i;
  // "Searching for X" / "Search the web for X" / "Zoeken naar X"
  var GOAL_QUERY = /^(?:search(?:ing)?(?:\s+the\s+web)?(?:\s+for)?|zoek(?:en)?(?:\s+naar)?|looking\s+up)\s*[:\-—]?\s*["“']?(.{2,300}?)["”']?\s*$/i;

  function extract(root) {
    var queries = new U.QuerySet();
    var related = new U.QuerySet();
    var sources = new U.SourceSet();
    var out = { prompt: '', answer: '', model: null, conversationId: null, title: '' };

    var deep;
    try { deep = U.deepJsonParse(root); } catch (e) { deep = root; }

    U.walk(deep, function (node, key) {
      if (typeof key === 'string') {
        // --- queries -----------------------------------------------------
        if (QUERY_KEYS.test(key)) {
          var list = Array.isArray(node) ? node : [node];
          list.forEach(function (q) {
            if (typeof q === 'string') queries.add(q, 'search');
            else if (q && typeof q === 'object') queries.add(q.q || q.query || q.text, 'search');
          });
        }
        if (RELATED_KEYS.test(key) && Array.isArray(node)) {
          node.forEach(function (q) {
            queries.add(typeof q === 'string' ? q : (q && (q.text || q.query)), 'related');
            related.add(typeof q === 'string' ? q : (q && (q.text || q.query)), 'related');
          });
        }
        // Pro Search zet de deelvragen als leesbare stap-omschrijving neer.
        if ((key === 'goals' || key === 'todo_items' || key === 'steps') && Array.isArray(node)) {
          node.forEach(function (g) {
            if (!g || typeof g !== 'object') return;
            var desc = g.description || g.title || g.goal || g.text;
            if (typeof desc !== 'string') return;
            var m = GOAL_QUERY.exec(desc.trim());
            if (m) queries.add(m[1], 'search');
          });
        }
        // --- context ------------------------------------------------------
        if (key === 'query_str' && typeof node === 'string' && node.length > out.prompt.length) out.prompt = node;
        if ((key === 'display_model' || key === 'model' || key === 'mode') && typeof node === 'string' && !out.model) out.model = node;
        if ((key === 'context_uuid' || key === 'thread_url_slug' || key === 'backend_uuid') && typeof node === 'string' && !out.conversationId) {
          out.conversationId = node;
        }
        if ((key === 'answer' || key === 'markdown') && typeof node === 'string' && node.length > out.answer.length) {
          out.answer = node;
        }
      }

      // --- bronnen --------------------------------------------------------
      if (node && typeof node === 'object' && !Array.isArray(node) && U.isHttpUrl(node.url)) {
        sources.add({
          url: node.url,
          title: node.name || node.title || '',
          snippet: node.snippet || node.text || node.description || '',
          pubDate: node.publishedDate || node.published_date || node.date || null,
          origin: node.is_citation || node.is_client_context ? 'citation' : 'search_results'
        });
      }
    }, { maxDepth: 16 });

    return {
      fanout: queries.list,
      sources: sources.list,
      related: related.list.map(function (r) { return r.q; }),
      prompt: out.prompt,
      answer: out.answer,
      model: out.model,
      conversationId: out.conversationId
    };
  }

  /* Voegt opeenvolgende snapshots samen; Perplexity stuurt cumulatief. */
  function Accumulator(ctx) {
    this.ctx = ctx;
    this.queries = new U.QuerySet();
    this.sources = new U.SourceSet();
    this.related = [];
    this.answer = '';
    this.prompt = ctx.prompt || '';
    this.model = null;
    this.conversationId = ctx.conversationId || null;
    this.dirty = false;
  }

  Accumulator.prototype.handle = function (data) {
    if (!data || data === '[DONE]') return;
    var obj = U.safeParse(data);
    if (!obj || typeof obj !== 'object') return;
    var e = extract(obj);
    var self = this;
    e.fanout.forEach(function (q) { self.queries.add(q.q, q.kind); });
    e.sources.forEach(function (s) { self.sources.add(s); });
    e.related.forEach(function (r) { if (self.related.indexOf(r) === -1) self.related.push(r); });
    if (e.answer.length > this.answer.length) this.answer = e.answer;
    if (e.prompt && e.prompt.length > this.prompt.length) this.prompt = e.prompt;
    if (e.model && !this.model) this.model = e.model;
    if (e.conversationId && !this.conversationId) this.conversationId = e.conversationId;
    this.dirty = true;
  };

  Accumulator.prototype.snapshot = function (done) {
    if (!this.dirty && !done) return null;
    this.dirty = false;
    if (!this.queries.list.length && !this.sources.list.length && !this.answer && !done) return null;
    var slug = /\/search\/([^/?#]+)/.exec(location.pathname);
    return {
      provider: 'perplexity',
      source: 'stream',
      capture: true,
      done: !!done,
      conversationId: this.conversationId || (slug && slug[1]) || null,
      title: this.prompt.slice(0, 80),
      model: this.model,
      prompt: this.prompt,
      promptId: this.ctx.promptId || null,
      promptTime: this.ctx.promptTime || Date.now(),
      pageUrl: location.href,
      fanout: this.queries.list,
      sources: this.sources.list,
      related: this.related,
      answer: this.answer
    };
  };

  /* ------------------------------------------------------------ provider */

  window.__FANOUT_PROVIDERS__ = window.__FANOUT_PROVIDERS__ || [];
  window.__FANOUT_PROVIDERS__.push({
    id: 'perplexity',

    matchesHost: function (host) { return /(^|\.)perplexity\.ai$/.test(host); },

    match: function (url, method) {
      if (method === 'POST' && /\/rest\/sse\//.test(url)) return { type: 'stream' };
      if (method === 'POST' && /\/(perplexity_ask|perplexity_labs)\b/.test(url)) return { type: 'stream' };
      if (method === 'GET' && /\/rest\/thread\//.test(url)) return { type: 'json' };
      return null;
    },

    promptFromRequest: function (bodyText) {
      var ctx = { prompt: '', promptId: null, promptTime: Date.now(), conversationId: null };
      var body = U.safeParse(bodyText);
      if (!body) return ctx;
      U.walk(body, function (node, key) {
        if (key === 'query_str' && typeof node === 'string' && node.length > ctx.prompt.length) ctx.prompt = node;
        if (key === 'frontend_uuid' && typeof node === 'string' && !ctx.promptId) ctx.promptId = node;
        if (key === 'last_backend_uuid' && typeof node === 'string' && !ctx.conversationId) ctx.conversationId = node;
      }, { maxDepth: 6 });
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

    /* Thread-historie: één respons met alle beurten. */
    consumeJson: function (json, ctx, emit) {
      if (!json) return;
      var entries = Array.isArray(json) ? json : (json.entries || json.thread || json.results || [json]);
      if (!Array.isArray(entries)) entries = [entries];
      entries.forEach(function (entry, i) {
        var e = extract(entry);
        if (!e.fanout.length && !e.sources.length && !e.answer) return;
        emit('turn-update', {
          provider: 'perplexity',
          source: 'history',
          capture: true,
          done: true,
          conversationId: e.conversationId || ctx.conversationId || null,
          title: (e.prompt || '').slice(0, 80),
          model: e.model,
          prompt: e.prompt,
          promptId: e.conversationId || ('thread-' + i),
          promptTime: Date.now(),
          pageUrl: location.href,
          fanout: e.fanout,
          sources: e.sources,
          related: e.related,
          answer: e.answer
        });
      });
    },

    _extract: extract
  });
})();
