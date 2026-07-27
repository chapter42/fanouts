/* Fanouts — zijpaneel. */
(function () {
  'use strict';

  var state = {
    turns: [],
    active: null,
    settings: { myDomains: [], capturePaused: false, theme: 'light' },
    scope: 'active',
    filter: '',
    open: {},
    tab: {}
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var el = {
    list: $('#list'),
    stats: $('#stats'),
    search: $('#search'),
    scope: $('#scope'),
    scopeLabel: $('#scopeLabel'),
    dot: $('#statusDot'),
    toast: $('#toast'),
    pause: $('#btnPause'),
    theme: $('#btnTheme'),
    dashboard: $('#btnDashboard'),
    resync: $('#btnResync')
  };

  /* ------------------------------------------------------------ helpers */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Bronnen komen uit een webpagina: alleen http(s) toelaten in href.
  function safeUrl(u) {
    return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
  }

  var PROVIDER_LABEL = { chatgpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini' };

  function providerBadge(turn) {
    var id = turn.provider || 'chatgpt';
    return '<span class="badge p-' + esc(id) + '">' + esc(turn.providerLabel || PROVIDER_LABEL[id] || id) + '</span>';
  }

  function timeAgo(ts) {
    var d = Date.now() - ts;
    if (d < 60000) return 'zojuist';
    if (d < 3600000) return Math.floor(d / 60000) + ' min';
    if (d < 86400000) return Math.floor(d / 3600000) + ' uur';
    var days = Math.floor(d / 86400000);
    if (days < 30) return days + ' d';
    return new Date(ts).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  function errText(err) { return String((err && err.message) || err || 'onbekende fout'); }

  // Voor fire-and-forget acties: laat de gebruiker het weten als het misgaat.
  function run(promise, label) {
    promise.catch(function (err) { toast(label + ': ' + errText(err), true); });
  }

  var toastTimer;
  function toast(msg, isErr) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'toast'; }, 2600);
  }

  function visibleTurns() {
    var turns = state.turns;
    if (state.scope === 'active' && state.active && state.active.conversationId) {
      turns = turns.filter(function (t) { return t.conversationId === state.active.conversationId; });
    } else if (state.scope.indexOf('provider:') === 0) {
      var want = state.scope.slice(9);
      turns = turns.filter(function (t) { return (t.provider || 'chatgpt') === want; });
    }
    var f = state.filter.trim().toLowerCase();
    if (!f) return turns;
    return turns.filter(function (t) {
      if ((t.prompt || '').toLowerCase().indexOf(f) !== -1) return true;
      if ((t.fanout || []).some(function (q) { return q.q.toLowerCase().indexOf(f) !== -1; })) return true;
      if ((t.entities || []).some(function (e) { return e.name.toLowerCase().indexOf(f) !== -1; })) return true;
      if ((t.sources || []).some(function (s) { return s.domain.indexOf(f) !== -1 || (s.title || '').toLowerCase().indexOf(f) !== -1; })) return true;
      return false;
    });
  }

  /* -------------------------------------------------------------- render */

  function renderStats(turns) {
    var agg = self.FanoutAnalysis.aggregate(turns, state.settings);
    var mine = agg.domains.filter(function (d) { return d.isMine; });
    var mineHits = mine.reduce(function (a, d) { return a + d.total; }, 0);

    var parts = [
      '<span class="badge"><b>' + agg.turnCount + '</b> turns</span>',
      '<span class="badge badge-accent"><b>' + agg.totalQueries + '</b> queries</span>',
      '<span class="badge badge-mute"><b>' + agg.uniqueQueries + '</b> uniek</span>',
      '<span class="badge badge-cyan"><b>' + agg.uniqueDomains + '</b> domeinen</span>',
      '<span class="badge badge-pink"><b>' + agg.entities.length + '</b> entiteiten</span>',
      '<span class="badge badge-mute">ø <b>' + agg.avgFanout + '</b>/turn</span>'
    ];
    if (state.settings.myDomains.length) {
      parts.push('<span class="badge ' + (mineHits ? 'badge-green' : 'badge-mute') + '"><b>' + mineHits + '</b> eigen</span>');
    }
    if ((agg.providers || []).length > 1) {
      agg.providers.forEach(function (p) {
        parts.push('<span class="badge p-' + esc(p.id) + '"><b>' + p.queries + '</b> ' + esc(p.label) + '</span>');
      });
    }
    el.stats.innerHTML = parts.join('');
    return agg;
  }

  function queryHtml(q, i) {
    var subs = [];
    if (q.typeLabel) subs.push('<span class="badge badge-mute">' + esc(q.typeLabel) + '</span>');
    if (q.overlap !== null && q.overlap !== undefined && q.kind === 'search') {
      var cls = q.overlap >= 0.62 ? 'badge-mute' : 'badge-accent';
      subs.push('<span class="badge ' + cls + '">overlap ' + Math.round(q.overlap * 100) + '%</span>');
    }
    if (q.domains && q.domains.length) subs.push('<span class="badge badge-amber">site: ' + esc(q.domains.join(', ')) + '</span>');
    if (q.recency) subs.push('<span class="badge badge-amber">recency ' + esc(q.recency) + '</span>');
    if (q.sourceCount) subs.push('<span class="badge badge-cyan">' + q.sourceCount + ' bronnen</span>');
    if (q.kind !== 'search' && q.kind !== 'related') subs.push('<span class="badge badge-green">' + esc(q.kind) + '</span>');

    return '<div class="q-item">' +
      '<div class="q-num">' + (i + 1) + '</div>' +
      '<div class="q-main"><div class="q-text">' + esc(q.q) + '</div>' +
      (subs.length ? '<div class="q-sub">' + subs.join('') + '</div>' : '') + '</div>' +
      '<button class="q-copy" data-copy="' + esc(q.q) + '" title="Kopieer">⧉</button>' +
      '</div>';
  }

  function entityHtml(e) {
    return '<span class="ent t-' + esc(e.type) + '" title="' + esc(e.type + ' · prompt ' + e.inPrompt + ' · fan-out ' + e.inQueries + ' · antwoord ' + e.inAnswer + ' · bronnen ' + e.inSources) + '">' +
      (e.modelAdded ? '<span class="star" title="Door het model toegevoegd">✦</span>' : '') +
      esc(e.name) + '<span class="cnt">' + e.score + '</span></span>';
  }

  function sourceHtml(s) {
    var badges = [];
    if (s.origin === 'citation') badges.push('<span class="badge badge-green">geciteerd</span>');
    if (s.pubDate) badges.push('<span class="badge badge-mute">' + esc(String(s.pubDate).slice(0, 10)) + '</span>');
    return '<div class="src' + (s.isMine ? ' mine' : '') + '">' +
      '<div class="src-fav"></div>' +
      '<div class="src-main">' +
      '<div class="src-title"><a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noreferrer noopener">' + esc(s.title || s.url) + '</a></div>' +
      '<div class="src-dom">' + esc(s.domain) + badges.join('') + '</div>' +
      '</div></div>';
  }

  function domainBars(turn) {
    var counts = {};
    (turn.sources || []).forEach(function (s) { counts[s.domain] = (counts[s.domain] || 0) + 1; });
    var list = Object.keys(counts).map(function (d) { return { d: d, n: counts[d] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
    if (!list.length) return '';
    var max = list[0].n;
    var mine = (turn.sources || []).filter(function (s) { return s.isMine; }).map(function (s) { return s.domain; });
    return '<div class="domain-bars">' + list.map(function (x) {
      return '<div class="domain-bar"><span class="name" title="' + esc(x.d) + '">' + esc(x.d) + '</span>' +
        '<span class="track"><span class="fill' + (mine.indexOf(x.d) !== -1 ? ' mine' : '') + '" style="width:' + Math.round((x.n / max) * 100) + '%"></span></span>' +
        '<span class="val">' + x.n + '</span></div>';
    }).join('') + '</div>';
  }

  function turnHtml(turn) {
    var s = turn.stats || {};
    var isOpen = !!state.open[turn.id];
    var tab = state.tab[turn.id] || 'queries';
    var searches = (turn.fanout || []).filter(function (q) { return q.kind === 'search'; });
    var related = (turn.fanout || []).filter(function (q) { return q.kind === 'related'; });
    var actions = (turn.fanout || []).filter(function (q) { return q.kind !== 'search' && q.kind !== 'related'; });

    var badges = [
      '<span class="badge badge-accent"><b>' + (s.fanoutCount || 0) + '</b> queries</span>',
      '<span class="badge badge-cyan"><b>' + (s.sourceCount || 0) + '</b> bronnen</span>',
      '<span class="badge badge-mute"><b>' + (s.domainCount || 0) + '</b> domeinen</span>',
      '<span class="badge badge-pink"><b>' + (s.entityCount || 0) + '</b> entiteiten</span>'
    ];
    if (s.myDomainHits) badges.push('<span class="badge badge-green"><b>' + s.myDomainHits + '</b> eigen</span>');
    if (!s.fanoutCount) badges = ['<span class="badge badge-mute">geen websearch</span>'];

    var body = '';
    if (isOpen) {
      body =
        '<div class="turn-body">' +
        '<div class="tabs">' +
        '<button class="tab' + (tab === 'queries' ? ' active' : '') + '" data-tab="queries">Queries<i>' + searches.length + '</i></button>' +
        '<button class="tab' + (tab === 'entities' ? ' active' : '') + '" data-tab="entities">Entiteiten<i>' + (turn.entities || []).length + '</i></button>' +
        '<button class="tab' + (tab === 'sources' ? ' active' : '') + '" data-tab="sources">Bronnen<i>' + (turn.sources || []).length + '</i></button>' +
        '<button class="tab' + (tab === 'answer' ? ' active' : '') + '" data-tab="answer">Antwoord</button>' +
        '</div>' +

        '<div class="pane' + (tab === 'queries' ? ' active' : '') + '" data-pane="queries">' +
        (searches.length
          ? searches.map(queryHtml).join('') +
            (actions.length ? '<div style="margin-top:8px;padding-top:7px;border-top:1px dashed var(--border)">' + actions.map(queryHtml).join('') + '</div>' : '') +
            (related.length ? '<div class="sub-head">Vervolgvragen die de assistent voorstelde</div>' + related.map(queryHtml).join('') : '')
          : '<div class="empty"><strong>Geen fan-out</strong>ChatGPT heeft voor deze prompt geen webzoekopdrachten uitgevoerd.</div>') +
        '</div>' +

        '<div class="pane' + (tab === 'entities' ? ' active' : '') + '" data-pane="entities">' +
        ((turn.entities || []).length
          ? '<div class="ent-list">' + turn.entities.slice(0, 80).map(entityHtml).join('') + '</div>' +
            '<div class="ent-legend">✦ = entiteit die het model zélf toevoegde (stond niet in je prompt) · getal = relevantiescore</div>'
          : '<div class="empty">Geen entiteiten herkend.</div>') +
        '</div>' +

        '<div class="pane' + (tab === 'sources' ? ' active' : '') + '" data-pane="sources">' +
        ((turn.sources || []).length
          ? domainBars(turn) + '<div style="margin-top:9px">' + turn.sources.slice(0, 80).map(sourceHtml).join('') + '</div>'
          : '<div class="empty">Geen bronnen vastgelegd.</div>') +
        '</div>' +

        '<div class="pane' + (tab === 'answer' ? ' active' : '') + '" data-pane="answer">' +
        (turn.answer ? '<div class="answer">' + esc(turn.answer) + '</div>' : '<div class="empty">Nog geen antwoordtekst.</div>') +
        '</div>' +

        '<div class="turn-actions">' +
        '<button class="btn btn-sm" data-turn-export="md">Markdown</button>' +
        '<button class="btn btn-sm" data-turn-export="json">JSON</button>' +
        '<button class="btn btn-sm" data-turn-copy="queries">Kopieer queries</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-sm btn-danger" data-turn-delete="1">Verwijder</button>' +
        '</div>' +
        '</div>';
    }

    return '<article class="turn' + (isOpen ? ' open' : '') + '" data-id="' + esc(turn.id) + '">' +
      '<div class="turn-head">' +
      '<div class="turn-prompt">' + esc(turn.prompt || '(geen prompt vastgelegd)') + '</div>' +
      '<div class="turn-meta">' +
      providerBadge(turn) +
      '<span>' + timeAgo(turn.createdAt) + '</span>' +
      (turn.model ? '<span>· ' + esc(turn.model) + '</span>' : '') +
      (state.scope === 'all' && turn.conversationTitle ? '<span class="truncate">· ' + esc(turn.conversationTitle) + '</span>' : '') +
      '</div>' +
      '<div class="turn-badges">' + badges.join('') + '</div>' +
      '</div>' + body + '</article>';
  }

  function render() {
    var turns = visibleTurns();
    renderStats(turns);

    syncScopeOptions();
    el.scopeLabel.textContent = state.scope === 'active'
      ? (state.active && state.active.title ? state.active.title : 'Huidige conversatie')
      : state.scope.indexOf('provider:') === 0
        ? (PROVIDER_LABEL[state.scope.slice(9)] || state.scope.slice(9))
        : 'Alle conversaties';

    el.dot.className = 'dot ' + (state.settings.capturePaused ? 'paused' : 'live');
    el.dot.title = state.settings.capturePaused ? 'Opname gepauzeerd' : 'Actief — luistert mee';
    el.pause.textContent = state.settings.capturePaused ? '▶' : '⏸';
    var dark = state.settings.theme === 'dark';
    el.theme.textContent = dark ? '☀' : '☾';
    el.theme.title = dark ? 'Schakel naar licht thema' : 'Schakel naar donker thema';
    el.pause.classList.toggle('on', !!state.settings.capturePaused);

    if (!turns.length) {
      el.list.innerHTML = state.turns.length
        ? '<div class="empty"><strong>Niets in beeld</strong>Geen turns binnen dit filter. Zet het bereik op “Alles” of wis de zoekterm.</div>'
        : '<div class="empty"><strong>Nog niets opgenomen</strong>Open ChatGPT, Perplexity of Gemini en stel een vraag waarbij het web geraadpleegd wordt. De fan-out verschijnt hier live.<br><br>Al een ChatGPT-gesprek open? Klik rechtsboven op <b>↻</b> om de historie alsnog in te lezen.</div>';
      return;
    }
    el.list.innerHTML = turns.map(turnHtml).join('');
  }

  /* --------------------------------------------------------------- events */

  el.list.addEventListener('click', function (e) {
    var article = e.target.closest('.turn');
    if (!article) return;
    var id = article.getAttribute('data-id');
    var turn = state.turns.filter(function (t) { return t.id === id; })[0];

    var copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      self.FanoutExport.copyToClipboard(copyBtn.getAttribute('data-copy'));
      toast('Query gekopieerd');
      e.stopPropagation();
      return;
    }

    var tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { state.tab[id] = tabBtn.getAttribute('data-tab'); render(); return; }

    var exp = e.target.closest('[data-turn-export]');
    if (exp && turn) {
      var agg = self.FanoutAnalysis.aggregate([turn], state.settings);
      self.FanoutExport.exportData(exp.getAttribute('data-turn-export'), [turn], agg, 'turn');
      return;
    }

    var cp = e.target.closest('[data-turn-copy]');
    if (cp && turn) {
      var text = (turn.fanout || []).filter(function (q) { return q.kind === 'search'; })
        .map(function (q) { return q.q; }).join('\n');
      self.FanoutExport.copyToClipboard(text);
      toast('Alle queries gekopieerd');
      return;
    }

    var del = e.target.closest('[data-turn-delete]');
    if (del) {
      run((async function () {
        await self.FanoutStore.deleteTurn(id);
        await load();
      })(), 'Verwijderen mislukt');
      return;
    }

    if (e.target.closest('.turn-head')) {
      state.open[id] = !state.open[id];
      render();
    }
  });

  function syncScopeOptions() {
    var present = {};
    state.turns.forEach(function (t) { present[t.provider || 'chatgpt'] = true; });
    var ids = Object.keys(present);
    var wanted = ['active', 'all'].concat(ids.length > 1 ? ids.map(function (i) { return 'provider:' + i; }) : []);
    var current = Array.prototype.map.call(el.scope.options, function (o) { return o.value; }).join(',');
    if (current === wanted.join(',')) return;
    var keep = state.scope;
    el.scope.innerHTML =
      '<option value="active">Deze conversatie</option><option value="all">Alles</option>' +
      (ids.length > 1 ? ids.map(function (i) {
        return '<option value="provider:' + esc(i) + '">Alleen ' + esc(PROVIDER_LABEL[i] || i) + '</option>';
      }).join('') : '');
    el.scope.value = wanted.indexOf(keep) !== -1 ? keep : 'active';
    state.scope = el.scope.value;
  }

  el.search.addEventListener('input', function () { state.filter = el.search.value; render(); });
  el.scope.addEventListener('change', function () { state.scope = el.scope.value; render(); });

  el.pause.addEventListener('click', async function () {
    try {
      state.settings = await self.FanoutStore.setSettings({ capturePaused: !state.settings.capturePaused });
      toast(state.settings.capturePaused ? 'Opname gepauzeerd' : 'Opname hervat');
      render();
    } catch (err) {
      toast('Instelling opslaan mislukt: ' + errText(err), true);
    }
  });

  el.theme.addEventListener('click', async function () {
    var next = state.settings.theme === 'dark' ? 'light' : 'dark';
    self.FanoutStore.applyTheme(next);   // meteen zichtbaar, ook als opslaan faalt
    try {
      state.settings = await self.FanoutStore.setSettings({ theme: next });
    } catch (err) {
      state.settings.theme = next;
      toast('Thema onthouden mislukt — geldt alleen voor nu', true);
    }
    render();
  });

  el.dashboard.addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') });
  });

  el.resync.addEventListener('click', function () {
    el.resync.disabled = true;
    el.resync.textContent = '⋯';
    chrome.runtime.sendMessage({ type: 'fanout:resync-active' }, function (res) {
      el.resync.disabled = false;
      el.resync.textContent = '↻';
      if (!res || !res.ok) { toast((res && res.error) || 'Ophalen mislukt', true); return; }
      toast(res.turns + ' turns opgehaald');
      load();
    });
  });

  document.querySelectorAll('[data-export]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var turns = visibleTurns();
      if (!turns.length) { toast('Niets te exporteren', true); return; }
      var agg = self.FanoutAnalysis.aggregate(turns, state.settings);
      var label = state.scope === 'active' && state.active ? (state.active.title || 'conversatie') : 'alles';
      self.FanoutExport.exportData(btn.getAttribute('data-export'), turns, agg, label);
      toast('Export gestart');
    });
  });

  /* ----------------------------------------------------------------- load */

  var loadTimer = null;
  async function load() {
    try {
      var res = await Promise.all([
        self.FanoutStore.getTurns(),
        self.FanoutStore.getActive(),
        self.FanoutStore.getSettings()
      ]);
      state.turns = res[0];
      state.active = res[1];
      state.settings = res[2];
      self.FanoutStore.applyTheme(state.settings.theme);
      render();
    } catch (err) {
      el.list.innerHTML = '<div class="empty"><strong>Opslag onbereikbaar</strong>' +
        esc(errText(err)) + '<br><br>Herlaad de extensie via chrome://extensions.</div>';
    }
  }

  self.FanoutStore.onChange(function () {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(load, 250);
  });

  chrome.storage.onChanged.addListener(function (c, area) {
    if (area === 'local' && c['fanout:settings']) load();
  });

  load();
})();
