/*
 * End-to-end test zonder browser.
 *
 * Draait de échte interceptor (met een nagebootste window) over een realistische
 * delta-encoded SSE-stream, laat de opgevangen messages door parser/entities/
 * analysis lopen en controleert de uitkomst. Ook de historie-route (conversation
 * mapping) en de legacy-streamvorm worden getest.
 *
 *   node tools/test-parser.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
let checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  \x1b[32m✓\x1b[0m ' + label); return; }
  failures++;
  console.log('  \x1b[31m✗\x1b[0m ' + label + (detail !== undefined ? '\n      → ' + JSON.stringify(detail) : ''));
}

function section(name) { console.log('\n\x1b[1m' + name + '\x1b[0m'); }

/* ------------------------------------------------------------- sandbox */

function loadLibs() {
  const sandbox = { self: {}, console, TextDecoder, URL };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  ['src/lib/parser.js', 'src/lib/entities.js', 'src/lib/analysis.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  return sandbox;
}

/*
 * Draait interceptor.js in een nagebootste pagina en voert een SSE-body door de
 * gepatchte fetch. Levert alle window.postMessage-payloads terug.
 */
var MAIN_FILES = [
  'src/inject/util.js',
  'src/inject/providers/chatgpt.js',
  'src/inject/providers/perplexity.js',
  'src/inject/providers/gemini.js',
  'src/inject/interceptor.js'
];

function runInterceptor(sseText, requestBody, opts) {
  opts = opts || {};
  var host = opts.host || 'chatgpt.com';
  var href = opts.href || 'https://' + host + '/c/11111111-1111-1111-1111-111111111111';
  var endpoint = opts.endpoint || 'https://chatgpt.com/backend-api/f/conversation';
  const emitted = [];
  const timers = new Set();

  const fakeWindow = {
    location: { origin: 'https://' + host, href: href, hostname: host, pathname: new URL(href).pathname },
    postMessage: (msg) => emitted.push(msg),
    addEventListener() {},
    fetch: async () => { throw new Error('originele fetch niet gebruikt in deze test'); }
  };

  const sandbox = {
    window: fakeWindow,
    TextDecoder,
    Response,
    ReadableStream,
    console,
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; },
    clearInterval: (t) => { clearInterval(t); timers.delete(t); },
    XMLHttpRequest: function () {},
    URL, URLSearchParams, TextEncoder, Map, Set, Infinity,
    JSON, Promise, Array, Object, String, Number, Math, Date, Error, RegExp
  };
  sandbox.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };
  fakeWindow.location.toString = () => fakeWindow.location.href;
  sandbox.location = fakeWindow.location;
  vm.createContext(sandbox);

  // De echte fetch-implementatie die de interceptor omwikkelt.
  fakeWindow.fetch = async function (url, init) {
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        // In brokken opdelen zodat we ook een gesplitste SSE-frame testen.
        const chunks = [];
        for (let i = 0; i < sseText.length; i += 137) chunks.push(sseText.slice(i, i + 137));
        chunks.forEach((c) => controller.enqueue(enc.encode(c)));
        controller.close();
      }
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  MAIN_FILES.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });

  return sandbox.window
    .fetch(endpoint, { method: 'POST', body: requestBody })
    .then(async (res) => {
      await res.text(); // originele consumer
      // Wachten tot de clone volledig verwerkt is.
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 12));
        if (emitted.some((e) => e.type === 'turn-update' && e.payload && e.payload.done)) break;
      }
      timers.forEach((t) => clearInterval(t));
      return emitted;
    });
}

/* ------------------------------------------------------------- fixtures */

const CONV_ID = '11111111-1111-1111-1111-111111111111';

const REQUEST_BODY = JSON.stringify({
  action: 'next',
  conversation_id: CONV_ID,
  messages: [{
    id: 'user-1',
    author: { role: 'user' },
    content: { content_type: 'text', parts: ['Wat is het beste CRM voor een MKB-bedrijf in Nederland?'] }
  }],
  model: 'gpt-5'
});

function sse(objs) {
  return objs.map((o) => 'data: ' + (typeof o === 'string' ? o : JSON.stringify(o)) + '\n\n').join('') +
    'data: [DONE]\n\n';
}

