export type CatalogCategory =
  | "straight"
  | "curved"
  | "turnout"
  | "crossing"
  | "double"
  | "viaduct"
  | "bridge"
  | "accessory";
export type TrackShape =
  | "straight"
  | "curve"
  | "turnout"
  | "crossing"
  | "doubleStraight"
  | "doubleCurve"
  | "scissors"
  | "accessory";
export interface CatalogItem {
  kind: string;
  label: string;
  name: string;
  sku?: string;
  category: CatalogCategory;
  shape: TrackShape;
  length: number;
  radius?: number;
  angle?: number;
  branchRadius?: number;
  branchAngle?: number;
  branchLength?: number;
  crossingAngle?: number;
  lanes?: number;
  laneSpacing?: number;
  innerRadius?: number;
  outerRadius?: number;
  bed: "ballast" | "slab" | "viaduct" | "bridge" | "none";
  accessoryType?:
    | "platform"
    | "station"
    | "pier"
    | "catenary"
    | "signal"
    | "buffer"
    | "crossingGate"
    | "building";
  footprint?: { length: number; width: number; height: number };
  /** Modeled roadbed-base height in mm; verification is recorded in KATO_SUPPORT_DATA. */
  supportDeckHeight?: number;
  /** Pier-column height used by the model; nominal values are identified in notes. */
  supportComponentHeight?: number;
  color?: string;
  sourceUrl: string;
  verification: "verified" | "nominal";
  notes?: string;
}
