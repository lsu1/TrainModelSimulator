import { ChevronDown, Lightbulb, Search, X } from "lucide-react";
import { CATALOG } from "./useRailway";
import type { useRailway } from "./useRailway";
import { getLayoutPieceLimit } from "./layout";
import { TRACK_HELPER_LIMITS } from "./trackHelperTypes";
import type { TrackHelperController } from "./useTrackHelper";

type Railway = ReturnType<typeof useRailway>;

export function TrackHelperActions({ h, helper }: { h: Railway; helper: TrackHelperController }) {
  const { inspection, solution } = helper;
  const canCheck = !!inspection?.eligible && !h.couplingBusy && !helper.working;
  const exceedsLimit = !!solution && h.pieceCount - solution.removeIds.length + solution.tracks.length
    > getLayoutPieceLimit(h.layout.sourcePlan);
  return (
    <div className="track-helper-check-actions">
      <button className="button primary" disabled={!canCheck} onClick={helper.check}>
        <Search size={15} /> {helper.working ? "Checking your gap…" : "Check feasibility"}
      </button>
      {helper.working && <button className="button secondary" onClick={helper.cancel}><X size={15} /> Cancel check</button>}
      {solution && <button className="button primary" disabled={h.couplingBusy || exceedsLimit} onClick={helper.apply}>
        {solution.removeIds.length ? "Apply suggested repair" : "Add these pieces"}
      </button>}
    </div>
  );
}

