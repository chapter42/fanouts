/*
 * Fanouts — gedeelde helpers voor de MAIN-world providers.
 *
 * Wordt vóór de providers en de interceptor geladen; alles hangt aan
 * window.__FANOUT_UTIL__ omdat content scripts in dezelfde wereld globals delen.
 */
(function () {
  'use strict';

  if (window.__FANOUT_UTIL__) return;

  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  function isHttpUrl(u) { return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u); }

  function domainOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return null; }
  }

  function normQuery(q) {
    if (typeof q !== 'string') return null;
    var t = q.trim().replace(/\s+/g, ' ');
    if (!t || t.length > 500) return null;
    return t;
  }

  /*
   * Loopt door een structuur en roept visit(node, key, parent) aan.
   * Begrensd op diepte en aantal nodes: sommige payloads (Gemini) zijn enorm.
   */
  function walk(root, visit, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 14;
    var budget = { n: opts.maxNodes || 40000 };

    function rec(node, key, parent, depth) {
      if (budget.n-- <= 0 || depth > maxDepth) return;
      visit(node, key, parent, depth);
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) rec(node[i], key, node, depth + 1);
        return;
      }
      if (node && typeof node === 'object') {
        for (var k in node) {
          if (Object.prototype.hasOwnProperty.call(node, k)) rec(node[k], k, node, depth + 1);
        }
      }
    }
    rec(root, null, null, 0);
  }

  /*
   * Perplexity en Gemini stoppen JSON in JSON-strings, soms twee lagen diep.
   * Deze functie pakt dat uit zodat één deep-scan genoeg is.
   */
  function deepJsonParse(value, depth) {
    depth = depth || 0;
    if (depth > 6) return value;

    if (typeof value === 'string') {
      var t = value.trim();
      if (t.length > 1 && t.length < 6000000 && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
        var parsed = safeParse(t);
        if (parsed !== null && typeof parsed === 'object') return deepJsonParse(parsed, depth + 1);
      }
      return value;
    }
    if (Array.isArray(value)) {
      var arr = new Array(value.length);
      for (var i = 0; i < value.length; i++) arr[i] = deepJsonParse(value[i], depth);
      return arr;
    }
    if (value && typeof value === 'object') {
      var out = {};
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = deepJsonParse(value[k], depth);
      }
      return out;
    }
    return value;
  }

  /*
   * SSE-frames uit een ReadableStream. onEvent krijgt de samengevoegde
   * data-regels van één frame; onEnd loopt als de stream klaar is.
   */
  function readSse(body, onEvent, onEnd) {
    var reader = body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buffer = '';

    function handleBlock(block) {
      var lines = block.split('\n');
      var data = [];
      var name = null;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line || line.charAt(0) === ':') continue;
        if (line.indexOf('event:') === 0) { name = line.slice(6).trim(); continue; }
        if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) onEvent(data.join('\n'), name);
    }

    function flush(force) {
      var idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        handleBlock(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
      if (force && buffer.trim()) { handleBlock(buffer); buffer = ''; }
    }

    return (async function pump() {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          flush(false);
        }
        buffer += decoder.decode();
        flush(true);
      } catch (err) {
        // Stream afgebroken (navigatie, netwerk). Wat we hebben is nog bruikbaar.
        console.debug('[Fanouts] SSE-stream afgebroken', err);
      }
      onEnd();
    })();
  }

  /* Splitst een complete SSE-body in losse data-payloads. */
  function splitSseText(text) {
    var out = [];
    String(text || '').split(/\n\n/).forEach(function (block) {
      var data = [];
      block.split('\n').forEach(function (line) {
        if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
      });
      if (data.length) out.push(data.join('\n'));
    });
    return out;
  }

  /* Leest een stream als platte tekst, met tussentijdse callbacks. */
  function readText(body, onChunk, onEnd) {
    var reader = body.getReader();
    var decoder = new TextDecoder('utf-8');
    var text = '';

    return (async function pump() {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (onChunk) onChunk(text);
        }
        text += decoder.decode();
      } catch (err) {
        console.debug('[Fanouts] stream afgebroken', err);
      }
      onEnd(text);
    })();
  }

  /* Verzamelaars die duplicaten meteen wegnemen. */
  function QuerySet() { this.seen = {}; this.list = []; }
  QuerySet.prototype.add = function (q, kind, extra) {
    var t = normQuery(q);
    if (!t) return;
    kind = kind || 'search';
    var key = kind + '|' + t.toLowerCase();
    if (this.seen[key]) return;
    this.seen[key] = 1;
    var item = { q: t, kind: kind, domains: null, recency: null };
    if (extra) {
      if (extra.domains) item.domains = extra.domains;
      if (extra.recency !== undefined) item.recency = extra.recency;
    }
    this.list.push(item);
  };

  function SourceSet() { this.seen = {}; this.list = []; }
  SourceSet.prototype.add = function (src) {
    if (!src || !isHttpUrl(src.url)) return;
    var key = src.url.toLowerCase();
    var existing = this.seen[key];
    if (existing) {
      if (!existing.title && src.title) existing.title = src.title;
      if (!existing.snippet && src.snippet) existing.snippet = src.snippet;
      if (!existing.domain && src.domain) existing.domain = src.domain;
      if (src.origin === 'citation') existing.origin = 'citation';
      return;
    }
    var item = {
      url: src.url,
      domain: src.domain || domainOf(src.url),
      title: String(src.title || '').trim().slice(0, 300),
      snippet: String(src.snippet || '').trim().slice(0, 600),
      pubDate: src.pubDate || null,
      origin: src.origin || 'search_results'
    };
    this.seen[key] = item;
    this.list.push(item);
  };

  window.__FANOUT_UTIL__ = {
    safeParse: safeParse,
    isHttpUrl: isHttpUrl,
    domainOf: domainOf,
    normQuery: normQuery,
    walk: walk,
    deepJsonParse: deepJsonParse,
    readSse: readSse,
    splitSseText: splitSseText,
    readText: readText,
    QuerySet: QuerySet,
    SourceSet: SourceSet
  };
})();
