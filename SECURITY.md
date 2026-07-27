# Security & privacy

Fanouts leest je gesprekken met ChatGPT, Perplexity en Gemini mee. Dat is
gevoelige data, dus hieronder staat precies wat de extensie doet, wat er waar
terechtkomt, en wat er níét gebeurt.

## Kort

- **Alles blijft lokaal.** Er is geen backend, geen analytics, geen telemetrie.
- **Eén uitgaande aanroep**, alleen als je op *Historie ophalen* drukt, en die
  gaat naar ChatGPT zelf om jóúw eigen gesprek op te halen.
- **Opslag is `chrome.storage.local`**, niet `chrome.storage.sync`. Je data reist
  niet mee met je Google-account of naar andere apparaten.

## Wat er precies gebeurt

### Meelezen

De extensie injecteert op de drie ondersteunde hosts een script in de
**MAIN-world** (de JavaScript-context van de pagina zelf) dat `window.fetch` en
`XMLHttpRequest` omwikkelt. Bij een match wordt uitsluitend een **clone** van de
response gelezen; de response die de pagina zelf krijgt blijft ongemoeid en er
worden geen requests toegevoegd, gewijzigd of geblokkeerd.

Dat is een reële bevoegdheid en het is goed om te weten dat je die geeft: code van
deze extensie draait in dezelfde context als de pagina op chatgpt.com,
perplexity.ai en gemini.google.com. De relevante bestanden zijn
[`src/inject/interceptor.js`](src/inject/interceptor.js) en de adapters in
[`src/inject/providers/`](src/inject/providers/) — samen een paar honderd regels
die je kunt nalezen.

De extensie leest **geen** DOM-inhoud, geen andere tabbladen, geen
browsergeschiedenis, geen opgeslagen wachtwoorden en geen cookies.

### Opslag

Vastgelegde turns gaan naar `chrome.storage.local`, wat op je schijf in je
Chrome-profiel staat (macOS: `~/Library/Application Support/Google/Chrome/<Profiel>/Local Extension Settings/<extensie-id>/`).

Die opslag is **niet versleuteld**. Wie toegang heeft tot je Chrome-profiel kan de
opgeslagen prompts, antwoorden en bronnen lezen. Dat geldt voor elke extensie die
`storage.local` gebruikt, maar het is hier extra relevant omdat de inhoud
gespreksdata is. Werk je met klantdata, houd daar rekening mee.

Je kunt alles op elk moment wissen via **Instellingen → Alles wissen**, en de
opname pauzeren met de knop in het paneel.

### Uitgaand verkeer

De volledige extensie doet twee netwerkaanroepen, allebei in
[`src/content/content.js`](src/content/content.js), allebei same-origin naar
chatgpt.com, en allebei alleen wanneer je zelf op *Historie ophalen* klikt:

| Aanroep | Waarom |
| --- | --- |
| `GET /api/auth/session` | haalt je bestaande sessietoken op |
| `GET /backend-api/conversation/<id>` | haalt jouw eigen gesprek op |

Het token wordt gebruikt in de `Authorization`-header van die ene aanroep en
verder nergens opgeslagen, gelogd of doorgegeven. Dit is een *download* van
ChatGPT naar je eigen schijf, geen upload.

De interceptor doet nul aanroepen — die leest alleen clones van responses die de
pagina toch al ophaalde.

### Permissies

| Permissie | Waarvoor |
| --- | --- |
| `storage`, `unlimitedStorage` | de opgenomen turns lokaal bewaren |
| `sidePanel` | het zijpaneel openen |
| `tabs` | de actieve AI-tab vinden voor *Historie ophalen* |
| `host_permissions` op 3 hosts | het meelezen op precies die hosts |

`host_permissions` staat alleen op chatgpt.com, chat.openai.com, perplexity.ai en
gemini.google.com. Er is geen enkele andere host waarheen de extensie zou mogen
praten, ook niet als er per ongeluk code voor zou staan.

### Exports

Een export bevat je prompts, de volledige gegenereerde antwoorden en de
geciteerde bronnen. Behandel die bestanden als vertrouwelijk — zeker als je
klantvragen of interne informatie in je prompts zet. Exports gaan via een `Blob`
naar je downloadmap; er is geen upload-endpoint.

## Wat dit niet is

Fanouts beschermt je niet tegen een gecompromitteerd Chrome-profiel, een
kwaadwillende andere extensie of malware op je machine. Een extensie met
`storage`-toegang tot dezelfde profielmap kan bij dezelfde data.

De extensie omzeilt geen authenticatie, rate limits of gebruiksvoorwaarden. Ze
leest alleen mee met verkeer dat je browser toch al genereert, en *Historie
ophalen* gebruikt je eigen bestaande sessie.

## Een kwetsbaarheid melden

Open **geen** publiek issue voor een beveiligingsprobleem. Mail in plaats daarvan
naar **roy@chapter42.com** met:

- een beschrijving van het probleem en de impact
- stappen om het te reproduceren
- de versie van de extensie en van Chrome

Je krijgt binnen vijf werkdagen een reactie. Dit is een hobbyproject zonder
bug-bountyprogramma, maar meldingen worden serieus genomen en netjes
gecrediteerd als je dat wilt.

## Ondersteunde versies

Alleen de nieuwste release krijgt fixes. Er is geen backport-beleid.

| Versie | Ondersteund |
| --- | --- |
| 0.3.x | ja |
| < 0.3 | nee |
