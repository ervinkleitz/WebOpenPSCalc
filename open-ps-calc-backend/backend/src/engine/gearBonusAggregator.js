/**
 * gearBonusAggregator.js — JS port of core/gear_bonus_aggregator.py
 *
 * Aggregates item script bonuses from all equipped slots into a GearBonuses
 * object. Table-driven via BONUS1/BONUS2 from bonusDefinitions.js.
 */
const { BONUS1, BONUS2, ELE_STR_TO_INT } = require("./bonusDefinitions");
const { loader } = require("./dataLoader");
const { createItemScriptContext, parseScStart, parseScript, makeDescription } = require("./itemScriptParser");
const { createAutocastSpec, createGearBonuses } = require("./models");

// pc.c:3169-3185 + map.h:392-412 — composite race constants fan out at storage time.
const RC_FANOUT = {
  RC_All: ["RC_Boss", "RC_NonBoss"],
  RC_DemiPlayer: ["RC_DemiHuman", "RC_Player"],
  RC_NonDemiPlayer: ["RC_Formless", "RC_Undead", "RC_Brute", "RC_Plant", "RC_Insect", "RC_Fish", "RC_Demon", "RC_Angel", "RC_Dragon"],
  RC_NonPlayer: ["RC_Formless", "RC_Undead", "RC_Brute", "RC_Plant", "RC_Insect", "RC_Fish", "RC_Demon", "RC_DemiHuman", "RC_Angel", "RC_Dragon"],
};

function scriptCtxFromBuild(build, status = null) {
  let maxHp = null, maxSp = null, hp = null, sp = null;
  if (status != null) {
    maxHp = status.max_hp;
    maxSp = status.max_sp;
    hp = build.current_hp != null ? build.current_hp : maxHp;
    sp = build.current_sp != null ? build.current_sp : maxSp;
  }
  return createItemScriptContext({
    refine: 0,
    skill_levels: { ...build.mastery_levels },
    base_level: build.base_level,
    job_level: build.job_level,
    str_: build.base_str,
    agi: build.base_agi,
    vit: build.base_vit,
    int_: build.base_int,
    dex: build.base_dex,
    luk: build.base_luk,
    class_: build.job_id,
    hp, sp, max_hp: maxHp, max_sp: maxSp,
  });
}

function applyEffect(bonuses, eff) {
  const bt = eff.bonus_type;
  const p = eff.params;

  if (eff.arity === 1 && p.length) {
    const defn = BONUS1[bt];
    if (defn == null) return;
    if (defn.mode === "assign" && defn.field != null) {
      const raw = p[0];
      const v = defn.transform ? defn.transform(raw) : raw;
      if (v != null) bonuses[defn.field] = v;
    } else if (defn.mode === "dict_keys" && defn.field != null && defn.keys) {
      const v = typeof p[0] === "number" ? p[0] : 0;
      const d = bonuses[defn.field];
      for (const k of defn.keys) d[k] = (d[k] || 0) + v;
    } else if (defn.mode === "dict" && defn.field != null && typeof p[0] === "string") {
      const d = bonuses[defn.field];
      d[p[0]] = (d[p[0]] || 0) + 1;
    } else {
      const v = typeof p[0] === "number" ? p[0] : 0;
      if (defn.mode === "multi" && defn.fields) {
        for (const f of defn.fields) bonuses[f] += v;
      } else if (defn.field != null) {
        bonuses[defn.field] += v;
      }
    }
  } else if (eff.arity === 2 && p.length >= 2) {
    const defn = BONUS2[bt];
    if (defn == null || defn.field == null) return;
    const key = String(p[0]);
    const val = typeof p[1] === "number" ? p[1] : 0;
    if (defn.mode === "dict") {
      const d = bonuses[defn.field];
      if ((defn.field === "add_race" || defn.field === "magic_add_race") && RC_FANOUT[key]) {
        for (const constituent of RC_FANOUT[key]) d[constituent] = (d[constituent] || 0) + val;
      } else {
        d[key] = (d[key] || 0) + val;
      }
    } else if (defn.mode === "add") {
      bonuses[defn.field] += val;
    }
  }
}

