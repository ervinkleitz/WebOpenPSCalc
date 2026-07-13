import { Router, Request, Response } from "express";
import { loader } from "../engine/dataLoader";
import { getProfile } from "../engine/serverProfiles";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { importJaludev } = require("../engine/jaludevImport");

const router = Router();

// Import a build from the jaludev "payonrocalc" calculator (paste its share URL).
router.post("/import/jaludev", (req: Request, res: Response) => {
  applyServerProfile(req);
  try {
    const url = (req.body && req.body.url) || "";
    if (!url) return res.status(400).json({ error: "url is required" });
    res.json(importJaludev(String(url)));
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Failed to import build" });
  }
});

// Skill-name prefixes that never correspond to a Payon Stories (pre-renewal) player
// skill — Renewal 3rd jobs, mercenaries, homunculi, elemental summons, and monster
// (NPC_) skills. They're present in the vanilla skill DB but are pure noise in the
// damage-skill picker. Kept classes: all 1st/2nd/transcendent + the expanded pre-re
// jobs (Ninja NJ, Gunslinger GS, Taekwon TK, Star Gladiator SG, Soul Linker SL).
const NON_PS_SKILL_PREFIXES = new Set([
  // Renewal 3rd jobs
  "RK", "WL", "AB", "GC", "RA", "NC", "LG", "SO", "GN", "SR",
  "SC", "RL", "KO", "OB", "SJ", "SP", "SU", "WM",
  // Mercenaries
  "MER", "MA", "ML", "MS",
  // Homunculi
  "MH", "HVAN", "HFLI", "HLIF", "HAMI", "HD",
  // Elemental summons + shared/monster
  "EL", "ALL", "GD", "NPC",
]);

function applyServerProfile(req: Request) {
  const server = (req.query.server as string) || "payon_stories";
  loader.setProfile(getProfile(server));
  return server;
}

function paginate(arr: any[], req: Request) {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { total: arr.length, items: arr.slice(offset, offset + limit), limit, offset };
}

router.get("/items", (req: Request, res: Response) => {
  applyServerProfile(req);
  const type = (req.query.type as string) || "IT_WEAPON";
  let items = loader.getItemsByType(type);
  if (req.query.loc) {
    const loc = String(req.query.loc);
    items = items.filter((it: any) => Array.isArray(it.loc) && it.loc.includes(loc));
  }
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    items = items.filter((it: any) => (it.name || "").toLowerCase().includes(q) || (it.aegis_name || "").toLowerCase().includes(q));
  }
  if (req.query.job !== undefined) {
    const jobId = Number(req.query.job);
    items = items.filter((it: any) => !Array.isArray(it.job) || it.job.length === 0 || it.job.includes(jobId));
  }
  items = items.filter((it: any) => !loader.isItemHidden(it.id));
  res.json(paginate(items, req));
});

router.get("/items/:id", (req: Request, res: Response) => {
  applyServerProfile(req);
  const item = loader.getItem(Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Item not found" });
  const desc = loader.getItemDescription(Number(req.params.id));
  res.json({ ...item, description: desc ? desc.description : null });
});

router.get("/mobs", (req: Request, res: Response) => {
  applyServerProfile(req);
  let mobs = loader.getAllMonsters();
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    mobs = mobs.filter((m: any) => (m.name || "").toLowerCase().includes(q));
  }
  mobs = mobs.filter((m: any) => !loader.isMobHidden(m.id));
  res.json(paginate(mobs, req));
});

router.get("/mobs/:id", (req: Request, res: Response) => {
  applyServerProfile(req);
  const mob = loader.getMonsterData(Number(req.params.id));
  if (!mob) return res.status(404).json({ error: "Monster not found" });
  res.json({ ...mob, skills: (loader as any).getMobSkills(Number(req.params.id)) });
});

router.get("/skills", (req: Request, res: Response) => {
  const server = applyServerProfile(req);
  const profile = getProfile(server);
  let skills = loader.getAllSkills();
  if (req.query.damage_only === "true") {
    // The skill DB types everything that isn't a direct weapon/magic hit as
    // "Misc" (buffs, masteries, songs, ...), so a plain Weapon/Magic filter also
    // hides genuine offensive skills the engine *does* compute — e.g. Venom
    // Splasher (AS_SPLASHER), Acid Terror. Those show up as a real damage ratio
    // in the active server profile, so also keep any skill the profile can
    // actually calculate (weapon_ratios / magic_ratios).
    const wr = profile.weapon_ratios || {};
    const mr = profile.magic_ratios || {};
    skills = skills.filter((s: any) => {
      const name = s.name || "";
      // This is a pre-renewal calculator. Drop skills whose class prefix belongs to
      // a Renewal 3rd job, a mercenary/homunculus, an elemental summon, or a monster
      // (NPC_) — none exist as player skills on Payon Stories, they're just DB noise.
      if (NON_PS_SKILL_PREFIXES.has(name.split("_")[0])) return false;
      // HT_POWER is an internal Hercules id, not a real player skill.
      if (name === "HT_POWER") return false;
      const computable =
        Object.prototype.hasOwnProperty.call(wr, name) ||
        Object.prototype.hasOwnProperty.call(mr, name);
      // Pure support skills carry the NoDamage flag. Hide them from a *damage*
      // picker — UNLESS the active profile can actually compute the skill's damage
      // (it's in weapon_ratios/magic_ratios). Venom Splasher (AS_SPLASHER) and Acid
      // Terror are flagged NoDamage in the DB because the real hit is a delayed
      // explosion, yet the engine computes their damage; offensive Heal (AL_HEAL)
      // is the other documented NoDamage exception.
      if ((s.damage_type || []).includes("NoDamage") && name !== "AL_HEAL" && !computable) return false;
      return s.attack_type === "Weapon" || s.attack_type === "Magic" || computable;
    });
  }
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    skills = skills.filter((s: any) =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q) ||
      loader.getSkillDisplayName(s.name, profile).toLowerCase().includes(q)
    );
  }
  const withNames = skills.map((s: any) => ({ ...s, display_name: loader.getSkillDisplayName(s.name, profile) }));
  res.json(paginate(withNames, req));
});

router.get("/skills/:id", (req: Request, res: Response) => {
  const server = applyServerProfile(req);
  const skill = loader.getSkill(Number(req.params.id));
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  res.json({ ...skill, display_name: loader.getSkillDisplayName(skill.name, getProfile(server)) });
});

router.get("/jobs", (_req: Request, res: Response) => {
  res.json(loader.getAllJobs());
});

router.get("/skill-tree/:jobId", (req: Request, res: Response) => {
  applyServerProfile(req);
  const skills = (loader as any).getPassiveSkillsForJob(Number(req.params.jobId));
  res.json(skills);
});

router.get("/jobs/:id", (req: Request, res: Response) => {
  applyServerProfile(req);
  const job = loader.getJobEntry(Number(req.params.id));
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// Same per-job-level STR/AGI/VIT/INT/DEX/LUK bonus already folded into
// status.{str,agi,...} by statusCalculator.js -- exposed read-only here so
// the build editor can show it next to the base stat inputs instead of it
// only ever showing up invisibly inside the final damage numbers.
router.get("/job-bonus-stats/:jobId", (req: Request, res: Response) => {
  const server = applyServerProfile(req);
  const jobLevel = Number(req.query.job_level) || 1;
  const profile = getProfile(server);
  res.json(loader.getJobBonusStats(Number(req.params.jobId), jobLevel, profile));
});

export default router;
