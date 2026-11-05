// Dashboard numbers from tool runs. Pure, so it is unit-tested.
export type RunStat = { id: string; status: string; created_at: string; completed_at: string | null };
export type StepStat = { run_id: string; usage: unknown; latency_ms: number | null };

const DAY = 86_400_000;
const tokens = (usage: unknown) => {
  const total = (usage as { total?: unknown } | null)?.total;
  return typeof total === "number" ? total : 0;
};

export function runStats(runs: RunStat[], steps: StepStat[], now = new Date()) {
  const since = now.getTime() - 7 * DAY, before = since - 7 * DAY;
  const week = runs.filter((r) => Date.parse(r.created_at) >= since);
  const lastWeek = runs.filter((r) => { const t = Date.parse(r.created_at); return t >= before && t < since; });
  const finished = week.filter((r) => r.status === "completed" || r.status === "failed");
  const ids = new Set(week.map((r) => r.id));
  const weekSteps = steps.filter((s) => ids.has(s.run_id));
  // Total model time per completed run, then the median.
  const perRun = new Map<string, number>();
  for (const s of weekSteps) perRun.set(s.run_id, (perRun.get(s.run_id) ?? 0) + (s.latency_ms ?? 0));
  const durations = week.filter((r) => r.status === "completed").map((r) => perRun.get(r.id) ?? 0).filter((ms) => ms > 0).sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const median = !durations.length ? null : durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
  // Runs per day for the last 7 days, oldest first (UTC days).
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = today - (6 - i) * DAY;
    const inDay = runs.filter((r) => { const t = Date.parse(r.created_at); return t >= start && t < start + DAY; });
    return { date: new Date(start).toISOString().slice(0, 10), runs: inDay.length, failed: inDay.filter((r) => r.status === "failed").length };
  });
  return {
    runsWeek: week.length,
    runsLastWeek: lastWeek.length,
    successRate: finished.length ? finished.filter((r) => r.status === "completed").length / finished.length : null,
    tokensWeek: weekSteps.reduce((sum, s) => sum + tokens(s.usage), 0),
    medianMs: median,
    days,
  };
}
