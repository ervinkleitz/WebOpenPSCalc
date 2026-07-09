/**
 * defenseFix.js — JS port of core/calculators/modifiers/defense_fix.py
 */
const { scaleFloor, scaleFloorNumRange, subtractUniform, floorAt, pmfStats } = require("../../pmf");

const ELE_INT_TO_KEY = [
  "Ele_Neutral", "Ele_Water", "Ele_Earth", "Ele_Fire",
  "Ele_Wind", "Ele_Poison", "Ele_Holy", "Ele_Dark", "Ele_Ghost", "Ele_Undead",
];

const RACE_TO_RC = {
  Formless: "RC_Formless", Undead: "RC_Undead", Brute: "RC_Brute",
  Plant: "RC_Plant", Insect: "RC_Insect", Fish: "RC_Fish",
  Demon: "RC_Demon", "Demi-Human": "RC_DemiHuman", Angel: "RC_Angel", Dragon: "RC_Dragon",
};

function calculateDefenseFix(target, build, gearBonuses, pmf, config, result, opts = {}) {
  const { is_crit: isCrit = false, skill = null } = opts;

  const nkIgnore = skill != null ? skill.nk_ignore_def : false;
  if (isCrit || nkIgnore) {
    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({
      name: "Defense Fix", value: av, min_value: mn, max_value: mx, multiplier: 1.0,
      note: `BYPASSED — ${isCrit ? "crit" : "NK_IGNORE_DEF"} sets flag.idef=flag.idef2=1`,
      formula: "no change (defense skipped)", hercules_ref: "battle.c:4988-4989 / 4673",
    });
    return pmf;
  }

  let def1 = Math.max(0, Math.min(100, target.def_));

  const targetScs = target.target_active_scs;
  if (targetScs.SC_STONE || targetScs.SC_FREEZE) def1 = def1 >> 1;

  const raceRc = RACE_TO_RC[target.race] || "";
  const bossRc = target.is_boss ? "RC_Boss" : "RC_NonBoss";
  const targetEleKey = target.element >= 0 && target.element < ELE_INT_TO_KEY.length ? ELE_INT_TO_KEY[target.element] : "";
  const ignorePct = (gearBonuses.ignore_def_rate[raceRc] || 0)
    + (gearBonuses.ignore_def_rate[bossRc] || 0)
    + (gearBonuses.ignore_def_ele[targetEleKey] || 0);

  let noteDef;
  if (build.ignore_hard_def || ignorePct >= 100) {
    def1 = 0;
    noteDef = "Hard DEF ignored (100%)";
  } else if (ignorePct > 0) {
    def1 = Math.max(0, Math.floor(def1 * (100 - ignorePct) / 100));
    noteDef = `Hard DEF ${target.def_} → ${def1} (-${ignorePct}% ignored)`;
  } else {
    noteDef = `Hard DEF ${def1}`;
  }

  if (skill != null && skill.name === "AM_ACIDTERROR") {
    def1 = 0;
    noteDef = "Hard DEF forced 0 (AM_ACIDTERROR)";
  }

  let def2 = Math.max(1, target.vit);
  if (targetScs.SC_ETERNALCHAOS) def2 = 0;

  if (config.vit_penalty_type !== 0 && (config.vit_penalty_target & (target.is_pc ? 1 : 2)) !== 0) {
    const targetCount = target.targeted_count;
    if (targetCount >= config.vit_penalty_count) {
      const penalty = (targetCount - (config.vit_penalty_count - 1)) * config.vit_penalty_num;
      if (config.vit_penalty_type === 1) {
        def1 = Math.floor(def1 * (100 - penalty) / 100);
        def2 = Math.floor(def2 * (100 - penalty) / 100);
      } else {
        def1 -= penalty;
        def2 -= penalty;
      }
    }
  }

  if (ignorePct > 0) {
    const effIgnore = build.ignore_hard_def || ignorePct >= 100 ? 100 : ignorePct;
    def2 = Math.max(0, def2 - Math.floor(def2 * effIgnore / 100));
  }

  const isPdef2 = skill != null && skill.name === "MO_INVESTIGATE";
  const isPdef1 = !isPdef2 && (
    (gearBonuses.def_ratio_atk_ele[targetEleKey] || 0) > 0 ||
    (gearBonuses.def_ratio_atk_race[raceRc] || 0) > 0 ||
    (gearBonuses.def_ratio_atk_race[bossRc] || 0) > 0 ||
    (gearBonuses.def_ratio_atk_race.RC_All || 0) > 0
  );

  let vdMin, vdMax, vdAvg, noteType;
  if (target.is_pc) {
    const varianceMax = Math.floor(def2 * (def2 - 15) / 150);
    vdMin = Math.floor(def2 / 2);
    vdMax = Math.floor(def2 / 2) + (varianceMax > 0 ? varianceMax - 1 : 0);
    vdAvg = Math.floor(def2 / 2) + (varianceMax > 0 ? Math.floor(varianceMax / 2) : 0);
    const dp = target.def_percent ?? 100;
    if (dp !== 100) {
      vdMin = Math.floor(vdMin * dp / 100);
      vdMax = Math.floor(vdMax * dp / 100);
      vdAvg = Math.floor(vdAvg * dp / 100);
    }
    noteType = "PC";
  } else {
    const varianceMax = Math.floor(def2 / 20) * Math.floor(def2 / 20);
    vdMin = def2;
    vdMax = def2 + (varianceMax > 0 ? varianceMax - 1 : 0);
    vdAvg = def2 + (varianceMax > 0 ? Math.floor(varianceMax / 2) : 0);
    const mobDp = target.def_percent;
    if (mobDp !== 100) {
      def1 = Math.floor(def1 * mobDp / 100);
      vdMin = Math.floor(vdMin * mobDp / 100);
      vdMax = Math.floor(vdMax * mobDp / 100);
      vdAvg = Math.floor(vdAvg * mobDp / 100);
    }
    noteType = "monster";
  }

  if (isPdef2) {
    // damage = dmg * 2*(def1 + vit_def) / 100, and vit_def is random over
    // [vdMin, vdMax] → the factor ranges [2*(def1+vdMin), 2*(def1+vdMax)] in
    // steps of 2. Apply the whole range so the output keeps a real min–max.
    pmf = scaleFloorNumRange(pmf, 2 * (def1 + vdMin), 2 * (def1 + vdMax), 2, 100);
    pmf = floorAt(pmf, 1);
    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Defense Fix", value: av, min_value: mn, max_value: mx, multiplier: (2 * (def1 + vdAvg)) / 100, note: `MO_INVESTIGATE pdef=2: ${noteDef} + vit_def [${vdMin},${vdMax}] (${noteType})`, formula: `dmg * 2 * (def1+vit_def) / 100`, hercules_ref: "battle.c:4759, 1539" });
  } else if (isPdef1) {
    pmf = scaleFloorNumRange(pmf, def1 + vdMin, def1 + vdMax, 1, 100);
    pmf = floorAt(pmf, 1);
    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Defense Fix", value: av, min_value: mn, max_value: mx, multiplier: (def1 + vdAvg) / 100, note: `pdef=1 (def_ratio card): ${noteDef} + vit_def [${vdMin},${vdMax}] (${noteType})`, formula: `dmg * (def1+vit_def) / 100`, hercules_ref: "battle.c:5686/5694, 1539" });
  } else {
    pmf = scaleFloor(pmf, 100 - def1, 100);
    pmf = subtractUniform(pmf, vdMin, vdMax);
    pmf = floorAt(pmf, 1);
    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Defense Fix", value: av, min_value: mn, max_value: mx, multiplier: 1.0, note: `${noteDef} → ×${((100 - def1) / 100 * 100).toFixed(0)}% + Soft DEF [${vdMin},${vdMax}] avg ${vdAvg} (${noteType})`, formula: `max(1, dmg*(100-def1)//100 - vit_def)`, hercules_ref: "battle.c calc_defense" });
  }

  return pmf;
}

