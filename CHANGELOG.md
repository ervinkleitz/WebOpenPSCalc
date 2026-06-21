# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed

- **Buffs panel showed every buff regardless of class, and didn't filter
  when switching jobs.** Each buff/song is now tagged with the actual
  job IDs that can use it (derived from `skills.json`'s `status_change`
  field cross-referenced with `skill_tree.json`, not guessed), and the
  panel filters to the selected job. Also fixed a deeper correctness bug
  this exposed: hiding a buff from the UI on job change didn't clear its
  value from `active_buffs`/`song_state`, so a stale buff from a
  previously-selected job was still silently sent to the backend and
  applied to the calculation. Switching jobs now strips anything that no
  longer applies.
- Added two missing Gunslinger self-buffs: "Barrage" and "Run and Gun"
  (PS's display names for the vanilla `SC_GS_MADNESSCANCEL` /
  `SC_GS_ADJUSTMENT` statuses, which the engine already read but had no
  UI for, like every other buff in this panel).
- **Refine input no longer hidden for refineable headgears (and other
  slots).** The equipment panel decided whether to show a refine-level
  input per equipment *slot* (e.g. "headgear can never be refined"), but
  the real item data shows every slot type has a meaningful mix — 613 of
  839 headgears are actually refineable, while only 91 of 273 armor
  pieces are. The backend already read each item's own `refineable` flag
  correctly; this was a frontend-only bug. The input now checks the
  actual equipped item instead of a static per-slot guess.
- CI: `npm ci --omit=dev` on the EC2 box was skipping `tsx`, which is
  miscategorized as a `devDependency` despite being required at runtime
  (this project runs TypeScript directly via `tsx`, no compile step).
  Moved to `dependencies`.
- CI: rsync failed with "No such file or directory" deploying the
  frontend build if `EC2_DEPLOY_PATH`'s parent directories didn't already
  exist on the box. The pipeline now creates them itself before syncing.
- CI: a fresh TypeScript install in CI hard-errored on the deprecated
  `moduleResolution: "node"` setting instead of just warning (newer
  TypeScript than what's pinned locally). Silenced via
  `ignoreDeprecations` rather than switching resolution strategy.
- nginx returned 500/Permission denied serving the frontend even though
  every directory's own permissions looked correct — Ubuntu's default
  home directory permissions (`750`) block `www-data` from traversing
  into it at all. Fixed in `setup-ec2.sh` going forward.
- Equipment search returned every item of a given type regardless of
  slot (e.g. shoes appearing in the headgear search); `left_hand`
  excluded shields entirely. Search is now filtered by the item's actual
  `loc` field per slot, and `left_hand` searches both shields and
  off-hand weapons.
- `buildManager.js`'s `playerBuildToTarget` set the player's own race to
  `"DemiHuman"` while every race lookup table elsewhere in the engine
  uses the hyphenated `"Demi-Human"` — found while wiring up the incoming
  damage pipeline, which is the first consumer of that function.
- Skill search/dropdown showed the internal engine constant (e.g.
  `MG_FIREBALL`) instead of a human-readable name. Backend now resolves
  a `display_name` (PS-aware) for every skill.

### Added

- **Double Attack (`TF_DOUBLE`) proc.** The engine had placeholder result
  fields (`proc_chance`, `double_hit`) that were never actually computed.
  Implemented per battle.c:4926 — dagger-only, normal attacks only,
  mutually exclusive with crit, proc rate from the PS/vanilla profile.
- **Buffs panel** — quickens (Two/One-Hand, Spear), Adrenaline Rush,
  Maximize Power, Fury, Overthrust/Overthrust Max, Impositio Manus, and
  Bard/Dancer songs (Battle Theme, Ring of Nibelungen, Assassin Cross of
  Sunset, Humming, Fortune's Kiss) — all fields the engine already read
  but had no UI for.
- Consumables panel (ASPD potions, ATK/MATK items), passive skill panel
  (filtered to masteries that actually affect damage), and card slot UI
  (up to 4 per item) — same pattern: engine support existed, UI didn't.
- Grand Cross (`CR_GRANDCROSS`) damage formula, including a Payon Stories
  deviation (weapon masteries apply there, unlike vanilla) confirmed
  against wiki.payonstories.com/Grand_Cross.
- Magic skill (BF_MAGIC) damage pipeline.
- Incoming (mob → player) damage pipeline, physical and magic, including
  the Lex Aeterna double-damage status — `POST /api/calculate/incoming`.
- Filled out `PAYON_STORIES`'s weapon/magic skill-ratio override tables
  and several `mechanic_flags`, pulled directly from the upstream Python
  source.
- Collapsible UI sections; the damage breakdown panel is pinned and
  visually emphasized as the actual result of the form.
- Info tooltip in the header describing the calculator, linking to the
  original repo and this one.
- CI/CD pipeline (GitHub Actions) deploying to EC2 via pm2 + nginx, with
  an `X-API-Key` gate (not real auth — a deterrent against casual direct
  API hits, documented as such) and free HTTPS via Let's Encrypt +
  sslip.io (no domain required).
- TypeScript migration (frontend + backend entry points/routes); removed
  account/login system in favor of stateless URL-encoded build sharing.
