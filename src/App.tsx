import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  FolderOpen,
  Layers3,
  Lightbulb,
  Link2,
  Mountain,
  Move,
  Play,
  Plus,
  RotateCcw,
  Route,
  Save,
  Search,
  TrainFront,
  Trash2,
  Undo2,
  Waypoints,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Scene3D from "./Scene3D";
import RailwayCockpit from "./RailwayCockpit";
import { KATO_CATALOG, CATALOG_SOURCES } from "./catalog";
import type { CatalogCategory, CatalogItem } from "./catalogTypes";
import { CATALOG, useRailway } from "./useRailway";
import { TRAIN_TYPES, getTrainSpec } from "./trains";
import type { TrainType } from "./trains";
import type { LayoutData } from "./layout";
import {
  CheckSummary,
  RampBuilder,
  ShoppingReview,
} from "./BuildTools";

const CATEGORIES: {
  key: CatalogCategory;
  label: string;
  icon: typeof Route;
}[] = [
  { key: "straight", label: "Straights", icon: Route },
  { key: "curved", label: "Curves", icon: RotateCcw },
  { key: "turnout", label: "Turnouts", icon: Waypoints },
  { key: "crossing", label: "Crossings", icon: Plus },
  { key: "double", label: "Double", icon: Layers3 },
  { key: "viaduct", label: "Viaducts", icon: ArrowUpFromLine },
  { key: "bridge", label: "Bridges", icon: Mountain },
  { key: "accessory", label: "Scenery", icon: Building2 },
];
const TRAIN_DESCRIPTIONS: Record<TrainType, string> = {
  e235: "Stainless steel and lime green",
  e5: "Green, pink stripe, and an extra-long nose",
  e6: "Red and silver with a pointed nose",
  e7: "Blue and white with a copper stripe",
};
type ShinkansenType = Exclude<TrainType, "e235">;
const SHINKANSEN_TYPES: readonly ShinkansenType[] = ["e5", "e6", "e7"];
const PLAY_CAR_COUNTS = Array.from({ length: 9 }, (_, index) => index + 3);
function savedTrainSummary(layout: LayoutData): string {
  if (!layout.trains) {
    return `${getTrainSpec(layout.trainType).name} · ${layout.carCount} cars`;
  }
  if (!layout.trains.length) return "No trains yet";
  return `${layout.trains.length} ${layout.trains.length === 1 ? "train" : "trains"} · ${layout.trains
    .map((train) => `${getTrainSpec(train.type).name} (${train.carCount} cars)`)
    .join(" · ")}`;
}
function PieceIllustration({ piece }: { piece: CatalogItem }) {
  const curved = piece.shape.toLowerCase().includes("curve");
  const double = piece.shape.startsWith("double") || piece.shape === "scissors";
  const d = curved ? "M19 13 Q19 49 88 49" : "M15 33 H96";
  if (piece.shape === "accessory") {
    const Icon =
      piece.accessoryType === "catenary"
        ? Waypoints
        : piece.accessoryType === "pier"
          ? ArrowUpFromLine
          : piece.accessoryType === "signal"
            ? Lightbulb
            : Building2;
    return (
      <div className="piece-illustration accessory-illustration">
        <Icon size={30} strokeWidth={1.4} />
      </div>
    );
  }
  return (
    <svg className="piece-illustration" viewBox="0 0 112 68" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="#b3b6ad"
        strokeWidth={double ? 26 : 18}
        transform="translate(0 4)"
      />
      <path
        d={d}
        fill="none"
        stroke={piece.bed === "bridge" ? (piece.color ?? "#567865") : "#c9c9bd"}
        strokeWidth={double ? 26 : 18}
      />
      {(double ? [-7, 7] : [0]).map((offset) => (
        <g key={offset} transform={`translate(0 ${offset})`}>
          <path
            d={d}
            fill="none"
            stroke="#525750"
            strokeWidth="12"
            strokeDasharray="2 4"
          />
          <path d={d} fill="none" stroke="#d9dad3" strokeWidth="8" />
          <path d={d} fill="none" stroke="#777b72" strokeWidth="5" />
        </g>
      ))}
      {piece.shape === "turnout" && (
        <path
          d="M15 33Q53 33 94 12"
          fill="none"
          stroke="#a7aea0"
          strokeWidth="9"
        />
      )}
      {piece.shape === "crossing" && (
        <path d="M55 9V57" fill="none" stroke="#9fa89a" strokeWidth="10" />
      )}
      {piece.bed === "viaduct" && (
        <>
          <path d="M15 47H96" stroke="#828a7e" strokeWidth="4" />
          <path d="M31 49V62M81 49V62" stroke="#a4aaa0" strokeWidth="6" />
        </>
      )}
      {piece.bed === "bridge" && (
        <path
          d="M15 19H96M15 19 35 38 55 19 75 38 96 19"
          fill="none"
          stroke={piece.color ?? "#496c55"}
          strokeWidth="3"
        />
      )}
    </svg>
  );
}

