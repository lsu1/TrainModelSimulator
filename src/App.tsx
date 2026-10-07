import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  FolderOpen,
  Layers3,
  Lightbulb,
  Maximize2,
  MousePointer2,
  Mountain,
  Move,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  Search,
  TrainFront,
  Trash2,
  Undo2,
  Volume2,
  Waypoints,
  X,
} from "lucide-react";
import Scene3D from "./Scene3D";
import { KATO_CATALOG, CATALOG_SOURCES } from "./catalog";
import type { CatalogCategory, CatalogItem } from "./catalogTypes";
import { CATALOG, useRailway } from "./useRailway";

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
            {h.saved ? "Saved on this computer" : "Download to save"}
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
      <section className="hero">
        <div>
          <div className="eyebrow">
            <span /> A LITTLE PIECE OF TOKYO
          </div>
          <h1>Your railway. A whole new dimension.</h1>
          <p className="subtitle">
            Build, turn, and explore in 3D. Then take the Yamanote Line for a
            ride.
          </p>
        </div>
        <div className="hero-badge">
          <Layers3 size={20} />
          <span>
            Real track inspiration.
            <br />
            <strong>Endless little adventures.</strong>
          </span>
        </div>
      </section>
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
                  disabled={!h.history.length}
                  onClick={h.undo}
                >
                  <Undo2 size={19} />
                </button>
                <button
                  className="button secondary"
                  onClick={() => h.setModal("layouts")}
                >
                  <FolderOpen size={17} />
                  Layouts
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            <div className="scene-wrap">
              <Scene3D
                tracks={tracks}
                accessories={accessories}
                trainPosition={h.position}
                cabForward={h.cabForward}
                carCount={layout.carCount}
                selectedId={h.selectedId}
                activeAnchor={h.anchor}
                mode={h.mode}
                cameraPreset={h.cameraPreset}
                viewRevision={h.viewRevision}
                placementHeight={h.buildHeight}
                onDropItem={(kind, x, y) => h.addPiece(kind, { x, y })}
                onSelect={(id) => {
                  h.setSelectedId(id);
                  h.setRunning(false);
                }}
                onMove={h.movePiece}
                onAnchor={(value) => {
                  h.setAnchor(value);
                  h.setSelectedId(null);
                  h.setBuildHeight(value.position.z ?? 0);
                  h.notify("Connector selected. Choose the next track piece.");
                }}
                onReady={() => h.setReady(true)}
              />
              {!h.ready && (
                <div className="scene-loading">
                  <Layers3 size={32} />
                  <span>Opening your little world…</span>
                </div>
              )}
              <div className="scene-hud">
                <span className={`status-dot ${h.running ? "running" : ""}`} />
                {h.running
                  ? "山手線 · On an adventure"
                  : h.routeLength
                    ? "Connected loop · ready to ride"
                    : tracks.length
                      ? h.ends.length
                        ? `${h.ends.length} open connectors`
                        : "Check turnout routes"
                      : "Drag a piece here to begin"}
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
                  onClick={() => {
                    h.setMode("move");
                    h.setRunning(false);
                  }}
                >
                  <Move size={16} />
                  Move pieces
                </button>
              </div>
              <div className="scene-caption">
                <MousePointer2 size={14} />
                {h.mode === "orbit"
                  ? "Drag to orbit · right-drag to pan · scroll to zoom"
                  : "Drag a piece to move · matching connectors snap together"}
              </div>
              <div
                className="view-controls"
                role="group"
                aria-label="Camera views"
              >
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
                    aria-pressed={h.cameraPreset === view.key}
                    disabled={view.key === "ride" && !tracks.length}
                    onClick={() => h.setCameraPreset(view.key)}
                  >
                    <view.icon size={15} />
                    {view.label}
                  </button>
                ))}
                <button
                  className="camera-button"
                  aria-label="Fit railway to view"
                  onClick={() => {
                    h.setCameraPreset("perspective");
                    h.setViewRevision((v) => v + 1);
                  }}
                >
                  <Maximize2 size={16} />
                </button>
              </div>
            </div>
            <div className="train-controls">
              <button
                className={`play-button ${h.running ? "playing" : ""}`}
                aria-label={h.running ? "Pause train" : "Run train"}
                disabled={!tracks.length}
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
                  <label htmlFor="train-speed">
                    {h.running ? "Off we go!" : "Ready, conductor?"}
                  </label>
                  <span>
                    {h.speed} <small>km/h</small>
                  </span>
                </div>
                <input
                  id="train-speed"
                  aria-label="Train speed"
                  type="range"
                  min="5"
                  max="120"
                  step="5"
                  value={h.speed}
                  onChange={(event) => h.setSpeed(Number(event.target.value))}
                />
                <div className="speed-labels">
                  <span>Easy does it</span>
                  <span>Next stop, adventure</span>
                </div>
              </div>
              <div className="control-divider" />
              <button
                className="icon-button direction-button"
                aria-label="Reverse train direction"
                disabled={!tracks.length}
                onClick={h.reverse}
              >
                <ArrowLeftRight size={21} />
                <span>Reverse</span>
              </button>
              <button
                className="icon-button direction-button"
                aria-label="Sound train horn"
                onClick={() => void h.horn()}
              >
                <Volume2 size={21} />
                <span>Toot toot</span>
              </button>
              <div className="lap-stat">
                <span>{h.position.laps.toString().padStart(2, "0")}</span>
                <small>laps explored</small>
              </div>
            </div>
            <div className="train-name">
              <span className="line-swatch" />
              <TrainFront size={18} />
              <div>
                <strong>E235 · Yamanote Line</strong>
                <span>
                  山手線 · Stainless steel, lime green, and a little Tokyo
                  magic.
                </span>
              </div>
              <label className="car-select">
                Cars
                <select
                  aria-label="Train car count"
                  value={layout.carCount}
                  onChange={(event) =>
                    h.changeLayout({
                      ...layout,
                      carCount: Number(event.target.value) as 3 | 6 | 11,
                    })
                  }
                >
                  <option value={3}>3 cars</option>
                  <option value={6}>6 cars</option>
                  <option value={11}>11 cars</option>
                </select>
              </label>
            </div>
          </section>
          <div className="below-board">
            <div className="tip-card">
              <span>
                <Move size={18} />
              </span>
              <div>
                <strong>Build it your way</strong>
                <p>Drag tracks and scenery into your 3D world.</p>
              </div>
            </div>
            <div className="tip-card">
              <span>
                <ArrowUpFromLine size={18} />
              </span>
              <div>
                <strong>Go up a level</strong>
                <p>Set heights, add supports, and build overpasses.</p>
              </div>
            </div>
            <div className="tip-card">
              <span>
                <TrainFront size={18} />
              </span>
              <div>
                <strong>Ride the Yamanote Line</strong>
                <p>Try Train view to get closer to the journey.</p>
              </div>
            </div>
          </div>
        </div>
        <aside className="builder-panel" aria-label="Kato track builder">
          <div className="panel-eyebrow">THE KATO-INSPIRED TRACK BOX</div>
          <h2>
            A world of possibilities <span>+</span>
          </h2>
          <p className="catalog-summary">
            {KATO_CATALOG.length} catalog pieces to discover.
          </p>
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
                  draggable
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
            <button className="export-button" onClick={h.exportLayout}>
              <ArrowDownToLine size={16} />
              Save a layout file
            </button>
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
        onChange={(event) => void h.importLayout(event.target.files?.[0])}
      />
      {h.toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {h.toast}
        </div>
      )}
      {h.modal && (
        <div className="modal-backdrop" onClick={() => h.setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="panel-eyebrow">
                  {h.modal === "layouts"
                    ? "THE NEXT ADVENTURE"
                    : h.modal === "references"
                      ? "REAL-WORLD INSPIRATION"
                      : "WELCOME, CONDUCTOR"}
                </div>
                <h2 id="modal-title">
                  {h.modal === "layouts"
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
            {h.modal === "layouts" ? (
              <>
                <p className="modal-intro">
                  Choose a starting point. Undo brings back your previous
                  railway.
                </p>
                <div className="layout-options">
                  {(
                    [
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
                  <a
                    href="https://www.katomodels.com/product/n/e235_yamanote_slm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>
                      <strong>Kato E235 Yamanote Line</strong>
                      <small>
                        Cab faces, green door gradients, stainless bodies,
                        rooftop equipment.
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </a>
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
                      text: "Drag the scene to orbit, right-drag to pan, and scroll to zoom. Try Top view to line up tracks or Train view to follow your E235.",
                    },
                    {
                      title: "Drag, place, and connect",
                      text: "Drag a piece from your track box into the scene. Switch to Move pieces to move existing tracks and scenery. Green connectors let you choose where the next piece attaches.",
                    },
                    {
                      title: "Build into the sky",
                      text: "Select a piece to rotate it or change its height. Set a different end height to make a ramp. Tracks only connect when their heights match; an overpass stays separate from the track below.",
                    },
                    {
                      title: "All aboard the Yamanote Line",
                      text: "Press play, change the speed, and reverse. Turnouts have straight and branch routes in their selection panel. Your train stops at an open end or a turnout set the other way. Try the full 11-car train on Tokyo Railway.",
                    },
                    {
                      title: "Keep your little world",
                      text: "Undo restores a change. Layouts save in this browser. Download a layout file to keep a spare copy, or open an earlier layout file—including original 2D layouts.",
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
