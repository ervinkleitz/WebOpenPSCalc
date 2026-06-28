# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/). This project
deploys continuously (no version numbers), so entries are grouped by date
instead of release version. Dates are taken from actual git commit history.

## 2026-06-27

### Fixed

- **Item scripts with quoted skill-name params (e.g. `bonus2
  bSkillAtk,"WZ_VERMILION",20`) silently lost the quotes and never
  matched anything**, since the lookup keys downstream (`WZ_VERMILION`)
  don't have quote characters. This is why Frozen Thunder's weapon
  (`tools.payonstories.com/pc?name=frozen+thunder`) skill bonuses to
  Lord of Vermilion/Frost Nova weren't applying — its script in
  `ps_item_manual.json` was correct, the parser just wasn't stripping
  the quotes. Also fixed a case-sensitivity bug in the same parser:
  `bCastRate` (capital R, used by several other item scripts) silently
  failed to match the canonical `bCastrate` key and was dropped
  entirely. Both are now resolved case-insensitively and with quotes
  stripped before lookup. Verified end-to-end: Lord of Vermilion DPS
  with Frozen Thunder equipped went from ~40 to ~74 (damage +20%, cast
  time -20%, compounding), where before this fix neither bonus applied
  at all.
- The BF_MAGIC skill-ATK gear bonus (`bSkillAtk` on staves/spellbooks
  for specific magic skills) was folded silently into the skill-ratio
  step instead of getting its own breakdown row, unlike the equivalent
  BF_WEAPON path. Added a separate "Skill ATK Bonus" step so it's
  visible in the damage breakdown.
- **Long checkbox labels in the Buffs panel overlapped neighboring grid
  cells.** Flex items default to a min-width equal to their content's
  max-content size, so text like "Impositio Manus" never wrapped inside
  its grid column and instead rendered on top of whatever sat next to or
  below it. Fixed with `min-width: 0` on the flex item so the label can
  wrap inside its column. Per-buff source/mechanic detail that used to be
  crammed inline (or in a `title` attribute) now lives in an info-icon
  popover on each group heading instead.
- **Changelog edits weren't showing up in the in-app viewer without a
  manual dev-server restart.** Vite's dev-server file watcher only
  tracks files under this project's own root by default; `CHANGELOG.md`
  living two directories up (at the actual repo root) meant `fs.allow`
  granted read access but not watch coverage, so the `?raw` import kept
  serving whatever content existed when the server started. Added a
  small Vite plugin that explicitly watches the file and forces a full
  reload on change. Verified by appending a test marker to the file and
  confirming it appeared without restarting anything, then removed the
  marker.

### Changed

- Party buffs are now grouped by source class (Priest, Blacksmith, Sage)
  under their own subheadings, instead of one flat grid with a "(Source)"
  suffix on every label.

### Added

- Poem of Bragi (`BA_POEMBRAGI`, Bard/Clown) to the Bard/Dancer songs
  section. It reduces cast time and after-cast delay (`skillTiming.js`),
  not ASPD directly — so it only changes DPS when testing an actual
  skill, not a normal attack (normal-attack period is ASPD-only).
  Verified with MG_FIREBALL: period 2470ms→1429ms, DPS 153.8→265.9 at
  Bragi level 10.

### Changed

- Priest/Blacksmith party buffs (Impositio Manus, Blessing, Increase AGI,
  Gloria, Overthrust, Overthrust Max, Adrenaline Rush) switched from a
  numeric level input to a checkbox — checking it applies the buff's max
  level, since these are received from a party member and you don't
  control the caster's actual level anyway. Sage's ground effect dropdown
  now applies max level automatically on selection instead of a separate
  level input.

### Fixed

- **Volcano's UI cap and source label were wrong for Payon Stories.**
  The party buffs panel let Volcano go up to level 5 and labeled it
  "Mage/Wizard" — but its real constant is `SA_VOLCANO` (Sage, not
  Wizard; confirmed by `skill_tree.json`: jobs 16/4017, Sage/Professor),
  and PS caps it at level 3, not vanilla's 5 — confirmed against
  [wiki.payonstories.com/Sage#Skills](https://wiki.payonstories.com/Sage#Skills)
  (and the individual /Volcano, /Deluge, /Violent_Gale pages — all three
  show per-level tables stopping at 3 despite a "Levels: 5 (Fixed)" label
  that's almost certainly inherited from vanilla's `max_level` field, not
  the real PS-tuned cap) and independently corroborated by
  `PS_VOL_MATK_PCT` and `PS_ENCHANT_EFF` both already being 3-element
  arrays in the engine. The cap is now server-aware (3 on Payon Stories,
  5 on standard pre-renewal) instead of one wrong hardcoded number for both.
- **`attrFix.js`'s Volcano/Deluge/Violent Gale elemental "enchant" bonus
  was checking the wrong element entirely** — its local `ELE_FIRE`/
  `ELE_WATER`/`ELE_WIND` constants (4/5/6) didn't match this engine's
  actual element index convention used everywhere else (`Ele_Water: 1,
  Ele_Fire: 3, Ele_Wind: 4` — see `ELE_STR_TO_INT` in `battlePipeline.js`).
  In practice this meant the bonus silently required a Poison weapon for
  Deluge, a Holy weapon for Violent Gale, and a Wind weapon for Volcano,
  instead of Water/Wind/Fire respectively. Found by testing the new
  ground-effect UI end-to-end with a real matching weapon and getting no
  bonus; fixed the constants and verified all three now match correctly.

### Added

- Deluge and Violent Gale added alongside Volcano as a single "Ground
  effect" dropdown (Sage) — all three share one mutually-exclusive
  `support_buffs.ground_effect` slot in the engine (you can only stand in
  one ground spell at a time), so they're now one shared control instead
  of a Volcano-only number input. Both are damage-relevant via the same
  elemental enchant bonus as Volcano (see the `attrFix.js` fix above).
- Min/max damage range shown under the avg damage metric in the damage
  breakdown. The backend already computed `min_damage`/`max_damage` on
  every `DamageResult` (normal and crit); the frontend type/render just
  never surfaced them.
- Three more Priest party buffs: Blessing (+STR/+INT/+DEX), Increase AGI
  (+2+level AGI), and Gloria (+30 LUK) — reported missing after shipping
  the initial Party buffs section; all three were already read from
  `support_buffs` by `statusCalculator.js`, just not exposed yet.

## 2026-06-21

### Added

- **Party buffs section** in the Buffs panel, distinct from self-cast
  buffs: Impositio Manus (Priest), Overthrust/Overthrust Max/Adrenaline
  Rush (Blacksmith), Volcano (Mage/Wizard ground spell), and a weapon
  endow dropdown (Priest: Aspersio/Endow Fire/Water/Wind/Ground). Unlike
  self buffs, none of these are filtered by your own job — any class can
  be standing in another player's buff range. Verified the engine treats
  party-received Overthrust differently from self-cast Overthrust (flat
  +5% vs full per-level scaling — battle.c's actual distinction, not an
  approximation), and that Volcano/weapon endow both move the calculation
  correctly.
- In-app changelog viewer (this document, rendered from a modal in the
  header).

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

## 2026-06-20

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

### Fixed

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
