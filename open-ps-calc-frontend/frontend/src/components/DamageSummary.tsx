import { useState, type ReactNode } from "react";
import HoverNote from "./HoverNote";
import AttackRateNote from "./AttackRateNote";
import { swingDamage, killMetrics, type Range } from "../lib/killMetrics";

interface Step {
  name: string;
  value?: number;
  min_value?: number;
  max_value?: number;
  multiplier?: number;
  note?: string;
  formula?: string;
  info?: boolean;
  track_start?: boolean;  // opens a separate sub-track (Grand Cross' magic half) — no delta badge
}

interface SelfDamageRange { min: number; avg: number; max: number; }
interface SelfDamage {
  part1: SelfDamageRange;      // damage-based recoil, after the caster's own reductions (3 waves)
  part2: number;              // fixed casting cost: 20% of current HP per cast
  total: SelfDamageRange;     // part1 + part2
  per_wave: SelfDamageRange;
  waves: number;
  max_hp: number;
  current_hp: number;
  survives: boolean;          // survives an average-roll cast at current HP
  survives_worst: boolean;    // survives even a worst-case cast
  halved: boolean;            // players take half the recoil (battle.c:3805)
  reductions: {
    holy_resist: number;      // % (bSubEle Ele_Holy — e.g. Faith −50%, Talisman −7%)
    demihuman_resist: number; // % (bSubRace RC_DemiHuman — e.g. Thara Frog)
    def: number;              // caster hard DEF used (already ⅔ of normal), reduces the physical half
    mdef: number;             // caster hard MDEF (gear), reduces the magic half
    mdef_soft: number;        // caster soft MDEF (INT + VIT/2), subtracted from the magic half
    armor_element: string;
  };
}

interface DamageBranch {
  num_hits?: number;
  avg_damage: number;
  min_damage: number;
  max_damage: number;
  steps: Step[];
  self_damage?: SelfDamage;   // Grand Cross blowback (self-recoil) — only present for CR_GRANDCROSS
  // Crit lifesteal (bCritHeal — Crescent Scythe). HP returned to you on a crit,
  // not damage: never folded into the damage total or DPS.
  crit_heal?: { permille: number; min: number; max: number; avg: number };
  // Corrupting Drain (Corruptor Card) returns a share of its damage as HP. Like
  // crit_heal it is healing, never damage — shown beside the proc, never in the DPS.
  drain_heal?: { pct: number; avg: number };
}

interface FalconResult {
  per_hit: number;
  blitz_beat_lv: number;
  steel_crow_lv: number;
  auto_blitz_hits: number;
  auto_blitz_chance: number;
  auto_blitz_total: number;
  blitz_beat_total: number | null;
}

interface SingleResult {
  has_auto_bonuses?: boolean;
  has_forceable_procs?: boolean;   // autobonus cards OR a Holy Strike proc — what "Always proc" changes
  status: { aspd: number };
  // Base timings behind the cast rate (routes/calculate.ts). Cast and after-cast are
  // 0 on the normal-attack result, which has neither.
  timing?: { cast_ms: number; after_cast_ms: number; cooldown_ms: number; animation_ms: number };
  result: {
    hit_chance: number;
    crit_chance: number;
    normal: DamageBranch;
    crit?: DamageBranch;
    katar_second?: DamageBranch;
    katar_second_crit?: DamageBranch;
    katar_proc_chance?: number;
    double_hit?: DamageBranch | null;
    double_hit_chance?: number | null; // hit chance of the swing that procs Double Attack (with its +HIT)
    double_hit_bonus?: number;         // the +HIT behind it (= Double Attack level)
    proc_chance?: number;
    double_proc_label?: string | null;
    ta_proc_chance?: number;
    /** Triple Attack's proc when it CRITS. Only present while Critical Explosion
     *  is up — that is the one thing on Payon Stories that lets a Triple Attack
     *  proc crit at all. The engine has always folded it into the DPS; it just
     *  had nowhere to show. */
    ta_crit_proc?: DamageBranch | null;
    dps_valid: boolean;
    dps: number;
    period_ms?: number;
    success_chance?: number | null; // Turn Undead: instant-kill success chance (%)
    tu_attempt?: number;
    tu_hp_now?: number | null;
    tu_max_hp?: number | null;
    dw_rh_factor?: number | null;
    dw_lh_factor?: number | null;
    dw_lh_normal?: DamageBranch | null;
    dw_lh_crit?: DamageBranch | null;
    dw_ps_bonus_pct?: number | null;
    proc_branches?: Record<string, DamageBranch>;
    proc_chances?: Record<string, number>;
    // A proc that can itself land a critical (Holy Strike) carries its crit outcome
    // beside the normal one, keyed the same way.
    proc_crit_branches?: Record<string, DamageBranch>;
    proc_crit_chances?: Record<string, number>;
    proc_labels?: Record<string, string>;
  };
  falcon?: FalconResult;
}

interface CalcResult {
  normal_attack: SingleResult;
  /** Why the selected skill shows no Critical hit branch, when the answer is a
   *  toggle rather than "it never crits". Set by the editor, which knows the
   *  buffs; the engine only reports whether a crit branch exists. */
  crit_unavailable_reason?: { short: string; detail: string } | null;
  skill: SingleResult | null;
  selected_skill: { id: number; level: number; label: string };
  target_hp?: number | null; // monster HP (monster-mode only) for hits-to-kill / time-to-kill
  target_exp?: number | null; // base EXP the kill awards (monster mode) — divided by hits-to-kill
  target_job_exp?: number | null; // job EXP the kill awards (monster mode)
  poison_dot_per_sec?: number | null; // Poison ailment damage-over-time (per second), folded into time-to-kill
  /** The incoming-damage payload the survivability panel renders. Only the target's
   *  name is read here, to say who the headline figure is against. */
  incoming?: {
    mob_name?: string | null;
    /** One line per attack element; the first is the monster's basic melee. The
     *  narrow layout condenses this to "hits to die / damage taken per hit". */
    elements?: { taken?: { status?: { max_hp?: number }; result?: { avg_damage?: number } } }[];
  } | null;
}

interface Props {
  // Turn Undead failed-cast iteration: casts treated as already failed (0 = fresh
  // target), and the callback to advance/reset it. Ephemeral by design.
  tuAttempt?: number;
  onTuAttempt?: (n: number) => void;
  calcResult: CalcResult | null;
  calculating: boolean;
  error: string;
  forceProcs: boolean;
  onToggleForceProcs: () => void;
  /** Rendered beside the step table on a wide screen, below it on a narrow one.
   *  The survivability readout goes here: "what I do to it" and "what it does to
   *  me" are the same question asked twice, and stacking them put a screenful of
   *  breakdown between the two halves of the answer. */
  aside?: ReactNode;
  /** Pin / compare controls, shown on the headline row. They belong beside the
   *  number they act on, not in a panel of their own above it. */
  actions?: ReactNode;
}

type Branch = "skill" | "normal" | "crit" | "falcon" | "katar";
type DwMode = "ps" | "vanilla";

function stepDisplayVal(step: Step): string {
  const hasRange = step.min_value != null && step.max_value != null
    && Math.round(step.min_value) !== Math.round(step.max_value);
  if (hasRange) return `${Math.round(step.min_value!)}–${Math.round(step.max_value!)}`;
  return step.value != null ? String(Math.round(step.value)) : "—";
}


// A step with no running total cannot have changed the running total.
//
// This guard is here because the badge used to do the arithmetic anyway. The engine
// emitted a ground-enchant row (Volcano / Deluge / Violent Gale) that carried no
// value of its own — the bonus lands on the element multiplier, not on a line of its
// own — so the row printed "—", the delta read that missing total as zero, and the
// badge announced the loss of the whole running damage. A Sage reported Violent Gale
// as *reducing* Lightning Bolt against a Siroma on the strength of a "−368" that
// nothing had subtracted (2026-10-20); the gale had in fact taken the hit from
// 5,620–9,140 up to 6,180–10,050.
//
// That row is gone — its explanation moved into the element row's note, next to the
// multiplier it accounts for — so nothing in the engine is shaped this way today.
// The guard stays regardless: the next valueless step should read as nothing
// happening, not as a catastrophe.
const hasRunningTotal = (s: Step) =>
  s.value != null || (s.min_value != null && s.max_value != null);

// Compact inline badge showing what this step did to the running total: a ×multiplier
// (boost/reduce) or a +/− flat delta. Empty for pure passthroughs.
//
// The right-hand column is ALWAYS the running total after the step (the engine
// guarantees it), so the delta below is meaningful — except where a step opens a
// separate sub-track (Grand Cross' magic half starts over at Base MATK), which is
// flagged with track_start so we don't badge a jump that isn't a change.
function connectorInfo(step: Step, prev: Step | undefined): { badge: string; cls: string } {
  if (step.track_start) return { badge: "", cls: "conn-pass" };
  const m = step.multiplier ?? 1.0;
  if (Math.abs(m - 1.0) > 0.001) {
    return { badge: `×${m % 1 === 0 ? m.toFixed(0) : m.toFixed(2)}`, cls: m >= 1 ? "conn-boost" : "conn-reduce" };
  }
  // No total of its own, or nothing before it that had one, means no delta to state.
  if (!hasRunningTotal(step) || !prev) return { badge: "", cls: "conn-pass" };
  const delta = Math.round((step.value ?? 0) - (prev.value ?? 0));
  if (delta > 0) return { badge: `+${delta.toLocaleString()}`, cls: "conn-add" };
  if (delta < 0) return { badge: `−${(-delta).toLocaleString()}`, cls: "conn-sub" };
  return { badge: "", cls: "conn-pass" };
}

