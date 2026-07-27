/*
 * Fanouts — analyse.
 *
 * Classificeert fan-out queries, berekent per-turn statistieken en aggregeert
 * over meerdere turns (domein share-of-voice, entiteit-frequentie, query-typen).
 */
;(function (root) {
  'use strict';

  var QUERY_TYPES = [
    { key: 'comparative', label: 'Vergelijkend',
      // "best practices" is geen vergelijking — die uitzondering moet expliciet.
      re: /\b(vs|versus|vergeleken|vergelijking|vergelijk|verschil|verschillen|beste|best(?!\s+practices?)|top\s*\d|alternatief|alternatieven|alternative|alternatives|compare|comparison|difference|differences|which is better|beter dan|better than|ranking|rangschikking)\b/i },
    { key: 'commercial', label: 'Commercieel',
      re: /\b(prijs|prijzen|kosten|kost|tarief|tarieven|goedkoop|goedkoopste|korting|aanbieding|kopen|bestellen|abonnement|price|pricing|cost|costs|cheap|cheapest|discount|deal|deals|buy|purchase|subscription|plan|plans|quote|offerte)\b/i },
    { key: 'review', label: 'Review / ervaring',
      re: /\b(review|reviews|beoordeling|beoordelingen|ervaring|ervaringen|test|getest|klachten|betrouwbaar|reddit|trustpilot|rating|ratings|testimonial|complaints|scam|opinions|meningen)\b/i },
    { key: 'howto', label: 'How-to / instructie',
      re: /\b(hoe|how to|how do|stappen|stappenplan|handleiding|tutorial|guide|gids|instructies|instructions|setup|installeren|install|configureren|configure|fix|oplossen|troubleshoot)\b/i },
    { key: 'definition', label: 'Definitie / uitleg',
      re: /\b(wat is|wat zijn|betekenis|definitie|uitleg|verschil tussen|what is|what are|meaning|definition|explained|explain|overview|introduction)\b/i },
    { key: 'temporal', label: 'Actualiteit',
      re: /\b(20[2-3]\d|latest|newest|nieuwste|recent|recente|actueel|actuele|update|updates|news|nieuws|current|momenteel|this year|dit jaar|q[1-4]\s*20\d\d)\b/i },
    { key: 'local', label: 'Lokaal / geografisch',
      re: /\b(near me|bij mij|in de buurt|nederland|netherlands|belgië|belgie|belgium|dutch|nederlandse|amsterdam|rotterdam|utrecht|den haag|eindhoven|antwerpen|brussel|europe|europa|uk|usa|local|lokaal|regio)\b/i },
    { key: 'specification', label: 'Specificatie / kenmerk',
      re: /\b(specs|specificaties|kenmerken|features|functies|eigenschappen|requirements|eisen|afmetingen|dimensions|technical|technisch|api|integratie|integration|compatibility|compatibel)\b/i },
    { key: 'entity_lookup', label: 'Entiteit-lookup',
      re: /\b(official|officiële|officiele|site|website|homepage|about|over ons|contact|documentation|docs|wikipedia|linkedin)\b/i }
  ];

  var STOPWORDS_OVERLAP = 'de het een en van in op voor met is zijn the a an and of for with on to are'
    .split(' ').reduce(function (acc, w) { acc[w] = 1; return acc; }, {});

  function tokenize(s) {
    return String(s || '').toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length > 2 && !STOPWORDS_OVERLAP[w]; });
  }

  function jaccard(a, b) {
    var A = {}, n = 0, inter = 0;
    a.forEach(function (w) { if (!A[w]) { A[w] = 1; n++; } });
    var B = {}, m = 0;
    b.forEach(function (w) { if (!B[w]) { B[w] = 1; m++; } });
    for (var w in A) if (B[w]) inter++;
    var union = n + m - inter;
    return union ? inter / union : 0;
  }

  /*
   * Classificeert één fan-out query t.o.v. de oorspronkelijke prompt.
   * Levert een primair type + alle matchende labels.
   */
  function classifyQuery(query, prompt) {
    var labels = [];
    QUERY_TYPES.forEach(function (t) { if (t.re.test(query)) labels.push(t.key); });

    var qt = tokenize(query);
    var pt = tokenize(prompt);
    var overlap = jaccard(qt, pt);
    var novelTokens = qt.filter(function (w) { return pt.indexOf(w) === -1; });

    var primary;
    if (overlap >= 0.62) primary = 'reformulation';
    else if (labels.length) primary = labels[0];
    else if (novelTokens.length >= Math.max(1, Math.ceil(qt.length * 0.6))) primary = 'expansion';
    else primary = 'related';

    return {
      primary: primary,
      labels: labels,
      overlap: Math.round(overlap * 100) / 100,
      novelTokens: novelTokens.slice(0, 12),
      tokens: qt.length
    };
  }

  function typeLabel(key) {
    if (key === 'reformulation') return 'Herformulering';
    if (key === 'expansion') return 'Uitbreiding';
    if (key === 'related') return 'Gerelateerd';
    if (key === 'related_suggestion') return 'Vervolgvraag';
    for (var i = 0; i < QUERY_TYPES.length; i++) if (QUERY_TYPES[i].key === key) return QUERY_TYPES[i].label;
    return key;
  }

  /* Verrijkt een turn met classificatie, entiteiten en statistieken. */
  function analyseTurn(turn, settings) {
    settings = settings || {};
    var myDomains = (settings.myDomains || []).map(function (d) {
      return String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    }).filter(Boolean);

    (turn.fanout || []).forEach(function (q) {
      if (q.kind === 'search' || q.kind === 'image') {
        var c = classifyQuery(q.q, turn.prompt || '');
        q.type = c.primary;
        q.typeLabel = typeLabel(c.primary);
        q.labels = c.labels;
        q.overlap = c.overlap;
        q.novel = c.novelTokens;
      } else if (q.kind === 'related') {
        // Perplexity's vervolgvragen: geen fan-out, maar wel waardevol signaal.
        q.type = 'related_suggestion';
        q.typeLabel = 'Vervolgvraag';
        q.labels = [];
        q.overlap = null;
        q.novel = [];
      } else {
        q.type = q.kind;
        q.typeLabel = q.kind === 'open' ? 'Pagina geopend' : q.kind === 'find' ? 'In-pagina zoek' : q.kind;
        q.labels = [];
        q.overlap = null;
        q.novel = [];
      }
    });

    if (root.FanoutEntities) {
      turn.entities = root.FanoutEntities.extractEntities(turn, { limit: 120 });
    } else {
      turn.entities = turn.entities || [];
    }

    var domains = {};
    var cited = 0;
    (turn.sources || []).forEach(function (s) {
      domains[s.domain] = (domains[s.domain] || 0) + 1;
      if (s.origin === 'citation') cited++;
      s.isMine = myDomains.some(function (d) { return s.domain === d || s.domain.endsWith('.' + d); });
    });

    var searchQueries = (turn.fanout || []).filter(function (q) { return q.kind === 'search'; });
    var byType = {};
    searchQueries.forEach(function (q) { byType[q.type] = (byType[q.type] || 0) + 1; });

    turn.stats = {
      provider: turn.provider || 'chatgpt',
      relatedCount: (turn.fanout || []).filter(function (q) { return q.kind === 'related'; }).length,
      fanoutCount: searchQueries.length,
      actionCount: (turn.fanout || []).length - searchQueries.length,
      sourceCount: (turn.sources || []).length,
      citedCount: cited,
      domainCount: Object.keys(domains).length,
      entityCount: (turn.entities || []).length,
      modelAddedEntities: (turn.entities || []).filter(function (e) { return e.modelAdded; }).length,
      toolCallCount: (turn.toolCalls || []).length,
      answerChars: (turn.answer || '').length,
      myDomainHits: (turn.sources || []).filter(function (s) { return s.isMine; }).length,
      byType: byType
    };

    return turn;
  }

  /* Aggregatie over meerdere turns. */
  function aggregate(turns, settings) {
    settings = settings || {};
    var queries = {};
    var domains = {};
    var entities = {};
    var types = {};
    var conversations = {};
    var providers = {};
    var totalQueries = 0;
    var totalSources = 0;

    turns.forEach(function (turn) {
      conversations[turn.conversationId] = turn.conversationTitle || conversations[turn.conversationId] || '';
      var pid = turn.provider || 'chatgpt';
      var prec = providers[pid] || (providers[pid] = {
        id: pid, label: turn.providerLabel || pid, turns: 0, queries: 0, sources: 0, domains: {}
      });
      prec.turns++;

      (turn.fanout || []).forEach(function (q) {
        if (q.kind !== 'search') return;
        totalQueries++;
        prec.queries++;
        var k = q.q.toLowerCase();
        var rec = queries[k] || (queries[k] = {
          q: q.q, count: 0, type: q.type, typeLabel: q.typeLabel,
          turns: [], prompts: [], domains: [], providers: [], avgOverlap: 0, _overlapSum: 0
        });
        rec.count++;
        if (rec.providers.indexOf(pid) === -1) rec.providers.push(pid);
        rec._overlapSum += (q.overlap || 0);
        rec.avgOverlap = Math.round((rec._overlapSum / rec.count) * 100) / 100;
        if (rec.turns.indexOf(turn.id) === -1) rec.turns.push(turn.id);
        if (turn.prompt && rec.prompts.indexOf(turn.prompt) === -1 && rec.prompts.length < 8) rec.prompts.push(turn.prompt);
        (q.domains_found || []).forEach(function (d) { if (rec.domains.indexOf(d) === -1) rec.domains.push(d); });
        types[q.type] = (types[q.type] || 0) + 1;
      });

      (turn.sources || []).forEach(function (s) {
        totalSources++;
        prec.sources++;
        prec.domains[s.domain] = 1;
        var rec = domains[s.domain] || (domains[s.domain] = {
          domain: s.domain, brand: root.FanoutEntities ? root.FanoutEntities.brandFromDomain(s.domain) : s.domain,
          total: 0, cited: 0, turns: [], urls: {}, isMine: !!s.isMine, providers: []
        });
        rec.total++;
        if (rec.providers.indexOf(pid) === -1) rec.providers.push(pid);
        if (s.origin === 'citation') rec.cited++;
        if (rec.turns.indexOf(turn.id) === -1) rec.turns.push(turn.id);
        rec.urls[s.url] = (rec.urls[s.url] || 0) + 1;
        if (s.isMine) rec.isMine = true;
      });

      (turn.entities || []).forEach(function (e) {
        var rec = entities[e.key] || (entities[e.key] = {
          key: e.key, name: e.name, type: e.type, total: 0, score: 0,
          inQueries: 0, inPrompt: 0, inAnswer: 0, inSources: 0,
          turns: [], queries: [], domains: [], modelAdded: 0
        });
        rec.total += e.total;
        rec.score += e.score || 0;
        rec.inQueries += e.inQueries;
        rec.inPrompt += e.inPrompt;
        rec.inAnswer += e.inAnswer;
        rec.inSources += e.inSources;
        if (e.modelAdded) rec.modelAdded++;
        if (rec.turns.indexOf(turn.id) === -1) rec.turns.push(turn.id);
        (e.queries || []).forEach(function (q) { if (rec.queries.indexOf(q) === -1 && rec.queries.length < 20) rec.queries.push(q); });
        (e.domains || []).forEach(function (d) { if (rec.domains.indexOf(d) === -1 && rec.domains.length < 30) rec.domains.push(d); });
        if (e.type === 'brand') rec.type = 'brand';
      });
    });

    var queryList = Object.keys(queries).map(function (k) {
      var r = queries[k]; delete r._overlapSum; r.turnCount = r.turns.length; return r;
    }).sort(function (a, b) { return b.count - a.count || a.q.localeCompare(b.q); });

    var domainList = Object.keys(domains).map(function (k) {
      var r = domains[k];
      r.urlCount = Object.keys(r.urls).length;
      r.topUrls = Object.keys(r.urls).sort(function (a, b) { return r.urls[b] - r.urls[a]; }).slice(0, 10)
        .map(function (u) { return { url: u, count: r.urls[u] }; });
      r.turnCount = r.turns.length;
      r.share = totalSources ? Math.round((r.total / totalSources) * 1000) / 10 : 0;
      delete r.urls;
      return r;
    }).sort(function (a, b) { return b.total - a.total || a.domain.localeCompare(b.domain); });

    var entityList = Object.keys(entities).map(function (k) {
      var r = entities[k]; r.turnCount = r.turns.length; return r;
    }).sort(function (a, b) { return b.score - a.score || b.total - a.total; });

    return {
      turnCount: turns.length,
      conversationCount: Object.keys(conversations).length,
      conversations: conversations,
      providers: Object.keys(providers).map(function (k) {
        var r = providers[k];
        r.domainCount = Object.keys(r.domains).length;
        r.avgFanout = r.turns ? Math.round((r.queries / r.turns) * 10) / 10 : 0;
        delete r.domains;
        return r;
      }).sort(function (a, b) { return b.turns - a.turns; }),
      totalQueries: totalQueries,
      uniqueQueries: queryList.length,
      totalSources: totalSources,
      uniqueDomains: domainList.length,
      avgFanout: turns.length ? Math.round((totalQueries / turns.length) * 10) / 10 : 0,
      avgSources: turns.length ? Math.round((totalSources / turns.length) * 10) / 10 : 0,
      queries: queryList,
      domains: domainList,
      entities: entityList,
      types: Object.keys(types).map(function (k) {
        return { key: k, label: typeLabel(k), count: types[k], share: totalQueries ? Math.round((types[k] / totalQueries) * 1000) / 10 : 0 };
      }).sort(function (a, b) { return b.count - a.count; })
    };
  }

  root.FanoutAnalysis = {
    classifyQuery: classifyQuery,
    analyseTurn: analyseTurn,
    aggregate: aggregate,
    typeLabel: typeLabel,
    QUERY_TYPES: QUERY_TYPES
  };
})(typeof self !== 'undefined' ? self : this);
