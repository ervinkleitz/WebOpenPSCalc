/**
 * attrFix.js — JS port of core/calculators/modifiers/attr_fix.py
 * Element damage multiplier.
 */
const { loader } = require("../../dataLoader");
const { getProfile } = require("../../serverProfiles");
const { scaleFloor, pmfStats } = require("../../pmf");

const ENCHANT_EFF = [10, 14, 17, 19, 20];
const PS_ENCHANT_EFF = [10, 15, 20];
const ELE_FIRE = 4, ELE_WATER = 5, ELE_WIND = 6;
const GROUND_ELEMENT = { SC_VOLCANO: ELE_FIRE, SC_DELUGE: ELE_WATER, SC_VIOLENTGALE: ELE_WIND };

function calculateAttrFix(weapon, target, pmf, result, build = null, atkElement = null) {
  const effEle = atkElement != null ? atkElement : weapon.element;
  const defending = loader.getElementName(target.element);
  const attacking = loader.getElementName(effEle);
  let multiplier = loader.getAttrFixMultiplier(attacking, defending, target.element_level || 1);

  if (build != null) {
    const ge = build.support_buffs.ground_effect;
    if (ge in GROUND_ELEMENT && effEle === GROUND_ELEMENT[ge]) {
      const geLv = Number(build.support_buffs.ground_effect_lv || 1);
      const profile = getProfile(build.server);
      const effTable = profile.mechanic_flags.has("GROUND_EFFECT_PS_VALUES") ? PS_ENCHANT_EFF : ENCHANT_EFF;
      const enchantBonus = effTable[geLv - 1];
      multiplier += enchantBonus;
      result.add_step({ name: `${ge} enchant`, value: null, note: `Ground enchant Lv${geLv}: +${enchantBonus}%`, formula: `enchant_eff[${geLv}-1]`, hercules_ref: "battle.c:395-400" });
    }
  }

  pmf = scaleFloor(pmf, multiplier, 100);
  const [mn, mx, av] = pmfStats(pmf);
  result.add_step({
    name: "Attr Fix", value: av, min_value: mn, max_value: mx, multiplier: multiplier / 100,
    note: `${attacking} vs ${defending} Lv${target.element_level || 1} (${multiplier}%)`,
    formula: `dmg * ${multiplier} // 100`, hercules_ref: "battle.c battle_calc_elem_damage",
  });
  return pmf;
}

module.exports = { calculateAttrFix };
