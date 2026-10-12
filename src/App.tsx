import {
  ArrowDownToLine,
  AlertTriangle,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  FolderOpen,
  Layers3,
  Lightbulb,
  Mountain,
  Play,
  Plus,
  Route,
  Save,
  TrainFront,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Scene3D from "./Scene3D";
import RailwayCockpit from "./RailwayCockpit";
import { useTrackHelper } from "./useTrackHelper";
import { KATO_CATALOG, CATALOG_SOURCES } from "./catalog";
import { useRailway } from "./useRailway";
import { TRAIN_TYPES, getTrainSpec } from "./trains";
import type { TrainType } from "./trains";
import type { LayoutData, LayoutPreset } from "./layout";
import { ShoppingReview } from "./BuildTools";
import BuilderPanel from "./BuilderPanel";
import type { BuilderTool } from "./BuilderPanel";

const TRAIN_DESCRIPTIONS: Record<TrainType, string> = {
  e235: "Stainless steel and lime green",
  e5: "Green, pink stripe, and an extra-long nose",
  e6: "Red and silver with a pointed nose",
  e7: "Blue and white with a copper stripe",
};
const LAYOUT_PRESETS: {
  kind: LayoutPreset;
  title: string;
  text: string;
  icon: typeof Route;
}[] = [
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
  {
    kind: "kato-plan06-15",
    title: "新干线与在来线交错运行",
    text: "KATO plan 06-15 · an elevated double-track line, local routes, stations and a yard.",
    icon: Layers3,
  },
];
function savedTrainSummary(layout: LayoutData): string {
  if (!layout.trains) {
    return `${getTrainSpec(layout.trainType).name} · ${layout.carCount} cars`;
  }
  if (!layout.trains.length) return "No trains yet";
  return `${layout.trains.length} ${layout.trains.length === 1 ? "train" : "trains"} · ${layout.trains
    .map((train) => `${getTrainSpec(train.type).name} (${train.carCount} cars)`)
    .join(" · ")}`;
}

export default function App() {
  const h = useRailway();
  const trackHelper = useTrackHelper(h);
  const [activeTool, setActiveTool] = useState<BuilderTool>("pieces");
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const { layout, tracks, accessories } = h;
  const [saveName, setSaveName] = useState(layout.name);
  const [deleteDesignId, setDeleteDesignId] = useState<string | null>(null);
  const [layoutChoice, setLayoutChoice] = useState("");
  const layoutsWasOpen = useRef(false);
  const saveNameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDeleteDesignId(null);
    if (h.modal === "save") {
      setSaveName(layout.name);
      saveNameInput.current?.focus();
      saveNameInput.current?.select();
    }
  }, [h.modal, layout.name]);
  useEffect(() => {
    const isOpen = h.modal === "layouts";
    if (isOpen && !layoutsWasOpen.current) {
      const activeDesign = h.savedDesigns.find(
        (design) => design.id === h.activeSavedDesignId,
      );
      setLayoutChoice(activeDesign ? `saved:${activeDesign.id}` : "");
      setDeleteDesignId(null);
    }
    layoutsWasOpen.current = isOpen;
  }, [h.modal, h.activeSavedDesignId, h.savedDesigns]);
  const selectedSavedDesign = layoutChoice.startsWith("saved:")
    ? h.savedDesigns.find((design) => design.id === layoutChoice.slice(6))
    : undefined;
  const selectedPreset = layoutChoice.startsWith("preset:")
    ? LAYOUT_PRESETS.find((preset) => preset.kind === layoutChoice.slice(7))
    : undefined;
  const hasSelectedLayout = !!selectedSavedDesign || !!selectedPreset;
  const openSelectedLayout = () => {
    if (h.couplingBusy) return;
    if (selectedSavedDesign) h.openSavedDesign(selectedSavedDesign.id);
    else if (selectedPreset) h.chooseLayout(selectedPreset.kind);
  };
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
      <main className={`workspace${toolsExpanded ? " tool-panel-expanded" : ""}`}>
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
            {layout.sourcePlan === "kato-plan06-15" && (
              <div className="layout-plan-info">
                <div>
                  <p>KATO plan 06-15 · elevated and ground-level railway routes.</p>
                </div>
                <a
                  href="https://www.katomodels.com/unitrackplan/plan/plan06-15.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View KATO plan <ChevronRight size={14} />
                </a>
                <a
                  href="https://www.katomodels.com/unitrackplan/plan/plan06-15_partslist.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Parts list <ChevronRight size={14} />
                </a>
                <a
                  href="https://www.katomodels.com/unitrackplan/common_parts_namelist.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Parts key <ChevronRight size={14} />
                </a>
              </div>
            )}
            <RailwayCockpit h={h}>
              {(selectTrain) => (
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
                  onSelectTrain={selectTrain}
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
                  helperPreview={activeTool === "helper" ? trackHelper.preview : null}
                />
              )}
            </RailwayCockpit>
          </section>
        </div>
        <BuilderPanel
          h={h}
          helper={trackHelper}
          activeTool={activeTool}
          onToolChange={setActiveTool}
          toolsExpanded={toolsExpanded}
          onToggleTools={() => setToolsExpanded((value) => !value)}
        />
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
                <div className="layout-picker">
                  <label htmlFor="layout-choice">Choose a layout</label>
                  <select
                    id="layout-choice"
                    value={hasSelectedLayout ? layoutChoice : ""}
                    disabled={h.couplingBusy}
                    onChange={(event) => {
                      setLayoutChoice(event.target.value);
                      setDeleteDesignId(null);
                    }}
                  >
                    <option value="">Choose a layout…</option>
                    {h.savedDesigns.length > 0 && (
                      <optgroup label="Your saved layouts">
                        {h.savedDesigns.map((design) => (
                          <option key={design.id} value={`saved:${design.id}`}>
                            {design.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Sample layouts">
                      {LAYOUT_PRESETS.map((preset) => (
                        <option key={preset.kind} value={`preset:${preset.kind}`}>
                          {preset.title}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <p className="saved-layout-hint">
                  Saved designs stay in this browser on this computer. All saved
                  trains reopen stopped, ready for their next journey.
                </p>
                {h.savedDesignsError && (
                  <p className="saved-layout-error" role="alert">
                    {h.savedDesignsError}
                  </p>
                )}
                {!h.savedDesigns.length && (
                  <p className="saved-layout-empty">
                    No saved layouts yet. Choose Save layout to keep your
                    current design.
                  </p>
                )}
                {selectedSavedDesign ? (
                  <div className="layout-selection-details saved-layout-row">
                    <div className="saved-layout-description">
                      <strong>{selectedSavedDesign.name}</strong>
                      <small>{savedTrainSummary(selectedSavedDesign.layout)}</small>
                      <small>
                        {selectedSavedDesign.layout.tracks.length} tracks ·{" "}
                        {selectedSavedDesign.layout.accessories.length} scenery ·{" "}
                        {new Date(selectedSavedDesign.updatedAt).toLocaleDateString(
                          undefined,
                          { year: "numeric", month: "short", day: "numeric" },
                        )}
                      </small>
                      {h.activeSavedDesignId === selectedSavedDesign.id && (
                        <span className="saved-layout-current">
                          Current saved design
                        </span>
                      )}
                    </div>
                    {deleteDesignId === selectedSavedDesign.id ? (
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
                            aria-label={`Confirm delete ${selectedSavedDesign.name}`}
                            onClick={() => {
                              if (h.deleteSavedDesign(selectedSavedDesign.id)) {
                                setDeleteDesignId(null);
                                setLayoutChoice("");
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
                          className="icon-button"
                          disabled={h.couplingBusy}
                          aria-label={`Delete saved layout ${selectedSavedDesign.name}`}
                          onClick={() => setDeleteDesignId(selectedSavedDesign.id)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    )}
                  </div>
                ) : selectedPreset ? (
                  <div className="layout-selection-details layout-preset-details">
                    <selectedPreset.icon size={35} strokeWidth={1.5} />
                    <div className="layout-description">
                      <strong>{selectedPreset.title}</strong>
                      <small>{selectedPreset.text}</small>
                    </div>
                  </div>
                ) : null}
                <div className="layout-picker-actions">
                  <button
                    className="button primary"
                    disabled={
                      !hasSelectedLayout ||
                      h.couplingBusy ||
                      (!!selectedSavedDesign && deleteDesignId === selectedSavedDesign.id)
                    }
                    onClick={openSelectedLayout}
                  >
                    <FolderOpen size={16} />
                    Open layout
                  </button>
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
                      key={`${source.title}:${source.url}`}
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
                      text: "Add two E5, E6, or E7 trainsets to your railway with New train, then stop them with two noses nearby on connected track. Select either train, choose its partner in the lower dock, and press Couple trains. Either nose can join, including on curves; the simulator chooses the nearby ends. Nose view lets you watch the covers open and the couplers connect. Pause or Continue whenever you like. Once connected, either partner controls the whole formation. Stop to change a partner's car count, or stop with room to move apart and choose Decouple trains. Their noses close after separation. Separate partners before changing their models or places. These playful combinations do not all couple in real life.",
                    },
                    {
                      title: "Connect two Yamanote trains",
                      text: "Two real Yamanote E235 trains can connect cab to cab for emergency recovery. Add two Yamanote trains, stop them with two cab ends nearby on clear connected rails, select a partner, and press Couple trains. Coupler view shows the exposed couplers below the cabs joining without opening nose covers. Either front or rear cab can connect. Pause or Continue during joining, then use either train's driving controls for the pair. Stop with room to move apart and choose Decouple trains to separate them. Shared driving controls are simplified for play; real Yamanote trains do not run as a joined pair in normal passenger service.",
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
