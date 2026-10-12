import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inspectTrackFeasibility } from "./trackFeasibility";
import type { LayoutData, PlacedAccessory } from "./layout";
import type { Track } from "./track";
import type {
  TrackEndRef,
  TrackHelperPreview,
  TrackHelperResult,
  TrackHelperWorkerRequest,
  TrackHelperWorkerResponse,
} from "./trackHelperTypes";
import type { useRailway } from "./useRailway";

type Railway = ReturnType<typeof useRailway>;
type CheckedLayout = {
  tracks: Track[];
  accessories: PlacedAccessory[];
  trainConfiguration: string;
  first: string;
  second: string;
  result: TrackHelperResult;
};

/** The values identify connectors; their human-readable labels never expose IDs. */
export function trackEndValue(end: TrackEndRef): string {
  return JSON.stringify([end.trackId, end.end]);
}

export function useTrackHelper(h: Railway) {
  const [expanded, setExpanded] = useState(false);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [working, setWorking] = useState(false);
  const [checked, setChecked] = useState<CheckedLayout | null>(null);
  const [solutionIndex, setSolutionIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  // Model and formation edits affect radius and clearance eligibility. Running
  // positions are deliberately excluded: application rechecks the fresh fleet,
  // and ordinary simulation frames must not invalidate a checked suggestion.
  const trainConfiguration = JSON.stringify(h.fleet.length
    ? h.fleet.map((train) => [train.id, train.type, train.carCount])
    : [[h.layout.trainType ?? "e235", h.layout.carCount]]);
  const currentRef = useRef({ h, expanded, first, second, trainConfiguration });
  currentRef.current = { h, expanded, first, second, trainConfiguration };

  const ends = useMemo(() => h.ends.map((end, index) => ({
    value: trackEndValue({ trackId: end.track.id, end: end.end }),
    ref: { trackId: end.track.id, end: end.end },
    track: end.track,
    height: end.position.z ?? 0,
    number: index + 1,
  })), [h.ends]);
  const selectedEnds = useMemo<[TrackEndRef, TrackEndRef] | null>(() => {
    const a = ends.find((end) => end.value === first);
    const b = ends.find((end) => end.value === second);
    return a && b && a.value !== b.value ? [a.ref, b.ref] : null;
  }, [ends, first, second]);
  const inspection = useMemo(() => selectedEnds
    ? inspectTrackFeasibility(h.layout, selectedEnds)
    : null, [h.tracks, h.accessories, selectedEnds]);

  const terminate = useCallback(() => {
    requestId.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  // Opening the tool on a single unfinished circuit needs no connector picking.
  useEffect(() => {
    const values = ends.map((end) => end.value);
    const nextFirst = values.includes(first) ? first : values.length === 2 ? values[0] : "";
    const nextSecond = values.includes(second) && second !== nextFirst
      ? second : values.length === 2 ? values.find((value) => value !== nextFirst) ?? "" : "";
    setFirst(nextFirst);
    setSecond(nextSecond);
  }, [ends]);

  // A result belongs to its exact geometry and selected ends. Changing either
  // cancels background work rather than allowing a stale preview to be applied.
  useEffect(() => {
    terminate();
    setWorking(false);
    setChecked(null);
    setSolutionIndex(0);
    setNotice(null);
  }, [h.tracks, h.accessories, trainConfiguration, first, second, expanded, h.couplingBusy, terminate]);
  useEffect(() => () => terminate(), [terminate]);

  const isCurrent = checked && expanded && !h.couplingBusy
    && checked.tracks === h.tracks && checked.accessories === h.accessories
    && checked.trainConfiguration === trainConfiguration
    && checked.first === first && checked.second === second;
  const result = isCurrent ? checked.result : null;
  const solution = result?.solutions[solutionIndex] ?? null;
  // Scene3D rebuilds its overlay when this identity changes. Preserve it across
  // simulation renders so labels, materials, and geometry are only recreated
  // when the selected gap or suggested section actually changes.
  const preview = useMemo<TrackHelperPreview | null>(() => expanded && !h.couplingBusy && selectedEnds
    ? { ends: selectedEnds, tracks: solution?.tracks ?? [], removeIds: solution?.removeIds ?? [] }
    : null, [expanded, h.couplingBusy, selectedEnds, solution]);

  const check = () => {
    if (!expanded || h.couplingBusy || !selectedEnds || !inspection?.eligible || working) return;
    terminate();
    setChecked(null);
    setSolutionIndex(0);
    setNotice(null);
    const id = requestId.current;
    const snapshot: LayoutData = h.layout;
    const selectedFirst = first, selectedSecond = second;
    const checkedTrainConfiguration = trainConfiguration;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./trackFeasibility.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      setWorking(true);
      const stillCurrent = () => {
        const current = currentRef.current;
        return workerRef.current === worker && requestId.current === id
          && current.expanded && !current.h.couplingBusy
          && current.h.tracks === snapshot.tracks && current.h.accessories === snapshot.accessories
          && current.trainConfiguration === checkedTrainConfiguration
          && current.first === selectedFirst && current.second === selectedSecond;
      };
      const finishError = () => {
        if (!stillCurrent()) return;
        terminate();
        setWorking(false);
        setNotice("The helper could not finish this check. Please try again.");
      };
      worker.onmessage = (event: MessageEvent<TrackHelperWorkerResponse>) => {
        if (event.data.id !== id || !stillCurrent()) return;
        if ("error" in event.data) { finishError(); return; }
        const result = event.data.result;
        terminate();
        setWorking(false);
        setChecked({ tracks: snapshot.tracks, accessories: snapshot.accessories,
          trainConfiguration: checkedTrainConfiguration, first: selectedFirst, second: selectedSecond, result });
      };
      worker.onerror = finishError;
      worker.onmessageerror = finishError;
      const request: TrackHelperWorkerRequest = {
        id,
        request: { layout: snapshot, ends: selectedEnds,
          protectedTrackIds: h.getHelperProtectedTrackIds() },
      };
      worker.postMessage(request);
    } catch {
      terminate();
      setWorking(false);
      setNotice("The helper could not start this check. Please try again.");
    }
  };

  const cancel = () => {
    terminate();
    setWorking(false);
    setNotice("Check cancelled. You can keep building or try again.");
  };
  const apply = () => {
    if (!isCurrent || !checked || !solution || h.couplingBusy) return;
    if (h.applyTrackHelperSolution(solution, checked.tracks, checked.accessories)) {
      terminate();
      setChecked(null);
      setNotice(null);
    } else {
      setNotice("This suggestion no longer fits your railway. Check again for a fresh suggestion.");
      setChecked(null);
    }
  };

  return {
    expanded, setExpanded, ends, first, setFirst, second, setSecond,
    inspection, working, result, solution, solutionIndex, setSolutionIndex,
    notice, preview, check, cancel, apply,
  };
}

export type TrackHelperController = ReturnType<typeof useTrackHelper>;
