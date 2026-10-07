# Little Railways 3D

**[Play in your browser](https://lsu1.github.io/TrainModelSimulator/)**

A 3D KATO N scale railway playground for a young conductor on a Mac. Build layouts, arrange stations and bridges, explore overpasses, and run a silver-and-lime-green E235 Yamanote Line train. Visitors need no download, installation, account, or API key. Use a current browser with WebGL 2 graphics support.

## Explore and build

- **Look around:** drag to orbit, right-drag to pan, and scroll to zoom. On a Mac trackpad, use a secondary click to pan. **3D view**, **Top view**, **Train view**, and the fit-view button provide different ways to explore the railway.
- **Choose a layout:** open **Layouts** for **Tokyo Railway** (wide loop and 11-car train), **Sky Railway** (elevated loop above a separate ground-level line), **Small Railway** (compact loop and three-car train), or **A fresh adventure**.
- **Place pieces:** search the track box by name, radius, length, or KATO product number. Click a piece to add it, or drag it into the scene. Click a green connector before choosing a track to attach it at that connector's height. Curved pieces have left/right bend controls.
- **Arrange the layout:** choose **Move pieces**, then drag existing tracks or scenery. Nearby compatible track connectors snap together. Select a piece to rotate it by 45°, remove it, or change its height. **Placed pieces** also lets you select an item from a list.
- **Build overpasses:** set **New piece height** before placing a track, or edit a selected piece's **Height**. Give a selected track a different **End height** to create a ramp. Connections require matching endpoint heights; intersecting tracks at different heights stay separate. Elevated viaducts and bridges have generated supports, and additional pier scenery is available.
- **Run the train:** press Play, adjust speed, reverse, or sound the horn. Choose **3**, **6**, or **11 cars**. Select a turnout or double crossover and choose **Straight route** or **Branch route**. The train follows connected rails and stops at an open end or points set against its route. **Train view** follows the journey.

Keyboard shortcuts: **Space** plays/pauses, **R** reverses, **⌘ Z** or **Ctrl Z** undoes, and **Delete/Backspace** removes the selection. Shortcuts leave text fields and dialogs alone. Editing a layout pauses and resets the train; Undo restores previous layout changes, including imports and preset changes.

## Keep your layouts

Layouts save automatically in this browser on this computer. **Save a layout file** exports JSON; **Layouts → Open a layout file** imports it on the same or another computer. Keep an exported copy before clearing browser data. If browser storage is unavailable, the header prompts you to download a file to save.

Version 2 saves include track and scenery placements, heights, ramp end heights, turnout settings, and the selected train formation. Original version 1 layout files and earlier 2D browser saves migrate automatically into 3D while preserving their track geometry. Layouts support up to 300 placed tracks and scenery pieces.

## Catalog and appearance

The library has **135 sourced entries**: straights, curves, turnouts, diamond crossings, double track, slab track, viaducts, 29 bridge variants, platforms, stations, piers, catenary poles, signals, buffers, and crossing-gate scenery. Each selection links to its KATO product reference; **Catalog & model references** lists the main official sources.

Track lengths and centerline radii use model millimeters, with a 9 mm rail gauge and 33 mm double-track spacing. The E235 uses Japanese N scale proportions at 1:150. Its lime-green cab and door panels, stainless bodywork, dark glazing, bogies, and rooftop equipment are original procedural models based on [KATO's E235 Yamanote Line](https://www.katomodels.com/product/n/e235_yamanote_slm). Track materials similarly use inspected KATO photographs for ballast, sleepers, rails, viaduct walls, and bridge structures; manufacturer photographs are not bundled as textures.

See [catalog sources and geometry notes](docs/catalog-sources.md) for official links, product-code checks, and the scope of each verification. Main track dimensions are verified for 98 entries; 37 entries use explicitly nominal accessory or special-track geometry. Accessory types share simplified scenery models rather than reproducing every product's exact molded shape. The library is broad, but does not contain the entire KATO range.

This is a visual railway playground. Turnout frogs, crossover paths, banking transitions, accessory footprints, and train dynamics are simplified. There is no physical clearance or collision analysis, electrical wiring simulation, traction/derailment model, or hardware control. A diamond crossing keeps its two rail routes separate; geometric intersections alone do not create junctions. Some signal, buffer, and crossing-gate products include track in the real retail pack, but their scenery entries do not place that track automatically. Check actual product geometry, train minimum radii, gradients, and clearances when translating a virtual layout into a physical one.

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

The configured runner starts Vite automatically and uses software WebGL flags for system Chromium. Browser checks cover 3D rendering and cameras, drag placement and movement, snapping, train operation, formations, heights, turnouts, saves, migration, and keyboard/dialog behavior. Production output is `dist/`; `npm run preview` serves that build locally.

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
