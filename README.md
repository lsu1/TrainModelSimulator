# Little Railways 3D

**[Play in your browser](https://lsu1.github.io/TrainModelSimulator/)**

A 3D KATO N scale railway playground for a young conductor on a Mac. Build layouts, arrange stations and bridges, explore overpasses, and run independent E235 Yamanote Line, E5, E6, and E7 Shinkansen trainsets together. Visitors need no download, installation, account, or API key. Use a current browser with WebGL 2 graphics support.

## Explore and build

- **Look around:** drag to orbit, right-drag to pan, and scroll to zoom. On a Mac trackpad, use a secondary click to pan. **3D view**, **Top view**, **Train view**, and the fit-view button provide different ways to explore the railway.
- **Choose a layout:** open **Layouts** for **KATO M1 + V1 + V2** (official plan 02-1A with a passing siding, red bridge, slopes, and a three-car train), **Tokyo Railway** (wide loop and 11-car train), **Sky Railway** (60 mm elevated loop above a separate ground-level line), **Small Railway**, or **A fresh adventure**.
- **Place pieces:** search the track box by name, radius, length, or KATO product number. Click a piece to add it, or drag it into the scene. Click a green connector before choosing a track to attach it at that connector's height. Curved pieces have left/right bend controls.
- **Arrange the layout:** choose **Move pieces**, then drag existing tracks or scenery. Nearby compatible track connectors snap together. Select a piece to rotate it by 45°, remove it, or change its height. **Placed pieces** also lets you select an item from a list.
- **Build overpasses:** set **New piece height** before placing a track, or edit a selected piece's **Height**. **Build a gradual ramp** attaches to a selected green connector; choose its finish height and maximum grade, then review the S248 piece count, horizontal run, and unresolved support heights before building. You can also edit a track's **End height** directly. **Add matching piers** places actual catalog supports only where their documented support height matches. Piers are saved pieces; elevated tracks do not silently generate adjustable supports.
- **Run your trains:** use **Your trains** to add **E235 Yamanote Line**, **E5**, **E6**, or **E7 Shinkansen**, including multiple sets of the same model. Choose **3 through 11 cars** per set. Select a train from **Driving**, its card, or its body in the scene, then use the existing Play, speed, reverse and horn controls. The others retain their own journeys. **Train view** follows the selected train; **Pause all** stops the fleet. **Move train** gives a green/red preview for safe manual placement. Trains brake and stop before conflicting trainsets and at open ends. Change a stopped train's model or count only where it fits. See [multi-train controls and limits](docs/multi-train.md).
- **Set the points:** the **Switch control desk** gives every turnout or double crossover a stable number, matching its label in the scene. Use **Straight**, **Branch**, and **Show** to set or locate it. Zoom in to watch the tapered point blades and their connecting bar move between routes. A clear switch can change while trains run, preserving their positions and speeds. A switch occupied by any part of a parked or moving train is protected until it clears.

Keyboard shortcuts: **Space** plays/pauses the selected train, **R** reverses it, **⌘ Z** or **Ctrl Z** undoes, and **Delete/Backspace** removes the selected layout piece. Shortcuts leave text fields and dialogs alone. Editing occupied track is rejected until its train moves or is removed. Harmless track edits preserve valid train positions and pause the fleet. Imports and presets replace the railway and reopen trains paused. Switch controls preserve playback. Undo restores the previous layout and fleet snapshot.

The **KATO M1 + V1 + V2** preset reconstructs [KATO's plan 02-1A](https://www.katomodels.com/unitrackplan/plan/plan02-1a.pdf) with 51 track pieces, 16 numbered incline/step supports, and two approach spacers. Set both numbered switches to **Straight** for the main line or both to **Branch** for the passing siding. The source plan requires **one additional 20-120 pack of four R315-45 curves** beyond ordinary M1, V1, and V2. Confirm that the regional/versioned V2 package supplies six No.5 piers and two spacers. Individual incline heights and the assembled joint fit are modeled rather than manufacturer-certified. See [the plan's sources and inventory](docs/kato-plan02-1a.md).

Speed controls use each model’s maximum passenger-service speed: **Yamanote 90 km/h**, **E5 320 km/h**, **E6 320 km/h**, and **E7 275 km/h**. The slider changes with the selected train, and the train moves at the corresponding N-scale speed. Route notes explain lower limits on particular railway sections. Older Yamanote saves above 90 km/h retain their designs with the speed reduced to 90. See [speed sources and behavior](docs/train-speeds.md).

## Plan before buying parts

Open **Check before shopping** to review connector gaps and angles, height mismatches, both double-track lanes, grades, supports, and scenery conflicts. Connections must meet within **0.25 mm horizontally and vertically, and 0.25°**. These are the app's connection rules, not KATO manufacturing tolerances. Purchased track lengths stay fixed: the app does not stretch a piece to close a loop.

The ramp builder uses real 248 mm S248 lengths and their shorter horizontal projection when tilted. Grade is rise divided by horizontal run. For example, a 60 mm rise with a 3% maximum takes nine S248 pieces, about 2.23 m of horizontal run at 2.7%. The grade selection is a planning target; no E235-specific maximum climbing grade has been confirmed. Abrupt changes of slope and curved or special-track slopes remain review items.

The confirmed automatic support option is **KATO 23-069**: its 50 mm pier component plus a 10 mm attachment supports the **roadbed bottom at 60 mm** above its base. The Sky Railway uses 16 of these assemblies. Intermediate ramp heights stay listed as needing measured supports; the app does not stretch or float catalog piers to imply a fit. Check attachment compatibility, intermediate supports, and the actual pier footprints before construction.

At a documented ramp-end support, the placement guard permits the attachment's intended contact with its own roadbed while still checking its shaft and every train corridor. The ramp builder reuses an already placed matching pier instead of duplicating it. The report separately flags the tilted attachment for physical verification. The R348-45 single-track viaduct also receives an explicit reminder about KATO's additional intermediate-support requirement.

Placement guards reject modeled obstructions from platforms, posts, piers, and low overhead beams, including curved-track body overhang. A catenary gantry can span the rails when its posts and structural beam clear the train. The overpass check uses a **50 mm baseline between roadbed levels**, with more room for deeper structures: **60 mm for the modeled straight deck girder** and **58 mm for the modeled curved bridge**. The horizontal corridor uses the selected train’s width, bogie chord, and longest cab overhang. The conservative vertical allowance reserves 45 mm for rolling stock plus the upper structure’s depth. These are simplified planning assumptions, not manufacturer clearance specifications.

The report lists errors and unresolved physical checks with buttons to locate the affected pieces. **Save shopping report** exports a CSV with KATO product codes, grouped quantities, source links, geometry notes, and layout issues. Quantities count **individual placed pieces, not retail packs**. Mixed packs and products with included track need review with a model shop to avoid omissions or double counting.

A passing report means the supported modeled checks passed. It does not certify a complete physical layout. Turnout endpoints, crossover routes, graded curves, banking transitions, accessory shapes, and unconfirmed support heights still require actual product templates or measurements before purchase. The E235 source documents an R315 starter layout, used here as a conservative recommendation; its exact minimum radius is unconfirmed. The referenced KATO Shinkansen products have sourced minimum radii of R315 for E5 and E7 and R282 for E6; the report flags smaller curves for the selected train.

## Keep your layouts

Choose **Save layout** above the scene and give the design a name. Its independent snapshot appears in **Layouts → Your saved layouts**, so you can start a fresh adventure and reopen an earlier design later. **Save changes** updates the saved design you opened; **Save as copy** keeps another version. Saved designs include the track, scenery, heights, switches, every train's configuration and placement, the selected train, and source-plan information. Trains reopen paused. Deleting a saved snapshot leaves the open railway in place. Undo retains which saved design a railway belongs to.

The current working railway also autosaves, separately from your named designs. Both stay in this browser on this computer. **Save a layout file** exports JSON; **Layouts → Open a layout file** imports it on the same or another computer. Keep an exported copy before clearing browser data. A failed library write leaves previous saved designs intact and displays an error.

Version 3 saves include the fleet's identities, model choices, formations, track positions, physical orientations and requested speeds, alongside the existing track and scenery data. Version 1 and 2 files migrate into one independent trainset; older saves without a model still default to E235. Earlier 2D browser saves preserve their track geometry during migration. Layouts support up to 300 placed tracks and scenery pieces and 12 trainsets.

## Catalog and appearance

The library has **143 sourced entries**: straights, curves, turnouts, diamond crossings, double track, slab track, viaducts, 29 bridge variants, platforms, stations, piers, incline steps/spacers, catenary poles, signals, buffers, and crossing-gate scenery. Each selection links to its KATO product reference; **Catalog & model references** lists the main official sources.

Track lengths and centerline radii use model millimeters, with a 9 mm rail gauge and 33 mm double-track spacing. The E235 uses Japanese N scale proportions at 1:150. Its lime-green cab and door panels, stainless bodywork, dark glazing, bogies, and rooftop equipment are original procedural models based on [KATO's E235 Yamanote Line](https://www.katomodels.com/product/n/e235_yamanote_slm). The Shinkansen use 1:160 proportions, distinct smooth nose profiles, cab windows, passenger doors, skirts, roof equipment, and their green/pink, red/silver, or blue/ivory/copper liveries. Both formation ends have cabs. See [Shinkansen references](docs/shinkansen-trains.md) for the inspected JR East and KATO photographs and dimension limits. Track materials similarly use inspected KATO photographs for ballast, sleepers, rails, viaduct walls, and bridge structures; manufacturer photographs are not bundled as textures.

Each train body stays rigid between its two rail-bound bogies. Coupling pivots use fixed-length articulated links, so the distance along the rail can change through a bend without separating or stretching the cars. Flexible gangway bellows join the moving body ends. The E235 retains its modeled 87.4 mm bogie wheelbase and 50.1 mm coupling link. Each Shinkansen uses its own body length and bogie chord, with longer outer cab cars and pair-specific coupling links. These are visual approximations, not measured specifications of KATO’s coupling mechanism. New train placement requires the complete formation to fit; original single-train layouts retain partial-train rendering on unfinished open track. E5–E6 nose coupling remains a future feature.

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
