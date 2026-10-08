import { describe, expect, it } from 'vitest'
import { clampTrainSpeed, getTrainSpec, TRAIN_TYPES } from './trains'

describe('sourced passenger-service speed profiles', () => {
  it('uses Yamanote operating speed and each Shinkansen’s fastest passenger service', () => {
    expect(TRAIN_TYPES.map(type => [type, getTrainSpec(type).maxServiceSpeed]))
      .toEqual([['e235', 90], ['e5', 320], ['e6', 320], ['e7', 275]])
  })

  it.each(TRAIN_TYPES)('bounds %s controls at their model limit while retaining precise valid settings', type => {
    const max = getTrainSpec(type).maxServiceSpeed
    expect(clampTrainSpeed(type, max + 1)).toBe(max)
    expect(clampTrainSpeed(type, max)).toBe(max)
    expect(clampTrainSpeed(type, 42.5)).toBe(42.5)
    expect(clampTrainSpeed(type, 0)).toBe(0)
    expect(clampTrainSpeed(type, -1)).toBe(0)
    for (const invalid of [NaN, Infinity, -Infinity]) expect(clampTrainSpeed(type, invalid)).toBe(0)
  })
})
