# EU-suveren AI-plattform for bedrifter

## Kjerneidé
En europeisk AI-plattform bygget på open-weight modeller (GLM-5.2, Kimi K2.7) med eget grensesnitt, hostet 100 % i EU. Et rimeligere og juridisk tryggere alternativ for bedrifter som vil ta i bruk AI-verktøy — uten å sende data til USA eller Kina.

## Verdiløftet
- **3x billigere.** Open-weight modeller koster 30–70 % mindre per token enn Sonnet/GPT, og har ingen setavgift. For en bedrift med 100 brukere: ~15–17 500 kr/mnd mot ~46 000 kr for Claude Enterprise.
- **Data forlater aldri EU.** All lagring og prosessering i EU-datasenter, DPA, kryptering i transit og hvile, null trening på kundedata. Ingen amerikansk eller kinesisk myndighetstilgang.
- **Ingen vendor lock-in.** MIT-lisensierte vekter betyr at plattformen selv styrer prisutviklingen — ingen risiko for plutselig prishopp fra én leverandør.

## Hvorfor mulig nå
- **Modellkvalitet er ikke lenger et hinder.** GLM-5.2 og Kimi K2.7 ligger tett opp mot Claude Sonnet 5 / GPT-5.5 (SWE-bench Pro: GLM 62,1 % vs Sonnet 63,2 %).
- **Regulatorisk medvind.** EU AI Act og GDPR skaper reell etterspørsel etter leverandører som garanterer at data blir i EU.

## Arkitektur (høynivå)
1. **Modell-lag:** API-kall mot EU-hostede endepunkter (Scaleway, EUrouter) for GLM-5.2 og Kimi K2.7. Egen GPU-klynge først ved høyt, stabilt volum.
2. **Orkestrering / API:** Eget backend som ruter forespørsler til riktig modell, håndterer function calling, caching og logging — OpenAI-API-kompatibelt for enkel migrering.
3. **Grensesnitt:** Egenutviklet web-app (chat + integrasjoner) skreddersydd for norske/europeiske SMB-er. En base som kan brukes for alle veriasjoner. Customizable add-ons og design for hver enkelt kunde. 
4. **Datalag:** All lagring og prosessering i EU.

## Teknologistack
- **Backend:** Go
- **Frontend:** React + TypeScript, bygget med Vite (ren SPA)

## Kunde- og brukermodell
- **Kunden er bedriften (tenant):** org.nr, avtale, fakturering, egen API-nøkkel og admin-rolle
  som ser forbruk og grenser for hele bedriften.
- **Brukerne er ansatte** under tenanten: egen innlogging, egne samtaler; forbruk logges per
  bruker og aggregeres per tenant (`tenant_id` + `user_id` på alt fra dag én).
- **Prismodell:** fastpris per bruker/mnd; vår interne kostkontroll (modellruting) sikrer margin.

## Per-kunde-tilpasning (skall-modellen)
- **Backend eier all logikk og konfigurasjon:** modellruting, websøk, system-prompt, usage —
  og tenant-config med design-tokens (farger, logo, font, radius) + feature-flags for add-ons.
  Serveres via `/v1/tenant/config`.
- **Frontend er ett felles skall:** én kodebase som henter tenant-config ved oppstart og
  anvender design-tokens som CSS-variabler runtime. Kundetilpasset stil = data, ikke kode.
- **Add-ons** (f.eks. integrasjoner, egne widgets) slås på per tenant via feature-flags —
  aldri egne frontend-forks.

## Målgruppe
Bedrifter som vil ta i bruk AI-verktøy, men nøler på pris eller datasikkerhet. Særlig norske/nordiske SMB-er der GDPR og forutsigbar kostnad veier tungt.

## Differensiering mot OpenAI/Anthropic
- Pris: 30–70 % billigere.
- Juridisk garanti: data forlater aldri EU.
- Ingen "plutselig prisøkning"-risiko — MIT-lisens gir uavhengighet.
- Norske/nordiske integrasjoner (Business Central, Vipps, BankID) som globale aktører ikke prioriterer.


## Åpne spørsmål
- Betalingsvillighet: bytter bedrifter faktisk plattform for lavere pris, eller vinner tillit til etablert merkevare?
- Marginene i ren wrapper-modell er tynne — verdien må komme fra grensesnitt og integrasjoner.
- Manglende SOC2 hos EU-hostere kan bremse salg mot større kunder.
- Incumbents (Microsoft) kan matche prisen raskt.


## Neste steg
2. Bygg MVP: OpenAI-kompatibelt API-lag + enkelt chat-UI mot GLM-5.2/Kimi via EUrouter.
2. Test modellene. Hvor gode er de? Er det brukbart? Hva bruker vi for trivielle spørsmål, hva bruker vi for tyngre analyser? Håndterer modellen tunge analyser?
3. Test reell kostnad og ytelse på en konkret arbeidsbelastning.


