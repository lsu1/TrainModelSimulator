# Little Railways 3D

**[Play in your browser](https://lsu1.github.io/TrainModelSimulator/)**

A 3D KATO N scale railway playground for a young conductor on a Mac. Build layouts, arrange stations and bridges, explore overpasses, and run a silver-and-lime-green E235 Yamanote Line train. Visitors need no download, installation, account, or API key. Use a current browser with WebGL 2 graphics support.

## Explore and build

- **Look around:** drag to orbit, right-drag to pan, and scroll to zoom. On a Mac trackpad, use a secondary click to pan. **3D view**, **Top view**, **Train view**, and the fit-view button provide different ways to explore the railway.
- **Choose a layout:** open **Layouts** for **KATO M1 + V1 + V2** (official plan 02-1A with a passing siding, red bridge, slopes, and a three-car train), **Tokyo Railway** (wide loop and 11-car train), **Sky Railway** (60 mm elevated loop above a separate ground-level line), **Small Railway**, or **A fresh adventure**.
- **Place pieces:** search the track box by name, radius, length, or KATO product number. Click a piece to add it, or drag it into the scene. Click a green connector before choosing a track to attach it at that connector's height. Curved pieces have left/right bend controls.
- **Arrange the layout:** choose **Move pieces**, then drag existing tracks or scenery. Nearby compatible track connectors snap together. Select a piece to rotate it by 45°, remove it, or change its height. **Placed pieces** also lets you select an item from a list.
- **Build overpasses:** set **New piece height** before placing a track, or edit a selected piece's **Height**. **Build a gradual ramp** attaches to a selected green connector; choose its finish height and maximum grade, then review the S248 piece count, horizontal run, and unresolved support heights before building. You can also edit a track's **End height** directly. **Add matching piers** places actual catalog supports only where their documented support height matches. Piers are saved pieces; elevated tracks do not silently generate adjustable supports.
- **Run the train:** press Play, adjust speed, reverse, or sound the horn. Choose any whole-number formation from **3 through 11 cars**. The train follows connected rails and stops at an open end or points set against its route. **Train view** follows the journey.
- **Set the points:** the **Switch control desk** gives every turnout or double crossover a stable number, matching its label in the scene. Use **Straight**, **Branch**, and **Show** to set or locate it. A clear switch can change while the train runs, preserving its position and speed. Changing a switch occupied by any part of the running train is rejected until it clears; a stopped train allows switch edits.

Keyboard shortcuts: **Space** plays/pauses, **R** reverses, **⌘ Z** or **Ctrl Z** undoes, and **Delete/Backspace** removes the selection. Shortcuts leave text fields and dialogs alone. Changes to placements, heights, formations, imports, and presets pause and reset the train. Switch controls preserve playback. Undo restores previous layout changes.

The **KATO M1 + V1 + V2** preset reconstructs [KATO's plan 02-1A](https://www.katomodels.com/unitrackplan/plan/plan02-1a.pdf) with 51 track pieces, 16 numbered incline/step supports, and two approach spacers. Set both numbered switches to **Straight** for the main line or both to **Branch** for the passing siding. The source plan requires **one additional 20-120 pack of four R315-45 curves** beyond ordinary M1, V1, and V2. Confirm that the regional/versioned V2 package supplies six No.5 piers and two spacers. Individual incline heights and the assembled joint fit are modeled rather than manufacturer-certified. See [the plan's sources and inventory](docs/kato-plan02-1a.md).

## Plan before buying parts

Open **Check before shopping** to review connector gaps and angles, height mismatches, both double-track lanes, grades, supports, and scenery conflicts. Connections must meet within **0.25 mm horizontally and vertically, and 0.25°**. These are the app's connection rules, not KATO manufacturing tolerances. Purchased track lengths stay fixed: the app does not stretch a piece to close a loop.

The ramp builder uses real 248 mm S248 lengths and their shorter horizontal projection when tilted. Grade is rise divided by horizontal run. For example, a 60 mm rise with a 3% maximum takes nine S248 pieces, about 2.23 m of horizontal run at 2.7%. The grade selection is a planning target; no E235-specific maximum climbing grade has been confirmed. Abrupt changes of slope and curved or special-track slopes remain review items.

The confirmed automatic support option is **KATO 23-069**: its 50 mm pier component plus a 10 mm attachment supports the **roadbed bottom at 60 mm** above its base. The Sky Railway uses 16 of these assemblies. Intermediate ramp heights stay listed as needing measured supports; the app does not stretch or float catalog piers to imply a fit. Check attachment compatibility, intermediate supports, and the actual pier footprints before construction.

At a documented ramp-end support, the placement guard permits the attachment's intended contact with its own roadbed while still checking its shaft and every train corridor. The ramp builder reuses an already placed matching pier instead of duplicating it. The report separately flags the tilted attachment for physical verification. The R348-45 single-track viaduct also receives an explicit reminder about KATO's additional intermediate-support requirement.

Placement guards reject modeled obstructions from platforms, posts, piers, and low overhead beams, including curved-track body overhang. A catenary gantry can span the rails when its posts and structural beam clear the train. The overpass check uses a **50 mm baseline between roadbed levels**, with more room for deeper structures: **60 mm for the modeled straight deck girder** and **58 mm for the modeled curved bridge**. These allowances use the modeled E235 with a raised pantograph reaching approximately 45 mm and the upper structure's depth. They are simplified planning assumptions, not manufacturer clearance specifications or checks for every train model.

The report lists errors and unresolved physical checks with buttons to locate the affected pieces. **Save shopping report** exports a CSV with KATO product codes, grouped quantities, source links, geometry notes, and layout issues. Quantities count **individual placed pieces, not retail packs**. Mixed packs and products with included track need review with a model shop to avoid omissions or double counting.

A passing report means the supported modeled checks passed. It does not certify a complete physical layout. Turnout endpoints, crossover routes, graded curves, banking transitions, accessory shapes, and unconfirmed support heights still require actual product templates or measurements before purchase. The E235 source documents an R315 starter layout, used here as a conservative recommendation; its exact minimum radius is unconfirmed. Smaller catalog curves are available for other vehicles and are flagged for this train.

## Keep your layouts

Layouts save automatically in this browser on this computer. **Save a layout file** exports JSON; **Layouts → Open a layout file** imports it on the same or another computer. Keep an exported copy before clearing browser data. If browser storage is unavailable, the header prompts you to download a file to save.

Version 2 saves include track and scenery placements, heights, ramp end heights, stable switch numbers and route settings, and the selected train formation. Original version 1 layout files and earlier 2D browser saves migrate automatically into 3D while preserving their track geometry. Layouts support up to 300 placed tracks and scenery pieces.

## Catalog and appearance

The library has **143 sourced entries**: straights, curves, turnouts, diamond crossings, double track, slab track, viaducts, 29 bridge variants, platforms, stations, piers, incline steps/spacers, catenary poles, signals, buffers, and crossing-gate scenery. Each selection links to its KATO product reference; **Catalog & model references** lists the main official sources.

Track lengths and centerline radii use model millimeters, with a 9 mm rail gauge and 33 mm double-track spacing. The E235 uses Japanese N scale proportions at 1:150. Its lime-green cab and door panels, stainless bodywork, dark glazing, bogies, and rooftop equipment are original procedural models based on [KATO's E235 Yamanote Line](https://www.katomodels.com/product/n/e235_yamanote_slm). Track materials similarly use inspected KATO photographs for ballast, sleepers, rails, viaduct walls, and bridge structures; manufacturer photographs are not bundled as textures.

Each train body stays rigid between its two rail-bound bogies. Coupling pivots use fixed-length articulated links, so the distance along the rail can change through a bend without separating or stretching the cars. Flexible gangway bellows join the moving body ends. The modeled 87.4 mm bogie wheelbase and 50.1 mm coupling link are visual approximations, not measured specifications of KATO's coupling mechanism. Cars appear only when both bogies fit on the connected route; unfinished tracks can show part of the chosen formation.

See [catalog sources and geometry notes](docs/catalog-sources.md) for official links, product-code checks, and the scope of each verification. Principal catalog dimensions are verified for **91 entries**; **52 entries** use explicitly nominal accessory or special-track geometry. “Verified” describes those sourced dimensions, not a certified model or assembled layout. Accessory types share simplified scenery models rather than reproducing every product's exact molded shape. The library is broad, but does not contain the entire KATO range.

Turnout frogs, crossover paths, banking transitions, accessory footprints, and train dynamics are simplified. There is no electrical wiring simulation, traction/derailment model, or hardware control. A diamond crossing keeps its two rail routes separate; geometric intersections alone do not create junctions. Some signal, buffer, and crossing-gate products include track in the real retail pack, but their scenery entries do not place that track automatically. The simulator is not affiliated with or certified by KATO or JR East.

## Develop and check

Use Node.js 24 LTS and open Terminal in the project folder:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. The app is React, TypeScript, and Three.js; it runs entirely in the browser without a backend or external runtime services.

```sh
npm test
npm run build
```

Browser checks use Playwright with one worker. On a Mac, install its Chromium browser once:

```sh
npx playwright install chromium
npm run test:browser
```

In the cloud environment, use the installed system Chromium:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

The configured runner starts Vite automatically and uses software WebGL flags for system Chromium. Unit and browser checks cover track geometry, ramps, clearance guards, shopping reports, switch occupancy, formations, 3D rendering and cameras, movement, saves, migration, and keyboard/dialog behavior. Production output is `dist/`; `npm run preview` serves that build locally.

## Cloud startup and publishing

Use the existing `/workspace/TrainModelSimulator` checkout. Cloud tasks already run in isolation; do not create a Git worktree unless explicitly requested. A repeatable setup is:

```sh
npm ci --cache /workspace/.npm-cache --no-audit --no-fund
npm test
npm run build
npm run dev -- --port 5173
```

Run the browser checks above separately. Restart the development server after a cloud environment snapshot is restored.

The repository is public and GitHub Pages is already configured to serve the **gh-pages** branch at its root. To publish an update, build the app, add an empty `.nojekyll` file to `dist/`, and publish the contents of `dist/` to that branch. Vite's relative asset paths support the project's `/TrainModelSimulator/` address. Verify the Pages deployment before treating an updated build as live.

The same production files can be served by any static web host. Cloud environment publication and website deployment are separate operations; a local Vite development server does not update the public website.
