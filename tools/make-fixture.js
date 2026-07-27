/*
 * Bouwt dev/fixture.json: realistische turns om paneel en dashboard te bekijken
 * zonder ChatGPT te hoeven openen.
 *
 *   node tools/make-fixture.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { self: {}, console, URL };
sandbox.self = sandbox;
vm.createContext(sandbox);
['src/lib/parser.js', 'src/lib/entities.js', 'src/lib/analysis.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

const DAY = 86400000;
const NOW = Date.UTC(2026, 6, 27, 10, 0, 0);

function group(domain, entries) {
  return { type: 'search_result_group', domain, entries: entries.map((e) => ({ type: 'search_result', ...e })) };
}

/* Perplexity/Gemini leveren een kant-en-klare capture in plaats van messages. */
function capture({ provider, conv, promptId, prompt, queries, related, sources, answer, ago, model }) {
  const t = sandbox.FanoutParser.buildTurns({
    capture: true,
    provider,
    source: 'stream',
    conversationId: conv,
    title: prompt.slice(0, 60),
    model,
    prompt,
    promptId,
    promptTime: NOW - ago,
    pageUrl: provider === 'perplexity'
      ? 'https://www.perplexity.ai/search/' + conv
      : 'https://gemini.google.com/app/' + conv,
    fanout: queries.map((q) => ({ q, kind: 'search', domains: null, recency: null }))
      .concat((related || []).map((q) => ({ q, kind: 'related', domains: null, recency: null }))),
    sources,
    related: related || [],
    answer
  })[0];
  return t;
}

function turn({ conv, title, promptId, prompt, queries, groups, cited, answer, ago, model }) {
  const messages = [
    {
      id: promptId + '-tool', author: { role: 'assistant' }, recipient: 'web',
      create_time: (NOW - ago) / 1000,
      content: { content_type: 'code', text: JSON.stringify({ search_query: queries, response_length: 'medium' }) },
      metadata: { model_slug: model || 'gpt-5' }
    },
    {
      id: promptId + '-res', author: { role: 'tool', name: 'web' },
      create_time: (NOW - ago + 1200) / 1000,
      content: { content_type: 'text', parts: [''] },
      metadata: { search_result_groups: groups }
    },
    {
      id: promptId + '-ans', author: { role: 'assistant' }, recipient: 'all',
      create_time: (NOW - ago + 2400) / 1000,
      content: { content_type: 'text', parts: [answer] },
      metadata: {
        model_slug: model || 'gpt-5',
        content_references: [{ type: 'grouped_webpages', start_idx: 0, end_idx: 40, items: cited }]
      }
    }
  ];
  const t = sandbox.FanoutParser.buildTurns({
    source: 'stream', conversationId: conv, title, prompt, promptId,
    promptTime: NOW - ago, pageUrl: 'https://chatgpt.com/c/' + conv, messages
  })[0];
  return t;
}

const C1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const C2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const C3 = 'cccccccc-3333-4333-8333-cccccccccccc';

