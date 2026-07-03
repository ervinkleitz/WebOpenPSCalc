import { useState } from "react";

interface Step {
  name: string;
  value?: number;
  min_value?: number;
  max_value?: number;
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

function StepRow({ step }: { step: Step }) {
  return (
    <div className={`step-row${step.info ? " step-row--info" : ""}`}>
      <span className="step-name">{step.name}</span>
      <span className="step-value">{stepDisplayVal(step)}</span>
      {step.note && <span className="step-note">{step.note}</span>}
      {step.formula && <span className="step-formula">{step.formula}</span>}
    </div>
  );
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
  const nodes = steps.filter(s => !s.info);
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
      {nodes.map((step, i) => {
        const prev = nodes[i - 1];
        const conn = prev ? connectorInfo(step, prev) : null;
        const isFinal = step.name === "Final Damage";
        return (
          <div key={i} className="pipeline-node">
            {conn && (
              <div className={`pipeline-conn ${conn.cls}`}>
                <div className="pipeline-conn-track" />
                <span className="pipeline-conn-badge">{conn.label}</span>
                {step.note && <span className="pipeline-conn-note">{step.note}</span>}
                <div className="pipeline-conn-track" />
              </div>
            )}
            <div className={`pipeline-card${isFinal ? " pipeline-card--final" : ""}`}>
              <span className="pipeline-card-name">{step.name}</span>
              <span className="pipeline-card-val">{stepDisplayVal(step)}</span>
            </div>
          </div>
        );
      })}
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
      <div className="step-list">
        {rh.steps.map((s, i) => <StepRow step={s} key={i} />)}
      </div>
      <div className="dw-section-label" style={{ marginTop: "0.5rem" }}>Hit 3 — LH {isCrit ? "crit" : "hit"} × {lhPct}%</div>
      <div className="step-list">
        {lh.steps.map((s, i) => <StepRow step={s} key={i} />)}
      </div>
      {psBonusPct != null && psBonusPct > 0 && (
        <div className="step-row" style={{ marginTop: "0.5rem" }}>
          <span className="step-name">PS Dual-Wield Bonus</span>
          <span className="step-value">×{(1 + psBonusPct / 100).toFixed(2)}</span>
          <span className="step-note">applied to combined total (+{psBonusPct}%)</span>
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

  const { normal_attack, skill: skillResult, selected_skill } = calcResult;
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
          <div className="value">{displayDpsValid && displayDps != null ? displayDps.toFixed(1) : "—"}</div>
        </div>
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
