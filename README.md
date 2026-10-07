# Little Railways

A browser railway playground for a seven-year-old who knows Kato N Scale trains. Build a layout, connect pieces, and run a little train through it. The first prototype is designed for a Mac with a mouse or trackpad.

## Web hosting

The production build is a static website. It needs no backend or API keys, and the simulator runs entirely in the visitor's browser. Relative asset paths support deployment beneath a project path such as GitHub Pages.

For GitHub Pages, build with `npm run build`, publish the contents of `dist/` with an empty `.nojekyll` file to the `gh-pages` branch, then enable **Settings → Pages → Deploy from a branch → gh-pages → /(root)**. The expected project address is `https://lsu1.github.io/TrainModelSimulator/`; that address works only after Pages is enabled and its deployment completes. The website is intended to be publicly accessible. Do not change repository visibility to enable Pages without the owner's instruction.

Any other static host can serve the same `dist/` directory. Once hosted, visitors only need a browser. Layouts stay in that browser's local storage and can still be exported/imported as files.

## Run on a Mac

Install Node.js 24 LTS, then open Terminal in this project's directory:

```sh
npm ci
npm run dev
```

Open the address printed by Vite in your browser. All graphics and sound are generated locally. The running app needs no account, API key, database, or external service. Dependencies need Internet access during installation.

## Play

- Start with Sunny Valley or Pocket Railway from **Layouts**, or choose **A fresh adventure**.
- On an empty board, click a straight or a curved piece to start. Click a green **+** to choose an open end, then add another piece. Compatible ends join automatically.
- Curves can bend left or right. Eight matching 45° curves make a circle. Use equal straight lengths on opposite sides to make an oval.
- Click a track piece to select it and use **Remove** to change a loop. **Undo** brings back your last change, including a change of starter layout or an imported layout.
- **Play**, the speed slider, **Reverse**, and **Toot toot** control the train. It stops at an open end. A lap counts a full route's distance without a change of direction.
- **Space** plays or pauses, **R** reverses, **⌘ Z** undoes, and **Delete/Backspace** removes the selected piece. Keyboard shortcuts do not interrupt text inputs or dialogs.
- The layout saves in this browser on this computer. **Save a layout file** downloads JSON; **Layouts → Open a layout file** restores it, including on another computer. Downloads are useful before clearing browser data.

## Development and checks

```sh
npm test
npm run build
```

Browser tests use Playwright. On your Mac, install its browser once:

```sh
npx playwright install chromium
npm run test:browser
```

The cloud machine already has Chromium. There, use:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

The test runner starts Vite automatically if it is not already running. Production output is in `dist/`; `npm run preview` serves that build.

## Track geometry and current scope

Coordinates and lengths use millimetres at the track centreline. The prototype includes 248, 124, and 62 mm straights and nominal R249, R282, R315, and R348 curves at 45°. It uses a top-down view, automatic endpoint attachment, and a simplified train animation at N Scale (1:160).

This is a virtual playground, with no turnout routing, crossings, track clearance analysis, exact Kato product numbers, locomotive radius compatibility, electrical wiring, or hardware control yet. Reverse preserves the train's facing direction while moving backwards; cars are sampled along the track as a simplified consist, rather than simulating individual bogies and couplers. Cars near an open end can disappear when there is insufficient track behind the locomotive.

Before purchasing or assembling a physical layout, check the current catalog, footprint, rolling stock clearances, and minimum radius. Official references: [KATO USA Unitrack](https://katousa.com/n-unitrack/) and [KATO N Scale lineup](https://www.katomodels.com/product/n/unitrack_lineup). Live catalog verification was blocked by the cloud network policy during development, so dimensions here are nominal rather than a certified bill of materials.

## Cloud startup

Use the existing `/workspace/TrainModelSimulator` checkout. Each cloud task is isolated; a Git worktree is unnecessary. Install with `npm ci --cache /workspace/.npm-cache --no-audit --no-fund`, then run the build and unit tests. Start Vite using `npm run dev -- --port 5173`; validate the page with a local request and run the browser checks above. Live servers must restart after the environment snapshot is restored.

Cloud environment publication and website deployment are separate operations. A running Vite server in a cloud task is not a public website; GitHub Pages or another static host must serve the production files for visitors.
