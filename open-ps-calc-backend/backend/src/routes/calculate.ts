import { Router, Request, Response } from "express";
const { logCalculate } = require("../middleware/statsLogger");
import { createBattleConfig } from "../engine/config";
import { buildFromSaveSchema } from "../engine/buildManager";
import { createSkillInstance, createTarget } from "../engine/models";
import { loader } from "../engine/dataLoader";
import { getProfile } from "../engine/serverProfiles";
import { resolvePlayerState } from "../engine/playerStateBuilder";
import { BattlePipeline } from "../engine/calculators/battlePipeline";
import { calculateIncomingPhysicalDamage, calculateIncomingMagicDamage } from "../engine/calculators/incomingPipeline";
const gearBonusAggregator = require("../engine/gearBonusAggregator");
const { applyPetBonuses } = require("../engine/buildApplicator");
const { computeFalconDamage } = require("../engine/calculators/falconCalc");

const router = Router();

function scaleDamageResult(r: any): any {
  if (!r) return r;
  const newMin = Math.floor(r.min_damage * 2);
  const newMax = Math.floor(r.max_damage * 2);
  const newAvg = Math.floor(r.avg_damage * 2);
  const newPmf: Record<string, number> = {};
  for (const [k, p] of Object.entries(r.pmf as Record<string, number> || {})) {
    const newKey = String(Math.floor(Number(k) * 2));
    newPmf[newKey] = (newPmf[newKey] || 0) + (p as number);
  }
  r.min_damage = newMin;
  r.max_damage = newMax;
  r.avg_damage = newAvg;
  r.pmf = newPmf;
  if (Array.isArray(r.steps)) {
    r.steps.push({
      name: "Lex Aeterna",
      value: newAvg,
      min_value: newMin,
      max_value: newMax,
      multiplier: 2.0,
      note: "×2 damage (SC_LEXAETERNA)",
      formula: "damage × 2",
      hercules_ref: "battle.c: battle_calc_damage (SC_LEXAETERNA)",
    });
  }
  return r;
}

function applyLexAeterna(br: any): void {
  br.normal          = scaleDamageResult(br.normal);
  br.crit            = scaleDamageResult(br.crit);
  br.magic           = scaleDamageResult(br.magic);
  br.katar_second    = scaleDamageResult(br.katar_second);
  br.katar_second_crit = scaleDamageResult(br.katar_second_crit);
  br.double_hit      = scaleDamageResult(br.double_hit);
  br.double_hit_crit = scaleDamageResult(br.double_hit_crit);
  br.second_hit      = scaleDamageResult(br.second_hit);
  br.second_hit_crit = scaleDamageResult(br.second_hit_crit);
  br.lh_normal       = scaleDamageResult(br.lh_normal);
  br.lh_crit         = scaleDamageResult(br.lh_crit);
  br.dw_lh_normal    = scaleDamageResult(br.dw_lh_normal);
  br.dw_lh_crit      = scaleDamageResult(br.dw_lh_crit);
  for (const key of Object.keys(br.proc_branches || {})) {
    br.proc_branches[key] = scaleDamageResult(br.proc_branches[key]);
  }
  br.dps = br.dps * 2;
}

router.post("/", (req: Request, res: Response) => {
  try {
    const { build: buildData, skill: skillInput, target: targetInput, target_mods: targetModsInput } = req.body || {};
    if (!buildData) return res.status(400).json({ error: "build is required" });
    logCalculate(req, buildData?.job_id ?? null, skillInput?.id ?? null);

    const build = buildFromSaveSchema(buildData);
    const profile = getProfile(build.server);
    loader.setProfile(profile);

    const config = createBattleConfig();
    const [gearBonuses, effBuild, weapon, status] = resolvePlayerState(build, config, profile);

    let target;
    if (targetInput && targetInput.mob_id != null) {
      target = loader.getMonster(Number(targetInput.mob_id));
    } else {
      target = createTarget(targetInput || {});
    }

    // Apply target debuffs from target_mods
    if (targetModsInput) {
      const sc: Record<string, boolean> = { ...(target.target_active_scs || {}) };
      // Element status: override element and apply associated SC effects
      if (targetModsInput.element_status === "Poison") {
        target.element = 5;
      } else if (targetModsInput.element_status === "Frozen") {
        target.element = 1;
        sc.SC_FREEZE = true;
      } else if (targetModsInput.element_status === "Stone") {
        target.element = 2;
        sc.SC_STONE = true;
      }
      // Status debuffs
      if (targetModsInput.sleep)  sc.SC_SLEEP  = true;
      if (targetModsInput.stun)   sc.SC_STUN   = true;
      target.target_active_scs = sc;
      // Signum Crucis (PS, AL_CRUCIS): reduces the target's HARD DEF by a
      // level-scaled % — 10 + 4×lv, i.e. 50% at Lv10 (ps_skill_db.json). This
      // is a hard-DEF cut (not def_percent, which would also scale soft DEF),
      // and it only affects Undead-element or Demon-race monsters. Stacks with
      // Provoke. The toggle assumes Lv10 (max), matching the other debuffs.
      if (targetModsInput.signum_crucis && (target.element === 9 || target.race === "Demon")) {
        const signumPct = 50; // Lv10: 10 + 4×10
        target.def_ = Math.max(0, target.def_ - Math.floor(target.def_ * signumPct / 100));
      }
      // Provoke cast on the target: DEF −(5 + 5×lv)% (−55% at Lv10), matching
      // the engine's Provoke convention (def_percent scales both hard and soft
      // DEF in defenseFix). Boss-protocol monsters are immune. Accepts a level
      // 1–10; a legacy boolean `true` from older shared links maps to max (10).
      // Only touches the target — separate from a player's self-cast Provoke /
      // Auto Berserk, which lives on the player's own status.
      const provokeLv = targetModsInput.provoke === true ? 10
        : Math.max(0, Math.min(10, Number(targetModsInput.provoke) || 0));
      if (provokeLv > 0 && !target.is_boss) {
        target.def_percent = Math.max(0, (target.def_percent ?? 100) - (5 + 5 * provokeLv));
      }
      // Quagmire (PS, WZ_QUAGMIRE): the marshland cuts the target's AGI and DEX
      // by 10% per level (max 50% at Lv5), which lowers its flee — it does NOT
      // grant auto-hit. Bosses are immune (only their move speed drops, not
      // modelled here); the effect is halved vs players (PvP). Accepts a level
      // 1–5; a legacy boolean `true` from older shared links maps to max (5).
      const quagLv = targetModsInput.quagmire === true ? 5
        : Math.max(0, Math.min(5, Number(targetModsInput.quagmire) || 0));
      if (quagLv > 0 && !target.is_boss) {
        const pct = target.is_pc ? 5 * quagLv : 10 * quagLv;
        const agiCut = Math.floor(target.agi * pct / 100);
        target.agi = Math.max(0, target.agi - agiCut);
        target.dex = Math.max(0, target.dex - Math.floor(target.dex * pct / 100));
        target.flee = Math.max(0, target.flee - agiCut); // 1 AGI ≈ 1 Flee (pre-re)
      }
    }

    const skill = createSkillInstance({
      id: skillInput ? Number(skillInput.id) || 0 : 0,
      level: skillInput ? Math.max(1, Number(skillInput.level) || 1) : 1,
    });

    const pipeline = new BattlePipeline(config);
    const battleResult = pipeline.calculate(status, weapon, skill, target, effBuild, gearBonuses);

    if (targetModsInput?.lex_aeterna) {
      applyLexAeterna(battleResult);
    }

    const gear_stat_bonuses = {
      str_: gearBonuses.str_, agi: gearBonuses.agi, vit: gearBonuses.vit,
      int_: gearBonuses.int_, dex: gearBonuses.dex, luk: gearBonuses.luk,
    };
    const falcon = computeFalconDamage(status, effBuild, gearBonuses, target, loader);
    res.json({ status, weapon, target, result: battleResult, gear_stat_bonuses, falcon, has_auto_bonuses: gearBonuses.auto_bonuses.length > 0 });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Calculation failed", detail: String(err.message || err) });
  }
});

