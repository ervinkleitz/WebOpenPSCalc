/**
 * statusCalculator.js — JS port of core/calculators/status_calculator.py
 *
 * Computes all derived player stats (BATK, HIT, FLEE, CRI, ASPD, MaxHP,
 * MaxSP, MATK, MDEF, DEF, regen) from a resolved PlayerBuild + Weapon +
 * GearBonuses. Pre-renewal formulas only.
 */
const { effectiveIsRanged } = require("../buildManager");
const { loader } = require("../dataLoader");
const { createStatusData } = require("../models");
const { getProfile } = require("../serverProfiles");

const GUN_WEAPON_TYPES = new Set(["Revolver", "Rifle", "Gatling", "Shotgun", "Grenade"]);
const ADRENALINE_WEAPONS = new Set(["1HAxe", "2HAxe", "Mace"]);
const BOW_GUN_WEAPONS = new Set(["Bow", "Revolver", "Rifle", "Gatling", "Shotgun", "Grenade"]);
const TF_MISS_JOBL2 = new Set([12, 17, 4013, 4018]);
const DUAL_WIELD_JOBS = new Set([12, 4013]);
const DELUGE_EFF = [5, 9, 12, 14, 15];
const PS_VG_FLEE = [3, 8, 15];
const PS_VOL_MATK_PCT = [2, 4, 6];

class StatusCalculator {
  constructor(config) {
    this.config = config;
  }

