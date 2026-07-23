# Oppdrags-agent (goal-driven agent)

Utvidelse av eksisterende agent-scope. En agent kan settes i **oppdrags-modus**:
den får et mål, jobber selvstendig mot det over flere kjøringer, og gir seg
først når målet er nådd, i stedet for dagens faste ett-skudds kjøring. Brukeren
kan alltid pause, og et stående mål kan holde den gående.

Oppdraget er for oppgaver som er for store for én chat-tur: mange kilder, flere
runder, jobber uovervåket over tid, med en utgående handling til slutt. Ett-turs
oppgaver hører hjemme i vanlig chat, ikke som oppdrag.

Eksempel (Salg): «Kartlegg 10 bedrifter vi ikke er kunde hos, sjekk hver mot
nettet og vår portefølje, ranger etter potensial, send salgssjef topp 3.»

## Kontrollmodell

- **Autonomi innover:** reversible steg (query_database, web_search, analyse)
  kjøres fritt uten spørsmål.
- **Godkjenning utover:** alt som går ut (mail) er portet.
  - Uten «send mail»-tillatelse: agenten legger et `mailcompose`-kort i
    agent-chatten. Brukeren trykker Send.
  - Med «send mail»-tillatelse: agenten sender selv via `send_mail`-verktøyet.

## Token-nøkkel

Vi spiller **ikke** av hele transkriptet hver kjøring. Agenten holder en kompakt
**oppdrags-tilstand** `{summary, next_steps}`. Hver kjøring får bare mål +
gjeldende tilstand + denne kjøringens verktøyresultater. Innad i én kjøring
kjøres inntil `missionMaxRounds` verktøyrunder.

## Datamodell (store.Agent)

Nye kolonner (bakoverkompatible ALTER-er, default av): `mission`, `send_mail`,
`mission_state` (JSON), `mission_status` (`running`|`done`). `task` = målet.

## Kjøring (scheduler.go)

`runAgentOnce` forgrener på `a.Mission` → `executeMission`. Verktøy: web_search,
query_database, `send_mail` (kun med tillatelse), `mission_update`. Ved
`mission_update`: lagre state; `pending mail` uten tillatelse → `mailcompose`-kort
i output; `status=done` → `FinishMission` (status=done, enabled=0), agenten stopper.
Ellers omplanlegges den på intervallet og fortsetter neste tick.

## Oppsett

Veiviseren (`agentSetupSystem`) skiller rutine fra oppdrag, dropper frekvens for
oppdrag, og graver i suksesskriterium/omfang/kilder/kontakt før den bygger en
fyldig `task`. Felt: `mission`, `send_mail` (+ interval=900 for oppdrag).
Frontend `AgentWidgets` sender feltene videre til `createAgent`.
