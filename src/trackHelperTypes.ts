import type { LayoutData } from './layout';
import type { Track } from './track';

/** Limits refer to N-scale millimetres and fixed search work, never screen pixels. */
export const TRACK_HELPER_LIMITS = {
  gap: 1500,
  pieces: 6,
  repairPieces: 3,
  margin: 400,
  work: 300000,
} as const;

export interface TrackEndRef { trackId: string; end: number }

export interface TrackHelperSolution {
  /** Preview IDs are stable; application replaces them with unique layout IDs. */
  tracks: Track[];
  removeIds: string[];
  ends: [TrackEndRef, TrackEndRef];
  closesLoop: boolean;
}

export interface TrackHelperPreview {
  tracks: Track[];
  removeIds: string[];
  ends: TrackEndRef[];
}

export interface TrackHelperRequest {
  layout: LayoutData;
  ends: [TrackEndRef, TrackEndRef];
  protectedTrackIds: string[];
  /** Unit tests and benchmarks can use a smaller deterministic work budget. */
  workLimit?: number;
}

export interface TrackHelperInspection {
  eligible: boolean;
  message: string;
  gap: number;
  angleDifference: number;
  heightDifference: number;
}

export interface TrackHelperResult {
  status: 'found' | 'no-fit' | 'limit' | 'ineligible';
  solutions: TrackHelperSolution[];
  inspection: TrackHelperInspection;
  explored: number;
  message: string;
}

export interface TrackHelperWorkerRequest { id: number; request: TrackHelperRequest }
export type TrackHelperWorkerResponse =
  | { id: number; result: TrackHelperResult }
  | { id: number; error: string };
