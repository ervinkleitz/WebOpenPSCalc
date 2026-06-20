# Open PS Calc — backend

Node/Express API. The damage-calculation engine lives in `src/engine/` and
is a hand-written JavaScript port of the original
[Open_PS_Calc](https://github.com/StatGameDev/Open_PS_Calc) Python `core/`
package — see `ROADMAP.md` for exactly what's ported vs. deferred, file by
file.

Stateless: no database, no accounts. `POST /api/calculate` takes a full
build payload and returns a damage result; the frontend persists builds by
encoding them into a URL, not by saving anything server-side.

## Setup

```bash
npm install
npm start          # tsx src/server.ts — listens on http://localhost:4000 (set PORT to change)
npm run dev        # same, with file-watch auto-restart
```

Copy `.env.example` to `.env` if you want the `X-API-Key` gate enabled:

```bash
cp .env.example .env
# edit .env, set API_KEY=something-long-and-random
```

Leaving `API_KEY` unset disables the gate entirely (every request passes) —
that's intentional for local dev. See the repo-root `DEPLOYMENT.md` for what
this gate actually protects against (short version: casual direct API
hits, not a determined attacker — the matching key ships in the public
frontend bundle).

## API summary

- `GET /api/health` — liveness check, always open (bypasses the API key gate)
- `GET /api/data/items?type=IT_WEAPON&q=knife&server=payon_stories&loc=EQP_SHIELD`
- `GET /api/data/items/:id?server=payon_stories`
- `GET /api/data/mobs?q=poring`
- `GET /api/data/mobs/:id`
- `GET /api/data/skills?q=bash` — includes a `display_name` field (human
  name, PS-aware) alongside the raw engine constant
- `GET /api/data/skills/:id`
- `GET /api/data/jobs` — `{ id, name }[]` for every job class
- `GET /api/data/jobs/:id` — full job table entry (ASPD base, stat bonuses, etc.)
- `GET /api/data/skill-tree/:jobId` — damage-relevant passive skills for a job
  (filtered allowlist, not every passive in the job's tree — see
  `dataLoader.js#getPassiveSkillsForJob`)
- `POST /api/calculate` `{ build, skill: {id, level}, target: {mob_id} | {def_, vit, ...} }`
  → resolved status/weapon/target plus the full `BattleResult` (steps included)
- `POST /api/calculate/incoming` `{ build, target: {mob_id}, direction: "physical"|"magic", opts? }`
  → damage taken from a mob, same step-breakdown shape

`build` in `POST /api/calculate*` uses the same save-schema shape the
original Python GUI wrote to its `saves/*.json` files (`base_stats`,
`bonus_stats`, `equipped`, `refine`, `mastery_levels`, `consumable_buffs`,
etc.) — see `src/engine/buildManager.js` for the exact fields.

## Engine layout

- `src/engine/dataLoader.js` — item/mob/skill/table lookups, with a Payon
  Stories data layer on top of vanilla pre-renewal Hercules data
- `src/engine/serverProfiles.js` — `STANDARD` (vanilla) vs `PAYON_STORIES`
  deviation tables (skill ratios, mechanic flags, mastery overrides)
- `src/engine/calculators/battlePipeline.js` — normal attacks, BF_WEAPON
  skills, BF_MAGIC skills, and CR_GRANDCROSS
- `src/engine/calculators/incomingPipeline.js` — mob → player damage
- everything else under `src/engine/calculators/modifiers/` is one pipeline
  step each (defense, element, card bonuses, mastery, crit, etc.)
