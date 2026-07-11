/**
 * jaludevImport.js — import a build from the jaludev "payonrocalc" calculator.
 *
 * jaludev encodes the whole build into the URL hash as a fixed-position base-62
 * string (alphabet a-z A-Z 0-9). This ports its decoder (StoN2 + the field layout
 * from its foot.js `LoadURL` routine) and maps its item / card / job values — which
 * are indices into jaludev's own tables — to this app's item IDs by (normalised) name.
 * jaludev is a vanilla pre-renewal calc, so standard gear matches; anything renamed
 * or Payon-Stories-custom has no jaludev equivalent and is reported as unmapped.
 */
const { loader } = require("./dataLoader");
const JD_ITEMS = require("./data/jaludev/jaludev_items.json"); // index -> item name
const JD_CARDS = require("./data/jaludev/jaludev_cards.json"); // index -> card name
const JD_JOBS = require("./data/jaludev/jaludev_jobs.json");   // index -> job name

// base-62, alphabet = a..z A..Z 0..9 (jaludev n_NtoS2)
const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function StoN2(s) {
  s = String(s);
  let e = 0;
  for (const ch of s) { const v = ALPHA.indexOf(ch); e = e * 62 + (v < 0 ? 0 : v); }
  return e;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// jaludev job names that differ from ours beyond punctuation
const JOB_ALIAS = { swordman: "swordsman" };

let _idx = null;
function indexes() {
  if (_idx) return _idx;
  const items = new Map();
  for (const type of ["IT_WEAPON", "IT_ARMOR", "IT_AMMO"]) {
    for (const it of loader.getItemsByType(type) || []) {
      const k = norm(it.name);
      if (k && !items.has(k)) items.set(k, it.id);
    }
  }
  const cards = new Map();
  for (const it of loader.getItemsByType("IT_CARD") || []) {
    const k = norm(it.name).replace(/card$/, ""); // "Pecopeco Card" -> "pecopeco"
    if (k && !cards.has(k)) cards.set(k, it.id);
  }
  const jobs = new Map();
  for (const j of loader.getAllJobs() || []) jobs.set(norm(j.name), j.id);
  _idx = { items, cards, jobs };
  return _idx;
}

// Resolve a jaludev slot index -> this app item id. Pushes to `unmapped` on a miss.
function resolveItem(jdIndex, table, lookup, unmapped, slotLabel) {
  if (!jdIndex) return undefined; // 0 = empty slot
  const name = table[jdIndex];
  if (!name || /^\(no /i.test(name) || name.startsWith("*")) return undefined; // "(No X)" / wildcard
  const id = lookup.get(norm(name).replace(/card$/, ""));
  if (id == null) { unmapped.push(`${slotLabel}: ${name}`); return undefined; }
  return id;
}

/** Decode a jaludev hash/URL into this app's build shape. */
function importJaludev(input) {
  const hash = String(input || "").split("#").pop().trim();
  if (hash.length < 45) throw new Error("Not a valid jaludev build link (hash too short).");
  const { items, cards, jobs } = indexes();
  const f = (o, n) => StoN2(hash.substr(o, n));
  const unmapped = [];

  // --- job ---
  const jdJobIdx = f(1, 2);
  const jdJobName = JD_JOBS[jdJobIdx] || "";
  const jobKey = JOB_ALIAS[norm(jdJobName)] || norm(jdJobName);
  const jobId = jobs.get(jobKey);
  if (jobId == null) unmapped.push(`Job: ${jdJobName || `#${jdJobIdx}`} (not on this server)`);

  const equipped = {};
  const refine = {};
  const setItem = (slot, jdItemIdx) => {
    const id = resolveItem(jdItemIdx, JD_ITEMS, items, unmapped, slot);
    if (id != null) equipped[slot] = id;
  };
  const setCard = (slot, jdCardIdx) => {
    const id = resolveItem(jdCardIdx, JD_CARDS, cards, unmapped, `${slot} card`);
    if (id != null) equipped[`${slot}_card1`] = id;
  };

  // --- weapon (right hand) + its 4 cards ---
  setItem("right_hand", f(23, 2));
  refine.right_hand = f(25, 1);
  [f(26, 2), f(28, 2), f(30, 2), f(32, 2)].forEach((ci, i) => {
    const id = resolveItem(ci, JD_CARDS, cards, unmapped, "weapon card");
    if (id != null) equipped[`right_hand_card${i + 1}`] = id;
  });

  // --- left hand (shield or off-hand) ---
  setItem("left_hand", f(34, 2));
  refine.left_hand = f(36, 1);
  setCard("left_hand", f(37, 2));

  // --- head / body / garment / shoes / accessories ---
  setItem("head_top", f(45, 2)); setCard("head_top", f(47, 2));
  setItem("head_mid", f(49, 2)); setCard("head_mid", f(51, 2));
  setItem("head_low", f(53, 2)); // low headgear has no card slot in jaludev's layout
  setItem("armor", f(55, 2)); setCard("armor", f(57, 2));
  setItem("garment", f(59, 2)); setCard("garment", f(61, 2));
  setItem("shoes", f(63, 2)); setCard("shoes", f(65, 2));
  setItem("accessory_left", f(67, 2)); setCard("accessory_left", f(69, 2));
  setItem("accessory_right", f(71, 2)); setCard("accessory_right", f(73, 2));

  refine.head_top = f(75, 1);
  refine.armor = f(76, 1);
  refine.garment = f(77, 1);
  refine.shoes = f(78, 1);

  const weaponElement = f(19, 1) % 10;

  const build = {
    name: "Imported (jaludev)",
    job_id: jobId != null ? jobId : 0,
    base_level: f(3, 2) || 1,
    job_level: f(5, 2) || 1,
    base_stats: { str: f(7, 2), agi: f(9, 2), vit: f(11, 2), int: f(15, 2), dex: f(13, 2), luk: f(17, 2) },
    equipped,
    refine,
    weapon_element: weaponElement || 0,
  };

  return { build, unmapped, jobName: jdJobName };
}

module.exports = { importJaludev, StoN2 };