  calculate(build, weapon, gb = null) {
    const status = createStatusData();
    const profile = getProfile(build.server);
    const mastery = gb != null ? gb.effective_mastery : build.mastery_levels;

    const psJb = (profile.ps_job_bonuses || {})[build.job_id];
    let jb;
    if (psJb != null) {
      jb = { str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 };
      for (const [lv, stat] of psJb) {
        if (lv <= build.job_level) jb[stat] += 1;
      }
    } else {
      jb = loader.getJobBonusStats(build.job_id, build.job_level);
    }

    status.str = build.base_str + build.bonus_str + jb.str_;
    status.agi = build.base_agi + build.bonus_agi + jb.agi;
    status.vit = build.base_vit + build.bonus_vit + jb.vit;
    status.int_ = build.base_int + build.bonus_int + jb.int_;
    status.dex = build.base_dex + build.bonus_dex + jb.dex;
    status.luk = build.base_luk + build.bonus_luk + jb.luk;

    const support = build.support_buffs;
    const activeSc = build.active_status_levels;

    // === PASSIVE SKILL STAT BONUSES ===
    if (mastery.BS_HILTBINDING) status.str += 1;
    const saDragonologyLv = mastery.SA_DRAGONOLOGY || 0;
    if (saDragonologyLv) status.int_ += Math.floor((saDragonologyLv + 1) / 2);
    const acOwlLv = mastery.AC_OWL || 0;
    if (acOwlLv) status.dex += acOwlLv;

    const intForMaxsp = status.int_;
    const vitForMaxhp = status.vit;

    // === SC STAT MODIFIERS ===
    if ("SC_SHOUT" in activeSc) status.str += 4;

    if ("SC_NJ_NEN" in activeSc) {
      const lv = activeSc.SC_NJ_NEN;
      const nenSpec = (profile.passive_overrides || {}).SC_NJ_NEN || {};
      status.str += lv * (nenSpec.str_per_lv ?? 1);
      status.int_ += lv * (nenSpec.int_per_lv ?? 1);
    }

    if ("SC_CONCENTRATION" in activeSc && !("SC_QUAGMIRE" in build.player_active_scs)) {
      const lv = activeSc.SC_CONCENTRATION;
      const val2 = 2 + lv;
      const cards = gb != null ? gb.from_cards : null;
      status.agi += Math.floor((status.agi - (cards ? cards.agi : 0)) * val2 / 100);
      status.dex += Math.floor((status.dex - (cards ? cards.dex : 0)) * val2 / 100);
    }

    const blessingLv = support.SC_BLESSING || 0;
    if (blessingLv) {
      status.str += blessingLv;
      status.int_ += blessingLv;
      status.dex += blessingLv;
    }

    const incAgiLv = support.SC_INC_AGI || 0;
    if (incAgiLv) status.agi += 2 + incAgiLv;

    if (support.SC_GLORIA) status.luk += 30;

    if ("SC_GS_ACCURACY" in activeSc) {
      status.agi += 4;
      status.dex += 4;
    }

    const playerScs = build.player_active_scs;
    if ("SC_DECREASEAGI" in playerScs) status.agi -= 2 + playerScs.SC_DECREASEAGI;
    if ("SC_CURSE" in playerScs) status.luk = 0;

    // === BASE ATK ===
    let strVal = status.str;
    let dexVal = status.dex;
    if (effectiveIsRanged(build, weapon)) { const t = strVal; strVal = dexVal; dexVal = t; }
    const dstr = Math.floor(strVal / 10);
    status.batk = strVal + dstr * dstr + Math.floor(dexVal / 5) + Math.floor(status.luk / 5);
    status.batk += build.bonus_batk;

    if (mastery.BS_HILTBINDING) status.batk += 4;

    if ("SC_GS_MADNESSCANCEL" in activeSc && !("SC_GS_MADNESSCANCEL" in (profile.rate_bonuses || {}))) {
      status.batk += 100;
    }
    if ("SC_GS_GATLINGFEVER" in activeSc && !("SC_GS_GATLINGFEVER" in (profile.rate_bonuses || {}))) {
      const lv = activeSc.SC_GS_GATLINGFEVER;
      status.batk += 20 + 10 * lv;
    }
    if ("SC_CURSE" in playerScs) status.batk = Math.floor(status.batk * 75 / 100);

    // === DEFENSE ===
    status.def_ = build.equip_def;
    status.def2 = status.vit + build.bonus_def2;

    const angelusLv = Number(support.SC_ANGELUS || 0);
    status.def_percent = 100 + 5 * angelusLv;

    if ("SC_POISON" in playerScs) {
      const penalty = build.server === "payon_stories" ? 50 : 25;
      status.def_percent = Math.max(0, status.def_percent - penalty);
    }
    if ("SC_PROVOKE" in playerScs) {
      status.def_percent = Math.max(0, status.def_percent - (5 + 5 * Number(playerScs.SC_PROVOKE)));
    }
    if ("SC_FLING" in playerScs) {
      status.def_percent = Math.max(0, status.def_percent - 5 * Number(playerScs.SC_FLING));
    }
    if (status.def_percent !== 100) status.def2 = Math.floor(status.def2 * status.def_percent / 100);
    if ("SC_ETERNALCHAOS" in playerScs) status.def2 = 0;

    const alDpLv = mastery.AL_DP || 0;
    if (alDpLv && build.target_mob_id) {
      const alMob = loader.getMonster(build.target_mob_id);
      if (alMob && (alMob.race === "Demon" || alMob.race === "Undead")) {
        status.def2 += alDpLv * (3 + Math.floor((build.base_level + 1) * 4 / 100));
      }
    }

    if ("SC_STEELBODY" in activeSc) {
      if (profile.steelbody_override != null) status.def_ = profile.steelbody_override[0](build.equip_def);
      else status.def_ = 90;
    }

    // === CRITICAL ===
    status.cri = 10 + Math.floor(status.luk * 10 / 3) + build.bonus_cri * 10;

    if ("SC_EXPLOSIONSPIRITS" in activeSc) {
      const lv = activeSc.SC_EXPLOSIONSPIRITS;
      status.cri += 75 + 25 * lv;
    }

    if (weapon.weapon_type === "Katar" && (mastery.AS_KATAR || 0) >= 10) {
      const spec = (profile.passive_overrides || {}).AS_KATAR || {};
      status.cri += spec.cri_at_max_lv || 0;
    }
    if ((mastery.DC_DANCINGLESSON || 0) >= 10) {
      const spec = (profile.passive_overrides || {}).DC_DANCINGLESSON || {};
      status.cri += spec.cri_at_max_lv || 0;
    }

    // === HIT / FLEE ===
    status.hit = build.base_level + status.dex + build.bonus_hit;
    status.flee = build.base_level + status.agi + build.bonus_flee;
    status.flee2 = this.config.enable_perfect_flee ? status.luk + 10 + build.bonus_flee2 : 0;

    if ("SC_GS_ACCURACY" in activeSc) status.hit += 20;

    if ("SC_GS_ADJUSTMENT" in activeSc) {
      if (!profile.mechanic_flags.has("GS_GS_ADJUSTMENT_SKIP_HIT_PENALTY")) status.hit -= 30;
      status.flee += 30;
    }
    if ("SC_RG_CCONFINE_M" in activeSc) status.flee += 10;
    if ("SC_GS_GATLINGFEVER" in activeSc) {
      const lv = activeSc.SC_GS_GATLINGFEVER;
      const gfQuicken = ((profile.aspd_buffs || {}).SC_GS_GATLINGFEVER || {}).sc_quicken || {};
      if (!gfQuicken.flee_suppress) status.flee -= 5 * lv;
    }

    if (support.ground_effect === "SC_VIOLENTGALE") {
      const vgLv = Number(support.ground_effect_lv || 1);
      let vgFlee;
      if (profile.mechanic_flags.has("GROUND_EFFECT_PS_VALUES")) {
        vgFlee = PS_VG_FLEE[Math.min(vgLv, PS_VG_FLEE.length) - 1];
      } else {
        vgFlee = vgLv * 3;
      }
      status.flee += vgFlee;
    }

    const tqSpec = (profile.passive_overrides || {}).SC_TWOHANDQUICKEN || {};
    if ("SC_TWOHANDQUICKEN" in activeSc) {
      const lv = activeSc.SC_TWOHANDQUICKEN;
      status.flee += (tqSpec.flee_per_lv || 0) * lv;
      status.cri += (tqSpec.cri_per_lv || 0) * lv;
    }
    const sqStatSpec = (profile.passive_overrides || {}).SC_SPEARQUICKEN || {};
    if ("SC_SPEARQUICKEN" in activeSc) {
      const lv = activeSc.SC_SPEARQUICKEN;
      status.cri += (sqStatSpec.cri_per_lv || 0) * lv;
    }

    // === PASSIVE SKILL HIT/FLEE BONUSES ===
    const bsWrLv = mastery.BS_WEAPONRESEARCH || 0;
    if (bsWrLv) status.hit += bsWrLv * 2;

    const acVultureLv = mastery.AC_VULTURE || 0;
    if (acVultureLv) status.hit += acVultureLv;

    const gsSaLv = mastery.GS_SINGLEACTION || 0;
    if (gsSaLv && GUN_WEAPON_TYPES.has(weapon.weapon_type)) {
      const gsSaHit = ((profile.passive_overrides || {}).GS_SINGLEACTION || {}).hit_per_lv ?? 2;
      status.hit += gsSaHit * gsSaLv;
    }
    const gsSeLv = mastery.GS_SNAKEEYE || 0;
    if (gsSeLv && GUN_WEAPON_TYPES.has(weapon.weapon_type)) status.hit += gsSeLv;

    const tfMissLv = mastery.TF_MISS || 0;
    if (tfMissLv) {
      const tfFlee = TF_MISS_JOBL2.has(build.job_id) ? tfMissLv * 4 : tfMissLv * 3;
      status.flee += tfFlee;
    }

    const moDodgeLv = mastery.MO_DODGE || 0;
    if (moDodgeLv) {
      const moDodgeSpec = (profile.passive_overrides || {}).MO_DODGE || {};
      const moFlee = "flee_per_lv" in moDodgeSpec ? moDodgeLv * moDodgeSpec.flee_per_lv : (moDodgeLv * 3) >> 1;
      status.flee += moFlee;
    }

    const njTobiLv = mastery.NJ_TOBIDOUGU || 0;
    if (njTobiLv) {
      const perLv = ((profile.passive_overrides || {}).NJ_TOBIDOUGU || {}).hit_per_lv ?? 0;
      status.hit += perLv * njTobiLv;
    }
    const saFcLv = mastery.SA_FREECAST || 0;
    if (saFcLv) {
      status.flee += (((profile.passive_overrides || {}).SA_FREECAST || {}).flee_per_lv || 0) * saFcLv;
    }

    if ("SC_BLIND" in playerScs) {
      status.hit = Math.floor(status.hit * 75 / 100);
      status.flee = Math.floor(status.flee * 75 / 100);
    }

    if ("SC_QUAGMIRE" in playerScs) {
      const val2 = 10 * Number(playerScs.SC_QUAGMIRE);
      status.agi = Math.max(0, status.agi - val2);
      status.dex = Math.max(0, status.dex - val2);
    }
    if ("SC_PS_HYPOTHERMIA" in playerScs) status.dex = Math.max(0, status.dex - 10);

    // === ASPD ===
    const lhItemId = DUAL_WIELD_JOBS.has(build.job_id) ? build.equipped.left_hand : null;
    const lhItem = lhItemId != null ? loader.getItem(lhItemId) : null;
    const lhWeaponType = lhItem ? (lhItem.weapon_type || "Unarmed") : "Unarmed";
    let baseAmotion;
    if (lhWeaponType !== "Unarmed") {
      const rhBase = loader.getAspdBase(build.job_id, weapon.weapon_type);
      const lhBase = loader.getAspdBase(build.job_id, lhWeaponType);
      baseAmotion = Math.floor((rhBase + lhBase) * 7 / 10);
    } else {
      baseAmotion = loader.getAspdBase(build.job_id, weapon.weapon_type);
    }
    let amotion = baseAmotion - Math.floor(baseAmotion * (4 * status.agi + status.dex) / 1000);
    amotion += build.bonus_aspd_add;

    let scAspdMax = 0;
    if ("SC_ONEHANDQUICKEN" in activeSc) scAspdMax = Math.max(scAspdMax, 300);

    if ("SC_TWOHANDQUICKEN" in activeSc) {
      const tqQuickenSpec = ((profile.aspd_buffs || {}).SC_TWOHANDQUICKEN || {}).quicken;
      if (tqQuickenSpec) {
        const fn = tqQuickenSpec[weapon.weapon_type];
        if (fn) scAspdMax = Math.max(scAspdMax, fn(activeSc.SC_TWOHANDQUICKEN));
      } else {
        scAspdMax = Math.max(scAspdMax, 300);
      }
    }

    const adrenalineVal = Number(support.SC_ADRENALINE || 0);
    if (adrenalineVal && ADRENALINE_WEAPONS.has(weapon.weapon_type)) scAspdMax = Math.max(scAspdMax, adrenalineVal);
    const adrenaline2Val = Number(support.SC_ADRENALINE2 || 0);
    if (adrenaline2Val && !BOW_GUN_WEAPONS.has(weapon.weapon_type)) scAspdMax = Math.max(scAspdMax, adrenaline2Val);

    if ("SC_SPEARQUICKEN" in activeSc) {
      const spearLv = activeSc.SC_SPEARQUICKEN;
      const sqQuicken = ((profile.aspd_buffs || {}).SC_SPEARQUICKEN || {}).quicken;
      if (sqQuicken) {
        const fn = sqQuicken[weapon.weapon_type];
        if (fn) scAspdMax = Math.max(scAspdMax, fn(spearLv));
      } else {
        scAspdMax = Math.max(scAspdMax, 200 + 10 * spearLv);
      }
    }

    const song = build.song_state;
    if (song.SC_ASSNCROS && !BOW_GUN_WEAPONS.has(weapon.weapon_type)) {
      const songLv = Number(song.SC_ASSNCROS);
      const musLv = Number(song.SC_ASSNCROS_lesson || 0);
      const sAgi = Number(song.SC_ASSNCROS_agi ?? 1);
      const val2 = (Math.floor(musLv / 2) + 10 + songLv + Math.floor(sAgi / 10)) * 10;
      scAspdMax = Math.max(scAspdMax, val2);
    }

    if ("SC_GS_GATLINGFEVER" in activeSc) {
      scAspdMax = Math.max(scAspdMax, 20 * activeSc.SC_GS_GATLINGFEVER);
    }

    let scAspdRate = 1000 - scAspdMax;

    let aspdAdd = 0;
    if ("SC_GS_GATLINGFEVER" in activeSc) aspdAdd += activeSc.SC_GS_GATLINGFEVER;
    if ("SC_GS_MADNESSCANCEL" in activeSc && aspdAdd < 20) aspdAdd = 20;
    scAspdRate -= aspdAdd;

    if ("SC_GS_MADNESSCANCEL" in activeSc) scAspdRate -= 200;
    if ("SC_STEELBODY" in activeSc) scAspdRate += 250;
    if ("SC_DEFENDER" in activeSc) scAspdRate += 250 - 50 * activeSc.SC_DEFENDER;

    if ("SC_DONTFORGETME" in playerScs) {
      const lv = Number(playerScs.SC_DONTFORGETME);
      const casterAgi = Number(playerScs.SC_DONTFORGETME_agi || 0);
      const val2 = Math.floor(casterAgi / 10) + 3 * lv + 5;
      scAspdRate += 10 * val2;
    }
    if ("SC_PS_HYPOTHERMIA" in playerScs) scAspdRate += 200;

    const saAdvbookLv = mastery.SA_ADVANCEDBOOK || 0;
    if (saAdvbookLv && weapon.weapon_type === "Book") {
      const abAspd = ((profile.passive_overrides || {}).SA_ADVANCEDBOOK || {}).aspd_pct_per_lv;
      if (Array.isArray(abAspd)) scAspdRate -= abAspd[saAdvbookLv - 1] * 10;
      else if (abAspd) scAspdRate -= abAspd * saAdvbookLv * 10;
      else scAspdRate -= 5 * saAdvbookLv;
    }

    if (gsSaLv && GUN_WEAPON_TYPES.has(weapon.weapon_type)) {
      scAspdRate -= Math.floor((gsSaLv + 1) / 2) * 10;
    }

    for (const [apKey, apSpec] of Object.entries(profile.passive_overrides || {})) {
      const apPct = apSpec.aspd_pct_per_lv;
      if (apPct && !Array.isArray(apPct)) {
        const apLv = mastery[apKey] || 0;
        if (apLv) scAspdRate -= apPct * apLv * 10;
      }
    }

    for (const [aspdKey, aspdSpec] of Object.entries(profile.aspd_buffs || {})) {
      const lv10Rate = aspdSpec.lv10_rate;
      if (!lv10Rate) continue;
      if ((mastery[aspdKey] || 0) >= 10) {
        const delta = lv10Rate[weapon.weapon_type] || 0;
        if (delta) scAspdRate += delta;
      }
    }

    if (scAspdRate !== 1000) amotion = Math.floor(amotion * scAspdRate / 1000);

    if (build.bonus_aspd_percent) {
      amotion = Math.floor(amotion * (1000 - build.bonus_aspd_percent * 10) / 1000);
    }
    if (build.is_riding_peco) {
      const cavLv = mastery.KN_CAVALIERMASTERY || 0;
      amotion += 500 - 100 * cavLv;
    }
    const minAmotion = 2000 - this.config.max_aspd * 10;
    amotion = Math.max(minAmotion, Math.min(2000, amotion));
    status.aspd = (2000 - amotion) / 10;

    // === MAX HP ===
    const hpBase = loader.getHpAtLevel(build.job_id, build.base_level);
    status.max_hp = Math.floor(hpBase * (100 + vitForMaxhp) / 100);
    status.max_hp += build.bonus_maxhp;

    const crTrustLv = mastery.CR_TRUST || 0;
    if (crTrustLv) status.max_hp += crTrustLv * 200;

    if (build.bonus_maxhp_rate) {
      status.max_hp = Math.floor(status.max_hp * (100 + build.bonus_maxhp_rate) / 100);
    }

    if (build.job_id === 23) {
      for (const [thresh, bonus] of Object.entries(profile.sn_hp_bonus || {})) {
        if (build.base_level >= Number(thresh)) status.max_hp += bonus;
      }
    }

    // === MAX SP ===
    const spBase = loader.getSpAtLevel(build.job_id, build.base_level);
    status.max_sp = Math.floor(spBase * (100 + intForMaxsp) / 100);
    status.max_sp += build.bonus_maxsp;
    if (build.bonus_maxsp_rate) {
      status.max_sp = Math.floor(status.max_sp * (100 + build.bonus_maxsp_rate) / 100);
    }
    if (build.job_id === 23) {
      for (const [thresh, bonus] of Object.entries(profile.sn_sp_bonus || {})) {
        if (build.base_level >= Number(thresh)) status.max_sp += bonus;
      }
    }

    // === MATK ===
    status.matk_min = status.int_ + Math.floor(status.int_ / 7) ** 2;
    status.matk_max = status.int_ + Math.floor(status.int_ / 5) ** 2;

    if (build.bonus_matk_rate) {
      const pct = 100 + build.bonus_matk_rate;
      status.matk_min = Math.floor(status.matk_min * pct / 100);
      status.matk_max = Math.floor(status.matk_max * pct / 100);
    }
    if ("SC_MINDBREAKER" in playerScs) {
      const lv = Number(playerScs.SC_MINDBREAKER);
      const pct = 100 + 20 * lv;
      status.matk_min = Math.floor(status.matk_min * pct / 100);
      status.matk_max = Math.floor(status.matk_max * pct / 100);
    }
    if (profile.mechanic_flags.has("GROUND_EFFECT_PS_VALUES") && support.ground_effect === "SC_VOLCANO") {
      const volLv = Number(support.ground_effect_lv || 1);
      const pct = 100 + PS_VOL_MATK_PCT[Math.min(volLv, PS_VOL_MATK_PCT.length) - 1];
      status.matk_min = Math.floor(status.matk_min * pct / 100);
      status.matk_max = Math.floor(status.matk_max * pct / 100);
    }
    if (build.bonus_matk_flat) {
      status.matk_min += build.bonus_matk_flat;
      status.matk_max += build.bonus_matk_flat;
    }

    // === MDEF ===
    status.mdef = build.equip_mdef;
    status.mdef2 = status.int_ + (status.vit >> 1);

    if ("SC_ENDURE" in activeSc) status.mdef += activeSc.SC_ENDURE;
    if ("SC_MINDBREAKER" in playerScs) {
      const lv = Number(playerScs.SC_MINDBREAKER);
      status.mdef = Math.max(0, Math.floor(status.mdef * (100 - 12 * lv) / 100));
    }
    if ("SC_STEELBODY" in activeSc) {
      if (profile.steelbody_override != null) status.mdef = profile.steelbody_override[1](build.equip_mdef);
      else status.mdef = 90;
    }

    // === BARD SONGS ===
    if (song.SC_WHISTLE) {
      const songLv = Number(song.SC_WHISTLE);
      const musLv = Number(song.SC_WHISTLE_lesson || 0);
      const sAgi = Number(song.SC_WHISTLE_agi ?? 1);
      const sLuk = Number(song.SC_WHISTLE_luk ?? 1);
      const whistleFlee = songLv + Math.floor(sAgi / 10) + musLv;
      const whistleFlee2 = (Math.floor((songLv + 1) / 2) + Math.floor(sLuk / 10) + musLv) * 10;
      status.flee += whistleFlee;
      status.flee2 += whistleFlee2;
    }

    if (song.SC_APPLEIDUN) {
      const songLv = Number(song.SC_APPLEIDUN);
      const musLv = Number(song.SC_APPLEIDUN_lesson || 0);
      const sVit = Number(song.SC_APPLEIDUN_vit ?? 1);
      const val2 = 5 + 2 * songLv + Math.floor(sVit / 10) + musLv;
      status.max_hp += Math.floor(status.max_hp * val2 / 100);
    }

    if (support.ground_effect === "SC_DELUGE" && !profile.mechanic_flags.has("GROUND_EFFECT_PS_VALUES")) {
      const delLv = Number(support.ground_effect_lv || 1);
      const delVal2 = DELUGE_EFF[delLv - 1];
      status.max_hp += Math.floor(status.max_hp * delVal2 / 100);
    }

    if (song.SC_POEMBRAGI) {
      const songLv = Number(song.SC_POEMBRAGI);
      const musLv = Number(song.SC_POEMBRAGI_lesson || 0);
      const sDex = Number(song.SC_POEMBRAGI_dex ?? 1);
      const sInt = Number(song.SC_POEMBRAGI_int ?? 1);
      status.cast_time_reduction_pct = 3 * songLv + Math.floor(sDex / 10) + 2 * musLv;
      status.after_cast_delay_reduction_pct = (songLv < 10 ? 3 * songLv : 50) + Math.floor(sInt / 5) + 2 * musLv;
    }

    if ("SC_PS_HYPOTHERMIA" in playerScs) status.cast_time_penalty_pct += 20;

    if (song.SC_HUMMING) {
      const songLv = Number(song.SC_HUMMING);
      const danceLv = Number(song.SC_HUMMING_lesson || 0);
      const sDex = Number(song.SC_HUMMING_dex ?? 1);
      const humHit = 2 * songLv + Math.floor(sDex / 10) + danceLv;
      status.hit += humHit;
    }

    if (song.SC_FORTUNE) {
      const songLv = Number(song.SC_FORTUNE);
      const danceLv = Number(song.SC_FORTUNE_lesson || 0);
      const sLuk = Number(song.SC_FORTUNE_luk ?? 1);
      const fortuneCri = (10 + songLv + Math.floor(sLuk / 10) + danceLv) * 10;
      status.cri += fortuneCri;
    }

    if (song.SC_SERVICEFORYU) {
      const songLv = Number(song.SC_SERVICEFORYU);
      const danceLv = Number(song.SC_SERVICEFORYU_lesson || 0);
      const sInt = Number(song.SC_SERVICEFORYU_int ?? 1);
      const val2 = 15 + songLv + Math.floor(sInt / 10) + Math.floor(danceLv / 2);
      const val3 = 20 + 3 * songLv + Math.floor(sInt / 10) + Math.floor(danceLv / 2);
      status.max_sp += Math.floor(status.max_sp * val2 / 100);
      status.sp_cost_reduction_pct = val3;
    }

    const drumLv = Number(song.SC_DRUMBATTLE || 0);
    if (drumLv) status.def_ += (drumLv + 1) * 2;

    // === REGEN ===
    status.hp_regen = 1 + Math.floor(status.vit / 5) + Math.floor(status.max_hp / 200);
    status.sp_regen = 1 + Math.floor(status.int_ / 6) + Math.floor(status.max_sp / 100);
    if (status.int_ >= 120) status.sp_regen += Math.floor((status.int_ - 120) / 2) + 4;

    const smRecLv = mastery.SM_RECOVERY || 0;
    if (smRecLv) status.hp_regen += smRecLv * 5 + Math.floor(smRecLv * status.max_hp / 500);
    const mgSrecLv = mastery.MG_SRECOVERY || 0;
    if (mgSrecLv) status.sp_regen += mgSrecLv * 3 + Math.floor(mgSrecLv * status.max_sp / 500);
    const njNinpouLv = mastery.NJ_NINPOU || 0;
    if (njNinpouLv) status.sp_regen += njNinpouLv * 3 + Math.floor(njNinpouLv * status.max_sp / 500);

    return status;
  }
}

module.exports = { StatusCalculator };
