## Wat

<!-- Eén zin: wat verandert er voor de gebruiker? -->

## Waarom

<!-- Het probleem of de aanleiding. Bij een bugfix: waardoor kwam dit door de
     mazen? Die regel hoort ook in de CHANGELOG. -->

## Hoe getest

- [ ] `npm test` groen
- [ ] Bij UI-wijzigingen: `npm run preview` bekeken (screenshot hieronder)
- [ ] Bij wijzigingen aan een provider: testsectie toegevoegd of bijgewerkt

## Versie

<!-- Kies er één en haal de rest weg. Docs, tools en tests: geen bump. -->

- [ ] MAJOR — breekt opgeslagen data of exports
- [ ] MINOR — nieuwe functionaliteit
- [ ] PATCH — bugfix, tekst, styling
- [ ] geen bump

## Checklist

- [ ] Eén onderwerp in deze PR
- [ ] Regel toegevoegd onder `## [Unreleased]` in CHANGELOG.md
- [ ] Geen nieuwe dependencies, host-permissies of uitgaande aanroepen