// The engine names its steps after the Hercules functions they port (Attr Fix,
// Card Fix, Defense Fix…) which keeps the code auditable against battle.c — but
// it is not what a player reading a damage breakdown needs. Display labels are a
// presentation concern, so they live here; `step.name` stays the engine's, and
// the raw name is still shown in the row's tooltip for anyone cross-referencing.
const STEP_LABELS: Record<string, string> = {
  "Status BATK": "Status ATK",
  "Weapon ATK Range": "Weapon damage roll",
  "Size Fix": "Size penalty",
  "Status BATK Added": "Your status ATK",
  "Overrefine Bonus": "Overrefine bonus",
  "Base Damage": "Base damage",
  "Defense Fix": "Target's DEF",
  "Magic Defense Fix": "Target's MDEF",
  "Active Status Bonuses": "Buffs & statuses",
  "Refine Bonus": "Refine ATK",
  "Mastery Fix": "Weapon mastery",
  "Weapon Research": "Weaponry Research",
  "Attr Fix": "Element vs target",
  // Grand Cross applies its Holy element three times — to each half, then to the sum.
  "Attr Fix (physical half)": "Element vs target (physical half)",
  "Attr Fix (magic half)": "Element vs target (magic half)",
  "Attr Fix (sum)": "Element vs target (again, on the sum)",
  // PS crit damage: three separate buckets that multiply together.
  "Crit ATK Rate": "Crit damage (gear)",
  "Brutality Crit Bonus": "Crit damage (Brutality)",
  "AS_KATAR Crit Bonus": "Crit damage (Katar Mastery)",
  "Card Fix": "Cards & gear",
  "Card Fix (Magic)": "Cards & gear",
  "Forge Bonus": "Forged weapon",
  "Final Rate Bonus (Short)": "Melee damage bonuses",
  "Final Rate Bonus (Long)": "Ranged damage bonuses",
  "Final Rate Bonus (Weapon)": "Weapon-type bonuses",
  "Skill ATK Bonus": "Per-skill gear bonus",
  "Base MATK": "MATK roll",
  "Branch": "Critical hit",
  "Final Damage": "Final damage",
};
// "Skill Ratio (Bash Lv10)" → "Skill ratio — Bash Lv10". The engine already puts
// the skill's display name (or "Auto attack") in the brackets.
function stepLabel(name: string): string {
  const m = /^Skill Ratio \((.+)\)$/.exec(name);
  if (m) return `Skill ratio — ${m[1]}`;
  return STEP_LABELS[name] ?? name;
}

// Status ATK / Weapon ATK — the figures the table starts from. Shown beside the
// column heading, the way the design states them: "Damage calculation · Status ATK
// 27 · Weapon ATK 0".
function InputFigures({ steps }: { steps: Step[] }) {
  const chips = steps.filter((s) => s.info);
  if (!chips.length) return null;
  return (
    <span className="breakdown-inputs">
      {chips.map((s, i) => (
        <span key={i} className="breakdown-input" title={stepLabel(s.name) !== s.name ? s.name : undefined}>
          <span className="breakdown-input-label">{stepLabel(s.name)}</span>{" "}
          <span className="breakdown-input-val">{stepDisplayVal(s)}</span>
        </span>
      ))}
    </span>
  );
}

