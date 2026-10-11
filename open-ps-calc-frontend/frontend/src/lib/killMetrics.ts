// The headline kill numbers — damage per attack, hits to kill, time to kill —
// computed in ONE place.
//
// They used to be worked out twice: once in DamageSummary for the breakdown panel,
// and once in CompareView.summaryMetrics for the pinned columns. The two drifted,
// and the way they drifted was invisible unless you had both on screen: a pinned
// dual-wield Assassin reported "Damage / hit 1,625" while the breakdown right below
// it ended on "Final damage 5,074–5,327". The pin was reading the first sub-table —
// one right-hand hit — because it took `result.normal` straight off the response and
// a PS dual-wield lands two right-hand hits plus a left-hand one per swing. Hits to
// kill then inherited the error wholesale (reported by Frennetix, 2026-10-10).
//
// So both callers go through here now. Anything that is "what the player sees at the
// top of the results" belongs in this file.

export interface Range {
  min: number;
  avg: number;
  max: number;
}

interface BranchLike {
  min_damage: number;
  avg_damage: number;
  max_damage: number;
}

/** The subset of a SingleResult["result"] these numbers need. */
export interface ResultLike {
  normal: BranchLike;
  crit?: BranchLike | null;
  dps: number;
  dps_valid: boolean;
  period_ms?: number;
  success_chance?: number | null;
  dw_rh_factor?: number | null;
  dw_lh_factor?: number | null;
  dw_lh_normal?: BranchLike | null;
  dw_lh_crit?: BranchLike | null;
  dw_ps_bonus_pct?: number | null;
}

/**
 * What one auto-attack swing of a PS dual-wield actually lands: two right-hand hits
 * at `dw_rh_factor` each plus one left-hand hit at `dw_lh_factor`, the whole thing
 * under the PS dual-wield bonus. This is the figure the breakdown's final line adds
 * up to — the per-weapon sub-totals above it are the parts, not the swing.
 *
 * Returns null for anything that is not a PS dual-wield, so the caller falls back to
 * the branch's own damage.
 */
export function dwCombinedRange(res: ResultLike, crit: boolean): Range | null {
  if (res.dw_rh_factor == null || !res.dw_lh_normal) return null;
  const rhFactor = res.dw_rh_factor ?? 1;
  const lhFactor = res.dw_lh_factor ?? 1;
  const bonus = 1 + (res.dw_ps_bonus_pct ?? 0) / 100;
  const rh = crit ? (res.crit ?? res.normal) : res.normal;
  const lh = crit ? (res.dw_lh_crit ?? res.dw_lh_normal) : res.dw_lh_normal;
  const at = (pick: (b: BranchLike) => number) =>
    Math.round((2 * pick(rh) * rhFactor + pick(lh) * lhFactor) * bonus);
  const min = at((b) => b.min_damage);
  const max = at((b) => b.max_damage);
  // The average of a combined swing is the midpoint of its own range — which is what
  // the panel has always shown for it.
  return { min, max, avg: Math.round((min + max) / 2) };
}

/**
 * The damage the player is looking at for one attack: the dual-wield swing total
 * where that applies, otherwise the displayed branch's own damage.
 */
export function swingDamage(
  res: ResultLike,
  branch: BranchLike | null | undefined,
  opts: { dw: boolean; crit: boolean },
): Range | null {
  if (opts.dw) {
    const combined = dwCombinedRange(res, opts.crit);
    if (combined) return combined;
  }
  if (!branch) return null;
  return { min: branch.min_damage, avg: branch.avg_damage, max: branch.max_damage };
}

export interface KillInput {
  targetHp?: number | null;
  /** Damage per attack, as displayed. */
  damage: Range | null;
  /** DPS as displayed (vanilla-mode recomputation already applied, if any). */
  dps: number | null;
  dpsValid: boolean;
  periodMs: number;
  poisonDotPerSec?: number | null;
  /** Turn Undead's per-cast instant-kill chance, when the skill has one. */
  successChance?: number | null;
}

