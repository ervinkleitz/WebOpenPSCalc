/**
 * procKeys.js — JS port of core/calculators/proc_keys.py
 */
const PROC_AUTO_BLITZ = "auto_blitz";
const PROC_AUTOSPELL = "autospell";
const PROC_DOUBLE_BOLT = "double_bolt";
const PROC_HOLY_STRIKE = "holy_strike";
const PROC_TRIPLE_ATTACK = "triple_attack";

const IMPLEMENTED_PROC_SKILLS = new Set(["SA_AUTOSPELL"]);

module.exports = {
  PROC_AUTO_BLITZ, PROC_AUTOSPELL, PROC_DOUBLE_BOLT, PROC_HOLY_STRIKE, PROC_TRIPLE_ATTACK,
  IMPLEMENTED_PROC_SKILLS,
};
