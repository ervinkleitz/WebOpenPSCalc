/**
 * attrFix.js — JS port of core/calculators/modifiers/attr_fix.py
 * Element damage multiplier.
 */
const { loader } = require("../../dataLoader");
const { getProfile } = require("../../serverProfiles");
const { scaleFloor, pmfStats } = require("../../pmf");

const ENCHANT_EFF = [10, 14, 17, 19, 20];
const PS_ENCHANT_EFF = [10, 15, 20];
// Must match this engine's actual element index convention (see
// ELE_STR_TO_INT in battlePipeline.js): Neutral=0, Water=1, Earth=2,
// Fire=3, Wind=4, Poison=5, Holy=6, Dark=7, Ghost=8, Undead=9. This file
// previously used 4/5/6, which silently matched Wind/Poison/Holy weapons
// instead of Fire/Water/Wind for the Volcano/Deluge/Violent Gale enchant
// bonus -- found while verifying the ground-effect UI end-to-end.
const ELE_FIRE = 3, ELE_WATER = 1, ELE_WIND = 4;
const GROUND_ELEMENT = { SC_VOLCANO: ELE_FIRE, SC_DELUGE: ELE_WATER, SC_VIOLENTGALE: ELE_WIND };
const GROUND_NAME = { SC_VOLCANO: "Volcano", SC_DELUGE: "Deluge", SC_VIOLENTGALE: "Violent Gale" };

function calculateAttrFix(weapon, target, pmf, result, build = null, atkElement = null) {
  const effEle = atkElement != null ? atkElement : weapon.element;
  const defending = loader.getElementName(target.element);
  const attacking = loader.getElementName(effEle);
  let multiplier = loader.getAttrFixMultiplier(attacking, defending, target.element_level || 1);

  // The field enchant (battle.c:395-400) is added to the element RATE, not to the
  // damage — Violent Gale on a Wind attack makes 200% into 220%. So it belongs to
  // THIS step's multiplier, and the breakdown says so in this step's note.
  //
  // It used to get an add_step of its own carrying `value: null`, the only step in
  // the engine with no running total. The breakdown read that missing total as zero
  // and reported the whole running damage as lost, so a Sage read Violent Gale as
  // making Lightning Bolt weaker (2026-10-20) when it had in fact made it stronger.
  // A row that changes nothing on its own line should not be a row; the provenance
  // it existed to carry is in the note below, beside the number it moves.
  const elementRate = multiplier;
  let enchantBonus = 0, enchantName = "";
  if (build != null) {
    const ge = build.support_buffs.ground_effect;
    if (ge in GROUND_ELEMENT && effEle === GROUND_ELEMENT[ge]) {
      const geLv = Number(build.support_buffs.ground_effect_lv || 1);
      const profile = getProfile(build.server);
      const effTable = profile.mechanic_flags.has("GROUND_EFFECT_PS_VALUES") ? PS_ENCHANT_EFF : ENCHANT_EFF;
      // Clamp, the way statusCalculator already clamps PS_VOL_ATK, PS_VOL_MATK_PCT
      // and PS_VG_FLEE. This table was the only one of the four that indexed raw,
      // and PS's is three entries where vanilla's is five — so a build carrying
      // Lv4 or Lv5 read past the end, `multiplier += undefined` turned the element
      // rate into NaN, and the hit silently collapsed to the 1-damage floor.
      // Reachable without editing anything: set the field on Standard pre-renewal,
      // where the editor offers Lv5, then switch the server to Payon Stories — the
      // level stays at 5. Found QA-ing the ground-effect work, 2026-10-27.
      const geIdx = Math.min(Math.max(1, geLv), effTable.length) - 1;
      enchantBonus = effTable[geIdx];
      // The note names the level that was APPLIED, not the one the build asked
      // for: "Violent Gale Lv5 = 220%" on a server whose table stops at 3 reads
      // like an error in the arithmetic rather than a clamp.
      enchantName = `${GROUND_NAME[ge]} Lv${geIdx + 1}`;
      multiplier += enchantBonus;
    }
  }

  pmf = scaleFloor(pmf, multiplier, 100);
  const [mn, mx, av] = pmfStats(pmf);
  const lv = target.element_level || 1;
  result.add_step({
    name: "Attr Fix", value: av, min_value: mn, max_value: mx, multiplier: multiplier / 100,
    note: enchantBonus
      ? `${attacking} vs ${defending} Lv${lv}: ${elementRate}% +${enchantBonus}% ${enchantName} = ${multiplier}%`
      : `${attacking} vs ${defending} Lv${lv} (${multiplier}%)`,
    formula: enchantBonus
      ? `dmg * (${elementRate} + ${enchantBonus}) // 100`
      : `dmg * ${multiplier} // 100`,
    hercules_ref: "battle.c battle_calc_elem_damage",
  });
  return pmf;
}

module.exports = { calculateAttrFix };