export default function App() {
  const h = useRailway();
  const {
    layout,
    tracks,
    accessories,
    selectedSpec,
    selection,
    selectedTrack,
  } = h;
  const [saveName, setSaveName] = useState(layout.name);
  const [deleteDesignId, setDeleteDesignId] = useState<string | null>(null);
  const [practiceFirstType, setPracticeFirstType] = useState<ShinkansenType>("e6");
  const [practiceFirstCars, setPracticeFirstCars] = useState(3);
  const [practiceSecondType, setPracticeSecondType] = useState<ShinkansenType>("e5");
  const [practiceSecondCars, setPracticeSecondCars] = useState(3);
  const saveNameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDeleteDesignId(null);
    if (h.modal === "save") {
      setSaveName(layout.name);
      saveNameInput.current?.focus();
      saveNameInput.current?.select();
    }
  }, [h.modal, layout.name]);
  const saveDesign = (asCopy = false) => {
    if (h.saveDesign(saveName, asCopy)) h.setModal(null);
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <TrainFront size={27} strokeWidth={1.8} />
          </div>
          <div>
            <div className="brand-name">
              little railways<span className="brand-3d">3D</span>
            </div>
            <div className="brand-caption">BIG ADVENTURES. SMALL TRAINS.</div>
          </div>
        </div>
        <div className="header-actions">
          <span className="saved-label">
            {h.saved ? <Check size={14} /> : <ArrowDownToLine size={14} />}
            {h.saved ? "Current design autosaved" : "Autosave unavailable"}
          </span>
          <button
            className="icon-button"
            aria-label="How to play"
            onClick={() => h.setModal("help")}
          >
            <CircleHelp size={21} />
          </button>
        </div>
      </header>
      <h1 className="visually-hidden">Your 3D railway simulator</h1>
      <main className="workspace">
        <div className="workspace-main">
          <section className="railway-card" aria-label="3D railway playground">
            <div className="board-header">
              <div className="board-title">
                <span>YOUR 3D RAILWAY</span>
                <h2>
                  {layout.name}
                  <span className="status-dot" />
                </h2>
              </div>
              <div className="board-tools">
                <button
                  className="icon-button"
                  aria-label="Undo last change"
                  disabled={!h.history.length || h.couplingBusy}
                  onClick={h.undo}
                >
                  <Undo2 size={19} />
                </button>
                <button
                  className="button primary"
                  disabled={h.couplingBusy}
                  onClick={() => {
                    setSaveName(layout.name);
                    h.setModal("save");
                  }}
                >
                  <Save size={17} />
                  Save layout
                </button>
                <button
                  className="button secondary"
                  disabled={h.couplingBusy}
                  onClick={() => h.setModal("layouts")}
                >
                  <FolderOpen size={17} />
                  Layouts
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            {layout.sourcePlan === "kato-plan02-1a" && (
              <div className="layout-plan-info">
                <div>
                  <p>
                    KATO plan 02-1A uses M1 + V1 + V2 plus four additional R315-45
                    curves.
                  </p>
                  <p className="layout-plan-note">
                    Pier heights are modeled; check KATO's kit instructions
                    before building.
                  </p>
                </div>
                <a
                  href="https://www.katomodels.com/unitrackplan/plan/plan02-1a.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View KATO plan <ChevronRight size={14} />
                </a>
              </div>
            )}
            <RailwayCockpit h={h}>
              <Scene3D
                tracks={tracks}
                accessories={accessories}
                trainPosition={h.position}
                cabForward={h.cabForward}
                carCount={h.carCount}
                trainType={h.trainType}
                fleet={h.fleet}
                couplings={h.couplings}
                couplingOperation={h.couplingOperation}
                selectedTrainId={h.selectedTrainId}
                onSelectTrain={h.selectTrain}
                placingTrain={h.placingTrain}
                placementDirection={h.placementDirection}
                onPlaceTrain={h.placeTrain}
                selectedId={h.selectedId}
                activeAnchor={h.anchor}
                mode={h.couplingBusy ? "orbit" : h.mode}
                cameraPreset={h.cameraPreset}
                viewRevision={h.viewRevision}
                layoutRevision={h.layoutRevision}
                placementHeight={h.buildHeight}
                onDropItem={(kind, x, y) => h.addPiece(kind, { x, y })}
                onSelect={(id) => {
                  h.setSelectedId(id);
                }}
                onMove={h.movePiece}
                onAnchor={(value) => {
                  h.setAnchor(value);
                  h.setSelectedId(null);
                  h.setBuildHeight(value.position.z ?? 0);
                  h.notify("Connector selected. Choose the next track piece.");
                }}
                onReady={() => h.setReady(true)}
                issues={h.issues}
              />
            </RailwayCockpit>
          </section>
        </div>
        <aside className="builder-panel" aria-label="Kato track builder">
          <div className="panel-eyebrow">THE KATO-INSPIRED TRACK BOX</div>
          <h2>
            A world of possibilities <span>+</span>
          </h2>
          <p className="catalog-summary">
            {KATO_CATALOG.length} catalog pieces to discover.
          </p>
          {h.couplingBusy && <p className="coupling-build-note">Track building waits until the noses have finished connecting or separating.</p>}
          <fieldset className="coupling-build-lock" disabled={h.couplingBusy} aria-label="Track building">
          <div className="catalog-search">
            <Search size={17} />
            <input
              type="search"
              aria-label="Search Kato catalog"
              placeholder="Search tracks, scenery, or product no."
              value={h.search}
              onChange={(event) => h.setSearch(event.target.value)}
            />
            {h.search && (
              <button
                aria-label="Clear catalog search"
                onClick={() => h.setSearch("")}
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div
            className="catalog-tabs"
            role="group"
            aria-label="Catalog categories"
          >
            {CATEGORIES.map((tab) => (
              <button
                key={tab.key}
                aria-pressed={h.category === tab.key && !h.search}
                className={h.category === tab.key && !h.search ? "active" : ""}
                onClick={() => {
                  h.setCategory(tab.key);
                  h.setSearch("");
                }}
              >
                <tab.icon size={17} />
                {tab.label}
              </button>
            ))}
          </div>
          <div className="catalog-scroll">
            <div className="piece-grid">
              {h.filtered.map((piece) => (
                <button
                  key={piece.kind}
                  className="piece-button"
                  draggable={!h.couplingBusy}
                  aria-label={`Add ${piece.name}`}
                  title={`${piece.name} · Kato ${piece.sku}\nClick to add, or drag into the scene.`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/x-kato-piece",
                      piece.kind,
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => h.addPiece(piece.kind)}
                >
                  <PieceIllustration piece={piece} />
                  <span className="piece-label">{piece.label}</span>
                  <span className="piece-name">{piece.name}</span>
                  <span className="piece-sku">KATO {piece.sku}</span>
                  {piece.verification === "nominal" && (
                    <span className="piece-precision">Verify physical fit</span>
                  )}
                  <span className="piece-add">
                    <Plus size={12} />
                  </span>
                </button>
              ))}
            </div>
            {!h.filtered.length && (
              <p className="empty-catalog">
                No pieces found. Try a radius, length, or product number.
              </p>
            )}
          </div>
          {["curved", "viaduct", "double"].includes(h.category) &&
            !h.search && (
              <div
                className="bend-control"
                role="group"
                aria-label="Curve direction"
              >
                <button
                  aria-pressed={h.bend === -1}
                  className={h.bend === -1 ? "active" : ""}
                  onClick={() => h.setBend(-1)}
                >
                  <RotateCcw size={15} />
                  Bend left
                </button>
                <button
                  aria-pressed={h.bend === 1}
                  className={h.bend === 1 ? "active" : ""}
                  onClick={() => h.setBend(1)}
                >
                  <RotateCcw size={15} style={{ transform: "scaleX(-1)" }} />
                  Bend right
                </button>
              </div>
            )}
          <div className="placement-height">
            <label htmlFor="build-height">
              <Layers3 size={16} />
              New piece height
            </label>
            <select
              id="build-height"
              value={h.buildHeight}
              onChange={(event) => {
                h.setBuildHeight(Number(event.target.value));
                h.setAnchor(null);
              }}
            >
              {Array.from(new Set([0, 20, 40, 60, 80, 100, 120, h.buildHeight]))
                .sort((a, b) => a - b)
                .map((height) => (
                  <option key={height} value={height}>
                    {height === 0 ? "Table level" : `${height} mm high`}
                  </option>
                ))}
            </select>
          </div>
          {selection && selectedSpec ? (
            <div className="selection-card">
              <div className="selection-head">
                <div>
                  <span>SELECTED PIECE · {selectedSpec.sku}</span>
                  <strong>{selectedSpec.name}</strong>
                </div>
                <button
                  className="icon-button"
                  aria-label="Deselect piece"
                  onClick={() => h.setSelectedId(null)}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="selection-actions">
                <button
                  className="button secondary"
                  aria-label="Rotate selected piece"
                  onClick={() =>
                    h.updateSelection({ angle: selection.angle + Math.PI / 4 })
                  }
                >
                  <RotateCcw size={15} />
                  Rotate 45°
                </button>
                <button className="button secondary" onClick={h.removeSelected}>
                  <Trash2 size={15} />
                  Remove
                </button>
              </div>
              <div className="selection-grid">
                <label>
                  Height (mm)
                  <input
                    aria-label="Selected piece height"
                    type="number"
                    min="0"
                    max="500"
                    step="5"
                    value={selection.elevation ?? 0}
                    onChange={(event) => {
                      const height = Math.min(
                        500,
                        Math.max(0, Number(event.target.value)),
                      );
                      h.updateSelection({
                        elevation: height,
                        ...(selectedTrack ? { endElevation: height } : {}),
                      });
                    }}
                  />
                </label>
                {selectedTrack && (
                  <label>
                    End height (mm)
                    <input
                      aria-label="Selected track end height"
                      type="number"
                      min="0"
                      max="500"
                      step="5"
                      value={
                        selectedTrack.endElevation ??
                        selectedTrack.elevation ??
                        0
                      }
                      onChange={(event) =>
                        h.updateSelection({
                          endElevation: Math.min(
                            500,
                            Math.max(0, Number(event.target.value)),
                          ),
                        })
                      }
                    />
                  </label>
                )}
              </div>
              <div className="height-presets">
                {[0, 40, 80, 120].map((height) => (
                  <button
                    key={height}
                    onClick={() =>
                      h.updateSelection({
                        elevation: height,
                        ...(selectedTrack ? { endElevation: height } : {}),
                      })
                    }
                  >
                    {height === 0 ? "Ground" : `${height} mm`}
                  </button>
                ))}
              </div>
              {selectedTrack && (selectedTrack.elevation ?? 0) > 0 && (
                <button
                  className="button secondary"
                  onClick={h.addMatchingPiers}
                >
                  <ArrowUpFromLine size={15} />
                  Add matching piers
                </button>
              )}
              {selectedTrack &&
                (selectedSpec.shape === "turnout" ||
                  selectedSpec.shape === "scissors") && (
                  <div
                    className="switch-controls"
                    role="group"
                    aria-label="Turnout route"
                  >
                    <button
                      aria-pressed={selectedTrack.switchState !== "branch"}
                      className={
                        selectedTrack.switchState !== "branch" ? "active" : ""
                      }
                      onClick={() =>
                        h.updateSelection({ switchState: "straight" })
                      }
                    >
                      Straight route
                    </button>
                    <button
                      aria-pressed={selectedTrack.switchState === "branch"}
                      className={
                        selectedTrack.switchState === "branch" ? "active" : ""
                      }
                      onClick={() =>
                        h.updateSelection({ switchState: "branch" })
                      }
                    >
                      Branch route
                    </button>
                  </div>
                )}
              {h.grade > 0.05 && (
                <p className="grade-note">
                  {h.grade.toFixed(1)}% slope
                  {h.grade > 4 ? " · steep for a physical train" : ""}
                </p>
              )}
              <a
                className="piece-source"
                href={selectedSpec.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                See this piece in the Kato catalog <ChevronRight size={13} />
              </a>
            </div>
          ) : (
            <div className="hint-box">
              <Lightbulb size={19} />
              <p>
                {h.anchor
                  ? "A connector is selected. Click your next piece to join it at the same height."
                  : "Drag a piece into the world. Choose Move pieces to arrange it, or click a green connector to extend a track."}
              </p>
            </div>
          )}
          <RampBuilder h={h} />
          </fieldset>
          <CheckSummary h={h} />
          <details className="inventory">
            <summary>
              Placed pieces <span>{h.pieceCount}</span>
            </summary>
            <div className="inventory-list">
              {[...tracks, ...accessories].map((piece) => (
                <button
                  key={piece.id}
                  className={`placed-row ${h.selectedId === piece.id ? "selected" : ""}`}
                  aria-label={`Select placed ${CATALOG.get(piece.kind)?.name}`}
                  onClick={() => {
                    h.setSelectedId(piece.id);
                    h.setRunning(false);
                  }}
                >
                  <span>{CATALOG.get(piece.kind)?.label}</span>
                  <small>
                    {CATALOG.get(piece.kind)?.sku} · {piece.elevation ?? 0} mm
                    high
                  </small>
                </button>
              ))}
            </div>
          </details>
          <div className="inventory-total">
            <span>
              {tracks.length} tracks · {accessories.length} scenery pieces
            </span>
            <strong>{(h.totalLength / 1000).toFixed(2)} m</strong>
          </div>
          <div className="sidebar-footer">
            <button className="export-button" disabled={h.couplingBusy} onClick={h.exportLayout}>
              <ArrowDownToLine size={16} />
              Save a layout file
            </button>
            <p className="layout-backup-hint">
              Saved layouts stay in this browser. Download a file for a backup
              or to use another computer.
            </p>
            <button
              className="reference-button"
              onClick={() => h.setModal("references")}
            >
              Catalog & model references <ChevronRight size={14} />
            </button>
          </div>
        </aside>
      </main>
      <footer className="footer">
        <span>
          <TrainFront size={14} />
          Made for curious minds & little conductors.
        </span>
        <div className="keyboard-shortcuts">
          <kbd>space</kbd> play / pause<span>·</span>
          <kbd>R</kbd> reverse<span>·</span>
          <kbd>⌘ Z</kbd> undo
        </div>
      </footer>
      <input
        ref={h.fileInput}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        aria-label="Open railway file"
        disabled={h.couplingBusy}
        onChange={(event) => void h.importLayout(event.target.files?.[0])}
      />
      {h.toast && (
        <div
          className={`toast ${h.toastError ? "error" : ""}`}
          role={h.toastError ? "alert" : "status"}
        >
          {h.toastError ? <AlertTriangle size={17} /> : <Check size={17} />}
          {h.toast}
        </div>
      )}
      {h.modal && (
        <div className="modal-backdrop" onClick={() => h.setModal(null)}>
          <section
            className={`modal ${h.modal === "checks" ? "shopping-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="panel-eyebrow">
                  {h.modal === "checks"
                    ? "PHYSICAL LAYOUT REVIEW"
                    : h.modal === "save"
                      ? "KEEP THIS ADVENTURE"
                      : h.modal === "layouts"
                        ? "THE NEXT ADVENTURE"
                        : h.modal === "references"
                          ? "REAL-WORLD INSPIRATION"
                          : "WELCOME, CONDUCTOR"}
                </div>
                <h2 id="modal-title">
                  {h.modal === "checks"
                    ? "Check your physical layout"
                    : h.modal === "save"
                      ? "Save your railway"
                      : h.modal === "layouts"
                        ? "Where shall we go?"
                        : h.modal === "references"
                          ? "From Kato to your little world"
                          : "A railway you can explore in 3D"}
                </h2>
              </div>
              <button
                className="icon-button modal-close"
                aria-label="Close dialog"
                onClick={() => h.setModal(null)}
              >
                <X size={21} />
              </button>
            </div>
            {h.modal === "checks" ? (
              <ShoppingReview h={h} />
            ) : h.modal === "save" ? (
              <form
                className="save-layout-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveDesign();
                }}
              >
                <p className="modal-intro">
                  Keep this design in Your saved layouts so you can try a new
                  idea and come back to it later.
                </p>
                <label htmlFor="saved-layout-name">Layout name</label>
                <input
                  ref={saveNameInput}
                  id="saved-layout-name"
                  type="text"
                  maxLength={60}
                  required
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="My railway adventure"
                />
                <p className="saved-layout-hint">
                  Saved in this browser on this computer. Use Save a layout file
                  for a separate backup. Trains keep their places and reopen stopped.
                </p>
                {h.savedDesignsError && (
                  <p className="saved-layout-error" role="alert">
                    {h.savedDesignsError}
                  </p>
                )}
                <div className="modal-actions">
                  {h.activeSavedDesignId && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!saveName.trim() || h.couplingBusy}
                      onClick={() => saveDesign(true)}
                    >
                      <Plus size={16} />
                      Save as copy
                    </button>
                  )}
                  <button
                    className="button primary"
                    type="submit"
                    disabled={!saveName.trim() || h.couplingBusy}
                  >
                    <Save size={16} />
                    {h.activeSavedDesignId ? "Save changes" : "Save layout"}
                  </button>
                </div>
              </form>
            ) : h.modal === "layouts" ? (
              <>
                <p className="modal-intro">
                  Save your design before starting a new idea. Undo brings back
                  your previous railway.
                </p>
                <h3 className="saved-layout-heading">Your saved layouts</h3>
                <p className="saved-layout-hint">
                  These designs stay in this browser on this computer. All saved
                  trains reopen stopped, ready for their next journey.
                </p>
                {h.savedDesignsError && (
                  <p className="saved-layout-error" role="alert">
                    {h.savedDesignsError}
                  </p>
                )}
                {h.savedDesigns.length ? (
                  <div className="saved-layout-list">
                    {h.savedDesigns.map((design) => (
                      <div className="saved-layout-row" key={design.id}>
                        <div className="saved-layout-description">
                          <strong>{design.name}</strong>
                          <small>
                            {savedTrainSummary(design.layout)}
                          </small>
                          <small>
                            {design.layout.tracks.length} tracks ·{" "}
                            {design.layout.accessories.length} scenery ·{" "}
                            {new Date(design.updatedAt).toLocaleDateString(
                              undefined,
                              { year: "numeric", month: "short", day: "numeric" },
                            )}
                          </small>
                          {h.activeSavedDesignId === design.id && (
                            <span className="saved-layout-current">
                              Current saved design
                            </span>
                          )}
                        </div>
                        {deleteDesignId === design.id ? (
                          <div className="saved-layout-delete-confirm">
                            <p>Delete this saved layout?</p>
                            <div>
                              <button
                                className="button secondary"
                                autoFocus
                                onClick={() => setDeleteDesignId(null)}
                              >
                                Keep layout
                              </button>
                              <button
                                className="button delete-layout-button"
                                disabled={h.couplingBusy}
                                aria-label={`Confirm delete ${design.name}`}
                                onClick={() => {
                                  if (h.deleteSavedDesign(design.id)) {
                                    setDeleteDesignId(null);
                                  }
                                }}
                              >
                                Delete layout
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="saved-layout-actions">
                            <button
                              className="button secondary"
                              disabled={h.couplingBusy}
                              aria-label={`Open saved layout ${design.name}`}
                              onClick={() => h.openSavedDesign(design.id)}
                            >
                              <FolderOpen size={16} />
                              Open
                            </button>
                            <button
                              className="icon-button"
                              disabled={h.couplingBusy}
                              aria-label={`Delete saved layout ${design.name}`}
                              onClick={() => setDeleteDesignId(design.id)}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="saved-layout-empty">
                    No saved layouts yet. Choose Save layout to keep your
                    current design.
                  </p>
                )}
                <h3 className="saved-layout-heading preset-heading">
                  Start a new layout
                </h3>
                <section className="coupling-practice" aria-labelledby="coupling-practice-title">
                  <div className="coupling-practice-heading">
                    <Link2 size={25} strokeWidth={1.5} />
                    <div>
                      <h4 id="coupling-practice-title">Coupling station</h4>
                      <p>Any Shinkansen pair, either nose, even on curves. Choose 3–11 cars for each.</p>
                    </div>
                  </div>
                  <fieldset className="coupling-practice-controls" disabled={h.couplingBusy}>
                    <legend className="sr-only">Coupling practice trains</legend>
                    <div className="coupling-practice-train">
                      <span className="coupling-practice-number" style={{ background: getTrainSpec(practiceFirstType).colors.primary }}>1</span>
                      <label>
                        Train 1
                        <select aria-label="First coupling train model" value={practiceFirstType} onChange={(event) => setPracticeFirstType(event.target.value as ShinkansenType)}>
                          {SHINKANSEN_TYPES.map((type) => <option key={type} value={type}>{getTrainSpec(type).name}</option>)}
                        </select>
                      </label>
                      <label className="coupling-practice-count">
                        Cars
                        <select aria-label="First coupling train car count" value={practiceFirstCars} onChange={(event) => setPracticeFirstCars(Number(event.target.value))}>
                          {PLAY_CAR_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="coupling-practice-train">
                      <span className="coupling-practice-number" style={{ background: getTrainSpec(practiceSecondType).colors.primary }}>2</span>
                      <label>
                        Train 2
                        <select aria-label="Second coupling train model" value={practiceSecondType} onChange={(event) => setPracticeSecondType(event.target.value as ShinkansenType)}>
                          {SHINKANSEN_TYPES.map((type) => <option key={type} value={type}>{getTrainSpec(type).name}</option>)}
                        </select>
                      </label>
                      <label className="coupling-practice-count">
                        Cars
                        <select aria-label="Second coupling train car count" value={practiceSecondCars} onChange={(event) => setPracticeSecondCars(Number(event.target.value))}>
                          {PLAY_CAR_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="coupling-practice-actions">
                      <span>{practiceFirstCars} + {practiceSecondCars} = {practiceFirstCars + practiceSecondCars} cars</span>
                      <button className="button primary" aria-label="Start coupling practice in Coupling station" onClick={() => h.loadCouplingPractice(practiceFirstType, practiceFirstCars, practiceSecondType, practiceSecondCars)}>
                        <Link2 size={16} /> Start coupling practice
                      </button>
                    </div>
                    <button className="coupling-practice-quick" onClick={() => {
                      setPracticeFirstType("e6");
                      setPracticeFirstCars(7);
                      setPracticeSecondType("e5");
                      setPracticeSecondCars(10);
                      h.loadCouplingPractice("e6", 7, "e5", 10);
                    }}>Try 17 cars: E6 (7) + E5 (10) <ChevronRight size={14} /></button>
                  </fieldset>
                  <p className="coupling-practice-note">Playful combinations include ones that do not connect in real life. Change these choices any time to start a new practice layout.</p>
                </section>
                <div className="layout-options">
                  {(
                    [
                      {
                        kind: "kato-plan02",
                        title: "KATO M1 + V1 + V2",
                        text: "Plan 02-1A · a red bridge, slopes and a passing siding.",
                        icon: Mountain,
                      },
                      {
                        kind: "city",
                        title: "Tokyo Railway",
                        text: "A wide loop, a station, and the full 11-car E235.",
                        icon: Building2,
                      },
                      {
                        kind: "viaduct",
                        title: "Sky Railway",
                        text: "An elevated line with a ground-level track passing below.",
                        icon: Mountain,
                      },
                      {
                        kind: "compact",
                        title: "Small Railway",
                        text: "A compact loop with a three-car train to experiment with.",
                        icon: Route,
                      },
                      {
                        kind: "empty",
                        title: "A fresh adventure",
                        text: "An empty world. Drag, connect, and build it your way.",
                        icon: Plus,
                      },
                    ] as const
                  ).map((preset) => (
                    <button
                      key={preset.kind}
                      className="layout-option"
                      disabled={h.couplingBusy}
                      onClick={() => h.chooseLayout(preset.kind)}
                    >
                      <preset.icon size={35} strokeWidth={1.5} />
                      <span className="layout-description">
                        <strong>{preset.title}</strong>
                        <small>{preset.text}</small>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
                <div className="modal-footer">
                  <button
                    className="button secondary"
                    disabled={h.couplingBusy}
                    onClick={() => h.fileInput.current?.click()}
                  >
                    <FolderOpen size={16} />
                    Open a layout file
                  </button>
                  <span>Earlier 2D layout files open in 3D too.</span>
                </div>
              </>
            ) : h.modal === "references" ? (
              <>
                <p className="modal-intro">
                  {KATO_CATALOG.length} library entries sourced from Kato’s
                  catalogs and product pages. Models are built for this
                  simulator, with individual product references in the selection
                  panel.
                </p>
                <div className="reference-list">
                  {CATALOG_SOURCES.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>
                        <strong>{source.title}</strong>
                        {source.note && <small>{source.note}</small>}
                      </span>
                      <ChevronRight size={16} />
                    </a>
                  ))}
                  {TRAIN_TYPES.map((type) => {
                    const train = getTrainSpec(type);
                    return (
                      <a
                        key={type}
                        href={train.referenceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span>
                          <strong>KATO {train.name}</strong>
                          <small>{TRAIN_DESCRIPTIONS[type]} · Product photos and details.</small>
                        </span>
                        <ChevronRight size={16} />
                      </a>
                    );
                  })}
                </div>
                <div className="help-note">
                  <Lightbulb size={18} />
                  <p>
                    Standard catalog lengths and radii use millimetres. Some
                    accessory footprints, turnout frogs, banking, and crossover
                    paths are simplified. These 3D models are visual references,
                    not exact product replicas or a certified physical layout
                    plan. Check clearances and train minimum radii before buying
                    pieces.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="help-list">
                  {[
                    {
                      title: "Look around your railway",
                      text: "Drag the scene to orbit, right-drag to pan, and scroll to zoom. Try Top view to line up tracks or Train view to follow your chosen train.",
                    },
                    {
                      title: "Drag, place, and connect",
                      text: "Drag a piece from your track box into the scene. Switch to Move pieces to move existing tracks and scenery. Green connectors let you choose where the next piece attaches.",
                    },
                    {
                      title: "Build into the sky",
                      text: "Click a green connector, then choose a finish height and maximum grade in Build a gradual ramp. It calculates the track run and places matching catalog supports. The Check before shopping report identifies intermediate supports and transitions still needed. At 60 mm, Add matching piers uses the documented Kato 23-069 assembly.",
                    },
                    {
                      title: "Run your favourite trains together",
                      text: "Add E235 Yamanote Line or E5, E6, and E7 Shinkansen trainsets, with 3 to 11 cars each. You can add the same model more than once. Select a train in Your trains or click it in the scene: the speed, Play, Reverse and horn controls affect that train, and Train view follows it. Connected partners share their driving controls. The others keep their own journeys. Pause all stops every train. Stop a train before changing its car count; a connected formation stays joined if its new length fits safely. Separate partners before changing their models. Shinkansen formations here can be shorter than the real train.",
                    },
                    {
                      title: "Join two Shinkansen nose to nose",
                      text: "Open Coupling station in Layouts, choose any two E5, E6, or E7 models and 3–11 cars for each, then start coupling practice. You can also try the 17-car E6 + E5 shortcut. Select either train and choose Couple trains. Either nose can join, including on curves; the simulator chooses the nearby ends. Nose view lets you watch the covers open and the couplers connect. Pause or Continue whenever you like. Once connected, either partner controls the whole formation. Stop to change a partner's car count, or stop with room to move apart and choose Decouple trains. Their noses close after separation. Separate partners before changing their models or places. These playful combinations do not all couple in real life.",
                    },
                    {
                      title: "Find a safe place and share the rails",
                      text: "New trains find a free place on connected track when possible. Use Place train or Move train to choose a rail and direction yourself. The green preview shows a valid place; red means the whole train does not fit safely. Trains slow or wait when another train is ahead, and stop at open ends. The Switch control desk sets each numbered turnout to straight or branch. Zoom in to watch its point blades move. Switches beneath a parked or moving train wait until it clears. Move a train away before editing occupied track.",
                    },
                    {
                      title: "Check before building for real",
                      text: "The simulator blocks tracks, platforms, poles, and low bridges that obstruct its train envelope. A catenary gantry may straddle a track when its posts and beam clear the train. Check before shopping lists geometry and support issues alongside product codes. Resolve approximate parts with the shop; quantities count pieces, not retail packs.",
                    },
                    {
                      title: "Keep your little world",
                      text: "Choose Save layout, give your design a name, then start a new idea in Layouts. Open Your saved layouts to return to it with every train in its saved place, stopped. Save changes updates an opened design; Save as copy keeps another version. The current design also autosaves in this browser. Download a layout file for a spare copy or another computer. Earlier single-train layouts still open too.",
                    },
                  ].map((step, index) => (
                    <div className="help-row" key={step.title}>
                      <span>{index + 1}</span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  <button
                    className="button primary"
                    onClick={() => h.setModal(null)}
                  >
                    <Play size={16} />
                    Let’s play
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
