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
import type { LayoutData, LayoutPreset } from "./layout";
import { TRAIN_SCALE } from "./trainModel";
import { advanceConsist } from "./trainMotion";

export const CATALOG = new Map(
  KATO_CATALOG.map((piece) => [piece.kind, piece]),
);
type Anchor = Endpoint & { trackId: string; end: number };
export type Modal = "layouts" | "help" | "references" | null;
const initialTrain = (tracks: Track[]): TrainPosition => {
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
    distance: first ? Math.min(110, trackLength(first, route)) : 0,
    direction: 1,
    route,
    laps: 0,
  };
};

export function useRailway() {
  const [layout, setLayout] = useState<LayoutData>(loadLayout);
  const { tracks, accessories } = layout;
  const [history, setHistory] = useState<LayoutData[]>([]);
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
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(65);
  const [position, setPosition] = useState<TrainPosition>(() =>
    initialTrain(layout.tracks),
  );
  const positionRef = useRef(position);
  const lapProgressRef = useRef(0);
  const [cabForward, setCabForward] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const selectedTrack = tracks.find((t) => t.id === selectedId);
  const selectedAccessory = accessories.find((p) => p.id === selectedId);
  const selection = selectedTrack ?? selectedAccessory;
  const selectedSpec = selection ? CATALOG.get(selection.kind) : undefined;
  const routeLength = useMemo(
    () => closedRouteLength(tracks, position),
    [tracks, position.trackId, position.direction, position.route],
  );
  const routeLengthRef = useRef(routeLength);
  routeLengthRef.current = routeLength;
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

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  };
  const resetTrain = (nextTracks: Track[]) => {
    const next = initialTrain(nextTracks);
    positionRef.current = next;
    setPosition(next);
    setRunning(false);
    lapProgressRef.current = 0;
    setCabForward(true);
  };
  const changeLayout = (next: LayoutData, preserveSelection = false) => {
    setHistory((previous) => [...previous.slice(-49), layout]);
    setLayout(next);
    resetTrain(next.tracks);
    if (!preserveSelection) setSelectedId(null);
    setAnchor(null);
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setLayout(previous);
    resetTrain(previous.tracks);
    setSelectedId(null);
    setAnchor(null);
    notify("Back one step. Keep building!");
  };
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [layout]);
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
      changeLayout(
        { ...layout, tracks: tracks.map((t) => (t.id === id ? next : t)) },
        true,
      );
    } else
      changeLayout(
        {
          ...layout,
          accessories: accessories.map((p) =>
            p.id === id ? { ...p, x, y } : p,
          ),
        },
        true,
      );
    setSelectedId(id);
  };
  const updateSelection = (patch: {
    angle?: number;
    elevation?: number;
    endElevation?: number;
    switchState?: "straight" | "branch";
  }) => {
    if (selectedTrack)
      changeLayout(
        {
          ...layout,
          tracks: tracks.map((t) =>
            t.id === selectedId ? { ...t, ...patch } : t,
          ),
        },
        true,
      );
    else if (selectedAccessory)
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
  };
  const removeSelected = () => {
    if (!selection) return;
    changeLayout({
      ...layout,
      tracks: tracks.filter((t) => t.id !== selectedId),
      accessories: accessories.filter((p) => p.id !== selectedId),
    });
    notify("Piece removed. Undo brings it back.");
  };
  const toggleRunning = () => {
    if (tracks.length) setRunning((value) => !value);
  };
  const reverse = () => {
    const next: TrainPosition = {
      ...positionRef.current,
      direction: positionRef.current.direction === 1 ? -1 : 1,
    };
    positionRef.current = next;
    setPosition(next);
    setCabForward((v) => !v);
    lapProgressRef.current = 0;
    notify("Your Yamanote train is travelling the other way.");
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
    if (!running || !tracks.length) return;
    let frame = 0;
    let last = performance.now();
    let accumulated = 0;
    const tick = (time: number) => {
      accumulated += Math.min(time - last, 100);
      last = time;
      if (accumulated >= 32) {
        const distance =
          ((((accumulated / 1000) * speed) / 3.6) * 1000) / TRAIN_SCALE;
        const previous = positionRef.current;
        const result = advanceConsist(
          tracks,
          previous,
          distance,
          cabForward,
          layout.carCount,
        );
        accumulated = 0;
        let laps = 0;
        const circumference = routeLengthRef.current;
        if (circumference) {
          lapProgressRef.current += distance;
          laps = Math.floor(lapProgressRef.current / circumference);
          lapProgressRef.current %= circumference;
        }
        result.position.laps = previous.laps + laps;
        positionRef.current = result.position;
        setPosition(result.position);
        if (result.stopped) {
          setRunning(false);
          notify(
            "End of the line! Check connectors and turnout settings, or reverse.",
          );
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, speed, tracks, cabForward, layout.carCount]);
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
    setRunning(false);
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
    changeLayout(createLayout(preset));
    setBuildHeight(preset === "viaduct" ? 80 : 0);
    setCameraPreset("perspective");
    setViewRevision((v) => v + 1);
    setModal(null);
    notify(
      preset === "empty"
        ? "Drag a piece from your track box to start a new world."
        : "Your 3D railway is ready. All aboard!",
    );
  };
  const exportLayout = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" }),
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
      changeLayout(next);
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
  const grade = selectedTrack
    ? (Math.abs(
        (selectedTrack.endElevation ?? selectedTrack.elevation ?? 0) -
          (selectedTrack.elevation ?? 0),
      ) /
        trackLength(selectedTrack)) *
      100
    : 0;
  return {
    layout,
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
    saved,
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
    removeSelected,
    toggleRunning,
    reverse,
    horn,
    chooseLayout,
    exportLayout,
    importLayout,
  };
}
