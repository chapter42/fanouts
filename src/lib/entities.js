/*
 * Fanouts — entiteit-extractie.
 *
 * Volledig lokaal en zonder API-call: eigennamen, acroniemen, product-tokens en
 * merken worden heuristisch uit prompt, fan-out queries, antwoord en brontitels
 * gehaald. Meertalig (NL + EN) omdat prompts in beide talen voorkomen.
 *
 * Per entiteit houden we bij wáár hij vandaan komt. Voor GEO is dat het punt:
 * een entiteit die in de fan-out queries opduikt maar niet in de prompt stond,
 * is door het model zelf toegevoegd — dat is precies het interessante signaal.
 */
;(function (root) {
  'use strict';

  var STOP = (
    // Engels
    'the this that these those it there here what when where why how who which if but and or for with without from to in on at by as is are was were be been being have has had do does did will would can could should may might must not no yes you your we our they their he she his her my me us them also however therefore because so then than now today tomorrow yesterday first second third next last more most less least some any all each every both other another such same only just even still yet well good best better new old big small many much few several overall note key main top based using include including includes see source sources example examples about into over under between during before after while against among across through per via within upon whether although though since until unless while its it\'s let lets make makes made get gets got take takes taken give gives given need needs needed want wants use used uses one two three four five six seven eight nine ten ok okay yeah hey hi hello please thanks thank overall summary conclusion introduction step steps tip tips way ways thing things people time times year years day days ' +
    // Nederlands
    'de het een en of maar want dus als dan toen omdat terwijl voor na met zonder van naar in op aan bij door over onder tussen tegen is zijn was waren wordt worden werd werden heeft hebben had hadden kan kunnen kon konden zal zullen zou zouden moet moeten mag mogen niet geen wel ja nee ik jij je jullie u wij we zij ze hij hem haar hun ons onze mijn jouw dit dat deze die er hier daar wat wie waar waarom hoe wanneer welke welk ook echter daarom nu vandaag morgen gisteren eerst eerste tweede derde laatste volgende meer meest minder minst alle elke elk ieder beide andere ander zulke dezelfde alleen zelfs nog goed beste beter nieuw nieuwe oud oude groot grote klein kleine veel weinig enkele bron bronnen voorbeeld voorbeelden zie belangrijk belangrijkste kortom samengevat samenvatting conclusie inleiding stap stappen tip tips manier manieren ding dingen mensen tijd tijden jaar jaren dag dagen om te ten der des aan een zoals bijvoorbeeld verder tevens namelijk hierbij daarbij waardoor waarbij hoewel indien mits tenzij totdat sinds volgens tijdens binnen buiten naast achter boven beneden vanaf sinds wat betreft ' +
    // maanden / dagen
    'january february march april may june july august september october november december januari februari maart april mei juni juli augustus september oktober november december monday tuesday wednesday thursday friday saturday sunday maandag dinsdag woensdag donderdag vrijdag zaterdag zondag jan feb mar apr jun jul aug sep sept oct okt nov dec ' +
    // Zinsopeners: imperatieven, bijwoorden en connectieven die met een hoofdletter
    // beginnen zonder eigennaam te zijn. Zonder deze lijst wordt elk zinsbegin
    // ("Reken op…", "Consider that…") als entiteit opgepikt.
    'reken kijk denk gebruik probeer let zorg houd hou neem maak doe ga kom zie lees bekijk vraag stel begin start kies vergelijk bedenk onthoud merk vergeet wees blijf geef zet haal zoek controleer check klik druk voeg verwijder open sluit sla bewaar deel stuur verstuur plaats volg leer weet kun kunt kon hoeft hoef mocht laat lijkt blijkt betekent bestaat bevat biedt geldt hangt scheelt loopt komt gaat staat ligt werkt helpt zit valt telt kost duurt ' +
    'bovendien daarnaast tenslotte uiteindelijk meestal vaak soms altijd nooit misschien wellicht natuurlijk uiteraard eigenlijk gewoon vooral zeker waarschijnlijk helaas gelukkig samen totaal ongeveer circa minimaal maximaal gemiddeld inclusief exclusief hierdoor hiermee hiervoor hiernaast daardoor daarmee daarvoor kortom concreet praktisch typisch idealiter mogelijk onmogelijk nodig handig nuttig duidelijk simpel eenvoudig lastig moeilijk snel langzaam duur goedkoop gratis ' +
    'consider check note try use look think make take give keep find choose compare start begin read see ask remember remove add open close save share send follow learn know need want should must avoid ensure include expect assume imagine suppose ' +
    'moreover furthermore additionally finally ultimately usually often sometimes always never maybe perhaps obviously actually simply especially certainly probably unfortunately fortunately together approximately around minimum maximum average including excluding typically generally specifically importantly notably essentially basically clearly ideally likely unlikely worth free cheap expensive fast slow easy hard difficult simple complex'
  ).split(/\s+/).reduce(function (acc, w) { if (w) acc[w] = 1; return acc; }, {});

  // Kleine gazetteer — genoeg om locatie-intent te herkennen zonder ballast.
  var PLACES = (
    'nederland netherlands holland belgië belgie belgium duitsland germany deutschland frankrijk france spanje spain italië italie italy portugal engeland england verenigd koninkrijk united kingdom uk ierland ireland denemarken denmark zweden sweden noorwegen norway finland polen poland oostenrijk austria zwitserland switzerland tsjechië griekenland greece turkije turkey rusland russia oekraïne ukraine amerika america usa verenigde staten united states canada mexico brazilië brazil argentinië china japan india australië australia nieuw-zeeland new zealand zuid-afrika south africa europa europe azië asia afrika africa ' +
    'amsterdam rotterdam den haag utrecht eindhoven groningen tilburg almere breda nijmegen apeldoorn haarlem arnhem zaanstad enschede maastricht leiden dordrecht zwolle delft alkmaar deventer hilversum antwerpen brussel gent brugge london parijs paris berlijn berlin munich münchen hamburg madrid barcelona milaan milan rome new york san francisco los angeles chicago boston seattle austin tokyo singapore dubai sydney toronto'
  ).split(/\s+/).reduce(function (acc, w) { if (w) acc[w] = 1; return acc; }, {});

  var ORG_SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|gmbh|ag|bv|b\.v\.|nv|n\.v\.|plc|sa|s\.a\.|oy|ab|as|holding|group|labs|technologies|systems|solutions|ventures|partners|foundation|institute|university|universiteit|hogeschool)\b/i;
  var PRODUCT_HINT = /(?:^|[\s-])(?:v?\d+(?:\.\d+)*|\d+[a-z]{1,3}|[a-z]+\d+)(?:$|[\s-])/i;
  var YEAR = /^(19|20)\d{2}$/;
  // Alleen deeltjes die écht binnen één naam voorkomen ("Bank of America",
  // "Van der Valk"). Bewust géén "en"/"and"/"in": die verbinden twee losse
  // entiteiten ("HubSpot en Salesforce") in plaats van er één te vormen.
  var CONNECTORS = { of: 1, van: 1, der: 1, den: 1, da: 1, di: 1, du: 1, la: 1, le: 1, '&': 1 };

  function stripMarkdown(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/[*_~>]+/g, ' ')
      .replace(/\|/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/&[a-z]+;/gi, ' ');
  }

  function isStop(word) {
    return !!STOP[String(word).toLowerCase().replace(/[.,;:!?'"()]+$/g, '')];
  }

  function normKey(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9À-ɏ+#.& -]/g, '').replace(/\s+/g, ' ').trim();
  }

  function titleize(s) {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  /*
   * Kiest de beste schrijfwijze van dezelfde entiteit. Interne hoofdletters
   * winnen, zodat de echte merknaam ("HubSpot") het wint van de variant die uit
   * het domein is afgeleid ("Hubspot").
   */
  function betterDisplay(a, b) {
    var innerA = (a.slice(1).match(/\p{Lu}/gu) || []).length;
    var innerB = (b.slice(1).match(/\p{Lu}/gu) || []).length;
    if (innerA !== innerB) return innerA > innerB ? a : b;
    if (a.length !== b.length) return a.length > b.length ? a : b;
    return a;
  }

  // Tweedelige publieke suffixen die we moeten overslaan om bij het echte label
  // uit te komen (example.co.uk → "example", niet "co").
  var MULTI_TLD = { 'co.uk': 1, 'org.uk': 1, 'ac.uk': 1, 'gov.uk': 1, 'co.nz': 1, 'co.za': 1, 'com.au': 1, 'net.au': 1, 'org.au': 1, 'com.br': 1, 'co.jp': 1, 'or.jp': 1, 'com.mx': 1, 'co.in': 1, 'com.tr': 1, 'com.sg': 1 };

  /*
   * Merknaam uit een domein: "tweakers.net" → "Tweakers",
   * "legal.hubspot.com" → "HubSpot"-achtig ("Hubspot"), "blog.example.co.uk" → "Example".
   * We nemen het registreerbare label, niet zomaar het eerste.
   */
  function brandFromDomain(domain) {
    if (!domain) return null;
    var parts = String(domain).toLowerCase().split('.').filter(Boolean);
    if (parts.length < 2) return null;
    var suffixLen = MULTI_TLD[parts.slice(-2).join('.')] ? 2 : 1;
    var core = parts[parts.length - 1 - suffixLen];
    if (!core || core.length < 2) core = parts[0];
    if (!core || core.length < 2) return null;
    var words = core.split(/[-_]/).filter(Boolean);
    return words.map(function (w) {
      if (w.length <= 3 && w === w.toLowerCase() && /^[a-z]+$/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  /* --------------------------------------------------------------------- */
  /* Kandidaten uit vrije tekst                                            */
  /* --------------------------------------------------------------------- */

  function candidatesFromText(text, opts) {
    opts = opts || {};
    var clean = stripMarkdown(text);
    var out = [];
    // Splits op zinseinden zodat we zinsbegin kunnen herkennen.
    var sentences = clean.split(/(?<=[.!?:;\n])\s+|\n+/);

    sentences.forEach(function (sentence) {
      var tokens = sentence.split(/\s+/).filter(Boolean);
      var i = 0;
      while (i < tokens.length) {
        var raw = tokens[i];
        var word = raw.replace(/^[^\p{L}\p{N}$€£#@]+/u, '').replace(/[^\p{L}\p{N}%+#.]+$/u, '');
        if (!word) { i++; continue; }

        var startsUpper = /^[\p{Lu}]/u.test(word);
        var isAcronym = /^[A-Z0-9]{2,7}$/.test(word) && /[A-Z]/.test(word);
        var hasDigitMix = /[\p{L}]/u.test(word) && /\d/.test(word);

        if (!startsUpper && !isAcronym && !hasDigitMix) { i++; continue; }
        if (YEAR.test(word)) { i++; continue; }
        if (/^\d+([.,]\d+)?%?$/.test(word)) { i++; continue; }
        // Een naam begint nooit met een lidwoord of ander stopwoord ("De
        // Autoriteit Persoonsgegevens" → "Autoriteit Persoonsgegevens").
        if (isStop(word)) { i++; continue; }

        // Meerwoordige eigennaam opbouwen. Leestekens breken de naam af, anders
        // plakt "…in Frankfurt, Salesforce doet…" tot één entiteit aan elkaar.
        var breaksAfter = /[,;:.!?)»"']$/.test(raw);
        var phrase = [word];
        var j = i + 1;
        while (!breaksAfter && j < tokens.length && phrase.length < 5) {
          var nxtRaw = tokens[j];
          var nxt = nxtRaw.replace(/^[^\p{L}\p{N}$€£#@]+/u, '').replace(/[^\p{L}\p{N}%+#.]+$/u, '');
          if (!nxt) break;
          var nxtBreaks = /[,;:.!?)»"']$/.test(nxtRaw);
          var nxtUpper = /^[\p{Lu}]/u.test(nxt);
          var isConnector = CONNECTORS[nxt.toLowerCase()] && j + 1 < tokens.length && !nxtBreaks;
          if (nxtUpper && !YEAR.test(nxt)) {
            phrase.push(nxt); j++;
            if (nxtBreaks) break;
            continue;
          }
          if (isConnector) {
            var peekRaw = tokens[j + 1] || '';
            var peek = peekRaw.replace(/^[^\p{L}\p{N}]+/u, '');
            if (/^[\p{Lu}]/u.test(peek)) { phrase.push(nxt); j++; continue; }
          }
          break;
        }

        var name = titleize(phrase.join(' ')).replace(/[.,;:]+$/, '');
        var sentenceInitial = i === 0;
        var single = phrase.length === 1;

        var reject =
          name.length < 2 ||
          (single && isStop(name)) ||
          (single && sentenceInitial && !isAcronym && !hasDigitMix && name.length < 4) ||
          (single && sentenceInitial && isStop(name)) ||
          /^[\d\W]+$/.test(name);

        // Bij zinsbegin met één woord: alleen accepteren als het elders ook
        // midden in een zin voorkomt (wordt later gefilterd via evidence).
        if (!reject) {
          out.push({
            name: name,
            words: phrase.length,
            sentenceInitial: sentenceInitial && single,
            acronym: isAcronym && single,
            digitMix: hasDigitMix,
            field: opts.field || 'text'
          });
        }
        i = j > i ? j : i + 1;
      }
    });

    return out;
  }

  /* --------------------------------------------------------------------- */
  /* Hoofdfunctie                                                          */
  /* --------------------------------------------------------------------- */

  /*
   * turn: { prompt, answer, fanout: [{q}], sources: [{domain,title,snippet}] }
   * → [{ name, type, total, inPrompt, inQueries, inAnswer, inSources,
   *      modelAdded, queries: [...], domains: [...] }]
   */
  function extractEntities(turn, options) {
    options = options || {};
    var minScore = options.minScore || 1;
    var map = Object.create(null);

    function bump(name, field, meta) {
      var key = normKey(name);
      if (!key || key.length < 2) return null;
      var e = map[key];
      if (!e) {
        e = map[key] = {
          key: key,
          name: name,
          type: 'concept',
          total: 0,
          inPrompt: 0,
          inQueries: 0,
          inAnswer: 0,
          inSources: 0,
          queries: [],
          domains: [],
          evidenceMidSentence: 0,
          evidenceSentenceInitial: 0,
          acronym: false,
          digitMix: false,
          words: (name.match(/\s+/g) || []).length + 1
        };
      }
      e.name = betterDisplay(e.name, name);
      e.total++;
      if (field === 'prompt') e.inPrompt++;
      else if (field === 'query') e.inQueries++;
      else if (field === 'answer') e.inAnswer++;
      else if (field === 'source') e.inSources++;
      if (meta) {
        if (meta.acronym) e.acronym = true;
        if (meta.digitMix) e.digitMix = true;
        if (meta.sentenceInitial === false) e.evidenceMidSentence++;
        else if (meta.sentenceInitial === true) e.evidenceSentenceInitial++;
        if (meta.query && e.queries.indexOf(meta.query) === -1 && e.queries.length < 25) e.queries.push(meta.query);
        if (meta.domain && e.domains.indexOf(meta.domain) === -1 && e.domains.length < 40) e.domains.push(meta.domain);
      }
      return e;
    }

    // 1. Merken uit geciteerde domeinen — hoogste betrouwbaarheid
    var domainBrands = Object.create(null);
    (turn.sources || []).forEach(function (s) {
      var brand = brandFromDomain(s.domain);
      if (!brand) return;
      domainBrands[normKey(brand)] = s.domain;
      var e = bump(brand, 'source', { domain: s.domain, sentenceInitial: false });
      if (e) e.type = 'brand';
    });

    // 2. Prompt
    candidatesFromText(turn.prompt || '', { field: 'prompt' }).forEach(function (c) {
      bump(c.name, 'prompt', { acronym: c.acronym, digitMix: c.digitMix, sentenceInitial: c.sentenceInitial });
    });

    // 3. Fan-out queries — het belangrijkste signaal
    (turn.fanout || []).forEach(function (q) {
      if (q.kind && q.kind !== 'search' && q.kind !== 'image') return;
      candidatesFromText(q.q, { field: 'query' }).forEach(function (c) {
        bump(c.name, 'query', {
          acronym: c.acronym, digitMix: c.digitMix,
          sentenceInitial: false,       // queries hebben geen zinsstructuur
          query: q.q
        });
      });
    });

    // 4. Antwoord
    candidatesFromText(turn.answer || '', { field: 'answer' }).forEach(function (c) {
      bump(c.name, 'answer', { acronym: c.acronym, digitMix: c.digitMix, sentenceInitial: c.sentenceInitial });
    });

    // 5. Brontitels
    (turn.sources || []).forEach(function (s) {
      candidatesFromText(s.title || '', { field: 'source' }).forEach(function (c) {
        bump(c.name, 'source', {
          acronym: c.acronym, digitMix: c.digitMix,
          sentenceInitial: c.sentenceInitial, domain: s.domain
        });
      });
    });

    // --- Typering + filtering -------------------------------------------
    var list = [];
    for (var k in map) {
      var e = map[k];

      if (isStop(e.name) && e.words === 1) continue;
      if (e.total < minScore) continue;

      // Eén kort woord dat alleen aan een zinsbegin stond en verder nergens
      // opduikt is vrijwel altijd ruis (een werkwoord of bijwoord dat niet in de
      // stopwoordenlijst staat).
      var onlySentenceInitial = e.evidenceMidSentence === 0 && e.evidenceSentenceInitial > 0;
      if (onlySentenceInitial && e.words === 1 && !e.acronym && !e.digitMix &&
          e.inQueries === 0 && e.inSources === 0 && e.total === 1 && e.name.length < 5) continue;

      if (domainBrands[e.key]) e.type = 'brand';
      else if (ORG_SUFFIX.test(e.name)) e.type = 'organisation';
      else if (PLACES[e.name.toLowerCase()]) e.type = 'location';
      else if (e.acronym) e.type = 'acronym';
      else if (e.digitMix || PRODUCT_HINT.test(e.name)) e.type = 'product';
      else if (e.words >= 2) e.type = 'named_entity';

      // Score: fan-out weegt zwaarder dan antwoordtekst
      e.score = e.inQueries * 3 + e.inSources * 2 + e.inPrompt * 2 + e.inAnswer;
      if (onlySentenceInitial && e.words === 1) e.score = Math.max(1, e.score - 1);
      // In de fan-out maar niet in de prompt = door het model zelf toegevoegd
      e.modelAdded = e.inQueries > 0 && e.inPrompt === 0;
      e.domain = domainBrands[e.key] || null;

      delete e.evidenceMidSentence;
      delete e.evidenceSentenceInitial;
      list.push(e);
    }

    list.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    });

    return list.slice(0, options.limit || 200);
  }

  root.FanoutEntities = {
    extractEntities: extractEntities,
    brandFromDomain: brandFromDomain,
    stripMarkdown: stripMarkdown
  };
})(typeof self !== 'undefined' ? self : this);
