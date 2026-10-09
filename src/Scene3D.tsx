import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { KATO_CATALOG } from './catalog';
import type { PlacedAccessory } from './layout';
import type { LayoutIssue } from './clearance';
import { connectedEndpoint, endpoints, pathsFor } from './track';
import type { Endpoint, Track, TrainPosition } from './track';
import { createTrainCar, createTrainConnection, updateE235Connection, disposeTrainModel } from './trainModel';
import { getTrainCarSpec } from './trains';
import type { TrainType } from './trains';
import { solveConsistPoses } from './consistPose';
import type { ConsistPoses } from './consistPose';
import { solveCoupledFormation } from './formationPose';
import type { CoupledFormationPoses } from './formationPose';
import { noseCouplerProfile } from './couplingTypes';
import type { CouplingGroup, CouplingOperation, NoseCouplingState } from './couplingTypes';
import { getNoseCouplerDiagnostics, orientNoseCoupler, updateNoseCoupler } from './noseCoupler';
import { TurnoutPoints, staticRailRanges } from './turnoutPoints';
import type { TrainRuntime, TrainSnapshot } from './fleet';
import { closestTrainPlacement, validateTrainPlacement } from './trainPlacement';

interface Scene3DProps {
  tracks: Track[];
  accessories: PlacedAccessory[];
  trainPosition: TrainPosition;
  cabForward: boolean;
  carCount: number;
  trainType?: TrainType;
  /** Omit to retain the original one-train rendering contract. */
  fleet?: readonly TrainRuntime[];
  couplings?: readonly CouplingGroup[];
  couplingOperation?: CouplingOperation | null;
  selectedTrainId?: string | null;
  onSelectTrain?: (id: string) => void;
  placingTrain?: TrainSnapshot | null;
  placementDirection?: 1 | -1;
  onPlaceTrain?: (position: TrainPosition) => void;
  selectedId: string | null;
  activeAnchor: Endpoint | null;
  mode: 'orbit' | 'move';
  cameraPreset: 'perspective' | 'top' | 'ride' | 'coupling';
  viewRevision: number;
  /** Changes only when a complete layout is opened/imported, not on switch clicks. */
  layoutRevision?: number;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAnchor: (anchor: Endpoint & { trackId: string; end: number }) => void;
  onDropItem?: (kind: string, x: number, y: number) => void;
  placementHeight?: number;
  issues?: LayoutIssue[];
  onReady?: (ready: boolean) => void;
}

type Path = ReturnType<typeof pathsFor>[number];
type Point = ReturnType<Path['pointAt']>;
type Anchor = Endpoint & { trackId: string; end: number };
const SCALE = .01;
const RAIL_TOP = 7.35;
// 9 mm is the distance between the inside faces of the 0.98 mm rail heads.
const RAIL_CENTER = 4.99;
const UP = new THREE.Vector3(0, 1, 0);
const ITEM_BY_KIND = new Map(KATO_CATALOG.map(item => [item.kind, item]));

