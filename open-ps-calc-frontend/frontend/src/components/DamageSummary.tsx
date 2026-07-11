import { useState, Fragment } from "react";

interface Step {
  name: string;
  value?: number;
  min_value?: number;
  max_value?: number;
  multiplier?: number;
  note?: string;
  formula?: string;
  info?: boolean;
}

interface DamageBranch {
  avg_damage: number;
  min_damage: number;
  max_damage: number;
  steps: Step[];
}

interface FalconResult {
  per_hit: number;
  blitz_beat_lv: number;
  steel_crow_lv: number;
  auto_blitz_total: number;
  blitz_beat_total: number | null;
}

interface SingleResult {
  has_auto_bonuses?: boolean;
  status: { aspd: number };
  result: {
    hit_chance: number;
    crit_chance: number;
    normal: DamageBranch;
    crit?: DamageBranch;
    katar_second?: DamageBranch;
    katar_second_crit?: DamageBranch;
    katar_proc_chance?: number;
    dps_valid: boolean;
    dps: number;
    period_ms?: number;
    success_chance?: number | null; // Turn Undead: instant-kill success chance (%)
    dw_rh_factor?: number | null;
    dw_lh_factor?: number | null;
    dw_lh_normal?: DamageBranch | null;
    dw_lh_crit?: DamageBranch | null;
    dw_ps_bonus_pct?: number | null;
  };
  falcon?: FalconResult;
}

interface CalcResult {
  normal_attack: SingleResult;
  skill: SingleResult | null;
  selected_skill: { id: number; level: number; label: string };
  target_hp?: number | null; // monster HP (monster-mode only) for hits-to-kill / time-to-kill
  poison_dot_per_sec?: number | null; // Poison ailment damage-over-time (per second), folded into time-to-kill
}

interface Props {
  calcResult: CalcResult | null;
  calculating: boolean;
  error: string;
  forceProcs: boolean;
  onToggleForceProcs: () => void;
}

type Branch = "skill" | "normal" | "crit" | "falcon" | "katar";
type DwMode = "ps" | "vanilla";

function stepDisplayVal(step: Step): string {
  const hasRange = step.min_value != null && step.max_value != null
    && Math.round(step.min_value) !== Math.round(step.max_value);
  if (hasRange) return `${Math.round(step.min_value!)}–${Math.round(step.max_value!)}`;
  return step.value != null ? String(Math.round(step.value)) : "—";
}


function connectorInfo(step: Step, prev: Step): { label: string; cls: string } {
  const m = step.multiplier ?? 1.0;
  if (Math.abs(m - 1.0) > 0.001) {
    const pct = Math.round((m - 1) * 100);
    const sign = pct >= 0 ? "+" : "";
    return {
      label: `× ${m % 1 === 0 ? m.toFixed(0) : m.toFixed(2)}  (${sign}${pct}%)`,
      cls: m >= 1 ? "conn-boost" : "conn-reduce",
    };
  }
  const delta = Math.round((step.value ?? 0) - (prev.value ?? 0));
  if (delta > 0) return { label: `+ ${delta}`, cls: "conn-add" };
  if (delta < 0) return { label: `− ${-delta}`, cls: "conn-sub" };
  return { label: "→", cls: "conn-pass" };
}