router.post("/incoming", (req: Request, res: Response) => {
  try {
    const { build: buildData, target: targetInput, direction, opts } = req.body || {};
    if (!buildData) return res.status(400).json({ error: "build is required" });
    if (!targetInput || targetInput.mob_id == null) return res.status(400).json({ error: "target.mob_id is required" });

    const build = buildFromSaveSchema(buildData);
    const profile = getProfile(build.server);
    loader.setProfile(profile);

    const config = createBattleConfig();
    const [gearBonuses, effBuild, weapon, status] = resolvePlayerState(build, config, profile);

    const mobId = Number(targetInput.mob_id);
    const mob = loader.getMonsterData(mobId);
    if (!mob) return res.status(404).json({ error: "Monster not found" });

    const result = direction === "magic"
      ? calculateIncomingMagicDamage(mobId, effBuild, status, gearBonuses, weapon, opts || {})
      : calculateIncomingPhysicalDamage(mobId, effBuild, status, gearBonuses, weapon, config, opts || {});

    res.json({ status, weapon, mob, result });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Calculation failed", detail: String(err.message || err) });
  }
});

router.post("/status", (req: Request, res: Response) => {
  try {
    const { build: buildData } = req.body || {};
    if (!buildData) return res.status(400).json({ error: "build is required" });

    const build = buildFromSaveSchema(buildData);
    const profile = getProfile(build.server);
    loader.setProfile(profile);

    const config = createBattleConfig();
    const [, , weapon, status] = resolvePlayerState(build, config, profile);

    res.json({
      max_hp:    status.max_hp,
      max_sp:    status.max_sp,
      hp_regen:  status.hp_regen,
      sp_regen:  status.sp_regen,
      batk:      status.batk,
      weapon_atk: weapon?.atk ?? 0,
      // Weapon refine bonus (the "atk2" shown as the right-hand number in the
      // in-game status window, e.g. "420 + 35"). Deterministic part only.
      refine_atk: weapon ? loader.getRefineBonus(weapon.level, weapon.refine) : 0,
      matk_min:  status.matk_min,
      matk_max:  status.matk_max,
      hard_def:  status.def_,
      soft_def:  status.def2,
      hard_mdef: status.mdef,
      soft_mdef: status.mdef2,
      aspd:      status.aspd,
      cri:       status.cri,
      flee:      status.flee,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Status calculation failed", detail: String(err.message || err) });
  }
});

router.post("/gear-stat-bonuses", (req: Request, res: Response) => {
  try {
    const { build: buildData } = req.body || {};
    if (!buildData) return res.status(400).json({ error: "build is required" });

    const build = buildFromSaveSchema(buildData);
    const profile = getProfile(build.server);
    loader.setProfile(profile);

    const ctx = gearBonusAggregator.scriptCtxFromBuild(build, null);
    const gb = gearBonusAggregator.compute(build.equipped, build.refine_levels, ctx);
    gearBonusAggregator.applyPassiveBonuses(gb, gb.effective_mastery, profile);
    applyPetBonuses(gb, build.selected_pet, profile);
    gearBonusAggregator.applyComboBonuses(gb, build.equipped, profile, ctx);

    res.json({ str_: gb.str_, agi: gb.agi, vit: gb.vit, int_: gb.int_, dex: gb.dex, luk: gb.luk });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Calculation failed", detail: String(err.message || err) });
  }
});

export default router;
