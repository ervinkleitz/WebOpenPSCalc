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

interface CalcResult {
  result: {
    hit_chance: number;
    crit_chance: number;
    normal: DamageBranch;
    crit?: DamageBranch;
    dps_valid: boolean;
    dps: number;
  };
}

interface Props {
  calcResult: CalcResult | null;
  calculating: boolean;
  error: string;
}

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

export default function DamageSummary({ calcResult, calculating, error }: Props) {
  const [branch, setBranch] = useState<"normal" | "crit">("normal");

  if (error) return <div className="notice warn">{error}</div>;
  if (calculating) return <p className="spinner-text">Calculating…</p>;
  if (!calcResult) return <p className="hint-text">Set up a build and target, then calculate damage.</p>;

  const { result } = calcResult;
  const damage = branch === "crit" && result.crit ? result.crit : result.normal;
  const notImplemented = damage.steps?.length === 1 && damage.steps[0].name === "Not yet implemented";

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
          <div className="label">Avg damage</div>
          <div className="value">{Math.round(damage.avg_damage)}</div>
        </div>
        {(damage.min_damage != null && damage.max_damage != null) && (
          <div className="metric metric-range">
            <div className="label">Damage range</div>
            <div className="value range">
              {Math.round(damage.min_damage)}<span className="unit">min</span>
              {" – "}
              {Math.round(damage.max_damage)}<span className="unit">max</span>
            </div>
          </div>
        )}
        <div className="metric">
          <div className="label">DPS (est.)</div>
          <div className="value">{result.dps_valid ? result.dps.toFixed(1) : "—"}</div>
        </div>
      </div>

      {notImplemented && (
        <div className="notice warn">{damage.steps[0].note}</div>
      )}

      {!notImplemented && (
        <>
          <div className="branch-toggle">
            <button className={branch === "normal" ? "active" : ""} onClick={() => setBranch("normal")}>Normal hit</button>
            {result.crit && (
              <button className={branch === "crit" ? "active" : ""} onClick={() => setBranch("crit")}>Critical hit</button>
            )}
          </div>
          <div className="step-list">
            {damage.steps.map((step, i) => <StepRow step={step} key={i} />)}
          </div>
        </>
      )}
    </div>
  );
}
