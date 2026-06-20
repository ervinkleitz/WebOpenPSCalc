/**
 * targetUtils.js — JS port of core/calculators/target_utils.py
 * Applies active SC debuffs to a mob Target via direct field mutation.
 */
const { getProfile } = require("../serverProfiles");

const BOSS_IMMUNE_SCS = new Set([
  "SC_STONE", "SC_FREEZE", "SC_STUN", "SC_SLEEP",
  "SC_POISON", "SC_CURSE", "SC_SILENCE", "SC_CONFUSION", "SC_BLIND",
  "SC_PS_HYPOTHERMIA",
]);
const BOSS_IMMUNE_NOBOSS = new Set(["SC_PROVOKE", "SC_DECREASEAGI"]);
const ALL_BOSS_IMMUNE = new Set([...BOSS_IMMUNE_SCS, ...BOSS_IMMUNE_NOBOSS]);

function applyMobScs(target, server = "standard") {
  const scs = target.target_active_scs;
  const origDef = target.def_;
  const origMdef = target.mdef_;

  const blocked = (scKey) => target.is_boss && ALL_BOSS_IMMUNE.has(scKey);

  if ("SC_DECREASEAGI" in scs && !blocked("SC_DECREASEAGI")) {
    const lv = Number(scs.SC_DECREASEAGI);
    const delta = 2 + lv;
    target.agi = Math.max(0, target.agi - delta);
    target.flee = Math.max(0, target.flee - delta);
  }

  if ("SC_BLIND" in scs && !blocked("SC_BLIND")) {
    target.hit = target.hit - Math.floor(target.hit * 25 / 100);
    target.flee = target.flee - Math.floor(target.flee * 25 / 100);
  }

  if ("SC_CURSE" in scs && !blocked("SC_CURSE")) target.luk = 0;

  if ("SC_POISON" in scs && !blocked("SC_POISON")) {
    const penalty = server === "payon_stories" ? 50 : 25;
    target.def_percent = Math.max(0, target.def_percent - penalty);
  }

  if ("SC_QUAGMIRE" in scs) {
    const lv = Number(scs.SC_QUAGMIRE);
    const val2 = 10 * lv;
    target.agi = Math.max(0, target.agi - val2);
    target.dex = Math.max(0, target.dex - val2);
    target.flee = Math.max(0, target.flee - val2);
    target.hit = Math.max(0, target.hit - val2);
  }

  if ("SC_PS_HYPOTHERMIA" in scs && !blocked("SC_PS_HYPOTHERMIA")) {
    target.dex = Math.max(0, target.dex - 10);
    target.hit = Math.max(0, target.hit - 10);
    target.aspd_rate += 200;
  }

  if ("SC_BLESSING" in scs) {
    if (target.element === 9 || target.race === "Demon") {
      const oldDex = target.dex;
      target.str = target.str >> 1;
      target.dex = target.dex >> 1;
      const dexDelta = oldDex - target.dex;
      target.hit = Math.max(0, target.hit - dexDelta);
    }
  }

  if ("SC_CRUCIS" in scs) {
    if (target.element === 9 || target.race === "Demon") {
      const lv = Number(scs.SC_CRUCIS);
      const val2 = 10 + 4 * lv;
      target.def_ = Math.max(0, target.def_ - Math.floor(target.def_ * val2 / 100));
    }
  }

  if ("SC_PROVOKE" in scs && !blocked("SC_PROVOKE")) {
    const lv = Number(scs.SC_PROVOKE);
    target.def_percent = Math.max(0, target.def_percent - (5 + 5 * lv));
  }

  if ("SC_FLING" in scs) {
    target.def_percent = Math.max(0, target.def_percent - 5 * Number(scs.SC_FLING));
  }

  if ("SC_NOEQUIPSHIELD" in scs) {
    if (server === "payon_stories") target.def_ = Math.max(0, Math.floor(target.def_ * 70 / 100));
    else target.def_percent = Math.max(0, target.def_percent - 15);
  }
  if ("SC_NOEQUIPARMOR" in scs) {
    if (server === "payon_stories") target.mdef_ = Math.max(0, Math.floor(target.mdef_ * 70 / 100));
    else target.vit = Math.max(0, Math.floor(target.vit * 60 / 100));
  }
  if ("SC_NOEQUIPHELM" in scs) {
    target.int_ = Math.max(0, Math.floor(target.int_ * 60 / 100));
  }

  if ("SC_MINDBREAKER" in scs) {
    const lv = Number(scs.SC_MINDBREAKER);
    target.matk_percent = 100 + 20 * lv;
    target.mdef_percent = Math.max(0, 100 - 12 * lv);
  }

  if ("SC_DONTFORGETME" in scs) {
    const lv = Number(scs.SC_DONTFORGETME);
    const casterAgi = Number(scs.SC_DONTFORGETME_agi || 0);
    const val2 = Math.floor(casterAgi / 10) + 3 * lv + 5;
    target.aspd_rate += 10 * val2;
  }

  if ("SC_STEELBODY" in scs) {
    const override = getProfile(server).steelbody_override;
    if (override != null) {
      target.def_ = override[0](origDef);
      target.mdef_ = override[1](origMdef);
    } else {
      target.def_ = 90;
      target.mdef_ = 90;
    }
  }
}

module.exports = { applyMobScs };
