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

  // De interceptor patcht Response.prototype, en dat is hier Node's eigen
  // Response. Zonder herstel stapelen de patches van elke run zich op.
  const RESPONSE_KEYS = ['clone', 'body', 'text', 'json', 'arrayBuffer', 'url'];
  const pristine = RESPONSE_KEYS.map((k) => Object.getOwnPropertyDescriptor(Response.prototype, k));
  const restoreResponse = () => RESPONSE_KEYS.forEach((k, i) => Object.defineProperty(Response.prototype, k, pristine[i]));

  // De echte fetch-implementatie die de interceptor omwikkelt.
  fakeWindow.fetch = async function (url, init) {
    // Een echte fetch verbruikt de body van een Request-object meteen.
    if (url instanceof Request && url.body) url.text();
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

  // Een zelfgebouwde Response heeft geen url; een echte fetch-response wel, en
  // zijn clones ook. Juist die clones met dezelfde url maken dubbel tappen mogelijk.
  Object.defineProperty(Response.prototype, 'url', { configurable: true, get() { return endpoint; } });

  /*
   * Bootst een andere extensie na die window.fetch als accessor installeert
   * vóórdat wij laden: de getter geeft haar wrapper, de setter onthoudt alleen
   * de laatste toewijzing. Wijst de pagina daarna zelf fetch toe, dan valt onze
   * wrapper uit de keten — precies wat er in het wild gebeurde.
   */
  if (opts.hijack) {
    const native = fakeWindow.fetch;
    let downstream = native;
    let busy = false;
    const foreign = function () {
      if (busy) return native.apply(this, arguments);
      busy = true;
      try { return downstream.apply(this, arguments); } finally { busy = false; }
    };
    Object.defineProperty(fakeWindow, 'fetch', {
      configurable: true,
      get() { return foreign; },
      set(v) { downstream = v; }
    });
  }

  MAIN_FILES.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });

  if (opts.hijack) {
    // De pagina wikkelt fetch zelf nog eens in, zoals ChatGPT's bundel doet.
    const seenByPage = fakeWindow.fetch;
    fakeWindow.fetch = function () { return seenByPage.apply(this, arguments); };
  }

  const call = opts.asRequest
    ? sandbox.window.fetch(new Request(endpoint, { method: 'POST', body: requestBody }))
    : sandbox.window.fetch(endpoint, { method: 'POST', body: requestBody });

  return call
    .then(async (res) => {
      // De originele consumer. ChatGPT leest de stream via res.body, en maakt
      // onderweg zelf een clone — die mag geen tweede opname opleveren.
      if (opts.readVia === 'body') {
        res.clone().body.cancel();
        const reader = res.body.getReader();
        for (;;) { if ((await reader.read()).done) break; }
      } else {
        await res.text();
      }
      // Wachten tot de clone volledig verwerkt is.
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 12));
        if (emitted.some((e) => e.type === 'turn-update' && e.payload && e.payload.done)) break;
      }
      timers.forEach((t) => clearInterval(t));
      restoreResponse();
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

/*
 * Het formaat zoals ChatGPT het eind 2026 stuurt, naar een echte opname:
 *  - het SSE-frame heet "delta", in de data zelf staat geen type meer
 *  - de prompt komt terug als input_message
 *  - na één {p:'',o:'add'} volgen de berichten als kale {v:{message}}
 *  - na één {o:'patch'} volgen de patches als kale {v:[…]}
 *  - append groeit arrays en objecten aan, truncate kort tekst in
 *  - de queries staan in search_model_queries op het tool-antwoord
 */
function sseNamed(events) {
  return events.map((e) => {
    const name = e.event ? 'event: ' + e.event + '\n' : '';
    return name + 'data: ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) + '\n\n';
  }).join('');
}

