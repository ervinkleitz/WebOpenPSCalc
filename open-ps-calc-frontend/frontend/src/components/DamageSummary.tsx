import { useState } from "react";

interface Step {
  name: string;
  value?: number;
  note?: string;
  formula?: string;
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
  status: { aspd: number };
  result: {
    hit_chance: number;
    crit_chance: number;
    normal: DamageBranch;
    crit?: DamageBranch;
    dps_valid: boolean;
    dps: number;
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
}

// "skill" = selected skill's normal hit
// "normal" = basic auto-attack
// "crit" = crit version of whichever is primary (skill if selected, else auto)
// "falcon" = falcon / blitz damage breakdown
type Branch = "skill" | "normal" | "crit" | "falcon";

function StepRow({ step }: { step: Step }) {
  return (
    <div className="step-row">
      <span className="step-name">{step.name}</span>
      <span className="step-value">{step.value != null ? Math.round(step.value) : "—"}</span>
      {step.note && <span className="step-note">{step.note}</span>}
      {step.formula && <span className="step-formula">{step.formula}</span>}
    </div>
  );
}

function FalconView({ falcon }: { falcon: FalconResult }) {
  return (
    <div className="falcon-rows">
      <div className="falcon-row">
        <span className="falcon-label">Auto-blitz (1 hit)</span>
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

export default function DamageSummary({ calcResult, calculating, error }: Props) {
  const [branch, setBranch] = useState<Branch>("skill");

  if (error) return <div className="notice warn">{error}</div>;
  if (calculating) return <p className="spinner-text">Calculating…</p>;
  if (!calcResult) return <p className="hint-text">Set up a build and target, then calculate damage.</p>;

  const { normal_attack, skill: skillResult, selected_skill } = calcResult;
  const hasSkill = skillResult !== null && selected_skill.id !== 0;
  // The "primary" result is the skill result when a skill is selected, otherwise the auto-attack.
  const primary = hasSkill ? skillResult! : normal_attack;
  const hasCrit = !!primary.result.crit;
  const falcon = (skillResult ?? normal_attack)?.falcon;
  const hasFalcon = !!falcon;

  // Clamp branch to valid options
  const activeBranch: Branch =
    branch === "skill" && !hasSkill ? "normal"
    : branch === "crit" && !hasCrit ? (hasSkill ? "skill" : "normal")
    : branch === "falcon" && !hasFalcon ? (hasSkill ? "skill" : "normal")
    : branch;

  // Which SingleResult provides the metrics and step breakdown (not used for falcon branch)
  const activeResult: SingleResult = activeBranch === "normal" ? normal_attack : primary;
  const activeDamage: DamageBranch | null = activeBranch === "falcon"
    ? null
    : activeBranch === "crit" ? primary.result.crit! : activeResult.result.normal;

  const notImplemented = activeDamage?.steps?.length === 1 && activeDamage.steps[0].name === "Not yet implemented";
  const { result, status } = activeResult;

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
        {activeDamage && activeDamage.min_damage != null && activeDamage.max_damage != null && (
          <div className="metric metric-range">
            <div className="label">Damage range</div>
            <div className="value range">
              {Math.round(activeDamage.min_damage)}<span className="unit">min</span>
              {" – "}
              {Math.round(activeDamage.max_damage)}<span className="unit">max</span>
            </div>
          </div>
        )}
        <div className="metric">
          <div className="label">DPS (est.)</div>
          <div className="value">{result.dps_valid ? result.dps.toFixed(1) : "—"}</div>
        </div>
      </div>

      {notImplemented && activeDamage && (
        <div className="notice warn">{activeDamage.steps[0].note}</div>
      )}

      <div className="branch-toggle">
        {/* Skill pill — primary view when a skill is selected */}
        <button
          className={`branch-skill-pill${activeBranch === "skill" && hasSkill ? " active" : ""}${!hasSkill && activeBranch === "normal" ? " active" : ""}`}
          onClick={() => setBranch(hasSkill ? "skill" : "normal")}
        >
          {hasSkill ? `${selected_skill.label} Lv ${selected_skill.level}` : "Normal Attack"}
        </button>

        {/* Normal hit — only shown as a separate option when a skill is selected */}
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
      </div>

      {activeBranch === "falcon" && falcon ? (
        <FalconView falcon={falcon} />
      ) : !notImplemented && activeDamage ? (
        <div className="step-list">
          {activeDamage.steps.map((step, i) => <StepRow step={step} key={i} />)}
        </div>
      ) : null}
    </div>
  );
}