function calculateMagicDefenseFix(target, gearBonuses, pmf, result, mdefIgnorePct = 0) {
  let mdef = Math.max(0, Math.min(100, target.mdef_));
  if (target.mdef_percent !== 100) mdef = Math.max(0, Math.min(100, Math.floor(mdef * target.mdef_percent / 100)));
  if (target.target_active_scs.SC_STONE || target.target_active_scs.SC_FREEZE) {
    mdef = Math.min(100, mdef + Math.floor(25 * mdef / 100));
  }
  const mdef2 = target.int_ + (target.vit >> 1);

  const raceRc = RACE_TO_RC[target.race] || "";
  const bossRc = target.is_boss ? "RC_Boss" : "RC_NonBoss";
  let ignorePct = (gearBonuses.ignore_mdef_rate[raceRc] || 0) + (gearBonuses.ignore_mdef_rate[bossRc] || 0);
  let noteIgnore = "";
  if (ignorePct > 0) {
    ignorePct = Math.min(100, ignorePct);
    mdef = Math.max(0, mdef - Math.floor(mdef * ignorePct / 100));
    noteIgnore = ` (-${ignorePct}% ignored → ${mdef})`;
  }
  // PS skill MDEF-ignore (Fire Pillar / Napalm Vulcan / Soul Strike Lv10) ignores
  // 50% of BOTH the hard (%) and soft (flat) Magic Defense — see the Sage Rework
  // and Wizard/High-Wizard rework docs ("both the hard and soft defense").
  let effMdef2 = mdef2;
  if (mdefIgnorePct > 0) {
    mdef = Math.max(0, mdef - Math.floor(mdef * mdefIgnorePct / 100));
    effMdef2 = Math.max(0, mdef2 - Math.floor(mdef2 * mdefIgnorePct / 100));
    noteIgnore += ` (-${mdefIgnorePct}% hard+soft MDEF ignored → hard ${mdef}, soft ${effMdef2})`;
  }

  pmf = scaleFloor(pmf, 100 - mdef, 100);
  pmf = subtractUniform(pmf, effMdef2, effMdef2);
  pmf = floorAt(pmf, 1);

  const [mn, mx, av] = pmfStats(pmf);
  result.add_step({ name: "Magic Defense Fix", value: av, min_value: mn, max_value: mx, multiplier: 1.0, note: `MDEF ${target.mdef_}${noteIgnore} → ×${100 - mdef}% - mdef2 ${effMdef2}`, formula: "max(1, dmg*(100-mdef)//100 - mdef2)", hercules_ref: "battle.c:1585" });
  return pmf;
}

module.exports = { calculateDefenseFix, calculateMagicDefenseFix };
