const DAY_MS = 86_400_000;

export type CadenceNeed = {
  prediction_mode: "auto" | "manual" | "off";
  manual_cadence_days: number | null;
  manual_quantity: number | null;
};

export type CadenceEvent = {
  quantity: number;
  purchased_at: string;
  context: "routine" | "one_off" | "recipe" | "imported" | string;
  article_id?: string | null;
};

export type CadenceStats = {
  observedCadence16w?: number;
  robustCadence16w?: number;
  observedQuantity16w?: number;
  recentPurchaseCount: number;
  totalPurchaseCount: number;
  lastPurchasedAt?: string;
  effectiveCadenceDays?: number;
  effectiveQuantity?: number;
  nextExpectedAt?: string;
  trend: "faster" | "slower" | "stable" | "insufficient";
};

function mean(values: number[]) {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dayDiff(a: string, b: string) {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

function intervals(events: CadenceEvent[]) {
  return events.slice(1).map((event, index) => dayDiff(events[index].purchased_at, event.purchased_at));
}

export function calculateCadenceFromEvents(
  need: CadenceNeed,
  allEvents: CadenceEvent[],
  options: { now?: Date; quantityArticleId?: string | null } = {},
): CadenceStats {
  const now = options.now ?? new Date();
  const routine = allEvents
    .filter((event) => event.context !== "one_off" && event.context !== "recipe")
    .sort((a, b) => new Date(a.purchased_at).getTime() - new Date(b.purchased_at).getTime());

  const sixteenWeeksAgo = new Date(now.getTime() - 16 * 7 * DAY_MS);
  const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * DAY_MS);
  const recent16 = routine.filter((event) => new Date(event.purchased_at) >= sixteenWeeksAgo);
  const last8 = routine.filter((event) => new Date(event.purchased_at) >= eightWeeksAgo);
  const prior8 = routine.filter((event) => {
    const date = new Date(event.purchased_at);
    return date >= sixteenWeeksAgo && date < eightWeeksAgo;
  });

  const observedIntervals = intervals(recent16);
  const observedCadence16w = mean(observedIntervals);
  const robustCadence16w = median(observedIntervals);
  const articleQuantityEvents = options.quantityArticleId
    ? routine.filter((event) => event.article_id === options.quantityArticleId)
    : routine;
  const quantityEvents = articleQuantityEvents.length >= 2 ? articleQuantityEvents : routine;
  const quantityRecent16 = quantityEvents.filter((event) => new Date(event.purchased_at) >= sixteenWeeksAgo);
  const observedQuantity16w = mean(quantityRecent16.map((event) => Number(event.quantity)));

  const recentCadence = mean(intervals(last8));
  const priorCadence = mean(intervals(prior8));
  let trend: CadenceStats["trend"] = "insufficient";
  if (recentCadence && priorCadence) {
    const ratio = recentCadence / priorCadence;
    trend = ratio < 0.82 ? "faster" : ratio > 1.18 ? "slower" : "stable";
  } else if (observedIntervals.length >= 2) {
    trend = "stable";
  }

  const learnedCadence = robustCadence16w ?? observedCadence16w;
  const effectiveCadenceDays = need.prediction_mode === "manual"
    ? need.manual_cadence_days ?? undefined
    : need.prediction_mode === "auto"
      ? learnedCadence
      : undefined;

  const recentQuantities = quantityEvents.slice(-6).map((event) => Number(event.quantity));
  const quantityCounts = new Map<number, number>();
  for (const quantity of recentQuantities) quantityCounts.set(quantity, (quantityCounts.get(quantity) ?? 0) + 1);
  const dominantRecentQuantity = [...quantityCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const learnedQuantity = dominantRecentQuantity && dominantRecentQuantity[1] >= 4
    ? dominantRecentQuantity[0]
    : median(recentQuantities) ?? observedQuantity16w;

  const effectiveQuantity = need.prediction_mode === "manual" && need.manual_quantity != null
    ? Number(need.manual_quantity)
    : learnedQuantity;

  const lastPurchasedAt = routine.at(-1)?.purchased_at;
  const nextExpectedAt = lastPurchasedAt && effectiveCadenceDays
    ? new Date(new Date(lastPurchasedAt).getTime() + effectiveCadenceDays * DAY_MS).toISOString()
    : undefined;

  return {
    observedCadence16w,
    robustCadence16w,
    observedQuantity16w,
    recentPurchaseCount: recent16.length,
    totalPurchaseCount: routine.length,
    lastPurchasedAt,
    effectiveCadenceDays,
    effectiveQuantity,
    nextExpectedAt,
    trend,
  };
}

export function formatDays(value?: number) {
  if (value == null || Number.isNaN(value)) return "—";
  return value < 10 ? `${value.toFixed(1)}d` : `${Math.round(value)}d`;
}

export function formatQuantity(value?: number) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function dueLabel(nextExpectedAt?: string, now = new Date()) {
  if (!nextExpectedAt) return "Learning";
  const days = Math.ceil((new Date(nextExpectedAt).getTime() - now.getTime()) / DAY_MS);
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days === -1) return "1d overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}
