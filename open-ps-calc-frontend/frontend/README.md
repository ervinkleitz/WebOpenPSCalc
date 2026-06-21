# Open PS Calc — frontend

React + Vite + TypeScript single-page app. No accounts, no login — a build
is just state encoded into the URL (`?b=...`), so "sharing a build" is
copying the address bar.

## Setup

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api to http://localhost:4000
```

Start the backend first (see `../../open-ps-calc-backend/backend/README.md`).

If the backend has `API_KEY` set, copy `.env.example` to `.env` and set the
matching `VITE_API_KEY` — Vite inlines it into the build at compile time.
Without it, requests still go through fine as long as the backend's
`API_KEY` is also unset (the default for local dev).

## Production build

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

For a real deployment, point the built `dist/` at any static host and have
that host proxy `/api/*` to wherever the backend runs — see the repo-root
`DEPLOYMENT.md` for the nginx + pm2 + EC2 setup this project actually uses.

## Structure

- `src/api/client.ts` — fetch wrapper; attaches `X-API-Key` from
  `VITE_API_KEY` if set
- `src/pages/BuildEditor.tsx` — the entire app: character/equipment/passive
  skills/consumables/buffs/skill/target panels plus the damage breakdown
- `src/components/Panel.tsx` — collapsible section wrapper used for every
  panel in the editor; the damage-breakdown panel sets `collapsible={false}
  highlight` to stay pinned and visually distinct as the actual result
- `src/components/SearchPicker.tsx` — generic search-as-you-type combo box
  used for equipment, cards, monster, and skill search
- `src/components/DamageSummary.tsx` — headline metrics + step-by-step
  breakdown, mirroring the original GUI's step list

See the repo-root `ROADMAP.md` for what GUI sections from the original
desktop app (buffs, full combat controls, build-vs-build comparison) aren't
built yet.