const turns = [
  turn({
    conv: C1, title: 'CRM-keuze MKB', promptId: 'u1', ago: 2 * 3600000,
    prompt: 'Wat is het beste CRM voor een MKB-bedrijf in Nederland?',
    queries: [
      { q: 'beste CRM software MKB Nederland 2026' },
      { q: 'HubSpot vs Salesforce prijzen vergelijking' },
      { q: 'CRM systeem ervaringen review Nederlandse bedrijven' },
      { q: 'Teamleader Focus prijzen 2026' },
      { q: 'Pipedrive alternatief goedkoop MKB' }
    ],
    groups: [
      group('hubspot.com', [
        { url: 'https://www.hubspot.com/products/crm', title: 'HubSpot CRM — gratis voor kleine teams', snippet: 'Het gratis CRM van HubSpot.' },
        { url: 'https://www.hubspot.com/pricing/crm', title: 'HubSpot prijzen', snippet: 'Starter vanaf 15 euro.' }
      ]),
      group('salesforce.com', [
        { url: 'https://www.salesforce.com/nl/crm/', title: 'Wat is CRM? — Salesforce', snippet: 'Salesforce Sales Cloud.' }
      ]),
      group('teamleader.eu', [
        { url: 'https://www.teamleader.eu/nl-nl/prijzen', title: 'Teamleader Focus prijzen', snippet: 'Vanaf 50 euro per maand.' }
      ]),
      group('chapter42.com', [
        { url: 'https://chapter42.com/blog/crm-vergelijking-mkb', title: 'CRM-vergelijking voor het MKB — Chapter42', snippet: 'Onafhankelijke vergelijking van negen systemen.' }
      ]),
      group('tweakers.net', [
        { url: 'https://tweakers.net/reviews/crm-2026/', title: 'CRM-systemen getest — Tweakers', snippet: 'Uitgebreide test.' }
      ])
    ],
    cited: [
      { title: 'HubSpot CRM — gratis voor kleine teams', url: 'https://www.hubspot.com/products/crm' },
      { title: 'CRM-vergelijking voor het MKB — Chapter42', url: 'https://chapter42.com/blog/crm-vergelijking-mkb' }
    ],
    answer: 'Voor een MKB-bedrijf in Nederland zijn HubSpot en Salesforce de bekendste opties. ' +
      'HubSpot is sterk als je klein begint dankzij de gratis laag. Teamleader Focus is populair in de Benelux ' +
      'en koppelt CRM aan facturatie. Pipedrive is een goedkoper alternatief dat vooral op verkoopteams mikt. ' +
      'Salesforce loont pas bij grotere organisaties vanwege de implementatiekosten.'
  }),

  turn({
    conv: C1, title: 'CRM-keuze MKB', promptId: 'u2', ago: 1.5 * 3600000,
    prompt: 'En hoe zit het met AVG en dataopslag binnen de EU?',
    queries: [
      { q: 'CRM AVG compliance dataopslag EU 2026' },
      { q: 'HubSpot datacenter Europa GDPR' },
      { q: 'Salesforce Hyperforce EU datalocatie' }
    ],
    groups: [
      group('autoriteitpersoonsgegevens.nl', [
        { url: 'https://www.autoriteitpersoonsgegevens.nl/themas/internet-slimme-apparaten/cloud', title: 'Cloud en de AVG — Autoriteit Persoonsgegevens', snippet: 'Verwerkersovereenkomst verplicht.' }
      ]),
      group('hubspot.com', [
        { url: 'https://legal.hubspot.com/data-privacy', title: 'HubSpot Data Privacy', snippet: 'EU-hosting beschikbaar.' }
      ]),
      group('salesforce.com', [
        { url: 'https://www.salesforce.com/eu/hyperforce/', title: 'Hyperforce in de EU', snippet: 'Datalocatie binnen de EU.' }
      ])
    ],
    cited: [{ title: 'Cloud en de AVG — Autoriteit Persoonsgegevens', url: 'https://www.autoriteitpersoonsgegevens.nl/themas/internet-slimme-apparaten/cloud' }],
    answer: 'Onder de AVG moet je een verwerkersovereenkomst sluiten. HubSpot biedt EU-hosting in Frankfurt, ' +
      'Salesforce doet dat via Hyperforce. De Autoriteit Persoonsgegevens let vooral op doorgifte naar de Verenigde Staten.'
  }),

  turn({
    conv: C2, title: 'Laadpaal thuis', promptId: 'u3', ago: 1 * DAY,
    prompt: 'Welke laadpaal kan ik het beste thuis laten installeren in 2026?',
    queries: [
      { q: 'beste laadpaal thuis 2026 test' },
      { q: 'Alfen Eve Single Pro review' },
      { q: 'laadpaal subsidie Nederland 2026' },
      { q: 'Wallbox Pulsar Plus vs Easee Home' },
      { q: 'laadpaal installatie kosten gemiddeld', domains: ['anwb.nl'] }
    ],
    groups: [
      group('anwb.nl', [
        { url: 'https://www.anwb.nl/auto/elektrisch-rijden/laadpalen', title: 'Laadpalen voor thuis — ANWB', snippet: 'Vergelijking van thuislaadpalen.' },
        { url: 'https://www.anwb.nl/auto/elektrisch-rijden/kosten', title: 'Kosten laadpaal installatie', snippet: 'Reken op 900 tot 1400 euro.' }
      ]),
      group('alfen.com', [
        { url: 'https://alfen.com/nl/ev-charge-points/eve-single-pro-line', title: 'Alfen Eve Single Pro-line', snippet: 'Slimme laadpaal met load balancing.' }
      ]),
      group('easee.com', [
        { url: 'https://easee.com/nl/producten/easee-home/', title: 'Easee Home laadpaal', snippet: 'Compact en modulair.' }
      ]),
      group('milieucentraal.nl', [
        { url: 'https://www.milieucentraal.nl/energie-besparen/elektrisch-rijden/', title: 'Elektrisch rijden — Milieu Centraal', snippet: 'Onafhankelijke informatie.' }
      ])
    ],
    cited: [
      { title: 'Laadpalen voor thuis — ANWB', url: 'https://www.anwb.nl/auto/elektrisch-rijden/laadpalen' },
      { title: 'Alfen Eve Single Pro-line', url: 'https://alfen.com/nl/ev-charge-points/eve-single-pro-line' }
    ],
    answer: 'De Alfen Eve Single Pro-line is de veiligste keuze voor een Nederlandse woning met dynamische load balancing. ' +
      'Easee Home is compacter en goedkoper, maar had eerder terugroepacties in Zweden. ' +
      'Wallbox Pulsar Plus zit ertussenin qua prijs. Installatie kost gemiddeld 900 tot 1400 euro.'
  }),

  turn({
    conv: C3, title: 'GEO-strategie', promptId: 'u4', ago: 3 * DAY, model: 'gpt-5-thinking',
    prompt: 'Hoe zorg ik dat mijn merk vaker geciteerd wordt door AI-assistenten zoals ChatGPT en Perplexity?',
    queries: [
      { q: 'generative engine optimization best practices 2026' },
      { q: 'how do LLMs select citations sources' },
      { q: 'Perplexity citation ranking factors' },
      { q: 'llms.txt standaard implementatie' },
      { q: 'schema.org structured data AI search visibility' },
      { q: 'brand mentions vs backlinks AI search' }
    ],
    groups: [
      group('searchengineland.com', [
        { url: 'https://searchengineland.com/generative-engine-optimization-guide', title: 'Generative Engine Optimization: a practical guide', snippet: 'How GEO differs from SEO.' }
      ]),
      group('llmstxt.org', [
        { url: 'https://llmstxt.org/', title: 'The /llms.txt standard', snippet: 'A proposal for LLM-friendly content.' }
      ]),
      group('schema.org', [
        { url: 'https://schema.org/Organization', title: 'Organization — Schema.org', snippet: 'Structured data type.' }
      ]),
      group('ahrefs.com', [
        { url: 'https://ahrefs.com/blog/ai-search-visibility/', title: 'AI search visibility study', snippet: 'Analysis of 500k citations.' }
      ]),
      group('chapter42.com', [
        { url: 'https://chapter42.com/geo', title: 'GEO — Generative Engine Optimization | Chapter42', snippet: 'Aanpak voor AI-zichtbaarheid.' },
        { url: 'https://chapter42.com/blog/ai-citaties-meten', title: 'AI-citaties meten — Chapter42', snippet: 'Hoe je zichtbaarheid meet.' }
      ])
    ],
    cited: [
      { title: 'Generative Engine Optimization: a practical guide', url: 'https://searchengineland.com/generative-engine-optimization-guide' },
      { title: 'GEO — Generative Engine Optimization | Chapter42', url: 'https://chapter42.com/geo' },
      { title: 'The /llms.txt standard', url: 'https://llmstxt.org/' }
    ],
    answer: 'Zichtbaarheid in AI-antwoorden hangt vooral af van drie dingen. Ten eerste consistente entiteitssignalen: ' +
      'Schema.org Organization-markup, een Wikidata-item en uniforme NAW-gegevens. Ten tweede citeerbare content: ' +
      'korte, feitelijke passages met datums en cijfers werken beter dan lange verhalen. Ten derde merkvermeldingen ' +
      'op bronnen die ChatGPT en Perplexity vaak raadplegen, zoals Reddit, Wikipedia en vakmedia. ' +
      'De llms.txt-standaard is nog experimenteel en wordt door OpenAI niet officieel ondersteund.'
  })
];

