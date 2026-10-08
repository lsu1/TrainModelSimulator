import { useEffect, useMemo, useRef, useState } from "react";
import { KATO_CATALOG } from "./catalog";
import type { CatalogCategory } from "./catalogTypes";
import {
  attachTrack,
  closedRouteLength,
  connectedEndpoint,
  endpoints,
  openEndpoints,
  snapTrack,
  trackLength,
} from "./track";
import type { Endpoint, Track, TrainPosition } from "./track";
import { STORAGE_KEY, createLayout, loadLayout, parseLayout } from "./layout";
import type { LayoutData, LayoutPreset, PlacedAccessory } from "./layout";
import { clampTrainSpeed, getTrainCarSpec, getTrainSpec } from "./trains";
import type { TrainType } from "./trains";
import { DEFAULT_TRAIN_SPEED, MAX_TRAINSETS, initialTrainPosition, restoreFleet, snapshotFleetLayout, trainSnapshot } from "./fleet";
import type { TrainRuntime } from "./fleet";
import { occupiedFleetTrackIds, stepFleet } from "./fleetMotion";
import { findTrainPlacement, validateTrainPlacement } from "./trainPlacement";
import { solveConsistPoses } from "./consistPose";
import { auditClearances, checkPlacement } from "./clearance";
import { auditEngineering, planRamp, trackGradePercent } from "./engineering";
import {
  SAVED_DESIGNS_KEY,
  persistSavedDesigns,
  readSavedDesigns,
  readWorkingDesignId,
  removeDesignSnapshot,
  saveDesignSnapshot,
} from "./savedDesigns";

export const CATALOG = new Map(
  KATO_CATALOG.map((piece) => [piece.kind, piece]),
);
type Anchor = Endpoint & { trackId: string; end: number };
export type Modal = "layouts" | "save" | "help" | "references" | "checks" | null;
type HistoryEntry = { layout: LayoutData; savedDesignId: string | null };
const initialTrain = (tracks: Track[], trainType?: TrainType, carCount = 11): TrainPosition => {
  const first = tracks[0];
  const shape = first && CATALOG.get(first.kind)?.shape;
  const route =
    first?.route ??
    (first?.switchState === "branch"
      ? shape === "scissors"
        ? 2
        : shape === "turnout"
          ? 1
          : 0
      : 0);
  return {
    trackId: first?.id ?? "",
    distance: first ? Math.min(getTrainCarSpec(trainType, 0, carCount).length, trackLength(first, route)) : 0,
    direction: 1,
    route,
    laps: 0,
  };
};

function restorePlayableFleet(layout: LayoutData): TrainRuntime[] {
  const accepted: TrainRuntime[] = [];
  for (const train of restoreFleet(layout)) {
    const unfinishedLegacy = train.position && train.legacyStart
      && !solveConsistPoses(layout.tracks, train.position, train.cabForward, train.carCount, train.type).cars.some(Boolean);
    const validation = train.position && layout.version === 3 && !unfinishedLegacy
      ? validateTrainPlacement(layout.tracks, train, accepted, { allowPartial: train.legacyStart === true })
      : { allowed: true };
    accepted.push(validation.allowed ? train : {
      ...train, position: null, status: "unplaced", stopReason: validation.reason ?? "Choose a safe place on the rails.",
    });
  }
  return accepted;
}

