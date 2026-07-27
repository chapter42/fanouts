/* Fanouts — dashboard. */
(function () {
  'use strict';

  var state = {
    all: [],
    settings: { myDomains: [], maxTurns: 800, capturePaused: false, theme: 'light' },
    view: 'queries',
    filter: '',
    conversation: '',
    provider: '',
    period: 0,
    qtype: '',
    sort: { queries: { k: 'count', dir: -1 }, entities: { k: 'score', dir: -1 }, domains: { k: 'total', dir: -1 } },
    providerLabels: { chatgpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini' },
    agg: null,
    turns: []
  };

  var $ = function (s) { return document.querySelector(s); };
  var el = {
    tiles: $('#tiles'), view: $('#view'), search: $('#search'),
    conversation: $('#conversation'), provider: $('#provider'), period: $('#period'), qtype: $('#qtype'),
    tabbar: $('#tabbar'), toast: $('#toast'), scopeInfo: $('#scopeInfo'),
    exportBtn: $('#btnExport'), exportMenu: $('#exportMenu'),
    dlg: $('#settingsDlg')
  };

  /* ------------------------------------------------------------ helpers */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#'; }
  function providerBadge(id, label) {
    var pid = id || 'chatgpt';
    return '<span class="badge p-' + esc(pid) + '">' + esc(label || state.providerLabels[pid] || pid) + '</span>';
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function bytes(n) {
    if (n === null || n === undefined) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  var toastTimer;
  function toast(msg, isErr) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'toast'; }, 2800);
  }

  /* ------------------------------------------------------------ filteren */

  function filtered() {
    var out = state.all;

    if (state.conversation) out = out.filter(function (t) { return t.conversationId === state.conversation; });
    if (state.provider) out = out.filter(function (t) { return (t.provider || 'chatgpt') === state.provider; });

    if (state.period > 0) {
      var cutoff = Date.now() - state.period * 86400000;
      out = out.filter(function (t) { return (t.createdAt || 0) >= cutoff; });
    }

    var f = state.filter.trim().toLowerCase();
    if (f) {
      out = out.filter(function (t) {
        if ((t.prompt || '').toLowerCase().indexOf(f) !== -1) return true;
        if ((t.fanout || []).some(function (q) { return q.q.toLowerCase().indexOf(f) !== -1; })) return true;
        if ((t.entities || []).some(function (e) { return e.name.toLowerCase().indexOf(f) !== -1; })) return true;
        if ((t.sources || []).some(function (s) {
          return s.domain.indexOf(f) !== -1 || (s.title || '').toLowerCase().indexOf(f) !== -1;
        })) return true;
        return false;
      });
    }
    return out;
  }

  function recompute() {
    state.turns = filtered();
    state.agg = self.FanoutAnalysis.aggregate(state.turns, state.settings);
  }

  function sortRows(rows, key) {
    var s = state.sort[key];
    if (!s) return rows;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var av = a[s.k], bv = b[s.k];
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av || '').localeCompare(String(bv || '')) * s.dir * -1;
      }
      return ((bv || 0) - (av || 0)) * (s.dir === -1 ? 1 : -1);
    });
    return copy;
  }

  function th(label, k, viewKey, numeric) {
    var s = state.sort[viewKey];
    var active = s && s.k === k;
    return '<th class="' + (numeric ? 'num ' : '') + (active ? 'sorted' : '') + '" data-sort="' + esc(k) + '" data-view="' + esc(viewKey) + '">' +
      esc(label) + (active ? '<span class="arrow">' + (s.dir === -1 ? '▼' : '▲') + '</span>' : '') + '</th>';
  }

  /* -------------------------------------------------------------- tegels */

  function renderTiles() {
    var a = state.agg;
    var mineHits = a.domains.filter(function (d) { return d.isMine; }).reduce(function (x, d) { return x + d.total; }, 0);
    var modelAdded = a.entities.filter(function (e) { return e.modelAdded > 0 && e.inPrompt === 0; }).length;

    var tiles = [
      { v: a.turnCount, k: 'turns', c: '' },
      { v: a.totalQueries, k: 'fan-out queries', c: 'accent' },
      { v: a.uniqueQueries, k: 'unieke queries', c: 'accent' },
      { v: a.avgFanout, k: 'queries per turn', c: '' },
      { v: a.uniqueDomains, k: 'domeinen', c: 'cyan' },
      { v: a.totalSources, k: 'bronvermeldingen', c: 'cyan' },
      { v: a.entities.length, k: 'entiteiten', c: 'pink' },
      { v: modelAdded, k: 'model-toegevoegd', c: 'pink' }
    ];
    if (state.settings.myDomains.length) tiles.push({ v: mineHits, k: 'eigen domein', c: 'green' });
    if ((a.providers || []).length > 1) tiles.splice(1, 0, { v: a.providers.length, k: 'assistenten', c: '' });

    el.tiles.innerHTML = tiles.map(function (t) {
      return '<div class="tile ' + t.c + '"><div class="v">' + esc(t.v) + '</div><div class="k">' + esc(t.k) + '</div></div>';
    }).join('');

    el.scopeInfo.textContent = state.turns.length + ' van ' + state.all.length + ' turns in beeld';
  }

  /* --------------------------------------------------------------- views */

  function viewQueries() {
    var rows = state.agg.queries;
    if (state.qtype) rows = rows.filter(function (r) { return r.type === state.qtype; });
    rows = sortRows(rows, 'queries');

    if (!rows.length) return emptyState('Geen queries', 'Geen fan-out queries binnen dit filter.');

    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
    return '<div class="table-wrap"><table><thead><tr>' +
      th('Query', 'q', 'queries') +
      th('Type', 'typeLabel', 'queries') +
      th('Aantal', 'count', 'queries', true) +
      th('Turns', 'turnCount', 'queries', true) +
      th('Overlap prompt', 'avgOverlap', 'queries', true) +
      '<th>Assistent</th>' +
      '<th>Domeinen uit dezelfde tool-call</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td class="q">' + esc(r.q) +
          (r.prompts.length ? '<div class="sub">↳ ' + esc(r.prompts[0].slice(0, 130)) + (r.prompts.length > 1 ? ' <em>+' + (r.prompts.length - 1) + '</em>' : '') + '</div>' : '') +
          '</td>' +
          '<td><span class="badge badge-mute">' + esc(r.typeLabel || r.type) + '</span></td>' +
          '<td class="num"><div class="bar"><span class="track"><span class="fill" style="width:' + Math.round((r.count / max) * 100) + '%"></span></span>' + r.count + '</div></td>' +
          '<td class="num">' + r.turnCount + '</td>' +
          '<td class="num">' + Math.round((r.avgOverlap || 0) * 100) + '%</td>' +
          '<td><div class="chips">' + (r.providers || []).map(function (pid) { return providerBadge(pid); }).join('') + '</div></td>' +
          '<td class="wide"><div class="chips">' + (r.domains || []).slice(0, 8).map(function (d) {
            return '<span class="badge badge-mute">' + esc(d) + '</span>';
          }).join('') + '</div></td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="mute" style="margin-top:12px;font-size:11.5px;max-width:820px;line-height:1.6">' +
      'ChatGPT bundelt meerdere queries in één <span class="mono">web.run</span>-aanroep en krijgt daar één gecombineerde resultatenset op terug. ' +
      'De domeinkolom toont daarom de bronnen van de hele aanroep, niet van die ene query — een exacte query→bron-koppeling zit niet in de data.</p>';
  }

  function viewEntities() {
    var rows = sortRows(state.agg.entities, 'entities');
    if (!rows.length) return emptyState('Geen entiteiten', 'Er zijn nog geen entiteiten herkend binnen dit filter.');

    var max = Math.max.apply(null, rows.map(function (r) { return r.score; }));
    return '<div class="table-wrap"><table><thead><tr>' +
      th('Entiteit', 'name', 'entities') +
      th('Type', 'type', 'entities') +
      th('Score', 'score', 'entities', true) +
      th('Prompt', 'inPrompt', 'entities', true) +
      th('Fan-out', 'inQueries', 'entities', true) +
      th('Antwoord', 'inAnswer', 'entities', true) +
      th('Bronnen', 'inSources', 'entities', true) +
      th('Turns', 'turnCount', 'entities', true) +
      '<th>Gerelateerde queries</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var added = r.inQueries > 0 && r.inPrompt === 0;
        return '<tr>' +
          '<td><span class="rowlink">' + esc(r.name) + '</span>' + (added ? ' <span class="badge badge-accent" title="Door het model toegevoegd — stond niet in de prompt">✦ model</span>' : '') + '</td>' +
          '<td><span class="badge t-' + esc(r.type) + '">' + esc(r.type) + '</span></td>' +
          '<td class="num"><div class="bar"><span class="track"><span class="fill" style="width:' + Math.round((r.score / max) * 100) + '%"></span></span>' + r.score + '</div></td>' +
          '<td class="num">' + r.inPrompt + '</td>' +
          '<td class="num">' + r.inQueries + '</td>' +
          '<td class="num">' + r.inAnswer + '</td>' +
          '<td class="num">' + r.inSources + '</td>' +
          '<td class="num">' + r.turnCount + '</td>' +
          '<td class="wide"><div class="sub">' + esc((r.queries || []).slice(0, 4).join(' · ')) + '</div></td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function viewDomains() {
    var rows = sortRows(state.agg.domains, 'domains');
    if (!rows.length) return emptyState('Geen bronnen', 'Er zijn nog geen bronnen vastgelegd binnen dit filter.');

    var max = Math.max.apply(null, rows.map(function (r) { return r.total; }));
    return '<div class="table-wrap"><table><thead><tr>' +
      th('Domein', 'domain', 'domains') +
      th('Vermeldingen', 'total', 'domains', true) +
      th('Geciteerd', 'cited', 'domains', true) +
      th('Aandeel', 'share', 'domains', true) +
      th('URLs', 'urlCount', 'domains', true) +
      th('Turns', 'turnCount', 'domains', true) +
      '<th>Assistenten</th>' +
      '<th>Meest genoemde URL</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var top = (r.topUrls || [])[0];
        return '<tr class="' + (r.isMine ? 'mine-row' : '') + '">' +
          '<td><b>' + esc(r.domain) + '</b>' + (r.isMine ? ' <span class="badge badge-green">eigen</span>' : '') +
          (r.brand ? '<div class="sub">' + esc(r.brand) + '</div>' : '') + '</td>' +
          '<td class="num"><div class="bar"><span class="track"><span class="fill' + (r.isMine ? ' mine' : '') + '" style="width:' + Math.round((r.total / max) * 100) + '%"></span></span>' + r.total + '</div></td>' +
          '<td class="num">' + r.cited + '</td>' +
          '<td class="num">' + r.share + '%</td>' +
          '<td class="num">' + r.urlCount + '</td>' +
          '<td class="num">' + r.turnCount + '</td>' +
          '<td><div class="chips">' + (r.providers || []).map(function (pid) { return providerBadge(pid); }).join('') + '</div></td>' +
          '<td class="wide">' + (top ? '<a href="' + esc(safeUrl(top.url)) + '" target="_blank" rel="noreferrer noopener">' + esc(top.url.slice(0, 90)) + '</a>' : '') + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function viewTypes() {
    var rows = state.agg.types;
    if (!rows.length) return emptyState('Geen data', 'Nog geen queries om te classificeren.');
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>Querytype</th><th class="num">Aantal</th><th class="num">Aandeel</th><th>Verdeling</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><b>' + esc(r.label) + '</b><div class="sub">' + esc(r.key) + '</div></td>' +
          '<td class="num">' + r.count + '</td><td class="num">' + r.share + '%</td>' +
          '<td><div class="bar"><span class="track" style="width:220px"><span class="fill" style="width:' + Math.round((r.count / max) * 100) + '%"></span></span></div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="mute" style="margin-top:12px;font-size:11.5px;max-width:760px;line-height:1.6">' +
      'Types worden bepaald door de query te vergelijken met je oorspronkelijke prompt (token-overlap) en op intent-patronen te matchen. ' +
      '<b>Herformulering</b> = dicht bij je prompt, <b>Uitbreiding</b> = grotendeels nieuwe termen, de overige labels duiden de intent aan.</p>';
  }

  function viewTurns() {
    if (!state.turns.length) return emptyState('Geen turns', 'Pas het filter aan of voer een zoekvraag uit in ChatGPT.');

    return '<div class="turncards">' + state.turns.map(function (t) {
      var s = t.stats || {};
      var searches = (t.fanout || []).filter(function (q) { return q.kind === 'search'; });
      var related = (t.fanout || []).filter(function (q) { return q.kind === 'related'; });
      return '<article class="turncard">' +
        '<h3>' + esc(t.prompt || '(geen prompt vastgelegd)') + '</h3>' +
        '<div class="meta">' +
        providerBadge(t.provider, t.providerLabel) +
        '<span>' + esc(fmtDate(t.createdAt)) + '</span>' +
        (t.model ? '<span>· ' + esc(t.model) + '</span>' : '') +
        (t.conversationTitle ? '<span>· ' + esc(t.conversationTitle) + '</span>' : '') +
        (t.conversationUrl ? '<a href="' + esc(safeUrl(t.conversationUrl)) + '" target="_blank" rel="noreferrer noopener">open gesprek ↗</a>' : '') +
        '<span class="badge badge-accent"><b>' + (s.fanoutCount || 0) + '</b> queries</span>' +
        '<span class="badge badge-cyan"><b>' + (s.sourceCount || 0) + '</b> bronnen</span>' +
        '<span class="badge badge-pink"><b>' + (s.entityCount || 0) + '</b> entiteiten</span>' +
        (s.myDomainHits ? '<span class="badge badge-green"><b>' + s.myDomainHits + '</b> eigen domein</span>' : '') +
        '</div>' +
        '<div class="cols">' +
        '<div><h4>Fan-out queries</h4>' +
        (searches.length
          ? '<ol class="qlist">' + searches.map(function (q) {
              return '<li>' + esc(q.q) + '<span>' + esc(q.typeLabel || '') + '</span></li>';
            }).join('') + '</ol>'
          : '<p class="mute" style="font-size:11.5px">Geen websearch uitgevoerd.</p>') +
        (related.length
          ? '<h4 style="margin-top:12px">Voorgestelde vervolgvragen</h4><ul class="slist">' +
            related.map(function (r) { return '<li>' + esc(r.q) + '</li>'; }).join('') + '</ul>'
          : '') +
        '<h4 style="margin-top:12px">Entiteiten</h4>' +
        '<div class="chips">' + (t.entities || []).slice(0, 30).map(function (e) {
          return '<span class="badge t-' + esc(e.type) + '" title="' + esc(e.type) + '">' + (e.modelAdded ? '✦ ' : '') + esc(e.name) + '</span>';
        }).join('') + '</div>' +
        '</div>' +
        '<div><h4>Bronnen</h4>' +
        ((t.sources || []).length
          ? '<ul class="slist">' + t.sources.slice(0, 25).map(function (src) {
              return '<li><a href="' + esc(safeUrl(src.url)) + '" target="_blank" rel="noreferrer noopener">' + esc((src.title || src.url).slice(0, 110)) + '</a>' +
                '<div class="d">' + esc(src.domain) + (src.origin === 'citation' ? ' · geciteerd' : '') + (src.isMine ? ' · eigen' : '') + '</div></li>';
            }).join('') + '</ul>'
          : '<p class="mute" style="font-size:11.5px">Geen bronnen.</p>') +
        '</div>' +
        '</div>' +
        (t.answer
          ? '<details class="answer-box"><summary>Antwoord — ' + t.answer.length + ' tekens</summary>' +
            '<div class="answer-text">' + esc(t.answer) + '</div></details>'
          : '') +
        '<div class="row" style="margin-top:11px">' +
        '<button class="btn btn-sm" data-turn="' + esc(t.id) + '" data-act="md">Markdown</button>' +
        '<button class="btn btn-sm" data-turn="' + esc(t.id) + '" data-act="json">JSON</button>' +
        '<button class="btn btn-sm" data-turn="' + esc(t.id) + '" data-act="copy">Kopieer queries</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-sm btn-danger" data-turn="' + esc(t.id) + '" data-act="del">Verwijder</button>' +
        '</div>' +
        '</article>';
    }).join('') + '</div>';
  }

  function emptyState(title, body) {
    return '<div class="empty"><strong>' + esc(title) + '</strong>' + esc(body) + '</div>';
  }

  function viewProviders() {
    var rows = state.agg.providers || [];
    if (!rows.length) return emptyState('Geen data', 'Nog niets opgenomen binnen dit filter.');
    var maxQ = Math.max.apply(null, rows.map(function (r) { return r.queries; })) || 1;

    // Overlap: welke domeinen worden door meerdere assistenten geciteerd?
    var shared = state.agg.domains.filter(function (d) { return (d.providers || []).length > 1; });

    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>Assistent</th><th class="num">Turns</th><th class="num">Fan-out queries</th>' +
      '<th class="num">Queries/turn</th><th class="num">Bronnen</th><th class="num">Domeinen</th><th>Verhouding</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + providerBadge(r.id, r.label) + '</td>' +
          '<td class="num">' + r.turns + '</td><td class="num">' + r.queries + '</td>' +
          '<td class="num">' + r.avgFanout + '</td><td class="num">' + r.sources + '</td>' +
          '<td class="num">' + r.domainCount + '</td>' +
          '<td><div class="bar"><span class="track" style="width:220px"><span class="fill" style="width:' +
          Math.round((r.queries / maxQ) * 100) + '%"></span></span></div></td></tr>';
      }).join('') + '</tbody></table></div>' +

      (rows.length > 1
        ? '<h3 style="margin:22px 0 10px;font-size:13px;font-weight:600">Domeinen die door meerdere assistenten worden geciteerd</h3>' +
          (shared.length
            ? '<div class="table-wrap"><table><thead><tr><th>Domein</th><th class="num">Vermeldingen</th><th>Assistenten</th></tr></thead><tbody>' +
              shared.slice(0, 40).map(function (d) {
                return '<tr class="' + (d.isMine ? 'mine-row' : '') + '"><td><b>' + esc(d.domain) + '</b>' +
                  (d.isMine ? ' <span class="badge badge-green">eigen</span>' : '') + '</td>' +
                  '<td class="num">' + d.total + '</td>' +
                  '<td><div class="chips">' + (d.providers || []).map(function (pid) { return providerBadge(pid); }).join('') + '</div></td></tr>';
              }).join('') + '</tbody></table></div>'
            : '<p class="mute" style="font-size:11.5px">Geen enkel domein komt bij meer dan één assistent voor.</p>')
        : '') +

      '<p class="mute" style="margin-top:14px;font-size:11.5px;max-width:820px;line-height:1.6">' +
      'De extractie verschilt per assistent. ChatGPT geeft zijn zoekopdrachten expliciet prijs in de tool-call. ' +
      'Perplexity levert ze als zoeksleutels of als leesbare Pro Search-stappen. Gemini codeert alles in positionele ' +
      'arrays zonder veldnamen — daar wordt op patronen geëxtraheerd, wat betekent dat een wijziging aan Google\'s ' +
      'codering tot minder resultaat kan leiden.</p>';
  }

  var VIEWS = { queries: viewQueries, entities: viewEntities, domains: viewDomains, turns: viewTurns, types: viewTypes, providers: viewProviders };

  function render() {
    recompute();
    renderTiles();
    el.view.innerHTML = (VIEWS[state.view] || viewQueries)();
    Array.prototype.forEach.call(el.tabbar.children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });
  }

  function renderFilterOptions() {
    var convs = {};
    state.all.forEach(function (t) {
      if (!t.conversationId) return;
      convs[t.conversationId] = t.conversationTitle || t.conversationId.slice(0, 8);
    });
    var cur = el.conversation.value;
    el.conversation.innerHTML = '<option value="">Alle conversaties (' + Object.keys(convs).length + ')</option>' +
      Object.keys(convs).map(function (id) {
        return '<option value="' + esc(id) + '">' + esc(convs[id] || id) + '</option>';
      }).join('');
    el.conversation.value = cur;

    var provs = {};
    state.all.forEach(function (t) {
      var pid = t.provider || 'chatgpt';
      provs[pid] = t.providerLabel || state.providerLabels[pid] || pid;
    });
    var curP = el.provider.value;
    el.provider.innerHTML = '<option value="">Alle assistenten</option>' +
      Object.keys(provs).map(function (k) { return '<option value="' + esc(k) + '">' + esc(provs[k]) + '</option>'; }).join('');
    el.provider.value = curP;

    var types = {};
    state.all.forEach(function (t) {
      (t.fanout || []).forEach(function (q) { if (q.kind === 'search' && q.type) types[q.type] = q.typeLabel || q.type; });
    });
    var curT = el.qtype.value;
    el.qtype.innerHTML = '<option value="">Alle querytypen</option>' +
      Object.keys(types).map(function (k) { return '<option value="' + esc(k) + '">' + esc(types[k]) + '</option>'; }).join('');
    el.qtype.value = curT;
  }

  /* -------------------------------------------------------------- events */

  el.tabbar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (!b) return;
    state.view = b.getAttribute('data-view');
    render();
  });

  el.view.addEventListener('click', function (e) {
    var sortEl = e.target.closest('[data-sort]');
    if (sortEl) {
      var vk = sortEl.getAttribute('data-view');
      var k = sortEl.getAttribute('data-sort');
      var s = state.sort[vk] || (state.sort[vk] = { k: k, dir: -1 });
      if (s.k === k) s.dir = -s.dir; else { s.k = k; s.dir = -1; }
      render();
      return;
    }

    var tb = e.target.closest('[data-turn]');
    if (tb) {
      var id = tb.getAttribute('data-turn');
      var act = tb.getAttribute('data-act');
      var turn = state.all.filter(function (t) { return t.id === id; })[0];
      if (!turn) return;
      if (act === 'del') { self.FanoutStore.deleteTurn(id).then(load); return; }
      if (act === 'copy') {
        self.FanoutExport.copyToClipboard((turn.fanout || []).filter(function (q) { return q.kind === 'search'; })
          .map(function (q) { return q.q; }).join('\n'));
        toast('Queries gekopieerd');
        return;
      }
      var agg = self.FanoutAnalysis.aggregate([turn], state.settings);
      self.FanoutExport.exportData(act, [turn], agg, 'turn');
    }
  });

  var searchTimer;
  el.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.filter = el.search.value; render(); }, 160);
  });
  el.conversation.addEventListener('change', function () { state.conversation = el.conversation.value; render(); });
  el.provider.addEventListener('change', function () { state.provider = el.provider.value; render(); });
  el.period.addEventListener('change', function () { state.period = Number(el.period.value); render(); });
  el.qtype.addEventListener('change', function () { state.qtype = el.qtype.value; render(); });

  el.exportBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    el.exportMenu.classList.toggle('open');
  });
  document.addEventListener('click', function () { el.exportMenu.classList.remove('open'); });
  el.exportMenu.addEventListener('click', function (e) {
    var b = e.target.closest('[data-export]');
    if (!b) return;
    if (!state.turns.length) { toast('Niets te exporteren', true); return; }
    var label = state.conversation ? (state.agg.conversations[state.conversation] || 'conversatie')
      : state.provider ? state.provider : 'alles';
    self.FanoutExport.exportData(b.getAttribute('data-export'), state.turns, state.agg, label);
    el.exportMenu.classList.remove('open');
    toast('Export gestart');
  });

  $('#btnResync').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true; btn.textContent = '↻ Ophalen…';
    chrome.runtime.sendMessage({ type: 'fanout:resync-active' }, function (res) {
      btn.disabled = false; btn.textContent = '↻ Historie ophalen';
      if (!res || !res.ok) { toast((res && res.error) || 'Ophalen mislukt — staat ChatGPT open?', true); return; }
      toast(res.turns + ' turns opgehaald');
      load();
    });
  });

  /* ---------------------------------------------------------- instellingen */

  function syncThemeButton() {
    var dark = state.settings.theme === 'dark';
    $('#btnTheme').textContent = dark ? '☀ Licht' : '☾ Donker';
  }

  $('#btnTheme').addEventListener('click', function () {
    var next = state.settings.theme === 'dark' ? 'light' : 'dark';
    self.FanoutStore.applyTheme(next);
    self.FanoutStore.setSettings({ theme: next }).then(function (s) {
      state.settings = s;
      syncThemeButton();
    });
  });

  $('#btnSettings').addEventListener('click', function () {
    $('#myDomains').value = (state.settings.myDomains || []).join('\n');
    $('#maxTurns').value = state.settings.maxTurns || 800;
    $('#capturePaused').checked = !!state.settings.capturePaused;
    self.FanoutStore.usage().then(function (b) {
      $('#storageInfo').textContent = b === null ? '' :
        'Opslag in gebruik: ' + bytes(b) + ' · ' + state.all.length + ' turns bewaard.';
    });
    el.dlg.showModal();
  });

  $('#btnSaveSettings').addEventListener('click', function () {
    var domains = $('#myDomains').value.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    self.FanoutStore.setSettings({
      myDomains: domains,
      maxTurns: Math.max(50, Number($('#maxTurns').value) || 800),
      capturePaused: $('#capturePaused').checked
    }).then(function (s) {
      state.settings = s;
      return self.FanoutStore.reanalyseAll();
    }).then(function () {
      el.dlg.close();
      toast('Instellingen opgeslagen');
      load();
    });
  });

  $('#btnClear').addEventListener('click', function () {
    if (!confirm('Alle opgenomen turns definitief wissen? Dit kan niet ongedaan worden gemaakt.')) return;
    self.FanoutStore.clearAll().then(function () {
      el.dlg.close();
      toast('Alles gewist');
      load();
    });
  });

  /* ----------------------------------------------------------------- load */

  function load() {
    return Promise.all([self.FanoutStore.getTurns(), self.FanoutStore.getSettings()]).then(function (res) {
      state.all = res[0];
      state.settings = res[1];
      self.FanoutStore.applyTheme(state.settings.theme);
      syncThemeButton();
      renderFilterOptions();
      render();
    });
  }

  var reloadTimer;
  self.FanoutStore.onChange(function () {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 500);
  });

  load();
})();
