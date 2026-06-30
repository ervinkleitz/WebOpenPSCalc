# Open PS Calc — web port

This is a web migration of [StatGameDev/Open_PS_Calc](https://github.com/StatGameDev/Open_PS_Calc),
a PySide6/Qt **desktop** damage calculator for pre-renewal Ragnarok Online
(targeting both vanilla pre-renewal servers and the Payon Stories private
server). The original's Python calculation engine (`core/`) was ported to
JavaScript by hand, file-for-file, rather than wrapped — see
**[`ROADMAP.md`](open-ps-calc-backend/backend/ROADMAP.md)** for the exact
port status of every file (fully ported / partially ported / not started).

- **`open-ps-calc-backend/backend/`** — Node/Express API hosting the ported
  calculation engine.
- **`open-ps-calc-frontend/frontend/`** — React (Vite) + TypeScript
  single-page app: build editor, equipment, target, skill selection, and the
  full step-by-step damage breakdown.

Game data (item/mob/skill databases, Payon Stories overrides) is bundled
with the backend as static JSON, sourced from the original repo's
`core/data/pre-re/` and `PayonStoriesData/` folders.

## What's different from the original

The original is a single-user desktop app with local save files and a
Qt GUI. This port is a stateless multi-user **web app**, which forced or
motivated several changes beyond a straight 1:1 port:

- **No accounts, no server-side storage.** The original saves builds to
  local `saves/*.json` files. This port has no database and no login.
  Build state is encoded into the URL's `?b=` query param (lz-string
  compressed; old uncompressed URLs are still decoded transparently), so
  sharing a build is just sharing its link. A **Save / Load** panel also
  stores named build snapshots in the browser's `localStorage` (up to a
  small cap), purely client-side.
- **TypeScript.** Backend entry points/routes and the entire frontend are
  TypeScript; the ported engine internals stay as `.js` (loaded via
  `allowJs`) to keep the line-for-line diff against the original Python
  legible.
- **Magic skill pipeline (BF_MAGIC) and Grand Cross (CR_GRANDCROSS)
  implemented**, including a Payon-Stories-specific deviation for Grand
  Cross (weapon masteries apply there, unlike vanilla) confirmed against
  [wiki.payonstories.com/Grand_Cross](https://wiki.payonstories.com/Grand_Cross).
- **Incoming (mob → player) damage pipeline** — not exposed in the
  original GUI's main flow at all the same way; this port adds
  `POST /api/calculate/incoming` for physical and magic damage taken,
  including the Lex Aeterna double-damage status.
- **Card slot UI** (up to 4 per item, filtered to `IT_CARD`), a **passive
  skill panel** (filtered to an explicit allowlist of masteries that
  actually affect damage — not every passive in a job's skill tree does),
  a **consumables panel** (ASPD potions, ATK/MATK items), and a **buffs
  panel** (quickens, Impositio Manus, Overthrust, Bard/Dancer songs) — none
  of these existed in the original web port's first pass; built
  incrementally by finding cases where the engine already supported the
  mechanic but no UI exposed it.
- **`TF_DOUBLE` (Double Attack) proc implemented** — the engine had
  placeholder result fields for it (`proc_chance`, `double_hit`) but the
  pipeline never actually computed them. Dagger-only, mutually exclusive
  with crit, proc rate read from the PS/vanilla profile tables.
- **PS Assassin/Thief rework** — Three Payon Stories custom behaviours
  added behind mechanic flags: (1) katar second hit (`AS_KATAR_SECOND_HIT`)
  — auto-attack with a Katar procs a second hit at twice the normal
  `TF_DOUBLE` rate, dealing `(21 + 4 × AS_KATAR_lv)%` of the main hit;
  shown as a separate branch in the damage breakdown. (2) Enchant Poison
  passive bonus (`AS_ENCHANTPOISON_PASSIVE_BONUS`) — each Enchant Poison
  skill level adds 2% damage against Poison-element targets. (3) Envenom
  weapon element (`TF_POISON_USES_WEAPON_ELEMENT`) — Envenom's attack
  element follows the weapon's element rather than always being Poison.
- **ASPD potion policy** — The restricted-to-Concentration-Potion class
  list reflects PS's rebalance (Priest/High Priest, Bard/Dancer and their
  trans forms). Monk and Champion can use Awakening Potion; Whitesmith,
  Mastersmith, Creator, Biochemist, and the Thief/Rogue tree can use
  Berserk Potion.
- **Filled in larger chunks of `PAYON_STORIES`'s skill-ratio/mastery
  overrides** in `serverProfiles.js` than the original port carried over
  initially, pulled directly from the upstream Python source.
- **Human-readable skill names** in search (the engine constant names like
  `MG_FIREBALL` are resolved to display names like "Fire Ball").
- **Collapsible UI sections**, with the damage breakdown panel pinned and
  visually emphasized since it's the actual result the rest of the form
  exists to produce.
- **A lightweight `X-API-Key` gate** on the backend (see `DEPLOYMENT.md`)
  to deter casual direct API access — explicitly *not* real authentication,
  since the key ships in the public frontend bundle.
- **CI/CD**: a GitHub Actions pipeline (`.github/workflows/deploy.yml`)
  that typechecks/builds on every push and deploys to an EC2 instance
  (pm2 + nginx) on pushes to `main` — see `DEPLOYMENT.md`.

## Quick start

```bash
cd open-ps-calc-backend/backend && npm install && npm start    # http://localhost:4000
cd open-ps-calc-frontend/frontend && npm install && npm run dev # http://localhost:5173
```

The frontend dev server proxies `/api/*` to `http://localhost:4000`, so just
open `http://localhost:5173` once both are running. See
`open-ps-calc-backend/backend/README.md` and
`open-ps-calc-frontend/frontend/README.md` for more detail, and
`DEPLOYMENT.md` for deploying to EC2.

## What's accurate vs. what's a placeholder

This is a faithful, hand-checked port of the formula-heavy parts of the
original engine (stat resolution, item script parsing, gear bonus
aggregation, weapon damage pipeline, crit/hit chance, defense, element,
mastery, card bonuses, magic damage, Grand Cross, incoming damage). It is
**not** a 100% complete port — the original Python project is roughly
11,500 lines of calculation logic plus another 10,000 lines of Qt GUI.
Read **[`ROADMAP.md`](open-ps-calc-backend/backend/ROADMAP.md)** for the
full, current list of what's ported, what's simplified, and what still
returns a "not yet implemented" message instead of a wrong number.

Every calculation the API returns includes the full step-by-step breakdown
(the same kind of `DamageStep` data the original GUI showed, with the
Hercules source citation each step is based on), so any number can be
checked against the original Python tool's output for the same build.
