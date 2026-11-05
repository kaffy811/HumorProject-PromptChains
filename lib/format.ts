export const TIME_ZONE = "America/New_York";
export function when(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
export function seconds(ms: number | null | undefined) {
  return ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`;
}
// Captions are stored as [{caption, style}] (tool runs) or candidates with text (member runs).
export function captionList(value: unknown): { caption: string; style: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return { caption: item, style: "" };
    const c = (item ?? {}) as Record<string, unknown>;
    return { caption: String(c.caption ?? c.text ?? ""), style: String(c.style ?? "") };
  }).filter((c) => c.caption);
}
export function tokensOf(usage: unknown) {
  const u = (usage ?? {}) as { total?: unknown };
  return typeof u.total === "number" ? u.total : 0;
}