/* ---------------------------------------------------------- Perplexity */

turns.push(capture({
  provider: 'perplexity', conv: 'crm-mkb-nederland-abc123', promptId: 'pplx-1', ago: 5 * 3600000,
  model: 'sonar-pro',
  prompt: 'Wat is het beste CRM voor een MKB-bedrijf in Nederland?',
  queries: [
    'beste crm mkb nederland 2026',
    'crm vergelijking nederlandse bedrijven',
    'Teamleader Focus prijzen 2026',
    'HubSpot gratis CRM beperkingen',
    'Pipedrive alternatief MKB'
  ],
  related: ['wat kost een CRM per gebruiker', 'CRM voor zzp', 'CRM koppelen aan Exact Online'],
  sources: [
    { url: 'https://www.hubspot.com/products/crm', title: 'HubSpot CRM', snippet: 'Gratis CRM voor kleine teams.', origin: 'citation' },
    { url: 'https://www.teamleader.eu/nl-nl/prijzen', title: 'Teamleader Focus prijzen', snippet: 'Vanaf 50 euro per maand.' },
    { url: 'https://chapter42.com/blog/crm-vergelijking-mkb', title: 'CRM-vergelijking voor het MKB — Chapter42', snippet: 'Onafhankelijke vergelijking.', origin: 'citation' },
    { url: 'https://www.pipedrive.com/nl/pricing', title: 'Pipedrive prijzen', snippet: 'Essential vanaf 14 euro.' },
    { url: 'https://tweakers.net/reviews/crm-2026/', title: 'CRM-systemen getest — Tweakers', snippet: 'Uitgebreide test.' }
  ],
  answer: 'HubSpot en Teamleader Focus zijn de bekendste opties voor het MKB in Nederland. ' +
    'Teamleader koppelt CRM aan facturatie en werkt goed samen met Exact Online. ' +
    'Pipedrive is goedkoper en richt zich vooral op verkoopteams.'
}));

