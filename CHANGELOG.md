# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/). This project
deploys continuously (no version numbers), so entries are grouped by date
instead of release version. Dates are taken from actual git commit history.

## 2026-06-27

### Added

- **Job-level stat bonus now shown next to base stats**, RO-status-window
  style: each stat is a card with the total (base + job bonus) in bold
  and the editable base value plus a small "+N" badge for the job
  bonus underneath. This bonus (e.g. a Knight's automatic STR/VIT
  growth per job level) was already folded into the damage calculation
  server-side, just invisibly — added a `/data/job-bonus-stats` route
  so the build editor can show it instead of it only ever showing up
  in the final numbers. Verified against `statusCalculator.js`: Knight
  at job level 50 shows the same +8 STR/+2 AGI/+10 VIT/+6 DEX/+4 LUK
  the backend was already computing.

### Changed

- **Capped stat/level inputs to what pre-renewal actually allows**:
  base stats to 99 (was 130), base level to 99 (already correct,
  confirmed against wiki.payonstories.com's level-99 leveling guides),
  and job level to a per-job cap derived from `job_db.json`'s job list
  — 10 for Novice, 50 for 1st/regular 2nd job, 70 for trans 2nd job
  (Lord Knight, High Wizard, etc.), 99 for Super Novice (confirmed:
  "Super Novices also have a Job Level of 99" on the wiki). Gunslinger
  and Ninja are set to 70 rather than classic kRO's 60, since the wiki
  references planning around "JobLv70 gunslinger" — this PS instance
  appears to have retuned them to the trans cap. Switching jobs now
  clamps the current job level down if it exceeds the new job's cap.

### Added

- **Enchant Poison and Cursed Water (Shadow) to the weapon endow
  dropdown.** Enchant Poison (`AS_ENCHANTPOISON`/`SC_ENCHANTPOISON`)
  and Cursed Water (item → `ITEM_ENCHANTARMS` skill level 8 → Dark
  element, per `item_db.json` #12020) were already handled by the
  engine's element-resolution logic in `buildApplicator.js`, but
  Enchant Poison only checked `active_status_levels` (which the UI
  never wrote to) and Cursed Water/`SC_ENCHANTARMS` had no handling at
  all. Both now route through the same `weapon_endow_sc` dropdown field
  as the existing Priest endows. Verified: Cursed Water vs. a
  Holy-element target gives the expected Dark-vs-Holy 125% Attr Fix,
  and Enchant Poison vs. an Earth-element target gives the expected
  Poison-vs-Earth 125%.
- **"Start over" button** to start a fresh build without manually
  clearing every field — resets the form, target, and skill back to
  defaults (with a confirmation prompt, since it's not undoable once
  the URL state is overwritten).
- **Saved builds in localStorage** ("Save / Load"), up to 10, each with
  a custom name. Save the build currently open (saving under an
  existing name overwrites that slot instead of using a new one),
  load any saved build back into the editor, or delete one. This is
  separate from the existing URL-based share link — saved builds
  persist locally across sessions without needing to keep a link
  around, but don't sync between devices/browsers.

### Changed

- **Redesigned the header into a single compact top bar**, replacing
  the old two-header layout (a generic app-level topbar plus a
  separate per-page header with the build name and actions as an H1).
  The build name is now an inline-editable field in the bar itself,
  and every action (Start over, Save / Load, Changelog, Copy share link,
  Calculate damage) lives in one sticky row — freeing up significant
  vertical space for the actual calculator panels below.
- **Moved "Calculate damage" into the top bar** (now sticky, so it's
  reachable while scrolled anywhere on the page) and **moved the
  damage breakdown out of an always-present inline panel and into a
  modal**, opened automatically when you calculate and reopenable via
  a "View results" button that appears once a result exists. Keeps
  the main column free for editing the build instead of permanently
  reserving space for a result you're not always looking at.

- **Double Bolt** (`PF_DOUBLECASTING`/`SC_DOUBLECASTING`) to the
  Professor self-buffs panel — confirmed against
  [wiki.payonstories.com/Double_Bolt](https://wiki.payonstories.com/Double_Bolt):
  100% chance to instantly re-cast Fire Bolt, Cold Bolt, Lightning
  Bolt, Earth Spike, or Soul Strike while active. Only Professor
  (job 4017) has this in its skill tree — base Sage (16) doesn't, despite
  the wiki documenting it on the general "Sage" overview page (that page
  covers the whole Sage→Professor line, not just what base Sage can
  cast). No existing mechanic models "instant extra cast," so it's
  implemented as halving the effective attack period for the five
  affected skills (DPS only — the per-hit damage number is unchanged,
  since the bonus is an extra free cast, not a stronger one). Verified:
  Fire Bolt DPS exactly doubles with it active; an unaffected skill
  (Napalm Beat) is untouched.
- **Frost Diver and Fire Wall to the Wizard passive-skills panel.**
  Both feed a damage multiplier into a *different* skill rather than
  attacking on their own — confirmed against
  [wiki.payonstories.com/Frost_Nova](https://wiki.payonstories.com/Frost_Nova)
  ("+10% MATK to Frost Nova per rank of Frost Diver") and
  [wiki.payonstories.com/Fire_Pillar](https://wiki.payonstories.com/Fire_Pillar)
  ("+2% MATK per hit per rank of Fire Wall"). The engine's PS magic-ratio
  formulas for `WZ_FROSTNOVA`/`WZ_FIREPILLAR` already implemented this
  scaling correctly, but read it from a `skill_params` field the build
  editor never exposed any input for, so it was silently always 0. Both
  skills are normally excluded from the passive panel (they're active,
  not passive, skills), so they needed an explicit carve-out in
  `dataLoader.js#getPassiveSkillsForJob`; the ratio formulas now read
  the level from `mastery_levels` like every other passive. Verified:
  Frost Nova Lv5 goes from 250%→350% MATK and Fire Pillar Lv5 from
  840%→1080% MATK at Frost Diver/Fire Wall level 10, matching the wiki's
  worked examples exactly.

### Fixed

- **Living Magma Card's Fire-monster magic damage bonus did nothing.**
  Its script (`bonus2 bMagicAddEle,Ele_Fire,10`) used a bonus type the
  item-script parser didn't recognize at all, so it was silently
  dropped — confirmed against
  [wiki.payonstories.com/List_of_Custom_Items](https://wiki.payonstories.com/List_of_Custom_Items).
  `bMagicAddEle` keys off the *target's* element (like the already-working
  physical `bAddEle`/Mage Card), not the spell's attack element, so it
  needed its own gear-bonus field and its own check in
  `cardFix.js#calculateCardFixMagic` rather than reusing the existing
  `magicEleName` (attack element) plumbing. Verified: Fire Bolt vs. a
  Fire-element target now gets +10% with the card equipped and +0%
  against a Water-element target, as expected.
- While auditing other custom cards for the same class of bug, found
  Sidewinder Card's `bonus bDoubleRate,5` (a flat +5% double-attack
  chance, on top of the `skill TF_DOUBLE,2` it also grants) was parsed
  but had no consumer anywhere — flagged in this engine's own porting
  notes as a known gap. Wired it into the existing TF_DOUBLE proc-chance
  calculation in `battlePipeline.js` as an additive, weapon-unrestricted
  source (matching battle.c, since `bDoubleRate` isn't dagger-only like
  the TF_DOUBLE skill itself). Verified: equipping it on a non-dagger
  weapon now gives a 5% proc chance even though TF_DOUBLE itself
  requires a dagger.
- **Advanced Book (Sage/Professor) was capped and labeled wrong.** It
  showed up in the passive-skills panel as "Study" with a max level of
  10 — that's the vanilla pre-renewal data; PS retunes it to max level
  5 with its own non-linear +ATK/+ASPD table (confirmed against
  [wiki.payonstories.com/Advanced_Book](https://wiki.payonstories.com/Advanced_Book)),
  and renames it for display. `ps_skill_db.json` already had both the
  correct cap and name, but `dataLoader.js#getPassiveSkillsForJob`
  never consulted it — only `getSkillDisplayName` did. Also fixed the
  `/data/skill-tree/:jobId` route never applying the server profile
  from the `?server=` query param at all (it relied on whatever a
  previous, unrelated request happened to leave `loader`'s profile set
  to). Now reads the PS name/cap the same way every other skill does,
  and the ATK/ASPD-per-level table matches the wiki exactly (lv5:
  +30 ATK / +7% ASPD on Book weapons, not vanilla's level×3 / level×5%).
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