function buildAutocastSpec(bonuses, eff) {
  const p = eff.params;
  const bt = eff.bonus_type;

  if (bt === "bAutoSpell" || bt === "bAutoSpellWhenHit") {
    if (p.length < 3) return;
    const skillName = String(p[0]);
    const skillId = loader.getSkillIdByName(skillName);
    if (skillId == null) return;
    const skillLevel = typeof p[1] === "number" ? p[1] : 1;
    const rate = typeof p[2] === "number" ? p[2] : 0;
    const spec = createAutocastSpec({
      skill_id: skillId, skill_level: skillLevel, chance_per_mille: rate,
      when_hit: bt === "bAutoSpellWhenHit",
    });
    if (bt === "bAutoSpellWhenHit") bonuses.autocast_when_hit.push(spec);
    else bonuses.autocast_on_attack.push(spec);
  } else if (bt === "bAutoSpellOnSkill") {
    if (p.length < 3) return;
    const srcName = String(p[0]);
    const procName = String(p[1]);
    const srcId = loader.getSkillIdByName(srcName);
    const procId = loader.getSkillIdByName(procName);
    if (srcId == null || procId == null) return;
    let procLv, rate;
    if (p.length >= 4) {
      procLv = typeof p[2] === "number" ? p[2] : 1;
      rate = typeof p[3] === "number" ? p[3] : 0;
    } else {
      procLv = 1;
      rate = typeof p[2] === "number" ? p[2] : 0;
    }
    bonuses.autocast_on_skill.push(createAutocastSpec({
      skill_id: procId, skill_level: procLv, chance_per_mille: rate, src_skill_id: srcId,
    }));
  }
}

function compute(equipped, refineLevels = null, scriptCtx = null) {
  const bonuses = createGearBonuses();
  const cardGb = createGearBonuses();
  let refinedefUnits = 0;

  for (const [slot, itemId] of Object.entries(equipped)) {
    if (itemId == null) continue;
    const item = loader.getItem(itemId);
    if (item == null) continue;

    if (item.type === "IT_ARMOR") {
      bonuses.def_ += item.def || 0;
      if (refineLevels != null && (item.refineable ?? true)) {
        const r = refineLevels[slot] || 0;
        if (r > 0) refinedefUnits += loader.getArmorRefineUnits(r);
      }
    }

    const script = item.script || "";
    if (!script) continue;

    const refineSlot = slot.includes("_card") ? slot.slice(0, slot.indexOf("_card")) : slot;
    const refine = (refineLevels || {})[refineSlot] || 0;

    let weaponLevel = null;
    if (slot.includes("_card")) {
      const hostItemId = equipped[refineSlot];
      if (hostItemId != null) {
        const hostItem = loader.getItem(hostItemId);
        if (hostItem == null) {
          throw new Error(`Card slot ${slot}: host item id ${hostItemId} not found in item DB`);
        }
        if (hostItem.type === "IT_WEAPON") {
          const wlv = hostItem.level;
          if (wlv == null) throw new Error(`Card slot ${slot}: weapon host ${hostItemId} has no 'level' field`);
          weaponLevel = wlv;
        }
      }
    }

    const ctx = scriptCtx != null
      ? { ...scriptCtx, refine, weapon_level: weaponLevel }
      : createItemScriptContext({ refine, weapon_level: weaponLevel });

    const effects = parseScript(script, ctx);

    for (const eff of effects) {
      eff.source_slot = slot;
      eff.source_item_id = itemId;
    }
    bonuses.all_effects.push(...effects);

    const isCard = slot.includes("_card");
    const targets = isCard ? [bonuses, cardGb] : [bonuses];

    for (const eff of effects) {
      if (eff.bonus_type === "bAtkEle" && slot === "left_hand") {
        if (eff.arity === 1 && eff.params.length) {
          const v = ELE_STR_TO_INT[String(eff.params[0])];
          if (v != null) bonuses.script_atk_ele_lh = v;
        }
      } else if (["bAutoSpell", "bAutoSpellWhenHit", "bAutoSpellOnSkill"].includes(eff.bonus_type)) {
        for (const t of targets) buildAutocastSpec(t, eff);
      } else if (eff.bonus_type === "skill") {
        const skName = String(eff.params[0]);
        const skLv = typeof eff.params[1] === "number" ? eff.params[1] : 1;
        for (const t of targets) {
          t.skill_grants[skName] = Math.max(t.skill_grants[skName] || 0, skLv);
        }
      } else {
        for (const t of targets) applyEffect(t, eff);
      }
    }

    bonuses.sc_effects.push(...parseScStart(script, ctx));
  }

  if (refinedefUnits > 0) {
    bonuses.def_ += Math.floor((refinedefUnits + 50) / 100);
  }

  bonuses.from_cards = cardGb;

  if (scriptCtx != null) {
    bonuses.effective_mastery = { ...scriptCtx.skill_levels };
    for (const [name, lv] of Object.entries(bonuses.skill_grants)) {
      bonuses.effective_mastery[name] = Math.max(bonuses.effective_mastery[name] || 0, lv);
    }
  } else {
    bonuses.effective_mastery = { ...bonuses.skill_grants };
  }

  return bonuses;
}

