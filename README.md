# Nordavind — frontend

Chat-grensesnitt for testing av EU-hostede open-weight-modeller (GLM, Kimi) via et OpenAI-kompatibelt API.

## Oppsett

```sh
cp .env.example .env.local   # fyll inn endepunkt og nøkkel
npm install
npm run dev                  # http://localhost:5173
```

## Struktur

```
src/
  app/                App-skall og entry point
  features/chat/      Chatvindu med streaming
  features/settings/  Settings (General, Usage, Connectors)
  layout/             Sidebar (⌘B, ⌘N, ⌘,)
  lib/                API-klient (SSE-streaming)
  mock/               Mock-data for Usage-grafene
  styles/             Design-tokens og delte primitiver
  ui/                 Ikoner
```

Stack: React + TypeScript + Vite. Backend ligger i eget repo.
