/*
 * Fanouts — export.
 * JSON (volledig), CSV (per dataset) en Markdown (leesbaar rapport).
 */
;(function (root) {
  'use strict';

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function stamp(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '_' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function isoDate(ts) {
    if (!ts) return '';
    try { return new Date(ts).toISOString(); } catch (e) { return ''; }
  }

  /* ---------------------------------------------------------------- CSV */

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\n\r;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(rows, columns) {
    var head = columns.map(function (c) { return csvCell(c.label); }).join(',');
    var body = rows.map(function (r) {
      return columns.map(function (c) { return csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key]); }).join(',');
    });
    // BOM zodat Excel UTF-8 correct oppakt
    return '﻿' + [head].concat(body).join('\r\n');
  }

  var COLUMNS = {
    queries: [
      { label: 'query', key: 'q' },
      { label: 'type', key: 'typeLabel' },
      { label: 'type_key', key: 'type' },
      { label: 'aantal', key: 'count' },
      { label: 'turns', key: 'turnCount' },
      { label: 'overlap_met_prompt', key: 'avgOverlap' },
      { label: 'gevonden_domeinen', get: function (r) { return (r.domains || []).join(' | '); } },
      { label: 'prompts', get: function (r) { return (r.prompts || []).join(' || '); } }
    ],
    turnQueries: [
      { label: 'turn_id', key: 'turnId' },
      { label: 'provider', key: 'provider' },
      { label: 'datum', get: function (r) { return isoDate(r.createdAt); } },
      { label: 'conversatie', key: 'conversationTitle' },
      { label: 'prompt', key: 'prompt' },
      { label: 'volgorde', key: 'order' },
      { label: 'query', key: 'q' },
      { label: 'soort', key: 'kind' },
      { label: 'type', key: 'typeLabel' },
      { label: 'overlap_met_prompt', key: 'overlap' },
      { label: 'nieuwe_termen', get: function (r) { return (r.novel || []).join(' ') } },
      { label: 'domeinfilter', get: function (r) { return (r.domains || []).join(' | '); } },
      { label: 'recency', key: 'recency' },
      { label: 'bronnen_gevonden', key: 'sourceCount' },
      { label: 'domeinen_gevonden', get: function (r) { return (r.domains_found || []).join(' | '); } },
      { label: 'model', key: 'model' },
      { label: 'conversatie_url', key: 'conversationUrl' }
    ],
    sources: [
      { label: 'domein', key: 'domain' },
      { label: 'merk', key: 'brand' },
      { label: 'vermeldingen', key: 'total' },
      { label: 'geciteerd', key: 'cited' },
      { label: 'unieke_urls', key: 'urlCount' },
      { label: 'turns', key: 'turnCount' },
      { label: 'share_pct', key: 'share' },
      { label: 'assistenten', get: function (r) { return (r.providers || []).join(' | '); } },
      { label: 'eigen_domein', get: function (r) { return r.isMine ? 'ja' : 'nee'; } },
      { label: 'top_urls', get: function (r) { return (r.topUrls || []).map(function (u) { return u.url; }).join(' | '); } }
    ],
    turnSources: [
      { label: 'turn_id', key: 'turnId' },
      { label: 'provider', key: 'provider' },
      { label: 'datum', get: function (r) { return isoDate(r.createdAt); } },
      { label: 'prompt', key: 'prompt' },
      { label: 'url', key: 'url' },
      { label: 'domein', key: 'domain' },
      { label: 'titel', key: 'title' },
      { label: 'snippet', key: 'snippet' },
      { label: 'herkomst', key: 'origin' },
      { label: 'publicatiedatum', key: 'pubDate' },
      { label: 'eigen_domein', get: function (r) { return r.isMine ? 'ja' : 'nee'; } },
      { label: 'antwoord', key: 'answer' }
    ],
    entities: [
      { label: 'entiteit', key: 'name' },
      { label: 'type', key: 'type' },
      { label: 'score', key: 'score' },
      { label: 'totaal', key: 'total' },
      { label: 'in_prompt', key: 'inPrompt' },
      { label: 'in_fanout_queries', key: 'inQueries' },
      { label: 'in_antwoord', key: 'inAnswer' },
      { label: 'in_bronnen', key: 'inSources' },
      { label: 'door_model_toegevoegd', get: function (r) { return (r.modelAdded ? 'ja' : 'nee'); } },
      { label: 'turns', key: 'turnCount' },
      { label: 'gerelateerde_queries', get: function (r) { return (r.queries || []).join(' | '); } },
      { label: 'domeinen', get: function (r) { return (r.domains || []).join(' | '); } }
    ],
    turns: [
      { label: 'turn_id', key: 'id' },
      { label: 'provider', key: 'provider' },
      { label: 'datum', get: function (r) { return isoDate(r.createdAt); } },
      { label: 'conversatie', key: 'conversationTitle' },
      { label: 'conversatie_url', key: 'conversationUrl' },
      { label: 'model', key: 'model' },
      { label: 'prompt', key: 'prompt' },
      { label: 'fanout_queries', get: function (r) { return r.stats ? r.stats.fanoutCount : 0; } },
      { label: 'bronnen', get: function (r) { return r.stats ? r.stats.sourceCount : 0; } },
      { label: 'geciteerd', get: function (r) { return r.stats ? r.stats.citedCount : 0; } },
      { label: 'domeinen', get: function (r) { return r.stats ? r.stats.domainCount : 0; } },
      { label: 'entiteiten', get: function (r) { return r.stats ? r.stats.entityCount : 0; } },
      { label: 'eigen_domein_hits', get: function (r) { return r.stats ? r.stats.myDomainHits : 0; } },
      { label: 'queries', get: function (r) { return (r.fanout || []).filter(function (q) { return q.kind === 'search'; }).map(function (q) { return q.q; }).join(' | '); } },
      { label: 'top_entiteiten', get: function (r) { return (r.entities || []).slice(0, 15).map(function (e) { return e.name; }).join(' | '); } },
      { label: 'antwoord_tekens', get: function (r) { return (r.answer || '').length; } },
      // Volledige antwoordtekst, niet afgekapt: dit is de kolom waarop je
      // inhoudelijk analyseert (welke merken worden genoemd, in welke volgorde,
      // met welke framing). Staat achteraan zodat de smalle kolommen leesbaar
      // blijven in Excel.
      { label: 'antwoord', key: 'answer' }
    ]
  };

  /* Platgeslagen rijen: één regel per query resp. per bron. */
  function flattenQueries(turns) {
    var rows = [];
    turns.forEach(function (t) {
      (t.fanout || []).forEach(function (q) {
        rows.push(Object.assign({}, q, {
          turnId: t.id,
          provider: t.provider || 'chatgpt',
          createdAt: t.createdAt,
          conversationTitle: t.conversationTitle,
          conversationUrl: t.conversationUrl,
          prompt: t.prompt,
          model: t.model
        }));
      });
    });
    return rows;
  }

  function flattenSources(turns) {
    var rows = [];
    turns.forEach(function (t) {
      (t.sources || []).forEach(function (s) {
        rows.push(Object.assign({}, s, {
          turnId: t.id,
          provider: t.provider || 'chatgpt',
          createdAt: t.createdAt,
          prompt: t.prompt,
          answer: t.answer || ''
        }));
      });
    });
    return rows;
  }

  /* ----------------------------------------------------------- Markdown */

  function mdEscape(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\n+/g, ' '); }

  function toMarkdown(turns, agg) {
    var L = [];
    L.push('# AI query fan-out rapport');
    L.push('');
    L.push('_Gegenereerd op ' + new Date().toLocaleString('nl-NL') + ' met Fanouts._');
    L.push('');
    L.push('## Samenvatting');
    L.push('');
    L.push('| Metric | Waarde |');
    L.push('| --- | ---: |');
    L.push('| Turns | ' + agg.turnCount + ' |');
    L.push('| Conversaties | ' + agg.conversationCount + ' |');
    L.push('| Fan-out queries (totaal) | ' + agg.totalQueries + ' |');
    L.push('| Unieke queries | ' + agg.uniqueQueries + ' |');
    L.push('| Gemiddelde fan-out per turn | ' + agg.avgFanout + ' |');
    L.push('| Bronvermeldingen | ' + agg.totalSources + ' |');
    L.push('| Unieke domeinen | ' + agg.uniqueDomains + ' |');
    L.push('');

    if ((agg.providers || []).length) {
      L.push('## Per assistent');
      L.push('');
      L.push('| Assistent | Turns | Queries | Queries/turn | Bronnen | Domeinen |');
      L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
      agg.providers.forEach(function (p) {
        L.push('| ' + mdEscape(p.label) + ' | ' + p.turns + ' | ' + p.queries + ' | ' + p.avgFanout +
          ' | ' + p.sources + ' | ' + p.domainCount + ' |');
      });
      L.push('');
    }

    if (agg.types.length) {
      L.push('## Verdeling querytypen');
      L.push('');
      L.push('| Type | Aantal | Aandeel |');
      L.push('| --- | ---: | ---: |');
      agg.types.forEach(function (t) { L.push('| ' + mdEscape(t.label) + ' | ' + t.count + ' | ' + t.share + '% |'); });
      L.push('');
    }

    if (agg.entities.length) {
      L.push('## Top entiteiten');
      L.push('');
      L.push('| Entiteit | Type | Score | In fan-out | In prompt | In antwoord | In bronnen |');
      L.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
      agg.entities.slice(0, 40).forEach(function (e) {
        L.push('| ' + mdEscape(e.name) + ' | ' + e.type + ' | ' + e.score + ' | ' + e.inQueries + ' | ' + e.inPrompt + ' | ' + e.inAnswer + ' | ' + e.inSources + ' |');
      });
      L.push('');
    }

    if (agg.domains.length) {
      L.push('## Bronnen — share of voice');
      L.push('');
      L.push('| Domein | Vermeldingen | Geciteerd | Aandeel | Turns |');
      L.push('| --- | ---: | ---: | ---: | ---: |');
      agg.domains.slice(0, 40).forEach(function (d) {
        L.push('| ' + mdEscape(d.domain) + (d.isMine ? ' **(eigen)**' : '') + ' | ' + d.total + ' | ' + d.cited + ' | ' + d.share + '% | ' + d.turnCount + ' |');
      });
      L.push('');
    }

    L.push('## Turns');
    L.push('');
    turns.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (t, i) {
      L.push('### ' + (i + 1) + '. ' + mdEscape((t.prompt || '(geen prompt)').slice(0, 160)));
      L.push('');
      L.push('- **Assistent:** ' + mdEscape(t.providerLabel || t.provider || 'ChatGPT'));
      L.push('- **Datum:** ' + new Date(t.createdAt).toLocaleString('nl-NL'));
      if (t.conversationTitle) L.push('- **Conversatie:** ' + mdEscape(t.conversationTitle));
      if (t.conversationUrl) L.push('- **Link:** ' + t.conversationUrl);
      if (t.model) L.push('- **Model:** ' + t.model);
      L.push('');

      var searches = (t.fanout || []).filter(function (q) { return q.kind === 'search'; });
      if (searches.length) {
        L.push('**Fan-out queries (' + searches.length + '):**');
        L.push('');
        searches.forEach(function (q, n) {
          L.push((n + 1) + '. `' + q.q + '`  — _' + (q.typeLabel || q.type || '') + '_' +
            (q.domains && q.domains.length ? ' · filter: ' + q.domains.join(', ') : '') +
            (q.sourceCount ? ' · ' + q.sourceCount + ' bronnen' : ''));
        });
        L.push('');
      }

      var related = (t.fanout || []).filter(function (q) { return q.kind === 'related'; });
      if (related.length) {
        L.push('**Vervolgvragen die de assistent voorstelde:**');
        L.push('');
        related.forEach(function (r) { L.push('- ' + mdEscape(r.q)); });
        L.push('');
      }

      var actions = (t.fanout || []).filter(function (q) { return q.kind !== 'search' && q.kind !== 'related'; });
      if (actions.length) {
        L.push('**Overige acties:** ' + actions.map(function (a) { return a.kind + '(' + mdEscape(a.q.slice(0, 80)) + ')'; }).join(', '));
        L.push('');
      }

      if ((t.entities || []).length) {
        L.push('**Entiteiten:** ' + t.entities.slice(0, 25).map(function (e) {
          return mdEscape(e.name) + (e.modelAdded ? ' *' : '');
        }).join(', '));
        L.push('');
        L.push('_\\* = door het model toegevoegd, stond niet in de prompt._');
        L.push('');
      }

      if (t.answer) {
        L.push('**Antwoord** (' + t.answer.length + ' tekens):');
        L.push('');
        // Als blockquote zodat een lang antwoord visueel gescheiden blijft van
        // de analyse eromheen. Lege regels binnen het antwoord krijgen ook een
        // '>' mee, anders breekt de quote halverwege af.
        t.answer.split('\n').forEach(function (line) { L.push('> ' + line); });
        L.push('');
      }

      if ((t.sources || []).length) {
        L.push('**Bronnen (' + t.sources.length + '):**');
        L.push('');
        t.sources.slice(0, 60).forEach(function (s) {
          L.push('- [' + mdEscape(s.title || s.domain) + '](' + s.url + ') — `' + s.domain + '`' +
            (s.origin === 'citation' ? ' · geciteerd' : '') + (s.isMine ? ' · **eigen domein**' : ''));
        });
        L.push('');
      }
      L.push('---');
      L.push('');
    });

    return L.join('\n');
  }

  /* -------------------------------------------------------------- Download */

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }

  function exportData(kind, turns, agg, scopeLabel) {
    var base = 'fanouts_' + (scopeLabel ? scopeLabel.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40) + '_' : '') + stamp();
    if (kind === 'json') {
      download(base + '.json', JSON.stringify({
        tool: 'Fanouts', version: 1, exportedAt: new Date().toISOString(),
        summary: {
          turnCount: agg.turnCount, conversationCount: agg.conversationCount,
          totalQueries: agg.totalQueries, uniqueQueries: agg.uniqueQueries,
          totalSources: agg.totalSources, uniqueDomains: agg.uniqueDomains,
          avgFanout: agg.avgFanout, types: agg.types, providers: agg.providers
        },
        aggregates: { queries: agg.queries, domains: agg.domains, entities: agg.entities },
        turns: turns
      }, null, 2), 'application/json');
      return;
    }
    if (kind === 'md') { download(base + '.md', toMarkdown(turns, agg), 'text/markdown'); return; }
    if (kind === 'csv-queries') { download(base + '_queries.csv', toCsv(flattenQueries(turns), COLUMNS.turnQueries), 'text/csv'); return; }
    if (kind === 'csv-queries-agg') { download(base + '_queries-uniek.csv', toCsv(agg.queries, COLUMNS.queries), 'text/csv'); return; }
    if (kind === 'csv-sources') { download(base + '_bronnen.csv', toCsv(flattenSources(turns), COLUMNS.turnSources), 'text/csv'); return; }
    if (kind === 'csv-domains') { download(base + '_domeinen.csv', toCsv(agg.domains, COLUMNS.sources), 'text/csv'); return; }
    if (kind === 'csv-entities') { download(base + '_entiteiten.csv', toCsv(agg.entities, COLUMNS.entities), 'text/csv'); return; }
    if (kind === 'csv-turns') { download(base + '_turns.csv', toCsv(turns, COLUMNS.turns), 'text/csv'); return; }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  root.FanoutExport = {
    exportData: exportData,
    toMarkdown: toMarkdown,
    toCsv: toCsv,
    download: download,
    copyToClipboard: copyToClipboard,
    flattenQueries: flattenQueries,
    flattenSources: flattenSources,
    COLUMNS: COLUMNS
  };
})(typeof self !== 'undefined' ? self : this);
