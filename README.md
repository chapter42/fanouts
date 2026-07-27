# Fanouts — AI query fan-out monitor

Chrome-extensie die vastlegt wat **ChatGPT, Perplexity en Gemini** écht doen als ze het
web raadplegen: de **query fan-out** — de zoekopdrachten die het model zelf formuleert
uit jouw prompt — plus de bronnen die het terugkrijgt en de entiteiten die daarin
voorkomen. Alles wordt lokaal geanalyseerd en is exporteerbaar naar JSON, CSV en Markdown.

Gebouwd voor GEO/AI-visibility-werk: je ziet welk query-universum elke assistent rond
een onderwerp opspant, welke domeinen daarbij gewonnen worden, en of jouw domein
daartussen zit. Stel dezelfde vraag aan alle drie en je hebt de vergelijking naast elkaar.

---

## Installeren

1. Open `chrome://extensions`
2. Zet **Ontwikkelaarsmodus** aan (rechtsboven)
3. Klik **Uitgepakte extensie laden** en kies deze map
4. Open [chatgpt.com](https://chatgpt.com), [perplexity.ai](https://www.perplexity.ai) of
   [gemini.google.com](https://gemini.google.com) en stel een vraag waarvoor het web geraadpleegd wordt
5. Klik op het Fanouts-icoon om het zijpaneel te openen

Werkt op Chrome 111+ (Edge, Brave en Arc ook). Geen build-stap, geen dependencies.

Alles blijft lokaal: geen backend, geen analytics, geen telemetrie. Zie
[SECURITY.md](SECURITY.md) voor wat er precies gebeurt met je gespreksdata.

---

## Wat je krijgt

**Zijpaneel** — live meekijken terwijl de assistent antwoordt.
Per turn: de fan-out queries met hun type, de gevonden entiteiten, de bronnen met
share-of-voice per domein, en de antwoordtekst. Elke turn draagt een gekleurde badge
met de assistent; staan er meerdere in beeld, dan verschijnt er een filter per assistent.

**Dashboard** — analyse over alle opgenomen gesprekken heen.
Zes views: fan-out queries, entiteiten, bronnen & domeinen, turns, querytypen en
**per assistent**. Sorteerbaar, filterbaar op assistent/conversatie/periode/querytype,
met vrij zoeken.

De view *Per assistent* laat zien hoe de drie zich tot elkaar verhouden — queries per
turn, aantal bronnen, aantal domeinen — plus welke domeinen door **meerdere** assistenten
worden geciteerd. Dat laatste is het sterkste GEO-signaal in de tool: een domein dat
ChatGPT, Perplexity én Gemini aanhalen, is structureel zichtbaar en niet toevallig gevonden.

### Entiteiten

Volledig lokaal geëxtraheerd uit prompt, fan-out queries, antwoord en brontitels —
geen externe API. Meertalig (NL/EN). Per entiteit zie je waar hij vandaan komt:

| Kolom | Betekenis |
| --- | --- |
| `in_prompt` | stond in jouw vraag |
| `in_fanout_queries` | dook op in de zoekopdrachten van het model |
| `in_antwoord` | komt voor in het antwoord |
| `in_bronnen` | staat in de titels van geciteerde bronnen |
| `door_model_toegevoegd` | **wel** in de fan-out, **niet** in je prompt |

Die laatste kolom is het interessantste signaal: dat zijn de merken, producten en
concepten die ChatGPT zélf associeert met je onderwerp. Ze zijn in de UI gemarkeerd met ✦.

Types: `brand` (herleid uit een geciteerd domein), `organisation`, `product`,
`location`, `acronym`, `named_entity`, `concept`.

### Vervolgvragen

Perplexity stelt na elk antwoord vervolgvragen voor. Die worden apart vastgelegd
(soort `related`) en tellen **niet** mee als fan-out — er is immers niet voor gezocht.
Ze staan wel in de export, want ze laten zien welke richting de assistent het gesprek
op wil sturen.

### Querytypen

Elke fan-out query wordt geclassificeerd op basis van token-overlap met je prompt
plus intent-patronen: `Herformulering`, `Uitbreiding`, `Gerelateerd`, `Vergelijkend`,
`Commercieel`, `Review`, `How-to`, `Definitie`, `Actualiteit`, `Lokaal`,
`Specificatie`, `Entiteit-lookup`.

### Export

| Formaat | Inhoud |
| --- | --- |
| JSON | alles — turns, queries, bronnen, entiteiten, aggregaties |
| Markdown | leesbaar rapport met samenvatting, tabellen en per-turn detail |
| CSV queries (per turn) | één regel per query, met prompt, type, overlap en domeinen |
| CSV unieke queries | ontdubbeld over alle turns, met frequentie |
| CSV entiteiten | de tabel hierboven |
| CSV domeinen | share of voice, citaties, unieke URL's |
| CSV bronnen | één regel per bron-vermelding |
| CSV turns | één regel per turn met alle tellingen, **inclusief het volledige antwoord** |

CSV's hebben een UTF-8 BOM, dus Excel opent ze direct goed.

De **gegenereerde antwoordtekst** zit in de JSON-export, in de turns- en
bronnen-CSV (kolom `antwoord`) en in het Markdown-rapport. Niets wordt afgekapt:
dat is juist de kolom waarop je inhoudelijk analyseert — welke merken worden
genoemd, in welke volgorde, met welke framing.

### Thema

Licht is de standaard. De knop rechtsboven in het paneel (☾/☀) en in het dashboard
schakelt naar donker; de keuze wordt bewaard. Beide thema's komen uit dezelfde set
kleurtokens — tinten en overlays worden met `color-mix()` uit de themakleuren
afgeleid, dus een thema is een handvol basiskleuren en geen tweede stylesheet.

### Eigen domeinen

Zet in **Instellingen** je eigen domeinen (één per regel). Ze worden gemarkeerd in
de bronlijst, krijgen een aparte teller in de statistieken en een groene balk in de
share-of-voice. Zo zie je per vraag of je geciteerd wordt.

---

## Hoe het werkt

```
chatgpt.com / perplexity.ai / gemini.google.com
  │
  ├─ util.js         (MAIN world)   SSE-lezer, deep-JSON-parser, deduplicatie
  ├─ providers/*.js  (MAIN world)   per assistent: welke requests, welk formaat
  ├─ interceptor.js  (MAIN world)   patcht fetch/XHR één keer, kiest de provider
  │                                 die bij de host hoort en leest een clone
  │        ↓ window.postMessage
  ├─ content.js      (ISOLATED)     parser → entities → analysis → storage
  │        ↓ chrome.storage.local
  └─ panel / dashboard              lezen en renderen
```

De extensie leest alleen mee; er wordt niets aan de responses gewijzigd en niets naar
buiten gestuurd. Alle data blijft in `chrome.storage.local` op je eigen machine.

Een provider levert óf ruwe messages (ChatGPT, waar `parser.js` de extractie doet) óf
een kant-en-klare *capture* met queries, bronnen en antwoord. Beide komen uit op
hetzelfde turn-model, zodat analyse, UI en export niet per assistent verschillen.

### Per assistent

**ChatGPT** — de streaming POST naar `/backend-api/conversation`, plus de GET
`/backend-api/conversation/<id>` die de app zelf doet als je een oud gesprek opent
(daarmee komt historie vanzelf binnen). De knop **↻ Historie ophalen** haalt de huidige
conversatie desnoods expliciet op. Dit is de betrouwbaarste van de drie: ChatGPT geeft zijn
zoekopdrachten expliciet prijs in de tool-call.

**Perplexity** — de SSE-stream op `/rest/sse/perplexity_ask`. Het payloadformaat
verschilt per versie: de oudere vorm stopt JSON-in-JSON in een `text`-veld met
`step_type`-blokken, de nieuwere gebruikt `blocks` met `plan_block` /
`web_result_block` / `markdown_block`. Daarom wordt de payload eerst volledig
uitgepakt en daarna op *sleutelnamen* geëxtraheerd in plaats van op vaste paden.
Pro Search-stappen (`Searching for "…"`, `Zoeken naar …`) worden ook herkend.
Beide vormen zitten in de testsuite.

**Gemini** — het `batchexecute`-protocol. De payload bestaat uit lengte-geprefixte
chunks met daarin geneste **positionele arrays zonder veldnamen** — extractie op pad is
onmogelijk. Er wordt geankerd op twee patronen die wél stabiel zijn:

- `vertexaisearch.cloud.google.com/grounding-api-redirect/…` markeert een bron; het
  echte domein en de titel staan als buurstrings in dezelfde array.
- `google.com/search?q=…` (de links achter de "Google Search"-chips) geeft een query.

Daarnaast worden stringarrays opgepakt die *direct naast* een groundingblok staan —
dat zijn de `webSearchQueries`. Die nabijheidsgrens is essentieel: zonder die grens
zou de regel hogerop in de boom willekeurige tekst als query binnenhalen.

De prompt komt uit het form-encoded veld `f.req`, twee JSON-lagen diep.

### Waar de queries vandaan komen

ChatGPT's websearch loopt via een tool-call. De assistent stuurt een `code`-bericht
naar de `web`-tool met een payload als:

```json
{"search_query":[{"q":"beste CRM software MKB Nederland 2026"},
                 {"q":"HubSpot vs Salesforce prijzen"}],
 "response_length":"medium"}
```

Die payload druppelt tekengewijs binnen via de SSE-stream en wordt door de
interceptor weer samengesteld. Daarnaast worden `metadata.search_queries`,
`metadata.search_result_groups` en `metadata.content_references` uitgelezen, plus de
oudere `search("…")`-syntax. Vindt geen van die routes iets, dan draait er een
deep-scan over het hele object als vangnet — ChatGPT's interne formaat verandert
regelmatig en de extensie moet dat overleven.

### Bekende beperkingen

**Query → bron is niet 1-op-1.** ChatGPT bundelt meerdere queries in één `web.run`-aanroep
en krijgt daar één gecombineerde resultatenset op terug. Een exacte koppeling
*query → specifieke bron* zit dus niet in de data. Bronnen worden toegekend aan de
tool-call waar ze bij horen, niet aan één losse query. De UI benoemt dat expliciet.

**Gemini is het fragielst.** ChatGPT's formaat is precies bekend en volledig getest.
Perplexity's twee payloadvormen zijn allebei gedekt, maar dat formaat verschuift het
snelst. Gemini's positionele codering heeft geen veldnamen om op te ankeren; verandert
Google de volgorde of de redirect-host, dan levert de extractie mínder op in plaats van
een fout. Merk je dat Gemini-turns leeg blijven terwijl er wel gezocht is, dan is dat
het signaal dat de patronen bijgesteld moeten worden.

**Historie ophalen werkt alleen op ChatGPT.** Alleen daar is er een historie-endpoint dat de
volledige conversatie teruggeeft. Bij Perplexity en Gemini wordt live meegelezen; open
je een oud gesprek opnieuw, dan komt er geen nieuwe data binnen.

---

## Development

```bash
node tools/test-parser.js
```

96 checks over de hele keten. De echte interceptor en providers draaien in een
nagebootste browser over realistische payloads: ChatGPT's delta-encoded SSE-stream
(in brokken aangeleverd, zodat ook gesplitste frames getest worden), de historie-route,
de legacy-vorm, Perplexity's beide payloadvormen, Gemini's batchexecute met positionele
arrays, merge-gedrag, provider-aggregatie en export.

```bash
node tools/make-fixture.js && node tools/make-previews.js
```

Genereert `dev/fixture.json` met realistische data van alle drie de assistenten en bouwt
`dev/panel-preview.html` en `dev/dashboard-preview.html` — die open je direct in je
browser om de UI te bekijken zonder de extensie te laden. De previews gebruiken de
échte HTML/CSS/JS met een `chrome.*`-stub.

```bash
node tools/make-icons.js
```

Regenereert de iconen (afhankelijkheidsvrije PNG-encoder).

De `dev/`- en `tools/`-mappen staan buiten `manifest.json` en horen niet bij de extensie.

### Bestandsindeling

```
manifest.json
src/
  inject/util.js             SSE-lezer, deep-JSON-parser, dedupe-collectors
  inject/providers/          per assistent: requests, formaat, extractie
    chatgpt.js               delta-encoding → messages
    perplexity.js            SSE-snapshots → capture
    gemini.js                batchexecute → capture
  inject/interceptor.js      MAIN world — fetch/XHR-tap, kiest de provider
  content/content.js         ISOLATED — parsen, analyseren, opslaan
  background/service-worker.js
  lib/parser.js              messages → turns (queries, bronnen, citaties)
  lib/entities.js            entiteit-extractie
  lib/analysis.js            query-classificatie, statistieken, aggregatie
  lib/exporter.js            JSON / CSV / Markdown
  lib/store.js               chrome.storage-laag voor de UI
  shared/ui.css              designtokens
  panel/                     zijpaneel
  dashboard/                 volledige analyse-omgeving
```

---

## Wat er nog niet in zit

- Claude en Copilot — een nieuwe provider is één bestand in `src/inject/providers/`
  plus een regel in `manifest.json`; de rest van de keten hoeft niet mee te veranderen
- LLM-verrijking van entiteiten (typering, disambiguatie, Wikidata-koppeling)
- Trends over tijd: dezelfde prompt periodiek herhalen bij alle drie de assistenten en
  verschuivingen in fan-out en citaties volgen

---

## Meer

- [CHANGELOG.md](CHANGELOG.md) — wat er per versie is veranderd
- [SECURITY.md](SECURITY.md) — datastromen, permissies en hoe je een kwetsbaarheid meldt
- [CLAUDE.md](CLAUDE.md) — architectuur, conventies en valkuilen voor wie eraan doorwerkt
- [PRIVACY.md](PRIVACY.md) — privacybeleid
- [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) — voorbereiding voor de Chrome Web Store

## Licentie

[MIT](LICENSE)
