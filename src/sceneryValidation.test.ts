import { describe, expect, it } from 'vitest';
import { generateScenery } from './sceneryGeneration';
import { parseScenery } from './sceneryValidation';
import type { SceneryPlan } from './sceneryTypes';

function valid(): SceneryPlan {
  return generateScenery([], [], { theme: 'city', density: 'balanced', features: ['buildings', 'roads', 'cars', 'river'], prompt: '', seed: 2 }).plan!;
}
describe('saved scenery validation', () => {
  it('accepts absence and cleanly round-trips generated geometry without extra fields', () => {
    expect(parseScenery(undefined)).toBeUndefined();
    const plan = valid();
    expect(parseScenery(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(parseScenery({ ...plan, script: '<script>' })).not.toHaveProperty('script');
  });
  it.each([null, false, 'city', {}, { version: 5 }])('rejects malformed scenery %s', input => {
    expect(() => parseScenery(input)).toThrow(/Scenery|scenery/);
  });
  it.each(['seed', 'theme', 'density', 'features', 'trafficPlaying', 'prompt', 'bounds'])('rejects invalid %s', key => {
    const plan = { ...valid(), [key]: null };
    expect(() => parseScenery(plan)).toThrow(/Scenery|scenery/);
  });
  it('enforces bounded counts before inspecting oversized arrays', () => {
    const plan = valid();
    expect(() => parseScenery({ ...plan, objects: Array(401).fill(plan.objects[0]) })).toThrow('at most 400');
    expect(() => parseScenery({ ...plan, cars: Array(37).fill(plan.cars[0]) })).toThrow('at most 36');
    expect(() => parseScenery({ ...plan, roads: Array(9).fill(plan.roads[0]) })).toThrow('at most 8');
    expect(() => parseScenery({ ...plan, rivers: Array(5).fill(plan.rivers[0]) })).toThrow('at most 4');
    expect(() => parseScenery({ ...plan, roads: [{ ...plan.roads[0], points: Array(161).fill(plan.roads[0].points[0]) }] })).toThrow('at most 160');
  });
  it.each([NaN, Infinity, 60001, -60001])('rejects nonfinite or out-of-range coordinates %s', x => {
    const plan = valid(); plan.objects[0].x = x;
    expect(() => parseScenery(plan)).toThrow('coordinate');
  });
  it.each([0, -3, NaN, 5000])('rejects impossible object width %s', width => {
    const plan = valid(); plan.objects[0].width = width;
    expect(() => parseScenery(plan)).toThrow('width');
  });
  it('rejects duplicate identities and geometry outside its saved bounds', () => {
    const plan = valid(); plan.objects[0].id = plan.roads[0].id;
    expect(() => parseScenery(plan)).toThrow('duplicate identifier');
    const next = valid(); next.objects[0].x = next.bounds.maxX + 10;
    expect(() => parseScenery(next)).toThrow('outside');
  });
  it('requires viable paths and valid road references for traffic', () => {
    const missing = valid(); missing.cars[0].roadId = 'missing';
    expect(() => parseScenery(missing)).toThrow('existing closed road');
    const open = valid(); open.roads[0].closed = false;
    expect(() => parseScenery(open)).toThrow('existing closed road');
    const phase = valid(); phase.cars[0].phase = 1;
    expect(() => parseScenery(phase)).toThrow('phase');
    const speed = valid(); speed.cars[0].speed = Infinity;
    expect(() => parseScenery(speed)).toThrow('speed');
    const duplicate = valid(); duplicate.roads[0].points[1] = duplicate.roads[0].points[0];
    expect(() => parseScenery(duplicate)).toThrow('coincident');
    const repeated = valid(); repeated.roads[0].points.push(repeated.roads[0].points[0]);
    expect(() => parseScenery(repeated)).toThrow('repeated end point');
    const small = valid(); small.roads[0].points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    expect(() => parseScenery(small)).toThrow('too short');
  });
  it('bounds cumulative sampled work from long zigzags within the coordinate and point-count limits', () => {
    const plan = valid();
    plan.bounds = { minX: -60000, maxX: 60000, minY: -60000, maxY: 60000 };
    plan.roads[0].points = Array.from({ length: 12 }, (_, i) => ({ x: i % 2 ? 55000 : -55000, y: -40000 + i * 5000 }));
    expect(() => parseScenery(plan)).toThrow('total path length limit');
    // Individually valid short paths must not evade the cumulative budget.
    const combined = valid();
    combined.bounds = { minX: -60000, maxX: 60000, minY: -60000, maxY: 60000 };
    combined.cars = []; combined.rivers = [];
    combined.roads = Array.from({ length: 4 }, (_, i) => ({ id: `long-road-${i}`, width: 60, closed: false,
      points: [{ x: -55000, y: -50000 + i * 15000 }, { x: 55000, y: -50000 + i * 15000 }, { x: -55000, y: -40000 + i * 15000 }] }));
    expect(() => parseScenery(combined)).toThrow('total path length limit');
    // The last-to-first segment contributes to closed roads, and rivers share
    // the same budget rather than receiving a second independent allowance.
    const closure = valid();
    closure.bounds = { minX: -60000, maxX: 60000, minY: -60000, maxY: 60000 };
    closure.cars = [];
    closure.roads = [{ id: 'closed-large', width: 60, closed: true, points: [{ x: -55000, y: -55000 }, { x: 55000, y: -55000 }, { x: 55000, y: 55000 }, { x: -55000, y: 55000 }] }];
    closure.rivers = [{ id: 'long-river', width: 40, points: [{ x: -55000, y: 0 }, { x: 55000, y: 0 }, { x: -55000, y: 1000 }] }];
    expect(() => parseScenery(closure)).toThrow('total path length limit');
  });
  it('rejects initially overlapping saved cars in the same lane including wrap-around', () => {
    const plan = valid();
    plan.cars[2].phase = plan.cars[0].phase;
    expect(() => parseScenery(plan)).toThrow('vehicles overlap');
    const wrap = valid();
    wrap.cars = [{ ...wrap.cars[0], phase: .9999 }, { ...wrap.cars[2], phase: .0001 }];
    expect(() => parseScenery(wrap)).toThrow('vehicles overlap');
    const opposing = valid();
    opposing.cars = [{ ...opposing.cars[0], phase: .5 }, { ...opposing.cars[1], phase: .5 }];
    expect(parseScenery(opposing)).toEqual(opposing);
  });
  it('rejects oversized prompts, unknown render kinds and duplicate feature flags', () => {
    const plan = valid();
    expect(() => parseScenery({ ...plan, prompt: 'x'.repeat(501) })).toThrow('prompt');
    expect(() => parseScenery({ ...plan, objects: [{ ...plan.objects[0], kind: 'train' }] })).toThrow('unrecognized object');
    expect(() => parseScenery({ ...plan, features: ['cars', 'cars'] })).toThrow('duplicate features');
  });
});
