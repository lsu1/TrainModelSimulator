import {
  ArrowDownToLine,
  ArrowLeftRight,
  Eye,
  Layers3,
  Link2,
  Maximize2,
  MousePointer2,
  Move,
  Pause,
  Play,
  Plus,
  TrainFront,
  Trash2,
  Unlink2,
  Volume2,
  Waypoints,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SwitchPanel } from "./BuildTools";
import { MAX_TRAINSETS } from "./fleet";
import type { TrainRuntime } from "./fleet";
import { TRAIN_TYPES, getTrainSpec } from "./trains";
import type { TrainType } from "./trains";
import type { useRailway } from "./useRailway";

type Railway = ReturnType<typeof useRailway>;
const CAR_COUNTS = Array.from({ length: 9 }, (_, index) => index + 3);
const STATUS: Record<TrainRuntime["status"], string> = {
  unplaced: "Unplaced",
  stopped: "Stopped",
  accelerating: "Accelerating",
  moving: "Moving",
  braking: "Braking",
  blocked: "Waiting",
};
const PHASE: Record<string, string> = {
  opening: "Opening noses",
  approaching: "Joining trains",
  locking: "Connecting couplers",
  coupled: "Connected",
  unlocking: "Unlocking couplers",
  separating: "Separating trains",
  closing: "Closing noses",
};