/* These are dimensions of the physical N-gauge model, in millimetres. */
class ModelLibrary {
  geometry = new Set<THREE.BufferGeometry>();
  materials = new Map<string, THREE.MeshStandardMaterial>();
  textures = new Set<THREE.Texture>();
  box = this.shared(new THREE.BoxGeometry(1, 1, 1));
  cylinder = this.shared(new THREE.CylinderGeometry(1, 1, 1, 12));
  sphere = this.shared(new THREE.SphereGeometry(1, 12, 8));
  gravel: THREE.CanvasTexture;
  concrete: THREE.CanvasTexture;
  constructor() {
    this.gravel = this.grainTexture(false);
    this.concrete = this.grainTexture(true);
  }
  shared<T extends THREE.BufferGeometry>(geometry: T): T { this.geometry.add(geometry); return geometry; }
  grainTexture(concrete: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = concrete ? '#c2c3b9' : '#858a86';
    ctx.fillRect(0, 0, 256, 256);
    let seed = 2947;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < (concrete ? 6500 : 9000); i++) {
      const shade = Math.floor((concrete ? 155 : 85) + random() * (concrete ? 65 : 95));
      ctx.fillStyle = `rgb(${shade},${shade + 2},${shade - 1})`;
      const x = random() * 256, y = random() * 256;
      const size = concrete ? .4 + random() * 1.1 : .8 + random() * 2.8;
      ctx.beginPath(); ctx.ellipse(x, y, size, size * (.5 + random() * .6), random() * Math.PI, 0, Math.PI * 2); ctx.fill();
      if (!concrete && i % 3 === 0) { ctx.fillStyle = 'rgba(246,246,236,.28)'; ctx.fillRect(x - .5, y - .5, size, .7); }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    this.textures.add(texture);
    return texture;
  }
  material(color: string, metalness = 0, roughness = .78): THREE.MeshStandardMaterial {
    const key = `${color}:${metalness}:${roughness}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, metalness, roughness });
      this.materials.set(key, material);
    }
    return material;
  }
  surface(slab: boolean): THREE.MeshStandardMaterial {
    const key = slab ? 'concrete-surface' : 'ballast-surface';
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: '#ffffff', map: slab ? this.concrete : this.gravel, roughness: .95 });
      this.materials.set(key, material);
    }
    return material;
  }
  dispose() {
    for (const geometry of this.geometry) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}

function box(group: THREE.Group, library: ModelLibrary, width: number, height: number, depth: number, x: number, y: number, z: number, color: string | THREE.Material, metalness = 0) {
  const mesh = new THREE.Mesh(library.box, typeof color === 'string' ? library.material(color, metalness) : color);
  mesh.scale.set(width, height, depth);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function cylinder(group: THREE.Group, library: ModelLibrary, radius: number, height: number, x: number, y: number, z: number, color: string) {
  const mesh = new THREE.Mesh(library.cylinder, library.material(color));
  mesh.scale.set(radius, height, radius); mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function beam(group: THREE.Group, library: ModelLibrary, a: THREE.Vector3, b: THREE.Vector3, width: number, color: string, depth = width) {
  const mesh = box(group, library, width, a.distanceTo(b), depth, 0, 0, 0, color, .55);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return mesh;
}

/** A continuous swept cross section keeps the true 9 mm rail gauge on curves. */
function sweep(path: Path, profile: { offset: number; height: number }[], origin: { x: number; y: number }, material: THREE.Material, start = 0, end = path.length): THREE.Mesh {
  const area = profile.reduce((sum, p, i) => {
    const next = profile[(i + 1) % profile.length];
    return sum + p.offset * next.height - next.offset * p.height;
  }, 0);
  if (area > 0) profile = [...profile].reverse();
  const count = Math.max(2, Math.ceil((end - start) / 4));
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const n = profile.length;
  for (let i = 0; i <= count; i++) {
    const distance = start + (end - start) * i / count;
    const p = path.pointAt(distance);
    const sx = -Math.sin(p.angle), sz = Math.cos(p.angle);
    profile.forEach((vertex, j) => {
      positions.push(p.x - origin.x + sx * vertex.offset, p.z + vertex.height, p.y - origin.y + sz * vertex.offset);
      uv.push(distance / 22, j / n * 1.8);
    });
  }
  for (let i = 0; i < count; i++) for (let j = 0; j < n; j++) {
    const k = (j + 1) % n, a = i * n + j, b = i * n + k, c = (i + 1) * n + j, d = (i + 1) * n + k;
    indices.push(a, b, c, b, d, c);
  }
  for (let j = 1; j < n - 1; j++) { indices.push(0, j + 1, j); indices.push(count * n, count * n + j, count * n + j + 1); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function bedProfile(width: number) {
  return [{ offset: -width / 2, height: .3 }, { offset: -width / 2 + 2.8, height: 4 }, { offset: width / 2 - 2.8, height: 4 }, { offset: width / 2, height: .3 }];
}
function railProfile(offset: number) {
  return [
    [-.7, 0], [.7, 0], [.7, .45], [.22, .45], [.22, 1.6], [.49, 1.6], [.49, 2.05], [-.49, 2.05], [-.49, 1.6], [-.22, 1.6], [-.22, .45], [-.7, .45],
  ].map(([x, y]) => ({ offset: x + offset, height: y + 5.3 }));
}
function pose(point: Point, origin: { x: number; y: number }, height: number) {
  return new THREE.Vector3(point.x - origin.x, point.z + height, point.y - origin.y);
}
function setTangent(object: THREE.Object3D, angle: number, slope = 0) {
  const forward = new THREE.Vector3(Math.cos(angle), slope, Math.sin(angle)).normalize();
  const sideways = forward.clone().cross(UP).normalize();
  const up = sideways.clone().cross(forward).normalize();
  object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, sideways));
}

function switchBadge(number: number, branch: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.beginPath(); context.roundRect(4, 4, 184, 120, 24);
  context.fillStyle = '#244c40'; context.fill();
  context.lineWidth = 5; context.strokeStyle = '#f5f7ec'; context.stroke();
  context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = 7;
  context.beginPath(); context.moveTo(34, 98); context.lineTo(34, 30);
  context.strokeStyle = branch ? '#849a85' : '#bedc79'; context.stroke();
  context.beginPath(); context.moveTo(34, 72); context.lineTo(56, 45); context.lineTo(56, 30);
  context.strokeStyle = branch ? '#bedc79' : '#849a85'; context.stroke();
  context.fillStyle = '#f5f7ec'; context.font = 'bold 59px sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(number), 124, 66);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false });
  material.userData.temporary = true;
  const sprite = new THREE.Sprite(material);
  sprite.userData.switchBadge = true; sprite.userData.switchNumber = number;
  sprite.renderOrder = 8;
  return sprite;
}

function makeTrack(track: Track, library: ModelLibrary): THREE.Group {
  const group = new THREE.Group();
  group.position.set(track.x, 0, track.y);
  group.userData.pieceId = track.id;
  const item = ITEM_BY_KIND.get(track.kind)!;
  const paths = pathsFor(track);
  const slab = item.bed === 'slab' || (item.bed === 'viaduct' && (item.lanes ?? 1) > 1);
  const elevated = item.bed === 'viaduct' || item.bed === 'bridge';
  const ties: Point[] = [];
  const tieKeys = new Set<string>();
  for (const path of paths) {
    group.add(sweep(path, bedProfile(25), track, library.surface(slab)));
    for (let d = 2.5; d < path.length - 1; d += 5) {
      const p = path.pointAt(d), key = `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`;
      if (!tieKeys.has(key)) { ties.push(p); tieKeys.add(key); }
    }
    for (const side of [-1, 1] as const) {
      const offset = side * RAIL_CENTER;
      // The inner switch rails are real moving blades from toe to heel.
      // Removing their static copies makes the opening visible at close range.
      for (const [start, end] of staticRailRanges(track, path.route, side)) {
        group.add(sweep(path, railProfile(offset), track, library.material('#b9c2c4', .86, .26), start, end));
        // Narrow bright running surfaces contrast with the darker rail web.
        group.add(sweep(path, [
          { offset: offset - .45, height: 7.28 }, { offset: offset + .45, height: 7.28 },
          { offset: offset + .45, height: RAIL_TOP }, { offset: offset - .45, height: RAIL_TOP },
        ], track, library.material('#e6edef', .84, .18), start, end));
      }
    }
    for (const distance of [0, path.length]) {
      const p = path.pointAt(distance);
      for (const offset of [-RAIL_CENTER, RAIL_CENTER]) {
        const joiner = box(group, library, 4.2, 1.35, 2, p.x - track.x - Math.sin(p.angle) * offset, p.z + 5.75, p.y - track.y + Math.cos(p.angle) * offset, '#5e6362', .5);
        setTangent(joiner, p.angle, p.slope);
      }
      const tab = box(group, library, 2.2, 2.5, 7, p.x - track.x, p.z + 2, p.y - track.y, '#696e6b');
      setTangent(tab, p.angle, p.slope);
    }
  }
  const concreteTies = slab || /concrete-tie/i.test(item.name)
    || (item.category === 'double' && (item.lanes ?? 1) > 1);
  const sleepers = new THREE.InstancedMesh(library.box, library.material(concreteTies ? '#b5b8ad' : '#414640', 0, .93), ties.length);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion();
  ties.forEach((p, i) => {
    q.setFromAxisAngle(UP, -p.angle);
    matrix.compose(pose(p, track, 4.65), q, new THREE.Vector3(2.25, 1.25, 17));
    sleepers.setMatrixAt(i, matrix);
  });
  sleepers.castShadow = sleepers.receiveShadow = true; group.add(sleepers);

  if (/rerailer/i.test(item.name)) {
    const path = paths[0];
    const ramp: Path = { ...path, pointAt: distance => {
      const p = path.pointAt(distance);
      return { ...p, z: p.z + Math.max(0, Math.min(1, distance / 15, (path.length - distance) / 15)) * 1.5 };
    } };
    for (const [a, b] of [[-10.5, -5.6], [-3.4, 3.4], [5.6, 10.5]]) group.add(sweep(ramp, [
      { offset: a, height: 3.9 }, { offset: a, height: 4.05 },
      { offset: b, height: 4.05 }, { offset: b, height: 3.9 },
    ], track, library.material('#bdc1b7')));
  }
  if (/feeder/i.test(item.name)) {
    const p = paths[0].pointAt(paths[0].length / 2);
    const feeder = new THREE.Group(); feeder.position.copy(pose(p, track, 0)); setTangent(feeder, p.angle, p.slope);
    box(feeder, library, 13, 2.6, 6, 0, 2.4, -13, '#666f64');
    box(feeder, library, 7, 2.2, 3, 0, 2.4, -17, '#eceadf');
    box(feeder, library, 3.5, .6, 3.5, 0, 4.6, 0, '#5b645a'); group.add(feeder);
  }

  // The 33 mm double-track formation has a continuous slab between its lanes.
  if ((item.lanes ?? 1) > 1 && paths.length > 1 && item.shape !== 'scissors') {
    const left = paths[0], right = paths[1];
    const centerPath: Path = { ...left, pointAt: (distance: number) => {
      const a = left.pointAt(distance), b = right.pointAt(distance / left.length * right.length);
      return { ...a, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    } };
    group.add(sweep(centerPath, [
      { offset: -(item.laneSpacing ?? 33) / 2 - 11, height: -.25 }, { offset: -(item.laneSpacing ?? 33) / 2 - 11, height: 3.8 },
      { offset: (item.laneSpacing ?? 33) / 2 + 11, height: 3.8 }, { offset: (item.laneSpacing ?? 33) / 2 + 11, height: -.25 },
    ], track, library.surface(slab)));
  }

  if (elevated) {
    const width = (item.lanes ?? 1) > 1 ? 59 : 29;
    const path = paths[0];
    const laneCenter = (item.lanes ?? 1) > 1 ? (item.laneSpacing ?? 33) / 2 : 0;
    if (item.bed === 'viaduct') {
      for (const side of [-1, 1]) {
        const offset = laneCenter + side * width / 2;
        group.add(sweep(path, [
          { offset: offset - 1.1, height: -2.8 }, { offset: offset - 1.1, height: 11.5 },
          { offset: offset + 1.1, height: 11.5 }, { offset: offset + 1.1, height: -2.8 },
        ], track, library.material(slab ? '#b9bcb2' : '#747a72')));
        group.add(sweep(path, [
          { offset: offset - 1.7, height: 10.4 }, { offset: offset - 1.7, height: 12.2 },
          { offset: offset + 1.7, height: 12.2 }, { offset: offset + 1.7, height: 10.4 },
        ], track, library.material(slab ? '#d1d3c9' : '#92968b')));
      }
      group.add(sweep(path, [
        { offset: laneCenter - width / 2, height: -4 }, { offset: laneCenter - width / 2, height: .2 },
        { offset: laneCenter + width / 2, height: .2 }, { offset: laneCenter + width / 2, height: -4 },
      ], track, library.material('#a2a99e')));
    } else {
      const color = item.color ?? (item.name.toLowerCase().includes('red') ? '#914b45' : '#51776b');
      const truss = /truss/i.test(item.name);
      const deckGirder = /deck girder/i.test(item.name);
      if (item.shape === 'curve') {
        for (const side of [-1, 1]) {
          const offset = laneCenter + side * width / 2;
          group.add(sweep(path, [
            { offset: offset - 1, height: -13 }, { offset: offset - 1, height: 2 },
            { offset: offset + 1, height: 2 }, { offset: offset + 1, height: -13 },
          ], track, library.material(color, .45)));
        }
        for (let d = 8; d < path.length; d += 18) {
          const p = path.pointAt(d);
          const rib = box(group, library, 1.5, 2.5, width, p.x - track.x, p.z - 8, p.y - track.y, color, .5);
          setTangent(rib, p.angle, p.slope);
        }
      } else {
      const a = path.pointAt(0), b = path.pointAt(path.length);
      const bridge = new THREE.Group(); bridge.position.copy(pose(a, track, 0)); setTangent(bridge, a.angle, a.slope);
      const center = laneCenter;
      for (const side of [-1, 1]) {
        const z = center + side * width / 2;
        box(bridge, library, path.length, truss ? 3 : 15, 2.2, path.length / 2, truss ? 7 : deckGirder ? -5.5 : 10.5, z, color, .45);
        box(bridge, library, path.length, 2, 4, path.length / 2, 2, z, color, .5);
        box(bridge, library, path.length, 1.4, 3.5, path.length / 2, truss ? 8.5 : deckGirder ? -13 : 18.5, z, color, .5);
        const bays = Math.max(3, Math.round(path.length / 40));
        if (truss) {
          box(bridge, library, path.length, 2.7, 2.4, path.length / 2, 38, z, color, .45);
          for (let i = 0; i <= bays; i++) {
            const x = i * path.length / bays;
            box(bridge, library, 2.1, 30, 2.1, x, 23, z, color, .5);
            if (i < bays) beam(bridge, library,
              new THREE.Vector3(x, i % 2 ? 38 : 8, z), new THREE.Vector3((i + 1) * path.length / bays, i % 2 ? 8 : 38, z), 1.7, color);
            if (side === 1) {
              box(bridge, library, 2, 2.5, width + 1, x, 38, center, color, .45);
              if (i < bays) beam(bridge, library, new THREE.Vector3(x, 38, center - width / 2), new THREE.Vector3((i + 1) * path.length / bays, 38, center + width / 2), 1.4, color);
            }
          }
        } else {
          for (let i = 1; i < bays * 3; i++) box(bridge, library, .9, 12, 1, i * path.length / (bays * 3), deckGirder ? -5.5 : 10.5, z + side * 1.5, color, .45);
        }
      }
      group.add(bridge);
      // The deck beneath the sleepers is a separate steel plate.
      box(bridge, library, path.length, 2.5, width, path.length / 2, 0, center, '#6e766f', .6);
      void b;
      }
    }
  }

  if (item.category === 'turnout') {
    const points = new TurnoutPoints(track, library.material('#d8e1e3', .86, .2), library.material('#414944', .55, .4));
    group.userData.turnoutPoints = points;
    group.add(points.group);
    const p = paths[0].pointAt(Math.min(38, paths[0].length / 4));
    const lever = new THREE.Group(); lever.position.copy(pose(p, track, 4.1)); setTangent(lever, p.angle);
    box(lever, library, 21, 2.5, 5, 0, 0, -14, '#444b45');
    const slider = box(lever, library, 6, 2, 3.3, points.fraction * 8 - 4, 2, -14, '#a2b67b');
    group.userData.pointLeverSlider = slider;
    group.add(lever);
    if (track.switchNumber !== undefined) {
      const badge = switchBadge(track.switchNumber, track.switchState === 'branch');
      const side = track.bend === 1 ? -1 : 1;
      badge.position.set(p.x - track.x - Math.sin(p.angle) * side * 23, p.z + 25, p.y - track.y + Math.cos(p.angle) * side * 23);
      group.add(badge);
    }
    group.userData.switchBadgeNumber = track.switchNumber;
    group.userData.switchBadgeState = track.switchState ?? 'straight';
  }
  return group;
}

function syncTurnoutState(group: THREE.Object3D, track: Track, library: ModelLibrary, now: number, settle: boolean) {
  const points = group.userData.turnoutPoints as TurnoutPoints | undefined;
  if (!points) return;
  points.setState(track.switchState ?? 'straight', now, settle);
  if (group.userData.switchBadgeNumber === track.switchNumber
    && group.userData.switchBadgeState === (track.switchState ?? 'straight')) return;
  const existing = group.children.find(child => child.userData.switchBadge);
  if (existing) { group.remove(existing); disposePiece(existing, library); }
  if (track.switchNumber !== undefined) {
    const p = pathsFor(track)[0].pointAt(Math.min(38, pathsFor(track)[0].length / 4));
    const badge = switchBadge(track.switchNumber, track.switchState === 'branch');
    const side = track.bend === 1 ? -1 : 1;
    badge.position.set(p.x - track.x - Math.sin(p.angle) * side * 23, p.z + 25, p.y - track.y + Math.cos(p.angle) * side * 23);
    group.add(badge);
  }
  group.userData.switchBadgeNumber = track.switchNumber;
  group.userData.switchBadgeState = track.switchState ?? 'straight';
}

function sign(group: THREE.Group, width: number, height: number, x: number, y: number, z: number, label: string, background = '#f2f3e9') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#80bc45'; ctx.fillRect(0, 82, 512, 16);
  ctx.fillStyle = '#263734'; ctx.font = 'bold 39px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, 256, 61);
  ctx.font = '16px sans-serif'; ctx.fillText('JY  山手線 / Yamanote Line', 256, 120);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .65, side: THREE.DoubleSide });
  material.userData.temporary = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material); mesh.position.set(x, y, z); group.add(mesh);
}
function supportLabel(group: THREE.Group, label: string, width: number, height: number, x: number, y: number, z: number) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#c9ccbf'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#46534b'; context.font = 'bold 46px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(label, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .85, side: THREE.DoubleSide });
  material.userData.temporary = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(x, y, z); mesh.rotation.y = Math.PI; group.add(mesh);
}
function makeAccessory(accessory: PlacedAccessory, library: ModelLibrary): THREE.Group {
  const item = ITEM_BY_KIND.get(accessory.kind)!;
  const group = new THREE.Group(); group.userData.pieceId = accessory.id;
  group.position.set(accessory.x, accessory.elevation, accessory.y); group.rotation.y = -accessory.angle;
  const length = item.footprint?.length ?? item.length ?? 124;
  const width = item.footprint?.width ?? 35;
  const height = item.footprint?.height ?? 50;
  const kind = item.accessoryType ?? 'building';
  const concrete = '#c4c6ba', dark = '#56675c', roof = '#748677';
  if (accessory.kind === 'a-footbridge') {
    const span = width, deck = Math.min(37, height - 13);
    box(group, library, 21, 3, span, 0, deck, 0, '#bfc5b7');
    box(group, library, 23, 2, span + 5, 0, height, 0, '#637e70', .25);
    for (const side of [-1, 1]) {
      box(group, library, 1.4, 10, span, side * 10, deck + 7, 0, '#aebbb1');
      for (let z = -span / 2 + 6; z < span / 2; z += 9) {
        box(group, library, .4, 7, 6.5, side * 10.8, deck + 8, z, '#71958c', .3);
        box(group, library, .8, height - deck, .9, side * 10, deck + (height - deck) / 2, z, '#5e796b', .3);
      }
      const z = side * (span / 2 - 8);
      for (const x of [-7, 7]) box(group, library, 2.5, deck - 1, 2.5, x, (deck - 1) / 2, z, '#89998c');
      const run = Math.min(length / 2, 36), count = 12;
      for (let i = 0; i < count; i++) {
        const stepHeight = deck / count * (i + 1);
        box(group, library, run / count + .2, stepHeight, 15, -run + i * run / count + run / count / 2, stepHeight / 2, z, '#b4bdb0');
      }
      for (const edge of [-1, 1]) {
        beam(group, library, new THREE.Vector3(-run, 8, z + edge * 7), new THREE.Vector3(0, deck + 8, z + edge * 7), .9, '#65816e');
        for (let i = 0; i <= 4; i++) box(group, library, .7, 8, .7, -run + i * run / 4, i * deck / 4 + 4, z + edge * 7, '#718577');
      }
    }
  } else if (kind === 'platform' || kind === 'station') {
    box(group, library, length, 12, width, 0, 6, 0, concrete);
    box(group, library, length, .7, width - 2, 0, 12.3, 0, '#d9d8c9');
    for (const side of [-1, 1]) {
      box(group, library, length - 2, .3, 2.5, 0, 12.9, side * (width / 2 - 2), '#d8c873');
      box(group, library, length - 3, .15, .55, 0, 13.2, side * (width / 2 - 4), '#e9ece1');
      for (let x = -length / 2 + 5; x < length / 2; x += 16) box(group, library, .5, 8, .6, x, 5.8, side * (width / 2 + .1), '#abad9f');
      if (/platform-dx/.test(accessory.kind) && !/end/.test(accessory.kind)) {
        for (let x = -length / 2 + 9; x < length / 2 - 7; x += 18) {
          box(group, library, 15, 7, .65, x, 17, side * (width / 2 - 1.2), '#a2b8aa', .15);
          box(group, library, 15.5, .7, .9, x, 20.8, side * (width / 2 - 1.2), '#d9dfd3');
          box(group, library, .55, 7.5, .9, x, 17, side * (width / 2 - 1.2), '#718978');
        }
      }
    }
    if (!/end|open|unroofed|extension/i.test(item.name) || kind === 'station') {
      const roofWidth = Math.max(22, width - 8), roofLength = length - 12;
      for (let x = -roofLength / 2 + 15; x <= roofLength / 2; x += 62) {
        for (const side of [-1, 1]) box(group, library, 1.7, 21, 1.7, x, 23, side * roofWidth / 3, dark, .2);
        box(group, library, 2, 2.1, roofWidth, x, 33.5, 0, dark, .25);
      }
      const left = box(group, library, roofLength + 5, 1.5, roofWidth / 2 + 2, 0, 35, -roofWidth / 4, roof, .15); left.rotation.x = -.08;
      const right = box(group, library, roofLength + 5, 1.5, roofWidth / 2 + 2, 0, 35, roofWidth / 4, roof, .15); right.rotation.x = .08;
      for (let x = -roofLength / 2; x < roofLength / 2; x += 6) box(group, library, .7, .3, roofWidth + 3, x, 35.7, 0, '#8a9a8b', .15);
      box(group, library, 28, .8, 1.3, 0, 32, 0, '#e8e7d4');
      sign(group, Math.min(35, length / 3), 8, 0, 26, -1, kind === 'station' ? '東京 Tokyo' : '原宿 Harajuku');
    }
    // Benches and ticket-machine details make the platform readable close up.
    for (const x of [-length / 4, length / 4]) {
      box(group, library, 15, 2, 5, x, 17, 0, '#6a7d5e');
      for (const dx of [-5, 5]) box(group, library, 1, 4, 3, x + dx, 14.5, 0, '#5b655a', .3);
      box(group, library, 15, 3.2, .8, x, 19, 2.4, '#748968');
    }
    if (kind === 'station') {
      const entry = Math.min(length / 4, 45);
      box(group, library, entry, 26, Math.min(width / 2, 23), -length / 3, 25, 0, '#e6e4d6');
      for (const x of [-length / 3 - entry / 4, -length / 3 + entry / 4]) box(group, library, entry / 3, 13, .6, x, 25, -Math.min(width / 4, 11.5) - .4, '#64837d', .28);
      box(group, library, entry + 5, 2, Math.min(width / 2, 23) + 6, -length / 3, 39, 0, '#627d69');
    }
  } else if (kind === 'pier') {
    if (accessory.kind.startsWith('a-pier-incline-') || accessory.kind === 'a-incline-spacer') {
      // Every tier sits on the table. These fixed component/attachment dimensions
      // are nominal models; the catalog keeps their unverified datum warnings.
      const componentHeight = item.supportComponentHeight!;
      const assemblyHeight = item.supportDeckHeight!;
      if (accessory.kind === 'a-incline-spacer') {
        box(group, library, length, componentHeight, width, 0, componentHeight / 2, 0, '#969e92');
        box(group, library, length, assemblyHeight - componentHeight, width, 0, (assemblyHeight + componentHeight) / 2, 0, '#c9ccbf');
        supportLabel(group, 'SPC', 13, 3, 0, componentHeight / 2, -width / 2 - .05);
      } else if (accessory.kind === 'a-pier-incline-s') {
        for (let step = 0; step < 3; step++) {
          const stepHeight = componentHeight * (step + 1) / 3;
          box(group, library, length / 3, stepHeight, width, -length / 2 + (step + .5) * length / 3, stepHeight / 2, 0, '#bfc3b8');
        }
        box(group, library, 8, assemblyHeight - componentHeight - 2, 14, length / 3, (componentHeight + assemblyHeight - 2) / 2, 0, '#969e92');
        box(group, library, length, 2, width, 0, assemblyHeight - 1, 0, '#c9ccbf');
        supportLabel(group, 'No. S', 8, 3, length / 3, componentHeight / 2, -width / 2 - .05);
      } else {
        box(group, library, length, 4, width, 0, 2, 0, '#b7bbb0');
        const shaftHeight = componentHeight - 7;
        // The square cylinder is scaled into a rectangular, tapered column.
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.6 * Math.SQRT2, Math.SQRT2, shaftHeight, 4).rotateY(Math.PI / 4), library.material('#bfc3b8'));
        shaft.scale.set((length - 4) / 2, 1, (width - 8) / 2);
        shaft.position.y = 4 + shaftHeight / 2; shaft.castShadow = shaft.receiveShadow = true; group.add(shaft);
        box(group, library, length - 2, 3, width - 2, 0, componentHeight - 1.5, 0, '#c9ccbf');
        const attachmentHeight = assemblyHeight - componentHeight;
        box(group, library, 14, attachmentHeight - 2, 20, 0, componentHeight + (attachmentHeight - 2) / 2, 0, '#969e92');
        box(group, library, length, 2, width, 0, assemblyHeight - 1, 0, '#aeb7a6');
        supportLabel(group, item.label, 13, 2.5, 0, componentHeight - 1.5, -(width - 2) / 2 - .05);
      }
    } else if (accessory.kind === 'a-pier-tapered') {
      const componentHeight = item.supportComponentHeight ?? 50;
      const assemblyHeight = item.supportDeckHeight ?? 60;
      box(group, library, length, 4, width, 0, 2, 0, '#b7bbb0');
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(7.5 * Math.SQRT2, 12.5 * Math.SQRT2, componentHeight - 7, 4), library.material('#bfc3b8'));
      shaft.rotation.y = Math.PI / 4; shaft.position.y = (componentHeight - 7) / 2 + 4;
      shaft.castShadow = shaft.receiveShadow = true; group.add(shaft);
      box(group, library, 24, 3, 24, 0, componentHeight - 1.5, 0, '#c9ccbf');
      const attachmentHeight = assemblyHeight - componentHeight;
      box(group, library, 15, attachmentHeight - 2, 18, 0, componentHeight + (attachmentHeight - 2) / 2, 0, '#969e92');
      box(group, library, 28, 2, 28, 0, assemblyHeight - 1, 0, '#aeb7a6');
    } else {
    box(group, library, length, 4, width, 0, 2, 0, '#b7bbb0');
    const columns = width > 40 ? [-width / 3, width / 3] : [0];
    for (const z of columns) box(group, library, Math.max(8, length * .46), Math.max(8, height - 8), 9, 0, height / 2, z, '#bfc3b8');
    box(group, library, length, 5, width, 0, height - 2.5, 0, '#c9ccbf');
    box(group, library, length + 2, 1, width + 2, 0, height + .3, 0, '#dde0d2');
    }
  } else if (kind === 'catenary') {
    const span = Math.max(width, (item.lanes ?? 1) > 1 ? 70 : 33), top = Math.max(height, 54);
    for (const side of [-1, 1]) {
      box(group, library, 7, 3, 7, 0, 1.5, side * span / 2, concrete);
      box(group, library, 2, top, 2, 0, top / 2, side * span / 2, '#8c9790', .6);
      beam(group, library, new THREE.Vector3(0, top - 15, side * span / 2), new THREE.Vector3(0, top - 4, side * (span / 2 - 12)), .9, '#77857c');
    }
    box(group, library, 2, 2, span + 2, 0, top - 2, 0, '#8c9790', .5);
    for (const z of (item.lanes ?? 1) > 1 ? [-16.5, 16.5] : [0]) {
      cylinder(group, library, 1.1, 4, 0, top - 5, z, '#534d3f');
      box(group, library, 1.5, .8, 12, 0, top - 9, z, '#969b8e', .5);
    }
  } else if (kind === 'signal') {
    box(group, library, 7, 2, 7, 0, 1, 0, concrete);
    cylinder(group, library, 1, Math.max(30, height - 6), 0, (height - 6) / 2, 0, '#78867c');
    box(group, library, 4, 10, 2.5, 0, height - 5, 0, '#252e2b');
    for (let i = 0; i < 3; i++) {
      const light = new THREE.Mesh(library.sphere, library.material(i === 2 ? '#7eaf4a' : i === 0 ? '#793e37' : '#b6923f'));
      light.position.set(0, height - 2.5 - i * 2.5, -1.6); light.scale.set(1, 1, .4); group.add(light);
      box(group, library, 2.5, .4, 1.2, 0, height - 1.3 - i * 2.5, -2, '#303a32');
    }
    box(group, library, 3, 5, 3, 0, 4.5, 3, '#59675c');
  } else if (kind === 'buffer') {
    box(group, library, 12, 1.5, 15, 0, .75, 0, '#7c8179');
    for (const side of [-1, 1]) {
      beam(group, library, new THREE.Vector3(-4, 1, side * 5), new THREE.Vector3(1, 10, side * 5), 1.5, '#4a5650');
      beam(group, library, new THREE.Vector3(5, 1, side * 5), new THREE.Vector3(1, 10, side * 5), 1.5, '#4a5650');
    }
    box(group, library, 2.2, 4, 14, 1, 10, 0, '#9e5147');
    for (const side of [-1, 1]) { const buffer = cylinder(group, library, 1.7, 2.5, -.6, 10, side * 4, '#303933'); buffer.rotation.z = Math.PI / 2; }
  } else if (kind === 'crossingGate') {
    box(group, library, length, 2, width, 0, 1, 0, '#a7aaa1');
    box(group, library, 18, .3, width, 0, 2.2, 0, '#747b72');
    for (const side of [-1, 1]) {
      const x = side * 14, z = side * (width / 2 - 6);
      cylinder(group, library, 1.2, 23, x, 13, z, '#ddba42');
      for (let h = 5; h < 24; h += 5) cylinder(group, library, 1.26, 2.6, x, h, z, '#343b31');
      box(group, library, 8, 3.5, 2, x, 22, z, '#3f4437');
      for (const dx of [-2.4, 2.4]) { const lamp = new THREE.Mesh(library.sphere, library.material('#b13f3a')); lamp.position.set(x + dx, 22, z - 1.3); lamp.scale.set(1.1, 1.1, .5); group.add(lamp); }
      const barrierLength = Math.max(18, width / 2 - 2);
      box(group, library, 1.3, 1.5, barrierLength, x, 7, z - side * barrierLength / 2, '#d7b244');
      for (let i = 0; i < barrierLength; i += 5) box(group, library, 1.35, 1.6, 2.3, x, 7, z - side * i, '#353b31');
      beam(group, library, new THREE.Vector3(x - 3.5, 28, z), new THREE.Vector3(x + 3.5, 32, z), .9, '#e4e0bc');
      beam(group, library, new THREE.Vector3(x - 3.5, 32, z), new THREE.Vector3(x + 3.5, 28, z), .9, '#e4e0bc');
    }
  } else {
    const bodyColor = item.color ?? '#d2cdbb';
    box(group, library, length, height, width, 0, height / 2, 0, bodyColor);
    box(group, library, length + 2, 2, width + 2, 0, height + 1, 0, '#76857b');
    box(group, library, length + .5, 3, width + .5, 0, 1.5, 0, '#a4aaa0');
    const floors = Math.max(1, Math.floor(height / 18));
    const windowWidth = Math.min(9, length / 5);
    for (let h = 0; h < floors; h++) for (let x = -length / 2 + 9; x < length / 2 - 5; x += windowWidth + 6) for (const side of [-1, 1]) {
      box(group, library, windowWidth, 8.5, .35, x, 12 + h * 16, side * (width / 2 + .2), '#73958e', .28);
      box(group, library, .55, 9.1, .45, x, 12 + h * 16, side * (width / 2 + .3), '#d4d7c7');
    }
    box(group, library, 12, 17, .55, 0, 8.5, -width / 2 - .5, '#657e70', .2);
    box(group, library, 10, 5, 10, length / 4, height + 4, width / 4, '#b1b7ac');
    sign(group, Math.min(length - 8, 40), 7, 0, height - 5, -width / 2 - .65, /shop/i.test(item.name) ? 'KATO 鉄道' : '東京 Tokyo');
  }
  return group;
}

function disposePiece(group: THREE.Object3D, library: ModelLibrary) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.Sprite) {
      if (object.material.userData.temporary) materials.add(object.material);
      return;
    }
    if (!(object instanceof THREE.Mesh)) return;
    if (!library.geometry.has(object.geometry)) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material.userData.temporary) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) { if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.SpriteMaterial) material.map?.dispose(); material.dispose(); }
}

interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  pieces: THREE.Group;
  anchors: THREE.Group;
  trains: THREE.Group;
  library: ModelLibrary;
  selected: THREE.BoxHelper | null;
  issueOutlines: THREE.BoxHelper[];
  updateLayout: () => void;
  fitCamera: () => void;
  publishPickPoints: () => void;
}

export default function Scene3D(props: Scene3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const runtime = useRef<Runtime | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch { setUnavailable(true); latest.current.onReady?.(false); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor('#e5e9df');
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .92;
    renderer.domElement.setAttribute('aria-label', '3D railway layout: rotate, zoom, select trains, and move Kato track pieces');
    renderer.domElement.setAttribute('role', 'img'); renderer.domElement.tabIndex = 0;
    renderer.domElement.style.width = renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none';
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#e5e9df', 45, 110);
    const camera = new THREE.PerspectiveCamera(38, 1, .02, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .075;
    controls.minDistance = .45; controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI / 2 - .025;
    controls.zoomSpeed = .8; controls.panSpeed = .8;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    const library = new ModelLibrary();
    const world = new THREE.Group(); world.scale.setScalar(SCALE); scene.add(world);
    const pieces = new THREE.Group(), anchors = new THREE.Group(), trains = new THREE.Group(), connections = new THREE.Group();
    world.add(pieces, anchors, trains, connections);
    const hemi = new THREE.HemisphereLight('#fafcf5', '#a4b59d', .9); scene.add(hemi);
    const sunlight = new THREE.DirectionalLight('#fff7e8', 2.0);
    sunlight.position.set(-15, 28, 13); sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -24;
    sunlight.shadow.camera.right = sunlight.shadow.camera.top = 24;
    sunlight.shadow.camera.near = .1; sunlight.shadow.camera.far = 90;
    sunlight.shadow.bias = -.00025; sunlight.shadow.normalBias = .013;
    scene.add(sunlight, sunlight.target);
    const fill = new THREE.DirectionalLight('#d9e7ee', .45); fill.position.set(15, 10, -20); scene.add(fill);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment(); const environment = pmrem.fromScene(room, .06); room.dispose(); pmrem.dispose();
    scene.environment = environment.texture; scene.environmentIntensity = .45;

    // A subdued tabletop lets the model's ballast, sleepers, and silver bodywork read clearly.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), library.material('#99aa8f', 0, 1));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.3; ground.receiveShadow = true; world.add(ground);
    const grid = new THREE.GridHelper(120, 120, '#728b78', '#728b78');
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = .075;
    grid.position.y = -.002; scene.add(grid);
    const scenery = new THREE.Group(); world.add(scenery);
    // Minimal model trees only on the empty margins; placed catalog accessories stay the focus.
    function makeTree(x: number, z: number, size: number) {
      const tree = new THREE.Group(); tree.position.set(x, 0, z);
      cylinder(tree, library, 1.1, size * .58, 0, size * .29, 0, '#7e7355');
      for (let i = 0; i < 3; i++) {
        const leaf = new THREE.Mesh(library.sphere, library.material(i === 1 ? '#648263' : '#6d8d68'));
        leaf.position.set(i === 0 ? -size * .15 : i === 2 ? size * .14 : 0, size * (.62 + i * .06), i === 1 ? size * .12 : 0);
        leaf.scale.set(size * .28, size * .35, size * .27); leaf.castShadow = true; tree.add(leaf);
      }
      scenery.add(tree);
    }

    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let drag: { id: string; group: THREE.Object3D; start: THREE.Vector3; original: THREE.Vector3; initial: THREE.Vector2; moved: boolean; height: number } | null = null;
    let pointerDown: { x: number; y: number } | null = null;
    let frame = 0, stopped = false, pickDirty = true, lastPickTime = 0;
    let pointDiagnosticsDirty = true;
    let previousLayoutRevision = latest.current.layoutRevision;
    let previousCameraPreset: Scene3DProps['cameraPreset'] = 'perspective';
    let resetCouplingCamera = true;
    let previousCouplingFocus: THREE.Vector3 | null = null;
    let previousCouplingPair: string | null = null;
    const selectionMaterial = new THREE.LineBasicMaterial({ color: '#d79e4c', transparent: true, opacity: .6, depthTest: false });
    const errorMaterial = new THREE.LineBasicMaterial({ color: '#c64d3d', transparent: true, opacity: .85, depthTest: false });
    const markerMaterial = new THREE.MeshStandardMaterial({ color: '#66a58d', roughness: .7, transparent: true, opacity: .9 });
    const activeMarkerMaterial = new THREE.MeshStandardMaterial({ color: '#d9a349', roughness: .7 });
    const markerGeometry = new THREE.CylinderGeometry(7.8, 7.8, .8, 32);
    const plusMaterial = new THREE.MeshStandardMaterial({ color: '#f8faf0', roughness: .9 });
    const plusGeometry = new THREE.BoxGeometry(7.6, .6, 1.7);
    type PoseCache = { tracks: Track[]; position: TrainPosition | null; cabForward: boolean; poses: ConsistPoses; composition?: ConsistPoses };
    type RenderedTrain = {
      id: string; type: TrainType; count: number; cars: THREE.Group; links: THREE.Group;
      cache: PoseCache | null;
      diagnostics: { cars: Record<string, unknown>[]; couplers: Record<string, unknown>[] };
    };
    const renderedFleet = new Map<string, RenderedTrain>();
    const formationCache = new Map<string, {
      tracks: Track[]; e6Position: TrainPosition | null; e5Position: TrainPosition | null;
      e6Forward: boolean; e5Forward: boolean; e6Count: number; e5Count: number;
      pairing: string;
      poses: CoupledFormationPoses;
    }>();
    const noseJoints = new THREE.Group(); noseJoints.name = 'shinkansen-mechanical-nose-joints'; world.add(noseJoints);
    const renderedNoseJoints = new Map<string, THREE.Mesh>();
    let ghost: RenderedTrain | null = null;
    let ghostPosition: TrainPosition | null = null;
    let ghostTrackId: string | null = null;
    let ghostPoint: { x: number; y: number; z: number } | null = null;
    let ghostValidation = { allowed: false, reason: 'Point to a rail to place this train.' } as { allowed: boolean; reason?: string };
    let ghostValidationKey = '';
    let ghostValidationTracks: Track[] | null = null;
    let publishedFleetSignature = '';
    let selectedRenderedTrainId: string | null = null;
    const inverse = new THREE.Quaternion();
    const localPoint = new THREE.Vector3();
    const firstPin = new THREE.Vector3(), secondPin = new THREE.Vector3();
    const firstGangway = new THREE.Vector3(), secondGangway = new THREE.Vector3();
    const closedNose: NoseCouplingState = { open: 0, extension: 0, locked: false };
    const layoutPoint = (point: THREE.Vector3) => ({ x: point.x, y: point.z, z: point.y });
    const carPoint = (car: THREE.Object3D, name: string, fallback?: THREE.Vector3) => {
      const point = car.getObjectByName(name)?.position ?? fallback;
      return point ? point.clone().applyQuaternion(car.quaternion).add(car.position) : null;
    };
    const appearanceCache = new WeakMap<THREE.Object3D, {
      parts: string[]; metadata: Record<string, unknown>;
      livery: { primary?: string; secondary?: string; stripe?: string; chin?: string };
    }>();
    const attachedPartPoint = (car: THREE.Object3D, name: string) => {
      const part = car.getObjectByName(name);
      if (!part) return undefined;
      // Roof parts live inside a mirrored exterior. Resolve every ancestor,
      // including the model-mm world scale, rather than using a local offset.
      part.updateWorldMatrix(true, false);
      return layoutPoint(new THREE.Vector3().setFromMatrixPosition(part.matrixWorld).divideScalar(SCALE));
    };
    const appearanceDiagnostics = (car: THREE.Object3D) => {
      let cached = appearanceCache.get(car);
      if (!cached) {
        const colorOf = (...names: string[]) => {
          for (const name of names) {
            const part = car.getObjectByName(name);
            if (!(part instanceof THREE.Mesh)) continue;
            const material = Array.isArray(part.material) ? part.material[0] : part.material;
            if ('color' in material) return `#${(material as THREE.MeshStandardMaterial).color.getHexString()}`;
          }
          return undefined;
        };
        const roof = car.getObjectByName('series-specific-roof-equipment');
        const parts = new Set<string>();
        roof?.traverse(part => { if (part.name && part !== roof) parts.add(part.name); });
        cached = {
          parts: [...parts], metadata: { ...roof?.userData },
          livery: {
            primary: colorOf('emerald-green-upper-body-and-duckbill', 'carmine-red-roof-and-pointed-nose', 'blue-roof-and-central-nose'),
            secondary: colorOf('continuous-rounded-body-and-sculpted-nose'),
            stripe: colorOf('pink-belt-line', 'silver-side-belt-below-windows', 'copper-belt-rising-around-cab-and-blue-nose'),
            chin: colorOf('rounded-ivory-nose-chin-and-coupler-cover', 'rounded-silver-nose-chin-and-coupler-cover'),
          },
        };
        appearanceCache.set(car, cached);
      }
      return {
        livery: cached.livery,
        roofEquipment: {
          ...cached.metadata, parts: cached.parts,
          antennaCenter: attachedPartPoint(car, 'cab-radio-antenna'),
          pantographCenter: attachedPartPoint(car, 'pantograph-contact-strip'),
        },
      };
    };
    // Diagnostics come from the rendered transforms and bellows vertices, so
    // browser checks detect detached meshes as well as incorrect solver poses.
    const consistDiagnostics = (rendered: RenderedTrain) => ({
      cars: rendered.cars.children.map((car, index) => {
        if (!car.visible) return { index, visible: false };
        const spec = getTrainCarSpec(rendered.type, index, rendered.count);
        const cab = index === 0 || index === rendered.count - 1;
        const gangwayHeight = spec.type === 'e235' ? 14.7 : (spec.height + 4.8) / 2;
        const nose = getNoseCouplerDiagnostics(car);
        const noseWorldPoint = (point: THREE.Vector3) => layoutPoint(point.clone().applyQuaternion(car.quaternion).add(car.position));
        return {
          index, visible: true, center: layoutPoint(car.position),
          trainType: car.userData.trainType ?? 'e235', model: car.userData.model,
          length: car.userData.length, bogieOffset: car.userData.bogieOffset ?? car.userData.bogieDistance,
          scale: car.userData.scale, cab: car.userData.cab ?? cab,
          noseDirection: car.userData.noseDirection ?? (cab ? index === 0 ? 1 : -1 : 0),
          noseLength: car.userData.noseLength ?? 0,
          frontBogie: layoutPoint(carPoint(car, 'bogie-front')!),
          rearBogie: layoutPoint(carPoint(car, 'bogie-rear')!),
          frontEnd: layoutPoint(carPoint(car, 'coupling-front')!),
          rearEnd: layoutPoint(carPoint(car, 'coupling-rear')!),
          frontGangway: layoutPoint(carPoint(car, 'gangway-front', new THREE.Vector3(spec.length / 2, gangwayHeight, 0))!),
          rearGangway: layoutPoint(carPoint(car, 'gangway-rear', new THREE.Vector3(-spec.length / 2, gangwayHeight, 0))!),
          quaternion: car.quaternion.toArray(),
          ...(nose ? { noseCoupler: {
            ...nose,
            pivot: noseWorldPoint(nose.pivot), matingFace: noseWorldPoint(nose.matingFace),
            mechanicalHead: noseWorldPoint(nose.mechanicalHead),
          } } : {}),
          ...(rendered.type === 'e235' ? {} : appearanceDiagnostics(car)),
        };
      }),
      couplers: rendered.links.children.map((connection, index) => {
        if (!connection.visible) return { index, visible: false };
        const drawbar = connection.getObjectByName('articulated-drawbar')!;
        drawbar.updateMatrix();
        const bellows = connection.getObjectByName('flexible-gangway-bellows') as THREE.Mesh<THREE.BufferGeometry>;
        bellows.updateMatrix();
        const vertices = bellows.geometry.getAttribute('position');
        const ringCenter = (start: number) => {
          const center = new THREE.Vector3();
          for (let vertex = 0; vertex < 4; vertex++) center.add(localPoint.fromBufferAttribute(vertices, start + vertex));
          return layoutPoint(center.multiplyScalar(.25).applyMatrix4(bellows.matrix));
        };
        return {
          index, visible: true,
          front: layoutPoint(new THREE.Vector3(-.5, 0, 0).applyMatrix4(drawbar.matrix)),
          rear: layoutPoint(new THREE.Vector3(.5, 0, 0).applyMatrix4(drawbar.matrix)),
          frontGangway: ringCenter(0), rearGangway: ringCenter(vertices.count - 8),
        };
      }),
    });
    const disposeRenderedTrain = (rendered: RenderedTrain) => {
      // A car/connection owns its geometry and materials, including its marker.
      for (const car of rendered.cars.children) disposeTrainModel(car);
      for (const link of rendered.links.children) disposeTrainModel(link);
      rendered.cars.removeFromParent(); rendered.links.removeFromParent();
    };
    const buildRenderedTrain = (train: TrainSnapshot, preview = false): RenderedTrain => {
      const cars = new THREE.Group(), links = new THREE.Group();
      cars.name = `trainset-${train.id}`; links.name = `connections-${train.id}`;
      cars.userData.trainId = links.userData.trainId = train.id;
      cars.userData.preview = links.userData.preview = preview;
      for (let i = 0; i < train.carCount; i++) {
        const car = createTrainCar(i, train.carCount, train.type);
        car.traverse(object => { object.userData.trainId = train.id; object.userData.carIndex = i; });
        if (!preview) {
          const spec = getTrainCarSpec(train.type, i, train.carCount);
          const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-spec.length / 2 - 2, 1, -spec.width / 2 - 3),
            new THREE.Vector3(spec.length / 2 + 2, 1, -spec.width / 2 - 3),
            new THREE.Vector3(spec.length / 2 + 2, 1, spec.width / 2 + 3),
            new THREE.Vector3(-spec.length / 2 - 2, 1, spec.width / 2 + 3),
          ]), new THREE.LineBasicMaterial({ color: '#e3ae4f', transparent: true, opacity: .85 }));
          outline.name = 'selected-train-outline'; outline.visible = false;
          outline.userData.trainId = train.id; outline.userData.carIndex = i;
          car.add(outline);
        }
        cars.add(car);
        if (i > 0) {
          const connection = createTrainConnection(train.type);
          connection.traverse(object => { object.userData.trainId = train.id; object.userData.connectionIndex = i - 1; });
          links.add(connection);
        }
      }
      if (preview) {
        world.add(cars, links);
        for (const root of [cars, links]) root.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = false; object.receiveShadow = false; } });
      } else { trains.add(cars); connections.add(links); }
      return { id: train.id, type: train.type, count: train.carCount, cars, links, cache: null, diagnostics: { cars: [], couplers: [] } };
    };
    const updateRenderedTrain = (
      rendered: RenderedTrain,
      train: TrainSnapshot & { noseCoupling?: NoseCouplingState },
      composition?: ConsistPoses,
      noseTarget?: { x: number; y: number; z: number },
    ): boolean => {
      if (!train.position && !composition) {
        const changed = rendered.cars.visible || rendered.links.visible || !!rendered.cache;
        rendered.cars.visible = rendered.links.visible = false; rendered.cache = null;
        if (changed) rendered.diagnostics = { cars: [], couplers: [] };
        return changed;
      }
      rendered.cars.visible = rendered.links.visible = true;
      const cache = rendered.cache;
      const poseChanged = !cache || cache.tracks !== latest.current.tracks || cache.position !== train.position || cache.cabForward !== train.cabForward || cache.composition !== composition;
      const poses = poseChanged ? composition ?? solveConsistPoses(latest.current.tracks, train.position!, train.cabForward, rendered.count, rendered.type) : cache.poses;
      rendered.cache = { tracks: latest.current.tracks, position: train.position, cabForward: train.cabForward, poses, composition };
      if (poseChanged) {
        for (let i = 0; i < rendered.cars.children.length; i++) {
          const pose = poses.cars[i], car = rendered.cars.children[i];
          car.visible = pose !== null;
          if (!pose) continue;
          const p = pose.center;
          car.position.set(p.x, p.z + RAIL_TOP, p.y); setTangent(car, p.angle, p.slope);
          inverse.copy(car.quaternion).invert();
          for (const [name, point] of [['bogie-front', pose.frontBogie], ['bogie-rear', pose.rearBogie]] as const) {
            const bogie = car.getObjectByName(name)!;
            localPoint.set(point.x - p.x, point.z - p.z, point.y - p.y).applyQuaternion(inverse);
            bogie.position.copy(localPoint); setTangent(bogie, point.angle, point.slope);
            bogie.quaternion.premultiply(inverse);
          }
        }
        for (const connection of rendered.links.children) connection.visible = false;
        for (const coupling of poses.couplings) {
          const connection = rendered.links.children[coupling.frontCarIndex] as THREE.Group;
          const firstCar = rendered.cars.children[coupling.frontCarIndex], secondCar = rendered.cars.children[coupling.rearCarIndex];
          const firstMount = carPoint(firstCar, 'gangway-rear'), secondMount = carPoint(secondCar, 'gangway-front');
          if (!firstMount || !secondMount) continue;
          firstPin.set(coupling.frontPin.x, coupling.frontPin.z + RAIL_TOP, coupling.frontPin.y);
          secondPin.set(coupling.rearPin.x, coupling.rearPin.z + RAIL_TOP, coupling.rearPin.y);
          firstGangway.copy(firstMount); secondGangway.copy(secondMount);
          connection.visible = true;
          updateE235Connection(connection, firstPin, secondPin, firstGangway, secondGangway, firstCar.quaternion, secondCar.quaternion);
        }
      }
      // Covers continue moving while both trainsets are stopped. Applying the
      // nose state after the body pose also keeps the swivel aimed at the same
      // physical joint used by the mixed-formation movement solver.
      let noseChanged = false;
      const profile = noseCouplerProfile(rendered.type);
      if (profile) for (const car of rendered.cars.children) {
        noseChanged = updateNoseCoupler(car, train.noseCoupling ?? closedNose) || noseChanged;
        // The physics decorator supplies the very same gimbal axis used by
        // its dynamic collision shapes. Do not overwrite that runtime pose.
        if (train.noseCoupling?.axis) continue;
        const nose = getNoseCouplerDiagnostics(car);
        if (!nose) continue;
        inverse.copy(car.quaternion).invert();
        const outward = car.userData.noseDirection ?? 1;
        const target = noseTarget
          ? new THREE.Vector3(noseTarget.x - car.position.x, noseTarget.z + RAIL_TOP - car.position.y, noseTarget.y - car.position.z).applyQuaternion(inverse)
          : nose.pivot.clone().add(new THREE.Vector3(outward * profile.extensionLength, 0, 0));
        noseChanged = orientNoseCoupler(car, target) || noseChanged;
      }
      if (!poseChanged && !noseChanged) return false;
      rendered.diagnostics = consistDiagnostics(rendered);
      return true;
    };
    const sceneFleet = (): readonly TrainRuntime[] => latest.current.fleet ?? [{
      id: 'legacy-train', name: 'Train', type: latest.current.trainType ?? 'e235', carCount: latest.current.carCount,
      position: latest.current.trainPosition, cabForward: latest.current.cabForward, requestedSpeed: 65,
      actualSpeed: 0, running: false, status: 'stopped', lapProgress: 0,
    }];

    const getPlanePoint = (event: { clientX: number; clientY: number }, height: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(new THREE.Plane(UP, -height * SCALE), new THREE.Vector3());
      return hit?.divideScalar(SCALE) ?? null;
    };
    const getPicked = (event: PointerEvent): { group: THREE.Object3D; id?: string; trainId?: string; anchor?: Anchor } | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([anchors, trains, noseJoints, pieces], true);
      for (const hit of hits) {
        let visible = true;
        for (let parent: THREE.Object3D | null = hit.object; parent; parent = parent.parent) if (!parent.visible) visible = false;
        if (!visible) continue;
        let object: THREE.Object3D | null = hit.object;
        while (object && object !== world) {
          if (object.userData.anchor) return { group: object, anchor: object.userData.anchor as Anchor };
          if (object.userData.trainId) return { group: object, trainId: object.userData.trainId as string };
          if (object.userData.pieceId) return { group: object, id: object.userData.pieceId as string };
          object = object.parent;
        }
      }
      return null;
    };
    const pointPlacementAt = (event: { clientX: number; clientY: number }) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      ghostTrackId = null; ghostPoint = null;
      for (const hit of raycaster.intersectObject(pieces, true)) {
        let object: THREE.Object3D | null = hit.object;
        while (object && object !== world && !object.userData.pieceId) object = object.parent;
        const id = object?.userData.pieceId as string | undefined;
        if (!id || !latest.current.tracks.some(track => track.id === id)) continue;
        ghostTrackId = id;
        ghostPoint = { x: hit.point.x / SCALE, y: hit.point.z / SCALE, z: hit.point.y / SCALE };
        break;
      }
    };
    const updatePlacementGhost = () => {
      const candidate = latest.current.placingTrain;
      if (!candidate) {
        if (ghost) { disposeRenderedTrain(ghost); ghost = null; }
        ghostTrackId = null; ghostPoint = null; ghostPosition = null;
        ghostValidationKey = ''; ghostValidationTracks = null;
        if (renderer.domElement.dataset.trainPlacement !== 'null') renderer.domElement.dataset.trainPlacement = 'null';
        return;
      }
      if (!ghost || ghost.id !== candidate.id || ghost.type !== candidate.type || ghost.count !== candidate.carCount) {
        if (ghost) disposeRenderedTrain(ghost);
        ghost = buildRenderedTrain(candidate, true);
      }
      const nextPosition = ghostTrackId && ghostPoint
        ? closestTrainPlacement(latest.current.tracks, ghostTrackId, ghostPoint, latest.current.placementDirection ?? 1)
        : null;
      if (JSON.stringify(nextPosition) !== JSON.stringify(ghostPosition)) ghostPosition = nextPosition;
      const preview = { ...candidate, position: ghostPosition, cabForward: true };
      const otherTrains = sceneFleet().filter(train => train.id !== candidate.id);
      const validationKey = JSON.stringify([
        candidate.id, candidate.type, candidate.carCount, ghostPosition,
        otherTrains.map(train => [train.id, train.type, train.carCount, train.cabForward, train.position]),
      ]);
      const validationChanged = validationKey !== ghostValidationKey || ghostValidationTracks !== latest.current.tracks;
      if (validationChanged) {
        ghostValidation = ghostPosition
          ? validateTrainPlacement(latest.current.tracks, preview, otherTrains)
          : { allowed: false, reason: 'Point to a rail to place this train.' };
        ghostValidationKey = validationKey; ghostValidationTracks = latest.current.tracks;
      }
      const poseChanged = updateRenderedTrain(ghost, preview);
      if (ghost.cars.userData.allowed !== ghostValidation.allowed) {
        ghost.cars.userData.allowed = ghostValidation.allowed;
        const tint = new THREE.Color(ghostValidation.allowed ? '#40a66a' : '#dd4e45');
        const materials = new Set<THREE.Material>();
        for (const root of [ghost.cars, ghost.links]) root.traverse(object => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
          }
        });
        for (const material of materials) {
          material.transparent = true; material.opacity = .34; material.depthWrite = false;
          if ('emissive' in material) {
            (material as THREE.MeshStandardMaterial).emissive.copy(tint);
            (material as THREE.MeshStandardMaterial).emissiveIntensity = .65;
          } else if ('color' in material) (material as THREE.LineBasicMaterial).color.copy(tint);
          material.needsUpdate = true;
        }
      }
      if (validationChanged || poseChanged) renderer.domElement.dataset.trainPlacement = JSON.stringify({
          trainId: candidate.id, position: ghostPosition, ...ghostValidation,
          cars: ghost.diagnostics.cars,
        });
    };
    const publishPickPoints = () => {
      camera.updateMatrixWorld(); world.updateMatrixWorld(true);
      const width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight;
      const points: Record<string, { x: number; y: number }> = {};
      for (const track of latest.current.tracks) {
        const path = pathsFor(track)[0]; if (!path) continue;
        const p = path.pointAt(path.length / 2);
        const projected = new THREE.Vector3(p.x * SCALE, (p.z + 5) * SCALE, p.y * SCALE).project(camera);
        points[track.id] = { x: Math.round((projected.x + 1) * width / 2), y: Math.round((1 - projected.y) * height / 2) };
      }
      for (const accessory of latest.current.accessories) {
        const item = ITEM_BY_KIND.get(accessory.kind);
        const projected = new THREE.Vector3(accessory.x * SCALE, (accessory.elevation + (item?.footprint?.height ?? 15) / 2) * SCALE, accessory.y * SCALE).project(camera);
        points[accessory.id] = { x: Math.round((projected.x + 1) * width / 2), y: Math.round((1 - projected.y) * height / 2) };
      }
      renderer.domElement.dataset.pickPoints = JSON.stringify(points);
      const turnoutPoints: Record<string, { x: number; y: number }> = {};
      for (const piece of pieces.children) {
        const mechanism = piece.userData.turnoutPoints as TurnoutPoints | undefined;
        if (!mechanism?.pairs[0]) continue;
        const bar = mechanism.pairs[0].tieBar;
        const projected = bar.position.clone().applyMatrix4(piece.matrixWorld).project(camera);
        turnoutPoints[piece.userData.pieceId] = { x: Math.round((projected.x + 1) * width / 2), y: Math.round((1 - projected.y) * height / 2) };
      }
      renderer.domElement.dataset.turnoutPickPoints = JSON.stringify(turnoutPoints);
      const trainPoints: Record<string, { x: number; y: number }> = {};
      for (const [id, rendered] of renderedFleet) {
        const car = rendered.cars.children.find(car => rendered.cars.visible && car.visible);
        if (!car) continue;
        const projected = car.position.clone().add(new THREE.Vector3(0, 15, 0)).multiplyScalar(SCALE).project(camera);
        trainPoints[id] = { x: Math.round((projected.x + 1) * width / 2), y: Math.round((1 - projected.y) * height / 2) };
      }
      renderer.domElement.dataset.trainPickPoints = JSON.stringify(trainPoints);
      pickDirty = false;
    };
    const sizeSwitchBadges = () => {
      const height = Math.max(1, renderer.domElement.clientHeight);
      const millimeters = 2 * 22 / (height * camera.projectionMatrix.elements[5] * SCALE);
      pieces.traverse(object => {
        if (object.userData.switchBadge) object.scale.set(millimeters * 1.5, millimeters, 1);
      });
    };
    const fitCamera = () => {
      if (latest.current.cameraPreset === 'ride') return;
      if (latest.current.cameraPreset === 'coupling') {
        // The next rendered frame resolves the actual mechanism transforms.
        // Fitting the whole railway here would hide the connecting noses.
        resetCouplingCamera = true;
        return;
      }
      const bounds = new THREE.Box3().setFromObject(pieces);
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-2.5, 0, -2), new THREE.Vector3(2.5, .6, 2));
      const center = bounds.getCenter(new THREE.Vector3());
      const span = bounds.getSize(new THREE.Vector3());
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const distance = Math.max(span.x / Math.tan(horizontalFov / 2), span.z / Math.tan(verticalFov / 2), 1.6) * .42;
      controls.target.copy(center);
      if (latest.current.cameraPreset === 'top') camera.position.copy(center).add(new THREE.Vector3(.002, distance * 1.06, .004));
      else camera.position.copy(center).add(new THREE.Vector3(distance * .57, distance * .78, distance * .79));
      camera.lookAt(center); camera.updateMatrixWorld();
      const fitPoints: THREE.Vector3[] = [];
      for (const track of latest.current.tracks) for (const path of pathsFor(track)) for (let i = 0; i <= 16; i++) {
        const p = path.pointAt(path.length * i / 16);
        for (const side of [-13, 13]) for (const height of [0, 36]) fitPoints.push(new THREE.Vector3(
          (p.x - Math.sin(p.angle) * side) * SCALE, (p.z + height) * SCALE, (p.y + Math.cos(p.angle) * side) * SCALE,
        ));
      }
      for (const accessory of latest.current.accessories) {
        const piece = pieces.children.find(candidate => candidate.userData.pieceId === accessory.id);
        if (!piece) continue;
        const accessoryBounds = new THREE.Box3().setFromObject(piece);
        for (const x of [accessoryBounds.min.x, accessoryBounds.max.x]) for (const y of [accessoryBounds.min.y, accessoryBounds.max.y]) for (const z of [accessoryBounds.min.z, accessoryBounds.max.z]) fitPoints.push(new THREE.Vector3(x, y, z));
      }
      if (!fitPoints.length) for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) fitPoints.push(new THREE.Vector3(x, 0, z));
      // Fit the occupied railway rather than the empty corners of its enclosing box.
      for (let attempt = 0; attempt < 2; attempt++) {
        let extent = 0;
        for (const point of fitPoints) {
          const p = point.clone().project(camera);
          extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
        }
        if (extent <= .86) break;
        camera.position.sub(center).multiplyScalar(extent / .86).add(center);
        camera.lookAt(center); camera.updateMatrixWorld();
      }
      controls.update(); publishPickPoints();
    };
    const updateSelection = () => {
      const r = runtime.current; if (!r) return;
      if (r.selected) { r.selected.removeFromParent(); r.selected.geometry.dispose(); r.selected = null; }
      for (const outline of r.issueOutlines) { outline.removeFromParent(); outline.geometry.dispose(); }
      r.issueOutlines = [];
      const errorIds = new Set((latest.current.issues ?? []).filter(issue => issue.severity === 'error').flatMap(issue => issue.pieceIds));
      const addOutline = (piece: THREE.Object3D, error: boolean) => {
        const outline = new THREE.BoxHelper(piece, error ? '#c64d3d' : '#d79e4c');
        outline.material.dispose(); outline.material = error ? errorMaterial : selectionMaterial;
        // BoxHelper supplies coordinates in the scene's scaled world already.
        scene.add(outline);
        return outline;
      };
      const selected = pieces.children.find(piece => piece.userData.pieceId === latest.current.selectedId);
      if (selected) r.selected = addOutline(selected, errorIds.has(selected.userData.pieceId));
      for (const piece of pieces.children) if (piece !== selected && errorIds.has(piece.userData.pieceId)) r.issueOutlines.push(addOutline(piece, true));
      renderer.domElement.dataset.errorPieceIds = JSON.stringify([...errorIds]);
    };
    const updateAnchors = () => {
      anchors.clear();
      for (const track of latest.current.tracks) endpoints(track).forEach((endpoint, end) => {
        if (connectedEndpoint(latest.current.tracks, track.id, end)) return;
        const marker = new THREE.Group();
        const active = latest.current.activeAnchor && Math.hypot(endpoint.position.x - latest.current.activeAnchor.position.x, endpoint.position.y - latest.current.activeAnchor.position.y) < 2;
        marker.position.set(endpoint.position.x, (endpoint.position.z ?? 0) + 10.5, endpoint.position.y);
        marker.userData.anchor = { ...endpoint, trackId: track.id, end } satisfies Anchor;
        marker.add(new THREE.Mesh(markerGeometry, active ? activeMarkerMaterial : markerMaterial));
        const horizontal = new THREE.Mesh(plusGeometry, plusMaterial); horizontal.position.y = .8; marker.add(horizontal);
        const vertical = horizontal.clone(); vertical.rotation.y = Math.PI / 2; marker.add(vertical);
        anchors.add(marker);
      });
    };
    const updateLayout = () => {
      const settlePoints = previousLayoutRevision !== latest.current.layoutRevision;
      previousLayoutRevision = latest.current.layoutRevision;
      const ids = new Set([...latest.current.tracks, ...latest.current.accessories].map(piece => piece.id));
      for (const existing of [...pieces.children]) if (!ids.has(existing.userData.pieceId)) { pieces.remove(existing); disposePiece(existing, library); }
      for (const track of latest.current.tracks) {
        // State/labels do not rebuild the rail meshes: retain the actual pose
        // throughout throws, selections and rapidly reversed switch clicks.
        const { switchState: _state, switchNumber: _number, route: _route, ...geometry } = track;
        const signature = JSON.stringify(geometry);
        const existing = pieces.children.find(piece => piece.userData.pieceId === track.id);
        if (existing?.userData.signature === signature) {
          syncTurnoutState(existing, track, library, performance.now(), settlePoints);
          continue;
        }
        if (existing) { pieces.remove(existing); disposePiece(existing, library); }
        const piece = makeTrack(track, library); piece.userData.signature = signature; pieces.add(piece);
      }
      for (const accessory of latest.current.accessories) {
        const signature = JSON.stringify(accessory);
        const existing = pieces.children.find(piece => piece.userData.pieceId === accessory.id);
        if (existing?.userData.signature === signature) continue;
        if (existing) { pieces.remove(existing); disposePiece(existing, library); }
        const piece = makeAccessory(accessory, library); piece.userData.signature = signature; pieces.add(piece);
      }
      scenery.clear();
      const bounds = new THREE.Box3().setFromObject(pieces);
      if (!bounds.isEmpty()) {
        bounds.min.divideScalar(SCALE); bounds.max.divideScalar(SCALE);
        const margin = 75;
        for (let i = 0; i < 5; i++) {
          const x = bounds.min.x + (bounds.max.x - bounds.min.x) * (.18 + i * .16);
          makeTree(x, bounds.max.z + margin + (i % 2) * 29, 38 + i % 3 * 7);
        }
      }
      sizeSwitchBadges(); updateAnchors(); updateSelection(); pickDirty = true;
      pointDiagnosticsDirty = true;
      renderer.domElement.dataset.switchNumbers = JSON.stringify(latest.current.tracks.filter(track => track.switchNumber !== undefined).map(track => ({ id: track.id, number: track.switchNumber, state: track.switchState ?? 'straight' })));
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerDown = { x: event.clientX, y: event.clientY };
      if (latest.current.placingTrain) {
        pointPlacementAt(event); updatePlacementGhost();
        return;
      }
      const picked = getPicked(event);
      if (latest.current.mode !== 'move' || !picked?.id) return;
      const track = latest.current.tracks.find(piece => piece.id === picked.id);
      const accessory = latest.current.accessories.find(piece => piece.id === picked.id);
      const height = track?.elevation ?? accessory?.elevation ?? 0;
      const start = getPlanePoint(event, height); if (!start) return;
      drag = { id: picked.id, group: picked.group, start, original: picked.group.position.clone(), initial: new THREE.Vector2(event.clientX, event.clientY), moved: false, height };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
      event.preventDefault();
    };
    const onMove = (event: PointerEvent) => {
      if (latest.current.placingTrain) {
        pointPlacementAt(event); updatePlacementGhost();
        renderer.domElement.style.cursor = 'crosshair';
        return;
      }
      if (drag) {
        const point = getPlanePoint(event, drag.height); if (!point) return;
        if (Math.hypot(event.clientX - drag.initial.x, event.clientY - drag.initial.y) > 4) drag.moved = true;
        drag.group.position.x = drag.original.x + point.x - drag.start.x;
        drag.group.position.z = drag.original.z + point.z - drag.start.z;
        runtime.current?.selected?.update();
        return;
      }
      const picked = getPicked(event);
      renderer.domElement.style.cursor = picked?.anchor || picked?.trainId ? 'pointer' : latest.current.mode === 'move' && picked?.id ? 'grab' : 'default';
    };
    const onUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (drag) {
        const current = drag; drag = null;
        controls.enabled = latest.current.cameraPreset !== 'ride';
        renderer.domElement.style.cursor = 'grab';
        if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
        const x = current.group.position.x, y = current.group.position.z;
        // A rejected placement leaves the authoritative layout and its rendering intact.
        current.group.position.copy(current.original);
        current.group.updateMatrixWorld(true);
        runtime.current?.selected?.update();
        latest.current.onSelect(current.id);
        if (current.moved) latest.current.onMove(current.id, x, y);
        pickDirty = true; pointerDown = null; return;
      }
      if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 5) {
        if (latest.current.placingTrain) {
          pointPlacementAt(event); updatePlacementGhost();
          if (ghostPosition) latest.current.onPlaceTrain?.(ghostPosition);
          pointerDown = null;
          return;
        }
        const picked = getPicked(event);
        if (picked?.trainId) latest.current.onSelectTrain?.(picked.trainId);
        else if (picked?.anchor) latest.current.onAnchor(picked.anchor);
        else latest.current.onSelect(picked?.id ?? null);
      }
      pointerDown = null;
    };
    const onCancel = () => {
      if (drag) { drag.group.position.copy(drag.original); drag.group.updateMatrixWorld(true); }
      drag = null; pointerDown = null; controls.enabled = latest.current.cameraPreset !== 'ride';
    };
    const onDragOver = (event: DragEvent) => { if (event.dataTransfer?.types.includes('application/x-kato-piece')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } };
    const onDrop = (event: DragEvent) => {
      const kind = event.dataTransfer?.getData('application/x-kato-piece');
      if (!kind || !ITEM_BY_KIND.has(kind)) return;
      event.preventDefault(); const point = getPlanePoint(event, latest.current.placementHeight ?? 0);
      if (point) latest.current.onDropItem?.(kind, point.x, point.z);
    };
    renderer.domElement.addEventListener('pointerdown', onDown, true);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onCancel);
    element.addEventListener('dragover', onDragOver); element.addEventListener('drop', onDrop);
    controls.addEventListener('change', () => { pickDirty = true; });
    const resize = () => {
      const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); sizeSwitchBadges(); pickDirty = true;
      if (runtime.current) fitCamera();
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element); resize();
    runtime.current = { renderer, scene, camera, controls, world, pieces, anchors, trains, library, selected: null, issueOutlines: [], updateLayout, fitCamera, publishPickPoints };
    updateLayout(); fitCamera(); publishPickPoints();
    const animate = () => {
      if (stopped) return;
      frame = requestAnimationFrame(animate);
      const current = latest.current;
      for (const piece of pieces.children) {
        const points = piece.userData.turnoutPoints as TurnoutPoints | undefined;
        if (!points) continue;
        pointDiagnosticsDirty = points.update(performance.now()) || pointDiagnosticsDirty;
        const slider = piece.userData.pointLeverSlider as THREE.Mesh;
        slider.position.x = points.fraction * 8 - 4;
      }
      if (pointDiagnosticsDirty) {
        world.updateMatrixWorld(true);
        renderer.domElement.dataset.turnoutPoints = JSON.stringify(pieces.children.flatMap(piece => {
          const points = piece.userData.turnoutPoints as TurnoutPoints | undefined;
          return points ? [points.snapshot(point => layoutPoint(point.applyMatrix4(piece.matrixWorld).divideScalar(SCALE)))] : [];
        }));
        pointDiagnosticsDirty = false;
      }
      const cameraPresetChanged = current.cameraPreset !== previousCameraPreset;
      previousCameraPreset = current.cameraPreset;
      const fleet = sceneFleet();
      const ids = new Set(fleet.map(train => train.id));
      let diagnosticsChanged = false;
      for (const [id, rendered] of renderedFleet) if (!ids.has(id)) {
        disposeRenderedTrain(rendered); renderedFleet.delete(id); diagnosticsChanged = true;
      }
      const selectedTrain = fleet.find(train => train.id === current.selectedTrainId) ?? fleet[0];
      const selectedId = selectedTrain?.id ?? null;
      const selectionChanged = selectedRenderedTrainId !== selectedId;
      selectedRenderedTrainId = selectedId;
      const groups = current.couplings ?? [];
      const groupIds = new Set(groups.map(group => group.id));
      for (const [id, joint] of renderedNoseJoints) if (!groupIds.has(id)) {
        joint.removeFromParent(); renderedNoseJoints.delete(id); diagnosticsChanged = true;
      }
      for (const id of formationCache.keys()) if (!groupIds.has(id)) formationCache.delete(id);
      const composedMembers = new Map<string, { poses: ConsistPoses; head?: { x: number; y: number; z: number } }>();
      const selectedMembers = new Set(selectedId ? [selectedId] : []);
      for (const group of groups) {
        const e6 = fleet.find(train => train.id === group.e6Id), e5 = fleet.find(train => train.id === group.e5Id);
        if (!e6 || !e5 || e6.type === 'e235' || e5.type === 'e235') continue;
        if (group.e6Id === selectedId || group.e5Id === selectedId) { selectedMembers.add(group.e6Id); selectedMembers.add(group.e5Id); }
        let cached = formationCache.get(group.id);
        const pairing = `${e6.type}:${e5.type}:${group.e6End ?? 'rear'}:${group.e5End ?? 'front'}`;
        if (!cached || cached.tracks !== current.tracks || cached.e6Position !== e6.position || cached.e5Position !== e5.position ||
          cached.e6Forward !== e6.cabForward || cached.e5Forward !== e5.cabForward || cached.e6Count !== e6.carCount || cached.e5Count !== e5.carCount || cached.pairing !== pairing) {
          cached = {
            tracks: current.tracks, e6Position: e6.position, e5Position: e5.position,
            e6Forward: e6.cabForward, e5Forward: e5.cabForward, e6Count: e6.carCount, e5Count: e5.carCount,
            pairing, poses: solveCoupledFormation(current.tracks, e6, e5, group),
          };
          formationCache.set(group.id, cached);
        }
        const formation = cached.poses;
        composedMembers.set(e6.id, { poses: formation.e6, head: formation.joint?.head });
        composedMembers.set(e5.id, { poses: formation.e5, head: formation.joint?.head });
        let joint = renderedNoseJoints.get(group.id);
        if (!joint) {
          // These cabs share a mechanical connector. They do not have a
          // passenger gangway or the bellows used between ordinary cars.
          joint = box(noseJoints, library, 1.1, 2.5, 3.2, 0, 0, 0, '#52606a', .7);
          joint.name = `locked-nose-joint-${group.id}`; joint.userData.trainId = group.e6Id;
          renderedNoseJoints.set(group.id, joint); diagnosticsChanged = true;
        }
        joint.visible = formation.complete && !!formation.joint;
        if (formation.joint) {
          const { head, direction } = formation.joint;
          joint.position.set(head.x, head.z + RAIL_TOP, head.y);
          const horizontal = Math.hypot(direction.x, direction.y);
          setTangent(joint, Math.atan2(direction.y, direction.x), horizontal > 0 ? direction.z / horizontal : 0);
        }
      }
      for (const train of fleet) {
        let rendered = renderedFleet.get(train.id);
        if (!rendered || rendered.type !== train.type || rendered.count !== train.carCount) {
          if (rendered) disposeRenderedTrain(rendered);
          rendered = buildRenderedTrain(train); renderedFleet.set(train.id, rendered);
          diagnosticsChanged = true;
        }
        const composed = composedMembers.get(train.id);
        diagnosticsChanged = updateRenderedTrain(rendered, train, composed?.poses, composed?.head) || diagnosticsChanged;
        const highlight = current.fleet !== undefined && selectedMembers.has(train.id);
        if (rendered.cars.userData.selected !== highlight) {
          rendered.cars.userData.selected = highlight;
          for (const car of rendered.cars.children) {
            const outline = car.getObjectByName('selected-train-outline');
            if (outline) outline.visible = highlight;
          }
        }
      }
      const operation = current.couplingOperation;
      const signature = JSON.stringify([
        fleet.map(train => [train.id, train.name, train.status, train.running, train.actualSpeed, train.requestedSpeed, train.stopReason]),
        groups, operation && [operation.id, operation.phase, operation.elapsed, operation.paused],
      ]);
      if (diagnosticsChanged || selectionChanged || signature !== publishedFleetSignature) {
        renderer.domElement.dataset.fleetPoses = JSON.stringify(fleet.map(train => ({
          id: train.id, name: train.name, type: train.type, status: train.status,
          running: train.running, actualSpeed: train.actualSpeed, requestedSpeed: train.requestedSpeed,
          stopReason: train.stopReason, position: train.position, cabForward: train.cabForward, carCount: train.carCount,
          selected: selectedMembers.has(train.id), couplingGroupId: groups.find(group => group.e6Id === train.id || group.e5Id === train.id)?.id,
          ...renderedFleet.get(train.id)!.diagnostics,
        })));
        renderer.domElement.dataset.couplingGroups = JSON.stringify(groups.map(group => {
          const formation = formationCache.get(group.id)?.poses;
          const joint = renderedNoseJoints.get(group.id);
          const e6Car = renderedFleet.get(group.e6Id)?.cars.children.at(group.e6End === 'front' ? 0 : -1);
          const e5Car = renderedFleet.get(group.e5Id)?.cars.children.at(group.e5End === 'rear' ? -1 : 0);
          const nosePoint = (car: THREE.Object3D | undefined, key: 'pivot' | 'matingFace') => {
            if (!car) return null;
            const nose = getNoseCouplerDiagnostics(car);
            return nose ? layoutPoint(nose[key].clone().applyQuaternion(car.quaternion).add(car.position)) : null;
          };
          return {
            ...group, complete: formation?.complete ?? false,
            joint: joint?.visible ? {
              head: layoutPoint(joint.position), quaternion: joint.quaternion.toArray(),
              e6Mount: nosePoint(e6Car, 'pivot'), e5Mount: nosePoint(e5Car, 'pivot'),
              e6Face: nosePoint(e6Car, 'matingFace'), e5Face: nosePoint(e5Car, 'matingFace'),
            } : null,
          };
        }));
        renderer.domElement.dataset.couplingOperation = JSON.stringify(operation ? {
          id: operation.id, e6Id: operation.e6Id, e5Id: operation.e5Id, e6End: operation.e6End, e5End: operation.e5End,
          phase: operation.phase, elapsed: operation.elapsed, paused: operation.paused,
        } : null);
        renderer.domElement.dataset.fleetCount = String(fleet.length);
        renderer.domElement.dataset.selectedTrainId = selectedId ?? '';
        renderer.domElement.dataset.carCount = String(selectedTrain?.carCount ?? 0);
        renderer.domElement.dataset.trainType = selectedTrain?.type ?? current.trainType ?? 'e235';
        const selected = selectedId ? renderedFleet.get(selectedId) : null;
        renderer.domElement.dataset.carPoses = JSON.stringify(selected?.diagnostics.cars ?? []);
        renderer.domElement.dataset.couplers = JSON.stringify(selected?.diagnostics.couplers ?? []);
        publishedFleetSignature = signature;
        pickDirty = true;
      }
      updatePlacementGhost();
      const selectedRendered = selectedId ? renderedFleet.get(selectedId) : null;
      const leadPoint = selectedRendered?.cache?.poses.cars[0]?.center ?? null;
      if (leadPoint) {
        renderer.domElement.dataset.trainX = leadPoint.x.toFixed(2);
        renderer.domElement.dataset.trainY = leadPoint.y.toFixed(2);
        renderer.domElement.dataset.trainHeight = leadPoint.z.toFixed(2);
        if (current.cameraPreset === 'ride' && !current.placingTrain) {
          const point = leadPoint, sine = Math.sin(point.angle), cosine = Math.cos(point.angle);
          const eye = new THREE.Vector3((point.x + cosine * 150 - sine * 165) * SCALE, (point.z + 65) * SCALE, (point.y + sine * 150 + cosine * 165) * SCALE);
          const target = new THREE.Vector3((point.x - cosine * 30) * SCALE, (point.z + 17) * SCALE, (point.y - sine * 30) * SCALE);
          if (cameraPresetChanged || selectionChanged) { camera.position.copy(eye); controls.target.copy(target); }
          else { camera.position.lerp(eye, .16); controls.target.lerp(target, .2); }
          camera.lookAt(controls.target); pickDirty = true;
        }
      }
      else {
        delete renderer.domElement.dataset.trainX; delete renderer.domElement.dataset.trainY;
        delete renderer.domElement.dataset.trainHeight;
      }
      let couplingFocus: THREE.Vector3 | null = null;
      if (current.cameraPreset === 'coupling' && !current.placingTrain) {
        const pair = operation ?? groups.find(group => selectedMembers.has(group.e6Id) || selectedMembers.has(group.e5Id));
        if (pair) {
          const e6Car = renderedFleet.get(pair.e6Id)?.cars.children.at(pair.e6End === 'front' ? 0 : -1);
          const e5Car = renderedFleet.get(pair.e5Id)?.cars.children.at(pair.e5End === 'rear' ? -1 : 0);
          const e6Nose = e6Car && getNoseCouplerDiagnostics(e6Car);
          const e5Nose = e5Car && getNoseCouplerDiagnostics(e5Car);
          if (e6Car?.visible && e5Car?.visible && e6Nose && e5Nose) {
            const e6Face = e6Nose.matingFace.clone().applyQuaternion(e6Car.quaternion).add(e6Car.position);
            const e5Face = e5Nose.matingFace.clone().applyQuaternion(e5Car.quaternion).add(e5Car.position);
            couplingFocus = e6Face.add(e5Face).multiplyScalar(.5 * SCALE);
            const pairKey = `${pair.e6Id}:${pair.e5Id}:${pair.e6End ?? 'rear'}:${pair.e5End ?? 'front'}`;
            if (resetCouplingCamera || cameraPresetChanged || previousCouplingPair !== pairKey || !previousCouplingFocus) {
              // A side view reveals both recessed nose cavities and the
              // mechanical head. It starts once, then remains freely orbitable.
              const axis = e5Car.position.clone().sub(e6Car.position); axis.y = 0;
              if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0); else axis.normalize();
              camera.position.copy(couplingFocus).add(new THREE.Vector3(
                (-axis.z * 150 + axis.x * 20) * SCALE,
                65 * SCALE,
                (axis.x * 150 + axis.z * 20) * SCALE,
              ));
              controls.target.copy(couplingFocus); camera.lookAt(controls.target);
              resetCouplingCamera = false;
            } else {
              // Following only by translation preserves the child's orbit,
              // pan and zoom while the connected joint follows the railway.
              const delta = couplingFocus.clone().sub(previousCouplingFocus);
              camera.position.add(delta); controls.target.add(delta);
            }
            previousCouplingFocus = couplingFocus.clone(); previousCouplingPair = pairKey;
            pickDirty = true;
          }
        }
      } else {
        previousCouplingFocus = null; previousCouplingPair = null;
      }
      if (!drag) {
        controls.enabled = current.cameraPreset !== 'ride' || !!current.placingTrain || !leadPoint;
        if (controls.enabled) controls.update();
      }
      renderer.domElement.dataset.cameraPose = JSON.stringify({
        preset: current.cameraPreset,
        eye: layoutPoint(camera.position.clone().divideScalar(SCALE)),
        target: layoutPoint(controls.target.clone().divideScalar(SCALE)),
        couplingFocus: couplingFocus ? layoutPoint(couplingFocus.clone().divideScalar(SCALE)) : null,
      });
      const now = performance.now();
      if (pickDirty && now - lastPickTime > 160) { publishPickPoints(); lastPickTime = now; }
      renderer.render(scene, camera);
      if (!renderer.domElement.dataset.ready) { renderer.domElement.dataset.ready = 'true'; latest.current.onReady?.(true); }
    };
    animate();
    return () => {
      stopped = true; cancelAnimationFrame(frame); resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown, true);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onCancel);
      element.removeEventListener('dragover', onDragOver); element.removeEventListener('drop', onDrop);
      controls.dispose();
      for (const piece of pieces.children) disposePiece(piece, library);
      for (const rendered of renderedFleet.values()) disposeRenderedTrain(rendered);
      if (ghost) disposeRenderedTrain(ghost);
      if (runtime.current?.selected) { scene.remove(runtime.current.selected); runtime.current.selected.geometry.dispose(); }
      for (const outline of runtime.current?.issueOutlines ?? []) { outline.removeFromParent(); outline.geometry.dispose(); }
      ground.geometry.dispose(); grid.geometry.dispose(); (grid.material as THREE.Material).dispose();
      markerGeometry.dispose(); plusGeometry.dispose(); markerMaterial.dispose(); activeMarkerMaterial.dispose(); plusMaterial.dispose(); selectionMaterial.dispose(); errorMaterial.dispose();
      library.dispose(); environment.dispose(); renderer.dispose(); renderer.domElement.remove(); runtime.current = null;
    };
  }, []);

  useEffect(() => { runtime.current?.updateLayout(); }, [props.tracks, props.accessories, props.selectedId, props.activeAnchor, props.issues, props.layoutRevision]);
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    r.controls.enabled = props.cameraPreset !== 'ride'; r.fitCamera();
  }, [props.cameraPreset, props.viewRevision]);

  return <div ref={host} className="scene-container" style={{ position: 'absolute', inset: 0 }}>
    {unavailable && <div className="webgl-fallback" role="alert" style={{ padding: 40, textAlign: 'center' }}>
      <h2>This railway needs 3D graphics</h2>
      <p>Open this page in an up-to-date Safari, Chrome, or Firefox on your Mac. If 3D graphics are disabled, turn on hardware acceleration in the browser settings.</p>
    </div>}
  </div>;
}
