import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY, loadLayout, parseLayout, type LayoutData } from './layout'
import { makeStarterLayout, openEndpoints } from './track'

const layout = (): LayoutData => ({ version: 1, name: 'My railway', tracks: makeStarterLayout('compact') })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('layout file validation', () => {
  it('round-trips a supported layout and normalizes its display name', () => {
    const original = layout()
    expect(parseLayout(JSON.parse(JSON.stringify(original)))).toEqual(original)
    expect(parseLayout({ ...original, name: '  Our railway  ' }).name).toBe('Our railway')
    expect(parseLayout({ ...original, name: '   ' }).name).toBe('My Railway')
    expect(parseLayout({ ...original, name: 'a'.repeat(100) }).name).toHaveLength(60)
    expect(parseLayout({ ...original, tracks: [] }).tracks).toEqual([])
  })

  it.each([
    null,
    false,
    'a railway',
    [],
    { version: 2, name: 'Old railway', tracks: [] },
    { version: 1, name: 42, tracks: [] },
    { version: 1, name: 'Railway', tracks: {} },
  ])('rejects unsupported layout data: %j', (value) => {
    expect(() => parseLayout(value)).toThrow()
  })

  it.each([
    { kind: 'unknown' },
    { id: null },
    { id: '' },
    { id: '   ' },
    { id: 'x'.repeat(101) },
    { x: NaN },
    { y: Infinity },
    { angle: -Infinity },
    { x: '10' },
    { y: 50_001 },
    { angle: 1001 },
    { bend: 0 },
  ])('rejects unsafe or unsupported track values: %j', (invalid) => {
    const valid = layout()
    expect(() => parseLayout({ ...valid, tracks: [{ ...valid.tracks[0], ...invalid }] })).toThrow()
  })

  it('rejects duplicate track ids rather than making traversal ambiguous', () => {
    const valid = layout()
    const duplicate = { ...valid.tracks[1], id: valid.tracks[0].id }
    expect(() => parseLayout({ ...valid, tracks: [valid.tracks[0], duplicate] })).toThrow()
  })

  it('limits imported layouts to 200 pieces', () => {
    const valid = layout()
    const tracks = Array.from({ length: 201 }, (_, index) => ({ ...valid.tracks[0], id: `piece-${index}` }))
    expect(() => parseLayout({ ...valid, tracks })).toThrow('200')
    expect(parseLayout({ ...valid, tracks: tracks.slice(0, 200) }).tracks).toHaveLength(200)
  })
})

describe('saved layout recovery', () => {
  it('loads a valid saved layout through the shared parser', () => {
    const valid = layout()
    const getItem = vi.fn(() => JSON.stringify(valid))
    vi.stubGlobal('localStorage', { getItem })
    expect(loadLayout()).toEqual(valid)
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY)
  })

  it.each([
    null,
    '{ this is not JSON',
    JSON.stringify({ version: 2, name: 'Unsupported', tracks: [] }),
    JSON.stringify({ version: 1, name: 'Corrupt', tracks: [{ kind: 'unknown' }] }),
  ])('recovers safely from absent or corrupt saves: %j', (saved) => {
    vi.stubGlobal('localStorage', { getItem: () => saved })
    const recovered = loadLayout()
    expect(recovered.name).toBe('Sunny Valley')
    expect(recovered.tracks).toHaveLength(12)
    expect(openEndpoints(recovered.tracks)).toHaveLength(0)
  })

  it('still opens a playable starter layout when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage is unavailable') } })
    expect(loadLayout().tracks).toEqual(makeStarterLayout('oval'))
    vi.stubGlobal('localStorage', undefined)
    expect(loadLayout().tracks).toEqual(makeStarterLayout('oval'))
  })
})