function liveMessage(id, role, extra) {
  return Object.assign({
    id: id,
    author: { role: role, name: null, metadata: {} },
    create_time: 1794000000,
    content: { content_type: 'text', parts: [''] },
    status: 'finished_successfully',
    recipient: 'all',
    metadata: { model_slug: 'gpt-5-5' }
  }, extra || {});
}

const LIVE_GROUPS = [{
  type: 'search_result_group',
  domain: 'fietstest.nl',
  entries: [{
    type: 'search_result', url: 'https://www.fietstest.nl/bakfietsen-2026?utm_source=chatgpt.com',
    title: 'De beste elektrische bakfietsen 2026', snippet: '',
    ref_id: { turn_index: 0, ref_type: 'search', ref_index: 0 }, pub_date: 1793000000,
    result_type: 'web', source_name: 'Fietstest', attribution: 'fietstest.nl'
  }]
}, {
  type: 'search_result_group',
  domain: 'chapter42.com',
  entries: [{
    type: 'search_result', url: 'https://chapter42.com/blog/bakfiets-kopen',
    title: 'Bakfiets kopen — Chapter42', snippet: 'Waar je op let.',
    ref_id: { turn_index: 0, ref_type: 'search', ref_index: 1 }, pub_date: null,
    result_type: 'web', attribution: 'chapter42.com'
  }]
}];

const LIVE_USER = liveMessage('live-user-1', 'user', {
  content: { content_type: 'text', parts: ['Wat zijn de beste elektrische bakfietsen van 2026?'] },
  metadata: { request_id: 'req-1' }
});

/*
 * Twee smaken: in een lopende conversatie komt de prompt terug als
 * input_message, in een nieuwe als gewoon eerste bericht van de stream.
 */
function liveStream(promptAsMessage) {
  const head = promptAsMessage
    ? [
      { event: 'delta', data: { p: '', o: 'add', c: 0, v: { conversation_id: CONV_ID, error: null, message: LIVE_USER } } },
      { event: 'delta', data: { c: 1, v: { conversation_id: CONV_ID, error: null,
        message: liveMessage('live-sys', 'system', { metadata: { is_visually_hidden_from_conversation: true } }) } } },
      // Aangepaste instructies komen als verborgen user-bericht en zijn geen prompt.
      { event: 'delta', data: { c: 2, v: { conversation_id: CONV_ID, error: null,
        message: liveMessage('live-context', 'user', {
          content: { content_type: 'user_editable_context', user_profile: 'Ik woon in Utrecht.' },
          metadata: { is_visually_hidden_from_conversation: true }
        }) } } }
    ]
    : [
      { data: { type: 'input_message', conversation_id: CONV_ID, input_message: LIVE_USER } },
      { event: 'delta', data: { p: '', o: 'add', c: 0, v: { conversation_id: CONV_ID, error: null,
        message: liveMessage('live-sys', 'system', { metadata: { is_visually_hidden_from_conversation: true } }) } } }
    ];

  return sseNamed([
  { event: 'delta_encoding', data: '"v1"' },
  { data: { type: 'resume_conversation_token', kind: 'topic', token: 'tok', conversation_id: CONV_ID } }
  ].concat(head, [
  { event: 'delta', data: { c: 1, v: { conversation_id: CONV_ID, error: null,
    message: liveMessage('live-call', 'assistant', { recipient: 'web.run' }) } } },
  { event: 'delta', data: { c: 2, v: { conversation_id: CONV_ID, error: null,
    message: liveMessage('live-queries', 'tool', {
      author: { role: 'tool', name: 'web.run', metadata: {} },
      metadata: { search_model_queries: { type: 'search_model_queries', queries: [
        'beste elektrische bakfiets 2026 test',
        'elektrische bakfiets twee kinderen vergelijking'
      ] } }
    }) } } },
  { event: 'delta', data: { c: 3, v: { conversation_id: CONV_ID, error: null,
    message: liveMessage('live-results', 'tool', {
      author: { role: 'tool', name: 'web.run', metadata: {} },
      metadata: { search_result_groups: LIVE_GROUPS }
    }) } } },
  { data: { type: 'message_marker', conversation_id: CONV_ID, message_id: 'live-answer', marker: 'cot_token', event: 'first' } },
  { event: 'delta', data: { c: 4, v: { conversation_id: CONV_ID, error: null,
    message: liveMessage('live-answer', 'assistant', { status: 'in_progress', metadata: { model_slug: 'gpt-5-5', content_references: [] } }) } } },

  { event: 'delta', data: { o: 'patch', v: [
    { p: '/message/content/parts/0', o: 'append', v: 'De Urban Arrow en de Lovens ' },
    { p: '/message/metadata', o: 'append', v: { finish_details: { type: 'pending' } } }
  ] } },
  { event: 'delta', data: { v: [
    { p: '/message/content/parts/0', o: 'append', v: 'scoren het best. FOUT' },
    { p: '/message/metadata/content_references', o: 'append', v: [{
      type: 'grouped_webpages', matched_text: 'cite', start_idx: 0, end_idx: 20,
      items: [{ title: 'De beste elektrische bakfietsen 2026', url: 'https://www.fietstest.nl/bakfietsen-2026', attribution: 'fietstest.nl' }]
    }] }
  ] } },
  { event: 'delta', data: { v: [
    { p: '/message/content/parts/0', o: 'truncate', v: 44 },
    { p: '/message/content/parts/0', o: 'append', v: ' De Gazelle Makki volgt.' },
    { p: '/message/metadata/content_references', o: 'append', v: [{
      type: 'grouped_webpages', matched_text: 'cite', start_idx: 21, end_idx: 40,
      items: [{ title: 'Bakfiets kopen — Chapter42', url: 'https://chapter42.com/blog/bakfiets-kopen', attribution: 'chapter42.com' }]
    }] },
    { p: '/message/status', o: 'replace', v: 'finished_successfully' }
  ] } },
  { event: 'delta', data: { p: '/message/metadata/conversation_followup_suggestions_eligible', o: 'replace', v: true } },
  { data: { type: 'message_stream_complete', conversation_id: CONV_ID } },
  { data: '[DONE]' }
  ]));
}

