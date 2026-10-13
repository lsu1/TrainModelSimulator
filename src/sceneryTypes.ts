/** Decorative surroundings use the same N-scale millimetres as the railway. */
export type SceneryTheme = 'city' | 'countryside' | 'hills';
export type SceneryFeature = 'buildings' | 'roads' | 'cars' | 'people' | 'trees' | 'parks' | 'river';
export type SceneryDensity = 'quiet' | 'balanced' | 'busy';
export interface SceneryPoint { x: number; y: number }
export interface SceneryArea extends SceneryPoint { radius: number }
export interface SceneryBounds { minX: number; maxX: number; minY: number; maxY: number }
export interface SceneryObject extends SceneryPoint {
  id: string;
  kind: 'house' | 'apartment' | 'shop' | 'office' | 'tree' | 'park' | 'person' | 'hill';
  angle: number;
  width: number;
  depth: number;
  height: number;
  /** Small palette/shape variation, stable through saving and reopening. */
  variant: number;
}
export interface SceneryRoad {
  id: string;
  points: SceneryPoint[];
  width: number;
  closed: boolean;
}
export interface SceneryRiver { id: string; points: SceneryPoint[]; width: number }
export interface SceneryCar {
  id: string;
  roadId: string;
  lane: 1 | -1;
  /** Initial fraction along the saved road, never a transient animation pose. */
  phase: number;
  speed: number;
  kind: 'car' | 'van' | 'bus';
  variant: number;
}
export interface SceneryPlan {
  version: 1;
  seed: number;
  theme: SceneryTheme;
  density: SceneryDensity;
  features: SceneryFeature[];
  prompt: string;
  bounds: SceneryBounds;
  objects: SceneryObject[];
  roads: SceneryRoad[];
  rivers: SceneryRiver[];
  cars: SceneryCar[];
  trafficPlaying: boolean;
}
export interface SceneryRequest {
  theme: SceneryTheme;
  density: SceneryDensity;
  features: SceneryFeature[];
  prompt: string;
  seed: number;
  area?: SceneryArea | null;
  existing?: SceneryPlan;
}
export interface SceneryResult {
  plan: SceneryPlan | null;
  message: string;
  recognized: string[];
}
export const SCENERY_LIMITS = {
  objects: 400, roads: 8, rivers: 4, cars: 36, pathPoints: 160,
  coordinate: 60000, prompt: 500, pathLength: 600000,
} as const;
