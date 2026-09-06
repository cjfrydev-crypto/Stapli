export type RetailerKey = "tesco" | "asda" | "sainsburys" | "lidl" | "aldi" | "iceland";

export type PredictionMode = "auto" | "manual" | "off";
export type TripItemStatus = "pending" | "bought" | "unavailable" | "skipped";
export type TripItemSource = "manual" | "predicted" | "recipe" | "rollover";

export interface Retailer {
  id: RetailerKey;
  name: string;
  shortName: string;
}

export interface ArticlePreference {
  id: string;
  retailerId: RetailerKey;
  name: string;
  packSize?: string;
  retailerSku?: string;
  preferred: boolean;
}

export interface PurchaseObservation {
  id: string;
  productId: string;
  articleId?: string;
  retailerId: RetailerKey;
  quantity: number;
  purchasedAt: string;
  source: "manual" | "retailer_import" | "list_completion";
  context: "routine" | "one_off" | "event";
}

export interface HouseholdProduct {
  id: string;
  name: string;
  category: string;
  predictionMode: PredictionMode;
  manualCadenceDays?: number;
  manualQuantity?: number;
  articles: ArticlePreference[];
  purchases: PurchaseObservation[];
}

export interface ShoppingTripItem {
  id: string;
  productId: string;
  articleId?: string;
  label: string;
  articleLabel?: string;
  category: string;
  suggestedQuantity: number;
  actualQuantity: number;
  status: TripItemStatus;
  source: TripItemSource;
  confidence: "high" | "medium" | "low";
  rationale?: string;
}

export interface ShoppingTrip {
  id: string;
  retailerId: RetailerKey;
  label: string;
  plannedFor: string;
  status: "active" | "completed";
  items: ShoppingTripItem[];
}

export interface ProductCadenceStats {
  observedCadenceDays?: number;
  medianCadenceDays?: number;
  observedQuantity?: number;
  purchaseCount: number;
  lastPurchasedAt?: string;
  nextExpectedAt?: string;
  trend: "faster" | "slower" | "stable" | "insufficient";
  effectiveCadenceDays?: number;
  effectiveQuantity?: number;
}
