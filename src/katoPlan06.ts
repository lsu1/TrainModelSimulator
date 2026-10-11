import type { LayoutData } from './layout'
import type { Track } from './track'
import { pathsFor } from './track'
import { KATO_CATALOG } from './catalog'
import { KATO_PLAN06_TRACKS } from './katoPlan06Data'
import { makeKatoPlan06Scenery } from './katoPlan06Scenery'

export const KATO_PLAN06_SOURCE = 'https://www.katomodels.com/unitrackplan/plan/plan06-15.pdf'
export const KATO_PLAN06_PARTS_SOURCE = 'https://www.katomodels.com/unitrackplan/plan/plan06-15_partslist.pdf'
export const KATO_PLAN06_COMMON_PARTS_SOURCE = 'https://www.katomodels.com/unitrackplan/common_parts_namelist.pdf'
export const KATO_PLAN06_ASSEMBLY_NOTE = 'Nominal assembly fit: connector gaps are below 0.18 mm and yaw below 0.15°. Catalog lengths and radii are retained. The viaduct deck is represented at 60 mm; purchased support datums and banked approaches require physical verification.'

/** The assembled drawing, excluding surplus pieces and exploded shed-track callouts. */
export function makeKatoPlan06(): LayoutData {
  let switchNumber = 0
  const tracks: Track[] = KATO_PLAN06_TRACKS.map(([index, kind, x, y, angle, bend, elevation]) => {
    const turnout = KATO_CATALOG.find(item => item.kind === kind)?.shape === 'turnout'
    return {
      id: `kato06-${String(index).padStart(3, '0')}`, kind, x, y, angle,
      // These two Japanese signal masts face the outside of the ground lines.
      bend: kind === 's124-signal' ? -1 : bend,
      elevation, endElevation: elevation,
      ...(turnout ? { switchState: 'straight' as const, switchNumber: ++switchNumber } : {}),
    }
  })
  const accessories = makeKatoPlan06Scenery(tracks)

  // Translation alone centers the complete assembled plan; it preserves every join.
  const points = tracks.flatMap(track => pathsFor(track).flatMap(path =>
    Array.from({ length: 17 }, (_, index) => path.pointAt(path.length * index / 16))))
  const centerX = (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2
  const centerY = (Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2
  for (const placed of [...tracks, ...accessories]) {
    placed.x -= centerX
    placed.y -= centerY
  }

  return {
    version: 5, name: '新干线与在来线交错运行', sourcePlan: 'kato-plan06-15',
    tracks, accessories, carCount: 3, trainType: 'e235', selectedTrainId: 'kato06-yamanote', couplings: [],
    trains: [
      { id: 'kato06-yamanote', name: 'Yamanote Line', type: 'e235', carCount: 3,
        position: { trackId: 'kato06-019', distance: 124, direction: 1, route: 0, laps: 0 },
        cabForward: true, requestedSpeed: 65 },
      { id: 'kato06-e5', name: 'E5 Shinkansen', type: 'e5', carCount: 3,
        position: { trackId: 'kato06-238', distance: 124, direction: 1, route: 0, laps: 0 },
        cabForward: true, requestedSpeed: 65 },
      { id: 'kato06-e6', name: 'E6 Shinkansen', type: 'e6', carCount: 3,
        position: { trackId: 'kato06-241', distance: 124, direction: 1, route: 1, laps: 0 },
        cabForward: true, requestedSpeed: 65 },
    ],
  }
}