function PipelineView({ steps }: { steps: Step[] }) {
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
  });
  return (
    <div className="pipeline-view">
      {chips.length > 0 && (
        <div className="pipeline-inputs">
          {chips.map((s, i) => (
            <span key={i} className="pipeline-chip">
              <span className="pipeline-chip-label">{s.name}</span>
              <span className="pipeline-chip-val">{stepDisplayVal(s)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="pipeline-track">
        {nodes.map((step, i) => {
          const prev = nodes[i - 1];
          const conn = prev ? connectorInfo(step, prev) : null;
          const isFinal = step.name === "Final Damage";
          return (
            <Fragment key={i}>
              {conn && (
                <div className={`pipeline-conn ${conn.cls}`}>
                  <span className="pipeline-conn-arrow">↓</span>
                  <span className="pipeline-conn-badge">{conn.label}</span>
                  {(conn.cls === "conn-boost" || conn.cls === "conn-reduce") && !isFinal && (
                    <span className="pipeline-conn-dest">→ {step.name}</span>
                  )}
                  {step.note && <span className="pipeline-conn-note">{step.note}</span>}
                </div>
              )}
              <div className={`pipeline-row${isFinal ? " pipeline-row--final" : ""}`}>
                <span className="pipeline-row-name">{step.name}</span>
                {!isFinal && <span className="pipeline-row-dots" aria-hidden="true" />}
                <span className="pipeline-row-val">{stepDisplayVal(step)}</span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function FalconView({ falcon }: { falcon: FalconResult }) {
  return (
    <div className="falcon-rows">
      <div className="falcon-row">
        <span className="falcon-label">Auto-blitz (5 hits)</span>
        <span className="falcon-value">{falcon.auto_blitz_total}</span>
      </div>
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
      <PipelineView steps={lh.steps} />
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

export default function DamageSummary({ calcResult, calculating, error, forceProcs, onToggleForceProcs }: Props) {
  const [branch, setBranch] = useState<Branch>("skill");
  const [dwMode, setDwMode] = useState<DwMode>("ps");

  if (error) return <div className="notice warn">{error}</div>;
  if (calculating) return <p className="spinner-text">Calculating…</p>;
  if (!calcResult) return <p className="hint-text">Set up a build and target, then calculate damage.</p>;

  const { normal_attack, skill: skillResult, selected_skill, target_hp, poison_dot_per_sec } = calcResult;
  const hasAutoBonus = !!normal_attack.has_auto_bonuses;
  const hasSkill = skillResult !== null && selected_skill.id !== 0;
  const primary = hasSkill ? skillResult! : normal_attack;
  const hasCrit = !!primary.result.crit;
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
  const dwPsBonusMult = 1 + dwPsBonusPct / 100;

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
  const activeDamage: DamageBranch | null = activeBranch === "falcon"
    ? null
    : activeBranch === "katar" ? (normal_attack.result.katar_second ?? null)
    : activeBranch === "crit" ? primary.result.crit!
    : activeResult.result.normal;

  const notImplemented = activeDamage?.steps?.length === 1 && activeDamage.steps[0].name === "Not yet implemented";
  const { result, status } = activeResult;

  // Combined DW damage range for the headline (PS mode, normal/crit branch)
  const showDwCombined = hasDualWield && dwMode === "ps" && !!dwLhNormal && (activeBranch === "normal" || activeBranch === "crit");
  const dwRhBranch = activeBranch === "crit" ? (normal_attack.result.crit ?? normal_attack.result.normal) : normal_attack.result.normal;
  const dwLhBranch = activeBranch === "crit" ? (dwLhCrit ?? dwLhNormal!) : dwLhNormal!;
  const combinedMin = showDwCombined ? Math.round((2 * dwRhBranch.min_damage * dwRhFactor + dwLhBranch.min_damage * dwLhFactor) * dwPsBonusMult) : null;
  const combinedMax = showDwCombined ? Math.round((2 * dwRhBranch.max_damage * dwRhFactor + dwLhBranch.max_damage * dwLhFactor) * dwPsBonusMult) : null;

  // DPS: combined PS DPS in PS mode, single-weapon recomputed in Vanilla mode
  const displayDps = hasDualWield && dwMode === "vanilla" ? vanillaDps : result.dps;
  const displayDpsValid = hasDualWield && dwMode === "vanilla"
    ? (vanillaDps !== null && isFinite(vanillaDps))
    : result.dps_valid;

  // Hits to kill (min/avg/max) and time to kill vs a monster's HP. Per-hit damage
  // uses the displayed branch (or the combined dual-wield total); time-to-kill uses
  // the estimated DPS, which already folds in ASPD / crit mix / procs (and cast +
  // after-cast delay for skills). Only shown in monster mode, where HP is known.
  const killMin = showDwCombined ? combinedMin : activeDamage?.min_damage ?? null;
  const killAvg = showDwCombined ? Math.round(((combinedMin ?? 0) + (combinedMax ?? 0)) / 2) : activeDamage?.avg_damage ?? null;
  const killMax = showDwCombined ? combinedMax : activeDamage?.max_damage ?? null;
  const hitsToKill = (dmg: number | null | undefined) =>
    target_hp != null && dmg != null && dmg > 0 ? Math.ceil(target_hp / dmg) : null;

  // Turn Undead is an instant-kill skill: each cast has `success_chance` to kill
  // outright, and on failure deals `killAvg` chip damage. Expected casts to kill
  // = E[min(Geom(p), nChip)] = (1 − (1−p)^nChip) / p, where nChip = casts to kill
  // by chip damage alone (handles the p→0 limit, where it degrades to nChip). Time
  // to kill = expected casts × cast period. This is what folds the success chance
  // into the hits/duration metrics.
  const successChance = result.success_chance ?? null;
  const isInstaKill = successChance != null;
  let tuCasts: number | null = null;
  if (isInstaKill && target_hp != null) {
    const p = Math.max(0, Math.min(1, (successChance as number) / 100));
    const nChip = killAvg != null && killAvg > 0 ? Math.ceil(target_hp / killAvg) : Infinity;
    if (p > 0) {
      const survive = Math.pow(1 - p, isFinite(nChip) ? nChip : 1e9);
      tuCasts = (1 - survive) / p;
    } else if (isFinite(nChip)) {
      tuCasts = nChip;
    }
  }
  const tuCastsRounded = tuCasts != null ? Math.max(1, Math.round(tuCasts)) : null;
  const periodS = (result.period_ms ?? 0) / 1000;

  const hitsBest = isInstaKill ? null : hitsToKill(killMax);   // fewest hits — best-case (max) rolls
  const hitsAvg = isInstaKill ? tuCastsRounded : hitsToKill(killAvg);
  const hitsWorst = isInstaKill ? null : hitsToKill(killMin);  // most hits — worst-case (min) rolls
  // Poison ailment damage-over-time (per second), added to the attack DPS so the
  // target dies sooner. Constant since it's a fraction of Max HP, so it folds in
  // as a flat +DPS term. Only present in monster mode with the Poison status on.
  const poisonDot = poison_dot_per_sec != null && poison_dot_per_sec > 0 ? poison_dot_per_sec : 0;
  const killDps = (displayDpsValid && displayDps != null ? displayDps : 0) + poisonDot;
  const timeToKill = isInstaKill
    ? (tuCasts != null && periodS > 0 ? tuCasts * periodS : null)
    : (target_hp != null && killDps > 0 ? target_hp / killDps : null);
  // For an instant-kill skill, "DPS" as chip-damage throughput is misleading next
  // to the kill metrics (they'd imply far less than the target's HP). Show the
  // effective throughput (HP ÷ expected time) so the panel stays self-consistent;
  // fall back to the raw DPS when the target's HP is unknown (custom target).
  const effectiveDps = isInstaKill && target_hp != null && timeToKill != null && timeToKill > 0
    ? target_hp / timeToKill : displayDps;

  return (
    <div>
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
          <div className="metric" title="Turn Undead instant-kill chance per cast: [20×SkillLv + 3×LUK + INT + BaseLv + (1−HP/MaxHP)×200] ÷ 10 %, halved if base INT < 40. On a failed roll the skill deals the shown (fail) damage instead.">
            <div className="label">Success chance</div>
            <div className="value good">{(successChance as number).toFixed(1)}<span className="unit">%</span></div>
          </div>
        )}
        <div className="metric">
          <div className="label">ASPD</div>
          <div className="value">{status.aspd.toFixed(1)}</div>
        </div>
        {showDwCombined ? (
          <div className="metric metric-range">
            <div className="label">Damage range</div>
            <div className="value range">
              {combinedMin}<span className="unit">min</span>
              {" – "}
              {combinedMax}<span className="unit">max</span>
            </div>
          </div>
        ) : activeDamage && activeDamage.min_damage != null && activeDamage.max_damage != null ? (
          <div className="metric metric-range">
            <div className="label">Damage range</div>
            <div className="value range">
              {Math.round(activeDamage.min_damage)}<span className="unit">min</span>
              {" – "}
              {Math.round(activeDamage.max_damage)}<span className="unit">max</span>
            </div>
          </div>
        ) : null}
        <div className="metric">
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
          <div className="metric metric-range" title={`Hits to kill the ${target_hp!.toLocaleString()}-HP target — from best-case (all max-damage rolls) to worst-case (all min-damage rolls).`}>
            <div className="label">Hits to kill</div>
            <div className="value range">
              {hitsBest}<span className="unit">min</span>
              {" – "}
              {hitsWorst}<span className="unit">max</span>
            </div>
          </div>
        )}
        {hitsAvg != null && (
          <div className="metric" title={isInstaKill
            ? `Expected casts to kill the ${target_hp!.toLocaleString()}-HP target, folding in the instant-kill success chance (and chip damage on failed rolls).`
            : "Average hits to kill, from the average damage roll."}>
            <div className="label">{isInstaKill ? "Casts to kill" : "Avg hits"}</div>
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
        {activeBranch === "katar" && normal_attack.result.katar_proc_chance != null && (
          <div className="metric">
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

      {/* Cards always proc toggle — shown when equipped cards have autobonus proc effects */}
      {hasAutoBonus && (
        <div className="proc-mode-row">
          <span className="proc-mode-label">Proc cards</span>
          <div className="proc-mode-toggle">
            <button
              className={!forceProcs ? "active" : ""}
              onClick={() => { if (forceProcs) onToggleForceProcs(); }}
              title="Show damage without proc-based card bonuses active"
            >
              Normal
            </button>
            <button
              className={forceProcs ? "active" : ""}
              onClick={() => { if (!forceProcs) onToggleForceProcs(); }}
              title="Show damage as if proc-based card bonuses are always active"
            >
              Always
            </button>
          </div>
        </div>
      )}

      <div className="branch-toggle">
        <button
          className={`branch-skill-pill${activeBranch === "skill" && hasSkill ? " active" : ""}${!hasSkill && activeBranch === "normal" ? " active" : ""}`}
          onClick={() => setBranch(hasSkill ? "skill" : "normal")}
        >
          {hasSkill ? `${selected_skill.label} Lv ${selected_skill.level}` : "Normal Attack"}
        </button>

        {hasSkill && (
          <button
            className={activeBranch === "normal" ? "active" : ""}
            onClick={() => setBranch("normal")}
          >
            Normal hit
          </button>
        )}

        {hasCrit && (
          <button
            className={activeBranch === "crit" ? "active" : ""}
            onClick={() => setBranch("crit")}
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
      ) : !notImplemented && activeDamage ? (
        <PipelineView steps={activeDamage.steps} />
      ) : null}
    </div>
  );
}
