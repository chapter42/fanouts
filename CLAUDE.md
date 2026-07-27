# CLAUDE.md

Werkinstructies voor dit project. De [README](README.md) beschrijft wát de
extensie doet; dit bestand beschrijft hoe je eraan werkt en waar de valkuilen
zitten.

## Wat dit is

Chrome MV3-extensie die de query fan-out van ChatGPT, Perplexity en Gemini
afvangt, lokaal analyseert en exporteerbaar maakt. Vanilla JS, **geen build-stap,
geen dependencies**. `npm` wordt alleen gebruikt als scriptrunner.

```bash
npm test        # 108 checks — draai dit na elke wijziging aan lib/ of inject/
npm run preview # fixture + dev/*-preview.html om de UI te bekijken
npm run icons   # iconen opnieuw genereren
```

Testen in de echte browser: `chrome://extensions` → Ontwikkelaarsmodus →
*Uitgepakte extensie laden* → deze map. Na een wijziging de extensie herladen én
het ChatGPT-tabblad verversen (het content script draait op `document_start`).

## Harde regels

Deze mogen niet stilzwijgend sneuvelen. Ze zijn de reden dat dit ding te
vertrouwen is:

1. **Alles blijft lokaal.** Geen backend, analytics of telemetrie. De enige
   uitgaande aanroepen zijn de twee same-origin fetches in `content.js` achter de
   knop *Historie ophalen*. Voeg er geen toe.
2. **Alleen `chrome.storage.local`.** Nooit `storage.sync` — dat zou gespreksdata
   naar het Google-account van de gebruiker sturen.
3. **Alleen clones lezen.** De interceptor mag responses nooit wijzigen,
   vertragen of blokkeren. Breekt de host-app, dan is het onze schuld.
4. **Geen extra `host_permissions`.** Alleen de drie AI-hosts.
5. **Geen dependencies of build-stap.** De extensie moet als map laadbaar blijven.
6. **Alles wat in `innerHTML` gaat door `esc()`**, elke `href` door `safeUrl()`.
   De data komt uit webpagina's; behandel hem als vijandig.

Zie [SECURITY.md](SECURITY.md) — die belooft dit aan gebruikers.

## Architectuur

```
MAIN world (pagina-context, volgorde uit manifest.json is bindend)
  util.js              SSE-lezer, deep-JSON-parser, QuerySet/SourceSet
  providers/*.js       per assistent; registreren zich op window.__FANOUT_PROVIDERS__
  interceptor.js       patcht fetch/XHR één keer, kiest de provider voor deze host
        ↓ window.postMessage (origin-gecheckt)
ISOLATED world
  parser.js            messages/mapping/capture → turns
  entities.js          entiteit-extractie
  analysis.js          classificatie, stats, aggregatie
  content.js           ontvangt, analyseert, schrijft naar storage
        ↓ chrome.storage.local
UI
  panel/, dashboard/   lezen via store.js, luisteren op storage.onChanged
```

**Content scripts delen globals binnen dezelfde wereld.** Daarom klassieke
scripts met een `window.X = {...}`-namespace en géén ES-modules. De volgorde in
`manifest.json` is dus semantisch: `util.js` moet vóór de providers, providers
vóór `interceptor.js`.

De UI-pagina's laden dezelfde `lib/*.js` via gewone `<script src>`-tags in
dezelfde volgorde. Wijzig je die set, werk dan `panel.html`, `dashboard.html`,
`manifest.json` én `tools/make-previews.js` bij.

## Het turn-model

Alles komt hierop uit, ongeacht de assistent. Dit is het contract tussen parser,
analyse, UI en export:

```js
{
  id, provider, providerLabel,          // id = "<provider>:<conversatie>:<promptkey>"
  conversationId, conversationTitle, conversationUrl,
  promptId, prompt, answer, model, createdAt, updatedAt, source,
  fanout:    [{ q, kind, domains, recency, order, toolCall,
                sourceCount, domains_found,      // door linkQueriesToSources()
                type, typeLabel, labels, overlap, novel }],  // door analyseTurn()
  sources:   [{ url, domain, title, snippet, pubDate, attribution,
                origin, toolCalls, isMine }],
  citations, toolCalls, related, searchedAt,
  entities:  [{ name, type, score, total, inPrompt, inQueries,
                inAnswer, inSources, modelAdded, queries, domains }],
  stats:     { fanoutCount, relatedCount, sourceCount, citedCount,
               domainCount, entityCount, myDomainHits, byType, … }
}
```

`kind` op een fan-out-item: `search` (telt als fan-out), `related`
(vervolgvraag — telt **niet** mee en krijgt géén `toolCall` of `sourceCount`),
en `open`/`find`/`click`/`image` voor ChatGPT's overige tool-acties.

`analyseTurn()` is idempotent en wordt opnieuw gedraaid bij elke merge en na een
instellingswijziging. Zet afgeleide velden daar, niet in de parser.

## Een provider toevoegen

Eén bestand in `src/inject/providers/` plus een regel in `manifest.json`. De rest
van de keten hoeft niet mee te veranderen.

