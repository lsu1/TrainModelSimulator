import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Building2,
  ChevronRight,
  Layers3,
  Lightbulb,
  Maximize2,
  Minimize2,
  Mountain,
  Plus,
  RotateCcw,
  Route,
  Search,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import StationNameEditor from "./StationNameEditor";
import TrackHelper, { TrackHelperActions } from "./TrackHelper";
import { CheckSummary, RampBuilder, RampBuilderActions } from "./BuildTools";
import { supportsStationName } from "./stationName";
import { KATO_CATALOG } from "./catalog";
import type { CatalogCategory, CatalogItem } from "./catalogTypes";
import { CATALOG } from "./useRailway";
import type { useRailway } from "./useRailway";
import type { TrackHelperController } from "./useTrackHelper";

type Railway = ReturnType<typeof useRailway>;
export type BuilderTool = "pieces" | "ramp" | "helper";
const TOOLS: { key: BuilderTool; label: string; icon: typeof Route }[] = [
  { key: "pieces", label: "Pieces", icon: Route },
  { key: "ramp", label: "Ramp", icon: ArrowUpFromLine },
  { key: "helper", label: "Helper", icon: Lightbulb },
];

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

export default function BuilderPanel({ h, helper, activeTool, onToolChange, toolsExpanded, onToggleTools }: {
  h: Railway;
  helper: TrackHelperController;
  activeTool: BuilderTool;
  onToolChange: (tool: BuilderTool) => void;
  toolsExpanded: boolean;
  onToggleTools: () => void;
}) {
  const { selection, selectedSpec, selectedTrack, selectedAccessory, tracks, accessories } = h;
  const [editing, setEditing] = useState(false);
  const tabRefs = useRef<Partial<Record<BuilderTool, HTMLButtonElement>>>({});
  const editButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);

  // Hiding a tool leaves its fields, scroll position, and background search intact.
  // Geometry edits still invalidate helper suggestions in the existing controller.
  useEffect(() => {
    if (activeTool === "helper" && !helper.expanded) helper.setExpanded(true);
  }, [activeTool, helper.expanded, helper.setExpanded]);
  useEffect(() => {
    if (!selection && editing) {
      setEditing(false);
      tabRefs.current[activeTool]?.focus({ preventScroll: true });
    }
  }, [selection, editing, activeTool]);
  useEffect(() => {
    if (editing) backButton.current?.focus({ preventScroll: true });
  }, [editing]);

  const chooseTool = (tool: BuilderTool) => {
    setEditing(false);
    onToolChange(tool);
  };
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, tool: BuilderTool) => {
    const index = TOOLS.findIndex((entry) => entry.key === tool);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % TOOLS.length;
    else if (event.key === "ArrowLeft") next = (index + TOOLS.length - 1) % TOOLS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TOOLS.length - 1;
    else return;
    event.preventDefault();
    const nextTool = TOOLS[next].key;
    chooseTool(nextTool);
    tabRefs.current[nextTool]?.focus({ preventScroll: true });
  };
  const backToTools = () => {
    setEditing(false);
    editButton.current?.focus({ preventScroll: true });
  };

  return (
    <aside className="builder-panel" aria-label="Kato track builder">
      <div className="builder-header">
        <div>
          <div className="panel-eyebrow">THE KATO-INSPIRED TRACK BOX</div>
          <h2>Build your railway <span>+</span></h2>
          <p className="catalog-summary">{KATO_CATALOG.length} catalog pieces</p>
        </div>
        <button className="icon-button builder-expand" aria-label={toolsExpanded ? "Shrink tools" : "Expand tools"}
          aria-expanded={toolsExpanded} onClick={onToggleTools}>
          {toolsExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
      <div className="builder-tabs" role="tablist" aria-label="Building tools">
        {TOOLS.map((tool) => <button key={tool.key} id={`builder-tab-${tool.key}`}
          role="tab" aria-selected={activeTool === tool.key}
          aria-controls={editing && activeTool === tool.key ? "builder-panel-editor" : `builder-panel-${tool.key}`}
          tabIndex={activeTool === tool.key ? 0 : -1}
          ref={(element) => { if (element) tabRefs.current[tool.key] = element; }}
          onClick={() => chooseTool(tool.key)} onKeyDown={(event) => navigateTabs(event, tool.key)}>
          <tool.icon size={16} /> {tool.label}
        </button>)}
      </div>
      {selection && selectedSpec && <div className="builder-selected-strip">
        <span>Selected: <strong>{selectedSpec.name}</strong></span>
        <button className="button secondary" ref={editButton} aria-label="Edit selected piece"
          onClick={() => setEditing(true)}>Edit</button>
        <button className="icon-button" aria-label="Deselect piece" onClick={() => h.setSelectedId(null)}><X size={15} /></button>
      </div>}
      {h.couplingBusy && <p className="coupling-build-note">Track building waits until the trains have finished connecting or separating.</p>}
      <div className="builder-body">
        <section className="builder-pane" role="tabpanel" id="builder-panel-pieces" aria-labelledby="builder-tab-pieces"
          hidden={activeTool !== "pieces" || editing}>
          <div className="builder-scroll">
            <fieldset className="builder-content coupling-build-lock" disabled={h.couplingBusy} aria-label="Track building">
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
              <div className="hint-box">
                <Lightbulb size={19} />
                <p>
                  {h.anchor
                    ? "A connector is selected. Click your next piece to join it at the same height."
                    : "Drag a piece into the world. Choose Move pieces to arrange it, or click a green connector to extend a track."}
                </p>
              </div>
            </fieldset>
            <details className="builder-more">
              <summary>More tools</summary>
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
            </details>
          </div>
          <div className="builder-actions">
            <div className="inventory-total">
              <span>
                {tracks.length} tracks · {accessories.length} scenery pieces
              </span>
              <strong>{(h.totalLength / 1000).toFixed(2)} m</strong>
            </div>
            <CheckSummary h={h} />
          </div>
        </section>
        <section className="builder-pane" role="tabpanel" id="builder-panel-ramp" aria-labelledby="builder-tab-ramp"
          hidden={activeTool !== "ramp" || editing}>
          <div className="builder-scroll">
            <fieldset className="builder-content coupling-build-lock" disabled={h.couplingBusy} aria-label="Ramp building">
              <RampBuilder h={h} docked />
            </fieldset>
          </div>
          <div className="builder-actions"><RampBuilderActions h={h} /></div>
        </section>
        <section className="builder-pane" role="tabpanel" id="builder-panel-helper" aria-labelledby="builder-tab-helper"
          hidden={activeTool !== "helper" || editing}>
          <div className="builder-scroll"><TrackHelper h={h} helper={helper} docked /></div>
          <div className="builder-actions"><TrackHelperActions h={h} helper={helper} /></div>
        </section>
        <section className="builder-pane builder-editor" role="tabpanel" id="builder-panel-editor"
          aria-labelledby={`builder-tab-${activeTool}`} hidden={!editing}>
          <div className="builder-scroll">
            <button className="button secondary builder-back" ref={backButton} onClick={backToTools}><ArrowLeft size={16} /> Back to tools</button>
            <fieldset className="builder-content coupling-build-lock" disabled={h.couplingBusy} aria-label="Selected piece editing">
              {selection && selectedSpec ? (
                <div className="selection-card">
                  <div className="selection-head">
                    <div>
                      <span>SELECTED PIECE · {selectedSpec.sku}</span>
                      <strong>{selectedSpec.name}</strong>
                    </div>
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
                  {selectedAccessory && supportsStationName(selectedSpec.accessoryType) && (
                    <StationNameEditor
                      key={selectedAccessory.id}
                      accessory={selectedAccessory}
                      accessoryType={selectedSpec.accessoryType}
                      onApply={h.updateStationName}
                    />
                  )}
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
              ) : null}
            </fieldset>
          </div>
        </section>
      </div>
    </aside>
  );
}
