# Track helper

Build your railway freely with the existing track box, then select the **Helper** tab when you want help connecting two unfinished ends. Select **First track end** and **Second track end**, and press **Check feasibility**. When exactly two connectors are open, the helper selects them automatically. A/B markers, arrows, and a dashed guide identify the selected ends in the scene. The railway stays visible while the panel contents scroll, and the check/apply actions remain at the bottom of the panel.

## Suggestions and application

The check runs in a background worker and can be cancelled. A successful result lists the proposed real catalog pieces and shows a turquoise preview. If a small repair is needed, the affected existing pieces are highlighted in orange and listed by their layout position and name. A removal-only repair is also supported.

Nothing changes until **Add these pieces** or **Apply suggested repair** is pressed. Application revalidates the current railway, clearance, piece capacity, train occupancy, and existing fleet/coupling rules. The accepted change is a single existing Undo step. Station names, saved-layout identity, source-plan information, trains, couplings, and scenery stay with the working design. Named snapshots are updated only through the existing Save controls.

Switching between **Pieces**, **Ramp**, and **Helper** retains the selected ends, ongoing check, results, and each tab's scroll position. The helper preview hides while another tab is active and returns with **Helper**. Editing the railway, changing the selected ends, or changing train models or formations cancels an outstanding check and discards its suggestion. Application also checks current train occupancy, since trains may move while a check runs.

## Search scope

- Selected ends must be no farther than **1,500 mm** apart in physical model dimensions.
- Connections are level, including level elevated track. The selected heights must match within the existing **0.25 mm** connector tolerance.
- Finishing sections use at most **six single-track straight or curved pieces**.
- Repairs can remove up to **three consecutive terminal pieces total**, shared between the selected ends. They do not remove occupied pieces, turnouts, or crossings, and stop at junctions to preserve other branches.
- The finishing section stays within the selected-end bounding box expanded by **400 mm** on each side.
- Straight lengths, curve radii, and curve angles retain their catalog values. Joining uses the existing **0.25 mm / 0.25°** rules.
- Existing turnout connectors can be chosen as ends. Creating new turnouts, crossings, double-track finishing sections, and ramps remains manual.

The solver uses a fixed candidate order and fixed work accounting, rather than a wall-clock cutoff. It searches from both ends, with at most three pieces on each side, and reserves work for small repair alternatives. Identical geometry, train configuration, protected tracks, and limits produce the same search result. Cosmetic versions with the same geometry are grouped, with ordinary track preferred on the table and viaduct track preferred above it. Sourced Shinkansen minimum radii are enforced; the E235's R315 recommendation is not treated as a confirmed minimum.

## Reading the result

- **Found:** a suggested connection passes the current modeled geometry and clearance checks. Review its preview and accept it if desired.
- **No finish within the checked scope:** the permitted candidate sequences and local repair alternatives were checked without a valid result.
- **Search limit reached:** the fixed work budget was exhausted. This means no finish has been found yet; it does not prove that a finish is impossible.
- **Not ready to check:** select two supported open connectors, bring the ends closer, or resolve their height difference. The panel explains the reason.

The gap, direction mismatch, and height difference remain visible as clues. A direction mismatch can be solved with curves; it alone does not prove infeasibility. A verified repair is distinguished from general advice to try a different nearby curve or straight.

Connecting selected ends may join separate railway sections rather than complete a circuit. Unused sidings and turnout branches may stay open. A circuit indication follows the simulator's selected turnout routes; route controls still determine where trains go.

## Reference-layout limits

The 1,500 mm gate was checked against flat contiguous sections of one to six pieces in **KATO M1 + V1 + V2**. The largest measured endpoint gap is about **1,364 mm**. This establishes eligibility coverage, not a guarantee that every removed section can be reconstructed by the helper.

That preset includes graded sections and explicit small joint-angle fitting adjustments. This initial helper does not vary intermediate joint angles or build grades to force a fit. Some preset gaps can therefore require manual adjustment even though their endpoints are close enough. The helper's fit and clearance checks describe the simulator's geometry, rather than certifying an exact physical KATO assembly.
