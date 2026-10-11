import { describe, expect, it } from 'vitest'
import { auditClearances } from './clearance'
import type { PlacedAccessory } from './layout'
import type { Track } from './track'

const rail = (kind = 's248', elevation = 0, y = 0): Track =>
  ({ id: 'rail', kind, x: 0, y, angle: 0, bend: 1, elevation, endElevation: elevation })
const accessory = (kind: string, elevation = 0, y = 0, x = 124): PlacedAccessory =>
  ({ id: 'scenery', kind, x, y, elevation, angle: 0 })
const errors = (tracks: Track[], accessories: PlacedAccessory[] = []) =>
  auditClearances({ tracks, accessories }).filter(issue => issue.severity === 'error')

describe('plan 06-15 scenery geometry', () => {
  it('supports upper rails while preserving the space below a 60 mm station plate', () => {
    const lower = rail(), upper = { ...rail('ds248', 60), id: 'upper' }
    expect(errors([lower, upper], [accessory('a-station-deck-248', 60)])).toEqual([])
  })

  it('detects a station plate lowered into the ground-level train envelope', () => {
    expect(errors([rail()], [accessory('a-station-deck-248', 47)])).toHaveLength(1)
  })

  it('detects a plate raised through the upper track bed instead of exempting its support contact', () => {
    expect(errors([rail('ds248', 60)], [accessory('a-station-deck-248', 62)])).toHaveLength(1)
  })

  it.each(['a-station-wall-high', 'a-station-wall-high-window', 'a-station-wall-low'])('%s uses its narrow perimeter footprint', kind => {
    expect(errors([rail('ds248', 60)], [accessory(kind, 60, 40)])).toEqual([])
    expect(errors([rail('ds248', 60)], [accessory(kind, 60, 16.5)])).toHaveLength(1)
  })

  it('allows the actual central opening below the new frame pier but checks its feet and columns', () => {
    const upper = { ...rail('ds248', 60), id: 'upper' }
    expect(errors([rail(), upper], [accessory('a-pier-frame-p06')])).toEqual([])
    expect(errors([rail('s248', 0, 23)], [accessory('a-pier-frame-p06')])[0]?.code).toBe('pier-obstruction')
  })

  it('keeps the new double pier columns outside its central lower route while checking either column', () => {
    expect(errors([rail()], [accessory('a-pier-double-p06')])).toEqual([])
    expect(errors([rail('s248', 0, 36.5)], [accessory('a-pier-double-p06')])[0]?.code).toBe('pier-obstruction')
  })

  it('leaves both entrances and rail lanes of the train shed open', () => {
    expect(errors([rail('ds248')], [accessory('a-train-shed')])).toEqual([])
    expect(errors([rail('s248', 0, 38)], [accessory('a-train-shed')])).toHaveLength(1)
  })

  it('checks the shed roof when the track is raised into it', () => {
    expect(errors([rail('ds248', 10)], [accessory('a-train-shed')])).toHaveLength(1)
  })

  it('supports the station concourse from its island platform while checking all lower routes', () => {
    const tracks = [rail('s248', 0, -33), { ...rail('s248', 0, 33), id: 'other' }]
    expect(errors(tracks, [accessory('a-station-overtrack')])).toEqual([])
    expect(errors([rail()], [accessory('a-station-overtrack')])).toHaveLength(1)
    expect(errors([rail('s248', 10, -33)], [accessory('a-station-overtrack')])).toHaveLength(1)
  })

  it('keeps the extension stairs and their posts on the platform between the running lines', () => {
    const tracks = [rail('s248', 0, -46), { ...rail('s248', 0, 19), id: 'other' }]
    expect(errors(tracks, [accessory('a-station-overtrack-extension')])).toEqual([])
    expect(errors([rail('s248', 0, -22)], [accessory('a-station-overtrack-extension')])).toHaveLength(1)
  })

  it('uses the local platform’s actual nine-millimetre base', () => {
    expect(errors([rail()], [accessory('a-platform-local-p06')])).toHaveLength(1)
    expect(errors([rail()], [accessory('a-platform-local-p06', 0, 26)])).toEqual([])
  })

  it.each(['e235', 'e5', 'e6', 'e7'] as const)('clears a suburban platform between 66 mm-spaced rails for %s', trainType => {
    const platform = accessory('a-platform-suburban-island')
    const tracks = [rail('s248', 0, -33), { ...rail('s248', 0, 33), id: 'other' }]
    expect(auditClearances({ tracks, accessories: [platform], trainType }).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('narrows the short island end toward negative X while checking its full-width adjoining end', () => {
    const end = accessory('a-platform-suburban-island-end', 0, 0, 0)
    const approach = { ...rail('s62', 0, 21), x: -92 }
    expect(errors([approach], [end])).toEqual([])
    expect(errors([{ ...approach, x: 30 }], [end])).toHaveLength(1)
    expect(errors([approach], [{ ...end, angle: Math.PI }])).toHaveLength(1)
  })

  it('checks the short end’s customized sign above its nine-millimetre base', () => {
    const end = accessory('a-platform-suburban-island-end', 0, 0, 0)
    const raised = rail('s62', 12)
    expect(errors([raised], [end])).toEqual([])
    expect(errors([raised], [{ ...end, stationName: '新駅' }])).toHaveLength(1)
  })

  it('permits the crossing road below the treads while checking a wrongly elevated slope', () => {
    expect(errors([rail()], [accessory('a-auto-crossing-slope')])).toEqual([])
    expect(errors([rail()], [accessory('a-auto-crossing-slope', 6)])).toHaveLength(1)
  })

  it('places the two automatic crossing poles on their respective outer sides', () => {
    const gates = [accessory('a-auto-crossing-main', 0, 50), { ...accessory('a-auto-crossing-opposite', 0, -50), id: 'opposite' }]
    expect(errors([rail('ds248')], gates)).toEqual([])
    expect(errors([rail('ds248')], [accessory('a-auto-crossing-main', 0, 0)])).toHaveLength(1)
  })
})

describe('factory-fitted signal and bumper track scenery', () => {
  it('keeps a Japanese signal beside its own rail and checks neighboring routes through the mast', () => {
    const signal = rail('s124-signal')
    const neighboring = { ...rail('s124', 0, -35), id: 'neighbor' }
    expect(errors([signal])).toEqual([])
    expect(errors([signal, neighboring]).some(issue => issue.code === 'scenery-track-clearance')).toBe(true)
    expect(errors([signal, { ...neighboring, y: -41 }])).toEqual([])
    expect(errors([{ ...signal, bend: -1 }, neighboring])).toEqual([])
  })

  it.each(['s62-buffer-a', 's50-buffer-c'])('%s stops its own manufactured route but obstructs an adjoining rail at the closed end', kind => {
    const buffer = rail(kind), length = kind === 's62-buffer-a' ? 62 : 50
    const adjoining = { ...rail('s124'), id: 'adjoining', x: length }
    expect(errors([buffer])).toEqual([])
    expect(errors([buffer, adjoining]).some(issue => issue.code === 'scenery-track-clearance')).toBe(true)
  })
})
