# Roadmap / port status

This documents the gap between this JS port and the original Python engine
(`StatGameDev/Open_PS_Calc`), file by file, so future work can pick up
without re-auditing everything from scratch.

## Fully ported (1:1 structural translation, verified against source)

| Original (Python) | Port (JS) | Notes |
|---|---|---|
| `core/models/*.py` | `engine/models.js` | dataclasses → factory functions |
| `core/data_loader.py` | `engine/dataLoader.js` | item/mob/skill/table lookups, PS layering |
| `core/bonus_definitions.py` | `engine/bonusDefinitions.js` | bonus-type description/routing tables |
| `core/item_script_parser.py` | `engine/itemScriptParser.js` | incl. a hand-written safe-expression evaluator replacing Python's `ast` module |
| `core/gear_bonus_aggregator.py` | `engine/gearBonusAggregator.js` | |
| `core/build_applicator.py` | `engine/buildApplicator.js` | |
| `core/build_manager.py` | `engine/buildManager.js` | save/load schema, weapon resolution, player→target conversion |
| `core/player_state_builder.py` | `engine/playerStateBuilder.js` | two-pass gear/status resolution |
| `core/config.py` | `engine/config.js` | |
| `core/calculators/status_calculator.py` | `engine/calculators/statusCalculator.js` | full 839-line formula set, all SC/song/passive branches |
| `core/calculators/target_utils.py` | `engine/calculators/targetUtils.js` | |
| `core/calculators/skill_timing.py` | `engine/calculators/skillTiming.js` | |
| `core/calculators/proc_keys.py` | `engine/calculators/procKeys.js` | |
| `core/calculators/dps_calculator.py` | `engine/calculators/dpsCalculator.js` | |
| `pmf/operations.py` | `engine/pmf.js` | |
| `core/calculators/modifiers/base_damage.py` | `.../modifiers/baseDamage.js` | |
| `.../refine_fix.py` | `.../refineFix.js` | |
| `.../attr_fix.py` | `.../attrFix.js` | |
| `.../forge_bonus.py` | `.../forgeBonus.js` | |
| `.../final_rate_bonus.py` | `.../finalRateBonus.js` | |
| `.../hit_chance.py` | `.../hitChance.js` | |
| `.../crit_chance.py` | `.../critChance.js` | |
| `.../crit_atk_rate.py` | `.../critAtkRate.js` | |
| `.../active_status_bonus.py` | `.../activeStatusBonus.js` | complex_flat (SC_ENCHANTBLADE) / rate_chance (SC_GIANTGROWTH) intentionally unported in the original too |
| `.../mastery_fix.py` | `.../masteryFix.js` | |
| `.../defense_fix.py` | `.../defenseFix.js` | incl. `calculate_magic` |
| `.../card_fix.py` | `.../cardFix.js` | incl. incoming-physical/magic variants, not yet wired into a pipeline (see below) |
| `core/calculators/magic_pipeline.py` | `battlePipeline.js#_runMagicBranch` | BF_MAGIC skills now return real damage (MATK roll → skill ratio → MDEF → AttrFix → CardFixMagic). `BF_MAGIC_RATIOS` only has ~30 explicit skills transcribed; others fall back to `skills.json`'s `ratio_per_level`, same as the weapon-skill path. |
| `core/calculators/grand_cross_pipeline.py` | `battlePipeline.js#_runGrandCrossBranch` | `(ATK+MATK) * (100+40*lv)/100 * holy_element_mult`, confirmed verbatim against [wiki.payonstories.com/Grand_Cross](https://wiki.payonstories.com/Grand_Cross) (also matches two independent vanilla pre-renewal community sources, and this repo's own `skills.json` `damage_type: ["IgnoreCards","IgnoreFlee"]`). **PS deviation implemented**: the PS wiki states weapon masteries + Demon Bane's flat bonus *do* apply (only their percentage components are excluded) — gated behind a new `PS_GRANDCROSS_MASTERY_APPLIES` mechanic flag in `serverProfiles.js` so vanilla `standard` keeps `masteryFix.js`'s `MASTERY_EXEMPT_SKILLS` bypass. Original Hercules `battle.c` BF_MISC case still not directly inspected (repeated fetches were truncated before reaching it) — not needed now that the PS wiki corroborates the constant directly, but worth re-deriving if precision on the vanilla side matters later. |

## Partially ported

- **`core/server_profiles.py` → `engine/serverProfiles.js`** — `STANDARD`
  (vanilla) is complete. For `PAYON_STORIES`, the following were pulled
  directly from `core/server_profiles.py` on
  [StatGameDev/Open_PS_Calc](https://github.com/StatGameDev/Open_PS_Calc)
  (MIT licensed, fetched in sections to work around source-file size) and
  are now wired in and tested against vanilla to confirm divergence:
  `weapon_ratios` (36 skills, was 0), `weapon_vanilla_ok` (24 skills — used
  to suppress `skillRatio.js`'s "PS unaudited" warning for confirmed-vanilla
  skills), `magic_ratios` (10 skills, was 0), `magic_vanilla_ok` (20 skills
  — same warning-suppression, newly added to `_runMagicBranch` for parity
  with the weapon path), and 4 more `mechanic_flags`
  (`BS_OVERTHRUST_PARTY_FULL_BONUS`, `CR_SHIELDBOOMERANG_NK_IGNORE_FLEE`,
  `CR_SHIELDCHARGE_NK_IGNORE_FLEE`, `RG_BACKSTAP_NK_IGNORE_FLEE`) that
  already had a consumer in this port but weren't turned on. Also fixed:
  `_runMagicBranch`'s PS/vanilla ratio function calls only ever passed
  `skill.level`, never `target`/`ctx` — several PS magic ratios need them
  (e.g. `PR_MAGNUS` checks target race, `WZ_FIREPILLAR` reads
  `skill_params`). Now matches the weapon path's `(lv, tgt, ctx)` signature.
  **PS Assassin/Thief rework flags added and implemented**: three new
  `mechanic_flags` added to the `PAYON_STORIES` profile with full pipeline
  consumers: `AS_KATAR_SECOND_HIT` (katar second-hit proc),
  `TF_POISON_USES_WEAPON_ELEMENT` (Envenom attack element follows weapon
  element), `AS_ENCHANTPOISON_PASSIVE_BONUS` (Enchant Poison skill level
  adds 2% damage per level vs Poison-element targets). `AS_ENCHANTPOISON`
  also added to `dataLoader.js`'s `DAMAGE_RELEVANT` and
  `ACTIVE_SKILL_TYPE_EXCEPTIONS` so the skill appears in the passive panel.
  **PS class reworks added** (see "Done this pass"):
  `SM_MAGNUM_ENDOW_ATTACK_ONLY` (Crusader), `RG_BACKSTAP_OPPORTUNITY` and
  `RG_BOW_DOUBLE_ATTACK` (Rogue). Knight rework uses no new mechanic flags —
  implemented via `SC_TWOHANDQUICKEN.cri_per_lv`, `skill_level_cap_overrides`,
  and `mastery_prefer_fallback`.
  **PS Wizard / High Wizard rework implemented**: `WZ_FROSTNOVA` formula
  corrected to `(175+15×lv) + 10×FrostDiverLv`% (was `50×lv + …`). `WZ_VERMILION`
  added to `PS_BF_MAGIC_RATIOS` with `200×lv`% total (4 waves summed).
  `HW_NAPALMVULCAN` removed from `PS_MAGIC_VANILLA_OK`; element overridden to
  Shadow (Dark=7) via `skill_elements`; 50% MDEF ignore added via
  `HW_NAPALMVULCAN_MDEF_IGNORE` flag. `WZ_FIREPILLAR_MDEF_IGNORE` flag wired
  into `battlePipeline.js`'s `_runMagicBranch`. `SC_AMPLIFYMAGICPOWER` added to
  `statusCalculator.js` with PS-scaling (`min(lv,5)×10`%) gated by
  `SC_AMPLIFYMAGICPOWER_SCALING` flag; vanilla keeps flat 50%. `HW_SOULDRAIN`
  passive +1% MaxHP/lv added to `statusCalculator.js` and exposed as a skill
  slider via `DAMAGE_RELEVANT` / `ACTIVE_SKILL_TYPE_EXCEPTIONS`. Level caps
  added: `WZ_FROSTNOVA:5`, `WZ_FIREPILLAR:5`, `WZ_SIGHTRASHER:5`,
  `WZ_AMPLIFYMAGICPOWER:5`.
  **Still missing**: upstream has ~7 more `mechanic_flags` with no consumer
  anywhere in this JS port yet (`SC_CLOAKING_BONUS`,
  `GS_BLOCK_ENDOW`, `MO_EXTREMITYFIST_NK_NORMAL_DEF`,
  `PR_TURNUNDEAD_PS_BONUS`, `PS_HOLYSTRIKE_PROC`,
  `SC_GS_ADJUSTMENT_LR_REDUCE`, `NJ_ISSEN_MIRROR_BONUS`) — these need new
  modifier code, not just data. (The Musical Strike / Throw Arrow "performing"
  +100% bonus is now implemented via `skill_params.PS_PERFORMING_active` and a
  target-panel toggle, so its two upstream flags are dropped from this list.)
  (`MG_SOULSTRIKE_MDEF_IGNORE`,
  `WZ_FIREPILLAR_MDEF_IGNORE`, `HW_NAPALMVULCAN_MDEF_IGNORE`, and
  `RG_BACKSTAP_OPPORTUNITY` were previously listed here but are now
  implemented — see battle pipeline and "Done this pass" below.)
  Also: 3 of the 36 weapon ratios (`PS_RG_TRICKARROW`, `PS_RG_QUICKSTEP`,
  `PS_PR_HOLYSTRIKE`) are PS-custom skills (`ps_custom_constants.json` IDs
  2631/2633/2622, defined in `ps_skill_db.json`) that **`dataLoader.getSkill()`
  can't resolve at all** — it only ever reads vanilla `db/skills.json`
  regardless of profile, so these 3 skills can't currently be
  selected/calculated by this engine no matter what data exists for them.
  Real architecture gap, not just a data gap — needs `getSkill()` (and skill
  search) to consult `ps_skill_db.json` + `ps_custom_constants.json` when
  `use_ps_data` is set. The ratio data is ready for whenever that's fixed.

- **`core/calculators/modifiers/skill_ratio.py` → `.../modifiers/skillRatio.js`**
  — dispatch/precedence logic complete. `BF_WEAPON_RATIOS` is now the full
  52-entry table from upstream's `_BF_WEAPON_RATIOS` (was ~29) — added the
  23 missing entries (AM_ACIDTERROR, HT_FREEZINGTRAP, KN_AUTOCOUNTER,
  MO_FINGEROFFENSIVE, MO_INVESTIGATE, TK_STORMKICK/DOWNKICK/TURNKICK/COUNTER,
  all 10 GS_* skills, NJ_HUUMA/KASUMIKIRI/KIRIKAGE/KUNAI), verified count
  matches upstream exactly, spot-checked `GS_BULLSEYE`'s conditional
  Brute/Demi-Human race bonus against both a matching and non-matching
  target. The original's `RG_BACKSTAP` weapon-type split and
  parameter-dependent skills (`KN_CHARGEATK`, `MC_CARTREVOLUTION`,
  `TK_JUMPKICK`, `NJ_ZENYNAGE`) are still not transcribed — those need
  per-call context plumbing beyond a flat lookup table, separate piece of
  work. Anything not in either table still falls back to `skills.json`'s
  `ratio_per_level`/`ratio_base`.

- **`core/calculators/battle_pipeline.py` → `.../calculators/battlePipeline.js`**
  — covers normal attacks and BF_WEAPON skills end-to-end (the single most
  important path). **`TF_DOUBLE` (Double Attack) proc now implemented**
  (battle.c:4926 — dagger-only, normal attacks only, mutually exclusive
  with crit; proc rate from `profile.proc_rate_overrides.TF_DOUBLE` with a
  vanilla default of 5%/level, 7%/level on PS; verified end-to-end that DPS
  scales correctly and that non-dagger weapons correctly get 0% proc despite
  having skill levels set). **Katar second-hit now implemented** — Katar
  auto-attack with `TF_DOUBLE` learned procs a second hit at 2× the normal
  `TF_DOUBLE` rate, dealing `(21 + 4 × AS_KATAR_lv)%` of the main-hit
  damage; both normal and crit variants computed, included in DPS, exposed
  as a separate branch in the damage breakdown. **PS Envenom weapon element
  and Enchant Poison passive bonus also implemented** — see serverProfiles
  entry below. Still deferred:
  `GS_CHAINACTION` proc (same shape as Double Attack but not yet ported),
  item autocasts, NJ_ISSEN's
  fixed-damage formula, CR_SHIELDBOOMERANG's special case, several small
  PS-only multiplicative bonuses (Cloaking, Lex Aeterna, Mailbreaker/Venom
  Dust/Raided, Backstab Opportunity, "performing" bonuses), `bDoubleRate`
  gear bonus (cards/items that add to Double Attack's proc chance — no
  consumer in `gearBonusAggregator.js` yet), and `bWeaponAtk` (needs a
  weapon-type → Hercules `W_*` constant table not transcribed here).
  **PS Hunter trap branch now implemented** — `_runTrapBranch` handles
  HT_LANDMINE, HT_BLASTMINE, HT_FREEZINGTRAP, HT_CLAYMORETRAP when
  `HT_TRAP_PS_FORMULA` mechanic flag is set; dispatched in `calculate()`
  before the generic BF_MISC fallback. Formula verified against the PDF's
  comparison table at Hunter 99/50 DEX150/INT100 for all four traps.
  **PS Assassin dual-wield now implemented** — three-hit model per
  auto-attack swing: hit 1 = RH × `AS_RIGHT` factor, hit 2 = same roll as
  hit 1 (×`AS_RIGHT` factor), hit 3 = LH × `AS_LEFT` factor. Mastery
  factors from serverProfiles `passive_overrides`; vanilla base penalties
  (RH 50%, LH 30%) apply at lv 0. Gated by `DUAL_WIELD_PS_THREE_HIT`
  mechanic flag. A `DUAL_WIELD_PS_DAMAGE_BONUS` mechanic flag (also set in
  PS profile) applies a ×1.10 multiplier to the combined total after mastery;
  propagated to the frontend as `dw_ps_bonus_pct` so headline range and DPS
  are consistent. UI: damage panel shows `[PS (3-hit) beta | Vanilla]` toggle
  when an off-hand weapon is equipped — PS mode shows combined damage range
  and two-section step list (with a bonus row when `dw_ps_bonus_pct > 0`);
  Vanilla mode recomputes single-weapon DPS.
  **PS Crusader rework implemented** — see "Done this pass".
  **PS Knight rework implemented** — see "Done this pass".
  **PS Rogue rework implemented** — Backstab Opportunity (×1.4, user-toggled
  via `support_buffs.backstab_opportunity`), Vulture's Eye bow Double Attack
  (`min(TF_DOUBLE_lv, AC_VULTURE_lv)` proc, `RG_BOW_DOUBLE_ATTACK` flag),
  Yser Card functional (`bSkillAtk` for RG_BACKSTAP/RG_RAID, +5 HIT).
  `bSkillAtk` is applied inside `calculateSkillRatio()` for the weapon branch.
  (An earlier pass also re-applied it in `_runBranch`, double-counting every
  weapon skill's `bSkillAtk` — that duplicate has since been removed.)
  **Cards always proc toggle implemented** — `gearBonusAggregator.compute()`
  now parses `autobonus` / `autobonus2` scripts from item scripts and stores
  them in `gearBonuses.auto_bonuses`. When `build.flags.force_procs` is set,
  the inner bonus effects are applied as permanent bonuses (and to `from_cards`
  when the source is a card slot). The `/calculate` route returns
  `has_auto_bonuses: boolean`; the frontend shows a "Cards always proc"
  checkbox in the damage breakdown panel when true, triggering immediate
  recalculation on toggle.
  **PS Wizard rework — 50% MDEF ignore** for `WZ_FIREPILLAR` and
  `HW_NAPALMVULCAN` wired via per-skill `mdefIgnorePct` parameter already
  present in `calculateMagicDefenseFix` (was always passed 0 before).
  **`NK_IGNORE_ELEMENT` now wired** — `damage_type: ["IgnoreElement"]` in the
  skill DB was never surfaced as a flag; `calculateAttrFix` always ran in
  `_runBranch`. Fixed by adding `skill.nk_ignore_ele` alongside the existing
  `nk_ignore_def`/`nk_ignore_flee` flags in `calculate()`; `_runBranch` now
  skips AttrFix when set. Primary beneficiary: `AS_SPLASHER` (Venom Splasher).
  **PS Sage rework implemented** (`Payon Stories Sage Rework Publication (Final).pdf`) —
  `MG_SOULSTRIKE`: 50% MDEF ignore via `MG_SOULSTRIKE_MDEF_IGNORE` flag (same pattern as
  Fire Pillar / Napalm Vulcan); +5% damage per skill level vs Undead race via
  `MG_SOULSTRIKE_UNDEAD_BONUS` flag, applied as a dedicated pipeline step after AttrFix.
  `MG_FIREBALL`: per-level table `40 + 30 × lv` (70%→340%) already stored in
  `PS_BF_MAGIC_RATIOS` — confirmed correct against published table.
  `WZ_EARTHSPIKE` / `WZ_HEAVENDRIVE`: 140% per hit already stored — confirmed correct.
  `SA_ADVANCEDBOOK`: flat ATK +10–30 and ASPD +3–7% at levels 1–5 already in
  `PS_PASSIVE_OVERRIDES` — confirmed correct.
  Volcano/Deluge/Violent Gale persistence buffs (max level 3) already stored and capped.
  **PS Gunslinger rework implemented** — verified all damage-relevant rework
  items: `GS_TRIPLEACTION` (140%/hit × 3 = 420% total, PS ratio `100+40×lv` at
  max level 1, was 450% vanilla); `GS_GROUNDDRIFT` (`200+60×lv`%, max 800% at
  lv 10, was `100+50×lv`%); `GS_MAGICALBULLET` (`50+DEX+BaseLvl`%); Heavy-Tipped
  Bullet (ATK 45, `bonus2 bAddRace,RC_All,10` — all already in PS data).
  **Neutral resist fixed**: `GS_DUST` was missing from `PS_PASSIVE_RESISTS` despite
  its description promising 7% Neutral resist at max level — now added. `GS_FULLBUSTER`
  and `GS_SPREADATTACK` resist now also triggers with Grenade Launcher
  (`weapon_types` updated to `["Shotgun","Grenade"]` for all three).
  Still deferred: `GS_CHAINACTION` proc,
  item autocasts, NJ_ISSEN's fixed-damage formula,
  CR_SHIELDBOOMERANG's special case, several small PS-only multiplicative
  bonuses (Cloaking, Lex Aeterna, Mailbreaker/Venom Dust/Raided,
  "performing" bonuses), `bDoubleRate` gear bonus, `bWeaponAtk`.

## Not yet started

- BF_MISC skills beyond Grand Cross and the PS trap branch
  (TF_THROWSTONE, NJ_ZENYNAGE, GS_FLING, BA_DISSONANCE, etc.) — still
  return "not yet implemented". HT_LANDMINE / HT_BLASTMINE /
  HT_FREEZINGTRAP / HT_CLAYMORETRAP are now implemented for the
  `PAYON_STORIES` profile (see "Done this pass"); non-PS profiles still
  return "not yet implemented" for these four.
- `GS_CHAINACTION` proc — same mechanic shape as `TF_DOUBLE` and the
  now-implemented `MO_TRIPLEATTACK`, not yet ported.
- Gunslinger's coin economy (Flip the Coin / `GS_GLITTERING`, and every
  skill whose damage or effect scales with coins held — e.g. PS's
  `GS_BULLSEYE` bleed chance is explicitly different "with coins") has no
  representation anywhere in the engine — no build field for coin count,
  no skill_ratio entries reading one. Surfaced by a user report asking for
  "Coin amount" in the buffs panel; not implemented since there's nothing
  in the engine yet to wire a UI control to.
- `GS_FULLBUSTER` / `GS_SPREADATTACK` grant a passive elemental resist at
  skill level 10 with a Shotgun equipped (`profile.passive_resists` in
  `serverProfiles.js` — already engine-supported). Not surfaced in the
  passive-skill panel because both are active attack skills
  (`skill_type` non-empty), not true passives, and the panel's resist
  scope is damage-relevant masteries only, not defensive bonuses. Likely
  what a user report meant by "Shotgun passives" being missing; flagging
  here rather than silently expanding the passive panel's scope without
  confirming that's actually wanted.
- GUI parity: the original has 15 sections and 6 dialogs (combat controls,
  equipment/monster/skill browsers with rich filtering, build-vs-build
  comparison). The web frontend now covers stats, equipment with card
  slots, a passive-skill panel filtered to damage-relevant masteries, a
  buffs panel (quickens, Impositio Manus, Overthrust, Bard/Dancer songs —
  whatever the engine already read from `active_buffs`/`song_state` but had
  no UI for), consumables, target selection, skill selection, and the
  damage breakdown — still not full parity (no combat-controls panel, no
  build-vs-build comparison).

## Planned front-end features (product)

These come from a "what would help a player simulate their character" review. The engine
already returns everything both need — they're largely frontend work.

### 1. Build-vs-build comparison  (in progress — on a feature branch)

The single most-used interaction for a damage calc: *"is A or B better?"* (card swaps, refine
levels, stat splits, gear choices). Pin the current build+result as a snapshot, then tweak the
editor and see the delta live. UI: a compare table whose columns are each pinned build plus the
current (live) result, and whose rows are the decision metrics — **DPS, average damage per hit,
time-to-kill** — with deltas colour-coded (green = better). Each pin can be reloaded into the
editor or removed. The original Python app had this (see "no build-vs-build comparison" under Not
yet started). Implementation: a `pins[]` array in `BuildEditor` holding `{label, metrics,
buildState}`; a `CompareView` component renders the table. Snapshot the full (shareable) build
state so pins survive edits and can be restored. Metrics come straight off `calcResult` —
`result.dps` (already effective), `result.normal.avg_damage`, and `target_hp / dps` for TTK.

### 2. "What to upgrade next" marginal-gain panel

For the current build+target, re-run the calc with **one thing changed** and rank the DPS gain of:
+1 refine on each equipped piece, the best card for each open slot, and +1 to each primary stat.
Shows the player the highest-leverage next purchase. Implementation: enumerate candidate
single-edits, call the existing `/calculate` endpoint for each, diff the DPS, sort. Debounce/cache
so it doesn't flood the backend (or add a batch endpoint). Natural follow-ons: a card recommender
and a stat optimiser (given N free points, maximise DPS/TTK).

## Done this pass (not in the original suggested order, picked up ad hoc)

- **Bonus-routing audit — several damage bonuses were parsed but not applied.**
  Diffed every `bonus`/`bonus2` type used in `item_db` against what
  `bonusDefinitions.js` actually routes, and checked table entries that were
  present but defined with no `field`/`mode` (silent no-ops). Fixed:
  `bNoSizeFix` (Drake Card — size penalty; new `no_sizefix` gear flag folded
  into the build), `bIgnoreMdefRace` (High Wizard Card — 100% non-boss MDEF
  ignore; new `dict_const` aggregator mode + `value` on `def()`),
  `bIgnoreDefRace` (40+ race "ignore DEF" cards — was a no-op, now
  `ignore_def_rate` at 100%), `bMatk` (flat gear MATK, ~150 items — was a no-op,
  now a `matk` gear field folded into `bonus_matk_flat`), `bCriticalAddRace`
  (+crit vs race — now consumed in `critChance`, `gearBonuses` threaded through),
  and `bAddDamageClass` (+% vs a specific mob id — had a duplicate effect-less
  definition overriding it; now routed and applied in `cardFix` via a new
  `target.mob_id`). Verified no remaining same-object duplicate keys in the
  bonus tables. Remaining unhandled `damage_type` flags (`IgnoreDefCards`,
  `NoDamage`, `SplitDamage`) are near-zero impact for single-monster targeting.
- **Offensive "Misc"-typed skills now selectable** — the skill picker's
  `damage_only` filter (`routes/data.ts`) kept only `attack_type` `Weapon`/`Magic`,
  but the skill DB tags every non-weapon/magic skill as `Misc` (buffs, masteries,
  songs, *and* delayed/indirect damage skills). That hid genuine offensive
  skills the engine already computes — e.g. Venom Splasher (`AS_SPLASHER`, PS
  ratio `500 + 50×lv + 30×PoisonReactLv`%) and Acid Terror. The filter now also
  keeps any skill the active server profile has a `weapon_ratios`/`magic_ratios`
  entry for, which is the precise "this server can actually calculate it" signal;
  vanilla (empty ratio tables) is unchanged. Verified end-to-end (Venom Splasher
  Lv10 → 1000% ratio → real damage).
- **Monster-family (RC2) "Bane" cards implemented** — real `bAddRace2` cards
  (Orc Lady, Goblin/Kobold Leader, Lava Golem, plus RC2_Guardian/RC2_Ninja
  cards) were parsed but silently dropped: there was no `bAddRace2` routing and
  no mob→family data anywhere in the port (Hercules/rAthena migrated it out of
  the DB files). Added end-to-end: `bAddRace2` → `add_race2` dict in
  `bonusDefinitions.js`; `add_race2: {}` in `createGearBonuses` and `race2: []`
  on targets in `models.js`; a new `db/mob_race2_db.json` (pre-re RC2 groups —
  Goblin/Kobold/Orc/Golem/Guardian/Ninja, recovered from rAthena's
  pre-migration `db/pre-re/mob_race2_db.txt`) with a cached reverse map in
  `dataLoader.getMonster` that attaches `target.race2`; and application in
  `cardFix.js` as its own multiplier, gated on the target's family. Verified
  end-to-end (Orc Lady card = +30% vs Orc-family mobs, 0% otherwise). Separate
  from the wildcard "Type"/`add_type` mix, which still applies unconditionally
  as a slotting simulation. Payon-Stories-custom mobs added to a family would
  need extra entries in the data file.
- **Weapon card wildcard "Type" category (`bAddRace2`)** — the weapon-card
  wildcard mix gained a fourth category, **Type**, for monster-family "Bane"
  cards (Orc / Goblin / Kobold / Golem-Bane, +30% physical damage). Added an
  `add_type` field to `createGearBonuses` (`models.js`), fed by the `Type_All`
  wildcard key in `playerStateBuilder.js`, and consumed as its own
  multiplicative `typeBonus` factor in `cardFix.js` (separate from
  race/ele/size). Applies to the selected target since the mix simulates
  "what card would I slot". Also fixed the wildcard aggregation dropping the
  mix on a weapon switch — it now iterates the equipped weapon's live slot
  count instead of a stale stored `wildcard_slots` copy.
- **Soft-DEF variance preserved through def-ratio / Investigate** — added
  `scaleFloorNumRange(pmf, numLo, numHi, step, denom)` to `pmf.js`;
  `defenseFix.js` now uses it for `MO_INVESTIGATE` (`isPdef2`) and
  `bDefRatioAtk` cards (`isPdef1`: Ice Pick / Frozen / Thanatos) so damage
  scaled by a high-VIT target's *random* soft DEF keeps its min–max range
  instead of collapsing to the average factor (e.g. Investigate vs a VIT 100
  target now reads ~5805–6870, not a flat ~6337). Low-VIT targets with no
  soft-DEF variance still resolve to a single value.
- **ASPD %-bonus stacking corrected** — percentage ASPD-rate bonuses
  (Two-Hand / One-Hand / Spear Quicken, Adrenaline, potion `bAspdRate`) were
  applied as two separate floored multiplications, undershooting the real
  value (+30% Quicken and +20% potion gave ×0.70×0.80 = ×0.56 instead of the
  additive ×0.50). `bonus_aspd_percent` is now folded into `scAspdRate` and
  the combined rate is applied once, matching pre-renewal behaviour (fixed
  ASPD reading a couple of points low on buffed builds — e.g. Two-Hand
  Quicken not moving ASPD at all on a Knight/Claymore build).
- **Provoke as a target debuff** — `SC_PROVOKE` (Lv 1–10) added to the target
  debuff panel, lowering the target's soft DEF so it takes more physical
  damage. URL-encoded alongside the build and kept independent of the
  player's own Auto Berserk / Provoke self-buff (turning on one no longer
  toggles the other).
- **PS Demon Bane (AL_DEMONBANE) rework** — Payon Stories buffs Demon Bane
  ([wiki](https://wiki.payonstories.com/Demon_Bane)) from vanilla `+3/lv` to
  `+5/lv`, keeping the `(BaseLv+1)/20` per-level base scaling, and adds a new
  `+4/lv` vs non-Undead/Demon targets. Implemented as a `mastery_ctx_overrides.AL_DEMONBANE`
  entry on the `PAYON_STORIES` profile: `lv × floor(5 + (BaseLv+1)/20)` vs
  Undead-element(9)/Demon-race (→ **100 at Lv10/base 99**, vs vanilla 80), else
  `lv × 4`. Verified end-to-end: Monk (Waghnak[4] + 4× Santa Poring vs Corruptor)
  auto-attack now matches in-game exactly (547 no-Signum / 640 Signum; was 509/603
  — the constant post-DEF gap of ~21 ATK × the +80% card multiplier). Also fixed
  the shared vanilla formula in `masteryFix.js` to floor the per-level multiplier
  like Hercules (`lv × floor(3 + (BaseLv+1)/20)` = 80, was `trunc(lv × (3 + BaseLv/20))`
  = 79) so the `standard` profile is correct too.
- **PS Signum Crucis (AL_CRUCIS) rework** — the target-debuff toggle was
  applying a flat −35% via `def_percent` (which wrongly scales both hard *and*
  soft DEF) and gating on `race === "Undead"`. Corrected to the PS values in
  `ps_skill_db.json` (id 32): a **hard-DEF-only** reduction of `10 + 4×lv`
  → **−50% at Lv10**, applied to `target.def_` in `routes/calculate.ts`, and
  gated on **Undead-element (idx 9) or Demon-race** (Undead is an element, not
  a race — Demon monsters of any element now qualify). Stacks with Provoke.
  Confirmed against [wiki.payonstories.com/Signum_Crucis](https://wiki.payonstories.com/Signum_Crucis)
  and this repo's `ps_skill_db.json`; the two disagree on the level curve (the
  wiki summary showed a 5-level 14→50 curve, `ps_skill_db.json` lists 10 levels
  as `10 + 4×lv`), so the in-repo data was treated as canonical — matches the
  engine's existing (previously dead) `SC_CRUCIS` formula in `targetUtils.js`.
  UI (`BuildEditor.tsx`): `signumApplicable` now checks element/race, and the
  label/tooltip read "−50% hard DEF (10 + 4×lv)". Toggle assumes Lv10.
- **PS Bleeding revamp** — purely data/item-layer changes; no new engine
  modifier code required. Six item script overrides in `ps_item_overrides.json`
  (Breeze Card ATK 5→8 / bleed 5%→2%; Hatii Claw bleed 2%→5%; Hakujin
  13014/13015 +8% bleed; Huuma Giant Wheel Shuriken 13301/13302 bleed removed).
  Breeze Card + Muka Card combo (+6% bleed on hit) added to
  `ps_item_combo_db.json`. `PS_BLEEDING_REVAMP` mechanic flag added to
  `serverProfiles.js` documenting the DOT mechanic change (5% maxHP / 0.5s for
  2.5s, can kill, 35s immunity, cannot inflict on targets ≥15 base levels higher
  than attacker) — the DOT itself is not modelled in the outgoing-damage
  calculator. Skill-side (Wounding Shot, Acid Terror) and mob-side (Skogul,
  Killer Mantis) bleed-chance changes are noted in the changelog but not
  modelled.

- **Dancer/Gypsy Whip equip fix** — `dataLoader.js` now runs a normalisation
  pass over the item DB that remaps the `job` array for any item whose
  `weapon_type` is `"Whip"` from `[19, 4020]` (Bard/Clown, which uses a
  `SEX_MALE` lock in the source data) to `[20, 4021]` (Dancer/Gypsy). Whips
  carry no gender restriction in the source data, so the vanilla DB's bitmask
  was wrong for this equipment class.

- **PS Monk rework — Triple Attack proc** — `MO_TRIPLEATTACK` procs on
  auto-attacks for Monk/Champion; proc rates level-indexed `[28,26,24,22,20]%`,
  Knuckle bonus `+0.2×lv% per 10 job levels`. `MO_TRIPLEATTACK_PS_BONUS`
  mechanic flag gates Fury-conditional crit: when SC_EXPLOSIONSPIRITS is active,
  the proc branch runs a separate crit branch at Fury's crit rate. Six-slot
  attack-definition model covers all crit/proc/miss combinations. `MO_TRIPLEATTACK`
  added to `DAMAGE_RELEVANT` + `ACTIVE_SKILL_TYPE_EXCEPTIONS` so it appears in
  the passive panel.
- **PS Hunter rework** — four offensive trap skills (`HT_LANDMINE`,
  `HT_BLASTMINE`, `HT_FREEZINGTRAP`, `HT_CLAYMORETRAP`) now calculate real
  damage for the `PAYON_STORIES` profile using the reworked INT/DEX-based
  formulas (divisors 45 and 70). Bypasses DEF; element fix, race/size card
  bonuses, `bSkillAtk` bonuses (Dory Card, Wolpertinger Card, Setting Dirk),
  and `bFinalAtk` all still apply. Card bonus values updated in
  `ps_item_manual.json`, `ps_item_overrides.json`, and `ps_item_db.json`.
- **PS Assassin/Thief rework** — katar second-hit proc (now in the
  battlePipeline and exposed as a breakdown branch), Enchant Poison passive
  damage bonus vs Poison-element targets, Envenom weapon-element override,
  dual-wield three-hit auto-attack model (Assassin/Assassin Cross with an
  off-hand weapon: 2×RH×`AS_RIGHT`_factor + LH×`AS_LEFT`_factor per swing),
  and a ×1.10 PS combined-damage bonus (`DUAL_WIELD_PS_DAMAGE_BONUS`) applied
  to the three-hit total — all gated behind `PAYON_STORIES` mechanic flags.
- **PS Crusader rework** (`PSRO_Crusader_Rework_2026.pdf`) — Reflect Shield PS
  formula (`floor(SoftDEF × (1 + 1.75 × HardDEF/100) × lv/10)`, DEF-ignoring,
  hit-checked, element/card-enhanced); DPS suppressed (`dps_valid: false`) since
  it triggers on enemy attack speed, not player ASPD. Armor element resolved via
  `resolveArmorElement` (handles Ghostring card etc.). Spear Quicken grants Hit/
  Flee instead of Crit (`SC_SPEARQUICKEN` in `PS_PASSIVE_OVERRIDES`). Magnum
  Break fire endow restricted to auto-attacks (`SM_MAGNUM_ENDOW_ATTACK_ONLY`
  flag). Stone Discus now only boosts Shield Boomerang (not Shield Charge).
- **PS Knight rework** (`Payon Stories Knight Patch (1).pdf`) — Sword Quickening
  CRIT: +1%/lv via `SC_TWOHANDQUICKEN.cri_per_lv: 10` in `PS_PASSIVE_OVERRIDES`.
  Spear Stab capped at level 5 via `skill_level_cap_overrides`. Blade Mastery
  covers 1H Sword: `mastery_prefer_fallback { SM_SWORD: "KN_TWOHANDMASTERY" }`
  routes 1H Sword mastery to Blade Mastery when the Knight has levels in it.
- **PS Rogue rework** (`Rogue_Patchnotes_PayonStories.pdf`) — Backstab ratio
  corrected to `200+30×lv`% (was `200+40×lv` in PS override). Backstab
  Opportunity (+40% multiplicative) gated on `RG_BACKSTAP_OPPORTUNITY` mechanic
  flag and `support_buffs.backstab_opportunity`; UI checkbox in Skill panel
  (skill ID 212, PS server). Trick Arrow ratio corrected to 200% (2×100% hits).
  Vulture's Eye enables bow Double Attack (`RG_BOW_DOUBLE_ATTACK` flag;
  proc = `doubleRate × min(TF_DOUBLE_lv, AC_VULTURE_lv)`). Yser Card (ID 8236)
  now functional: `bSkillAtk` for RG_BACKSTAP/RG_RAID (+10% each) and +5 HIT.
  `bSkillAtk` bonuses are applied once, inside `calculateSkillRatio()` (a later
  fix removed a duplicate re-application in `_runBranch` that double-counted them).
- Magic pipeline (#1 above moved to "Fully ported").
- Card slots on equipment — up to 4 per item, read from `item.slots`,
  written to `equipped["<slot>_cardN"]`, already consumed by
  `gearBonusAggregator.js` with no engine changes needed.
- Equipment search now filters by `loc` (was returning all `IT_ARMOR`
  items for every armor slot); `left_hand` searches both shields and
  off-hand weapons.
- Passive skill panel, filtered to an explicit allowlist of masteries that
  actually move ATK/MATK/hit/crit/ASPD (see `dataLoader.js#getPassiveSkillsForJob`).
- Grand Cross (`CR_GRANDCROSS`) — see the caveat in the table above; formula
  not verified against Hercules source, re-derive if that becomes possible.
- `BF_WEAPON_RATIOS` (vanilla table in `skillRatio.js`) filled out from 29
  to its full 52 entries, count-verified against upstream, spot-checked
  `GS_BULLSEYE`'s conditional race bonus end-to-end.
- `incoming_physical_pipeline.py` / `incoming_magic_pipeline.py` ported as
  `engine/calculators/incomingPipeline.js` (`calculateIncomingPhysicalDamage`
  / `calculateIncomingMagicDamage`), exposed via `POST /api/calculate/incoming`
  (`{ build, target: { mob_id }, direction: "physical"|"magic", opts }`).
  Reuses `buildManager.playerBuildToTarget` (was ported but never called —
  found and fixed a bug in it: player race was `"DemiHuman"`, every race
  lookup table elsewhere in this engine uses the hyphenated `"Demi-Human"`)
  and `cardFix.js`'s existing incoming-physical/magic functions. Includes
  the Lex Aeterna ×2 multiplier (`SC_LEXAETERNA`). Verified end-to-end
  against a real mob (Scorpion, id 1001) for both directions, and confirmed
  Lex Aeterna exactly doubles the result. No frontend UI yet — backend/API
  only.

## Payon Stories per-class skill audit (against the PS wiki)

The Gunslinger audit (2026-07-07, see the CHANGELOG) cross-checked every PS-reworked
GS skill against [wiki.payonstories.com](https://wiki.payonstories.com) and turned up
several real damage bugs. **This pass has now been completed for all 14 class groups
below** (each verified with a DEF-bearing target, against the class's PS rework PDF where
one exists, else the wiki) — every item is marked ✅ done.
Classes are **sequenced by how many PS-custom overrides they carry** (weapon/magic
ratios, `passive_overrides`, `rate_bonuses`, `weapon_hit_counts`, `mastery_ctx_overrides`,
mechanic flags, …) — more custom changes ⇒ higher chance of a mismatch. Counts in
brackets are the number of PS-custom entries found across those tables.

**Bug classes to check for each skill** (every one of these was hit at least once in the GS pass):
- skill ratio wrong vs the wiki (per-level %, base, or race/size-conditional);
- hit count wrong or missing — single-hit in the vanilla DB but multi-hit on PS
  (e.g. Soul Bullet ×3), or a variable-hit spray (e.g. Desperado 1–10 range);
- passive HIT / ASPD / ATK per level undercounted (e.g. Single Action +4/lv, not +2/lv);
- stat-conversion or weapon-conditional passive not modelled (e.g. Dust +1 ATK/STR with a Shotgun);
- buff mechanic wrong — flat BATK where PS uses a % damage bonus (check `rate_bonuses`);
- an active skill's mastery bonus unreachable because the skill isn't surfaced in the passive
  panel (`DAMAGE_RELEVANT` / `ACTIVE_SKILL_TYPE_EXCEPTIONS` in `dataLoader.js`);
- a skill **removed** on PS still offered (e.g. Increasing Accuracy → gate behind a mechanic flag);
- gear bonuses parsed but dropped (see the bonus-routing audit under "Done this pass").

**Sequence (most PS-custom changes first):**

1. **Gunslinger [16]** — ✅ done. Fixed: Single Action HIT +4/lv, Soul Bullet ×3, Desperado 1–10
   range, Tranq Shot (Bull's Eye) Demi/Brute gate, Increasing Accuracy removed. Confirmed correct:
   Rapid Shower, Gatling Fever (+40% via `rate_bonuses`), Barrage/Madness Canceller (+30%), Wounding
   Shot, Ground Drift, Full Buster, Spread Attack, Triple Action, Chain Action, Snake Eye.
2. **Mage / Wizard / Sage [14]** — ✅ done (verified against the Sage Rework and Wizard/High-Wizard
   PDFs). Fixed: HW_NAPALMVULCAN (flat 100% MATK/hit + Shadow/Dark element + 50% MDEF ignore all
   levels), MG_SOULSTRIKE (flat 100%/hit base; +5%×lv vs-Undead bonus + 50% MDEF-ignore gated on
   lv10 both kept; fixed a vs-Undead crash), WZ_METEOR (flat 100%/hit). Confirmed correct:
   WZ_FROSTNOVA (175+15×lv, +10×FrostDiver, max 5), WZ_VERMILION (200×lv = 2000% @10),
   WZ_SIGHTRASHER (100+75×lv, max 5), WZ_FIREPILLAR (70+2×FireWall per hit × (2+2×lv) hits, +50%
   MDEF ignore, max 5), WZ_EARTHSPIKE / WZ_HEAVENDRIVE (140%/level), MG_FIREBALL (70→340%),
   WZ_AMPLIFYMAGICPOWER (10–50%, max 5), SA_ADVANCEDBOOK (max 5, Atk/ASPD). Not modeled:
   HW_GRAVITATION (fixed build-independent DoT, 400–1200/sec — nothing to compute).
3. **Thief / Assassin [12]** — ✅ done (verified against the Assassin Rework doc). Fixed: Enchant
   Poison / Venom Dust capped at level 5 (Enchant Poison's passive +2%/lv vs Poison-element monsters
   was reaching +20% instead of +10%). Confirmed correct: AS_SONICBLOW (500+40×lv = 900% @10) incl.
   the new crit rules (crit-eligible, Katar ×2 crit chance, crit bypasses DEF, excluded from Katar
   Mastery's +50% crit dmg — verified vs a DEF-100 target), AS_GRIMTOOTH crit, Katar offhand 2nd hit
   (21+4×KatarMastery = 61% @10), Envenom weapon element (TF_POISON_USES_WEAPON_ELEMENT), AS_SPLASHER
   (500+50×lv, max 10), AS_KATAR mastery (+4 ATK/lv, +50% crit dmg @10), Sonic Blow delay
   2000−(4×agi+2×dex), crit-shield removal (PS_CRIT_SHIELD_DISABLED). Added as toggles: Venom Dust
   Mailbreaker debuff (+10% phys & magic damage taken, works on MVP/boss) and the Cloak initiative
   opener (breaking Cloak Lv3+ → auto-attack ×2 / Sonic Blow +10%, per-hit only). Fully modeled.
4. **Rogue / Stalker [7]** — ✅ audited (Rogue Patchnotes PDF, with-DEF). Confirmed correct:
   RG_BACKSTAP (200+30×lv; +40% Opportunity via the `backstab_opportunity` toggle; DEF applies;
   auto-hit / IgnoreFlee), RG_RAID (600% @lv5; DEF applies), Yser Card (+10% Raid & Backstab, +5
   HIT), Vulture's Eye enabling bow Double Attack (proc = min(TF_DOUBLE, AC_VULTURE)). **Blocked:**
   Trick Arrow (PS_RG_TRICKARROW, 200% / 2 hits) and Quick Step (PS_RG_QUICKSTEP, 10%) are now
   resolvable — `getSkill`/`getAllSkills` fall back to `_psCustomBattleSkills()` (battle fields added
   to `ps_skill_db.json`), so both are selectable and compute (DEF applies). Only Holy Strike
   (PS_PR_HOLYSTRIKE) remains unsurfaced — a passive melee proc with a mismatched job array
   ([7, 4008] = Knight/LK) that needs its own review.
5. **Swordsman / Knight [6]** — ✅ done (Knight Patch PDF + wiki, with-DEF). Fixed: **Blade Mastery**
   (SM_TWOHAND, key SM_TWOHANDSWORD) now covers 1H swords — the fallback pointed at a non-existent
   `KN_TWOHANDMASTERY`, so 1H-sword Knights got no mastery ATK; **Counter Attack** always-crits (its
   id was hard-coded 8 = SM_ENDURE; real id 61); **Bowling Bash** scales 100+30×lv (was flat 400%,
   only right at Lv10). Confirmed correct: Counter Attack 200%, Spear Stab 100+40×lv (max 5), Sword
   Quickening (+1% crit/lv, 1H-sword 1/3 ASPD partial), Brandish Spear distance formula, Spear
   Mastery [5,7]. Non-damage rework items (Living Sword SP-free casts, Charge Attack timing) are out
   of a damage calculator's scope.
6. **Monk / Champion [6]** — ✅ done (Monk Rework PDF, with-DEF). All damage-relevant items already
   correct, no code changes: Triple Attack (100+40×lv, max 5; crits under Critical Explosion via the
   `taCritProc` path / MO_TRIPLEATTACK_PS_BONUS), Chain Combo (200+60×lv = 260→500%), Combo Finish
   (255+90×lv = 345→705%), Martial Arts/Iron Hand (MO_IRONHAND +5 ATK/lv +2 FLEE/lv, covers Fist and
   Mace via the PR_MACEMASTERY→MO_IRONHAND fallback), Asura Strike SP rework (consumes 20%×lv×MaxSP;
   ATK×(8+SP/10)+flat), Critical Explosion/Fury (17.5+2.5×lv crit = 20→30% @Lv5), Demon Bane.
   Non-damage items (Absorb Spirits / Spirits Recovery SP, combo-ready buffs, Steel Body
   overcrowding, Ki skills, card sphere-refunds, Fist-weapon drop rates) are out of scope.
7. **Acolyte / Priest [6]** — ✅ done. Fixed: AL_HOLYLIGHT (flat 250% MATK + Cookie card +20% on
   PS, **plus the LUK% chance to deal +60% damage** — modeled as a pmf mixture so avg/range fold in
   the proc), PR_TURNUNDEAD (real fixed-damage formula (BaseLv+INT+SkillLv×10)×3×(1+LUK×3/200), Holy,
   ignores DEF/cards — was wrongly computed as 100% MATK; **now also displays the instant-kill
   success chance** [20×SkillLv + 3×LUK + INT + BaseLv + (1−HP/MaxHP)×200]/10 %, halved if base INT
   < 40, and folds it into Casts/Time to kill). Re-audited against the Acolyte/Priest
   rework PDF: fixed **Holy Strike** (PS_PR_HOLYSTRIKE — corrected its job from Knight [7,4008] to
   Priest [8,4009] and surfaced it via the PS-custom loader; 101+STR+BaseLevel% ATK Holy proc) and
   **Magnus Exorcismus** (full damage now also vs Ghost element + Undead race, not just Undead
   element + Demon race). Confirmed correct: Demon Bane, Mace Mastery (+expanded weapons), Turn
   Undead damage (rework only changed the *success* formula, not the fail-damage). Minor open item:
   Signum Crucis DEF cut is a flat 50% toggle (the rework levels it −14/−23/−32/−41/−50% at Lv1–5;
   50% = max is correct, but it doesn't scale by level).
8. **Crusader / Paladin [5]** — ✅ done (Crusader Rework PDF, with-DEF). Confirmed correct: Holy Cross
   (300+25×lv), Shield Boomerang (100+40×lv), Shield Charge (200+20×lv, NK ignore flee), Reflect
   Shield (SoftDEF×(1+1.75×HardDEF/100)×lv/10, ignores target DEF, hit roll), Spear Quicken (no crit;
   +1 HIT/lv, +1 FLEE/lv), Grand Cross (masteries apply; the SP/pushback changes aren't damage),
   Magnum Break semi-endow (attack-only). **Fixed:** Stone Discus (+5%/refine Shield Boomerang only,
   was +3% to Boomerang+Charge) and — surfaced by it — a broad **item-script arithmetic bug**
   (`getrefine()*N` and any arithmetic bonus value was capped at +1; now evaluated properly, fixing
   every refine-scaling item bonus). Providence's rework is defensive (MDEF, def-penalty) — out of scope.
9. **Ninja [5]** — ✅ done (PS wiki, with-DEF). Confirmed correct: Huuma (200+150×lv = 350→950%),
   Hyousensou (85% MATK/hit × 3–12 hits), Kasumikiri (375% @Lv10 base, ×1.4 while Hiding = 525%),
   Kirikage (Hiding 100/200/400/600/800; Not-Hiding 100/190/280/360/450 − 10×distance; +Crit via
   Shadow's Within), Raigeki Sai (150+60×lv = 210→450%). **Fixed:** Bakuenryu (300→900% = 150+150×lv;
   was a flat 300% from the DB fallback) and **NJ_ISSEN (Killing Stroke)** — implemented its fixed
   HP-sacrifice formula (STR×40 + HP×8%×lv, Neutral, auto-hit, DEF+cards apply) via a dedicated
   `_runKillingStrokeBranch`; was computing a flat 100% ATK. (Mirror Image +10–30% bonus not
   modeled.) Nen/Ki are buffs (out of scope).
10. **Alchemist / Creator [3]** — ✅ done (PS wiki, with-DEF). All correct, no code changes: Acid
    Terror (100+80×lv = 180→500%, ranged physical, auto-hit/IgnoreFlee, DEF applies), Axe Mastery
    (+5 ATK/lv, ASPD buff at Lv10), Acid Demonstration (200+40×lv = 240→400%, weapon-ATK-based with
    size penalty, DEF applies, ignores %-cards but +ATK cards apply — matches the PS wiki's simplified
    ATK% table, not the classic VIT-based Acid Bomb formula). Summons (Bio Cannibalize, Sphere Mine)
    are out of a damage calculator's scope.
11. **Merchant / Whitesmith [3]** — ✅ done (PS wiki, with-DEF). All correct, no code changes:
    Mammonite (100+50×lv = 150→600%; Zeny Pincher toggle → 40% damage / no zeny cost, matches),
    Cart Revolution (250% of normal attack, weapon element), Over Thrust / Power-Thrust (+5%/lv ATK
    to caster AND party — PS grants the party the full bonus — added additively to the skill
    multiplier, per the wiki). Cart Termination isn't a PS skill (the wiki's only "Cart" skill is
    Cart Revolution), so its vanilla-fallback ratio is moot.
12. **Archer / Hunter [3]** — ✅ done (Hunter Rework PDF, with-DEF). All correct, no code changes:
    the PS INT/DEX trap formulas were already implemented and match the PDF's comparison table exactly
    (Land Mine SkillLv×(JobLv+Dex)×(BaseLv+Int)/45, Blast Mine .../45 with Dex/Int roles swapped,
    Freezing Trap & Claymore Trap the same pattern /70 → for 99/50 DEX150/INT100: LandMine 4422,
    BlastMine 4150, FreezingTrap 2842, Claymore 2667). Traps correctly bypass DEF and auto-hit
    (IgnoreDefense/IgnoreFlee). Card bonuses verified applying via bSkillAtk: Dory (+5% Freezing/
    Claymore), Wolpertinger (+5% Land/Blast), Setting Dirk (+5% all four traps). Vulture's Eye
    contributes its +Hit as expected.
13. **Bard / Clown [2]** — ✅ done (PS wiki + in-game skill DB, with-DEF). Fixed **Arrow Vulcan**
    (CG_ARROWVULCAN): it had no ratio in any table and fell back to a flat 100% at every level; now
    `200 + 100×lv` → Lv1 300% … Lv10 1200% (matches vanilla and the PS in-game description; PS did
    not rework it — added to weapon_vanilla_ok). Musical Strike already correct via PS override
    (175+25×lv → Lv1 200%, Lv5 300%). Musical Lesson passive gives +5 ATK/lv as configured. The
    wiki's "+100% while performing" Musical Strike bonus is now modeled via a **Performing**
    target-panel toggle (skill_params.PS_PERFORMING_active → +100 ratio points on Musical Strike /
    Throw Arrow only). Arrow element for these arrow-consuming skills already flows through the
    equipped arrow's `bonus bAtkEle` script (verified: Fire→Earth 1.5, Holy→Shadow 1.25, etc.).
14. **Dancer / Gypsy [2]** — ✅ done (PS wiki, with-DEF). All correct, no code changes: **Throw
    Arrow** (DC_THROWARROW) already carries the PS override `175+25×lv` → Lv1 200%, Lv5 300%
    (the Dancer mirror of Musical Strike, verified live). **Arrow Vulcan** (shared with Gypsy) was
    fixed in item 13 and verified here too (Lv10 1200%). Dancing Lesson passive gives +5 ATK/lv
    and +10% crit at Lv10 as configured. The "+100% while performing" bonus applies here too via
    the same Performing toggle (item 13).

Cross-cutting PS mechanics to keep in view while auditing any class: `PS_BLEEDING_REVAMP`,
`PS_GRANDCROSS_MASTERY_APPLIES`, `SC_AMPLIFYMAGICPOWER_SCALING`, `PS_CRIT_SHIELD_DISABLED`, and the
`SC_TWOHANDQUICKEN` / `SC_SPEARQUICKEN` / `SC_EXPLOSIONSPIRITS` reworks.

### Transcendent / niche combat skills still unmodeled (deferred — 2026-07-10 sweep)

These surfaced in the 2026-07-10 full exposed-skill sweep. They currently fall through to a **flat
100% ratio** (no entry in any ratio table) or need a dedicated branch, and were **not** part of the
per-class audit above (that pass targeted PS-*reworked* 2nd-class skills). No PS wiki pages exist for
them, so the formulas below are **vanilla pre-re** (PR-Hercules `battle.c`) and should be confirmed
against in-game PS behavior before implementing. The user confirmed these classes *are* usable on PS.

Simple ratios (add to `PS_BF_WEAPON_RATIOS` / `BF_WEAPON_RATIOS`; the value is the full % incl. the
100 base):

- **CH_TIGERFIST** (Tiger Knuckle Fist): `40 + 100×lv`. battle.c:2073 (`100×lv − 60`).
- **CH_CHAINCRUSH** (Chain Crush Combo): `400 + 100×lv`. battle.c:2076 (`300 + 100×lv`).
- **CH_PALMSTRIKE** (Raging Palm Strike): `200 + 100×lv`. battle.c:2079 (`100 + 100×lv`).
- **LK_HEADCRUSH** (Head Crush): `100 + 40×lv`. battle.c:2082.
- **LK_JOINTBEAT** (Joint Beat): `50 + 10×lv` base, **×2** with the Break-Neck ailment. battle.c:2085.
- **SN_SHARPSHOOTING** (Sharp Shooting): `200 + 50×lv`; also **auto-critical** (`cri += 200`) and a
  splash skill. battle.c:2094.

Special mechanics (need a dedicated branch, not a plain ratio):

- **PA_PRESSURE** (Gloria Domini): **fixed** damage `500 + 300×lv`, ignores ATK/DEF/element entirely
  (BF_MISC). battle.c:3951.
- **PA_SACRIFICE** (Martyr's Reckoning): **%-of-caster-max-HP** per hit, self-damaging — not an ATK
  ratio. battle.c:2115 / 3948.
- **PA_SHIELDCHAIN** (Shield Chain): shield-weight base + `100 + 30×lv`% ratio; needs shield
  weight/refine inputs. battle.c:2118.
- **LK_SPIRALPIERCE** (Spiral Pierce): weapon-weight × target-size, fixed **5 hits** (pre-re; the
  renewal `50×lv` ratio is `#ifdef RENEWAL` only). battle.c:4834 / 5050.
- **HW_MAGICCRASHER** (Stave Crasher): weapon hit whose base substitutes **MATK** for weapon ATK,
  100% ratio, single hit, pierces MDEF. battle.c:3610 (`flag&4` / `flag.imdef=2`).
- **KN_CHARGEATK** (Charge Attack): distance-tiered **100 / 200 / 300%** (+100% per 3 cells, cap
  300%); needs a distance input. battle.c:2200.

Also drop **HT_POWER** from the picker — it's not a real PS player skill (internal Hercules ID,
`−50 + 8×STR`), not a damage skill to model.

## Suggested order for finishing the port

1. ~~Fill in the rest of `skill_ratio.js`'s `BF_WEAPON_RATIOS` table~~ — done, see above.
2. ~~Port `incoming_physical_pipeline.js` / `incoming_magic_pipeline.js`~~ — done, see above. Still needed: frontend UI for it.
3. ~~Flesh out `PAYON_STORIES` in `serverProfiles.js`~~ — partially done (see
   "Partially ported" above: weapon/magic ratios + vanilla_ok + 4 mechanic
   flags); ~13 mechanic flags still need new modifier code, 3 PS-custom
   skills need a `getSkill()` data-source fix.
4. Remaining BF_MISC skills, then the remaining GUI sections (buffs,
   consumables, combat controls) as their own frontend panels.

## Non-damage clause coverage audit (2026-07-12)

**Why this exists.** The per-class audit above verifies *damage numbers* (ratio × DEF × cards ×
masteries). But many skills carry **non-damage clauses in their description** — accuracy/hit-rate
bonuses, auto-hit, crit enable/bonus, forced element, multi-hit count, ignore/reduce-DEF — that also
change the calculator's output (hit%, crit%, damage, DPS). Those were never a checklist item, so
gaps hid in plain sight (Holy Cross's documented +20% accuracy was in the data the whole time). This
section makes that category a standing punch-list.

**How to re-run the sweep.** Extract every PS player-skill description clause and bucket by whether it
touches calc output. A regex scan over `data/ps/ps_skill_db.json` descriptions for
`accuracy|hit rate|always hit|never miss|ignore (flee|def|mdef)|critical|hits (twice|N times)|forced?
element|reduces? def|size` (dropping NPC_/mercenary/homunc/3rd-job/guild prefixes) flags ~100 skills
across 9 categories. Cross-check each flagged clause against the engine and mark modeled/gap. Prefer
this **description-clause** pass over trusting `levels[].effect` (damage-only) fields.

### Fixed in this pass
- **CR_HOLYCROSS** — +20% accuracy bonus (`hitChance.js` `SKILL_HITRATE_PCT_BONUS`).
- **PA_SHIELDCHAIN** — +20% accuracy bonus (same table; battle.c:4713 groups it with Holy Cross).
- **SN_SHARPSHOOTING / MA_SHARPSHOOTING** — +20 crit was DEAD: `critChance.js` hardcoded ids
  (280/357) never matched the loaded skills.json ids (382/8215). Re-keyed to skill **name**.
- **KN_PIERCE / ML_PIERCE** — hits by target size (Small 1 / Medium 2 / Large 3), was flat 3
  (battle.c:4395 `wd.div_ = size+1`). Added size-based `weapon_hit_counts` fns in `serverProfiles.js`.

### Open gaps (verified, prioritised) — punch-list
- **NJ_KIRIKAGE (Shadow Slash) crit** [med] — dead id (543 vs real 530) AND on PS should only crit
  while **Shadow's Within** is active with a PS-tuned value. Needs `skill_params` threaded into
  `critChance.js` + a source for the crit magnitude. Left disabled (documented in `critChance.js`)
  rather than restored ungated.
- **AS_SONICACCEL** [med] — Sonic Blow's +10% damage is modeled (`skillRatio.js:120`) but the
  accuracy half is missing. **Conflict to resolve:** battle.c:4737 gives `hitrate × 1.5` (+50% of
  hitrate) when Sonic Accel is learned; the PS skill DB says "+50 Hit" (flat). Confirm on the PS wiki
  before implementing.
- **SN_SIGHT (True Sight)** [med, Snipers] — entire self-buff unmodeled: +5 all stats, accuracy,
  +weapon damage %, +crit. Not currently a selectable buff.
- **LK_CONCENTRATION** [med] — only the AGI/DEX% is applied (`statusCalculator.js:62`). Vanilla also
  grants a flat +HIT and an ATK% bonus (the self −DEF is out of scope for outgoing damage). Verify PS
  values before adding.
- **LK_SPIRALPIERCE** [med] — ignore-DEF/soft-DEF works via the `IgnoreDefense` flag, but the
  weapon-weight formula, the inverse size modifier (S 125 / M 100 / L 75%), and the "5 hits, damage
  divided evenly" model are unported → currently computes `100% × 5`. (See BF_MISC list above.)
- **PA_PRESSURE** [med] — fixed level-based damage that ignores DEF and ATK; currently runs through
  the ordinary DEF-reduced weapon-ratio branch. Needs a fixed-damage branch.
- **SL_SMA (Esma)** [low, Soul Linker] — element is `Ele_Endowed` (Warm Wind), absent from
  `ELE_STR_TO_INT`, so the magic branch stays Neutral; Warm Wind endow isn't threaded in.
- **Timing** [low–med, DPS only] — SC_BERSERK +30% ASPD (LK_BERSERK / MS_BERSERK) unmodeled;
  NJ_ZENYNAGE after-cast delay is 5s in the DB vs 2s described; MO_KITRANSLATION / MO_FINGEROFFENSIVE
  / Asura hard-cast PS reworks and the combo-ready instant-cast are unmodeled; SG_STAR_COMFORT /
  SG_DEVIL / SL_CRUSADER ASPD/delay buffs have no consumer.
- **Niche** [low] — AS_CLOAKING attack-from-cloak crit-double; SG_FUSION never-miss + ignore-DEF
  buff; HW_GRAVITATION DEF-ignoring damage (currently NoDamage, pending BF_MISC port); LK_AURABLADE
  flat DEF-ignoring/accuracy-independent damage add; PF_SPIDERWEB Fire ×2.5 vs webbed target.

### Confirmed correct (no action — recorded so they aren't re-flagged)
- **TK_COUNTER** "always hit" — modeled via `damage_type:["IgnoreFlee"]` in skills.json.
- Cosmetic multi-hit convention (negative `number_of_hits`): CR_HOLYCROSS −2, WZ_VERMILION −10,
  AS_SONICBLOW −8, TK_COUNTER −3 — damage applied once, correct.
- Forced elements for traps (Land/Blast/Claymore), GS_MAGICALBULLET (Ghost), the Ninja/Wizard bolts,
  and Grand Cross/Holy Cross (Holy) all resolve correctly; TF_POISON intentionally reverts to weapon
  element on PS (`TF_POISON_USES_WEAPON_ELEMENT`).
- DEF-reduction debuffs (Signum Crucis, Strip Shield/Armor, Mind Breaker, Fling, Eternal Chaos, Steel
  Body, Stone Curse) are representable via `target_active_scs` and consumed by `defenseFix.js` — they
  apply when the caller injects the matching status. (Minor: the *vanilla* Strip Armor branch models
  the MDEF cut as a VIT cut; the PS branch is correct.)