turns.push(capture({
  provider: 'perplexity', conv: 'geo-ai-zichtbaarheid-def456', promptId: 'pplx-2', ago: 2 * DAY,
  model: 'sonar-reasoning',
  prompt: 'Hoe meet je of een merk zichtbaar is in AI-antwoorden?',
  queries: [
    'AI visibility measurement brand citations',
    'share of voice generative engines meten',
    'Perplexity citation tracking tools',
    'brand mentions LLM answers methodology'
  ],
  related: ['welke tools meten AI-zichtbaarheid', 'verschil GEO en SEO'],
  sources: [
    { url: 'https://ahrefs.com/blog/ai-search-visibility/', title: 'AI search visibility study', snippet: 'Analyse van 500k citaties.', origin: 'citation' },
    { url: 'https://searchengineland.com/generative-engine-optimization-guide', title: 'Generative Engine Optimization: a practical guide', snippet: 'How GEO differs from SEO.' },
    { url: 'https://chapter42.com/blog/ai-citaties-meten', title: 'AI-citaties meten — Chapter42', snippet: 'Hoe je zichtbaarheid meet.', origin: 'citation' }
  ],
  answer: 'Zichtbaarheid meet je door een vaste set prompts periodiek te herhalen en te tellen hoe vaak je domein ' +
    'als bron wordt aangehaald. Ahrefs en Semrush bieden inmiddels AI-visibility rapportages.'
}));

