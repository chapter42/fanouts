/*
 * Fanouts — parser.
 *
 * Zet ruwe ChatGPT message-objecten om in "turns": prompt → fan-out queries →
 * bronnen → antwoord. Bewust defensief geschreven: ChatGPT's interne formaat
 * verandert regelmatig, dus naast gerichte extractie zit er een deep-scan als
 * vangnet zodat we bij formaatwijzigingen nooit met lege handen staan.
 */
;(function (root) {
  'use strict';

  var WEB_RECIPIENTS = { web: 1, browser: 1, 'web.run': 1, search: 1, 'browser.search': 1 };
  var MAX_QUERY_LEN = 500;

  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  function domainOf(url) {
    try {
      var h = new URL(url).hostname.toLowerCase();
      return h.replace(/^www\./, '');
    } catch (e) { return null; }
  }

  function stripUtm(url) {
    try {
      var u = new URL(url);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'oai'].forEach(function (p) {
        u.searchParams.delete(p);
      });
      return u.toString();
    } catch (e) { return url; }
  }

  function textOf(msg) {
    var c = msg && msg.content;
    if (!c) return '';
    if (Array.isArray(c.parts)) {
      return c.parts.map(function (p) {
        if (typeof p === 'string') return p;
        if (p && typeof p.text === 'string') return p.text;
        return '';
      }).filter(Boolean).join('\n').trim();
    }
    if (typeof c.text === 'string') return c.text;
    if (typeof c.result === 'string') return c.result;
    return '';
  }

  function isHidden(msg) {
    var md = msg && msg.metadata;
    return !!(md && (md.is_visually_hidden_from_conversation || md.rebase_system_message));
  }

  /* ===================================================================== */
  /* Queries                                                               */
  /* ===================================================================== */

  function normalizeQuery(q) {
    if (typeof q !== 'string') return null;
    var t = q.trim().replace(/\s+/g, ' ');
    if (!t || t.length > MAX_QUERY_LEN) return null;
    return t;
  }

  function extractQueries(msg) {
    var out = [];
    var seen = {};

    function push(q, kind, extra) {
      var t = normalizeQuery(q);
      if (!t) return;
      var key = (kind || 'search') + '|' + t.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      var item = { q: t, kind: kind || 'search', domains: null, recency: null };
      if (extra) {
        if (extra.domains) item.domains = extra.domains;
        if (extra.recency !== undefined) item.recency = extra.recency;
      }
      out.push(item);
    }

    var content = msg && msg.content;
    var ct = content && content.content_type;
    var text = textOf(msg);
    var recipient = msg && msg.recipient;
    var md = (msg && msg.metadata) || {};

    // --- 1. tool-call payload (assistant → web) -------------------------
    var looksLikeToolCall =
      ct === 'code' &&
      (WEB_RECIPIENTS[recipient] || /"?search_query"?\s*:|(^|\n)\s*search\(/.test(text || ''));

    if (looksLikeToolCall && text) {
      var payload = safeParse(text);
      if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.search_query)) {
          payload.search_query.forEach(function (o) {
            if (typeof o === 'string') push(o, 'search');
            else if (o) push(o.q || o.query, 'search', { domains: o.domains || null, recency: o.recency });
          });
        } else if (typeof payload.search_query === 'string') {
          push(payload.search_query, 'search');
        }
        if (Array.isArray(payload.queries)) {
          payload.queries.forEach(function (o) { push(typeof o === 'string' ? o : (o && o.q), 'search'); });
        }
        if (Array.isArray(payload.image_query)) {
          payload.image_query.forEach(function (o) { push(typeof o === 'string' ? o : (o && o.q), 'image'); });
        } else if (typeof payload.image_query === 'string') {
          push(payload.image_query, 'image');
        }
        if (Array.isArray(payload.open)) {
          payload.open.forEach(function (o) { push(typeof o === 'string' ? o : (o && (o.ref_id || o.url)), 'open'); });
        }
        if (Array.isArray(payload.find)) {
          payload.find.forEach(function (o) { push(o && (o.pattern || o.q), 'find'); });
        }
        if (Array.isArray(payload.click)) {
          payload.click.forEach(function (o) { push(typeof o === 'string' ? o : (o && o.ref_id), 'click'); });
        }
      } else {
        // Legacy-syntax:  search("...")  /  mclick([...])  /  open_url("...")
        var re = /\b(search|image_query|open_url|mclick|quote|find)\s*\(\s*(["'])((?:\\.|(?!\2)[^\\])*)\2/g;
        var m;
        while ((m = re.exec(text)) !== null) push(m[3], m[1] === 'search' ? 'search' : m[1]);
        // Half-gestreamde JSON: pak losse "q"-velden op
        if (!out.length) {
          var re2 = /"q"\s*:\s*"((?:\\.|[^"\\])*)"/g;
          while ((m = re2.exec(text)) !== null) push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'), 'search');
        }
      }
    }

    // --- 2. metadata-velden ---------------------------------------------
    if (Array.isArray(md.search_queries)) {
      md.search_queries.forEach(function (o) {
        if (typeof o === 'string') push(o, 'search');
        else if (o) push(o.q || o.query, o.type === 'image_query' ? 'image' : 'search');
      });
    }
    if (md.command === 'search' && Array.isArray(md.args)) {
      md.args.forEach(function (a) { if (typeof a === 'string') push(a, 'search'); });
    }
    if (md.search_display_string) push(md.search_display_string, 'search');
    if (md.finish_details && Array.isArray(md.finish_details.search_queries)) {
      md.finish_details.search_queries.forEach(function (o) { push(o && (o.q || o), 'search'); });
    }

    return out;
  }

  /* ===================================================================== */
  /* Bronnen                                                               */
  /* ===================================================================== */

  function makeSource(raw, origin) {
    if (!raw) return null;
    var url = raw.url || raw.link || raw.source_url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    var d = domainOf(url);
    if (!d) return null;
    return {
      url: stripUtm(url),
      domain: d,
      title: String(raw.title || raw.name || raw.text_title || '').trim().slice(0, 300),
      snippet: String(raw.snippet || raw.text || raw.description || '').trim().slice(0, 600),
      pubDate: raw.pub_date || raw.publication_date || raw.published_time || null,
      attribution: String(raw.attribution || raw.attribution_segments && raw.attribution_segments[0] || '').trim() || null,
      origin: origin
    };
  }

  function extractSources(msg) {
    var out = [];
    var seen = {};
    function add(raw, origin) {
      var s = makeSource(raw, origin);
      if (!s) return;
      var k = s.url.toLowerCase();
      if (seen[k]) {
        // "citation" is sterker bewijs dan "search_results": upgraden
        if (origin === 'citation') seen[k].origin = 'citation';
        if (!seen[k].title && s.title) seen[k].title = s.title;
        if (!seen[k].snippet && s.snippet) seen[k].snippet = s.snippet;
        return;
      }
      seen[k] = s;
      out.push(s);
    }

    var md = (msg && msg.metadata) || {};

    // Zoekresultaten, gegroepeerd per domein
    if (Array.isArray(md.search_result_groups)) {
      md.search_result_groups.forEach(function (g) {
        (g && g.entries || []).forEach(function (e) { add(e, 'search_results'); });
      });
    }
    if (Array.isArray(md.search_results)) md.search_results.forEach(function (e) { add(e, 'search_results'); });

    // Content references = wat daadwerkelijk in het antwoord geciteerd wordt
    if (Array.isArray(md.content_references)) {
      md.content_references.forEach(function (r) {
        if (!r) return;
        if (r.url) add(r, 'citation');
        (r.items || []).forEach(function (i) { add(i, 'citation'); });
        (r.sources || []).forEach(function (i) { add(i, 'citation'); });
        (r.fallback_items || []).forEach(function (i) { add(i, 'citation'); });
        (r.refs || []).forEach(function (i) { if (i && i.url) add(i, 'citation'); });
      });
    }
    if (Array.isArray(md.citations)) {
      md.citations.forEach(function (c) { add((c && c.metadata) || c, 'citation'); });
    }

    // tether_quote / tether_browsing_display
    var content = msg && msg.content;
    if (content && content.content_type === 'tether_quote') {
      add({ url: content.url, title: content.title, text: content.text }, 'quote');
    }
    if (content && content.content_type === 'tether_browsing_display') {
      var res = String(content.result || '');
      var re = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
      var m;
      while ((m = re.exec(res)) !== null) add({ title: m[1], url: m[2] }, 'search_results');
      if (!out.length) {
        var bare = res.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
        bare.slice(0, 60).forEach(function (u) { add({ url: u }, 'search_results'); });
      }
    }

    // Tool-antwoord dat als platte tekst binnenkomt
    if (msg && msg.author && msg.author.role === 'tool' && !out.length) {
      var t = textOf(msg);
      if (t) {
        var urls = t.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
        urls.slice(0, 60).forEach(function (u) { add({ url: u }, 'search_results'); });
      }
    }

    return out;
  }

  /* Citaat-ankers: welke bron hangt aan welk stuk antwoordtekst. */
  function extractCitations(msg) {
    var out = [];
    var md = (msg && msg.metadata) || {};
    if (!Array.isArray(md.content_references)) return out;
    md.content_references.forEach(function (r) {
      if (!r) return;
      var urls = [];
      if (r.url) urls.push(r.url);
      (r.items || []).forEach(function (i) { if (i && i.url) urls.push(i.url); });
      (r.sources || []).forEach(function (i) { if (i && i.url) urls.push(i.url); });
      if (!urls.length) return;
      out.push({
        type: r.type || 'reference',
        matchedText: String(r.matched_text || r.alt || '').slice(0, 200),
        startIdx: typeof r.start_idx === 'number' ? r.start_idx : null,
        endIdx: typeof r.end_idx === 'number' ? r.end_idx : null,
        urls: urls.map(stripUtm)
      });
    });
    return out;
  }

  /* ===================================================================== */
  /* Deep scan (vangnet bij formaatwijzigingen)                            */
  /* ===================================================================== */

  function deepScan(node, acc, depth, budget) {
    if (!node || depth > 9 || budget.n > 6000) return;
    budget.n++;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length && i < 400; i++) deepScan(node[i], acc, depth + 1, budget);
      return;
    }
    if (typeof node !== 'object') return;

    for (var key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      var v = node[key];
      var lk = key.toLowerCase();

      if ((lk === 'search_query' || lk === 'search_queries' || lk === 'queries') && v) {
        var list = Array.isArray(v) ? v : [v];
        list.forEach(function (o) {
          var q = typeof o === 'string' ? o : (o && (o.q || o.query));
          var t = normalizeQuery(q);
          if (t) acc.queries.push({ q: t, kind: 'search', domains: null, recency: null });
        });
      }
      if (lk === 'url' && typeof v === 'string' && /^https?:\/\//i.test(v)) {
        var s = makeSource(node, 'deepscan');
        if (s) acc.sources.push(s);
      }
      if (v && typeof v === 'object') deepScan(v, acc, depth + 1, budget);
    }
  }

  /* ===================================================================== */
  /* Turn-opbouw                                                           */
  /* ===================================================================== */

  var PROVIDERS = {
    chatgpt: { label: 'ChatGPT', url: function (id) { return 'https://chatgpt.com/c/' + id; } },
    perplexity: { label: 'Perplexity', url: function (id) { return 'https://www.perplexity.ai/search/' + id; } },
    gemini: { label: 'Gemini', url: function (id) { return 'https://gemini.google.com/app/' + id; } }
  };

  function conversationUrl(provider, conversationId, fallback) {
    var p = PROVIDERS[provider];
    if (p && conversationId) return p.url(conversationId);
    return fallback || '';
  }

  /* Stabiele sleutel voor een beurt zonder eigen id (Perplexity, Gemini). */
  function promptKey(prompt) {
    var s = String(prompt || '');
    if (!s) return null;
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'p' + (h >>> 0).toString(36);
  }

  function newTurn(conversationId, key, opts) {
    opts = opts || {};
    var provider = opts.provider || 'chatgpt';
    return {
      id: provider + ':' + conversationId + ':' + key,
      provider: provider,
      providerLabel: (PROVIDERS[provider] || {}).label || provider,
      conversationId: conversationId,
      conversationTitle: opts.title || '',
      conversationUrl: conversationUrl(provider, conversationId, opts.pageUrl),
      promptId: opts.promptId || null,
      prompt: opts.prompt || '',
      answer: '',
      model: opts.model || null,
      createdAt: opts.createdAt || Date.now(),
      updatedAt: Date.now(),
      source: opts.source || 'stream',
      fanout: [],
      sources: [],
      citations: [],
      toolCalls: [],
      related: [],
      searchedAt: null
    };
  }

  function mergeQueries(turn, queries, toolCallIndex) {
    var index = {};
    turn.fanout.forEach(function (q) { index[q.kind + '|' + q.q.toLowerCase()] = q; });
    queries.forEach(function (q) {
      var k = q.kind + '|' + q.q.toLowerCase();
      if (index[k]) {
        if (q.domains && !index[k].domains) index[k].domains = q.domains;
        if (q.recency && index[k].recency == null) index[k].recency = q.recency;
        return;
      }
      var item = {
        q: q.q,
        kind: q.kind,
        domains: q.domains || null,
        recency: q.recency == null ? null : q.recency,
        order: turn.fanout.length + 1,
        toolCall: toolCallIndex
      };
      index[k] = item;
      turn.fanout.push(item);
    });
  }

  function mergeSources(turn, sources, toolCallIndex) {
    var index = {};
    turn.sources.forEach(function (s) { index[s.url.toLowerCase()] = s; });
    sources.forEach(function (s) {
      var k = s.url.toLowerCase();
      var existing = index[k];
      if (existing) {
        if (s.origin === 'citation') existing.origin = 'citation';
        if (!existing.title && s.title) existing.title = s.title;
        if (!existing.snippet && s.snippet) existing.snippet = s.snippet;
        if (!existing.pubDate && s.pubDate) existing.pubDate = s.pubDate;
        if (toolCallIndex != null && existing.toolCalls.indexOf(toolCallIndex) === -1) existing.toolCalls.push(toolCallIndex);
        return;
      }
      s.toolCalls = toolCallIndex != null ? [toolCallIndex] : [];
      index[k] = s;
      turn.sources.push(s);
    });
  }

  /* Koppelt bronnen terug aan de queries van de voorafgaande tool-call. */
  function linkQueriesToSources(turn) {
    var byCall = {};
    turn.fanout.forEach(function (q) {
      if (q.toolCall == null) return;
      (byCall[q.toolCall] = byCall[q.toolCall] || []).push(q);
      q.sourceCount = 0;
      q.domains_found = [];
    });
    turn.sources.forEach(function (s) {
      (s.toolCalls || []).forEach(function (ci) {
        (byCall[ci] || []).forEach(function (q) {
          q.sourceCount++;
          if (q.domains_found.indexOf(s.domain) === -1) q.domains_found.push(s.domain);
        });
      });
    });
  }

  /*
   * Providers die hun eigen extractie doen (Perplexity, Gemini) leveren een
   * kant-en-klare capture aan. Die hoeft alleen nog in de turn-vorm gegoten.
   */
  function buildTurnFromCapture(cap) {
    var conversationId = cap.conversationId || 'unknown';
    var key = cap.promptId || promptKey(cap.prompt) || ('t' + Date.now());
    var turn = newTurn(conversationId, key, {
      provider: cap.provider,
      prompt: cap.prompt || '',
      promptId: cap.promptId || null,
      createdAt: cap.promptTime || Date.now(),
      title: cap.title || '',
      pageUrl: cap.pageUrl,
      model: cap.model || null,
      source: cap.source || 'stream'
    });

    // Alleen echte zoekopdrachten horen bij de tool-call. Vervolgvragen zijn
    // suggesties van de assistent; die hebben geen bronnen opgeleverd en mogen
    // dus geen bronnenteller krijgen.
    var searched = (cap.fanout || []).filter(function (q) { return q.kind !== 'related'; });
    var suggested = (cap.fanout || []).filter(function (q) { return q.kind === 'related'; });
    if (searched.length) {
      turn.toolCalls.push({ index: 0, recipient: cap.provider, at: turn.createdAt, queryCount: searched.length });
      mergeQueries(turn, searched, 0);
      turn.searchedAt = turn.createdAt;
    }
    if (suggested.length) mergeQueries(turn, suggested, null);

    var sources = (cap.sources || []).map(function (s) {
      return {
        url: stripUtm(s.url),
        domain: s.domain || domainOf(s.url),
        title: String(s.title || '').slice(0, 300),
        snippet: String(s.snippet || '').slice(0, 600),
        pubDate: s.pubDate || null,
        attribution: s.attribution || null,
        origin: s.origin || 'search_results'
      };
    }).filter(function (s) { return s.url && s.domain; });
    mergeSources(turn, sources, 0);

    turn.answer = cap.answer || '';
    turn.related = cap.related || [];
    linkQueriesToSources(turn);
    return turn;
  }

  /*
   * payload:
   *   { source, conversationId, title, model, prompt, promptId, promptTime,
   *     pageUrl, messages: [...] }            (ChatGPT stream)
   *   { source:'history', conversationId, title, mapping: {...} }   (ChatGPT historie)
   *   { capture:true, provider, fanout, sources, answer, … }        (Perplexity/Gemini)
   */
  function buildTurns(payload) {
    if (!payload) return [];
    if (payload.capture) {
      var t = buildTurnFromCapture(payload);
      return (t.prompt || t.fanout.length || t.sources.length || t.answer) ? [t] : [];
    }
    var conversationId = payload.conversationId || 'unknown';
    var messages = [];

    if (payload.mapping) {
      var nodes = [];
      for (var id in payload.mapping) {
        if (!Object.prototype.hasOwnProperty.call(payload.mapping, id)) continue;
        var n = payload.mapping[id];
        if (n && n.message) nodes.push(n.message);
      }
      nodes.sort(function (a, b) { return (a.create_time || 0) - (b.create_time || 0); });
      messages = nodes;
    } else {
      messages = (payload.messages || []).filter(Boolean);
    }

    var forcedTurn = payload.promptId || payload.prompt ? true : false;
    var turns = [];
    var current = null;
    var toolCallIndex = -1;
    var pendingQueriesCall = null;

    function ensureTurn(userMsg) {
      var key, opts;
      if (userMsg) {
        key = userMsg.id || ('t' + turns.length);
        opts = {
          prompt: textOf(userMsg),
          promptId: userMsg.id || null,
          createdAt: userMsg.create_time ? Math.round(userMsg.create_time * 1000) : Date.now(),
          title: payload.title || '',
          pageUrl: payload.pageUrl,
          provider: payload.provider || 'chatgpt',
          source: payload.source || 'stream'
        };
      } else {
        key = payload.promptId || ('t' + Date.now());
        opts = {
          prompt: payload.prompt || '',
          promptId: payload.promptId || null,
          createdAt: payload.promptTime || Date.now(),
          title: payload.title || '',
          pageUrl: payload.pageUrl,
          provider: payload.provider || 'chatgpt',
          source: payload.source || 'stream'
        };
      }
      current = newTurn(conversationId, key, opts);
      turns.push(current);
      toolCallIndex = -1;
      pendingQueriesCall = null;
      return current;
    }

    if (payload.mapping) forcedTurn = false;
    if (forcedTurn) ensureTurn(null);

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var role = (msg.author && msg.author.role) || 'unknown';

      if (role === 'system') continue;
      if (role === 'user') {
        if (isHidden(msg)) continue;
        if (!forcedTurn) ensureTurn(msg);
        continue;
      }
      if (!current) ensureTurn(null);

      var md = msg.metadata || {};
      if (md.model_slug && !current.model) current.model = md.model_slug;
      if (payload.model && !current.model) current.model = payload.model;

      var queries = extractQueries(msg);
      var sources = extractSources(msg);
      var citations = extractCitations(msg);

      if (queries.length) {
        toolCallIndex++;
        pendingQueriesCall = toolCallIndex;
        current.toolCalls.push({
          index: toolCallIndex,
          recipient: msg.recipient || (msg.author && msg.author.name) || null,
          at: msg.create_time ? Math.round(msg.create_time * 1000) : Date.now(),
          queryCount: queries.length
        });
        mergeQueries(current, queries, toolCallIndex);
        if (!current.searchedAt) current.searchedAt = Date.now();
      }

      if (sources.length) {
        mergeSources(current, sources, pendingQueriesCall != null ? pendingQueriesCall : null);
      }

      if (citations.length) {
        current.citations = current.citations.concat(citations);
      }

      // Zichtbaar antwoord: assistant, geen tool-recipient, tekstueel
      var isVisibleAnswer =
        role === 'assistant' &&
        (!msg.recipient || msg.recipient === 'all') &&
        msg.content &&
        (msg.content.content_type === 'text' || msg.content.content_type === 'multimodal_text');

      if (isVisibleAnswer && !isHidden(msg)) {
        var t = textOf(msg);
        if (t && t.length > current.answer.length) current.answer = t;
      }
    }

    // Vangnet: geen enkele query gevonden? Dan alsnog een deep scan.
    turns.forEach(function (turn) {
      if (turn.fanout.length) return;
      var acc = { queries: [], sources: [] };
      deepScan(messages, acc, 0, { n: 0 });
      if (acc.queries.length) mergeQueries(turn, acc.queries, null);
      if (!turn.sources.length && acc.sources.length) mergeSources(turn, acc.sources, null);
    });

    turns.forEach(function (t) {
      linkQueriesToSources(t);
      t.updatedAt = Date.now();
    });

    return turns.filter(function (t) {
      return t.prompt || t.fanout.length || t.sources.length || t.answer;
    });
  }

  /* ===================================================================== */
  /* Merge van een nieuwe turn op een bestaande (streaming updates)        */
  /* ===================================================================== */

  function mergeTurn(existing, incoming) {
    if (!existing) return incoming;
    var out = existing;
    out.updatedAt = Date.now();
    if (incoming.prompt && incoming.prompt.length > (out.prompt || '').length) out.prompt = incoming.prompt;
    if (incoming.answer && incoming.answer.length > (out.answer || '').length) out.answer = incoming.answer;
    if (incoming.conversationTitle && !out.conversationTitle) out.conversationTitle = incoming.conversationTitle;
    if (incoming.model && !out.model) out.model = incoming.model;
    if (incoming.source === 'history') out.source = 'history';
    if (incoming.provider && !out.provider) {
      out.provider = incoming.provider;
      out.providerLabel = incoming.providerLabel || incoming.provider;
    }
    if ((incoming.related || []).length > (out.related || []).length) out.related = incoming.related;
    if (incoming.createdAt && incoming.createdAt < out.createdAt) out.createdAt = incoming.createdAt;

    (incoming.toolCalls || []).forEach(function (c) {
      for (var i = 0; i < out.toolCalls.length; i++) {
        if (out.toolCalls[i].index === c.index) return;
      }
      out.toolCalls.push(c);
    });

    mergeQueries(out, incoming.fanout || [], null);
    // toolCall-index bewaren waar de bestaande nog leeg is
    (incoming.fanout || []).forEach(function (q) {
      for (var i = 0; i < out.fanout.length; i++) {
        if (out.fanout[i].q === q.q && out.fanout[i].kind === q.kind) {
          if (out.fanout[i].toolCall == null && q.toolCall != null) out.fanout[i].toolCall = q.toolCall;
        }
      }
    });

    (incoming.sources || []).forEach(function (s) {
      var found = null;
      for (var i = 0; i < out.sources.length; i++) {
        if (out.sources[i].url.toLowerCase() === s.url.toLowerCase()) { found = out.sources[i]; break; }
      }
      if (!found) { out.sources.push(s); return; }
      if (s.origin === 'citation') found.origin = 'citation';
      if (!found.title && s.title) found.title = s.title;
      if (!found.snippet && s.snippet) found.snippet = s.snippet;
      (s.toolCalls || []).forEach(function (ci) {
        found.toolCalls = found.toolCalls || [];
        if (found.toolCalls.indexOf(ci) === -1) found.toolCalls.push(ci);
      });
    });

    if ((incoming.citations || []).length >= (out.citations || []).length) out.citations = incoming.citations;

    linkQueriesToSources(out);
    return out;
  }

  root.FanoutParser = {
    PROVIDERS: PROVIDERS,
    buildTurns: buildTurns,
    buildTurnFromCapture: buildTurnFromCapture,
    promptKey: promptKey,
    mergeTurn: mergeTurn,
    extractQueries: extractQueries,
    extractSources: extractSources,
    domainOf: domainOf,
    textOf: textOf
  };
})(typeof self !== 'undefined' ? self : this);
