import { Router, Request, Response } from "express";
import { loader } from "../engine/dataLoader";
import { getProfile } from "../engine/serverProfiles";

const router = Router();

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
  res.json(mob);
});

router.get("/skills", (req: Request, res: Response) => {
  const server = applyServerProfile(req);
  const profile = getProfile(server);
  let skills = loader.getAllSkills();
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
  const skills = (loader as any).getPassiveSkillsForJob(Number(req.params.jobId));
  res.json(skills);
});

router.get("/jobs/:id", (req: Request, res: Response) => {
  applyServerProfile(req);
  const job = loader.getJobEntry(Number(req.params.id));
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

export default router;