/* -------------------------------------------------------------- Gemini */

turns.push(capture({
  provider: 'gemini', conv: 'c_7a6b5c4d3e2f', promptId: 'r_gem1', ago: 8 * 3600000,
  model: 'gemini-3-pro',
  prompt: 'Welke laadpaal kan ik het beste thuis laten installeren in 2026?',
  queries: [
    'beste laadpaal thuis 2026 test',
    'laadpaal installatie kosten nederland',
    'Alfen Eve Single Pro review',
    'laadpaal subsidie nederland 2026'
  ],
  sources: [
    { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf123', domain: 'anwb.nl', title: 'Laadpalen voor thuis — ANWB' },
    { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/GhIjKl456', domain: 'alfen.com', title: 'Alfen Eve Single Pro-line' },
    { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/MnOpQr789', domain: 'easee.com', title: 'Easee Home laadpaal' },
    { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/StUvWx012', domain: 'milieucentraal.nl', title: 'Elektrisch rijden — Milieu Centraal' }
  ],
  answer: 'De Alfen Eve Single Pro-line is de veiligste keuze voor een Nederlandse woning dankzij dynamische ' +
    'load balancing. Easee Home is compacter en goedkoper. Reken op 900 tot 1400 euro inclusief installatie.'
}));

turns.push(capture({
  provider: 'gemini', conv: 'c_1f2e3d4c5b6a', promptId: 'r_gem2', ago: 4 * DAY,
  model: 'gemini-3-flash',
  prompt: 'Welke CRM-systemen worden het meest gebruikt door Nederlandse MKB-bedrijven?',
  queries: [
    'meest gebruikte CRM Nederland MKB marktaandeel',
    'Exact Online CRM koppeling',
    'Teamleader marktaandeel Benelux'
  ],
  sources: [
    { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/YzAbCd345', domain: 'hubspot.com', title: 'HubSpot CRM' },
    { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/EfGhIj678', domain: 'exact.com', title: 'Exact Online CRM' },
    { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/KlMnOp901', domain: 'chapter42.com', title: 'CRM-vergelijking voor het MKB — Chapter42' }
  ],
  answer: 'HubSpot, Teamleader en Exact Online zijn de meest gebruikte CRM-systemen in het Nederlandse MKB. ' +
    'Exact Online wordt vooral gekozen vanwege de boekhoudkoppeling.'
}));

const settings = { myDomains: ['chapter42.com'], maxTurns: 800, capturePaused: false };
turns.forEach((t) => sandbox.FanoutAnalysis.analyseTurn(t, settings));

const out = {
  'fanout:index': turns.map((t) => t.id),
  'fanout:settings': settings,
  'fanout:active': { conversationId: C1, title: 'CRM-keuze MKB', url: 'https://chatgpt.com/c/' + C1, at: NOW }
};
turns.forEach((t) => { out['fanout:turn:' + t.id] = t; });

const dir = path.join(ROOT, 'dev');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify(out, null, 2));

const agg = sandbox.FanoutAnalysis.aggregate(turns, settings);
console.log('dev/fixture.json geschreven —',
  turns.length + ' turns,', agg.totalQueries + ' queries,',
  agg.uniqueDomains + ' domeinen,', agg.entities.length + ' entiteiten');
console.log('top entiteiten:', agg.entities.slice(0, 12).map((e) => e.name + '(' + e.score + ')').join(', '));
console.log('top domeinen  :', agg.domains.slice(0, 8).map((d) => d.domain + ' ' + d.share + '%').join(', '));
console.log('per assistent :', agg.providers.map((p) => p.label + ' ' + p.turns + 't/' + p.queries + 'q').join(', '));