export default function TrackHelper({ h, helper, docked = false }: { h: Railway; helper: TrackHelperController; docked?: boolean }) {
  const { inspection, result, solution } = helper;
  const addedNames = solution?.tracks.map((track) => CATALOG.get(track.kind)?.name ?? "Track piece") ?? [];
  const removedTracks = solution?.removeIds.flatMap((id) => {
    const index = h.tracks.findIndex((track) => track.id === id);
    return index < 0 ? [] : [{ track: h.tracks[index], number: index + 1 }];
  }) ?? [];
  const exceedsLimit = !!solution && h.pieceCount - solution.removeIds.length + solution.tracks.length
    > getLayoutPieceLimit(h.layout.sourcePlan);
  const selectionMessage = h.ends.length < 2
    ? "Build until there are two open ends you want to join. Unused sidings may stay open."
    : "Choose two open ends. Look for A and B on your railway.";

  return (
    <section className="track-helper" aria-label="Track helper">
      <h3>
        {docked ? <span><Lightbulb size={17} /> Track helper</span> : <button
          className="track-helper-toggle"
          aria-expanded={helper.expanded}
          aria-controls="track-helper-content"
          onClick={() => helper.setExpanded(!helper.expanded)}
        >
          <span><Lightbulb size={17} /> Track helper</span>
          <ChevronDown size={16} />
        </button>}
      </h3>
      {!docked && !helper.expanded && <p>Need help finishing a gap? Choose two ends and see what fits.</p>}
      {(docked || helper.expanded) && (
        <div id="track-helper-content" className="track-helper-content">
          <p>Build freely, then ask for a finish. Your pieces stay in place until you accept a suggestion.</p>
          <div className="track-helper-fields">
            <label htmlFor="track-helper-first">First track end <span>A</span></label>
            <select id="track-helper-first" aria-label="First track end" value={helper.first}
              disabled={helper.working || h.couplingBusy}
              onChange={(event) => helper.setFirst(event.target.value)}>
              <option value="">Choose an open end…</option>
              {helper.ends.map((end) => <option key={end.value} value={end.value} disabled={end.value === helper.second}>
                End {end.number} · {CATALOG.get(end.track.kind)?.name} · {end.height.toFixed(0)} mm high
              </option>)}
            </select>
            <label htmlFor="track-helper-second">Second track end <span>B</span></label>
            <select id="track-helper-second" aria-label="Second track end" value={helper.second}
              disabled={helper.working || h.couplingBusy}
              onChange={(event) => helper.setSecond(event.target.value)}>
              <option value="">Choose an open end…</option>
              {helper.ends.map((end) => <option key={end.value} value={end.value} disabled={end.value === helper.first}>
                End {end.number} · {CATALOG.get(end.track.kind)?.name} · {end.height.toFixed(0)} mm high
              </option>)}
            </select>
          </div>
          {inspection ? (
            <div className={`track-helper-gap${inspection.eligible ? "" : " warning"}`}>
              <strong>Gap: {inspection.gap.toFixed(1)} mm</strong>
              <span>Direction mismatch: {(inspection.angleDifference * 180 / Math.PI).toFixed(1)}°</span>
              <span>Height difference: {inspection.heightDifference.toFixed(1)} mm</span>
              {!inspection.eligible && <p>{inspection.message}</p>}
            </div>
          ) : <p className="track-helper-hint">{selectionMessage}</p>}
          {h.couplingBusy && <p className="track-helper-hint">Finish connecting or separating your trains before checking this gap.</p>}
          {!docked && <TrackHelperActions h={h} helper={helper} />}
          <div aria-live="polite" aria-atomic="true" className="track-helper-status">
            {helper.working && <p>Looking for a finish and small repairs. You can cancel at any time.</p>}
            {helper.notice && <p>{helper.notice}</p>}
            {result && !solution && (
              <div className="track-helper-result warning">
                <strong>{result.status === "limit" ? "We reached the search limit." : "No finish found within these limits."}</strong>
                <p>{result.message}</p>
                {inspection && inspection.heightDifference > 0.25 ? (
                  <p>Bring both ends to the same height, then try again.</p>
                ) : inspection && inspection.angleDifference > Math.PI / 180 ? (
                  <p>Look at the A and B arrows. Try changing a nearby curve or straight, then check again. Different directions can still be connected with curves.</p>
                ) : (
                  <p>Try a different straight length or curve near one end, then check again. The helper also looked for small repairs.</p>
                )}
              </div>
            )}
            {solution && (
              <div className="track-helper-result">
                <strong>{solution.removeIds.length ? "A small repair can connect these ends!" : `We found a finish using ${solution.tracks.length} ${solution.tracks.length === 1 ? "piece" : "pieces"}!`}</strong>
                {result && result.solutions.length > 1 && (
                  <label className="track-helper-suggestion-choice">Try a suggestion
                    <select aria-label="Track helper suggestion" value={helper.solutionIndex}
                      onChange={(event) => helper.setSolutionIndex(Number(event.target.value))}>
                      {result.solutions.map((candidate, index) => <option key={index} value={index}>
                        Suggestion {index + 1} · {candidate.tracks.length} added{candidate.removeIds.length ? ` · ${candidate.removeIds.length} replaced` : ""}
                      </option>)}
                    </select>
                  </label>
                )}
                <p>Preview: turquoise pieces will be added{removedTracks.length ? "; orange pieces will be removed" : ""}.</p>
                {removedTracks.length > 0 && <>
                  <span className="track-helper-list-label">Remove these highlighted pieces:</span>
                  <ul>{removedTracks.map(({ track, number }) => <li key={track.id}>Piece {number} · {CATALOG.get(track.kind)?.name}</li>)}</ul>
                </>}
                {addedNames.length > 0 && <>
                  <span className="track-helper-list-label">Add these pieces:</span>
                  <ol>{addedNames.map((name, index) => <li key={index}>{name}</li>)}</ol>
                </>}
                <p>{solution.closesLoop ? "This joins the selected ends and completes a track circuit. Turnout routes still control where trains go." : "This joins the selected ends. It may not complete a route around a loop."} Unused sidings may stay open.</p>
                {exceedsLimit && <p>This suggestion would exceed your layout’s piece limit. Remove some other pieces, then check again.</p>}
                <small>You can Undo the whole change in one step.</small>
              </div>
            )}
          </div>
          <details className="track-helper-scope">
            <summary>What this check can try</summary>
            <p>Ends up to {TRACK_HELPER_LIMITS.gap.toLocaleString("en-US")} mm apart, with up to {TRACK_HELPER_LIMITS.pieces} straight or curved finishing pieces at the same height. Repairs can remove up to {TRACK_HELPER_LIMITS.repairPieces} nearby pieces across the two ends.</p>
            <p>The search stays near the gap, with {TRACK_HELPER_LIMITS.margin} mm of extra space. A fixed search budget makes the same check repeatable; reaching that limit does not mean your railway is impossible.</p>
            <p>Pieces keep their catalog dimensions. This check does not adjust joint angles to force a fit. Double-track finishing sections and ramps need manual building.</p>
          </details>
        </div>
      )}
    </section>
  );
}