function PipelineView({ steps, hideFinal = false, legend = true, inputs = true }: { steps: Step[]; hideFinal?: boolean; legend?: boolean; inputs?: boolean }) {
  // Notes are hidden by default (hover reveals, tap pins) to keep the breakdown compact.
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });
  const chips = steps.filter(s => s.info);
  const visible = steps.filter(s => !s.info);
  // Hide pure no-op passthrough rows — multiplier ≈ 1 AND value unchanged from the
  // previous step (e.g. a bypassed "Card Fix" on Grand Cross) — so a real multiplier
  // connector isn't left visually sitting under a row that did nothing. Always keep
  // the base row and the final total.
  const nodes = visible.filter((s, i) => {
    if (i === 0 || s.name === "Final Damage") return true;
    const m = s.multiplier ?? 1.0;
    const unchanged = Math.round(s.value ?? 0) === Math.round(visible[i - 1].value ?? 0);
    return !(Math.abs(m - 1) < 0.001 && unchanged);
  }).filter((s) => !(hideFinal && s.name === "Final Damage")); // final shown separately as a prominent total
  return (
    <div className="pipeline-view">
      {inputs && chips.length > 0 && <InputFigures steps={steps} />}
      <div className="pl-track">
        {/* Column header. The order is the order the arithmetic happens in: what the
            step IS, what it DID, what you are left with. The middle column used to sit
            on the far left, which put the cause before its own subject and left the
            two numeric columns unlabelled except by a legend you had to look back at. */}
        {legend && (
          <div className="pl-legend">
            <span className="pl-badge">Change</span>
            <span className="pl-name">Step</span>
            <span className="pl-val">Result</span>
            <span className="pl-caret" aria-hidden="true" />
          </div>
        )}
        {nodes.map((step, i) => {
          // Measure from the last row that actually HAD a total, so an annotation
          // row in between does not make the next row's delta read from zero either.
          const prev = nodes.slice(0, i).filter(hasRunningTotal).pop();
          const conn = i > 0 ? connectorInfo(step, prev) : null;
          const isFinal = step.name === "Final Damage";
          // The engine's own step name (Attr Fix, Defense Fix, …) was only ever in the
          // row's `title`, which a touch device cannot show at all. It is part of what
          // the row has to say, so it goes in the disclosure with the note.
          const rawName = stepLabel(step.name) !== step.name ? step.name : "";
          // Only a note is worth opening a row for. The engine's own name for the
          // step rides along in the tooltip, as it did before.
          const hasDetail = !isFinal && !!step.note;
          const isOpen = open.has(i);
          return (
            <div className="pl-step" key={i}>
              <div
                className={`pl-row${isFinal ? " pl-row--final" : ""}${hasDetail ? " pl-row--note" : ""}`}
                onClick={hasDetail ? () => toggle(i) : undefined}
                onKeyDown={hasDetail ? (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i); }
                } : undefined}
                role={hasDetail ? "button" : undefined}
                tabIndex={hasDetail ? 0 : undefined}
                aria-expanded={hasDetail ? isOpen : undefined}
                title={[rawName, step.note && !isFinal ? step.note : ""].filter(Boolean).join(" — ") || undefined}
              >
                <span className={`pl-badge ${conn ? conn.cls : ""}`}>{conn ? conn.badge : ""}</span>
                <span className="pl-name">{stepLabel(step.name)}</span>
                <span className="pl-val">{stepDisplayVal(step)}</span>
                <span className="pl-caret" aria-hidden="true">{hasDetail ? (isOpen ? "⌃" : "⌄") : ""}</span>
              </div>
              {hasDetail && (
                <div className={`pl-note${isOpen ? " open" : ""}`}>{step.note}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FalconView({ falcon }: { falcon: FalconResult }) {
  return (
    <div className="falcon-rows">
      {falcon.auto_blitz_hits >= 1 && (
        <div className="falcon-row">
          <span className="falcon-label">Auto-blitz ({falcon.auto_blitz_chance}% chance, {falcon.auto_blitz_hits} hit{falcon.auto_blitz_hits > 1 ? "s" : ""})</span>
          <span className="falcon-value">{falcon.auto_blitz_total}</span>
        </div>
      )}
      {falcon.blitz_beat_total != null && (
        <div className="falcon-row">
          <span className="falcon-label">Blitz Beat Lv {falcon.blitz_beat_lv} ({falcon.blitz_beat_lv} × {falcon.per_hit})</span>
          <span className="falcon-value">{falcon.blitz_beat_total}</span>
        </div>
      )}
      <div className="falcon-note">
        Steel Crow Lv {falcon.steel_crow_lv} · bypasses DEF · neutral element vs target
      </div>
    </div>
  );
}

function SelfDamageView({ sd }: { sd: SelfDamage }) {
  const n = (v: number) => Math.round(v).toLocaleString();
  // Show the min–max range when one exists; fall back to a single value otherwise
  // (no separate average — the range already conveys it).
  const rng = (x: SelfDamageRange) =>
    Math.round(x.min) !== Math.round(x.max) ? `${n(x.min)}–${n(x.max)}` : n(x.avg);
  const r = sd.reductions;
  const hasResist = r.holy_resist > 0 || r.demihuman_resist > 0;
  const lostPct = sd.max_hp > 0 ? Math.round((sd.total.avg / sd.max_hp) * 100) : 0;
  return (
    <div className="self-damage">
      <div className="self-damage-head">
        <span className="self-damage-title">Self-damage per cast</span>
        <span className="self-damage-sub">Grand Cross recoils onto the caster</span>
      </div>

      <div className="self-damage-part">
        <div className="self-damage-part-row">
          <span className="self-damage-part-label">Part 1 — Holy recoil, vs your DEF/MDEF{sd.halved ? " (halved)" : ""}</span>
          <span className="self-damage-part-val">{rng(sd.part1)}</span>
        </div>
        <div className="self-damage-resists">
          {r.holy_resist > 0 && <span className="self-damage-chip good">Holy resist −{r.holy_resist}%</span>}
          {r.demihuman_resist > 0 && <span className="self-damage-chip good">Demi-Human −{r.demihuman_resist}%</span>}
          {!hasResist && <span className="self-damage-chip muted">no Holy / Demi-Human resist</span>}
          <span className="self-damage-chip muted">DEF {n(r.def)}</span>
          <span className="self-damage-chip muted">MDEF {n(r.mdef)} + {n(r.mdef_soft)} soft</span>
          <span className="self-damage-chip muted">{r.armor_element} armor</span>
        </div>
      </div>

      <div className="self-damage-part">
        <div className="self-damage-part-row">
          <span className="self-damage-part-label">Part 2 — 20% current HP, fixed</span>
          <span className="self-damage-part-val">{n(sd.part2)}</span>
        </div>
        <div className="self-damage-resists">
          <span className="self-damage-chip muted">ignores all reductions</span>
        </div>
      </div>

      <div className="self-damage-total">
        <span className="self-damage-total-label">Total HP lost / cast</span>
        <span className="self-damage-total-val">{rng(sd.total)}</span>
        <span className="self-damage-total-pct">{lostPct}% of {n(sd.max_hp)} MaxHP</span>
      </div>

      <div className={`self-damage-survive ${sd.survives_worst ? "ok" : sd.survives ? "warn" : "bad"}`}>
        {sd.survives_worst
          ? `Survivable — even a worst-case cast leaves ${n(sd.current_hp - sd.total.max)} HP.`
          : sd.survives
            ? `Risky — an average cast leaves ${n(sd.current_hp - sd.total.avg)} HP, but a worst-case cast would kill you.`
            : `Fatal — an average cast (${n(sd.total.avg)}) exceeds your ${n(sd.current_hp)} HP.`}
      </div>
    </div>
  );
}

// Sage Auto Spell / "Hindsight" autocast — a magic spell that fires at a flat
// chance on the physical attack shown above. Surfaces the per-proc damage and
// its full pipeline; its expected value is already folded into the DPS estimate.
function AutoSpellView({ branch, chance, label }: { branch: DamageBranch; chance: number; label: string }) {
  const n = (v: number) => Math.round(v).toLocaleString();
  const range = Math.round(branch.min_damage) !== Math.round(branch.max_damage)
    ? `${n(branch.min_damage)}–${n(branch.max_damage)}`
    : n(branch.avg_damage);
  return (
    <div className="breakdown-view">
      <div className="breakdown-head">
        <span className="breakdown-title">Auto Spell (Hindsight)</span>
        <span className="breakdown-sub">{label} · {chance}% per physical attack</span>
      </div>
      <PipelineView steps={branch.steps} hideFinal />
      <div className="breakdown-total">
        <span className="breakdown-total-label">Per-proc damage</span>
        <span className="breakdown-total-val">{range}</span>
      </div>
      <div className="self-damage-resists" style={{ marginTop: "0.5rem" }}>
        <span className="self-damage-chip muted">assumes the spell is learned</span>
        <span className="self-damage-chip muted">expected value folded into DPS</span>
      </div>
    </div>
  );
}

// Auto Blitz Beat — a Falcon Hunter/Sniper's bow auto-attack has a ⌊LUK/3⌋%
// chance to auto-cast Blitz Beat. Fixed damage (no range), bypasses DEF; its
// expected value is already folded into the DPS of the attack shown above. Shown
// inline under the Normal tab so the proc's influence sits next to the DPS.
function AutoBlitzView({ branch, chance, dpsAdded }: { branch: DamageBranch; chance: number; dpsAdded: number | null }) {
  const n = (v: number) => Math.round(v).toLocaleString();
  const note = branch.steps[0]?.note;
  return (
    <div className="breakdown-view">
      <div className="breakdown-head">
        <span className="breakdown-title">Auto Blitz Beat</span>
        <span className="breakdown-sub">falcon proc · {chance}% per bow auto-attack</span>
      </div>
      {note && <div className="pl-note open" style={{ marginBottom: "0.5rem" }}>{note}</div>}
      <div className="breakdown-total">
        <span className="breakdown-total-label">Damage per proc</span>
        <span className="breakdown-total-val">{n(branch.avg_damage)}</span>
      </div>
      {dpsAdded != null && dpsAdded > 0 && (
        <div className="breakdown-total">
          <span className="breakdown-total-label">≈ DPS added</span>
          <span className="breakdown-total-val">+{n(dpsAdded)}</span>
        </div>
      )}
      <div className="self-damage-resists" style={{ marginTop: "0.5rem" }}>
        <span className="self-damage-chip muted">bypasses DEF · neutral element</span>
        <span className="self-damage-chip muted">already folded into the DPS above</span>
      </div>
    </div>
  );
}

// Triple Attack — a Monk/Champion (or a Rogue who plagiarised it) has a per-rank
// chance for a normal attack to become Triple Attack instead. It REPLACES the
// swing rather than adding a hit, so its expected value is already inside the DPS
// above; this panel is what one proc actually hits for.
function TripleAttackView({ branch, chance, label, crit, critChance }: {
  branch: DamageBranch; chance: number; label: string;
  crit?: DamageBranch | null; critChance?: number;
}) {
  const n = (v: number) => Math.round(v).toLocaleString();
  const rng = (b: DamageBranch) => Math.round(b.min_damage) !== Math.round(b.max_damage)
    ? `${n(b.min_damage)}–${n(b.max_damage)}`
    : n(b.avg_damage);
  const range = rng(branch);
  const critRange = crit ? rng(crit) : null;
  return (
    <div className="breakdown-view">
      <div className="breakdown-head">
        <span className="breakdown-title">{label}</span>
        <span className="breakdown-sub">{chance.toFixed(1)}% per auto-attack</span>
      </div>
      <PipelineView steps={branch.steps} hideFinal />
      <div className="breakdown-total">
        <span className="breakdown-total-label">Per-proc damage</span>
        <span className="breakdown-total-val">{range}</span>
      </div>
      {/* Only under Critical Explosion, which is the sole thing that lets a Triple
          Attack proc crit on Payon Stories. Without it there is no crit row at all,
          which is itself the answer to "does this crit?". */}
      {crit && (
        <div className="breakdown-total">
          <span className="breakdown-total-label">
            ...when it crits
            {critChance ? <span className="breakdown-sub"> {critChance.toFixed(1)}% of procs</span> : null}
          </span>
          <span className="breakdown-total-val">{critRange}</span>
        </div>
      )}
      <div className="self-damage-resists" style={{ marginTop: "0.5rem" }}>
        <span className="self-damage-chip muted">replaces the auto-attack</span>
        <span className="self-damage-chip muted">already folded into the DPS above</span>
        {crit && <span className="self-damage-chip muted">crits because Critical Explosion is up</span>}
      </div>
    </div>
  );
}

// Double Attack (Thief line, dagger) / Chain Action (Gunslinger, revolver) — a
// per-level chance for a normal attack to land a SECOND hit. Unlike Triple Attack
// it adds to the swing rather than replacing it. The engine has always modelled it
// and folded it into the DPS, but nothing on screen said so, so a player with
// Double Attack 10 saw no evidence it counted and reported it as not implemented.
// Sidewinder Card feeds the same proc through bDoubleRate, on any weapon.
// Double Attack (Thief line, dagger) / Chain Action (Gunslinger, revolver) — a
// per-level chance for a normal attack to land TWICE. It is one attack that hits twice,
// not two attacks: the damage roll is taken once and doubled before defense, so the DEF
// subtraction, the refine bonus and the masteries are each paid once for the pair. That
// is why two hits come to less than two normal attacks, and why the client's two numbers
// are each below a normal hit — it splits the total.
function DoubleAttackView({ branch, chance, label, taChance, baseHit, procHit, hitBonus }: {
  branch: DamageBranch; chance: number; label: string; taChance: number;
  baseHit?: number; procHit?: number | null; hitBonus?: number;
}) {
  const n = (v: number) => Math.round(v).toLocaleString();
  const range = Math.round(branch.min_damage) !== Math.round(branch.max_damage)
    ? `${n(branch.min_damage)}–${n(branch.max_damage)}`
    : n(branch.avg_damage);
  // What the game prints per hit: it shows the total split in two, rounded down.
  const perHit = Math.floor(branch.avg_damage / 2);
  return (
    <div className="breakdown-view">
      <div className="breakdown-head">
        <span className="breakdown-title">{label}</span>
        {/* Triple Attack REPLACES the swing, so a swing that became a TA cannot also
            double. This line says "per auto-attack", so with TA in play it must be the
            share of swings that actually double, not the skill's own rate. */}
        <span className="breakdown-sub">
          {(chance * (1 - taChance / 100)).toFixed(1)}% per auto-attack
        </span>
      </div>
      <PipelineView steps={branch.steps} hideFinal />
      <div className="breakdown-total">
        <span className="breakdown-total-label">Both hits together</span>
        <span className="breakdown-total-val">
          {range}
          {/* The engine floors the swing to a multiple of the hit count (the swing deals
              what the popups show), so min and max divide exactly and the "2 × N" claim
              always holds — as one per-hit value or a per-hit range. */}
          {Math.round(branch.min_damage) === Math.round(branch.max_damage) ? (
            <span className="dw-per-hit"> (2 × {(Math.round(branch.min_damage) / 2).toLocaleString()})</span>
          ) : (
            <span className="dw-per-hit"> (2 × {Math.floor(branch.min_damage / 2).toLocaleString()}–{Math.floor(branch.max_damage / 2).toLocaleString()})</span>
          )}
        </span>
      </div>

      <div className="self-damage-resists" style={{ marginTop: "0.5rem" }}>
        {/* Double Attack adds +1 HIT per level, but only to the swing that procs it. It was
            always in the DPS; without this line nothing on the page showed it. */}
        {procHit != null && hitBonus != null && hitBonus > 0 && (
          <span className="self-damage-chip">
            hits {procHit.toFixed(1)}% of the time — {baseHit != null ? `${baseHit.toFixed(1)}% ` : ""}+{hitBonus} HIT on a {label} swing
          </span>
        )}
        <span className="self-damage-chip muted">one damage roll, landed twice</span>
        <span className="self-damage-chip muted">
          DEF, refine and masteries are paid once for the pair
        </span>
        {taChance > 0 && (
          <span className="self-damage-chip muted">
            {chance.toFixed(1)}% on its own — Triple Attack replaces {taChance.toFixed(1)}% of swings first
          </span>
        )}
        <span className="self-damage-chip muted">never crits — a critical swing cannot also proc</span>
        <span className="self-damage-chip muted">already folded into the DPS above</span>
      </div>
    </div>
  );
}

function CardAutocastView({ branch, chance, label, dpsAdded, title = "Card autocast", per = "physical attack",
  critBranch = null, critChance = 0 }: {
  branch: DamageBranch; chance: number; label: string; dpsAdded: number | null;
  title?: string; per?: string;
  // Only a proc that can crit passes these (Holy Strike). Card autocasts are skill
  // casts and never do, so they leave them off and nothing extra renders.
  critBranch?: DamageBranch | null; critChance?: number;
}) {
  const n = (v: number) => Math.round(v).toLocaleString();
  const range = Math.round(branch.min_damage) !== Math.round(branch.max_damage)
    ? `${n(branch.min_damage)}–${n(branch.max_damage)}`
    : n(branch.avg_damage);
  // A proc whose skill has no formula we can derive (Corruptor Card's Corrupting
  // Drain). The proc and its rate are real, the damage is not calculated — say so
  // rather than printing a 0 that reads as "this card does nothing".
  const unmodeled = branch.steps.length === 1 && branch.steps[0].name === "Not yet implemented";
  return (
    <div className="breakdown-view">
      <div className="breakdown-head">
        <span className="breakdown-title">{title} — {label}</span>
        <span className="breakdown-sub">{chance}% per {per}</span>
      </div>
      {unmodeled ? (
        // Same treatment an unmodelled SKILL gets in the main breakdown — a warn
        // notice with the reason, never a number.
        <div className="notice warn">{branch.steps[0].note}</div>
      ) : (
        <>
          <PipelineView steps={branch.steps} hideFinal />
          <div className="breakdown-total">
            <span className="breakdown-total-label">Per-proc damage{critBranch ? " (normal)" : ""}</span>
            <span className="breakdown-total-val">{range}</span>
          </div>
          {critBranch && (
            <div className="breakdown-total">
              <span className="breakdown-total-label">Per-proc damage (critical — {critChance.toFixed(1)}% of procs)</span>
              <span className="breakdown-total-val">
                {Math.round(critBranch.min_damage) !== Math.round(critBranch.max_damage)
                  ? `${n(critBranch.min_damage)}–${n(critBranch.max_damage)}`
                  : n(critBranch.avg_damage)}
              </span>
            </div>
          )}
          {dpsAdded != null && dpsAdded > 0 && (
            <div className="breakdown-total">
              <span className="breakdown-total-label">≈ DPS added</span>
              <span className="breakdown-total-val">+{n(dpsAdded)}</span>
            </div>
          )}
        </>
      )}
      {branch.drain_heal && (
        <div className="breakdown-total">
          <span className="breakdown-total-label">HP healed per proc ({branch.drain_heal.pct}% of the damage)</span>
          <span className="breakdown-total-val">{n(branch.drain_heal.avg)}</span>
        </div>
      )}
      <div className="self-damage-resists" style={{ marginTop: "0.5rem" }}>
        <span className="self-damage-chip muted">auto-attacks only</span>
        <span className="self-damage-chip muted">
          {unmodeled ? "damage NOT included in the DPS above" : "already folded into the DPS above"}
        </span>
      </div>
    </div>
  );
}

function DualWieldStepList({ rh, lh, rhFactor, lhFactor, isCrit, psBonusPct }: {
  rh: DamageBranch; lh: DamageBranch;
  rhFactor: number; lhFactor: number; isCrit: boolean; psBonusPct?: number;
}) {
  const rhPct = (rhFactor * 100).toFixed(0);
  const lhPct = (lhFactor * 100).toFixed(0);
  return (
    <>
      <div className="dw-section-label">Hit 1 &amp; 2 — RH {isCrit ? "crit" : "hit"} × {rhPct}% each</div>
      <PipelineView steps={rh.steps} />
      <div className="dw-section-label" style={{ marginTop: "0.75rem" }}>Hit 3 — LH {isCrit ? "crit" : "hit"} × {lhPct}%</div>
      <PipelineView steps={lh.steps} legend={false} />
      {psBonusPct != null && psBonusPct > 0 && (
        <div className="dw-ps-bonus-row">
          <span className="dw-ps-bonus-label">PS Dual-Wield Bonus</span>
          <span className="dw-ps-bonus-val">×{(1 + psBonusPct / 100).toFixed(2)}</span>
          <span className="dw-ps-bonus-note">applied to combined total (+{psBonusPct}%)</span>
        </div>
      )}
    </>
  );
}

export default function DamageSummary({ calcResult, calculating, error, forceProcs, onToggleForceProcs, tuAttempt = 0, onTuAttempt, aside, actions }: Props) {
  const [branch, setBranch] = useState<Branch>("skill");
  const [dwMode, setDwMode] = useState<DwMode>("ps");
  const [showExp, setShowExp] = useState(false);

  if (error) return <div className="notice warn">{error}</div>;
  if (calculating) return <p className="spinner-text">Calculating…</p>;
  if (!calcResult) return <p className="hint-text">Set up a build and target, then calculate damage.</p>;

  const { normal_attack, skill: skillResult, selected_skill, target_hp, target_exp, target_job_exp, poison_dot_per_sec } = calcResult;
  const hasForceableProcs = !!(normal_attack.has_forceable_procs ?? normal_attack.has_auto_bonuses);
  const hasSkill = skillResult !== null && selected_skill.id !== 0;
  const primary = hasSkill ? skillResult! : normal_attack;
  const hasCrit = !!primary.result.crit;
  const critUnavailableReason = calcResult.crit_unavailable_reason ?? null;
  const falcon = (skillResult ?? normal_attack)?.falcon;
  const hasFalcon = !!falcon;
  const hasKatar = !!normal_attack.result.katar_second;

  // Dual-wield (PS Assassin) — auto-attacks only
  const hasDualWield = !hasSkill && normal_attack.result.dw_rh_factor != null;
  const dwRhFactor = normal_attack.result.dw_rh_factor ?? 1;
  const dwLhFactor = normal_attack.result.dw_lh_factor ?? 1;
  const dwLhNormal = normal_attack.result.dw_lh_normal ?? null;
  const dwLhCrit = normal_attack.result.dw_lh_crit ?? null;
  const dwPsBonusPct = normal_attack.result.dw_ps_bonus_pct ?? 0;

  // Vanilla DPS: recompute single-weapon DPS from period_ms
  const periodMs = normal_attack.result.period_ms ?? 0;
  const rawNormalAvg = normal_attack.result.normal.avg_damage;
  const rawCritAvg = normal_attack.result.crit?.avg_damage ?? rawNormalAvg;
  const h = normal_attack.result.hit_chance / 100;
  const ec = normal_attack.result.crit_chance / 100;
  const vanillaDps = periodMs > 0
    ? (rawNormalAvg * (1 - ec) * h + rawCritAvg * ec) / (periodMs / 1000)
    : null;

  // Clamp branch to valid options
  const activeBranch: Branch =
    branch === "skill" && !hasSkill ? "normal"
    : branch === "crit" && !hasCrit ? (hasSkill ? "skill" : "normal")
    : branch === "falcon" && !hasFalcon ? (hasSkill ? "skill" : "normal")
    : branch === "katar" && !hasKatar ? (hasSkill ? "skill" : "normal")
    : branch;

  const activeResult: SingleResult = (activeBranch === "normal" || activeBranch === "katar") ? normal_attack : primary;
  // Auto Spell (Hindsight) proc branch — present only on a physical attack that
  // has Hindsight active. Tied to the attack currently in view (magic skills
  // don't autocast, so it's absent there).
  const autoSpellDamage = activeResult.result.proc_branches?.autospell ?? null;
  const autoSpell = autoSpellDamage
    ? {
        branch: autoSpellDamage,
        chance: activeResult.result.proc_chances?.autospell ?? 30,
        label: activeResult.result.proc_labels?.autospell ?? "",
      }
    : null;
  // Auto Blitz Beat proc — shown inline (not on the Falcon tab) so its DPS
  // influence sits next to the attack it rides on. ≈ DPS = chance × per-proc /
  // attack period (the exact value is already folded into the DPS shown above).
  const autoBlitzDamage = activeResult.result.proc_branches?.auto_blitz ?? null;
  const autoBlitz = autoBlitzDamage && activeBranch !== "falcon"
    ? {
        branch: autoBlitzDamage,
        chance: activeResult.result.proc_chances?.auto_blitz ?? 0,
        dpsAdded: periodMs > 0
          ? (autoBlitzDamage.avg_damage * (activeResult.result.proc_chances?.auto_blitz ?? 0) / 100) / (periodMs / 1000)
          : null,
      }
    : null;
  // Triple Attack proc (Monk/Champion, or a Rogue's plagiarised copy).
  const tripleAttackBranch = activeResult.result.proc_branches?.triple_attack ?? null;
  const tripleAttack = tripleAttackBranch
    ? {
        branch: tripleAttackBranch,
        chance: activeResult.result.proc_chances?.triple_attack ?? 0,
        label: activeResult.result.proc_labels?.triple_attack ?? "Triple Attack",
        // Present only under Critical Explosion. The DPS above already weights this
        // by the crit chance (battlePipeline splits the TA share crit/non-crit), so
        // showing it is purely catching the readout up with the maths: a player
        // turned Critical Explosion on, watched this panel not move, and reported
        // Triple Attack as not critting. It was; the number was just never rendered.
        crit: activeResult.result.ta_crit_proc ?? null,
        critChance: activeResult.result.crit_chance ?? 0,
      }
    : null;
  // Double Attack / Chain Action second hit. Only ever procs on a normal attack, so
  // it is read off the normal-attack result rather than the selected skill's.
  const doubleHitBranch = normal_attack.result.double_hit ?? null;
  const doubleHitChance = normal_attack.result.proc_chance ?? 0;
  const doubleHit = doubleHitBranch && doubleHitChance > 0
    ? {
        branch: doubleHitBranch,
        chance: doubleHitChance,
        label: normal_attack.result.double_proc_label ?? "Double Attack",
      }
    : null;
  // Holy Strike proc: a Priest's learned quest skill, and/or the Mummy + Ancient Mummy
  // card combo, which grants it to any class. The engine has priced it (and folded it
  // into the DPS) since 2026-09-09, but nothing here rendered `holy_strike`, so players
  // saw no trace of it and reported the combo as unimplemented.
  const holyStrikeBranch = activeResult.result.proc_branches?.holy_strike ?? null;
  const holyStrikeChance = activeResult.result.proc_chances?.holy_strike ?? 0;
  const holyStrikeCrit = activeResult.result.proc_crit_branches?.holy_strike ?? null;
  const holyStrikeCritChance = activeResult.result.proc_crit_chances?.holy_strike ?? 0;
  const holyStrike = holyStrikeBranch
    ? {
        branch: holyStrikeBranch,
        chance: holyStrikeChance,
        critBranch: holyStrikeCrit,
        critChance: holyStrikeCritChance,
        // Holy Strike crits like any weapon hit, so the damage a proc is worth is the
        // blend of its two outcomes — the same blend the headline DPS already applies.
        // Quoting the normal figure alone made this row disagree with the DPS above.
        dpsAdded: periodMs > 0
          ? ((holyStrikeCrit
              ? (holyStrikeCritChance / 100) * holyStrikeCrit.avg_damage
                + (1 - holyStrikeCritChance / 100) * holyStrikeBranch.avg_damage
              : holyStrikeBranch.avg_damage) * holyStrikeChance / 100) / (periodMs / 1000)
          : null,
      }
    : null;
  // Card autocasts on a physical attack (Pirate Skel Card → Mammonite, Rekenber
  // Mercenary Card → Bash). One branch per autocast skill, keyed card_autocast_*.
  const cardAutocasts = Object.entries(activeResult.result.proc_branches ?? {})
    .filter(([key]) => key.startsWith("card_autocast_"))
    .map(([key, branch]) => ({
      key,
      branch,
      chance: activeResult.result.proc_chances?.[key] ?? 0,
      label: activeResult.result.proc_labels?.[key] ?? "",
      dpsAdded: periodMs > 0
        ? (branch.avg_damage * (activeResult.result.proc_chances?.[key] ?? 0) / 100) / (periodMs / 1000)
        : null,
    }));
  const activeDamage: DamageBranch | null = activeBranch === "falcon"
    ? null
    : activeBranch === "katar" ? (normal_attack.result.katar_second ?? null)
    : activeBranch === "crit" ? primary.result.crit!
    : activeResult.result.normal;

  const notImplemented = activeDamage?.steps?.length === 1 && activeDamage.steps[0].name === "Not yet implemented";
  const { result, status } = activeResult;

  // Attack/cast rate beside ASPD. Always taken from period_ms — the very number the
  // DPS divides by — so the two can't disagree; for an auto-attack that equals the
  // ASPD delay, and for a skill it's max(cast + after-cast delay, attack delay). The
  // note names which of those binds, since that answers "will more ASPD speed this
  // up?". Skipped on the falcon tab (a proc, not a cycle) and whenever the branch has
  // no meaningful period (Reflect Shield fires on the enemy's timing, not yours).
  const rateIsSkill = activeResult !== normal_attack;
  const aspdDelayMs = 2 * Math.max(100, Math.round(2000 - status.aspd * 10));
  const attackRate = activeBranch !== "falcon" && result.dps_valid && (result.period_ms ?? 0) > 0
    ? { perSec: 1000 / result.period_ms!, periodMs: result.period_ms! }
    : null;

  // Grand Cross blowback (self-recoil): lives on the skill's normal branch. GC has
  // no crit/falcon/katar branches, so surface it whenever it's present.
  const selfDamage = (hasSkill ? skillResult! : normal_attack).result.normal.self_damage ?? null;

  // Crit lifesteal (Crescent Scythe): only meaningful on the crit view, since it is
  // paid out per critical hit. Shown under the breakdown, clearly marked as healing.
  const critHeal = activeBranch === "crit" ? (primary.result.crit?.crit_heal ?? null) : null;

  // The two weapons of a PS dual-wield land in ONE swing, so the headline damage is
  // their total, not the right hand's share. Worked out in lib/killMetrics, which the
  // pinned Compare columns go through as well — they used to do their own arithmetic
  // and showed the right-hand hit alone beside a breakdown ending on the full swing.
  const dwRhBranch = activeBranch === "crit" ? (normal_attack.result.crit ?? normal_attack.result.normal) : normal_attack.result.normal;
  const dwLhBranch = activeBranch === "crit" ? (dwLhCrit ?? dwLhNormal!) : dwLhNormal!;

  // DPS: combined PS DPS in PS mode, single-weapon recomputed in Vanilla mode
  const displayDps = hasDualWield && dwMode === "vanilla" ? vanillaDps : result.dps;
  const displayDpsValid = hasDualWield && dwMode === "vanilla"
    ? (vanillaDps !== null && isFinite(vanillaDps))
    : result.dps_valid;

  // The damage ONE attack lands, as displayed: the dual-wield swing total where that
  // applies, otherwise the branch on screen. Everything below — the damage range, the
  // breakdown's final line, the kill metrics — reads this single figure.
  const showDwCombined = hasDualWield && dwMode === "ps" && !!dwLhNormal
    && (activeBranch === "normal" || activeBranch === "crit");
  const swing: Range | null = swingDamage(normal_attack.result, activeDamage, {
    dw: showDwCombined,
    crit: activeBranch === "crit",
  });
  const killMin = swing?.min ?? null;
  const killAvg = swing?.avg ?? null;
  const killMax = swing?.max ?? null;

  // Poison ailment damage-over-time (per second), added to the attack DPS so the
  // target dies sooner. Constant since it's a fraction of Max HP, so it folds in
  // as a flat +DPS term. Only present in monster mode with the Poison status on.
  const poisonDot = poison_dot_per_sec != null && poison_dot_per_sec > 0 ? poison_dot_per_sec : 0;

  // Hits and time to kill, from lib/killMetrics — the same call the pinned Compare
  // columns make, so a column and the panel under it cannot quote different numbers.
  const kill = killMetrics({
    targetHp: target_hp,
    damage: swing,
    dps: displayDps,
    dpsValid: displayDpsValid,
    periodMs: result.period_ms ?? 0,
    poisonDotPerSec: poison_dot_per_sec,
    successChance: result.success_chance ?? null,
  });
  const { isInstaKill, noRateHit, hitsBest, hitsAvg, hitsWorst, timeToKill } = kill;
  const successChance = result.success_chance ?? null;
  // "...and if every hit were THIS one?" — the count for the branch on screen, with
  // no crit/proc mix folded in. The figures above answer "how long will this actually
  // take", which is the right default and is what Time to kill agrees with; this
  // answers "how many of these would it take", which is the question you are asking
  // the moment you click Critical hit. A player reported the averaged count as not
  // very useful for exactly that reason (2026-10-10).
  //
  // Shown only when it differs from the expected count — on the default branch of a
  // build with no crit and no procs the two coincide, and printing the same number
  // twice is worse than printing it once.
  const hitsThisBranch = kill.hitsThisBranch;
  const showBranchHits = hitsThisBranch != null && hitsAvg != null && hitsThisBranch !== hitsAvg;

  // "...and what do I hit for on AVERAGE?" — the crit and non-crit outcomes blended
  // at your crit rate, which is the number the DPS, Hits to kill and Time to kill are
  // all built from. Each branch button shows one outcome in isolation; with a 70% crit
  // rate neither of them is what you actually do, and the blend was only reachable by
  // dividing the DPS by the cast rate yourself. A player asked for it back after the
  // branch buttons made the two outcomes separate and visible (2026-10-11).
  //
  // Hidden when it matches the branch on screen — a build that never crits and procs
  // nothing has one outcome, and printing it twice is worse than printing it once.
  const avgPerCycle = kill.attackPerCycle;
  const showAvgPerCycle = avgPerCycle != null && killAvg != null
    && Math.round(avgPerCycle) !== Math.round(killAvg);
  // The cycle this averages over: a cast on a skill branch, a swing on the auto attack.
  const cycleNoun = activeBranch === "normal" || !hasSkill ? "hit" : "cast";

  // EXP per hit = what the kill awards ÷ how many hits it takes. The headline number
  // uses the SAME expected-hits basis as "Hits to kill" and "Time to kill" (expected
  // damage per attack cycle), so the three can never disagree; the best/worst damage
  // rolls give the envelope quoted in the tooltip — fewest hits is the most EXP per
  // hit, so best-case hits maps to the HIGH end. Monster mode only: a custom target
  // awards no EXP. Kill rewards are the mob DB's own values — the server's EXP rate
  // and the level-difference penalty are not modelled here.
  const expPerN = (exp: number | null | undefined, hits: number | null) =>
    exp != null && exp > 0 && hits != null && hits > 0 ? exp / hits : null;
  const baseExpPerHit = expPerN(target_exp, hitsAvg);
  const jobExpPerHit = expPerN(target_job_exp, hitsAvg);
  const baseExpHigh = expPerN(target_exp, hitsBest);
  const baseExpLow = expPerN(target_exp, hitsWorst);
  const jobExpHigh = expPerN(target_job_exp, hitsBest);
  const jobExpLow = expPerN(target_job_exp, hitsWorst);
  const hasExpPerHit = baseExpPerHit != null || jobExpPerHit != null;
  // A cast-counted branch (Turn Undead's instant kill, or a no-rate skill) earns its
  // EXP per CAST, not per swing — label it for what it counts.
  const expUnitLabel = isInstaKill || noRateHit ? "cast" : "hit";
  const expFmt = (v: number | null) =>
    v == null ? "—" : v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  const expRangeNote = (lo: number | null, hi: number | null) =>
    lo != null && hi != null && expFmt(lo) !== expFmt(hi) ? ` Best-to-worst damage rolls: ${expFmt(hi)} – ${expFmt(lo)}.` : "";

  // For an instant-kill skill, "DPS" as chip-damage throughput is misleading next
  // to the kill metrics (they'd imply far less than the target's HP). Show the
  // effective throughput (HP ÷ expected time) so the panel stays self-consistent;
  // fall back to the raw DPS when the target's HP is unknown (custom target).
  const effectiveDps = isInstaKill && target_hp != null && timeToKill != null && timeToKill > 0
    ? target_hp / timeToKill : displayDps;

  // Header + prominent-total support for the breakdown card.
  const nfmt = (v: number) => Math.round(v).toLocaleString();
  // Short noun for the "All <x>" count above: "All crits", "All auto attacks", ...
  const branchNoun =
    activeBranch === "crit" ? "crits"
    : activeBranch === "katar" ? "katar hits"
    : activeBranch === "falcon" ? "falcon hits"
    : activeBranch === "normal" ? "auto attacks"
    : hasSkill ? "casts"
    : "auto attacks";
  const breakdownLabel =
    activeBranch === "crit" ? "Critical hit"
    : activeBranch === "katar" ? "Katar 2nd hit"
    : activeBranch === "falcon" ? "Falcon"
    : activeBranch === "normal" ? "Auto attack"
    : hasSkill ? `${selected_skill.label} Lv ${selected_skill.level}`
    : "Auto attack";
  const finalRange = killMin != null && killMax != null && Math.round(killMin) !== Math.round(killMax);

  // The answer, stated first. It was only ever available at the BOTTOM of the step
  // table, under every intermediate figure that produced it -- so the one number
  // everybody opens this panel for was the last one they reached, and on a long
  // breakdown it was below the fold. The steps explain the number; they should not
  // have to be read to find it.
  const heroTotal = killAvg == null ? null
    : finalRange ? `${nfmt(killMin!)}–${nfmt(killMax!)}` : nfmt(killAvg);
  const heroTargetName = calcResult.incoming?.mob_name ?? null;

  // --- figures the narrow layout adds -------------------------------------------
  // How big your biggest hit is against what the target actually has. On a phone the
  // panel is read in one scroll and this is the one proportion that says whether the
  // fight is realistic at all; a bare damage figure does not.
  const hpShare = (killMax != null && target_hp != null && target_hp > 0)
    ? Math.min(100, (killMax / target_hp) * 100) : null;
  const hpSharePct = hpShare == null ? null
    : hpShare >= 10 ? hpShare.toFixed(0) : hpShare.toFixed(1);
  const eleStep = activeDamage?.steps?.find((st) => /^Attr Fix$/.test(st.name));
  const eleMult = eleStep?.multiplier ?? null;
  const hitsPill = hitsAvg != null && !isInstaKill
    ? `${hitsAvg} ${noRateHit ? "casts" : "hits"} to kill` : null;
  // Survivability, condensed: the two numbers the design keeps.
  const incomingBasic = calcResult.incoming?.elements?.[0]?.taken;
  const takenPerHit = incomingBasic?.result?.avg_damage ?? null;
  const myMaxHp = incomingBasic?.status?.max_hp ?? null;
  const hitsToDie = (takenPerHit != null && takenPerHit > 0 && myMaxHp != null)
    ? Math.ceil(myMaxHp / takenPerHit) : null;

  return (
    <div>
      {/* Narrow layout only (CSS). The wide layout is titled by the panel header
          and does not need naming twice. */}
      <div className="ds-mobile-head">
        <span className="ds-mobile-eyebrow">Battle results</span>
        {hitsPill && <span className="ds-mobile-pill">{hitsPill}</span>}
      </div>
      {(heroTotal || actions) && (
        <div className="ds-hero-row">
          {heroTotal && (
            <div className="ds-hero">
              <div className="ds-hero-figure">
                <span className="ds-hero-total">{heroTotal}</span>
                <span className="ds-hero-unit">total damage</span>
              </div>
              {/* The two layouts caption the figure differently -- wide reads
                  "Skill -> Target", narrow reads "damage vs Target . Skill", which
                  is the fuller sentence a phone has room for under a centred
                  number. Both are rendered; CSS picks one. */}
              <div className="ds-hero-sub">
                <span className="ds-hero-sub-wide">
                  {breakdownLabel}
                  {heroTargetName && <span className="ds-hero-vs"> → {heroTargetName}</span>}
                </span>
                <span className="ds-hero-sub-narrow">
                  {heroTargetName ? <>damage vs {heroTargetName} · {breakdownLabel}</> : breakdownLabel}
                </span>
              </div>
              {hpSharePct != null && (
                <div className="ds-hpbar">
                  <div className="ds-hpbar-row">
                    <div className="ds-hpbar-track">
                      <span className="ds-hpbar-fill" style={{ width: `${Math.max(1, Number(hpSharePct))}%` }} />
                    </div>
                    <span className="ds-hpbar-pct">{hpSharePct}%</span>
                  </div>
                  <p className="ds-hpbar-note">
                    Max hit = {hpSharePct}% of {nfmt(target_hp!)} HP
                    {eleMult != null && eleMult !== 1 ? ` · Element ×${eleMult}` : ""}
                  </p>
                </div>
              )}
            </div>
          )}
          {actions && <div className="ds-hero-actions">{actions}</div>}
        </div>
      )}
      <div className="summary-headline">
        <div className="metric">
          <div className="label">Hit chance</div>
          <div className="value good">{result.hit_chance.toFixed(1)}<span className="unit">%</span></div>
        </div>
        <div className="metric">
          <div className="label">Crit chance</div>
          <div className="value crit">{result.crit_chance.toFixed(1)}<span className="unit">%</span></div>
        </div>
        {isInstaKill && (
          <div className="metric" title="Turn Undead instant-kill chance per cast: [20×SkillLv + 3×LUK + INT + BaseLv + (1−HP/MaxHP)×200] ÷ 10 %, halved if base INT < 40. On a failed roll the skill deals the shown (fail) damage instead — which lowers the target's HP and raises the NEXT cast's chance (up to +20%). Use the arrows to step through attempts; a manual Calculate, a skill change or re-opening this tab resets to attempt 1.">
            <div className="label">
              Success chance{result.tu_attempt && result.tu_attempt > 1 ? ` — attempt ${result.tu_attempt}` : ""}
            </div>
            <div className="value good">{(successChance as number).toFixed(1)}<span className="unit">%</span></div>
            {onTuAttempt && (
              <div className="tu-attempt-row">
                <button className="tu-btn" onClick={() => onTuAttempt(tuAttempt + 1)} title="Assume this cast fails: its damage lands, the target's HP drops, and the next cast's chance is quoted from the reduced HP">cast fails ▸</button>
                {tuAttempt > 0 && (
                  <button className="tu-btn" onClick={() => onTuAttempt(tuAttempt - 1)} title="Take back the last failed cast">◂ undo</button>
                )}
                {tuAttempt > 1 && (
                  <button className="tu-btn" onClick={() => onTuAttempt(0)} title="Fresh target, attempt 1">reset</button>
                )}
              </div>
            )}
            {result.tu_hp_now != null && result.tu_max_hp != null && result.tu_attempt! > 1 && (() => {
              // A miniature HP bar in the game's own colour language: green while
              // healthy, orange once wounded, red when low — so the reason the chance
              // is climbing is visible at a glance, not just stated in small print.
              const pct = Math.max(0, Math.min(100, (result.tu_hp_now / result.tu_max_hp) * 100));
              const tone = pct > 50 ? "hp-high" : pct > 25 ? "hp-mid" : "hp-low";
              return (
                <div className="tu-hp">
                  <div className="tu-hp-bar"><span className={`tu-hp-fill ${tone}`} style={{ width: `${pct}%` }} /></div>
                  <div className={`tu-hp-note ${tone}`}>
                    target HP {result.tu_hp_now.toLocaleString()} / {result.tu_max_hp.toLocaleString()} ({pct.toFixed(0)}%)
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        {/* The rate rides on the value line rather than its own row: a second line
            inside one metric raises the height of the entire headline row, which
            already carries up to eight cards. */}
        {attackRate ? (
          <HoverNote
            className="metric"
            note={<AttackRateNote
              periodMs={attackRate.periodMs}
              adelayMs={activeResult.timing?.animation_ms ?? aspdDelayMs}
              isSkill={rateIsSkill}
              castMs={rateIsSkill ? activeResult.timing?.cast_ms : undefined}
              afterCastMs={rateIsSkill ? activeResult.timing?.after_cast_ms : undefined}
              cooldownMs={rateIsSkill ? activeResult.timing?.cooldown_ms : undefined}
            />}
          >
            <div className="label">ASPD</div>
            <div className="value">
              {status.aspd.toFixed(1)}
              <span className="unit unit-rate">
                · {attackRate.perSec.toFixed(2)} {rateIsSkill ? "casts/s" : "atk/s"}
              </span>
            </div>
          </HoverNote>
        ) : (
          <div className="metric">
            <div className="label">ASPD</div>
            <div className="value">{status.aspd.toFixed(1)}</div>
          </div>
        )}
        {swing && isFinite(swing.min) && isFinite(swing.max) && (
          <div className="metric metric-range">
            <div className="label">Damage range</div>
            <div className="value range">
              {Math.round(swing.min)}<span className="unit">min</span>
              {" – "}
              {Math.round(swing.max)}<span className="unit">max</span>
            </div>
          </div>
        )}
        {/* The crit/non-crit blend — what one attack does on average, as opposed to
            the single outcome the selected branch shows. */}
        {showAvgPerCycle && (
          <div className="metric" title={`What one ${cycleNoun} does on average: your `
            + `${result.crit_chance.toFixed(1)}% criticals blended with the ordinary hits`
            + `${result.hit_chance < 100 ? `, and the ${(100 - result.hit_chance).toFixed(1)}% that miss` : ""}`
            + `${activeResult.result.proc_chances && Object.keys(activeResult.result.proc_chances).length ? ", plus procs" : ""}. `
            + `The branch buttons each show ONE outcome; this is the mix, and it is what DPS, `
            + `Hits to kill and Time to kill are built from (DPS ÷ ${(1000 / (result.period_ms || 1000)).toFixed(2)} per second).`}>
            <div className="label">Average / {cycleNoun}</div>
            <div className="value">{Math.round(avgPerCycle!).toLocaleString()}</div>
          </div>
        )}
        <div className="metric" title={displayDpsValid
          ? undefined
          : "No DPS for this branch: it has no repeat rate to quote. Killing Stroke drops you to 1 HP and cancels the Ninja Aura it needs; Fling spends your coins; Reflect Shield fires on the enemy's attacks, not yours. The per-hit damage is the meaningful number."}>
          <div className="label">DPS (est.)</div>
          <div className="value">{displayDpsValid && effectiveDps != null ? effectiveDps.toFixed(1) : "—"}</div>
        </div>
        {poisonDot > 0 && (
          <div className="metric" title="Poison ailment damage-over-time: the target loses 2% of its Max HP each second (Payon Stories; 1%/s vanilla). This is added to your DPS in the Time to kill below.">
            <div className="label">Poison DoT</div>
            <div className="value">{poisonDot.toLocaleString()}<span className="unit">/s</span></div>
          </div>
        )}
        {!isInstaKill && hitsAvg != null && (
          <div className="metric metric-range" title={noRateHit
            ? `Expected casts to kill the ${target_hp!.toLocaleString()}-HP target, from best-case to worst-case damage rolls. This skill has no repeat rate to quote, so there is no time to kill — only the number of casts.`
            : `Expected hits to kill the ${target_hp!.toLocaleString()}-HP target — using your effective per-hit damage (folding in crit rate, procs and ASPD, same as Time to kill), from best-case to worst-case damage rolls.`}>
            <div className="label">{noRateHit ? "Casts to kill" : "Hits to kill"}</div>
            <div className="value range">
              {hitsBest}<span className="unit">min</span>
              {" – "}
              {hitsWorst}<span className="unit">max</span>
            </div>
          </div>
        )}
        {/* The count for the branch you are looking at, unaveraged. */}
        {!isInstaKill && showBranchHits && (
          <div className="metric" title={`How many of THIS hit alone would kill the ${target_hp!.toLocaleString()}-HP target `
            + `(${Math.round(killAvg!).toLocaleString()} damage each). The count beside it is the realistic one — it folds in `
            + `crit rate, procs and ASPD, and is what Time to kill agrees with. This one assumes every hit lands like the branch on screen.`}>
            <div className="label">All {branchNoun}</div>
            <div className="value">{hitsThisBranch}<span className="unit">hits</span></div>
          </div>
        )}
        {isInstaKill && hitsAvg != null && (
          <div className="metric" title={`Expected casts to kill the ${target_hp!.toLocaleString()}-HP target, folding in the instant-kill success chance (and chip damage on failed rolls).`}>
            <div className="label">Casts to kill</div>
            <div className="value">{hitsAvg}</div>
          </div>
        )}
        {timeToKill != null && (
          <div className="metric" title={isInstaKill
            ? "Expected time to kill = expected casts (from the success chance) × cast + after-cast delay."
            : `Average time to kill = target HP ÷ estimated DPS (folds in ASPD, crit mix and procs; cast + after-cast delay for skills)${poisonDot > 0 ? ", plus the Poison DoT" : ""}.`}>
            <div className="label">Time to kill</div>
            <div className="value">{timeToKill.toFixed(1)}<span className="unit">s</span></div>
          </div>
        )}
        {showExp && baseExpPerHit != null && (
          <div className="metric" title={`${target_exp!.toLocaleString()} base EXP ÷ ${hitsAvg} ${expUnitLabel}s to kill.${expRangeNote(baseExpLow, baseExpHigh)} The monster's own EXP value — the server's EXP rate and the level-difference penalty are not applied.`}>
            <div className="label">Base EXP / {expUnitLabel}</div>
            <div className="value">{expFmt(baseExpPerHit)}</div>
          </div>
        )}
        {showExp && jobExpPerHit != null && (
          <div className="metric" title={`${target_job_exp!.toLocaleString()} job EXP ÷ ${hitsAvg} ${expUnitLabel}s to kill.${expRangeNote(jobExpLow, jobExpHigh)} The monster's own EXP value — the server's EXP rate and the level-difference penalty are not applied.`}>
            <div className="label">Job EXP / {expUnitLabel}</div>
            <div className="value">{expFmt(jobExpPerHit)}</div>
          </div>
        )}
        {activeBranch === "katar" && normal_attack.result.katar_proc_chance != null && (
          <div className="metric" title="A katar's second hit IS your Double Attack, at twice the per-level rate — the skill has no separate proc on a katar, so levelling Double Attack raises this number. Capped at 100%.">
            <div className="label">2nd hit proc</div>
            <div className="value">{normal_attack.result.katar_proc_chance.toFixed(1)}<span className="unit">%</span></div>
          </div>
        )}
      </div>

      {notImplemented && activeDamage && (
        <div className="notice warn">{activeDamage.steps[0].note}</div>
      )}

      {/* PS / Vanilla calc mode toggle — only for dual-wield Assassin builds */}
      {hasDualWield && (
        <div className="tabs" style={{ marginBottom: "0.5rem" }}>
          <button className={dwMode === "ps" ? "active" : ""} onClick={() => setDwMode("ps")}>
            PS (3-hit) <span className="beta-tag">beta</span>
          </button>
          <button className={dwMode === "vanilla" ? "active" : ""} onClick={() => setDwMode("vanilla")}>
            Vanilla
          </button>
        </div>
      )}

      {/* EXP per hit toggle — monster mode only, where the kill's EXP is known */}
      {hasExpPerHit && (
        <div className="proc-mode-row">
          <span className="proc-mode-label">EXP / {expUnitLabel}</span>
          <div className="proc-mode-toggle">
            <button
              className={!showExp ? "active" : ""}
              onClick={() => setShowExp(false)}
              title="Hide the EXP-per-hit readout"
            >
              Hide
            </button>
            <button
              className={showExp ? "active" : ""}
              onClick={() => setShowExp(true)}
              title={`Show the base and job EXP this kill awards, divided by the ${expUnitLabel}s it takes to kill`}
            >
              Show
            </button>
          </div>
        </div>
      )}

      {/* "Always proc" toggle — shown when the build has anything it changes: autobonus
          card effects (Bonechewer's Brutality) or the Holy Strike proc. */}
      {hasForceableProcs && (
        <div className="proc-mode-row">
          <span className="proc-mode-label">Procs</span>
          <div className="proc-mode-toggle">
            <button
              className={!forceProcs ? "active" : ""}
              onClick={() => { if (forceProcs) onToggleForceProcs(); }}
              title="Show damage at the real proc rates — proc damage counts toward DPS in proportion to how often it fires"
            >
              Normal
            </button>
            <button
              className={forceProcs ? "active" : ""}
              onClick={() => { if (!forceProcs) onToggleForceProcs(); }}
              title="Show damage as if every proc fires: card proc bonuses stay up, and Holy Strike procs on every attack"
            >
              Always
            </button>
          </div>
        </div>
      )}

      <div className="branch-toggle">
        <button
          className={`branch-skill-pill${activeBranch === "skill" && hasSkill ? " active" : ""}${!hasSkill && activeBranch === "normal" ? " active" : ""}`}
          onClick={() => { setBranch(hasSkill ? "skill" : "normal"); if (tuAttempt > 0) onTuAttempt?.(0); }}
          title={hasSkill
            ? `${selected_skill.label} Lv ${selected_skill.level} — one cast that does not crit`
            : "Your weapon's ordinary swing, no skill"}
        >
          {hasSkill ? `${selected_skill.label} Lv ${selected_skill.level}` : "Auto attack"}
        </button>

        {/* The auto attack, offered alongside the skill so you can see whether the
            skill is worth casting at all. It is a DIFFERENT attack, not the skill's
            non-crit hit — which is exactly what "Normal hit" was read as: a player
            reported the skill ratio "not applying" here, and it never should have.
            Reported 2026-10-10. */}
        {hasSkill && (
          <button
            className={activeBranch === "normal" ? "active" : ""}
            onClick={() => setBranch("normal")}
            title="Your weapon's ordinary swing, with no skill — a different attack, so the skill's damage multiplier does not apply here. For comparison against the skill."
          >
            Auto attack
          </button>
        )}

        {/* A skill that could crit but for a switch the player has not flipped. Without
            this the branch row just ends, and "this skill cannot crit" is
            indistinguishable from "you have not turned the thing on". */}
        {!hasCrit && critUnavailableReason && (
          <span className="branch-note" title={critUnavailableReason.detail}>
            {critUnavailableReason.short}
          </span>
        )}

        {hasCrit && (
          <button
            className={activeBranch === "crit" ? "active" : ""}
            onClick={() => setBranch("crit")}
            title={hasSkill
              ? `${selected_skill.label} Lv ${selected_skill.level} when it lands a critical — the same attack as the skill, so its damage multiplier still applies`
              : "Your auto attack when it lands a critical"}
          >
            Critical hit
          </button>
        )}

        {hasFalcon && (
          <button
            className={`branch-falcon-pill${activeBranch === "falcon" ? " active" : ""}`}
            onClick={() => setBranch("falcon")}
          >
            Falcon
          </button>
        )}

        {hasKatar && (
          <button
            className={activeBranch === "katar" ? "active" : ""}
            onClick={() => setBranch("katar")}
          >
            Katar 2nd hit
          </button>
        )}
      </div>

      {/* On a wide screen the step table and the survivability readout sit side by
          side: they answer the same question from both ends, and stacking them put a
          screenful of arithmetic between the two halves. Collapses to one column
          under 1100px. */}
      <div className={`ds-columns${aside ? " ds-columns--split" : ""}`}>
        <div className="ds-columns-main">
        {!notImplemented && (activeDamage || (activeBranch === "falcon" && falcon)) && (
          <div className="breakdown-view">
            <div className="breakdown-head">
              {/* "Damage calculation" -- the panel is already titled Damage
                  breakdown, so repeating it named the column after its container.
                  The skill is on the tab and in the headline; what belongs here is
                  what the table starts FROM. */}
              <span className="breakdown-title">Damage calculation</span>
              {activeDamage && <InputFigures steps={activeDamage.steps} />}
            </div>
            {activeBranch === "falcon" && falcon ? (
              <FalconView falcon={falcon} />
            ) : showDwCombined && dwRhBranch && dwLhBranch ? (
              <DualWieldStepList
                rh={dwRhBranch}
                lh={dwLhBranch}
                rhFactor={dwRhFactor}
                lhFactor={dwLhFactor}
                isCrit={activeBranch === "crit"}
                psBonusPct={dwPsBonusPct}
              />
            ) : activeDamage ? (
              <PipelineView steps={activeDamage.steps} hideFinal inputs={false} />
            ) : null}
            {activeBranch !== "falcon" && killAvg != null && (
              <div className="breakdown-total">
                <span className="breakdown-total-label">Final damage</span>
                <span className="breakdown-total-val">
                  {finalRange ? `${nfmt(killMin!)}–${nfmt(killMax!)}` : nfmt(killAvg)}
                  {/* Multi-hit skills land as N popups of total/N each, so say so --
                      a total left bare is read as one hit. On its own line under the
                      figure rather than in brackets beside it: it is a second fact
                      about the same number, and inline it read as part of it. */}
                  {(activeDamage?.num_hits ?? 1) > 1 && (
                    finalRange ? (
                      <span className="dw-per-hit">
                        {activeDamage!.num_hits} hits × {nfmt(Math.floor(killMin! / activeDamage!.num_hits))}–{nfmt(Math.floor(killMax! / activeDamage!.num_hits))}
                      </span>
                    ) : (
                      <span className="dw-per-hit">
                        {activeDamage!.num_hits} hits × {nfmt(Math.floor(killAvg / activeDamage!.num_hits))}
                      </span>
                    )
                  )}
                </span>
              </div>
            )}
            {critHeal && (
              <>
                <div className="breakdown-total">
                  <span className="breakdown-total-label">HP healed on this crit</span>
                  <span className="breakdown-total-val">
                    +{critHeal.min !== critHeal.max ? `${nfmt(critHeal.min)}–${nfmt(critHeal.max)}` : nfmt(critHeal.avg)}
                  </span>
                </div>
                <div className="self-damage-resists" style={{ marginTop: "0.5rem" }}>
                  <span className="self-damage-chip muted">
                    {(critHeal.permille / 10).toFixed(1)}% of the damage dealt (0.1% per refine)
                  </span>
                  <span className="self-damage-chip muted">healing, not damage — not in the total or DPS</span>
                </div>
              </>
            )}
          </div>
        )}
        </div>
        {aside && <div className="ds-columns-aside">{aside}</div>}
      </div>

      {selfDamage && <SelfDamageView sd={selfDamage} />}

      {autoSpell && <AutoSpellView branch={autoSpell.branch} chance={autoSpell.chance} label={autoSpell.label} />}

      {autoBlitz && <AutoBlitzView branch={autoBlitz.branch} chance={autoBlitz.chance} dpsAdded={autoBlitz.dpsAdded} />}

      {doubleHit && (
        <DoubleAttackView
          branch={doubleHit.branch}
          chance={doubleHit.chance}
          label={doubleHit.label}
          taChance={normal_attack.result.ta_proc_chance ?? 0}
          baseHit={normal_attack.result.hit_chance}
          procHit={normal_attack.result.double_hit_chance ?? null}
          hitBonus={normal_attack.result.double_hit_bonus ?? 0}
        />
      )}

      {tripleAttack && <TripleAttackView branch={tripleAttack.branch} chance={tripleAttack.chance} label={tripleAttack.label}
        crit={tripleAttack.crit} critChance={tripleAttack.critChance} />}

      {holyStrike && (
        <CardAutocastView title="Proc" label="Holy Strike" per="melee attack"
          branch={holyStrike.branch} chance={holyStrike.chance} dpsAdded={holyStrike.dpsAdded}
          critBranch={holyStrike.critBranch} critChance={holyStrike.critChance} />
      )}

      {cardAutocasts.map((ac) => (
        <CardAutocastView key={ac.key} branch={ac.branch} chance={ac.chance} label={ac.label} dpsAdded={ac.dpsAdded} />
      ))}
    </div>
  );
}