```js
window.__FANOUT_PROVIDERS__.push({
  id: 'claude',
  matchesHost(host)              { return /(^|\.)claude\.ai$/.test(host); },
  match(url, method)             { /* → {type:'stream'|'json'} of null */ },
  promptFromRequest(bodyText)    { /* → {prompt, promptId, promptTime, conversationId} */ },
  consumeStream(body, ctx, emit) { /* leest de stream, roept emit('turn-update', …) */ },
  consumeText(text, ctx, emit),  // vangnet voor de XHR-route
  consumeJson(json, ctx, emit)   // optioneel: historie-endpoint
});
```

Twee soorten payload zijn toegestaan:

- **ruwe messages** (`{messages: [...]}` of `{mapping: {...}}`) — `parser.js` doet
  de extractie. Alleen zinvol als het formaat op ChatGPT lijkt.
- **capture** (`{capture: true, fanout, sources, answer, related, …}`) — de
  provider extraheert zelf. Dit is de route voor Perplexity en Gemini.

Voeg ook toe: `PROVIDERS` in `parser.js` (label + conversatie-URL),
providerdetectie in `content.js`, een kleur `.p-<id>` in `ui.css`, een label in
`PROVIDER_LABEL`/`providerLabels` in de UI, en een testsectie met een
realistische payload.

## Betrouwbaarheid per provider

Belangrijk bij het inschatten van bugmeldingen:

- **ChatGPT** — formaat precies bekend, tool-call geeft de queries expliciet prijs.
  Meest betrouwbaar.
- **Perplexity** — twee payloadvormen, beide gedekt, maar dit schuift het snelst.
  Extractie op *sleutelnamen* na volledig uitpakken van JSON-in-JSON, niet op paden.
- **Gemini** — positionele arrays zonder veldnamen. Extractie ankert op
  `grounding-api-redirect`-URL's en `google.com/search?q=`-links, plus
  stringarrays die op **afstand ≤ 1** van een groundingblok staan. Die
  afstandsgrens is essentieel: zonder die grens haalt de regel hogerop in de boom
  willekeurige tekst binnen. Verandert Google iets, dan levert dit *minder* op in
  plaats van een fout — lege Gemini-turns zijn het signaal.

Bij formaatdrift: eerst de deep-scan-vangnetten in `parser.js` en de
sleutelpatronen in de provider controleren, niet de UI.

## Valkuilen die ons al geraakt hebben

- **`.fill` en `.track` zijn `<span>`s.** Zonder `display: block` negeert de
  browser `width`/`height` en is de balk onzichtbaar. Zat er twee versies in.
- **Sticky `thead th` binnen `.table-wrap`.** Die wrapper is door
  `overflow-x: auto` zelf de scroll-container, dus `top` geldt t.o.v. de wrapper.
  Alles boven `0` duwt de kop over de eerste rij.
- **Python `str.replace()` faalt stil.** Gebruik je een patch-script, assert dan
  op elk anker. Een niet-gematchte replace kostte ons een ontbrekende CSV-kolom
  die pas veel later opviel.
- **Browser cachet `file://`-CSS.** `tools/make-previews.js` zet daarom een
  cache-buster op elke asset. Zonder dat beoordeel je een oude build.
- **CSV-escaping.** Antwoorden bevatten komma's, aanhalingstekens en regeleindes.
  Er staat een expliciete test op; laat die staan.
- **Vervolgvragen zijn geen fan-out.** Ze mogen geen `toolCall` en dus geen
  `sourceCount` krijgen — er is niet voor gezocht.

## Stijl

- **Nederlands** in UI, comments, docs en commitberichten. Identifiers Engels.
- ES5-achtige `var`/`function` in `src/` (klassieke scripts, geen transpiler).
  De service worker en `tools/` mogen modern zijn.
- Comments leggen uit **waarom**, niet wat. De bestaande dichtheid is de norm:
  een blok boven een niet-vanzelfsprekende aanpak, verder niets.
- Kleuren **altijd** via tokens uit `ui.css`. Nieuwe tinten met
  `color-mix(in srgb, var(--x) N%, transparent)` zodat licht én donker meekomen.
  Geen hardgecodeerde hex buiten het `:root`-blok.

## Testen

`tools/test-parser.js` draait de **echte** interceptor en providers in een
nagebootste browser (`vm` + fake `window`) over realistische payloads. Een nieuwe
provider of formaatvariant hoort daar een sectie te krijgen, niet een unit-mock.

De SSE-fixture wordt bewust in brokken van 137 bytes aangeleverd zodat ook
gesplitste frames worden getest. Houd dat zo.

`tools/make-fixture.js` genereert `dev/fixture.json` voor de UI-previews. Breid
je het turn-model uit, werk die fixture dan bij zodat de previews representatief
blijven.

## Release

1. `npm test` groen
2. Versie gelijk in `manifest.json` **en** `package.json`
3. Entry in [CHANGELOG.md](CHANGELOG.md) — inclusief bugs mét de reden dat ze niet
   eerder opvielen
4. Commit, `git tag -a vX.Y.Z`, push beide

Remote: `chapter42/fanouts`, publiek, MIT. Push naar `main`.
