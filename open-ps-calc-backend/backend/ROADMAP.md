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
  **Still missing**: the upstream profile also has ~13 more `mechanic_flags`
  with no consumer anywhere in this JS port yet (`SC_CLOAKING_BONUS`,
  `BA_MUSICALSTRIKE_PERFORMING_BONUS`, `DC_THROWARROW_PERFORMING_BONUS`,
  `RG_BACKSTAP_OPPORTUNITY_BONUS`, `GS_BLOCK_ENDOW`,
  `MG_SOULSTRIKE_MDEF_IGNORE`, `WZ_FIREPILLAR_MDEF_IGNORE`,
  `MO_EXTREMITYFIST_NK_NORMAL_DEF`, `PR_TURNUNDEAD_PS_BONUS`,
  `PS_HOLYSTRIKE_PROC`, `SC_GS_ADJUSTMENT_LR_REDUCE`,
  `NJ_ISSEN_MIRROR_BONUS`, `MO_TRIPLEATTACK_PS_BONUS`) — these need new
  modifier code, not just data, so left for the `battle_pipeline.js`
  deferred-items pass. Also: 3 of the 36 weapon ratios
  (`PS_RG_TRICKARROW`, `PS_RG_QUICKSTEP`, `PS_PR_HOLYSTRIKE`) are PS-custom
  skills (`ps_custom_constants.json` IDs 2631/2633/2622, defined in
  `ps_skill_db.json`) that **`dataLoader.getSkill()` can't resolve at all**
  — it only ever reads vanilla `db/skills.json` regardless of profile, so
  these 3 skills can't currently be selected/calculated by this engine no
  matter what data exists for them. Real architecture gap, not just a data
  gap — needs `getSkill()` (and skill search) to consult `ps_skill_db.json`
  + `ps_custom_constants.json` when `use_ps_data` is set. The ratio data is
  ready for whenever that's fixed.

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
  having skill levels set). Still deferred: katar second-hit, dual-wield
  left hand, `GS_CHAINACTION`/`MO_TRIPLEATTACK` procs (same shape as
  Double Attack but not yet ported), item autocasts, NJ_ISSEN's
  fixed-damage formula, CR_SHIELDBOOMERANG's special case, several small
  PS-only multiplicative bonuses (Cloaking, Lex Aeterna, Mailbreaker/Venom
  Dust/Raided, Backstab Opportunity, "performing" bonuses), `bDoubleRate`
  gear bonus (cards/items that add to Double Attack's proc chance — no
  consumer in `gearBonusAggregator.js` yet), and `bWeaponAtk` (needs a
  weapon-type → Hercules `W_*` constant table not transcribed here).

## Not yet started

- BF_MISC skills beyond Grand Cross (HT_LANDMINE, TF_THROWSTONE,
  NJ_ZENYNAGE, GS_FLING, BA_DISSONANCE, etc.) — still return "not yet
  implemented".
- `GS_CHAINACTION` / `MO_TRIPLEATTACK` procs — same mechanic shape as the
  now-implemented `TF_DOUBLE`, not yet ported.
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

## Suggested order for finishing the port

1. ~~Fill in the rest of `skill_ratio.js`'s `BF_WEAPON_RATIOS` table~~ — done, see above.
2. ~~Port `incoming_physical_pipeline.js` / `incoming_magic_pipeline.js`~~ — done, see above. Still needed: frontend UI for it.
3. ~~Flesh out `PAYON_STORIES` in `serverProfiles.js`~~ — partially done (see
   "Partially ported" above: weapon/magic ratios + vanilla_ok + 4 mechanic
   flags); ~13 mechanic flags still need new modifier code, 3 PS-custom
   skills need a `getSkill()` data-source fix.
4. Remaining BF_MISC skills, then the remaining GUI sections (buffs,
   consumables, combat controls) as their own frontend panels.