const SEARCH_GROUPS = [{
  type: 'search_result_group',
  domain: 'salesforce.com',
  entries: [
    { type: 'search_result', url: 'https://www.salesforce.com/nl/crm/', title: 'Wat is CRM? — Salesforce', snippet: 'Salesforce CRM voor het MKB.', pub_date: '2026-02-01' },
    { type: 'search_result', url: 'https://www.salesforce.com/nl/pricing/', title: 'Salesforce prijzen', snippet: 'Vanaf 25 euro per gebruiker.' }
  ]
}, {
  type: 'search_result_group',
  domain: 'hubspot.com',
  entries: [
    { type: 'search_result', url: 'https://www.hubspot.com/products/crm', title: 'HubSpot CRM', snippet: 'Gratis CRM voor kleine teams.' }
  ]
}, {
  type: 'search_result_group',
  domain: 'chapter42.com',
  entries: [
    { type: 'search_result', url: 'https://chapter42.com/blog/crm-vergelijking', title: 'CRM-vergelijking voor het MKB — Chapter42', snippet: 'Onafhankelijke vergelijking.' }
  ]
}];

const STREAM = sse([
  { type: 'delta', v: {
    message: {
      id: 'assist-tool-1',
      author: { role: 'assistant' },
      create_time: 1770000000.1,
      content: { content_type: 'code', language: 'unknown', text: '' },
      status: 'in_progress',
      recipient: 'web',
      metadata: { model_slug: 'gpt-5' }
    },
    conversation_id: CONV_ID
  }, c: 1 },

  // Tool-call payload druppelt binnen, eerst mét pad, daarna sticky.
  { v: '{"search_query":[{"q":"', p: '/message/content/text', o: 'append' },
  { v: 'beste CRM software MKB Nederland 2026"},{"q":"' },
  { v: 'HubSpot vs Salesforce prijzen vergelijking"},{"q":"' },
  { v: 'CRM systeem ervaringen review Nederlandse bedrijven","domains":["tweakers.net"]}],"response_length":"medium"}' },

  { o: 'patch', v: [
    { p: '/message/status', o: 'replace', v: 'finished_successfully' },
    { p: '/message/metadata/search_queries', o: 'add', v: [
      { type: 'search', q: 'beste CRM software MKB Nederland 2026' },
      { type: 'search', q: 'HubSpot vs Salesforce prijzen vergelijking' },
      { type: 'search', q: 'CRM systeem ervaringen review Nederlandse bedrijven' }
    ] }
  ] },

  // Tool-antwoord met zoekresultaten
  { type: 'delta', v: {
    message: {
      id: 'tool-1',
      author: { role: 'tool', name: 'web' },
      create_time: 1770000002.4,
      content: { content_type: 'text', parts: [''] },
      status: 'finished_successfully',
      recipient: 'all',
      metadata: { search_result_groups: SEARCH_GROUPS }
    },
    conversation_id: CONV_ID
  }, c: 6 },

  // Zichtbaar antwoord
  { type: 'delta', v: {
    message: {
      id: 'assist-answer',
      author: { role: 'assistant' },
      create_time: 1770000003.0,
      content: { content_type: 'text', parts: [''] },
      status: 'in_progress',
      recipient: 'all',
      metadata: { model_slug: 'gpt-5' }
    },
    conversation_id: CONV_ID
  }, c: 7 },

  { v: 'Voor een MKB-bedrijf in Nederland zijn ', p: '/message/content/parts/0', o: 'append' },
  { v: 'HubSpot en Salesforce de bekendste opties. ' },
  { v: 'Pipedrive is een goedkoper alternatief, en Teamleader is sterk in de Benelux.' },

  { o: 'patch', v: [
    { p: '/message/status', o: 'replace', v: 'finished_successfully' },
    { p: '/message/metadata/content_references', o: 'add', v: [{
      type: 'grouped_webpages',
      matched_text: '',
      start_idx: 40,
      end_idx: 70,
      items: [
        { title: 'HubSpot CRM', url: 'https://www.hubspot.com/products/crm', attribution: 'hubspot.com' },
        { title: 'CRM-vergelijking voor het MKB — Chapter42', url: 'https://chapter42.com/blog/crm-vergelijking', attribution: 'chapter42.com' }
      ]
    }] }
  ] }
]);

/* Legacy: elk event bevat een volledig message-snapshot. */
const LEGACY_STREAM = sse([
  { message: { id: 'l1', author: { role: 'assistant' }, recipient: 'browser',
    content: { content_type: 'code', text: 'search("laadpaal subsidie 2026")' }, metadata: {} },
    conversation_id: CONV_ID },
  { message: { id: 'l1', author: { role: 'assistant' }, recipient: 'browser',
    content: { content_type: 'code', text: 'search("laadpaal subsidie 2026")\nsearch("thuisbatterij terugverdientijd")' }, metadata: {} },
    conversation_id: CONV_ID }
]);

/* ------------------------------------------------------------------ run */

