import { Router, Request, Response } from "express";
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

router.post("/", (req: Request, res: Response) => {
  try {
    const { build: buildData, skill: skillInput, target: targetInput } = req.body || {};
    if (!buildData) return res.status(400).json({ error: "build is required" });

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

    const skill = createSkillInstance({
      id: skillInput ? Number(skillInput.id) || 0 : 0,
      level: skillInput ? Math.max(1, Number(skillInput.level) || 1) : 1,
    });

    const pipeline = new BattlePipeline(config);
    const battleResult = pipeline.calculate(status, weapon, skill, target, effBuild, gearBonuses);

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
