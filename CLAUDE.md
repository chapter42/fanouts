# CLAUDE.md

Werkinstructies voor dit project. De [README](README.md) beschrijft wát de
extensie doet; dit bestand beschrijft hoe je eraan werkt en waar de valkuilen
zitten.

## Wat dit is

Chrome MV3-extensie die de query fan-out van ChatGPT, Perplexity en Gemini
afvangt, lokaal analyseert en exporteerbaar maakt. Vanilla JS, **geen build-stap,
geen dependencies**. `npm` wordt alleen gebruikt als scriptrunner.

```bash
npm test        # projectregels + 108 gedragschecks — draai dit voor elke commit
npm run check   # alleen de statische projectregels (snel)
npm run preview # fixture + dev/*-preview.html om de UI te bekijken
npm run icons   # iconen opnieuw genereren
```

`tools/check.js` dwingt de harde regels hieronder machinaal af: geen
dependencies, geen extra uitgaande aanroepen, geen `storage.sync`, geen extra
permissies, geen hardgecodeerde kleuren, versies gelijk. Voeg je bewust iets toe
dat een regel raakt, dan pas je de allowlist in dat bestand aan — die wijziging
hoort zichtbaar in de PR-diff te staan.

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

CI draait bij elke PR `tools/check.js` en `tools/test-parser.js` op Node 20, 22 en
24 en bouwt de fixture en previews. Zie
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

De iconen worden **op pixelniveau** vergeleken met wat `make-icons.js` tekent,
niet op bytes: `zlib` comprimeert per platform net anders, dus dezelfde tekening
levert op Linux een andere PNG op dan op macOS. Een bytevergelijking faalde
daardoor meteen in CI terwijl er niets mis was.

`tools/test-parser.js` draait de **echte** interceptor en providers in een
nagebootste browser (`vm` + fake `window`) over realistische payloads. Een nieuwe
provider of formaatvariant hoort daar een sectie te krijgen, niet een unit-mock.

De SSE-fixture wordt bewust in brokken van 137 bytes aangeleverd zodat ook
gesplitste frames worden getest. Houd dat zo.

`tools/make-fixture.js` genereert `dev/fixture.json` voor de UI-previews. Breid
je het turn-model uit, werk die fixture dan bij zodat de previews representatief
blijven.

## Versiebeleid

[Semver](https://semver.org/lang/nl/), en **in kleine stappen**. Eén logische
wijziging per versie — niet vijf dingen opsparen tot één grote release.

| Bump | Wanneer |
| --- | --- |
| **MAJOR** | breekt opgeslagen data of exports: turn-id-formaat, veldnamen in het turn-model, CSV-kolommen die verdwijnen of hernoemen, een instelling die anders werkt |
| **MINOR** | nieuwe functionaliteit die niets breekt: een provider, een view, een exportvariant, een nieuw veld |
| **PATCH** | bugfix, tekstwijziging, styling, refactor zonder gedragsverandering |

Wat géén bump krijgt: wijzigingen aan `CLAUDE.md`, `README.md`, `tools/` of de
testsuite. Die raken de extensie niet.

Twijfel je tussen MINOR en PATCH? Vraag je af of iemand die de changelog leest
iets nieuws kán doen. Zo ja, MINOR.

**Retroactief niet corrigeren.** 0.2.0 en 0.3.0 zijn te grof gesneden — daar
zaten meerdere features en losse bugfixes in één versie. Dat is gepubliceerd en
getagd; laat het staan. Vanaf 0.3.1 geldt bovenstaande.

### Changelog

Elke PR die de extensie raakt voegt zijn regel toe onder `## [Unreleased]` in
[CHANGELOG.md](CHANGELOG.md), onder `Toegevoegd` / `Gewijzigd` / `Opgelost`. Bij
het uitbrengen wordt die kop vervangen door het versienummer en de datum, en komt
er een verse lege `Unreleased` boven.

Bij een bugfix hoort erbij **waarom hij niet eerder opviel**. Dat is de
waardevolste regel in het bestand.

## Werken met pull requests

**Nooit rechtstreeks naar `main` committen.** Elke wijziging gaat via een branch
en een PR — ook een eenregelige tekstfix, ook als je zeker weet dat het goed is.

```bash
git checkout main && git pull
git checkout -b <type>/<korte-omschrijving>
# werk, commit in logische stappen
npm test
git push -u origin HEAD
gh pr create --fill    # of met eigen titel en body
```

Branchnamen: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`. Nederlands of
Engels, maar kort en beschrijvend: `feat/claude-provider`, `fix/sticky-tabelkop`.

### Eén PR = één onderwerp

Dit is de kern van "kleine stappen". Ontdek je tijdens het werk een losstaande
bug, fix die dan in een **aparte** PR. Een PR die een feature toevoegt én
onderweg drie dingen opruimt, is niet te reviewen en niet terug te draaien.

De sessie waarin 0.3.0 ontstond zou onder deze regel vier PR's zijn geweest:
licht thema, antwoordtekst in exports, onzichtbare balkvulling, sticky tabelkop.

### Wat er in een PR-body hoort

Zie [`.github/pull_request_template.md`](.github/pull_request_template.md). Kort
samengevat: wat, waarom, hoe getest, en welke bump het rechtvaardigt. Bij een
bugfix ook hoe hij door de mazen kwam.

Bij UI-wijzigingen een screenshot uit `npm run preview` — beoordeel die zelf
vóór je de PR opent, niet erna.

### Branch protection

`main` is beschermd en dat geldt **ook voor de repo-eigenaar**. Een directe push
wordt geweigerd met `GH006: Protected branch update failed`.

| Regel | Stand |
| --- | --- |
| Wijzigingen alleen via PR | aan (0 approvals nodig — solo werkt dus door) |
| Geldt ook voor admins | aan |
| Force push | uit |
| Branch verwijderen | uit |
| Lineaire historie verplicht | aan (dus squash of rebase mergen, geen merge-commit) |
| Openstaande discussies afronden | aan |
| Verplichte status checks | `Node 20` / `Node 22` / `Node 24` |
| Branch moet up-to-date zijn met main | aan |

Merge-commits staan uit op repo-niveau; alleen squash en rebase blijven over.
Dat voorkomt dat GitHub een knop aanbiedt die `required_linear_history`
vervolgens weigert.

Zit je vast en moet je er echt omheen, dan zet je hem tijdelijk uit en meteen
weer aan:

```bash
gh api -X DELETE repos/chapter42/fanouts/branches/main/protection   # uit
# … doe wat je moet doen …
gh api -X PUT repos/chapter42/fanouts/branches/main/protection --input .github/branch-protection.json
```

Doe dat alleen als er echt geen PR-route is, en zet hem terug voor je verder gaat.

### Mergen en uitbrengen

1. `npm test` groen (lokaal) en CI groen op de PR
2. Merge via GitHub (squash, zodat `main` één commit per onderwerp houdt)
3. Verdient het een release? Dan een aparte kleine PR die versie in
   `manifest.json` **en** `package.json` gelijk zet en de `Unreleased`-kop
   vervangt
4. Na merge: `git tag -a vX.Y.Z -m "…"` op `main` en pushen

Remote: `chapter42/fanouts`, publiek, MIT.