function applyPassiveBonuses(bonuses, masteryLevels, profile = null) {
  const crTrustLv = masteryLevels.CR_TRUST || 0;
  if (crTrustLv) {
    bonuses.sub_ele.Ele_Holy = (bonuses.sub_ele.Ele_Holy || 0) + crTrustLv * 5;
  }

  const saDragonLv = masteryLevels.SA_DRAGONOLOGY || 0;
  if (saDragonLv) {
    bonuses.add_race.RC_Dragon = (bonuses.add_race.RC_Dragon || 0) + saDragonLv * 4;
    bonuses.magic_add_race.RC_Dragon = (bonuses.magic_add_race.RC_Dragon || 0) + saDragonLv * 4;
    bonuses.sub_race.RC_Dragon = (bonuses.sub_race.RC_Dragon || 0) + saDragonLv * 4;
  }

  if (profile != null) {
    for (const [skillKey, spec] of Object.entries(profile.passive_overrides || {})) {
      const addele = spec.addele_per_lv;
      if (!addele) continue;
      const lv = masteryLevels[skillKey] || 0;
      if (lv > 0) {
        for (const [eleKey, perLv] of Object.entries(addele)) {
          bonuses.add_ele[eleKey] = (bonuses.add_ele[eleKey] || 0) + lv * perLv;
        }
      }
    }
  }
}

function applyComboBonuses(bonuses, equipped, profile = null, scriptCtx = null) {
  const equippedAegis = new Set();
  for (const itemId of Object.values(equipped)) {
    if (itemId == null) continue;
    const item = loader.getItem(itemId);
    if (item && item.aegis_name) equippedAegis.add(item.aegis_name);
  }
  if (!equippedAegis.size) return;

  const active = loader.getActiveCombos(equippedAegis, profile);
  for (const combo of active) {
    const effects = parseScript(combo.script, scriptCtx);
    for (const eff of effects) {
      if (eff.bonus_type === "skill") {
        const skName = String(eff.params[0]);
        const skLv = typeof eff.params[1] === "number" ? eff.params[1] : 1;
        bonuses.skill_grants[skName] = Math.max(bonuses.skill_grants[skName] || 0, skLv);
      } else {
        applyEffect(bonuses, eff);
      }
    }

    const itemLabels = combo.items
      .map((name) => (loader.getItemByAegis(name) || {}).name || name)
      .join(" + ");
    const effectDescs = effects
      .filter((e) => !e.description.startsWith("["))
      .map((e) => makeDescription(e.bonus_type, e.arity, e.params));
    if (effectDescs.length) {
      bonuses.active_combo_descriptions.push(`${itemLabels}: ${effectDescs.join(", ")}`);
    }
  }
}

module.exports = {
  scriptCtxFromBuild,
  compute,
  applyPassiveBonuses,
  applyComboBonuses,
  applyEffect,
};
