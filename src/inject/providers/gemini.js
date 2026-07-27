/*
 * Fanouts — Gemini provider (MAIN world).
 *
 * gemini.google.com praat via Google's batchexecute-protocol:
 *
 *     )]}'
 *     <lengte>
 *     [["wrb.fr","XqA3Ic","<JSON-string>",...]]
 *     <lengte>
 *     ...
 *
 * De payload op index 2 is een JSON-string met daarin geneste, *positionele*
 * arrays — er zijn geen veldnamen. Extractie op pad is dus onmogelijk; we
 * ankeren op patronen die wél stabiel zijn:
 *
 *   - zoekopdrachten  → de google.com/search?q=…-links achter de "Google Search"-
 *                        chips, plus stringarrays die naast een groundingblok staan
 *   - bronnen         → vertexaisearch grounding-redirects met hun buurstrings
 *
 * Verandert Google de codering, dan valt dit terug op minder resultaat in plaats
 * van op een harde fout. Zet "ruwe payloads bewaren" aan om te kunnen bijstellen.
 */
(function () {
  'use strict';

  var U = window.__FANOUT_UTIL__;
  var EMIT_INTERVAL = 600;

  var RE_GROUNDING = /^https?:\/\/[^\s"']*vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\//i;
  var RE_GOOGLE_SEARCH = /^https?:\/\/(?:www\.)?google\.[a-z.]{2,6}\/search\?/i;
  var RE_BARE_DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+$/i;
  var RE_ID = /^(?:c_|r_|rc_|conv_|msg_)[0-9a-z_-]+$/i;
  var INFRA = /(?:gstatic\.com|googleusercontent\.com|googleapis\.com|accounts\.google\.com|encrypted-tbn|\.google\.com\/(?:imgres|url)\b)/i;

  /* --------------------------------------------------- batchexecute lezen */

  function parseBatchExecute(text) {
    var body = String(text || '').replace(/^\)\]\}'\s*/, '');
    var out = [];
    var i = 0;

    while (i < body.length) {
      var nl = body.indexOf('\n', i);
      if (nl === -1) break;
      var head = body.slice(i, nl).trim();
      if (!/^\d+$/.test(head)) { i = nl + 1; continue; }
      var len = parseInt(head, 10);
      var chunk = body.substr(nl + 1, len);
      i = nl + 1 + len;
      var parsed = U.safeParse(chunk);
      if (parsed) out.push(parsed);
    }

    // Vangnet als de lengteprefixen niet kloppen (afgekapte of gewijzigde stream)
    if (!out.length) {
      body.split('\n').forEach(function (line) {
        var t = line.trim();
        if (t.charAt(0) !== '[') return;
        var p = U.safeParse(t);
        if (p) out.push(p);
      });
    }
    return out;
  }

  /* ------------------------------------------------------------ extractie */

  function isQueryString(v) {
    if (typeof v !== 'string') return false;
    var t = v.trim();
    if (t.length < 3 || t.length > 200) return false;
    if (/^https?:\/\//i.test(t)) return false;
    if (RE_ID.test(t)) return false;
    if (RE_BARE_DOMAIN.test(t)) return false;
    if (/[\n\r]/.test(t)) return false;
    if (/^[\d\W_]+$/.test(t)) return false;
    return true;
  }

  function queryFromSearchUrl(url) {
    try {
      var q = new URL(url).searchParams.get('q');
      return q ? q.replace(/\+/g, ' ') : null;
    } catch (e) { return null; }
  }

  function extract(chunks) {
    var queries = new U.QuerySet();
    var sources = new U.SourceSet();
    var conversationId = null;
    var answer = '';

    var deep;
    try { deep = U.deepJsonParse(chunks); } catch (e) { deep = chunks; }

    /* 1. Ankerpunt: elk array-element dat een URL is. */
    U.walk(deep, function (node, key) {
      if (typeof node === 'string') {
        if (RE_GOOGLE_SEARCH.test(node)) {
          var q = queryFromSearchUrl(node);
          if (q) queries.add(q, 'search');
          return;
        }
        if (RE_ID.test(node) && node.charAt(0) === 'c' && !conversationId) conversationId = node;
        // Antwoordtekst: de langste prozastring in de payload.
        if (node.length > 60 && node.length > answer.length && /\s/.test(node) &&
            !/^https?:\/\//i.test(node) && node.indexOf('"') !== 0) {
          answer = node;
        }
        return;
      }
      // Sleutelvorm komt soms wél voor (grounding metadata als echt JSON).
      if (typeof key === 'string' && /^(webSearchQueries|web_search_queries|searchQueries)$/.test(key) && Array.isArray(node)) {
        node.forEach(function (q) { queries.add(q, 'search'); });
      }
      if (typeof key === 'string' && key === 'web' && node && typeof node === 'object' && U.isHttpUrl(node.uri)) {
        sources.add({ url: node.uri, domain: node.domain || null, title: node.title || '' });
      }
    }, { maxDepth: 20, maxNodes: 120000 });

    /*
     * 2. Groundingblokken. Eén bottom-up pass die per array teruggeeft hoe dicht
     *    de dichtstbijzijnde grounding-URL zit. De zoekopdrachten staan in de
     *    grounding-metadata náást de bronnenlijst:
     *
     *      [ ["query een","query twee"],            ← afstand ∞
     *        [ [url,titel,domein], [url,…] ] ]      ← afstand 1
     *
     *    Alleen op dát niveau — een directe buur van de bronnenlijst — pakken we
     *    stringarrays op als queries. Zonder die afstandsgrens zou de regel
     *    hogerop in de boom willekeurige tekst binnenhalen.
     */
    var INF = Infinity;

    function visit(node, depth) {
      if (depth > 22 || !Array.isArray(node)) return INF;

      var best = INF;
      var urlIdx = -1;
      for (var i = 0; i < node.length; i++) {
        if (typeof node[i] !== 'string') continue;
        if (RE_GROUNDING.test(node[i])) { best = 0; if (urlIdx === -1) urlIdx = i; }
        else if (urlIdx === -1 && U.isHttpUrl(node[i]) && !INFRA.test(node[i]) && !RE_GOOGLE_SEARCH.test(node[i])) {
          urlIdx = i;
        }
      }

      if (urlIdx !== -1) {
        var domain = null, title = '';
        for (var j = 0; j < node.length; j++) {
          if (j === urlIdx || typeof node[j] !== 'string') continue;
          var str = node[j].trim();
          if (!str) continue;
          if (!domain && RE_BARE_DOMAIN.test(str)) { domain = str.replace(/^www\./, ''); continue; }
          if (str.length > title.length && str.length < 300 && !RE_ID.test(str)) title = str;
        }
        sources.add({ url: node[urlIdx], domain: domain, title: title });
      }

      var childDist = new Array(node.length);
      for (var k = 0; k < node.length; k++) {
        var d = visit(node[k], depth + 1);
        childDist[k] = d;
        if (d + 1 < best) best = d + 1;
      }

      var nearGrounding = childDist.some(function (d) { return d <= 1; });
      if (nearGrounding && node.length <= 24) {
        node.forEach(function (c, idx) {
          if (childDist[idx] !== INF) return;          // dat is de bronnenkant
          if (!Array.isArray(c) || !c.length || c.length > 20) return;
          if (!c.every(isQueryString)) return;
          c.forEach(function (q) { queries.add(q, 'search'); });
        });
      }

      return best;
    }
    visit(deep, 0);

    return {
      fanout: queries.list,
      sources: sources.list,
      answer: answer,
      conversationId: conversationId
    };
  }

  /* ---------------------------------------------------------- accumulator */

  function Accumulator(ctx) {
    this.ctx = ctx;
    this.text = '';
    this.queries = new U.QuerySet();
    this.sources = new U.SourceSet();
    this.answer = '';
    this.conversationId = ctx.conversationId || null;
    this.dirty = false;
  }

  Accumulator.prototype.ingest = function (text) {
    this.text = text;
    var e;
    try { e = extract(parseBatchExecute(text)); } catch (err) { return; }
    var self = this;
    e.fanout.forEach(function (q) { self.queries.add(q.q, q.kind); });
    e.sources.forEach(function (s) { self.sources.add(s); });
    if (e.answer.length > this.answer.length) this.answer = e.answer;
    if (e.conversationId && !this.conversationId) this.conversationId = e.conversationId;
    this.dirty = true;
  };

  Accumulator.prototype.snapshot = function (done) {
    if (!this.dirty && !done) return null;
    this.dirty = false;
    if (!this.queries.list.length && !this.sources.list.length && !done) return null;
    return {
      provider: 'gemini',
      source: 'stream',
      capture: true,
      done: !!done,
      conversationId: this.conversationId || (/\/app\/([0-9a-f]+)/.exec(location.pathname) || [])[1] || null,
      title: (this.ctx.prompt || '').slice(0, 80),
      model: this.ctx.model || null,
      prompt: this.ctx.prompt || '',
      promptId: this.ctx.promptId || null,
      promptTime: this.ctx.promptTime || Date.now(),
      pageUrl: location.href,
      fanout: this.queries.list,
      sources: this.sources.list,
      related: [],
      answer: this.answer
    };
  };

  /* ------------------------------------------------------------ provider */

  window.__FANOUT_PROVIDERS__ = window.__FANOUT_PROVIDERS__ || [];
  window.__FANOUT_PROVIDERS__.push({
    id: 'gemini',

    matchesHost: function (host) {
      return /(^|\.)gemini\.google\.com$/.test(host) || /(^|\.)bard\.google\.com$/.test(host);
    },

    match: function (url, method) {
      if (method !== 'POST') return null;
      if (/StreamGenerate/i.test(url) || /BardFrontendService/i.test(url)) return { type: 'stream', raw: true };
      if (/\/batchexecute/i.test(url)) return { type: 'stream', raw: true };
      return null;
    },

    /*
     * De prompt zit in het form-encoded veld f.req, twee JSON-lagen diep:
     *   f.req = [null, "[[\"mijn vraag\"],null,[\"c_…\",\"r_…\"]]"]
     */
    promptFromRequest: function (bodyText) {
      var ctx = { prompt: '', promptId: null, promptTime: Date.now(), conversationId: null };
      if (!bodyText) return ctx;
      var req = null;
      try {
        req = new URLSearchParams(bodyText).get('f.req');
      } catch (e) { /* geen form-encoding */ }
      var payload = U.deepJsonParse(req || bodyText);

      var best = '';
      U.walk(payload, function (node) {
        if (typeof node !== 'string') return;
        if (RE_ID.test(node)) {
          if (node.charAt(0) === 'c' && !ctx.conversationId) ctx.conversationId = node;
          if (node.charAt(0) === 'r' && !ctx.promptId) ctx.promptId = node;
          return;
        }
        if (node.length > best.length && node.length < 8000 && !/^https?:/i.test(node)) best = node;
      }, { maxDepth: 12 });
      ctx.prompt = best.trim();
      return ctx;
    },

    consumeStream: function (body, ctx, emit) {
      var acc = new Accumulator(ctx);
      var timer = setInterval(function () {
        var snap = acc.snapshot(false);
        if (snap) emit('turn-update', snap);
      }, EMIT_INTERVAL);

      U.readText(body, null, function (text) {
        clearInterval(timer);
        acc.ingest(text);
        var snap = acc.snapshot(true);
        if (snap) emit('turn-update', snap);
      });
    },

    consumeText: function (text, ctx, emit) {
      var acc = new Accumulator(ctx);
      acc.ingest(text);
      var snap = acc.snapshot(true);
      if (snap) emit('turn-update', snap);
    },

    _extract: extract,
    _parseBatchExecute: parseBatchExecute
  });
})();