export interface KillNumbers {
  /** Fewest hits — best-case damage rolls. */
  hitsBest: number | null;
  /** The realistic count, and the one Time to kill agrees with. */
  hitsAvg: number | null;
  /** Most hits — worst-case damage rolls. */
  hitsWorst: number | null;
  /** How many of THIS hit alone would do it, with no crit/proc mix folded in. */
  hitsThisBranch: number | null;
  timeToKill: number | null;
  /** Turn Undead: the metrics count casts, and there is no damage-based hit count. */
  isInstaKill: boolean;
  /** A branch with no repeat rate (Killing Stroke, Fling, Reflect Shield): casts to
   *  kill is still a real question there, time to kill is not. */
  noRateHit: boolean;
  /** Expected casts for an instant-kill skill, unrounded. */
  tuCasts: number | null;
  /** Expected damage per attack cycle — the basis shared by hits and time. */
  expPerHit: number | null;
  /** DPS including the poison DoT, which is what the duration divides by. */
  killDps: number;
}

/**
 * Hits-to-kill and time-to-kill share ONE basis so they cannot disagree: the expected
 * damage per attack cycle = DPS × period, which folds in crit RATE, procs and ASPD
 * exactly as the DPS and the duration do. (Using the displayed branch's per-hit
 * damage for the hit count assumes 100% of that branch — e.g. all crits — so a
 * big-crit / low-crit-rate build showed FEWER hits yet a SLOWER time.) The min/max
 * envelope applies the displayed branch's roll spread around that value.
 */
export function killMetrics(input: KillInput): KillNumbers {
  const { targetHp, damage, dps, dpsValid, periodMs } = input;
  const killAvg = damage?.avg ?? null;
  const killMin = damage?.min ?? null;
  const killMax = damage?.max ?? null;
  const periodS = (periodMs ?? 0) / 1000;
  const poisonDot = input.poisonDotPerSec != null && input.poisonDotPerSec > 0 ? input.poisonDotPerSec : 0;
  const killDps = (dpsValid && dps != null ? dps : 0) + poisonDot;

  const successChance = input.successChance ?? null;
  const isInstaKill = successChance != null;

  const hitsToKill = (dmg: number | null | undefined) =>
    targetHp != null && dmg != null && dmg > 0 ? Math.ceil(targetHp / dmg) : null;

  // Turn Undead is an instant-kill skill: each cast has `success_chance` to kill
  // outright, and on failure deals `killAvg` chip damage. Expected casts to kill
  // = E[min(Geom(p), nChip)] = (1 − (1−p)^nChip) / p, where nChip = casts to kill by
  // chip damage alone (handles the p→0 limit, where it degrades to nChip).
  let tuCasts: number | null = null;
  if (isInstaKill && targetHp != null) {
    const p = Math.max(0, Math.min(1, (successChance as number) / 100));
    const nChip = killAvg != null && killAvg > 0 ? Math.ceil(targetHp / killAvg) : Infinity;
    if (p > 0) {
      const survive = Math.pow(1 - p, isFinite(nChip) ? nChip : 1e9);
      tuCasts = (1 - survive) / p;
    } else if (isFinite(nChip)) {
      tuCasts = nChip;
    }
  }
  const tuCastsRounded = tuCasts != null ? Math.max(1, Math.round(tuCasts)) : null;

  // A branch with no meaningful rate reports dps_valid:false, which zeroes killDps —
  // but "how many casts to kill" is still a real question there. Those branches are a
  // single deterministic hit with no crit or proc mix, so the per-hit damage IS the
  // expected damage per cast and the reason for the DPS×period basis doesn't apply.
  const noRateHit = !isInstaKill && !dpsValid && killAvg != null && killAvg > 0;
  const expPerHit = !isInstaKill && killDps > 0 && periodS > 0 ? killDps * periodS
    : noRateHit ? killAvg
    : null;
  const hiRatio = killAvg != null && killAvg > 0 && killMax != null ? killMax / killAvg : 1;
  const loRatio = killAvg != null && killAvg > 0 && killMin != null ? killMin / killAvg : 1;

  const timeToKill = isInstaKill
    ? (tuCasts != null && periodS > 0 ? tuCasts * periodS : null)
    : (targetHp != null && killDps > 0 ? targetHp / killDps : null);

  return {
    hitsBest: isInstaKill ? null : hitsToKill(expPerHit != null ? expPerHit * hiRatio : null),
    hitsAvg: isInstaKill ? tuCastsRounded : hitsToKill(expPerHit),
    hitsWorst: isInstaKill ? null : hitsToKill(expPerHit != null ? expPerHit * loRatio : null),
    hitsThisBranch: isInstaKill ? null : hitsToKill(killAvg),
    timeToKill,
    isInstaKill,
    noRateHit,
    tuCasts,
    expPerHit,
    killDps,
  };
}