/** All everyday train controls share the same screen as the railway. */
export default function RailwayCockpit({
  h,
  children,
}: {
  h: Railway;
  children: (selectTrain: (id: string) => void) => ReactNode;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const fleetStrip = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const [newTrainType, setNewTrainType] = useState<TrainType>("e5");
  const [newTrainCarCount, setNewTrainCarCount] = useState(3);
  const [partnerId, setPartnerId] = useState("");
  const [switchesOpen, setSwitchesOpen] = useState(true);
  const selected = h.fleet.find((train) => train.id === h.selectedTrainId);
  const creating = (adding || !selected) && !h.couplingBusy && !h.placingTrain;
  const createLocked =
    h.couplingBusy || !!h.placingTrain || h.fleet.length >= MAX_TRAINSETS;
  const selectTrain = (id: string) => {
    setAdding(false);
    h.selectTrain(id);
  };
  const placed = !!selected?.position;
  const moving = !!selected && (selected.running || selected.actualSpeed > 0);
  const movingCount = h.fleet.filter(
    (train) => train.running || train.actualSpeed > 0,
  ).length;
  const coupled = !!h.selectedCoupling;
  const formation = coupled
    ? h.fleet.filter(
        (train) =>
          train.id === h.selectedCoupling!.e6Id ||
          train.id === h.selectedCoupling!.e5Id,
      )
    : [];
  const partner =
    h.couplingPartners.find((train) => train.id === partnerId) ??
    h.couplingPartners.find((train) => train.allowed) ??
    h.couplingPartners[0];
  const phase = PHASE[h.couplingPhase ?? ""] ?? "Preparing trains";
  const showCoupling =
    !creating &&
    ((selected && selected.type !== "e235") || h.couplingBusy || coupled);
  const couplingReason = h.couplingBusy
    ? null
    : coupled
      ? h.couplingReason
      : partner?.reason;
  const notice = creating ? null : (selected?.stopReason ?? couplingReason);

  const revealScreen = () => {
    const element = screen.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    if (box.top < -1 || box.bottom > window.innerHeight + 1)
      element.scrollIntoView({ block: "nearest", behavior: "instant" });
  };
  const operationId = h.couplingOperation?.id,
    operationPaused = h.couplingOperation?.paused;
  useEffect(() => {
    if (operationId && !operationPaused) revealScreen();
  }, [operationId, operationPaused]);

  useEffect(() => {
    setAdding(false);
  }, [
    h.selectedTrainId,
    h.layoutRevision,
    h.fleet.length,
    h.placingTrain?.id,
    h.couplingBusy,
  ]);

  useEffect(() => {
    if (!creating) return;
    const protectDraft = (event: KeyboardEvent) => {
      if (h.modal || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable)
      )
        return;
      if (event.key === "Escape") {
        setAdding(false);
        return;
      }
      // Space still activates focused buttons; global train shortcuts do not
      // operate the previous train while the shared editor shows a new draft.
      const button =
        target instanceof Element && target.closest('button, [role="button"]');
      if (
        (event.code === "Space" && !button) ||
        (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey)
      )
        event.preventDefault();
    };
    window.addEventListener("keydown", protectDraft, true);
    return () => window.removeEventListener("keydown", protectDraft, true);
  }, [creating, h.modal]);

  useEffect(() => {
    const strip = fleetStrip.current;
    if (!strip) return;
    const revealActive = () => {
      const active = Array.from(
        strip.querySelectorAll<HTMLButtonElement>("button"),
      ).find(
        (button) =>
          button.dataset.trainId ===
          (creating ? "__new-train__" : h.selectedTrainId),
      );
      if (!active) return;
      const viewport = strip.getBoundingClientRect(),
        chip = active.getBoundingClientRect();
      // Only the fleet strip moves; selecting a train never scrolls the page.
      if (chip.left < viewport.left)
        strip.scrollLeft += chip.left - viewport.left;
      else if (chip.right > viewport.right)
        strip.scrollLeft += chip.right - viewport.right;
    };
    revealActive();
    const observer = new ResizeObserver(revealActive);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [
    creating,
    h.selectedTrainId,
    h.fleet.length,
    h.carCount,
    h.trainType,
    newTrainType,
    newTrainCarCount,
  ]);

  return (
    <div
      ref={screen}
      className="railway-cockpit scene-wrap"
      role="region"
      aria-label="Railway control screen"
      data-testid="railway-main-screen"
    >
      <section className="cockpit-fleet" aria-label="Your trains">
        <div className="cockpit-train-bar">
          <span className="cockpit-fleet-count" aria-label="Train count">
            <TrainFront size={18} />
            {h.fleet.length} {h.fleet.length === 1 ? "train" : "trains"}
          </span>
          <div
            ref={fleetStrip}
            className="cockpit-fleet-strip"
            role="group"
            aria-label="Select a train to drive"
          >
            {h.fleet.map((train) => {
              const group = h.couplings.find(
                (pair) => pair.e6Id === train.id || pair.e5Id === train.id,
              );
              const total = group
                ? h.fleet
                    .filter(
                      (member) =>
                        member.id === group.e6Id || member.id === group.e5Id,
                    )
                    .reduce((sum, member) => sum + member.carCount, 0)
                : 0;
              return (
                <button
                  key={train.id}
                  className={`fleet-train ${!creating && train.id === h.selectedTrainId ? "selected" : ""}`}
                  aria-label={`Drive ${train.name}`}
                  aria-pressed={!creating && train.id === h.selectedTrainId}
                  title={
                    train.stopReason ??
                    `${train.name} · ${train.carCount} cars · ${STATUS[train.status]}`
                  }
                  disabled={!!h.placingTrain && train.id !== h.placementTrainId}
                  data-train-id={train.id}
                  data-status={train.status}
                  data-train-type={train.type}
                  data-train-speed={train.actualSpeed}
                  onClick={() => selectTrain(train.id)}
                >
                  <span
                    className="fleet-swatch"
                    style={{
                      background: getTrainSpec(train.type).colors.primary,
                    }}
                  />
                  <div>
                    <strong>{train.name}</strong>
                    <span className={`fleet-status ${train.status}`}>
                      <span
                        className={`status-dot ${train.running && train.status !== "blocked" ? "running" : ""}`}
                      />
                      {train.carCount} cars · {STATUS[train.status]}
                      {train.actualSpeed > 0 &&
                        ` · ${Math.round(train.actualSpeed)} km/h`}
                      {group && (
                        <span
                          className="fleet-connected-badge"
                          title={`${total} cars connected`}
                        >
                          <Link2 size={12} />
                          {total}
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
            {creating && (
              <button
                className="fleet-train fleet-draft selected"
                aria-label="Edit new train"
                aria-pressed="true"
                data-train-id="__new-train__"
                onClick={() => setAdding(true)}
              >
                <Plus size={18} />
                <div>
                  <strong>New train</strong>
                  <span>
                    {newTrainCarCount} cars · {getTrainSpec(newTrainType).name}
                  </span>
                </div>
              </button>
            )}
          </div>
          <div
            role="group"
            aria-label="Train creation"
            className={`cockpit-create-actions ${creating ? "cockpit-create-actions--draft" : ""}`}
          >
            {creating ? (
              <>
                {selected && (
                  <button
                    className="button secondary"
                    aria-label="Cancel new train"
                    onClick={() => setAdding(false)}
                  >
                    <X size={17} /> Cancel
                  </button>
                )}
                <button
                  className="button primary"
                  aria-label="Add train"
                  title={
                    h.fleet.length >= MAX_TRAINSETS
                      ? "All train spaces are filled"
                      : "Add this new train"
                  }
                  disabled={createLocked}
                  onClick={() => {
                    if (!createLocked)
                      h.addTrain(newTrainType, newTrainCarCount);
                  }}
                >
                  <Plus size={17} /> Add train
                </button>
              </>
            ) : (
              <button
                className="button primary"
                aria-label="Prepare a new train"
                title={
                  h.fleet.length >= MAX_TRAINSETS
                    ? "All train spaces are filled"
                    : "Choose a new train in the shared editor"
                }
                disabled={createLocked}
                onClick={() => setAdding(true)}
              >
                <Plus size={17} /> New train
              </button>
            )}
          </div>

          <label className="cockpit-model-select">
            <span className="visually-hidden">Train model</span>
            <select
              aria-label={creating ? "New train model" : "Train"}
              value={creating ? newTrainType : h.trainType}
              disabled={
                creating
                  ? createLocked
                  : !selected ||
                    moving ||
                    !!h.placingTrain ||
                    h.couplingBusy ||
                    coupled
              }
              onChange={(event) =>
                creating
                  ? setNewTrainType(event.target.value as TrainType)
                  : h.chooseTrain(event.target.value as TrainType)
              }
            >
              {TRAIN_TYPES.map((type) => (
                <option key={type} value={type}>
                  {getTrainSpec(type).name}
                </option>
              ))}
            </select>
          </label>
          <label className="car-select">
            Cars
            <select
              aria-label={creating ? "New train car count" : "Train car count"}
              value={creating ? newTrainCarCount : h.carCount}
              disabled={
                creating
                  ? createLocked
                  : !selected || moving || !!h.placingTrain || h.couplingBusy
              }
              onChange={(event) =>
                creating
                  ? setNewTrainCarCount(Number(event.target.value))
                  : h.changeTrainCarCount(Number(event.target.value))
              }
            >
              {CAR_COUNTS.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <div className="cockpit-train-actions">
            <button
              className="icon-button"
              aria-label="Place selected train"
              title={placed ? "Move train" : "Place train"}
              disabled={
                creating ||
                !selected ||
                moving ||
                !h.tracks.length ||
                !!h.placingTrain ||
                h.couplingBusy ||
                coupled
              }
              onClick={() => selected && h.beginTrainPlacement(selected.id)}
            >
              <MousePointer2 size={18} />
            </button>
            <button
              className="icon-button remove-train-button"
              aria-label="Remove selected train"
              title="Remove selected train"
              disabled={
                creating ||
                !selected ||
                !!h.placingTrain ||
                h.couplingBusy ||
                coupled
              }
              onClick={() => selected && h.removeTrain(selected.id)}
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </section>

      <div className="cockpit-main">
        <div className="cockpit-stage" data-testid="railway-canvas-stage">
          {children(selectTrain)}
          {!h.ready && (
            <div className="scene-loading">
              <Layers3 size={32} />
              <span>Opening your little world…</span>
            </div>
          )}
          <div className="scene-hud">
            <span className={`status-dot ${movingCount ? "running" : ""}`} />
            {h.couplingBusy
              ? `${phase}${operationPaused ? " · Paused" : "…"}`
              : movingCount
                ? `${movingCount} ${movingCount === 1 ? "train" : "trains"} running`
                : selected && !placed
                  ? `${selected.name} · Unplaced`
                  : h.routeLength
                    ? "Connected loop · ready to ride"
                    : h.tracks.length
                      ? h.ends.length
                        ? `${h.ends.length} open connectors`
                        : "Check turnout routes"
                      : "Build your railway"}
          </div>
          <div
            className="scene-controls"
            role="group"
            aria-label="3D interaction mode"
          >
            <button
              className={h.mode === "orbit" ? "active" : ""}
              aria-pressed={h.mode === "orbit"}
              onClick={() => h.setMode("orbit")}
            >
              <Eye size={16} />
              Look around
            </button>
            <button
              className={h.mode === "move" ? "active" : ""}
              aria-pressed={h.mode === "move"}
              disabled={h.couplingBusy}
              onClick={() => h.setMode("move")}
            >
              <Move size={16} />
              Move pieces
            </button>
          </div>
          {h.placingTrain && (
            <div className="train-placement-banner" role="status">
              <strong>Place {h.placingTrain.name}</strong>
              <button
                className="icon-button"
                aria-label="Reverse placement direction"
                title="Reverse placement direction"
                onClick={() =>
                  h.setPlacementDirection(h.placementDirection === 1 ? -1 : 1)
                }
              >
                <ArrowLeftRight size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Cancel train placement"
                title="Cancel train placement"
                onClick={h.cancelTrainPlacement}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className="view-controls" role="group" aria-label="Camera views">
            {(
              [
                { key: "perspective", label: "3D view", icon: Layers3 },
                { key: "top", label: "Top view", icon: ArrowDownToLine },
                { key: "ride", label: "Train view", icon: TrainFront },
              ] as const
            ).map((view) => (
              <button
                key={view.key}
                className={`camera-button ${h.cameraPreset === view.key ? "active" : ""}`}
                aria-label={view.label}
                title={view.label}
                aria-pressed={h.cameraPreset === view.key}
                disabled={view.key === "ride" && !placed}
                onClick={() => h.setCameraPreset(view.key)}
              >
                <view.icon size={17} />
                <span>{view.label}</span>
              </button>
            ))}
            <button
              className="camera-button"
              aria-label="Fit railway to view"
              title="Fit railway to view"
              onClick={() => {
                h.setCameraPreset("perspective");
                h.setViewRevision((value) => value + 1);
              }}
            >
              <Maximize2 size={18} />
            </button>
            <button
              className={`camera-button cockpit-sidebar-toggle ${switchesOpen && h.switches.length ? "active" : ""}`}
              aria-label="Toggle switch controls"
              title="Switch controls"
              aria-expanded={!!h.switches.length && switchesOpen}
              aria-controls="railway-switch-drawer"
              disabled={!h.switches.length}
              onClick={() => setSwitchesOpen((value) => !value)}
            >
              <Waypoints size={18} />
              <span>{h.switches.length}</span>
            </button>
          </div>
        </div>
        {!!h.switches.length && switchesOpen && (
          <aside className="cockpit-switch-drawer" id="railway-switch-drawer">
            <SwitchPanel h={h} compact />
          </aside>
        )}
      </div>

      <div className="cockpit-drive-dock" data-testid="railway-driving-dock">
        <div
          className="train-controls"
          role="group"
          aria-label="Driving controls"
        >
          <button
            className={`play-button ${h.running ? "playing" : ""}`}
            aria-label={h.running ? "Pause train" : "Run train"}
            title={h.running ? "Pause train" : "Run train"}
            disabled={creating || !placed || !!h.placingTrain || h.couplingBusy}
            onClick={h.toggleRunning}
          >
            {h.running ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play size={22} fill="currentColor" />
            )}
          </button>
          <div className="speed-control">
            <div className="speed-heading">
              <label htmlFor="train-speed">Speed</label>
              <span>
                {h.speed}
                <small> km/h</small>
              </span>
            </div>
            <input
              id="train-speed"
              aria-label="Train speed"
              title={h.trainSpec.speedNote}
              type="range"
              min="5"
              max={h.trainSpec.maxServiceSpeed}
              step="5"
              value={h.speed}
              disabled={
                creating || !selected || !!h.placingTrain || h.couplingBusy
              }
              onChange={(event) => h.setSpeed(Number(event.target.value))}
            />
            <div className="speed-labels">
              <span>Max {h.trainSpec.maxServiceSpeed} km/h</span>
            </div>
          </div>
          <button
            className="icon-button direction-button"
            aria-label="Reverse train direction"
            title="Reverse train direction"
            disabled={creating || !placed || !!h.placingTrain || h.couplingBusy}
            onClick={h.reverse}
          >
            <ArrowLeftRight size={21} />
          </button>
          <button
            className="icon-button direction-button"
            aria-label="Sound train horn"
            title="Sound train horn"
            disabled={creating || !selected}
            onClick={() => void h.horn()}
          >
            <Volume2 size={21} />
          </button>
        </div>
        {showCoupling && (
          <section className="cockpit-coupling" aria-label="Nose coupling">
            <div className="cockpit-coupling-actions">
              {h.couplingBusy ? (
                <span
                  className="cockpit-coupling-status"
                  role="status"
                  aria-live="polite"
                >
                  {phase}
                  {operationPaused ? " · Paused" : "…"}
                </span>
              ) : coupled ? (
                <span className="coupling-formation-badge">
                  <Link2 size={13} />
                  {formation
                    .map((train) => train.type.toUpperCase())
                    .join(" + ")}{" "}
                  · {formation.reduce((sum, train) => sum + train.carCount, 0)}{" "}
                  cars
                </span>
              ) : (
                <label className="coupling-partner-select">
                  <span className="visually-hidden">Join with</span>
                  <select
                    aria-label="Coupling partner"
                    value={partner?.id ?? ""}
                    disabled={!h.couplingPartners.length || !!h.placingTrain}
                    onChange={(event) => setPartnerId(event.target.value)}
                  >
                    {!h.couplingPartners.length && (
                      <option value="">Choose a partner</option>
                    )}
                    {h.couplingPartners.map((train) => (
                      <option key={train.id} value={train.id}>
                        {train.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {h.couplingBusy ? (
                <button
                  className="icon-button"
                  aria-label={
                    operationPaused ? "Continue coupling" : "Pause coupling"
                  }
                  title={
                    operationPaused ? "Continue coupling" : "Pause coupling"
                  }
                  onClick={operationPaused ? h.resumeCoupling : h.pauseCoupling}
                >
                  {operationPaused ? <Play size={18} /> : <Pause size={18} />}
                </button>
              ) : coupled ? (
                <button
                  className="icon-button"
                  aria-label="Decouple trains"
                  aria-describedby={
                    couplingReason ? "coupling-guidance" : undefined
                  }
                  title={couplingReason ?? "Decouple trains"}
                  disabled={moving || !!h.couplingReason || !!h.placingTrain}
                  onClick={h.decoupleTrains}
                >
                  <Unlink2 size={20} />
                </button>
              ) : (
                <button
                  className="icon-button cockpit-join"
                  aria-label="Couple trains"
                  aria-describedby={
                    couplingReason ? "coupling-guidance" : undefined
                  }
                  title={partner?.reason ?? "Couple trains"}
                  disabled={!partner?.allowed || moving || !!h.placingTrain}
                  onClick={() => partner && h.coupleTrains(partner.id)}
                >
                  <Link2 size={20} />
                </button>
              )}
              <button
                className={`icon-button coupling-view-button ${h.cameraPreset === "coupling" ? "active" : ""}`}
                aria-label="Nose view"
                title="Nose view"
                aria-pressed={h.cameraPreset === "coupling"}
                disabled={!h.couplingBusy && !coupled}
                onClick={() => {
                  h.setCameraPreset("coupling");
                  h.setViewRevision((value) => value + 1);
                  revealScreen();
                }}
              >
                <Eye size={20} />
              </button>
            </div>
          </section>
        )}
        {notice && (
          <div className="cockpit-notice" id="coupling-guidance" title={notice}>
            {notice}
          </div>
        )}
      </div>
    </div>
  );
}