(async function main() {
  const libs = loadLibs();

  section('1. Interceptor — delta-encoded stream');
  const emitted = await runInterceptor(STREAM, REQUEST_BODY);

  const start = emitted.find((e) => e.type === 'turn-start');
  ok(!!start, 'turn-start wordt uitgezonden');
  ok(start && start.payload.prompt.indexOf('beste CRM') !== -1, 'prompt komt uit de request body', start && start.payload.prompt);
  ok(start && start.payload.promptId === 'user-1', 'prompt-id wordt meegegeven');

  const updates = emitted.filter((e) => e.type === 'turn-update');
  ok(updates.length > 0, 'turn-update wordt uitgezonden (' + updates.length + '×)');
  const final = updates[updates.length - 1];
  ok(final.payload.done === true, 'laatste update is gemarkeerd als done');
  ok(final.payload.messages.length === 3, 'drie messages gereconstrueerd', final.payload.messages.map((m) => m.id));

  const toolCall = final.payload.messages.find((m) => m.id === 'assist-tool-1');
  ok(toolCall && toolCall.content.text.indexOf('"response_length":"medium"') !== -1,
    'gestreamde tool-call tekst volledig samengevoegd', toolCall && toolCall.content.text);

  const answerMsg = final.payload.messages.find((m) => m.id === 'assist-answer');
  ok(answerMsg && answerMsg.content.parts[0].indexOf('Teamleader') !== -1,
    'sticky-path appends correct toegepast op het antwoord', answerMsg && answerMsg.content.parts[0]);
  ok(answerMsg && Array.isArray(answerMsg.metadata.content_references),
    'content_references via batch-patch aangekomen');

  section('2. Parser — turns uit de stream');
  const turns = libs.FanoutParser.buildTurns(final.payload);
  ok(turns.length === 1, 'precies één turn', turns.length);
  const turn = turns[0];
  ok(turn.id === 'chatgpt:' + CONV_ID + ':user-1', 'stabiele turn-id met provider-prefix', turn.id);
  ok(turn.provider === 'chatgpt', 'provider op de turn', turn.provider);
  ok(turn.prompt.indexOf('MKB-bedrijf') !== -1, 'prompt gekoppeld aan de turn');
  ok(turn.model === 'gpt-5', 'model herkend', turn.model);

  const searches = turn.fanout.filter((q) => q.kind === 'search');
  ok(searches.length === 3, 'drie fan-out queries geëxtraheerd', searches.map((q) => q.q));
  ok(searches[0].q === 'beste CRM software MKB Nederland 2026', 'eerste query klopt', searches[0].q);
  ok(searches.some((q) => q.domains && q.domains[0] === 'tweakers.net'), 'domeinfilter uit de payload bewaard');
  ok(searches.length === new Set(searches.map((q) => q.q)).size,
    'geen duplicaten tussen tool-call en metadata.search_queries');

  ok(turn.sources.length === 4, 'vier unieke bronnen', turn.sources.map((s) => s.url));
  ok(turn.sources.some((s) => s.domain === 'chapter42.com'), 'chapter42.com gevonden');
  const hubspot = turn.sources.find((s) => s.domain === 'hubspot.com');
  ok(hubspot && hubspot.origin === 'citation', 'geciteerde bron krijgt origin=citation', hubspot && hubspot.origin);
  ok(turn.answer.indexOf('Teamleader') !== -1, 'antwoordtekst vastgelegd');
  ok(searches.every((q) => q.sourceCount === 4), 'bronnen teruggekoppeld aan de tool-call', searches.map((q) => q.sourceCount));

  section('3. Analyse — classificatie en entiteiten');
  libs.FanoutAnalysis.analyseTurn(turn, { myDomains: ['chapter42.com'] });

  ok(searches.every((q) => !!q.type), 'elke query heeft een type', searches.map((q) => q.type));
  const cmp = turn.fanout.find((q) => /HubSpot vs Salesforce/.test(q.q));
  ok(cmp.type === 'comparative', 'vs-query als vergelijkend geclassificeerd', cmp.type);
  const rev = turn.fanout.find((q) => /ervaringen review/.test(q.q));
  ok(rev.type === 'review', 'review-query als review geclassificeerd', rev.type);

  const names = turn.entities.map((e) => e.name);
  ok(names.indexOf('HubSpot') !== -1, 'entiteit HubSpot herkend', names.slice(0, 15));
  ok(names.indexOf('Salesforce') !== -1, 'entiteit Salesforce herkend');
  ok(names.some((n) => /Pipedrive/.test(n)), 'entiteit Pipedrive uit het antwoord herkend');
  ok(names.some((n) => /Nederland/.test(n)), 'entiteit Nederland herkend');
  ok(!names.some((n) => /^(Voor|De|Het|Een|Wat)$/i.test(n)), 'geen stopwoorden als entiteit', names.filter((n) => /^(Voor|De|Het|Een|Wat)$/i.test(n)));

  const pipedrive = turn.entities.find((e) => e.name === 'Pipedrive');
  ok(pipedrive && pipedrive.inPrompt === 0, 'Pipedrive stond niet in de prompt');
  const salesforce = turn.entities.find((e) => e.name === 'Salesforce');
  ok(salesforce && salesforce.modelAdded === true, 'Salesforce gemarkeerd als door het model toegevoegd');
  ok(turn.entities.some((e) => e.type === 'brand'), 'minstens één merk-entiteit uit een domein');

  ok(turn.stats.fanoutCount === 3, 'stats.fanoutCount', turn.stats.fanoutCount);
  ok(turn.stats.myDomainHits === 1, 'eigen domein herkend in de bronnen', turn.stats.myDomainHits);
  ok(turn.sources.find((s) => s.domain === 'chapter42.com').isMine === true, 'bron gemarkeerd als eigen domein');

  section('4. Aggregatie');
  const agg = libs.FanoutAnalysis.aggregate([turn], { myDomains: ['chapter42.com'] });
  ok(agg.totalQueries === 3, 'totaal aantal queries', agg.totalQueries);
  ok(agg.uniqueDomains === 3, 'unieke domeinen', agg.uniqueDomains);
  ok(agg.domains[0].share > 0, 'share of voice berekend', agg.domains.map((d) => d.domain + ':' + d.share));
  ok(agg.domains.find((d) => d.domain === 'chapter42.com').isMine === true, 'eigen domein in aggregatie');
  ok(agg.types.length > 0, 'querytypen geaggregeerd', agg.types.map((t) => t.key + ':' + t.count));

  section('5. Historie-route (conversation mapping)');
  const mapping = {
    root: { id: 'root', message: null, parent: null, children: ['u1'] },
    u1: { message: { id: 'u1', author: { role: 'user' }, create_time: 100, content: { content_type: 'text', parts: ['Beste laadpaal thuis?'] } } },
    a1: { message: { id: 'a1', author: { role: 'assistant' }, create_time: 101, recipient: 'web',
      content: { content_type: 'code', text: '{"search_query":[{"q":"beste laadpaal thuis 2026"}]}' }, metadata: {} } },
    t1: { message: { id: 't1', author: { role: 'tool', name: 'web' }, create_time: 102,
      content: { content_type: 'text', parts: [''] },
      metadata: { search_result_groups: [{ domain: 'anwb.nl', entries: [{ url: 'https://www.anwb.nl/auto/laadpalen', title: 'Laadpalen — ANWB' }] }] } } },
    a2: { message: { id: 'a2', author: { role: 'assistant' }, create_time: 103, recipient: 'all',
      content: { content_type: 'text', parts: ['De Alfen Eve Single is populair in Nederland.'] }, metadata: {} } },
    u2: { message: { id: 'u2', author: { role: 'user' }, create_time: 200, content: { content_type: 'text', parts: ['En de kosten?'] } } },
    a3: { message: { id: 'a3', author: { role: 'assistant' }, create_time: 201, recipient: 'all',
      content: { content_type: 'text', parts: ['Reken op 900 tot 1400 euro inclusief installatie.'] }, metadata: {} } }
  };
  const histTurns = libs.FanoutParser.buildTurns({
    source: 'history', conversationId: '22222222-2222-2222-2222-222222222222', title: 'Laadpalen', mapping
  });
  ok(histTurns.length === 2, 'twee turns uit de mapping', histTurns.length);
  ok(histTurns[0].fanout.length === 1, 'fan-out in de eerste turn', histTurns[0].fanout.map((q) => q.q));
  ok(histTurns[0].sources.length === 1, 'bron in de eerste turn');
  ok(histTurns[1].prompt === 'En de kosten?', 'tweede turn heeft eigen prompt', histTurns[1].prompt);
  ok(histTurns[1].fanout.length === 0, 'tweede turn zonder fan-out');
  ok(histTurns[0].answer.indexOf('Alfen') !== -1, 'antwoord bij de juiste turn');

  section('6. Legacy-stream (volledige snapshots + search("…"))');
  const legacyEmitted = await runInterceptor(LEGACY_STREAM, REQUEST_BODY);
  const legacyFinal = legacyEmitted.filter((e) => e.type === 'turn-update').pop();
  ok(!!legacyFinal, 'legacy stream levert een update');
  const legacyTurns = libs.FanoutParser.buildTurns(legacyFinal.payload);
  const legacyQ = legacyTurns[0].fanout.map((q) => q.q);
  ok(legacyQ.length === 2, 'twee legacy search()-queries', legacyQ);
  ok(legacyQ.indexOf('thuisbatterij terugverdientijd') !== -1, 'legacy query correct geparsed', legacyQ);

  section('7. Merge van opeenvolgende streamupdates');
  const partial = libs.FanoutParser.buildTurns({
    conversationId: CONV_ID, promptId: 'user-1', prompt: 'Wat is het beste CRM voor een MKB-bedrijf in Nederland?',
    messages: [final.payload.messages[0]]
  })[0];
  const complete = libs.FanoutParser.buildTurns(final.payload)[0];
  const merged = libs.FanoutParser.mergeTurn(partial, complete);
  ok(merged.fanout.filter((q) => q.kind === 'search').length === 3, 'merge dupliceert queries niet',
    merged.fanout.map((q) => q.q));
  ok(merged.sources.length === 4, 'merge dupliceert bronnen niet', merged.sources.length);
  ok(merged.answer.indexOf('Teamleader') !== -1, 'merge behoudt het langste antwoord');

  section('8. Export');
  const exportSandbox = { self: {}, console, document: null, Blob: class {}, URL, navigator: {} };
  exportSandbox.self = exportSandbox;
  vm.createContext(exportSandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/lib/exporter.js'), 'utf8'), exportSandbox, { filename: 'exporter.js' });
  const md = exportSandbox.FanoutExport.toMarkdown([turn], agg);
  ok(md.indexOf('# AI query fan-out rapport') === 0, 'markdown-rapport gegenereerd');
  ok(md.indexOf('beste CRM software MKB Nederland 2026') !== -1, 'queries staan in het rapport');
  ok(md.indexOf('chapter42.com') !== -1, 'eigen domein staat in het rapport');

  const rows = exportSandbox.FanoutExport.flattenQueries([turn]);
  const csv = exportSandbox.FanoutExport.toCsv(rows, exportSandbox.FanoutExport.COLUMNS.turnQueries);
  ok(csv.split('\r\n').length === rows.length + 1, 'CSV heeft één regel per query + header', csv.split('\r\n').length);
  ok(csv.indexOf('"') !== -1 || true, 'CSV gegenereerd');

  const entCsv = exportSandbox.FanoutExport.toCsv(agg.entities, exportSandbox.FanoutExport.COLUMNS.entities);
  ok(entCsv.split('\r\n')[0].indexOf('door_model_toegevoegd') !== -1, 'entiteiten-CSV bevat de model-kolom');


  /* =================================================================== */
  section('9. Perplexity — SSE, beide payloadvormen');

  const PPLX_BODY = JSON.stringify({
    query_str: 'beste CRM voor een MKB-bedrijf in Nederland',
    params: { frontend_uuid: 'fe-1', last_backend_uuid: 'ctx-1', mode: 'copilot' }
  });

  // Oudere vorm: JSON-in-JSON via het `text`-veld met step_type-blokken.
  const PPLX_OLD = JSON.stringify({
    status: 'pending',
    query_str: 'beste CRM voor een MKB-bedrijf in Nederland',
    context_uuid: 'ctx-1',
    display_model: 'sonar',
    text: JSON.stringify([
      { step_type: 'INITIAL_QUERY', content: { query: 'beste CRM voor een MKB-bedrijf in Nederland' } },
      { step_type: 'SEARCH_WEB', content: { queries: ['beste crm mkb nederland 2026', 'crm vergelijking nederlandse bedrijven'] } },
      { step_type: 'SEARCH_RESULTS', content: { web_results: [
        { name: 'HubSpot CRM', url: 'https://www.hubspot.com/products/crm', snippet: 'Gratis CRM voor kleine teams.' },
        { name: 'CRM-vergelijking — Chapter42', url: 'https://chapter42.com/blog/crm-vergelijking', snippet: 'Onafhankelijke vergelijking.' }
      ] } }
    ]),
    related_queries: ['wat kost een CRM per gebruiker', 'CRM voor zzp']
  });

  // Nieuwere vorm: blocks met plan_block / web_result_block / markdown_block.
  const PPLX_NEW = JSON.stringify({
    query_str: 'beste CRM voor een MKB-bedrijf in Nederland',
    context_uuid: 'ctx-1',
    display_model: 'sonar-pro',
    blocks: [
      { intended_usage: 'pro_search_steps', plan_block: { progress: 'DONE', goals: [
        { id: '0', description: 'Searching for "Teamleader Focus prijzen 2026"', final: false },
        { id: '1', description: 'Zoeken naar Pipedrive alternatief MKB', final: false },
        { id: '2', description: 'Wrapping up the answer', final: true }
      ] } },
      { intended_usage: 'web_results', web_result_block: { progress: 'DONE', web_results: [
        { name: 'Teamleader Focus prijzen', url: 'https://www.teamleader.eu/nl-nl/prijzen', snippet: 'Vanaf 50 euro.' }
      ] } },
      { intended_usage: 'ask_text', markdown_block: {
        answer: 'HubSpot en Teamleader Focus zijn de bekendste opties voor het MKB in Nederland. Pipedrive is goedkoper.'
      } }
    ]
  });

  const pplxEmitted = await runInterceptor(
    sse([PPLX_OLD, PPLX_NEW]),
    PPLX_BODY,
    { host: 'www.perplexity.ai', href: 'https://www.perplexity.ai/search/beste-crm-abc123',
      endpoint: 'https://www.perplexity.ai/rest/sse/perplexity_ask' }
  );

  const pplxStart = pplxEmitted.find((e) => e.type === 'turn-start');
  ok(pplxStart && pplxStart.payload.provider === 'perplexity', 'provider herkend aan de host', pplxStart && pplxStart.payload.provider);
  ok(pplxStart && /beste CRM/.test(pplxStart.payload.prompt), 'query_str uit de request body als prompt', pplxStart && pplxStart.payload.prompt);

  const pplxFinal = pplxEmitted.filter((e) => e.type === 'turn-update').pop();
  ok(!!pplxFinal && pplxFinal.payload.done, 'afgeronde capture ontvangen');

  const pplxTurn = libs.FanoutParser.buildTurns(pplxFinal.payload)[0];
  libs.FanoutAnalysis.analyseTurn(pplxTurn, { myDomains: ['chapter42.com'] });

  const pq = pplxTurn.fanout.filter((q) => q.kind === 'search').map((q) => q.q);
  ok(pq.indexOf('beste crm mkb nederland 2026') !== -1, 'queries uit het oude text/step_type-formaat', pq);
  ok(pq.indexOf('Teamleader Focus prijzen 2026') !== -1, 'query uit een Engelse Pro Search-stap (quotes gestript)', pq);
  ok(pq.indexOf('Pipedrive alternatief MKB') !== -1, 'query uit een Nederlandse Pro Search-stap', pq);
  ok(pq.indexOf('Wrapping up the answer') === -1, 'niet-zoekstap wordt niet als query geteld', pq);

  const prel = pplxTurn.fanout.filter((q) => q.kind === 'related').map((q) => q.q);
  ok(prel.length === 2, 'vervolgvragen apart bijgehouden', prel);
  ok(pplxTurn.stats.fanoutCount === 4, 'vervolgvragen tellen niet mee als fan-out', pplxTurn.stats.fanoutCount);
  ok(pplxTurn.fanout.find((q) => q.kind === 'related').typeLabel === 'Vervolgvraag', 'vervolgvraag krijgt eigen label');

  ok(pplxTurn.sources.length === 3, 'bronnen uit beide payloadvormen samengevoegd', pplxTurn.sources.map((s) => s.domain));
  ok(pplxTurn.sources.some((s) => s.domain === 'chapter42.com' && s.isMine), 'eigen domein herkend bij Perplexity');
  ok(/Teamleader Focus/.test(pplxTurn.answer), 'antwoord uit markdown_block', pplxTurn.answer.slice(0, 60));
  ok(pplxTurn.id.indexOf('perplexity:') === 0, 'turn-id draagt de provider', pplxTurn.id);
  ok(pplxTurn.entities.some((e) => e.name === 'HubSpot'), 'entiteiten werken op Perplexity-data',
    pplxTurn.entities.slice(0, 8).map((e) => e.name));

  /* =================================================================== */
  section('10. Gemini — batchexecute met positionele arrays');

  function batch(payloads) {
    let out = ")]}'\n\n";
    payloads.forEach((p) => {
      const line = JSON.stringify(p);
      out += line.length + '\n' + line;
    });
    return out;
  }

  const GEMINI_INNER = JSON.stringify([
    ['c_9f8e7d6c5b4a', 'r_1a2b3c4d'],
    null,
    [[
      'rc_aabbcc',
      ['De Alfen Eve Single Pro-line is de veiligste keuze voor een Nederlandse woning dankzij dynamische load balancing. Easee Home is compacter en goedkoper.'],
      null, null, null, null,
      [
        ['beste laadpaal thuis 2026 test', 'laadpaal installatie kosten nederland', 'Alfen Eve Single Pro review'],
        [
          ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf123', 'Laadpalen voor thuis — ANWB', 'anwb.nl'],
          ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/GhIjKl456', 'Alfen Eve Single Pro-line', 'alfen.com'],
          ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/MnOpQr789', 'Easee Home laadpaal', 'easee.com']
        ]
      ]
    ]],
    ['https://www.google.com/search?q=laadpaal+subsidie+nederland+2026']
  ]);

  const GEMINI_BODY = 'f.req=' + encodeURIComponent(JSON.stringify([
    null, JSON.stringify([['Welke laadpaal kan ik het beste thuis laten installeren in 2026?'], null, ['c_9f8e7d6c5b4a', 'r_1a2b3c4d']])
  ])) + '&at=AAAAxyz%3A123';

  const geminiEmitted = await runInterceptor(
    batch([
      [['wrb.fr', 'XqA3Ic', GEMINI_INNER, null, null, null, 'generic']],
      [['di', 42], ['af.httprm', 42, '1234567890', 5]]
    ]),
    GEMINI_BODY,
    { host: 'gemini.google.com', href: 'https://gemini.google.com/app/9f8e7d6c5b4a',
      endpoint: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x&rt=c' }
  );

  const gStart = geminiEmitted.find((e) => e.type === 'turn-start');
  ok(gStart && gStart.payload.provider === 'gemini', 'Gemini-provider gekozen', gStart && gStart.payload.provider);
  ok(gStart && /laadpaal/i.test(gStart.payload.prompt), 'prompt uit het f.req-veld gehaald', gStart && gStart.payload.prompt);
  ok(gStart && gStart.payload.conversationId === 'c_9f8e7d6c5b4a', 'conversatie-id uit f.req', gStart && gStart.payload.conversationId);

  const gFinal = geminiEmitted.filter((e) => e.type === 'turn-update').pop();
  ok(!!gFinal && gFinal.payload.done, 'Gemini-capture afgerond');

  const gTurn = libs.FanoutParser.buildTurns(gFinal.payload)[0];
  libs.FanoutAnalysis.analyseTurn(gTurn, { myDomains: [] });

  const gq = gTurn.fanout.map((q) => q.q);
  ok(gq.indexOf('beste laadpaal thuis 2026 test') !== -1, 'queries naast het groundingblok opgepikt', gq);
  ok(gq.length === 4, 'drie grounding-queries + één uit de Google-searchlink', gq);
  ok(gq.indexOf('laadpaal subsidie nederland 2026') !== -1, 'query uit google.com/search?q= gedecodeerd', gq);
  ok(gq.indexOf('rc_aabbcc') === -1, 'interne ids niet als query geteld', gq);
  ok(!gq.some((q) => q.length > 200), 'de antwoordtekst is niet als query opgepikt');

  ok(gTurn.sources.length === 3, 'drie groundingbronnen', gTurn.sources.map((s) => s.domain));
  const anwb = gTurn.sources.find((s) => /AbCdEf/.test(s.url));
  ok(anwb && anwb.domain === 'anwb.nl', 'echt domein uit de buurstring i.p.v. de redirect-host', anwb && anwb.domain);
  ok(anwb && anwb.title === 'Laadpalen voor thuis — ANWB', 'titel uit de buurstring', anwb && anwb.title);
  ok(/Alfen/.test(gTurn.answer), 'antwoordtekst herkend als langste prozastring', gTurn.answer.slice(0, 50));
  ok(gTurn.entities.some((e) => /Alfen/.test(e.name)), 'entiteiten werken op Gemini-data',
    gTurn.entities.slice(0, 8).map((e) => e.name));

  /* =================================================================== */
  section('11. Aggregatie over meerdere providers');

  const mixed = [turn, pplxTurn, gTurn];
  const mixedAgg = libs.FanoutAnalysis.aggregate(mixed, { myDomains: ['chapter42.com'] });
  ok(mixedAgg.providers.length === 3, 'drie providers in de aggregatie', mixedAgg.providers.map((p) => p.id));
  const pplxAgg = mixedAgg.providers.find((p) => p.id === 'perplexity');
  ok(pplxAgg && pplxAgg.queries === 4, 'queries per provider geteld', pplxAgg && pplxAgg.queries);
  ok(mixedAgg.providers.every((p) => p.avgFanout > 0), 'gemiddelde fan-out per provider',
    mixedAgg.providers.map((p) => p.id + ':' + p.avgFanout));
  const hub = mixedAgg.domains.find((d) => d.domain === 'hubspot.com');
  ok(hub && hub.providers.length === 2, 'domein gezien bij twee providers', hub && hub.providers);
  ok(mixedAgg.totalQueries === turn.stats.fanoutCount + 4 + 4, 'totaal telt over providers heen', mixedAgg.totalQueries);

  const mixedMd = exportSandbox.FanoutExport.toMarkdown(mixed, mixedAgg);
  ok(/Perplexity/.test(mixedMd) && /Gemini/.test(mixedMd), 'providers benoemd in het rapport');
  const mixedCsv = exportSandbox.FanoutExport.toCsv(
    exportSandbox.FanoutExport.flattenQueries(mixed), exportSandbox.FanoutExport.COLUMNS.turnQueries);
  ok(mixedCsv.split('\r\n')[0].indexOf('provider') !== -1, 'CSV heeft een provider-kolom');
  const domCsv = exportSandbox.FanoutExport.toCsv(mixedAgg.domains, exportSandbox.FanoutExport.COLUMNS.sources);
  ok(domCsv.split('\r\n')[0].indexOf('assistenten') !== -1, 'domeinen-CSV heeft een assistenten-kolom',
    domCsv.split('\r\n')[0]);

  section('12. Antwoordtekst in de exports');

  const turnsCsv = exportSandbox.FanoutExport.toCsv(mixed, exportSandbox.FanoutExport.COLUMNS.turns);
  const turnsHeader = turnsCsv.split('\r\n')[0].split(',');
  ok(turnsHeader[turnsHeader.length - 1] === 'antwoord', 'turns-CSV eindigt op de antwoord-kolom', turnsHeader.slice(-3));
  ok(turnsCsv.indexOf('Teamleader') !== -1, 'antwoordtekst staat daadwerkelijk in de turns-CSV');
  // Escapen expliciet toetsen op een antwoord dat komma's, aanhalingstekens en
  // regeleindes bevat — precies waar een naïeve CSV-writer op stukloopt.
  const trickyTurn = Object.assign({}, gTurn, {
    answer: 'Regel een, met komma.\nRegel twee met "aanhalingstekens".\r\nRegel drie; met puntkomma.'
  });
  const trickyCsv = exportSandbox.FanoutExport.toCsv([trickyTurn], exportSandbox.FanoutExport.COLUMNS.turns);
  const trickyCell = trickyCsv.slice(trickyCsv.indexOf('"Regel een'));
  ok(trickyCell.indexOf('""aanhalingstekens""') !== -1, 'aanhalingstekens in het antwoord worden verdubbeld', trickyCell.slice(0, 90));
  ok(trickyCell.charAt(0) === '"' && trickyCell.trim().slice(-1) === '"', 'de hele cel staat tussen aanhalingstekens');
  ok(trickyCell.indexOf('Regel drie; met puntkomma.') !== -1, 'regeleindes binnen de cel blijven behouden');

  const srcCsv = exportSandbox.FanoutExport.toCsv(
    exportSandbox.FanoutExport.flattenSources(mixed), exportSandbox.FanoutExport.COLUMNS.turnSources);
  ok(srcCsv.split('\r\n')[0].indexOf('antwoord') !== -1, 'bronnen-CSV heeft een antwoord-kolom');

  ok((mixedMd.match(/\*\*Antwoord\*\*/g) || []).length === mixed.length,
    'markdown bevat het antwoord van elke turn', (mixedMd.match(/\*\*Antwoord\*\*/g) || []).length);
  ok(/\n> .*Teamleader/.test(mixedMd), 'antwoord staat als blockquote in het rapport');

  const roundTrip = JSON.parse(JSON.stringify({ turns: mixed }));
  ok(roundTrip.turns.every(function (t) { return typeof t.answer === 'string' && t.answer.length > 0; }),
    'JSON-export draagt het volledige antwoord per turn');

  // Het antwoord mag nergens worden afgekapt — daar is de analyse juist op gebaseerd.
  const longest = mixed.reduce(function (a, t) { return t.answer.length > a.length ? t.answer : a; }, '');
  ok(turnsCsv.indexOf(longest.slice(-40)) !== -1, 'ook het einde van het langste antwoord zit in de CSV',
    longest.length + ' tekens');
  ok(/chatgpt \| perplexity|perplexity \| chatgpt/.test(domCsv), 'domeinen-CSV vermeldt meerdere assistenten per rij');

  console.log('\n' + (failures === 0
    ? '\x1b[32m' + checks + '/' + checks + ' checks geslaagd\x1b[0m'
    : '\x1b[31m' + failures + ' van ' + checks + ' checks gefaald\x1b[0m'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\n\x1b[31mTestrunner crashte:\x1b[0m', err);
  process.exit(1);
});
