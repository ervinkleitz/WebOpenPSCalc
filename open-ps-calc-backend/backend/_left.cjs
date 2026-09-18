const fs = require("fs");
const { loader } = require("./src/engine/dataLoader");
const { getProfile } = require("./src/engine/serverProfiles");
const { BONUS1, BONUS2, BONUS3, BONUS4, resolveBonusType } = require("./src/engine/bonusDefinitions");
loader.setProfile(getProfile("payon_stories"));
const T = [BONUS1, BONUS2, BONUS3, BONUS4];
const known = (b) => [1, 2, 3, 4].some((a) => resolveBonusType(a, b) in T[a - 1]);
const all = loader._loadJson("db/item_db.json"); const ids = new Set((Array.isArray(all.items) ? all.items : Object.values(all.items || all)).map(i => String(i.id)));
for (const f of ["ps_item_manual.json", "ps_item_overrides.json", "ps_item_db.json"]) Object.keys(JSON.parse(fs.readFileSync("src/engine/data/ps/" + f, "utf8"))).forEach(k => /^\d+$/.test(k) && ids.add(k));
const scripts = [];
for (const id of ids) { const it = loader.getItem(id); if (it && it.script) scripts.push(it.script); }
for (const f of ["src/engine/data/ps/ps_item_combo_db.json", "src/engine/data/pre-re/db/item_combo_db.json"]) { const c = JSON.parse(fs.readFileSync(f, "utf8")); for (const x of (Array.isArray(c) ? c : (c.combos || Object.values(c)))) if (x && x.script) scripts.push(x.script); }
const unk = new Map();
for (const s of scripts) for (const m of s.matchAll(/\bbonus[2-5]?\s+(b[A-Za-z0-9_]+)/g)) if (!known(m[1])) unk.set(m[1], (unk.get(m[1]) || 0) + 1);
console.log([...unk.keys()].sort().join(" "));
console.log("count", unk.size);
