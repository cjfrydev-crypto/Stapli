import type { HouseholdProduct, ProductCadenceStats, PurchaseObservation } from "./types";

const DAY_MS = 86_400_000;

function mean(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dateDiffDays(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

function routinePurchases(purchases: PurchaseObservation[]) {
  return purchases
    .filter((purchase) => purchase.context === "routine")
    .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());
}

function cadenceForWindow(purchases: PurchaseObservation[], from: Date): number | undefined {
  const inWindow = purchases.filter((purchase) => new Date(purchase.purchasedAt) >= from);
  if (inWindow.length < 2) return undefined;
  const intervals = inWindow.slice(1).map((purchase, index) =>
    dateDiffDays(inWindow[index].purchasedAt, purchase.purchasedAt),
  );
  return mean(intervals);
}

export function calculateProductStats(
  product: HouseholdProduct,
  now = new Date(),
  windowWeeks = 16,
): ProductCadenceStats {
  const purchases = routinePurchases(product.purchases);
  const windowStart = new Date(now.getTime() - windowWeeks * 7 * DAY_MS);
  const windowPurchases = purchases.filter((purchase) => new Date(purchase.purchasedAt) >= windowStart);

  const observedIntervals = windowPurchases.slice(1).map((purchase, index) =>
    dateDiffDays(windowPurchases[index].purchasedAt, purchase.purchasedAt),
  );

  const observedCadenceDays = mean(observedIntervals);
  const medianCadenceDays = median(observedIntervals);
  const observedQuantity = mean(windowPurchases.map((purchase) => purchase.quantity));

  const learnedCadence = medianCadenceDays ?? observedCadenceDays;
  const effectiveCadenceDays =
    product.predictionMode === "manual"
      ? product.manualCadenceDays
      : product.predictionMode === "auto"
        ? learnedCadence
        : undefined;

  const effectiveQuantity =
    product.predictionMode === "manual" && product.manualQuantity != null
      ? product.manualQuantity
      : observedQuantity ?? product.manualQuantity;

  const lastPurchasedAt = purchases.at(-1)?.purchasedAt;
  const nextExpectedAt =
    lastPurchasedAt && effectiveCadenceDays
      ? new Date(new Date(lastPurchasedAt).getTime() + effectiveCadenceDays * DAY_MS).toISOString()
      : undefined;

  const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * DAY_MS);
  const sixteenWeeksAgo = new Date(now.getTime() - 16 * 7 * DAY_MS);
  const recent = cadenceForWindow(purchases, eightWeeksAgo);
  const previousWindowPurchases = purchases.filter((purchase) => {
    const date = new Date(purchase.purchasedAt);
    return date >= sixteenWeeksAgo && date < eightWeeksAgo;
  });
  const previous = previousWindowPurchases.length >= 2
    ? mean(previousWindowPurchases.slice(1).map((purchase, index) =>
        dateDiffDays(previousWindowPurchases[index].purchasedAt, purchase.purchasedAt),
      ))
    : undefined;

  let trend: ProductCadenceStats["trend"] = "insufficient";
  if (recent && previous) {
    const ratio = recent / previous;
    trend = ratio < 0.82 ? "faster" : ratio > 1.18 ? "slower" : "stable";
  } else if (observedIntervals.length >= 2) {
    trend = "stable";
  }

  return {
    observedCadenceDays,
    medianCadenceDays,
    observedQuantity,
    purchaseCount: purchases.length,
    lastPurchasedAt,
    nextExpectedAt,
    trend,
    effectiveCadenceDays,
    effectiveQuantity,
  };
}

export function formatDays(value?: number) {
  if (value == null || Number.isNaN(value)) return "—";
  return value < 10 ? `${value.toFixed(1)}d` : `${Math.round(value)}d`;
}

export function daysUntil(date?: string, now = new Date()) {
  if (!date) return undefined;
  return Math.ceil((new Date(date).getTime() - now.getTime()) / DAY_MS);
}
