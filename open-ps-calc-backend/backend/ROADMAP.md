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
  **Still missing**: upstream has ~9 more `mechanic_flags` with no consumer
  anywhere in this JS port yet (`SC_CLOAKING_BONUS`,
  `BA_MUSICALSTRIKE_PERFORMING_BONUS`, `DC_THROWARROW_PERFORMING_BONUS`,
  `GS_BLOCK_ENDOW`, `MO_EXTREMITYFIST_NK_NORMAL_DEF`,
  `PR_TURNUNDEAD_PS_BONUS`, `PS_HOLYSTRIKE_PROC`,
  `SC_GS_ADJUSTMENT_LR_REDUCE`, `NJ_ISSEN_MIRROR_BONUS`) — these need new
  modifier code, not just data. (`MG_SOULSTRIKE_MDEF_IGNORE`,
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
several real damage bugs. The same pass should be run for the remaining classes.
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
2. **Mage / Wizard / Sage [14]** — WZ_FROSTNOVA, WZ_VERMILION, WZ_SIGHTRASHER, WZ_FIREPILLAR
   (+MDEF ignore), WZ_EARTHSPIKE, WZ_HEAVENDRIVE, WZ_AMPLIFYMAGICPOWER, HW_NAPALMVULCAN (+MDEF
   ignore), MG_FIREBALL, MG_SOULSTRIKE (MDEF ignore + Undead bonus), SA_ADVANCEDBOOK. Verify magic
   ratios, MDEF-ignore %, and hit counts (Vermilion 4 waves, etc.).
3. **Thief / Assassin [12]** — AS_SONICBLOW, AS_SPLASHER (Venom Splasher), AS_KATAR (2nd hit + crit
   dmg), Enchant Poison passive, Envenom weapon element, dual-wield 3-hit + damage bonus, TF_DOUBLE.
4. **Rogue / Stalker [7]** — RG_BACKSTAP (+Opportunity, bow Double Attack), RG_RAID, Trick Arrow,
   Quick Step, Yser.
5. **Swordsman / Knight [6]** — Bowling Bash, Brandish Spear, Spear Stab, Auto Counter, Magnum endow,
   Sword/Blade Mastery, Two-Hand & Spear Quicken (crit/hit/flee).
6. **Monk / Champion [6]** — Triple Attack (+Fury crit), Chain Combo, Combo Finish, Iron Hand
   (Martial Arts), Extremity Fist SP rework, Demon Bane.
7. **Acolyte / Priest [6]** — Demon Bane, Signum Crucis, Holy Light, Mace Mastery (+expanded
   weapons), Magnus Exorcismus, Holy Strike (PS-custom skill).
8. **Crusader / Paladin [5]** — Holy Cross, Shield Boomerang, Shield Charge (+NK ignore flee),
   Reflect Shield, Spear Quicken, Providence, Grand Cross (masteries apply).
9. **Ninja [5]** — Huuma, Hyousensou, Kasumikiri, Kirikage, Raigeki Sai, Nen (Ki).
10. **Alchemist / Creator [3]** — Acid Terror, Axe Mastery, Acid Demonstration.
11. **Merchant / Whitesmith [3]** — Cart Revolution, Mammonite (Zeny Pincher), Overthrust party.
12. **Archer / Hunter [3]** — Vulture's Eye, Freezing Trap, trap PS formula (already reworked — verify).
13. **Bard / Clown [2]** — Musical Lesson, Musical Strike.
14. **Dancer / Gypsy [2]** — Dancing Lesson, Throw Arrow.

Cross-cutting PS mechanics to keep in view while auditing any class: `PS_BLEEDING_REVAMP`,
`PS_GRANDCROSS_MASTERY_APPLIES`, `SC_AMPLIFYMAGICPOWER_SCALING`, `PS_CRIT_SHIELD_DISABLED`, and the
`SC_TWOHANDQUICKEN` / `SC_SPEARQUICKEN` / `SC_EXPLOSIONSPIRITS` reworks.

## Suggested order for finishing the port

1. ~~Fill in the rest of `skill_ratio.js`'s `BF_WEAPON_RATIOS` table~~ — done, see above.
2. ~~Port `incoming_physical_pipeline.js` / `incoming_magic_pipeline.js`~~ — done, see above. Still needed: frontend UI for it.
3. ~~Flesh out `PAYON_STORIES` in `serverProfiles.js`~~ — partially done (see
   "Partially ported" above: weapon/magic ratios + vanilla_ok + 4 mechanic
   flags); ~13 mechanic flags still need new modifier code, 3 PS-custom
   skills need a `getSkill()` data-source fix.
4. Remaining BF_MISC skills, then the remaining GUI sections (buffs,
   consumables, combat controls) as their own frontend panels.
