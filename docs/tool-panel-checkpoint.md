# Archived tool-panel checkpoint — 2026-10-12

The user requested a save and pause before switching off their computer. The snapshot below records that pause point, saved in commit `01ee098` and backed up to GitHub branch `checkpoint/tool-panel-20261012-0936`. Development subsequently resumed. These validation notes describe the checkpoint, rather than the latest project status; see README and subsequent commits for the completed behavior and checks. Continue the existing project without recreating the simulator or resetting its code.

## Implemented

- New `BuilderPanel.tsx` extracts the existing builder controls into Pieces, Ramp, and Helper tabs. Mounted hidden panels preserve fields, scroll positions, station-name drafts, helper checks, and results.
- Selected pieces have a compact strip and an explicit Edit / Back to tools flow. Existing rotation, deletion, heights, station names, piers, turnout routes, source links, inventory, export, and shopping checks use their original handlers.
- Desktop railway and tool panel fit the viewport. Only the active tool body scrolls; tabs and primary actions remain visible.
- Tablet/phone split view supports Expand tools / Shrink tools. Phone train-control rows scroll horizontally. Helper's two actions share a row on small screens.
- App hides the helper preview outside Helper without clearing the controller. Helper mathematics, models, presets, save formats, and storage keys were not changed.
- Browser tests use `tests/builder-navigation.ts` to follow the new Edit / More tools flow. Eight tool-panel integration cases were added; affected existing test navigation was migrated.
- Package version is prepared as 0.15.1. README and helper instructions reflect the new controls.

## Validation completed

- Production build passed before the final responsive CSS refinements. Rebuild the final source before publishing.
- 337 focused CPU tests passed: track feasibility, layout, saved designs, station names, engineering, KATO plan 02, and KATO plan 06.
- Read-only extraction review found no lost builder controls or material safety/state regression.
- All five existing layout-dropdown browser cases passed.
- Fresh-server tablet and phone Helper-result cases passed before the latest phone ratio adjustment. Tablet readable body is 111.4 px normally / 151.4 px expanded, with a 58 px action row; canvas is 299.1 / 259.0 px.
- Populated KATO M1 phone canvas was 153.8 px normally / 118 px expanded. Expanded view failed the 120 px minimum. The last CSS change restores phone 60/40 normal and 55/45 expanded proportions while retaining compact control rows. Expected KATO canvas is about 190 / 154 px; this last change is **not yet verified**. KATO landscape is also unverified.

## Planned resumption checks

1. Rerun the tablet/phone Helper cases and populated KATO portrait normal/expanded plus landscape case. Inspect full-screen screenshots and ensure a usable visible railway and readable tool body. Do not weaken the sizing assertions to hide a regression.
2. Run the remaining five new tool-panel cases, nine helper regressions, three station-name regressions, and the focused railway-cockpit Mac/control case. Verify tab retention, independent scrolling, helper preview/apply/cancel, drag placement, station editing, ramp build/undo, and existing train controls.
3. Rebuild, run `git diff --check`, commit final fixes, then publish and verify production and live workflows when development is resumed.

Browser scratch configuration and logs are in `/workspace/work/tool-panel-browser`. It uses one `/usr/bin/chromium` worker with SwiftShader and device scale 0.5. Each local run now owns a fresh Vite server (`reuseExistingServer: false`); a previous interrupted runner had shut down its shared server, causing worker load failures and `net::ERR_CONNECTION_REFUSED`. These were test infrastructure failures. Its identified orphan GPU process was stopped.

Install the Playwright clock at target time minus 60 seconds, pause at target before navigation, and advance a short 100 ms window for visibly rendered screenshots. Use relative `page.goto('./')` for the public GitHub Pages subpath. Do not overlap heavy CPU tests with software-WebGL browser tests.

## Publishing state at the checkpoint

- Public app: https://lsu1.github.io/TrainModelSimulator/
- Published baseline remains v0.15.0; no deployment was attempted during this tool-panel task.
- Source baseline: `218e719795e89595be03b4cedf9a8e664de30610` on `origin/main`.
- Pages baseline: `ffdc39c8138ff8fd9f1ac4dc9d0facf3919fba9f` on `origin/gh-pages`.
- Release preparation scripts are ready in `/workspace/work/tool-panel-release`; run only after final validation and source commit.
- Preserve older hashed assets when preparing gh-pages. Verify the public index and every new asset against local production bytes with normal TLS, then run live browser checks.

At the checkpoint, the unfinished work was saved on the existing local `work` branch and backed up to a separate GitHub checkpoint branch. Main and gh-pages were still at the published baseline.