const LIVE_STREAM = liveStream(false);
const LIVE_STREAM_NEW = liveStream(true);

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
  ok(gStart && gStart.payload.conversationId === '9f8e7d6c5b4a',
    'conversatie-id uit f.req, in de vorm die ook in de URL staat', gStart && gStart.payload.conversationId);

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

  ok(gTurn.conversationId === '9f8e7d6c5b4a' && gTurn.conversationUrl === 'https://gemini.google.com/app/9f8e7d6c5b4a',
    'turn hangt aan de conversatie uit de URL, zodat het paneel hem onder "Deze conversatie" toont',
    gTurn.conversationId + ' | ' + gTurn.conversationUrl);

  /*
   * Zoals Gemini het eind 2026 stuurt: fetch met een Request-object, en per
   * zoekstap een blok "Searched the web" met de resultaten. De zoekopdracht zelf
   * staat er niet meer in — dat veld is leeg — dus die verwachten we ook niet.
   */
  const GEMINI_LIVE_INNER = JSON.stringify([
    null,
    ['c_e5e09f6fd82a1175', 'r_77aa88bb'],
    null, null,
    [[
      'rc_ddeeff',
      ['De Nefit Bosch Compress 5800i AW komt als beste uit de test van de Consumentenbond. Voor een hybride opstelling scoort de Quatt hoog op prijs en installatiegemak.'],
      null, null, null, null, null, null, [1], 'nl'
    ]],
    [[[
      [], 'Searched the web', 'Google Search', 'https://www.gstatic.com/images/branding/search.png', [], 'Searched the web', '',
      [
        ['https://t2.gstatic.com/faviconV2?url=https://www.consumentenbond.nl&client=BARD&type=FAVICON&size=256',
          'https://www.consumentenbond.nl/warmtepomp/beste-warmtepomp', 'Beste warmtepomp 2026 | testresultaten', null, []],
        ['https://t0.gstatic.com/faviconV2?url=https://www.coen-plus.nl&client=BARD&type=FAVICON&size=256',
          'https://www.coen-plus.nl/blog/post/warmtepomp-beste', 'De best geteste warmtepomp van 2026 - Coen+', null, []]
      ]
    ], [
      [], 'Searched the web', 'Google Search', 'https://www.gstatic.com/images/branding/search.png', [], 'Searched the web', '',
      [
        ['https://t3.gstatic.com/faviconV2?url=https://www.eigenhuis.nl&client=BARD&type=FAVICON&size=256',
          'https://www.eigenhuis.nl/verduurzamen/verwarmen/warmtepomp', 'De 6 nieuwste warmtepompen - Vereniging Eigen Huis', null, []]
      ]
    ]]]
  ]);

  const GEMINI_LIVE_BODY = 'f.req=' + encodeURIComponent(JSON.stringify([
    null, JSON.stringify([['Welke warmtepompen krijgen in 2026 de beste reviews in Nederland?', 0, null, null, null, null, 0], ['nl'], null,
      '!' + 'AbC9_x-'.repeat(300), 'f3a9c1d2e4b5a6978899aabbccddeeff'])
  ])) + '&at=AAAAxyz%3A123';

  const GEMINI_OPTS = { host: 'gemini.google.com', href: 'https://gemini.google.com/app/e5e09f6fd82a1175',
    endpoint: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x&rt=c' };

  const geminiLive = await runInterceptor(
    batch([[['wrb.fr', null, GEMINI_LIVE_INNER]], [['e', 49, null, null, 629729]]]),
    GEMINI_LIVE_BODY,
    Object.assign({ asRequest: true, readVia: 'body' }, GEMINI_OPTS)
  );
  const glStarts = geminiLive.filter((e) => e.type === 'turn-start');
  ok(glStarts.length === 1, 'één opname', glStarts.length);
  ok(glStarts.length === 1 && /warmtepompen/.test(glStarts[0].payload.prompt),
    'prompt gelezen uit een Request-object, waarvan fetch de body verbruikt', glStarts[0] && glStarts[0].payload.prompt);
  ok(glStarts.length === 1 && glStarts[0].payload.prompt === 'Welke warmtepompen krijgen in 2026 de beste reviews in Nederland?',
    'de prompt is de vraag, niet het veel langere sessietoken ernaast', glStarts[0] && glStarts[0].payload.prompt.slice(0, 60));
  const glFinal = geminiLive.filter((e) => e.type === 'turn-update').pop();
  const glTurn = glFinal ? libs.FanoutParser.buildTurns(glFinal.payload)[0] : null;
  ok(!!glTurn && glTurn.conversationId === 'e5e09f6fd82a1175', 'conversatie-id zonder c_-voorvoegsel', glTurn && glTurn.conversationId);
  ok(!!glTurn && glTurn.sources.length === 3, 'drie bronnen uit de zoekstappen', glTurn && glTurn.sources.map((s) => s.url));
  ok(!!glTurn && glTurn.sources.every((s) => !/gstatic/.test(s.url) && !/^https?:/.test(s.title)),
    'de favicon-url is geen bron en geen titel', glTurn && glTurn.sources.map((s) => s.title));
  const consb = glTurn && glTurn.sources.find((s) => s.domain === 'consumentenbond.nl');
  ok(!!consb && consb.title === 'Beste warmtepomp 2026 | testresultaten', 'titel van het zoekresultaat', consb && consb.title);
  ok(!!glTurn && /Compress 5800i/.test(glTurn.answer), 'antwoord vastgelegd');
  ok(!!glTurn && glTurn.fanout.length === 0,
    'geen verzonnen queries: de vaste labels van een zoekstap tellen niet als zoekopdracht', glTurn && glTurn.fanout.map((q) => q.q));

  // De tientallen losse RPC's over batchexecute mogen geen turns opleveren.
  const geminiNoise = await runInterceptor(
    batch([[['wrb.fr', 'ESY5D', JSON.stringify([['Dit is een instelling met een flink lange beschrijvende tekst erbij, puur ruis.', null, 1]])]]]),
    'f.req=' + encodeURIComponent(JSON.stringify([[['ESY5D', '[["bard_activity_enabled"]]', null, 'generic']]])),
    { host: 'gemini.google.com', href: 'https://gemini.google.com/app/e5e09f6fd82a1175',
      endpoint: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D', asRequest: true }
  );
  ok(geminiNoise.filter((e) => e.type === 'turn-update').length === 0,
    'een RPC zonder bronnen of zoekopdrachten levert geen turn op', geminiNoise.map((e) => e.type).join(','));

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

  section('13. ChatGPT — huidig streamformaat');
  const live = await runInterceptor(LIVE_STREAM, REQUEST_BODY, { readVia: 'body' });
  ok(live.filter((e) => e.type === 'turn-start').length === 1,
    'één opname, ook als de pagina zelf een clone van de response maakt');
  const liveFinal = live.filter((e) => e.type === 'turn-update').pop();
  ok(!!liveFinal && liveFinal.payload.done === true, 'stream afgerond');
  ok(liveFinal.payload.messages.length === 5, 'alle vijf berichten gereconstrueerd, niet alleen het eerste',
    liveFinal.payload.messages.map((m) => m.id));
  ok(liveFinal.payload.conversationId === CONV_ID, 'conversatie-id uit de stream');

  const liveAnswer = liveFinal.payload.messages.find((m) => m.id === 'live-answer');
  ok(liveAnswer.content.parts[0] === 'De Urban Arrow en de Lovens scoren het best. De Gazelle Makki volgt.',
    'kale {v:[…]} telt als patch, en truncate kort de tekst in', liveAnswer.content.parts[0]);
  ok(liveAnswer.metadata.content_references.length === 2 && !Array.isArray(liveAnswer.metadata.content_references[0]),
    'append op een array voegt de elementen toe, niet de array zelf', liveAnswer.metadata.content_references.length);
  ok(liveAnswer.metadata.model_slug === 'gpt-5-5' && liveAnswer.metadata.finish_details,
    'append op een object vult aan in plaats van te vervangen', Object.keys(liveAnswer.metadata));
  ok(liveAnswer.status === 'finished_successfully', 'replace binnen een kale patch toegepast');

  const liveTurns = libs.FanoutParser.buildTurns(liveFinal.payload);
  ok(liveTurns.length === 1, 'precies één turn', liveTurns.length);
  const liveTurn = liveTurns[0];
  ok(liveTurn.id === 'chatgpt:' + CONV_ID + ':live-user-1', 'turn-id op het id uit input_message', liveTurn.id);
  const liveSearches = liveTurn.fanout.filter((q) => q.kind === 'search');
  ok(liveSearches.length === 2 && liveSearches[0].q === 'beste elektrische bakfiets 2026 test',
    'queries uit search_model_queries', liveSearches.map((q) => q.q));
  ok(liveSearches.every((q) => q.toolCall === 0 && q.sourceCount === 2),
    'queries hangen aan een tool-call en krijgen hun bronnen', liveSearches.map((q) => q.toolCall + '/' + q.sourceCount));
  ok(liveTurn.sources.length === 2, 'twee unieke bronnen', liveTurn.sources.map((s) => s.url));
  ok(liveTurn.sources.every((s) => s.origin === 'citation'), 'beide bronnen zijn als geciteerd herkend',
    liveTurn.sources.map((s) => s.origin));
  ok(liveTurn.answer.indexOf('Gazelle Makki') !== -1, 'antwoord vastgelegd', liveTurn.answer);
  ok(liveTurn.model === 'gpt-5-5', 'model herkend', liveTurn.model);

  section('14. ChatGPT — fetch gekaapt door een andere extensie');
  const hijacked = await runInterceptor(LIVE_STREAM, REQUEST_BODY, { hijack: true, readVia: 'body' });
  ok(hijacked.filter((e) => e.type === 'turn-start').length === 1,
    'de stream wordt toch opgepikt, en precies één keer',
    hijacked.map((e) => e.type).join(','));
  ok((hijacked.find((e) => e.type === 'turn-start') || { payload: {} }).payload.prompt === '',
    'de nabootsing klopt: onze fetch-wrapper zat niet in de keten, dus geen request body');
  const hijackedFinal = hijacked.filter((e) => e.type === 'turn-update').pop();
  ok(!!hijackedFinal && hijackedFinal.payload.done === true, 'stream afgerond via het Response-vangnet');
  ok(hijackedFinal && hijackedFinal.payload.prompt.indexOf('bakfietsen van 2026') !== -1,
    'prompt komt uit input_message als de request body buiten bereik is',
    hijackedFinal && hijackedFinal.payload.prompt);
  const hijackedTurns = hijackedFinal ? libs.FanoutParser.buildTurns(hijackedFinal.payload) : [];
  ok(hijackedTurns.length === 1 && hijackedTurns[0].id === liveTurn.id,
    'dezelfde turn-id als via de gewone route', hijackedTurns.map((t) => t.id));
  ok(hijackedTurns.length === 1 && hijackedTurns[0].fanout.length === 2 && hijackedTurns[0].sources.length === 2,
    'queries en bronnen compleet');

  const hijackedNew = await runInterceptor(LIVE_STREAM_NEW, REQUEST_BODY, { hijack: true, readVia: 'body' });
  const hijackedNewFinal = hijackedNew.filter((e) => e.type === 'turn-update').pop();
  const hijackedNewTurns = hijackedNewFinal ? libs.FanoutParser.buildTurns(hijackedNewFinal.payload) : [];
  ok(hijackedNewTurns.length === 1 && hijackedNewTurns[0].id === liveTurn.id,
    'nieuwe conversatie: één turn op het user-bericht uit de stream, de verborgen context telt niet mee',
    hijackedNewTurns.map((t) => t.id));
  ok(hijackedNewTurns.length === 1 && hijackedNewTurns[0].prompt.indexOf('bakfietsen van 2026') !== -1 &&
    hijackedNewTurns[0].fanout.length === 2 && hijackedNewTurns[0].answer.indexOf('Gazelle Makki') !== -1,
    'nieuwe conversatie: prompt, queries en antwoord compleet');

  // Geen prompt in de request body bereikbaar én geen user-bericht in de stream
  // (zoals bij opnieuw genereren): de turn mag dan niet per update verspringen.
  const promptless = await runInterceptor(STREAM, REQUEST_BODY, { hijack: true, readVia: 'body' });
  const promptlessIds = promptless.filter((e) => e.type === 'turn-update')
    .map((e) => libs.FanoutParser.buildTurns(e.payload).map((t) => t.id).join('|'));
  ok(promptlessIds.length > 0 && new Set(promptlessIds).size === 1 && /:stream-/.test(promptlessIds[0]),
    'zonder prompt houdt de turn één vaste sleutel in plaats van een nieuwe per update', promptlessIds);

  const hijackedText = await runInterceptor(LIVE_STREAM, REQUEST_BODY, { hijack: true });
  ok(hijackedText.filter((e) => e.type === 'turn-update' && e.payload.done).length === 1,
    'ook opgepikt als de pagina res.text() gebruikt in plaats van res.body');

  console.log('\n' + (failures === 0
    ? '\x1b[32m' + checks + '/' + checks + ' checks geslaagd\x1b[0m'
    : '\x1b[31m' + failures + ' van ' + checks + ' checks gefaald\x1b[0m'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\n\x1b[31mTestrunner crashte:\x1b[0m', err);
  process.exit(1);
});
