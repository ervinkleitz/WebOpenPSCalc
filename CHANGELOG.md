# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/). This project
deploys continuously (no version numbers), so entries are grouped by date
instead of release version. Dates are taken from actual git commit history.

## 2026-07-05

### Added

- **Hits to kill & time to kill** — the damage summary now shows, against a selected monster, the
  **hits to kill** (min / avg / max, from the max / avg / min damage rolls vs the mob's HP) and the
  **average time to kill** (HP ÷ estimated DPS, so it folds in ASPD, crit mix and procs — cast +
  after-cast delay for skills). Monster mode only (needs the mob's HP); uses the combined total for
  dual-wield.
- **"Flee 95%" in the monster stats** — the monster stat grid now includes the FLEE needed to dodge
  the selected mob 95% of the time (`mob level + DEX + 75`, since incoming hit% floors at 5%).
  Soft-flee only — Perfect Dodge and the multi-mob FLEE penalty are noted in the tooltip.
- **Wildcard "Type" cards** — the weapon wildcard mix gains a fourth category, **Type**, for
  monster-family "Bane" cards (Orc / Goblin / Kobold / Golem-Bane, etc. — +30% physical damage to
  that family via `bAddRace2`). It applies as its own card-fix multiplier alongside Race / Size /
  Element and defaults to 30%. Since the mix is a "what card would I slot" simulator, it applies to
  the selected target (i.e. assumes a matching family card).

### Fixed

- **Investigate / def-ratio damage now keeps its range** — `MO_INVESTIGATE` and def-ratio
  (`bDefRatioAtk`) cards scale damage by the target's *soft DEF*, which is random over a range on
  high-VIT targets. The Defense Fix step was folding that into a single average factor, collapsing
  the damage to one number; it now applies the full soft-DEF variance so the result shows a real
  min–max (e.g. Investigate vs a VIT 100 target now reads 5805–6870 instead of a flat ~6337).
  Targets with no soft-DEF variance (low VIT) still resolve to a single value, so normal attacks
  are unchanged.
- **Demon Bane matches Payon Stories** — Demon Bane's ATK bonus now uses the PS-reworked values
  ([wiki.payonstories.com/Demon_Bane](https://wiki.payonstories.com/Demon_Bane)): `+5/lv` plus the
  `(1+BaseLv)/20` per-level base term → **+100 ATK at Lv10 / base 99** vs Undead-element or
  Demon-race (up from vanilla's +3/lv → 80), and it now also adds **+4/lv vs all other targets**.
  Fixes normal-attack and skill damage reading low for Acolyte-class builds vs Demon/Undead — e.g.
  a Monk vs Corruptor now matches in-game exactly (547, was 509). The vanilla formula's rounding
  was also corrected to match Hercules (floor the per-level multiplier).

- **ASPD %-bonus stacking** — ASPD-rate bonuses (Two-Hand/One-Hand/Spear Quicken, Adrenaline, etc.)
  and the flat ASPD-potion/`bAspdRate` bonus were applied as two separate multiplicative steps
  (each floored), which undershot the real value — e.g. +30% Quicken and a +20% potion gave
  ×0.70×0.80 = ×0.56 instead of the correct additive ×0.50. They're now summed into a single rate
  and applied once, matching pre-renewal behavior (fixes ASPD reading a couple of points low on
  buffed builds).

## 2026-07-04

### Added

- **Link preview / embed tags** — the page now has a descriptive title and Open Graph / Twitter
  card meta tags, so sharing the URL (Discord, Twitter/X, etc.) shows a real title and description
  instead of a bare link.
- **Favicons & app icons** — added a proper favicon (SVG + 16/32 PNG + .ico fallback), an
  iOS/Android home-screen icon and web manifest, and a logo image on the link embed. The
  top-left brand mark now shows the app logo instead of a placeholder glyph.
- **Manual stat bonuses** — a new section in the Base stats panel with STR/AGI/VIT/INT/DEX/LUK
  inputs for flat additions on top of allocated stats (for any source the calculator doesn't
  otherwise model). They fold into each stat's bold total (shown as a dim `+N` chip) and into the
  damage calculation; negative values are allowed. Backed by the build's existing `bonus_stats`
  field, which was already applied server-side but had no UI.
- **Monster stats in the target panel** — selecting a monster now shows a compact stat grid
  (HP, Race, Element + level, Size, DEF, MDEF, ATK range, and STR/AGI/VIT/INT/DEX/LUK) beneath the
  name, plus a "· Boss" tag for boss-protocol monsters. Data comes from the existing mob endpoint.
- **Max all / Reset passives** — the Passive skills panel gets "Max all" and "Reset" buttons that
  set every listed passive to its max level (or 0) in one click.
- **Two more Bard songs** — "A Whistle" (+Flee / Perfect Dodge) and "The Apple of Idun" (+Max HP)
  added to the Bard / Dancer songs list. Both are already modeled in the status calculator, so they
  show up in the combat-stat readout (they're defensive/utility — they don't change outgoing damage).
- **Auto Berserk (self buff)** — Swordman-line jobs (Swordman / Knight / Crusader / Lord Knight /
  Paladin) get an "Auto Berserk" toggle under Buffs → Self buffs. It models the self-cast Provoke
  Lv10 the skill grants while HP < 25%: +32% base ATK (2 + 3×lv) and −55% self-DEF (5 + 5×lv).
- **Provoke (target debuff)** — a selectable Lv 1–10 Provoke in the target debuff panel, reducing
  the target's DEF by `5 + 5×lv`% (−55% at Lv 10; scales both hard and soft DEF). No effect on Boss
  monsters. Kept on a separate status key/object from the player's Auto Berserk, so the two never
  interfere — turning on Auto Berserk only affects the player's ATK, and target Provoke only
  affects the target.

### Changed

- **Signum Crucis reworked for Payon Stories** — the target debuff now applies the PS values
  from `ps_skill_db.json`: a **hard-DEF-only** reduction of `10 + 4×lv` (**−50% at Lv10**),
  replacing the previous flat −35% that also (incorrectly) scaled soft DEF. It now correctly
  affects **Undead-element or Demon-race** targets (Undead is an element — Demon monsters of any
  element now qualify), and it stacks with Provoke.

### Fixed

- **Quagmire no longer auto-hits** — Quagmire was wrongly grouped with Freeze/Stone/Stun/Sleep in
  `hitChance.js` and forced a 100% hit. It actually only cuts the target's AGI/DEX by 10% per level
  (max 50% at Lv 5), lowering flee — hit is now computed normally. Bosses are immune (move-speed
  only) and the effect is halved vs players. The target-debuff toggle is now a **selectable Lv 1–5**
  (with a max option) instead of a plain checkbox; older shared links with the boolean form map to
  max.

- **Wildcard mix dropped after weapon switch** — the wildcard rows follow the equipped weapon's
  live card-slot count (`item.slots`, loaded asynchronously), but the damage calc aggregated over
  the stored `wildcard_slots` array, which drifts after switching weapons. Switching to a weapon
  with more slots (or toggling wildcard before the new weapon's data finished loading) left extra
  rows showing unsaved default bonuses that never reached the pipeline; switching to fewer slots
  kept applying stale rows. The aggregation now iterates the weapon's actual slot count using the
  same fallback default the UI renders, so the pipeline applies exactly what's shown.

## 2026-07-03

### Added

- **Payon Stories links** — Discord and PS Website links in the footer.
- **Ko-fi support button** — donation link in the topbar, below the damage results, and in the footer; proceeds go toward hosting costs.
- **Wildcard card mix** — weapon slots with card sockets now have a "Cards / Wildcard mix" toggle.
  In wildcard mode the card pickers are replaced by per-slot rows where each card position is set
  to a generic bonus type (Race / Size / Element) and a bonus %. Size is hardcoded to 15% + 5 ATK;
  Race and Element default to 20% with 4 / 10 / 15 / 20 options for PS custom cards. Bonuses
  always apply to all races/sizes/elements (RC_All, Size_All, Ele_All) and are merged into the
  engine's gear-bonus dictionaries alongside real cards.
- **Equipment slot browse list** — clicking an empty equipment slot input now shows up to 100
  items equippable by the current job (filtered server-side via `?job=` parameter), ensuring
  PS-exclusive high-ID items such as Setting Dirk appear in the initial dropdown. Typed searches
  still show all matching items (equippable first, non-equippable dimmed) with a limit of 20.
- **Visual pipeline damage breakdown** — the damage step list is redesigned as a proper pipeline:
  - Informational sub-components (Status BATK, Weapon ATK, Branch label) are shown as compact
    chips above the pipeline rather than inline rows.
  - Each calculation step is a row with a **dot-leader** connecting name to value, making it
    immediately clear which damage number belongs to which step even when the panel is narrow.
  - Between steps, a compact connector shows the **operation** applied: `× N.NN (+N%)` for
    multipliers, `+ N` / `− N` for flat additions/reductions, or `→` for pass-through steps.
    The connector also shows the step's note (e.g. `size: Medium`, `bMatkRate +15%`). Operation
    badges are colour-coded: green for boosts, muted for reductions, red for damage penalties.
  - **Final Damage** row is separated by a border and accented (no dot leaders — the visual
    distinction is sufficient).
  - Step values show `min–max` when the damage distribution has a non-trivial range.

### Changed

- **Responsive topbar** — three-tier layout covers all common device sizes: phones (≤600 px) show only brand mark, theme toggle, hamburger, and Calculate, with server select and all actions in the dropdown; tablets and small desktops (601–1279 px) keep the server select inline and put secondary actions in a side panel dropdown; wide desktop (≥1280 px) shows everything inline. Brand title and info tooltip hidden on phones to prevent overflow.
- **Stats chart hover tooltip** — hovering a day column shows a styled tooltip with the date, exact views count, and exact calcs count. Bar series are visually more distinct (wider bars, larger gap, column highlight on hover).
- **Skill search only shows damage skills** — the skill picker in Panel 07 now filters to skills with `attack_type` of `Weapon` or `Magic`, hiding passives (Sword Mastery, Endure, etc.) and non-damaging utility skills.

### Fixed

- **Permanent page view history** — a `consolidate.js` script reads all nginx access logs (including rotated `.gz` files) and writes page view events into `stats.ndjson`, so history is preserved beyond log rotation. Runs automatically on every deploy for fast incremental updates; a daily 2 AM cron keeps it current between deploys. The stats route now reads archived views from NDJSON and live views from nginx, splitting at the consolidation cursor to avoid double-counting.
- **Calculate events not being saved** — `data-store/` directory might not exist on first deploy, causing `fs.appendFile` to fail silently with ENOENT so every calculate event was dropped. `statsLogger` now creates the directory at module load time.
- **nginx routing** — replaced the broad `/stats/` prefix location block with exact-match blocks for `/stats/ping` and `/stats/data` so the SPA page at `/stats` is no longer intercepted and proxied to the backend.
- **Deploy cron setup** — `grep -v` in the crontab update pipeline exits 1 when no non-matching lines exist (crontab only contains the one entry), causing the deploy script to abort under `set -euo pipefail`. Added `|| true` to suppress the false failure.
- **Dual-wield damage pipeline uses new style** — the RH and LH step lists in the PS Assassin
  dual-wield breakdown now render with `PipelineView` (chip inputs + connector arrows) instead of
  the old flat step-list rows.
- **Wildcard bonuses no longer applied to empty slots** — stale `wildcard_slots` data in the URL
  could activate wildcard mode for a slot with no item equipped (e.g. `left_hand: null`), causing
  phantom race/size/element bonuses to be added to the calculation. Auto-activation and
  `onCalculate` now both guard against empty slots.
- **Pipeline Final Damage value alignment** — the Final Damage row had no dot-leader spacer, so
  its value hugged the label rather than aligning to the right edge. Added
  `justify-content: space-between` to `.pipeline-row--final`.
- **Pipeline left border rail removed** — `.pipeline-track` had a decorative `border-left` that
  made the layout feel cramped. Removed together with the compensating `margin-left`.
- **Quagmire auto-hit** — enabling Quagmire set the target's `flee` to 0, but `hitChance.js`
  uses `target.flee > 0 ? target.flee : target.level + target.agi` as a fallback, so auto-hit was
  never granted. Fixed by adding `SC_QUAGMIRE` to the auto-hit condition block alongside
  `SC_STONE / SC_FREEZE / SC_STUN / SC_SLEEP`.
- **Signum Crucis race restriction** — the Signum Crucis checkbox was previously not restricted to
  applicable targets. It is now disabled (opacity 0.4, not-allowed cursor) and auto-cleared in the
  frontend whenever the selected target is not Undead or Demon; the backend also race-guards the
  DEF reduction (`target.race === "Undead" || "Demon"`), so sending `signum_crucis: true` for an
  inapplicable race has no effect.
- **Body background-image gradient tiling at page bottom** — `html, body, #root` had
  `height: 100%` (exactly viewport height), causing the decorative radial-gradient
  `background-image` on `body` to tile into the overflow area when page content exceeded the
  viewport (visible as a mismatched coloured patch below the left column when the Target panel was
  expanded). Changed to `min-height: 100%` so the body grows with content and the gradients stay
  anchored at the actual document top and bottom.

## 2026-07-02

### Added

- **Target debuff system** — Panel 08 (Target) now has a "Target debuffs" section with:
  - *Element status* dropdown: Poisoned (→ Poison element), Frozen (→ Water element + halve hard
    DEF + auto-hit via `SC_FREEZE`), Stone Curse (→ Earth element + halve hard DEF + auto-hit via
    `SC_STONE`). Uses existing `defenseFix.js` / `hitChance.js` mechanic paths.
  - *Lex Aeterna* checkbox: applies ×2 to all damage branches (`normal`, `crit`, `magic`,
    `katar_second`, `double_hit`, `second_hit`, LH branches, proc branches) and to DPS.
    A "Lex Aeterna" step is appended to each branch's breakdown so the multiplier is visible.
  - *Quagmire* checkbox: sets `SC_QUAGMIRE` on the target → auto-hit (flee cannot be used to
    dodge). `hitChance.js` updated to return 100% hit for `SC_QUAGMIRE`, matching the same path
    used by `SC_STONE/SC_FREEZE/SC_STUN/SC_SLEEP`.
  - *Signum Crucis Lv10* checkbox: hard DEF −35% (`def_percent` reduced by 35 pp). Use vs
    Undead / Demon targets.
  - *Asleep* checkbox: `SC_SLEEP` on target → auto-hit and ×2 crit rate (existing paths in
    `hitChance.js` and `critChance.js`).
  - *Stunned* checkbox: `SC_STUN` on target → auto-hit (existing path in `hitChance.js`).
  - Debuff state (`TargetMods`) persisted in the URL `?b=` param alongside build/skill/target.

- **Snake Card** (4037) + **Cave Viper Card** (8001) combo — equipping both grants an additional
  +15% chance to inflict Poison on hit and +20 ATK. Combo entry added to `ps_item_combo_db.json`.

- **Cave Viper Card** (8001): Added +20% chance to inflict Poison on hit (`bAddEff,Eff_Poison`).
  The existing +10% damage to Poison-element targets is unchanged. The kill-drop mechanic (chance
  to drop Poison Arrows on killing Poison-element enemies) is not modelled in the damage calculator.

- **PS Bleeding revamp** — reworked bleeding status and affected gear/skills for Payon Stories:
  - **Mechanic** (`PS_BLEEDING_REVAMP`): Bleeding now deals 5% max HP every 0.5s for 2.5s (25%
    total), can kill, grants 35s immunity after expiry, and cannot be applied to targets ≥15 base
    levels higher than the attacker.
  - **Breeze Card** (4390): ATK bonus changed 5 → 8; Bleed on hit changed 5% → 2%.
    Combo with **Muka Card** now adds +6% Bleed on hit (combo entry added to
    `ps_item_combo_db.json`).
  - **Hakujin** (13014, 13015): Added 8% Bleed on hit.
  - **Huuma Giant Wheel Shuriken** (13301, 13302): Bleed on hit removed.
  - **Hatii Claw** (1815): Bleed on hit changed 2% → 5%.
  - **Skogul** (mob): Bleed chance on attack reduced 30% → 25% *(mob-side; not modelled in
    the outgoing-damage calculator)*.
  - **Killer Mantis** (mob): Bleed chance on attack increased 6% → 10% *(mob-side)*.
  - **Wounding Shot** (`GS_PIERCINGSHOT`): Base Bleed chance reduced 40% → 15%; consuming 1
    coin restores it to 40% *(skill-side; not modelled in the damage calculator)*.
  - **Acid Terror** (`AM_ACIDTERROR`): Bleed chance reduced 15% → 10% *(skill-side)*.

- **PS Sage rework** — damage-relevant changes from the Sage Rework publication are now modelled:
  - **Soul Strike** (`MG_SOULSTRIKE`): ignores 50% of hard MDEF when skill level 10 is learned
    (`MG_SOULSTRIKE_MDEF_IGNORE`); also deals `+5% × skill level` bonus damage against Undead
    race targets (`MG_SOULSTRIKE_UNDEAD_BONUS`), shown as a dedicated step in the breakdown.
  - **Fireball** (`MG_FIREBALL`): per-level MATK table `(70 + 30 × lv)`% — lv 1 = 70%, lv 10 =
    340%. Already stored as a PS ratio override `(lv) => 40 + 30 * lv`; confirmed correct against
    the published table.
  - **Earth Spike** (`WZ_EARTHSPIKE`): 140% MATK per hit × skill level (e.g. lv 5 = 700% total).
    Already stored as PS ratio override `() => 140`; confirmed correct.
  - **Heavens Drive** (`WZ_HEAVENDRIVE`): same 140% per hit formula. Already stored; confirmed.
  - **Advanced Book** (`SA_ADVANCEDBOOK`): flat ATK +10/15/20/25/30 and ASPD +3–7% at levels
    1–5 (no MATK% bonus). Already stored in `serverProfiles.js`; confirmed correct.
  - **Volcano / Deluge / Violent Gale** persistence buffs at max level 3: fire/water/wind
    +10/15/20% DMG, Volcano +10/20/30 ATK and +2/4/6% MATK, Violent Gale +3/8/15 Flee.
    Already stored and capped at level 3; confirmed correct.

## 2026-07-01

### Fixed

- **Dancer/Gypsy can now equip Whip weapons** — all Whip-type items in the item
  database were incorrectly restricted to job `[19, 4020]` (Bard/Clown). The
  source data relies on a `SEX_MALE` gender field to lock Musical Instruments to
  Bard/Clown, but Whips carry no gender restriction and therefore must use job
  `[20, 4021]` (Dancer/Gypsy). Fixed via a normalisation pass in `dataLoader.js`
  that remaps the job array for any item whose `weapon_type` is `"Whip"`.

### Added

- **PS Gunslinger rework** — changes from the Gunslinger Balancing Patch are now
  modelled:
  - **Triple Action** (`GS_TRIPLEACTION`): total damage 420% (3 hits × 140% each).
    PS formula `100 + 40 × SkillLv` at max level 1. Vanilla was 450%
    (100 + 50 × lv). Already stored as a PS ratio override; description
    updated to reflect the confirmed total.
  - **Ground Drift** (`GS_GROUNDDRIFT`): damage `200 + 60 × SkillLv`% (max 800%
    at level 10). Vanilla was `100 + 50 × SkillLv`%. Already stored as a PS
    ratio override; confirmed correct.
  - **Soul Bullet** (`GS_MAGICALBULLET`): damage `(50 + DEX + BaseLvl)`%. Already
    stored as a PS ratio override with a `ctx`-aware lambda. Confirmed correct.
  - **Heavy-Tipped Bullet** (item 13235): ATK 45 and `+10% damage to all races`
    (`bonus2 bAddRace,RC_All,10`) — already implemented in `ps_item_manual.json`
    via `RC_All` which fans out to `RC_Boss`/`RC_NonBoss`, covering every monster.
  - **Dust (`GS_DUST`) neutral resistance**: +7% resistance to Neutral element
    when mastered at level 10 (previously the description mentioned it but it was
    never wired into `PS_PASSIVE_RESISTS`). Now active for Shotgun and Grenade
    Launcher, matching the patch note and the existing Dust description.
  - **Full Buster / Spread Attack — Grenade Launcher support**: 7% Neutral
    resistance at max level now also triggers when using a Grenade Launcher
    weapon (previously Shotgun only). `weapon_types` updated to
    `["Shotgun", "Grenade"]` for both skills in `PS_PASSIVE_RESISTS`.

- **Select-all on number inputs** — clicking into any numeric input (base level,
  job level, base stats, refine level, passive skill levels, consumable ATK/MATK,
  song buff levels, skill level, custom target fields) now selects the existing
  value so it can be replaced immediately without manually clearing it first.

- **PS Rogue rework** (`Rogue_Patchnotes_PayonStories.pdf`) — the following
  damage-relevant changes are now modelled:
  - **Backstab formula**: changed from `300 + 40×lv`% (vanilla) to
    `200 + 30×lv`% (PS). The +40% multiplicative opportunity bonus (monster
    not targeting the Rogue / player not facing the Rogue in PvP) is exposed
    as a **Backstab opportunity** checkbox in the Skill panel; when checked,
    `_runBranch` applies ×1.4 after the skill ratio.
  - **Trick Arrow** (`PS_RG_TRICKARROW`): ratio corrected to 200% (2 hits ×
    100% ATK each; was incorrectly set to 100%).
  - **Raid** (`RG_RAID`): PS override `100 + 100×lv`% gives 600% at max level
    — already correct from a prior pass. Confirmed.
  - **Vulture's Eye bow Double Attack** (`RG_BOW_DOUBLE_ATTACK` mechanic flag):
    on PS, having both `TF_DOUBLE` (Double Attack) and `AC_VULTURE`
    (Vulture's Eye) with a bow equipped enables the Double Attack proc on
    auto-attacks. Proc rate = `doubleRate × min(TF_DOUBLE_lv, AC_VULTURE_lv)`.
  - **Yser Card** (ID 8236, footgear): now functional — adds +10% Backstab
    damage, +10% Raid damage, and +5 HIT via `bSkillAtk` bonuses. Description
    corrected (SP cost reduction −2, was −3).
  - **`bSkillAtk` in `_runBranch`**: the weapon skill branch now applies
    `gearBonuses.skill_atk` bonuses (same step that already existed in the
    magic and trap branches). This makes all `bonus2 bSkillAtk` card bonuses
    work for weapon-type skills going forward.

- **PS Knight rework** (`Payon Stories Knight Patch (1).pdf`) — the following
  changes are now modelled in the damage calculator:
  - **Sword Quickening CRIT**: +1% Critical Hit chance per skill level (was
    +0.8%/lv in vanilla). `SC_TWOHANDQUICKEN` reads `cri_per_lv: 10` from
    `PS_PASSIVE_OVERRIDES` (internal ×10 scale).
  - **Spear Stab max level 5**: Skill level is capped at 5 on PS via
    `skill_level_cap_overrides`. Damage ratio is `100 + 40 × lv`% (already
    in `PS_BF_WEAPON_RATIOS` from a prior pass).
  - **Blade Mastery covers 1H Sword**: Blade Mastery (`KN_TWOHANDMASTERY`,
    renamed on PS) now applies the 4 ATK-per-level bonus to 1H Sword weapons
    in addition to 2H Swords. Implemented via `mastery_prefer_fallback`:
    when a Knight has `KN_TWOHANDMASTERY` levels the engine routes 1H Sword
    mastery to it instead of vanilla Sword Mastery (`SM_SWORD`). Characters
    without `KN_TWOHANDMASTERY` (e.g. Swordman, Crusader) still use vanilla
    `SM_SWORD`.
  - **Counter Attack 200%**: Already implemented from a prior pass
    (`KN_AUTOCOUNTER: () => 200` in `PS_BF_WEAPON_RATIOS`). Confirmed correct.
  - **Sword Quickening 1H ASPD +10%**: Already implemented (`"1HSword": () =>
    100` in `PS_ASPD_BUFFS`). Confirmed correct.
  - **Spear Stab ratio 100+40×lv**: Already implemented in `PS_BF_WEAPON_RATIOS`.
    Confirmed correct.

- **Cards always proc toggle** — the damage breakdown panel now shows a
  "Cards always proc" checkbox when the current loadout contains cards with
  proc-based effects (e.g. Bonechewer Card). When checked, the calculator
  treats all `autobonus`-based card procs as permanently active and
  recalculates immediately. This shows what damage looks like if you're
  lucky enough to have the proc up all the time (or for planning purposes).
  The toggle disappears when no proc cards are slotted.
  - Backend: `gearBonusAggregator.compute()` now parses `autobonus` scripts
    and stores them in `gearBonuses.auto_bonuses`. When `build.flags.force_procs`
    is set, the inner bonus effects are applied as permanent bonuses. The
    calculate route returns `has_auto_bonuses: boolean` in its response.
  - Frontend: `forceProcs` state in `BuildEditor`, passed through
    `ResultsPanel` → `DamageSummary`. Toggle triggers an immediate
    recalculation with the new flag.

- **PS Wizard / High Wizard rework** (`Wizard_and_High_Wizard_Trans_Class_Changes.pdf`) —
  the following changes are now modelled:
  - **Frost Nova** (`WZ_FROSTNOVA`): PS rework formula `(175+15×lv) + 10×FrostDiverLv`%
    (190/205/220/235/250% base at levels 1–5, up to +100% with Frost Diver 10).
    Max level capped at 5.
  - **Lord of Vermillion** (`WZ_VERMILION`): 4 waves, each wave deals `20×lv×waveNum`%
    MATK. Total = `200×lv`% (2000% at level 10). Added to `PS_BF_MAGIC_RATIOS`.
  - **Napalm Vulcan** (`HW_NAPALMVULCAN`): element changed from Ghost to Shadow (Dark,
    element 7) via `skill_elements` override in the PS profile. 50% hard MDEF
    ignore added via the `HW_NAPALMVULCAN_MDEF_IGNORE` mechanic flag.
  - **Fire Pillar** (`WZ_FIREPILLAR`): 50% hard MDEF ignore added via the
    `WZ_FIREPILLAR_MDEF_IGNORE` mechanic flag. Max level capped at 5.
  - **Mystical Amplification** (`WZ_AMPLIFYMAGICPOWER` / `SC_AMPLIFYMAGICPOWER`):
    PS rework scales MATK boost per level — `min(lv,5)×10`% (10/20/30/40/50%).
    Vanilla remains flat 50% regardless of level. Max level capped at 5.
    Added to the buffs panel (Wizard / High Wizard).
  - **Sightrasher** (`WZ_SIGHTRASHER`): max level capped at 5. Formula already
    correct (`100+75×lv`% = 175/250/325/400/475%).
  - **Soul Drain** (`HW_SOULDRAIN`): passive +1% MaxHP per level (max +10% at
    level 10). Exposed as a passive skill slider; added to `DAMAGE_RELEVANT`
    and `ACTIVE_SKILL_TYPE_EXCEPTIONS` in `dataLoader.js`.
  - Reworks banner updated to include Wizard / High Wizard.

### Changed

- **PS Crusader rework** (`PSRO_Crusader_Rework_2026.pdf`) — the following
  changes are now modelled in the damage calculator:
  - **Spear Quicken**: No longer grants Critical Hit. Grants +1 Hit and +1
    Flee per skill level instead. *(Was already implemented from a prior pass;
    confirmed correct.)*
  - **Providence**: Self-cast MDEF buff grants +2 MDEF per skill level.
    *(Already implemented; confirmed correct.)*
  - **Reflect Shield**: PS rework formula — `floor(SoftDEF × (1 + 1.75 ×
    HardDEF/100) × SkillLvl/10)`, ignores target DEF, requires a hit roll,
    enhanced by cards and armor element. *(Already implemented; confirmed
    correct.)*
  - **Magnum Break — endow restricted to auto attacks** (`SM_MAGNUM_ENDOW_ATTACK_ONLY`
    mechanic flag): the fire semi-endow from Magnum Break no longer applies
    to skill damage on PS. When a weapon endow is active and any skill other
    than SM_MAGNUM itself is being calculated, the weapon element reverts to
    the weapon's natural element.
  - **Stone Discus**: Shield Boomerang damage bonus updated to 5% per refine
    level (was already 5% but also incorrectly included Shield Charge). Now
    only boosts Shield Boomerang.
  - **Stalactic Golem Card**: DEF +1 / Soft DEF +10 / +10 more if base VIT
    > 77. *(Was already implemented; confirmed correct.)*

- **Card search filtered by slot** — card pickers in the equipment section
  now only show cards that can compound into that slot type. Weapon slots
  show weapon cards, armor slots show armor cards, headgear slots show
  headgear cards, and so on. The left-hand slot shows weapon cards when a
  weapon is equipped there (dual-wield) and shield cards when a shield is
  equipped.

### Fixed

- **Venom Splasher (`AS_SPLASHER`) element modifier bug** — `IgnoreElement` was
  listed in the skill's `damage_type` but `nk_ignore_ele` was never set, so
  `calculateAttrFix` always ran in the weapon branch. Against non-neutral element
  targets this incorrectly multiplied the explosion damage by the element table
  modifier (e.g. a Fire-element weapon vs an Earth monster would wrongly apply
  a 50% penalty). Against neutral targets the numbers were unaffected (100×).
  Fixed by wiring `nk_ignore_ele` alongside `nk_ignore_def`/`nk_ignore_flee`
  in `calculate()` and skipping AttrFix in `_runBranch` when set. The breakdown
  now shows "BYPASSED — NK\_IGNORE\_ELEMENT" in the steps to make it explicit.

## 2026-06-30

### Added

- **PS Assassin dual-wield — combined damage PS buff** — the
  `DUAL_WIELD_PS_DAMAGE_BONUS` mechanic flag (Payon Stories only) applies a
  ×1.10 multiplier to the combined three-hit total (2×RH + LH) after mastery
  factors are applied. The headline damage range and DPS both reflect it; a
  "PS Dual-Wield Bonus ×1.10" row appears at the bottom of the step list in
  PS mode.

- **PS Monk rework — Triple Attack proc** — `MO_TRIPLEATTACK` now procs on
  auto-attacks for Monk/Champion on Payon Stories. Proc rates: 28/26/24/22/20 %
  at skill levels 1–5; Knuckle weapons gain +0.2 × skill level % per 10 job
  levels. When the **Fury** buff (SC_EXPLOSIONSPIRITS) is active, Triple Attack
  procs can crit. Skill level tracked via the passive panel; Fury toggled via
  Self Buffs.

- **PS Assassin rework — dual-wield three-hit model** *(beta)* — Assassin and
  Assassin Cross with a weapon in the off-hand now use a three-hit auto-attack
  model per swing: hit 1 = RH × `AS_RIGHT` factor, hit 2 = same roll as hit 1
  (× `AS_RIGHT` factor), hit 3 = LH × `AS_LEFT` factor. PS mastery factors:
  `AS_RIGHT` lv1–5 → 80/90/100/110/120 %; `AS_LEFT` lv1–5 → 60/70/80/90/100 %.
  Without mastery (lv 0), vanilla base penalties apply (RH 50 %, LH 30 %).
  Gated by the `DUAL_WIELD_PS_THREE_HIT` mechanic flag — remove from
  `serverProfiles.js` to revert to single-weapon calculation.

- **Damage panel — PS / Vanilla toggle** *(dual-wield builds only)* — a
  `[PS (3-hit) beta | Vanilla]` pill toggle appears in the damage results panel
  when an Assassin/Assassin Cross has an off-hand weapon equipped. **PS mode**
  shows the combined three-hit damage range (2×RH + LH with mastery factors)
  and the combined DPS; the step list expands into two labeled sections (hits 1
  & 2 = RH weapon, hit 3 = LH weapon). **Vanilla mode** shows the single
  right-hand weapon result and recomputes DPS without the off-hand contribution.

### Changed

- **Damage panel moved inline** — the damage breakdown is now rendered
  directly on the page (below the toolbar, above the editor grid) instead of
  a modal overlay. Clicking **Calculate** always scrolls the panel into view,
  even when it was already open from a previous calculation. A × close button
  dismisses the panel without losing the result.

- **Equipment search — auto-select on single result** — while typing in any
  equipment, card, or skill search field, if the results list narrows to
  exactly one selectable (non-disabled) item it is committed automatically
  without requiring Enter or a mouse click.

- **Equipment search — Tab selects closest match** — pressing Tab while a
  search dropdown is open now commits the keyboard-highlighted item if one is
  active, or the first non-disabled result otherwise, before moving focus.
  Previously Tab only acted when an item had already been keyboard-navigated to.

### Fixed

- **Refine level cap** — refine input now enforces a maximum of +10
  (pre-renewal cap), both via the input's `max` attribute and a clamped
  `onChange` handler so typed values above +10 are corrected immediately.

- **ASPD display precision** — base stats panel shows one decimal place
  (e.g. 186.3) instead of a rounded integer, matching the damage results panel.
  The formula uses a single `Math.floor` on the combined AGI/DEX reduction,
  matching eAthena's integer-division behaviour exactly.

## 2026-06-29

### Added

- **PS Monk Rework — Triple Attack proc** — Triple Attack (MO_TRIPLEATTACK) now
  procs during auto-attacks for Monks and Champions on Payon Stories, replacing
  the normal hit when it triggers.
  - Proc rate: 28 / 26 / 24 / 22 / 20 % at skill levels 1–5 (decreases with
    higher level per PS rework design).
  - Knuckle bonus: +0.2 × skill level % per 10 job levels (e.g. +5 % at lv 5,
    job level 50).
  - Crit eligibility: Triple Attack can crit when the **Fury** buff
    (SC_EXPLOSIONSPIRITS / Critical Explosion) is active. This is gated by the
    `MO_TRIPLEATTACK_PS_BONUS` mechanic flag so it only applies on PS.
  - Fury crit chance: 20 / 22.5 / 25 / 27.5 / 30 % at Fury levels 1–5 (uses
    the existing `SC_EXPLOSIONSPIRITS` override in serverProfiles.js).
  - Triple Attack skill level is tracked via the passive-skills panel; Fury is
    activated through the Self Buffs section.

- **PS Hunter Rework — Trap damage formulas** — Land Mine, Blast Mine, Freezing
  Trap, and Claymore Trap now use the reworked INT/DEX-based formulas:
  - Land Mine: `lv × (JobLv+DEX) × (BaseLv+INT) / 45` (Earth element)
  - Blast Mine: `lv × (BaseLv+DEX) × (JobLv+INT) / 45` (Wind element)
  - Freezing Trap: `lv × (JobLv+DEX) × (BaseLv+INT) / 70` (Water element)
  - Claymore Trap: `lv × (BaseLv+DEX) × (JobLv+INT) / 70` (Fire element)
  Traps bypass DEF. All four show up in the skill picker for Hunter/Sniper and
  produce a full step-by-step damage breakdown. Element vs target and race/size
  card bonuses still apply.

- **PS Assassin Rework — Katar second hit** — Implemented the katar second-hit
  branch for auto-attacks (Katar + TF_DOUBLE learned). Proc rate is 2× the PS
  TF_DOUBLE rate (14%/lv, capped at 100%). Damage scales as
  `(21 + 4×AS_KATAR_lv)%` of the main hit — up to 61% at AS_KATAR lv10
  (was flat 21% vanilla). Second hit can crit with the same katar-doubled crit
  rate and is included in DPS. Shown as a "Katar 2nd hit" tab in the results
  panel.

- **PS Assassin Rework — Enchant Poison passive** — AS_ENCHANTPOISON now grants
  a passive `+2%/lv` damage bonus vs Poison element monsters (up to +10% at
  lv5), regardless of whether the buff is active. AS_ENCHANTPOISON appears in
  the passive skills grid for Assassins.

- **PS Thief Rework — Envenom weapon element** — TF_POISON (Envenom) now uses
  the weapon's element instead of forced Poison on Payon Stories.

- **Credits footer** — Added a footer crediting Discord testers (Metan,
  hokageyyy, leafhill, knightzeroxx, kerfuffl, jenardpwet) and tochoco.latte
  for the initial base engine.

### Changed

- **Title renamed** — "Open PS Damage Calc" shortened to "Open PS Calc" in the
  navbar.

- **Consistent popups** — the Damage breakdown panel is now a centred modal
  overlay matching the Changelog and Save / Load dialogs, instead of an inline
  collapsible section.

- **Dory Card** — Damage bonus reduced from 30%/15% to 5% for both Freezing Trap
  and Claymore Trap, matching the reworked card's new effect.

- **Wolpertinger Card** — Damage bonus reduced from 15% to 5% for both Blast Mine
  and Land Mine.

- **Setting Dirk** — All-trap damage bonus reduced from 20% to 5% per trap skill.

- **URL compression** — Build share URLs are now compressed with LZ-string,
  reducing typical URL length by ~50–60 %. Old uncompressed URLs (with `?b=`)
  continue to load without any action required.

- **Calculate → scroll to results** — Clicking "Calculate damage" now smoothly
  scrolls the results panel into view, even when the panel is already open.

- **Base stat inputs** — Focusing a stat input now selects its value so typing
  immediately replaces it instead of appending to the existing number.

### Fixed

- **ASPD display** — base stats panel now shows one decimal place (e.g. 186.3)
  instead of a rounded integer, matching the damage results panel.

- **Build name not updating on save** — saving a build under a new name in the
  Save / Load panel now immediately reflects the name in the Character section.

- **Stat distribution cost formula** — Corrected the stat point cost formula
  to match [payonrocalc.jaludev.com](https://payonrocalc.jaludev.com/) (the
  official PS stat simulator). Previous formula (`v < 7 ? 1 : floor(v/10)+2`)
  overcharged by 1 point at every exact multiple-of-10 stat value (v=10, 20,
  30, …) and undercharged for v=1–6. Correct formula is
  `floor((v−1)/10)+2` for all v≥1. Effect: for a typical high-INT build at
  level 99 the old calc reported 3 fewer remaining points than it should,
  blocking stat increases that the server allows.

- **ASPD potion cap — Acolyte classes** — Priest and High Priest are
  restricted to Concentration Potion only (same as Bard / Dancer), matching
  Payon Stories rebalance rules. Monk and Champion are capped at Awakening
  Potion. Acolyte was already correct via the 1st-job cap.

## 2026-06-28

### Added

- **PS Monk Rework — Asura Strike damage branch** — Implemented the full
  `ATK × (8 + floor(SP/10)) + flat` formula in a dedicated
  `_runAsuraStrikeBranch` in battlePipeline.js. On PS, SP consumed is
  `floor(MaxSP × 20% × SkillLv)` (per rework); flat bonus per level:
  400/550/700/850/1000. Bypasses DEF, always hits, ignores size/mastery/refine
  exactly as vanilla, then applies element fix, card fix, and final rate bonus.

- **PS Monk Rework — Martial Arts** (was Iron Hand) — renamed to "Martial
  Arts" in ps_skill_db.json; now grants FLEE +2/level in addition to weapon
  mastery. Mastery now also covers **Mace** class weapons (`mastery_prefer_fallback`
  routes Mace → `MO_IRONHAND` when the character has no Priest Mace Mastery).
  ASPD bonus removed. FLEE handled via new `flee_per_lv: 2` in
  `PS_PASSIVE_OVERRIDES.MO_IRONHAND` and a new block in `statusCalculator.js`.

- **PS Monk Rework — Critical Explosion CRIT values** increased:
  20%/22.5%/25%/27.5%/30% (was 10%/12.5%/15%/17.5%/20%). Handled via new
  `SC_EXPLOSIONSPIRITS: { cri_base: 175, cri_per_lv: 25 }` in
  `PS_PASSIVE_OVERRIDES`; statusCalculator reads the override, falling back to
  vanilla `75 + 25×lv` if no override is present.

- **Skill pill toggle in damage modal** — when a skill is selected, a pill
  button showing `[Skill Name Lv N]` appears alongside the existing
  `[Normal hit]` and `[Critical hit]` toggle buttons. Clicking the pill
  switches the step-by-step breakdown to the skill's damage. Clicking
  "Normal hit" shows the baseline auto-attack (a second backend call is
  made in parallel so both results are available instantly). The skill pill
  is visually distinct with a highlighted border and slightly heavier weight.

- **Falcon damage shown in results** (Hunter / Sniper) — when a Hunter or
  Sniper build has Falconry Mastery learned, a "Falcon" section appears below
  the damage breakdown showing auto-blitz damage (1 hit) and, if Blitz Beat is
  skilled, the full Blitz Beat total (level × per-hit). Uses the PS custom
  formula `(LUK + INT/2 + Steel Crow Lv × 6 + 20) × 2` per hit; applies
  neutral-element modifier vs target and race/boss gear bonuses, bypasses DEF.

- **ASPD potions filtered by class** — Awakening Potion is disabled for
  Novice and 1st-job classes; Berserk Potion is disabled for all non-trans
  classes. Dancer, Bard, Clown, and Gypsy are restricted to Concentration
  Potion (PS rebalance); Magician, Wizard, and Sage can use Berserk Potion
  (PS rebalance). Selecting an invalid potion and then switching class
  auto-clears it.

- **Dancing Lesson Lv 10 CRIT bonus** (`DC_DANCINGLESSON`) now correctly adds
  +10% critical hit rate for Dancer/Gypsy. The code path in statusCalculator
  already existed but was reading from an empty override table; fixed by adding
  `cri_at_max_lv: 100` to `PS_PASSIVE_OVERRIDES`.

- **Clan buffs** — a "Clan" section at the bottom of the Buffs panel lets you
  select your clan membership (Sword, Arch Wand, Golden Mace, Crossbow,
  Artisan, or Vile Wind). The stat bonuses (STR/AGI/VIT/INT/DEX/LUK +1,
  plus MaxHP+30/MaxSP+10) are applied to the damage calculation server-side
  via the existing `CLAN_STATS` table in `buildApplicator.js`. Selecting a
  clan also shows the corresponding +1 badges in the base stats section.

- **Equipment filtered by class** — item search dropdowns now only show gear
  equippable by the currently selected job (e.g. switching to Mage hides
  two-handed swords). If the class is changed after equipping an item that
  the new class cannot use, the slot is highlighted in red with a "Not
  equippable by this class" notice and the item is silently excluded from
  the damage calculation and equipment stat bonuses until unequipped.

- **Pet section** (Payon Stories server) — panel 03, placed in the left
  column below Equipment to balance the two-column layout. A dropdown lets
  you select your active pet; bonuses activate at Cordial (750+ intimacy) and
  are applied server-side before the damage calculation. Supported bonuses
  include flat stats (STR/AGI/VIT/INT/DEX/LUK), ATK, MATK%, ASPD%, CRIT,
  HIT, FLEE, perfect dodge, DEF/MDEF, MaxHP/MaxSP, elemental/racial
  resist/boost, and crit damage %. HP drain procs and heal power bonuses are
  noted in the label but not modelled by the engine. Covers all standard pets
  plus the five PS custom pets (Puck, Kalec, Yser, Gyokuto, Onigiring).

- **ASPD shown in the damage breakdown headline** — the computed attack speed
  (same value the RO status window shows, 0–190 scale) now appears as a
  metric card alongside hit chance, crit chance, damage range, and DPS.
  `status.aspd` was already returned by the calculate endpoint; this was a
  frontend-only addition.

- **Combat stats panel** — A "Combat stats" grid below base stats shows Max HP,
  Max SP, HP Regen, SP Regen, ATK, MATK (min–max range), DEF (hard+soft),
  MDEF (hard+soft), ASPD, Flee, and Critical. Values come from a new
  `POST /calculate/status` route that runs the full status pipeline without
  requiring a battle target; updates reactively as stats or equipment change,
  debounced 300 ms.

- **Remaining status points display** — The "Base stats" label now shows a
  thin progress bar and "N SP remaining" counter next to it. Color-coded:
  neutral when budget is healthy, gold at ≤ 10 remaining, red when over
  budget. Each stat card also shows the cost of the next increment ("+N pt").
  Stat inputs are capped when raising if the remaining budget would be
  exceeded; lowering always works. Trans 2nd jobs receive the +52 bonus on
  top of the base-level total.

- **Light/dark mode toggle** — A ☀/☾ button in the top bar switches between
  dark (default) and light mode. The selected theme is persisted via
  `localStorage`; an inline script in `index.html` restores it before the
  page renders so there is no dark-to-light flash on load.

- **Theme toggle hint popover** — First-time visitors see an accent-colored
  speech bubble below the toggle reading "Try light mode" (or "Try dark mode"
  if already on light). Dismissed permanently after the first click and never
  shown again across sessions.

- **Angelus in party buffs** (Priest, max level 5) — Added with the correct
  PS formula: flat `+3 × level` applied to soft DEF first, then a
  `+10% × level` multiplier. The engine previously used the vanilla-eA
  `+5%/level` formula with no flat component; both values were wrong for PS.

- **Middle and bottom headgear slots** — `head_mid` (`EQP_HEAD_MID`) and
  `head_low` (`EQP_HEAD_LOW`) added to the equipment section. Card sub-slots
  derive from the slot key automatically so no further changes were needed.

- **Equipment dropdown opens on click** — Focusing an empty equipment slot
  immediately shows up to 20 items for that slot without needing to type
  first. Previously the picker stayed blank until at least one character
  was entered.

### Changed

- **PS Monk Rework — Triple Attack** condensed to 5 levels (140/180/220/260/300%
  ATK, activation rates 28/26/24/22/20%). Added PS ratio `(lv) => 100 + 40 * lv`
  to `PS_BF_WEAPON_RATIOS`. Requirements updated to "Martial Arts 5".

- **PS Monk Rework — Chain Combo** damage adjusted to 260/320/380/440/500% ATK
  (was 240/320/400/480/560). Ratio formula updated to `(lv) => 200 + 60 * lv`.

- **PS Monk Rework — Combo Finish** damage increased to 345/435/525/615/705% ATK
  (was 340/425/510/595/680). Ratio formula updated to `(lv) => 255 + 90 * lv`.

- **Skill descriptions updated** for Martial Arts, Dodge (removed note), Triple
  Attack, Chain Combo, Combo Finish, Critical Explosion, Asura Strike, Finger
  Offensive (cast time 1+0.8/sphere), Steel Body, Blade Stop (Martial Arts 5
  req), Spirits Recovery, Absorb Spirits (100% success, new SP formula), Ki
  Translation (SP 40→20, cast 2s→1s, ACD 1s→0.5s), Ki Explosion (ACD 2s→1s).

- **Damage breakdown is now an inline panel** at the top of the page
  rather than a modal overlay. It appears automatically when a
  calculation runs, has a gold accent top border for visibility, and can
  be dismissed with the × button.

- **Combat stats grid** widened from 2 columns to 3.

### Fixed

- **Shield Boomerang damage formula** corrected to the PS formula:
  `(BATK + shield_weight) × ratio/100`, where `shield_weight` is the
  displayed in-game weight (item DB stores it ×10, so divided by 10).
  Per-level ratios are taken from `ps_skill_db.json`
  (140/180/220/260/300%), not the vanilla eA formula. Shield refine
  bonus (`refine × 10` flat) is added after DEF reduction.

- **Shield Boomerang level cap** was incorrectly 10; the skill maxes at
  5 in PS. The level input and all load paths (URL state, saved builds)
  now cap at 5.

- **Berserk Potion available to Merchant, Swordsman, and Thief trees** —
  non-trans 2nd-job classes in these trees were incorrectly blocked from
  using Berserk Potion (capped to Awakening only). The correct PS
  restriction allows them access alongside trans jobs; only Novice/1st-job
  and Dancer/Bard/Clown/Gypsy are more restricted.

- **Max SP and Max HP now reflect active buffs** — Blessing (and any
  other SC that modifies INT or VIT) was not being considered when
  computing Max SP and Max HP. The stat snapshot was taken before the
  SC modifier pass ran; it is now derived from the fully-buffed status.

- **HP regen formula** corrected to match the PS wiki:
  `max(1, floor(MaxHP/200)) + floor(VIT/5)`. The previous formula added
  a hard `+1` on top of `floor(MaxHP/200)`, overcounting by 1 for any
  character with MaxHP ≥ 200.

- **PS class rebalance — weapon mastery ATK values** corrected per
  [wiki.payonstories.com/Class_Rebalance](https://wiki.payonstories.com/Class_Rebalance).
  Musical Lesson, Dancing Lesson, Iron Hand, and Axe Mastery corrected from
  +3 to +5 ATK/lv; Mace Mastery and Katar Mastery from +3 to +4 ATK/lv.
  All were falling through to vanilla eA values instead of PS custom values.

- **Spear Mastery (`KN_SPEARMASTERY`) ATK values** corrected: +4→+5/level
  without Peco, +5→+7/level while riding Peco.

- **Dancing Lesson CRIT** (+10% at lv 10) was missing from the ATK calculation
  due to a missing `atk_per_lv` array; CRIT gate at max level is unchanged.

- **Katar Mastery CRIT** now scales per level (+0.5% per level, up to +5% at
  lv 10) — was completely missing from the calculation (returned 0).

- **PS stat point cost formula** — The correct PS formula charges 1 point per
  increment for stats 1–6, then `floor(V/10) + 2` from stat 7 onwards. The
  previous formula (`floor(V/10) + 1` uniformly) significantly under-counted:
  a level 97 Dancer with AGI 96, DEX 98, INT 9, VIT/STR/LUK 1 showed 183 SP
  remaining instead of 1. Remaining display, affordability cap on stat inputs,
  and per-stat cost badge all updated.

### Removed

- **"Avg damage" metric card** from the damage breakdown headline — redundant
  given the damage range (min–max) card directly below it.
- **"View results" button** from the top bar — the results modal opens
  automatically on calculate; the button to re-open it added clutter without
  enough benefit.

## 2026-06-27

### Added

- **Equipment stat bonuses (bStr, bAgi, etc.) now shown in the base stats
  section** alongside the existing job-level bonus badges. Each stat card
  now shows two "+N" indicators when applicable — green for job level,
  blue for equipment — and the bold total reflects all three (base + job +
  gear). Gear bonuses update reactively as you equip or unequip items via a
  dedicated `POST /calculate/gear-stat-bonuses` route that runs a single
  pass of the item-script engine (no full damage calc required), debounced
  300 ms so rapid changes don't flood the server.

- **Slot count shown in equipment dropdown labels** — items with card slots
  now display as `Name[N]` (e.g. `Main Gauche[4]`); slotless items show the
  plain name. Cards themselves have 0 slots so they're unaffected.

- **Keyboard navigation in equipment (and all) search dropdowns.**
  Arrow keys move a highlight through the results list; Enter confirms the
  highlighted item; Escape closes the list. Tab selects the highlighted
  item (if any) and lets focus move to the next field naturally without
  requiring a separate click or Enter press.

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

- Poem of Bragi (`BA_POEMBRAGI`, Bard/Clown) to the Bard/Dancer songs
  section. It reduces cast time and after-cast delay (`skillTiming.js`),
  not ASPD directly — so it only changes DPS when testing an actual
  skill, not a normal attack (normal-attack period is ASPD-only).
  Verified with MG_FIREBALL: period 2470ms→1429ms, DPS 153.8→265.9 at
  Bragi level 10.

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

- Party buffs are now grouped by source class (Priest, Blacksmith, Sage)
  under their own subheadings, instead of one flat grid with a "(Source)"
  suffix on every label.

- Priest/Blacksmith party buffs (Impositio Manus, Blessing, Increase AGI,
  Gloria, Overthrust, Overthrust Max, Adrenaline Rush) switched from a
  numeric level input to a checkbox — checking it applies the buff's max
  level, since these are received from a party member and you don't
  control the caster's actual level anyway. Sage's ground effect dropdown
  now applies max level automatically on selection instead of a separate
  level input.

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
