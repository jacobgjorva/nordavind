# Chat-widgets — UI klart, backend gjenstår

Alle widgets under er bygget i frontend (`src/features/chat/Widgets.tsx`) og
rendres allerede fra assistentsvar. De aktiveres via **fenced kodeblokker** med
et spesial-språk. Backend/system-prompt må læres opp til å emitte disse for at
agenten skal bruke dem — det er ikke gjort ennå.

## Aktiv nå (ingen backend nødvendig)

- **Kodeblokk med kopier-knapp** — alle ` ``` `-blokker får automatisk en
  kopier-knapp. Fungerer i dag uten endringer.

## Klart i UI, venter på at agenten emitter det

| Widget | Fenced-språk | Innhold | Backend-oppgave |
|---|---|---|---|
| Kopiverdi (e-post, tlf, IBAN, ordrenr) | ` ```copy ` | linje 1 = verdi, linje 2 = valgfri hint | Prompt: pakk kopiérbare enkeltverdier i ```copy |
| Nøkkeltall-kort | ` ```stat ` | JSON `{label, value, unit?, delta?}` | Prompt: bruk ```stat for enkelttall (omsetning, antall) |
| Datatabell | ` ```table ` | JSON `{columns: string[], rows: string[][]}` | La `query_database`-svar rendres som ```table |
| Handlingsrad | ` ```actions ` | JSON `[{type:"mailto"\|"download"\|"copy", label, value, filename?}]` | Prompt: tilby «Send e-post»/«Eksporter CSV» der relevant |

### Eksempel agenten kan emitte

    ```copy
    ola@nordmann.no
    Kontaktperson
    ```

    ```stat
    {"label":"Omsetning","value":"23 786","unit":"kr","delta":"+12 %"}
    ```

    ```table
    {"columns":["Kunde","Total"],"rows":[["Fjellsport AS","23 786"]]}
    ```

    ```actions
    [{"type":"mailto","label":"Send e-post","value":"ola@nordmann.no"}]
    ```

## Ikke bygget ennå (ideer)

- Kart/adresse-widget
- Inline sitat-utheving (klikk påstand → kilde)
- Fil-forhåndsvisning

## Neste backend-steg

1. Utvid system-prompten (etter avtale) med korte regler for når hvert
   fenced-språk skal brukes.
2. Vurder å la `query_database` returnere strukturert tabell direkte som
   ```table i stedet for fritekst.
