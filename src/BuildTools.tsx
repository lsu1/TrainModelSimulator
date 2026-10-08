import {
  AlertTriangle,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  LocateFixed,
  Waypoints,
} from "lucide-react";
import { CATALOG } from "./useRailway";
import type { useRailway } from "./useRailway";

type Railway = ReturnType<typeof useRailway>;

export function SwitchPanel({ h }: { h: Railway }) {
  return (
    <section className="switch-panel" aria-label="Turnout switch controls">
      <div className="switch-panel-head">
        <div>
          <Waypoints size={19} />
          <strong>Switch control desk</strong>
        </div>
        <small>
          {h.switches.length} numbered switch
          {h.switches.length === 1 ? "" : "es"}
        </small>
      </div>
      {h.switches.length ? (
        <>
          <p>
            Match each number to the label beside its turnout. You can set a
            clear switch while the train runs.
          </p>
          <div className="switch-panel-list">
            {h.switches.map((track) => (
              <div
                className="switch-row"
                key={track.id}
                role="group"
                aria-label={`Switch ${track.switchNumber}`}
              >
                <span className="switch-number">{track.switchNumber}</span>
                <span className="switch-name">
                  {CATALOG.get(track.kind)?.label}
                  <small>Kato {CATALOG.get(track.kind)?.sku}</small>
                </span>
                <div className="switch-route-buttons">
                  <button
                    aria-label={`Switch ${track.switchNumber} straight`}
                    aria-pressed={track.switchState !== "branch"}
                    className={track.switchState !== "branch" ? "active" : ""}
                    disabled={h.couplingBusy}
                    onClick={() => h.setSwitchState(track.id, "straight")}
                  >
                    Straight
                  </button>
                  <button
                    aria-label={`Switch ${track.switchNumber} branch`}
                    aria-pressed={track.switchState === "branch"}
                    className={track.switchState === "branch" ? "active" : ""}
                    disabled={h.couplingBusy}
                    onClick={() => h.setSwitchState(track.id, "branch")}
                  >
                    Branch
                  </button>
                </div>
                <button
                  className="switch-focus"
                  aria-label={`Show switch ${track.switchNumber}`}
                  onClick={() => {
                    h.setSelectedId(track.id);
                    h.setCameraPreset("perspective");
                    h.setViewRevision((value) => value + 1);
                  }}
                >
                  <LocateFixed size={15} />
                  Show
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p>
          Add a turnout or crossover from the track box. Its numbered control
          appears here automatically.
        </p>
      )}
    </section>
  );
}

export function RampBuilder({ h }: { h: Railway }) {
  const customCount = h.rampPlan.supports.filter(
    (support) => support.status === "custom",
  ).length;
  const hasRise =
    Math.abs(h.rampPlan.targetHeight - h.rampPlan.startHeight) > 0.01;
  return (
    <section className="ramp-builder" aria-label="Ramp builder">
      <h3>
        <ArrowUpFromLine size={18} />
        Build a gradual ramp
      </h3>
      <p>
        {h.anchor
          ? `Starts at your selected connector, ${h.rampPlan.startHeight.toFixed(0)} mm high.`
          : `Starts a separate ramp at ${h.rampPlan.startHeight.toFixed(0)} mm. Click a green connector to attach it to your railway.`}
      </p>
      <div className="ramp-fields">
        <label>
          Finish height
          <select
            aria-label="Ramp target height"
            value={h.rampTarget}
            onChange={(event) => h.setRampTarget(Number(event.target.value))}
          >
            {[0, 20, 40, 60, 80, 100, 120].map((height) => (
              <option key={height} value={height}>
                {height} mm{height === 60 ? " · documented pier level" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Maximum grade
          <select
            aria-label="Ramp maximum grade"
            value={h.rampGrade}
            onChange={(event) => h.setRampGrade(Number(event.target.value))}
          >
            {[1, 2, 2.5, 3].map((grade) => (
              <option key={grade} value={grade}>
                {grade}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ramp-preview">
        <strong>
          {hasRise
            ? `${h.rampPlan.pieceCount} × S248 · ${(h.rampPlan.length / 1000).toFixed(2)} m run`
            : "Choose a different finish height"}
        </strong>
        <span>
          {h.rampPlan.gradePercent.toFixed(1)}% slope ·{" "}
          {h.rampPlan.startHeight.toFixed(0)} →{" "}
          {h.rampPlan.targetHeight.toFixed(0)} mm
        </span>
        {hasRise && (
          <small>
            {h.rampPlan.accessories.length} new catalog pier
            {h.rampPlan.accessories.length === 1 ? "" : "s"}; {customCount}{" "}
            support height{customCount === 1 ? "" : "s"} still need physical
            verification.
          </small>
        )}
      </div>
      <button
        className="button primary"
        disabled={!hasRise}
        onClick={h.buildRamp}
      >
        <ArrowUpFromLine size={16} />
        Build ramp
      </button>
      <p className="ramp-footnote">
        Grade = rise ÷ horizontal run. A 60 mm rise at 3% needs at least 2 m of
        horizontal run. Kato 23-069 uses a 50 mm pier and attachment to support
        a 60 mm roadbed. Intermediate ramp supports and vertical transitions
        still need checking.
      </p>
    </section>
  );
}

export function CheckSummary({ h }: { h: Railway }) {
  return (
    <button
      className={`validation-summary ${h.errors.length ? "has-errors" : ""}`}
      aria-label="Check before shopping"
      onClick={() => h.setModal("checks")}
    >
      {h.errors.length || h.warnings.length ? (
        <AlertTriangle size={19} />
      ) : (
        <Check size={19} />
      )}
      <span>
        <strong>Check before shopping</strong>
        <small>
          {h.errors.length
            ? `${h.errors.length} error${h.errors.length === 1 ? "" : "s"} to fix`
            : h.warnings.length
              ? `${h.warnings.length} item${h.warnings.length === 1 ? "" : "s"} to verify`
              : "No geometry issues found"}
        </small>
      </span>
      <ChevronRight size={17} />
    </button>
  );
}

export function ShoppingReview({ h }: { h: Railway }) {
  return (
    <div className="shopping-report">
      <div className="check-summary">
        <strong>
          {h.errors.length
            ? "Fix the reported conflicts before buying."
            : h.warnings.length
              ? "This layout still needs physical verification."
              : "The modeled geometry checks pass."}
        </strong>
        <span>
          {h.errors.length} errors · {h.warnings.length} review items ·{" "}
          {h.pieceCount} placed pieces
        </span>
      </div>
      <p className="modal-intro">
        The checks measure connector gaps, angles, both lanes, heights,
        gradients, and the selected train’s clearance envelope. Connections must meet within
        0.25 mm and 0.25°. The simulator uses fixed catalog lengths; it never
        stretches a piece to close a loop.
      </p>
      <div className="help-note">
        <AlertTriangle size={18} />
        <p>
          Some turnouts, banking transitions, and accessory shapes are
          approximate. The 3% ramp setting is a planning target, not a published
          train climbing limit. This report cannot certify a complete physical
          layout. Resolve the listed uncertainties with actual templates and
          your shop before purchasing.
        </p>
      </div>
      <div className="check-list">
        {h.issues.length ? (
          [...h.errors, ...h.warnings].map((issue) => (
            <article key={issue.id} className={`check-issue ${issue.severity}`}>
              <AlertTriangle size={17} />
              <div className="check-issue-content">
                <strong>{issue.message}</strong>
                {issue.detail && <p>{issue.detail}</p>}
                <div>
                  {issue.pieceIds
                    .filter(
                      (id) =>
                        h.tracks.some((track) => track.id === id) ||
                        h.accessories.some((piece) => piece.id === id),
                    )
                    .map((id) => (
                      <button
                        key={id}
                        className="check-piece-link"
                        onClick={() => {
                          h.setSelectedId(id);
                          h.setModal(null);
                          h.setCameraPreset("perspective");
                          h.setViewRevision((value) => value + 1);
                        }}
                      >
                        Show{" "}
                        {
                          CATALOG.get(
                            [...h.tracks, ...h.accessories].find(
                              (piece) => piece.id === id,
                            )!.kind,
                          )?.label
                        }
                      </button>
                    ))}
                </div>
              </div>
            </article>
          ))
        ) : (
          <p className="check-empty">
            <Check size={18} />
            No modeled fit or clearance issues found. Confirm actual stock,
            attachments, and packaging with the shop.
          </p>
        )}
      </div>
      <h3>Parts to review with your shop</h3>
      <p className="modal-intro">
        Quantities below count individual pieces placed in your layout,
        including piers. Retail packs can contain several pieces or mixed sizes.
        Ask the shop to convert these counts to packs. The onscreen switch desk
        is virtual; physical controllers, wiring, power supplies, and extra
        adapters are not included in these counts.
      </p>
      <div className="shopping-table-wrap">
        <table className="shopping-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Placed model</th>
              <th>Pieces</th>
              <th>Geometry reference</th>
            </tr>
          </thead>
          <tbody>
            {h.shoppingRows.map((row) => (
              <tr key={row.sku}>
                <td>
                  <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                    {row.sku}
                  </a>
                </td>
                <td>{row.name}</td>
                <td>{row.quantity}</td>
                <td>
                  {row.verified
                    ? "Principal catalog dimensions"
                    : "Approximate model · verify fit"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-actions">
        <button className="button secondary" onClick={h.exportShoppingReport}>
          Save shopping report
        </button>
        <button className="button primary" onClick={() => h.setModal(null)}>
          Keep building
        </button>
      </div>
    </div>
  );
}