export function useRailway() {
  const [layout, setLayoutState] = useState<LayoutData>(loadLayout);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const setLayout = (next: LayoutData) => { layoutRef.current = next; setLayoutState(next); };
  const { tracks, accessories } = layout;
  const [fleet, setFleet] = useState<TrainRuntime[]>(() => restorePlayableFleet(layout));
  const fleetRef = useRef(fleet);
  const [selectedTrainId, setSelectedTrainIdState] = useState<string | null>(() =>
    layout.selectedTrainId ?? fleet[0]?.id ?? null,
  );
  const selectedTrainIdRef = useRef(selectedTrainId);
  const selectedTrain = fleet.find((train) => train.id === selectedTrainId);
  const trainType = selectedTrain?.type ?? layout.trainType ?? "e235";
  const carCount = selectedTrain?.carCount ?? layout.carCount;
  const trainSpec = getTrainSpec(trainType);
  const position = selectedTrain?.position ?? initialTrain([], trainType, carCount);
  const running = selectedTrain?.running ?? false;
  const speed = selectedTrain?.requestedSpeed ?? DEFAULT_TRAIN_SPEED;
  const cabForward = selectedTrain?.cabForward ?? true;
  const [placementTrainId, setPlacementTrainId] = useState<string | null>(null);
  const [placementDirection, setPlacementDirection] = useState<1 | -1>(1);
  const placingTrain = fleet.find((train) => train.id === placementTrainId) ?? null;
  const [designLibrary, setDesignLibrary] = useState(readSavedDesigns);
  const [activeSavedDesignId, setActiveSavedDesignId] = useState<string | null>(() =>
    readWorkingDesignId(designLibrary.library),
  );
  const savedDesigns = designLibrary.library.designs;
  const [savedDesignsError, setSavedDesignsError] = useState(designLibrary.error);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [category, setCategory] = useState<CatalogCategory>("straight");
  const [search, setSearch] = useState("");
  const [bend, setBend] = useState<1 | -1>(1);
  const [buildHeight, setBuildHeight] = useState(0);
  const [mode, setMode] = useState<"orbit" | "move">("orbit");
  const [cameraPreset, setCameraPreset] = useState<
    "perspective" | "top" | "ride"
  >("perspective");
  const [viewRevision, setViewRevision] = useState(0);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState(false);
  const [rampTarget, setRampTarget] = useState(60);
  const [rampGrade, setRampGrade] = useState(3);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const selectedTrack = tracks.find((t) => t.id === selectedId);
  const selectedAccessory = accessories.find((p) => p.id === selectedId);
  const selection = selectedTrack ?? selectedAccessory;
  const selectedSpec = selection ? CATALOG.get(selection.kind) : undefined;
  const routeLength = useMemo(
    () => {
      const reference = selectedTrain?.position ?? initialTrainPosition(tracks, trainType, carCount);
      return reference ? closedRouteLength(tracks, reference) : null;
    },
    [tracks, position.trackId, position.direction, position.route, trainType, carCount],
  );
  const ends = useMemo(() => openEndpoints(tracks), [tracks]);
  const totalLength = tracks.reduce(
    (sum, track) => sum + trackLength(track),
    0,
  );
  const pieceCount = tracks.length + accessories.length;
  const filtered = useMemo(
    () =>
      KATO_CATALOG.filter((piece) =>
        search.trim()
          ? `${piece.name} ${piece.label} ${piece.sku ?? ""}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())
          : piece.category === category,
      ),
    [category, search],
  );

  const switches = useMemo(
    () =>
      tracks
        .filter((track) => {
          const shape = CATALOG.get(track.kind)?.shape;
          return shape === "turnout" || shape === "scissors";
        })
        .sort((a, b) => (a.switchNumber ?? 0) - (b.switchNumber ?? 0)),
    [tracks],
  );
  const issues = useMemo(
    () => [...auditClearances(layout), ...auditEngineering(layout)],
    [layout],
  );
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const rampOrigin = useMemo(
    () => ({
      x: tracks.length
        ? Math.max(
            ...tracks.flatMap((track) =>
              endpoints(track).map((end) => end.position.x),
            ),
          ) + 90
        : -300,
      y: 0,
      angle: 0,
      elevation: buildHeight,
    }),
    [tracks, buildHeight],
  );
  const rampPlan = useMemo(
    () =>
      planRamp({
        anchor: anchor ?? undefined,
        origin: rampOrigin,
        targetHeight: rampTarget,
        maxGradePercent: rampGrade,
        idPrefix: "ramp-preview",
        existingAccessories: accessories,
      }),
    [anchor, rampOrigin, rampTarget, rampGrade, accessories],
  );
  const shoppingRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        sku: string;
        name: string;
        quantity: number;
        verified: boolean;
        sourceUrl: string;
        notes: string[];
      }
    >();
    for (const piece of [...tracks, ...accessories]) {
      const spec = CATALOG.get(piece.kind)!;
      const key = spec.sku ?? spec.kind;
      const row = grouped.get(key);
      if (row) {
        row.quantity += 1;
        row.verified &&= spec.verification === "verified";
        if (!row.name.includes(spec.label)) row.name += ` / ${spec.label}`;
        if (spec.notes && !row.notes.includes(spec.notes))
          row.notes.push(spec.notes);
      } else
        grouped.set(key, {
          sku: spec.sku ?? "Needs identification",
          name: `${spec.label} · ${spec.name}`,
          quantity: 1,
          verified: spec.verification === "verified",
          sourceUrl: spec.sourceUrl,
          notes: spec.notes ? [spec.notes] : [],
        });
    }
    return [...grouped.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }, [tracks, accessories]);

  const notify = (message: string, error = false) => {
    setToast(message);
    setToastError(error);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), error ? 12000 : 4200);
  };
  const pausedTrain = (train: TrainRuntime): TrainRuntime => ({
    ...train, running: false, actualSpeed: 0, reverseRequested: false,
    status: train.position ? "stopped" : "unplaced", stopReason: undefined,
  });
  const currentLayoutSnapshot = () => snapshotFleetLayout(
    layoutRef.current, fleetRef.current, selectedTrainIdRef.current,
  );
  const rememberCurrentLayout = () => {
    // Capture before dispatch: React may evaluate a state updater after the
    // fleet refs have already changed for this command.
    const snapshot = currentLayoutSnapshot();
    const savedDesignId = activeSavedDesignId;
    setHistory((previous) => [...previous.slice(-49), { layout: snapshot, savedDesignId }]);
  };
  const proposedFleetIsSafe = (nextTracks: Track[], proposed: readonly TrainRuntime[]): boolean => {
    for (const train of proposed) {
      if (!train.position) continue;
      // The original unfinished-track workflow can have no complete car yet.
      // It is preserved only for the explicitly migrated start placement.
      if (train.legacyStart && !solveConsistPoses(nextTracks, train.position, train.cabForward, train.carCount, train.type).cars.some(Boolean)) continue;
      const validation = validateTrainPlacement(nextTracks, train, proposed, { allowPartial: train.legacyStart === true });
      if (!validation.allowed) { notify(`This change would leave ${train.name} in an unsafe place: ${validation.reason}`, true); return false; }
    }
    return true;
  };
  const commitFleet = (next: TrainRuntime[], persist = false, selected = selectedTrainIdRef.current) => {
    const validSelection = next.some((train) => train.id === selected) ? selected : next[0]?.id ?? null;
    fleetRef.current = next;
    selectedTrainIdRef.current = validSelection;
    setFleet(next);
    setSelectedTrainIdState(validSelection);
    if (persist) setLayout(snapshotFleetLayout(layoutRef.current, next, validSelection));
  };
  const pauseAllTrains = () => commitFleet(fleetRef.current.map(pausedTrain), true);
  const selectTrain = (id: string) => {
    if (!fleetRef.current.some((train) => train.id === id)) return;
    commitFleet(fleetRef.current, true, id);
  };
  const beginTrainPlacement = (id: string) => {
    const train = fleetRef.current.find((candidate) => candidate.id === id);
    if (!train) return;
    commitFleet(fleetRef.current.map(pausedTrain), true, id);
    setPlacementDirection(train.position
      ? train.cabForward ? train.position.direction : train.position.direction === 1 ? -1 : 1
      : 1);
    setPlacementTrainId(id);
    notify(`Trains paused. Click a rail to place ${train.name}. Green means there is room.`);
  };
  const cancelTrainPlacement = () => setPlacementTrainId(null);
  const placeTrain = (nextPosition: TrainPosition) => {
    const train = fleetRef.current.find((candidate) => candidate.id === placementTrainId);
    if (!train) return;
    const candidate = { ...pausedTrain(train), position: nextPosition, cabForward: true, legacyStart: false, lapProgress: 0, status: "stopped" as const };
    const validation = validateTrainPlacement(tracks, candidate, fleetRef.current);
    if (!validation.allowed) { notify(validation.reason ?? "There is not enough room for this train here.", true); return; }
    rememberCurrentLayout();
    commitFleet(fleetRef.current.map((entry) => entry.id === train.id ? candidate : entry), true);
    setPlacementTrainId(null);
    notify(`${train.name} is on the rails. Ready to drive!`);
  };
  const addTrain = (type: TrainType, count: number) => {
    if (fleetRef.current.length >= MAX_TRAINSETS) { notify(`This railway has room for up to ${MAX_TRAINSETS} trainsets. Remove a train to add another.`, true); return; }
    if (!Number.isInteger(count) || count < 3 || count > 11) return;
    const number = fleetRef.current.filter((entry) => entry.type === type).length + 1;
    const existingNames = new Set(fleetRef.current.map((entry) => entry.name));
    let suffix = number;
    while (existingNames.has(`${getTrainSpec(type).name} ${suffix}`)) suffix += 1;
    const candidate: TrainRuntime = {
      id: crypto.randomUUID(), name: `${getTrainSpec(type).name} ${suffix}`, type, carCount: count,
      position: null, cabForward: true, requestedSpeed: DEFAULT_TRAIN_SPEED,
      actualSpeed: 0, running: false, status: "unplaced", lapProgress: 0,
    };
    candidate.position = findTrainPlacement(tracks, candidate, fleetRef.current);
    if (candidate.position) candidate.status = "stopped";
    rememberCurrentLayout();
    commitFleet([...fleetRef.current, candidate], true, candidate.id);
    if (!candidate.position) {
      setPlacementTrainId(candidate.id);
      setPlacementDirection(1);
      commitFleet(fleetRef.current.map(pausedTrain), true, candidate.id);
      notify(`Added ${candidate.name}. Choose a rail with enough room, or build a longer track.`, true);
    } else notify(`Added ${candidate.name}. Select a train to drive it.`);
  };
  const removeTrain = (id: string) => {
    const train = fleetRef.current.find((entry) => entry.id === id);
    if (!train) return;
    rememberCurrentLayout();
    commitFleet(fleetRef.current.filter((entry) => entry.id !== id), true);
    if (placementTrainId === id) setPlacementTrainId(null);
    notify(`${train.name} removed. Your other trains keep their controls.`);
  };
  const updateControlledTrain = (update: (train: TrainRuntime) => TrainRuntime, persist = false) => {
    const id = selectedTrainIdRef.current;
    commitFleet(fleetRef.current.map((train) => train.id === id ? update(train) : train), persist);
  };
  const setSpeed = (value: number) => updateControlledTrain((train) => ({
    ...train, requestedSpeed: clampTrainSpeed(train.type, Math.max(5, value)),
  }), true);
  const setRunning = (value: boolean) => updateControlledTrain((train) =>
    value && train.position && !placementTrainId
      ? { ...train, running: true, status: "accelerating", stopReason: undefined }
      : pausedTrain(train), !value,
  );
  useEffect(() => {
    if (designLibrary.error) notify(designLibrary.error, true);
    // Reading a damaged library must never overwrite the recoverable original.
    // Recovery is backed up only when the user next changes a saved snapshot.
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SAVED_DESIGNS_KEY) return;
      const next = readSavedDesigns();
      setDesignLibrary(next);
      setSavedDesignsError(next.error);
      setActiveSavedDesignId((id) => next.library.designs.some((design) => design.id === id) ? id : null);
      if (next.error) notify(next.error, true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const canPlace = (piece: Track | PlacedAccessory) => {
    const shape = CATALOG.get(piece.kind)?.shape;
    if (
      "bend" in piece &&
      (shape === "straight" || shape === "doubleStraight") &&
      !Number.isFinite(trackGradePercent(piece))
    ) {
      notify(
        "Placement blocked: this rise is longer than the purchased track piece. Build a longer, gradual ramp.",
        true,
      );
      return false;
    }
    const result = checkPlacement(layout, piece);
    if (!result.allowed)
      notify(
        `Placement blocked: ${result.issues.find((issue) => issue.severity === "error")?.message ?? "This piece obstructs the railway."}`,
        true,
      );
    return result.allowed;
  };
  const changeLayout = (next: LayoutData, preserveSelection = false, replaceFleet = false): boolean => {
    const previousSnapshot = currentLayoutSnapshot();
    let nextFleet = fleetRef.current;
    if (replaceFleet) {
      nextFleet = restoreFleet(next);
      // New files store exact placements. Reject invalid placements rather than
      // rendering overlapping trains; legacy open-end starts stay compatible.
      if (next.version === 3 && !proposedFleetIsSafe(next.tracks, nextFleet)) return false;
    } else if (next.tracks !== tracks) {
      const occupied = occupiedFleetTrackIds(tracks, fleetRef.current);
      const altered = tracks.find((track) => {
        const replacement = next.tracks.find((candidate) => candidate.id === track.id);
        return (!replacement || ["kind", "x", "y", "angle", "bend", "elevation", "endElevation", "route", "switchState"].some(
          (key) => track[key as keyof Track] !== replacement[key as keyof Track],
        )) && occupied.has(track.id);
      });
      if (altered) {
        notify("This track is occupied. Place its train elsewhere or remove the train before changing it.", true);
        setLayoutRevision((value) => value + 1);
        return false;
      }
      nextFleet = fleetRef.current.map((train) => {
        const paused = pausedTrain(train);
        // Keep the original empty-layout workflow: its first train appears as
        // track is built. Additional trainsets always require valid placement.
        if (!paused.position && nextFleet.length === 1 && train.id === "train-1" && train.legacyStart) {
          const initial = initialTrainPosition(next.tracks, train.type, train.carCount);
          return { ...paused, position: initial, status: initial ? "stopped" as const : "unplaced" as const };
        }
        return paused;
      });
      for (const train of nextFleet) {
        if (!train.position) continue;
        const before = solveConsistPoses(tracks, train.position, train.cabForward, train.carCount, train.type);
        const after = solveConsistPoses(next.tracks, train.position, train.cabForward, train.carCount, train.type);
        if (after.cars.filter(Boolean).length < before.cars.filter(Boolean).length) {
          notify(`This edit would leave ${train.name} without track. Place it elsewhere first.`, true);
          setLayoutRevision((value) => value + 1);
          return false;
        }
      }
      if (!proposedFleetIsSafe(next.tracks, nextFleet)) {
        setLayoutRevision((value) => value + 1);
        return false;
      }
    }
    setHistory((previous) => [...previous.slice(-49), { layout: previousSnapshot, savedDesignId: activeSavedDesignId }]);
    const selectionId = replaceFleet ? next.selectedTrainId ?? nextFleet[0]?.id ?? null : selectedTrainIdRef.current;
    setLayout(snapshotFleetLayout(next, nextFleet, selectionId));
    commitFleet(nextFleet, false, selectionId);
    setPlacementTrainId(null);
    if (!preserveSelection) setSelectedId(null);
    setAnchor(null);
    return true;
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setLayout(previous.layout);
    setActiveSavedDesignId(savedDesigns.some((design) => design.id === previous.savedDesignId)
      ? previous.savedDesignId : null);
    commitFleet(restoreFleet(previous.layout), false, previous.layout.selectedTrainId ?? null);
    setPlacementTrainId(null);
    setSelectedId(null);
    setAnchor(null);
    setLayoutRevision((value) => value + 1);
    notify("Back one step. Keep building!");
  };
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...currentLayoutSnapshot(),
        ...(activeSavedDesignId === null ? {} : { savedDesignId: activeSavedDesignId }),
      }));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [layout, activeSavedDesignId]);
  const addPiece = (kind: string, drop?: { x: number; y: number }) => {
    const spec = CATALOG.get(kind);
    if (!spec) return;
    if (pieceCount >= 300) {
      notify("Your railway has reached 300 pieces. Remove one to make room.");
      return;
    }
    const id = crypto.randomUUID();
    const x =
      drop?.x ??
      (tracks.length
        ? Math.max(
            ...tracks.flatMap((t) => endpoints(t).map((e) => e.position.x)),
          ) + 70
        : -300);
    const y = drop?.y ?? 0;
    if (spec.category === "accessory") {
      const piece = {
        id,
        kind,
        x: drop?.x ?? 0,
        y: drop?.y ?? 80 + accessories.length * 35,
        angle: 0,
        elevation: buildHeight,
      };
      if (!canPlace(piece)) return;
      changeLayout({ ...layout, accessories: [...accessories, piece] });
      setSelectedId(id);
      notify(`Placed ${spec.label}. Switch to Move pieces to drag it.`);
    } else {
      const hand =
        spec.shape === "crossing"
          ? 1
          : spec.shape === "turnout" && spec.name.includes("left")
            ? -1
            : spec.shape === "turnout" && spec.name.includes("right")
              ? 1
              : bend;
      const base: Track =
        anchor && !drop
          ? attachTrack(kind, hand, anchor, id)
          : {
              id,
              kind,
              x,
              y,
              angle: 0,
              bend: hand,
              elevation: buildHeight,
              endElevation: buildHeight,
            };
      const next = drop ? snapTrack(tracks, base) : base;
      if (spec.shape === "turnout" || spec.shape === "scissors")
        next.switchNumber =
          Math.max(0, ...switches.map((track) => track.switchNumber ?? 0)) + 1;
      if (!canPlace(next)) return;
      const newTracks = [...tracks, next];
      changeLayout({ ...layout, tracks: newTracks });
      setSelectedId(id);
      const end = endpoints(next)[1];
      if (end && !connectedEndpoint(newTracks, id, 1))
        setAnchor({ ...end, trackId: id, end: 1 });
      notify(
        `Added ${spec.label}. ${anchor && !drop ? "Connected to your chosen end." : "Drag it to arrange your railway."}`,
      );
    }
    if (!drop) setViewRevision((v) => v + 1);
  };
  const movePiece = (id: string, x: number, y: number) => {
    const track = tracks.find((t) => t.id === id);
    if (track) {
      const next = snapTrack(
        tracks.filter((t) => t.id !== id),
        { ...track, x, y },
      );
      if (!canPlace(next)) return;
      changeLayout(
        { ...layout, tracks: tracks.map((t) => (t.id === id ? next : t)) },
        true,
      );
    } else {
      const accessory = accessories.find((piece) => piece.id === id);
      if (!accessory || !canPlace({ ...accessory, x, y })) return;
      changeLayout(
        {
          ...layout,
          accessories: accessories.map((p) =>
            p.id === id ? { ...p, x, y } : p,
          ),
        },
        true,
      );
    }
    setSelectedId(id);
  };
  const updateSelection = (patch: {
    angle?: number;
    elevation?: number;
    endElevation?: number;
    switchState?: "straight" | "branch";
  }) => {
    if (patch.switchState && selectedTrack) {
      setSwitchState(selectedTrack.id, patch.switchState);
      return;
    }
    if (selectedTrack) {
      if (!canPlace({ ...selectedTrack, ...patch })) return;
      changeLayout(
        {
          ...layout,
          tracks: tracks.map((t) =>
            t.id === selectedId ? { ...t, ...patch } : t,
          ),
        },
        true,
      );
    } else if (selectedAccessory) {
      if (!canPlace({ ...selectedAccessory, ...patch })) return;
      changeLayout(
        {
          ...layout,
          accessories: accessories.map((p) =>
            p.id === selectedId
              ? {
                  ...p,
                  ...(patch.angle !== undefined ? { angle: patch.angle } : {}),
                  ...(patch.elevation !== undefined
                    ? { elevation: patch.elevation }
                    : {}),
                }
              : p,
          ),
        },
        true,
      );
    }
  };
  const setSwitchState = (id: string, state: "straight" | "branch") => {
    const track = tracks.find((piece) => piece.id === id);
    if (!track || (track.switchState ?? "straight") === state) return;
    if (occupiedFleetTrackIds(tracks, fleetRef.current).has(id)) {
      notify(
        `Switch ${track.switchNumber} is occupied. Move the train clear of the points first.`,
        true,
      );
      return;
    }
    const nextTracks = tracks.map((piece) =>
      piece.id === id ? { ...piece, switchState: state } : piece,
    );
    if (!proposedFleetIsSafe(nextTracks, fleetRef.current)) return;
    rememberCurrentLayout();
    setLayout(snapshotFleetLayout({ ...layout, tracks: nextTracks }, fleetRef.current, selectedTrainIdRef.current));
    notify(
      `Switch ${track.switchNumber}: ${state === "branch" ? "branch" : "straight"} route.`,
    );
  };
  const buildRamp = () => {
    const plan = planRamp({
      anchor: anchor ?? undefined,
      origin: rampOrigin,
      targetHeight: rampTarget,
      maxGradePercent: rampGrade,
      idPrefix: `ramp-${crypto.randomUUID()}`,
      existingAccessories: accessories,
    });
    const invalid = plan.issues.find((issue) => issue.severity === "error");
    if (invalid) {
      notify(invalid.message, true);
      return;
    }
    if (pieceCount + plan.tracks.length + plan.accessories.length > 300) {
      notify(
        "There is not enough room in the 300-piece limit for this ramp.",
        true,
      );
      return;
    }
    const next = {
      ...layout,
      tracks: [...tracks, ...plan.tracks],
      accessories: [...accessories, ...plan.accessories],
    };
    const ids = new Set(
      [...plan.tracks, ...plan.accessories].map((piece) => piece.id),
    );
    const conflict = auditClearances(next).find(
      (issue) =>
        issue.severity === "error" && issue.pieceIds.some((id) => ids.has(id)),
    );
    if (conflict) {
      notify(`Ramp blocked: ${conflict.message}`, true);
      return;
    }
    changeLayout(next);
    const last = plan.tracks.at(-1);
    if (last) {
      setSelectedId(last.id);
      setAnchor({ ...endpoints(last)[1], trackId: last.id, end: 1 });
    }
    setBuildHeight(rampTarget);
    setViewRevision((value) => value + 1);
    notify(
      `Built ${plan.pieceCount} pieces at ${plan.gradePercent.toFixed(1)}%. Check the report for any supports still needed.`,
    );
  };
  const addMatchingPiers = () => {
    if (!selectedTrack) return;
    const additions: PlacedAccessory[] = [];
    for (const end of endpoints(selectedTrack)) {
      const height = end.position.z ?? 0;
      if (
        height <= 0 ||
        accessories.some(
          (piece) =>
            CATALOG.get(piece.kind)?.accessoryType === "pier" &&
            Math.hypot(piece.x - end.position.x, piece.y - end.position.y) <
              0.5,
        )
      )
        continue;
      const support = KATO_CATALOG.find(
        (piece) =>
          piece.accessoryType === "pier" &&
          Math.abs((piece.supportDeckHeight ?? -1) - height) < 0.25,
      );
      if (!support) continue;
      const piece = {
        id: crypto.randomUUID(),
        kind: support.kind,
        x: end.position.x,
        y: end.position.y,
        angle: end.angle,
        elevation: 0,
      };
      if (!canPlace(piece)) return;
      additions.push(piece);
    }
    if (!additions.length) {
      notify(
        "No additional matching catalog piers found. The documented 23-069 assembly supports a 60 mm roadbed; other heights need verified supports.",
        true,
      );
      return;
    }
    if (pieceCount + additions.length > 300) {
      notify("Remove a piece before adding more piers.", true);
      return;
    }
    changeLayout(
      { ...layout, accessories: [...accessories, ...additions] },
      true,
    );
    notify(
      `Added ${additions.length} matching pier${additions.length === 1 ? "" : "s"}.`,
    );
  };
  const exportShoppingReport = () => {
    const quote = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const rows: (string | number)[][] = [
      ["Layout", layout.name],
      ["Review", `${errors.length} errors; ${warnings.length} items to verify`],
      [
        "Quantities",
        "Individual placed pieces, not retail packs. Confirm packs and physical fit with the shop.",
      ],
      [
        "Hardware",
        "The switch desk is virtual. Physical controllers, wiring, power supplies, and extra adapters are not included.",
      ],
      [],
      ["Kato product", "Placed model", "Pieces", "Geometry", "Source", "Notes"],
      ...shoppingRows.map((row) => [
        row.sku,
        row.name,
        row.quantity,
        row.verified
          ? "Catalog dimensions"
          : "Approximate model: verify physical geometry",
        row.sourceUrl,
        row.notes.join(" "),
      ]),
      [],
      ["Layout issues"],
      ...issues.map((issue) => [
        issue.severity,
        issue.message,
        issue.detail ?? "",
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((row) => row.map(quote).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "kato-layout-shopping-review.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(
      "Saved the parts and geometry review. Quantities are pieces, not packs.",
    );
  };
  const removeSelected = () => {
    if (!selection) return;
    if (!changeLayout({
      ...layout,
      tracks: tracks.filter((t) => t.id !== selectedId),
      accessories: accessories.filter((p) => p.id !== selectedId),
    })) return;
    notify("Piece removed. Undo brings it back.");
  };
  const toggleRunning = () => {
    const train = fleetRef.current.find((entry) => entry.id === selectedTrainIdRef.current);
    if (train?.position && tracks.length && !placementTrainId) setRunning(!train.running);
  };
  const reverse = () => {
    const train = fleetRef.current.find((entry) => entry.id === selectedTrainIdRef.current);
    if (!train?.position || placementTrainId) return;
    if (train.running && train.actualSpeed > 0) {
      updateControlledTrain((entry) => ({ ...entry, reverseRequested: true, status: "braking" }));
      notify(`${train.name} is stopping before reversing.`);
    } else {
      updateControlledTrain((entry) => ({
        ...pausedTrain(entry), position: entry.position ? { ...entry.position, direction: entry.position.direction === 1 ? -1 : 1 } : null,
        cabForward: !entry.cabForward, lapProgress: 0,
      }), true);
      notify(`${train.name} is facing its next journey the other way.`);
    }
  };
  const horn = async () => {
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      await context.resume();
      [392, 523.25].forEach((frequency) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.06, now + 0.03);
        gain.gain.setValueAtTime(0.06, now + 0.35);
        gain.gain.linearRampToValueAtTime(0, now + 0.65);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.7);
      });
      notify("Toot toot! 🚃");
    } catch {
      notify("Sound is unavailable in this browser. Your train can still run.");
    }
  };
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let accumulated = 0;
    const tick = (time: number) => {
      accumulated += Math.min(time - last, 100);
      last = time;
      if (accumulated >= 32) {
        const previous = fleetRef.current;
        if (previous.some((train) => train.running || train.reverseRequested)) {
          const next = stepFleet(layoutRef.current.tracks, previous, accumulated / 1000);
          const stopped = next.some((train) => !train.running && previous.find((entry) => entry.id === train.id)?.running);
          commitFleet(next, stopped);
          const blocked = next.find((train) => train.stopReason && previous.find((entry) => entry.id === train.id)?.stopReason !== train.stopReason);
          if (blocked) notify(`${blocked.name}: ${blocked.stopReason}`);
        }
        accumulated = 0;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const persistProgress = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          ...currentLayoutSnapshot(),
          ...(activeSavedDesignId === null ? {} : { savedDesignId: activeSavedDesignId }),
        }));
        setSaved(true);
      } catch { setSaved(false); }
    };
    const interval = window.setInterval(() => {
      if (fleetRef.current.some((train) => train.running)) persistProgress();
    }, 2000);
    window.addEventListener("pagehide", persistProgress);
    return () => { window.clearInterval(interval); window.removeEventListener("pagehide", persistProgress); };
  }, [activeSavedDesignId]);
  const actionsRef = useRef({ toggleRunning, reverse, undo, removeSelected });
  actionsRef.current = { toggleRunning, reverse, undo, removeSelected };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        modal ||
        (event.target instanceof HTMLElement &&
          (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
            event.target.isContentEditable))
      )
        return;
      if (event.code === "Space") {
        if (
          event.target instanceof Element &&
          event.target.closest('button, [role="button"]')
        )
          return;
        event.preventDefault();
        actionsRef.current.toggleRunning();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        actionsRef.current.undo();
      } else if (
        event.key.toLowerCase() === "r" &&
        !event.metaKey &&
        !event.ctrlKey
      )
        actionsRef.current.reverse();
      else if (event.key === "Escape") setPlacementTrainId(null);
      else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        actionsRef.current.removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      void audioRef.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!modal) return;
    pauseAllTrains();
    const oldFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled])",
        ) ?? [],
      );
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
      if (event.key === "Tab") {
        const list = controls();
        const first = list[0];
        const last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      oldFocus?.focus();
    };
  }, [modal]);
  const chooseLayout = (preset: LayoutPreset) => {
    if (!changeLayout(createLayout(preset), false, true)) return;
    setActiveSavedDesignId(null);
    setLayoutRevision((value) => value + 1);
    setBuildHeight(preset === "viaduct" ? 60 : 0);
    setCameraPreset("perspective");
    setViewRevision((v) => v + 1);
    setModal(null);
    notify(
      preset === "empty"
        ? "Drag a piece from your track box to start a new world."
        : "Your 3D railway is ready. All aboard!",
    );
  };
  const changeTrainConfiguration = (type: TrainType, count: number) => {
    const train = fleetRef.current.find((entry) => entry.id === selectedTrainIdRef.current);
    if (!train || (train.type === type && train.carCount === count) || !Number.isInteger(count) || count < 3 || count > 11) return;
    let name = train.name;
    if (train.type !== type) {
      let suffix = 1;
      const otherNames = new Set(fleetRef.current.filter((entry) => entry.id !== train.id).map((entry) => entry.name));
      while (otherNames.has(`${getTrainSpec(type).name} ${suffix}`)) suffix += 1;
      name = `${getTrainSpec(type).name} ${suffix}`;
    }
    const candidate = {
      ...pausedTrain(train), type, carCount: count, name,
      requestedSpeed: clampTrainSpeed(type, train.requestedSpeed),
    };
    if (candidate.position) {
      const validation = validateTrainPlacement(tracks, candidate, fleetRef.current, {
        allowPartial: train.legacyStart === true && fleetRef.current.filter((entry) => entry.position).length === 1,
      });
      if (!validation.allowed) { notify(`Cannot change this train here: ${validation.reason} Place it on a longer, clear track first.`, true); return; }
    }
    rememberCurrentLayout();
    commitFleet(fleetRef.current.map((entry) => entry.id === train.id ? candidate : entry), true);
    notify(`${candidate.name} has ${count} cars. Your other trains are unchanged.`);
  };
  const chooseTrain = (type: TrainType) => changeTrainConfiguration(type, fleetRef.current.find((entry) => entry.id === selectedTrainIdRef.current)?.carCount ?? carCount);
  const changeTrainCarCount = (count: number) => changeTrainConfiguration(fleetRef.current.find((entry) => entry.id === selectedTrainIdRef.current)?.type ?? trainType, count);
  const saveDesign = (name: string, asCopy = false): boolean => {
    try {
      // Refresh before writing in case another tab has saved or deleted a design.
      const current = readSavedDesigns();
      if (current.unavailable) {
        throw new Error("Your design was not saved. Enable browser storage and reload, or download a backup.");
      }
      const result = saveDesignSnapshot(current.library, currentLayoutSnapshot(), name, activeSavedDesignId, asCopy);
      persistSavedDesigns(result.library, current.recoveryRaw);
      setDesignLibrary({ library: result.library, recoveryRaw: null, error: null, unavailable: false });
      setSavedDesignsError(null);
      setActiveSavedDesignId(result.design.id);
      setLayout(parseLayout(result.design.layout));
      notify(`Saved ${result.design.name}. Find it in Layouts → Your saved layouts.`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Your design could not be saved.";
      setSavedDesignsError(message);
      notify(message, true);
      return false;
    }
  };
  const openSavedDesign = (id: string): void => {
    const design = savedDesigns.find((entry) => entry.id === id);
    if (!design) {
      notify("This saved design is no longer available.", true);
      return;
    }
    if (!changeLayout(parseLayout(design.layout), false, true)) return;
    setActiveSavedDesignId(id);
    setLayoutRevision((value) => value + 1);
    setBuildHeight(0);
    setCameraPreset("perspective");
    setViewRevision((value) => value + 1);
    setModal(null);
    notify(`Opened ${design.name}. All aboard!`);
  };
  const deleteSavedDesign = (id: string): boolean => {
    try {
      const current = readSavedDesigns();
      if (current.unavailable) throw new Error("This saved design could not be deleted. Enable browser storage and reload.");
      const next = removeDesignSnapshot(current.library, id);
      if (next === current.library) {
        setDesignLibrary(current);
        setSavedDesignsError(current.error);
        if (activeSavedDesignId === id) setActiveSavedDesignId(null);
        return true;
      }
      persistSavedDesigns(next, current.recoveryRaw);
      setDesignLibrary({ library: next, recoveryRaw: null, error: null, unavailable: false });
      setSavedDesignsError(null);
      if (activeSavedDesignId === id) setActiveSavedDesignId(null);
      notify("Saved design deleted. Your open railway is still here.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "This saved design could not be deleted.";
      setSavedDesignsError(message);
      notify(message, true);
      return false;
    }
  };
  const exportLayout = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(currentLayoutSnapshot(), null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${layout.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "my-railway"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Saved a copy of your 3D railway.");
  };
  const importLayout = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 500000)
        throw new Error(
          "This file is too large. Choose a Little Railways layout.",
        );
      const next = parseLayout(JSON.parse(await file.text()));
      if (!changeLayout(next, false, true)) return;
      setActiveSavedDesignId(null);
      setLayoutRevision((value) => value + 1);
      setCameraPreset("perspective");
      setViewRevision((v) => v + 1);
      setModal(null);
      notify(`Welcome back to ${next.name}!`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "We could not open that layout.",
      );
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const grade = selectedTrack ? trackGradePercent(selectedTrack) : 0;
  return {
    layout,
    trainType,
    trainSpec,
    carCount,
    fleet,
    selectedTrainId,
    selectTrain,
    addTrain,
    removeTrain,
    pauseAllTrains,
    placementTrainId,
    placingTrain: placingTrain ? trainSnapshot(placingTrain) : null,
    placementDirection,
    setPlacementDirection,
    beginTrainPlacement,
    cancelTrainPlacement,
    placeTrain,
    changeTrainCarCount,
    tracks,
    accessories,
    history,
    selectedId,
    setSelectedId,
    anchor,
    setAnchor,
    category,
    setCategory,
    search,
    setSearch,
    bend,
    setBend,
    buildHeight,
    setBuildHeight,
    mode,
    setMode,
    cameraPreset,
    setCameraPreset,
    viewRevision,
    layoutRevision,
    setViewRevision,
    ready,
    setReady,
    running,
    setRunning,
    speed,
    setSpeed,
    position,
    cabForward,
    modal,
    setModal,
    toast,
    toastError,
    switches,
    issues,
    errors,
    warnings,
    rampTarget,
    setRampTarget,
    rampGrade,
    setRampGrade,
    rampPlan,
    shoppingRows,
    saved,
    savedDesigns,
    savedDesignsError,
    activeSavedDesignId,
    fileInput,
    selection,
    selectedTrack,
    selectedSpec,
    routeLength,
    ends,
    totalLength,
    pieceCount,
    filtered,
    grade,
    notify,
    changeLayout,
    undo,
    addPiece,
    movePiece,
    updateSelection,
    setSwitchState,
    buildRamp,
    addMatchingPiers,
    exportShoppingReport,
    removeSelected,
    toggleRunning,
    reverse,
    horn,
    chooseLayout,
    chooseTrain,
    saveDesign,
    openSavedDesign,
    deleteSavedDesign,
    exportLayout,
    importLayout,
  };
}
