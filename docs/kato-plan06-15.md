# 新干线与在来线交错运行 — KATO plan 06-15

Open **Layouts → Sample layouts → 新干线与在来线交错运行**. This adds a separate preset; existing layouts, the startup layout, saved designs, train models, and driving controls retain their behavior. The preset opens paused with three-car E235, E5, and E6 trainsets. E7 remains available through the existing train editor.

## Official references

- [Track drawing, plan 06-15](https://www.katomodels.com/unitrackplan/plan/plan06-15.pdf)
- [Two-page package and parts list](https://www.katomodels.com/unitrackplan/plan/plan06-15_partslist.pdf)
- [Common component-name key](https://www.katomodels.com/unitrackplan/common_parts_namelist.pdf)

The drawing labels a footprint of approximately **4153 × 2458 mm**. Its elevated double-track circuit crosses the ground railway, with four blue double-track truss bridges and a four-track elevated station. Ground routes include double track, suburban and local platforms, a station over the tracks, and a diagonal yard with four connected train-shed sections. The 24 turnouts use the existing numbered switch desk.

## Assembled pieces and drawing callouts

The preset uses **294 physical track pieces**: 222 at ground level and 72 at the nominal 60 mm elevated datum. It retains 72 S248 straights. Six additional S248 symbols below the four green TW sheds are exploded assembly callouts pointing to rails already represented beneath the roofs; they are not six disconnected storage tracks. The upper-right block marked **余剰パーツ** contains surplus pieces and is excluded.

The 157 scenery pieces bring the assembled layout to **451 pieces**. Station buildings, piers, and shed roofs drawn away from their installation positions are placed according to the drawing's arrows. Joiners, arrows, electrical leads, controllers, and annotation marks are not placed as scenery. Signals and bumper fittings belong to their track pieces. The new preset has a separate **600-piece** save/edit allowance; other layouts retain their 300-piece limit. Save versions and browser storage keys are unchanged.

## Geometry and source limits

Fixed track lengths and curve radii retain their catalog values. Small rigid translations and rotations close the schematic drawing within the existing **0.25 mm / 0.25°** connector tolerances; no global snapping tolerance is increased and no purchased rail is stretched. The assembly's largest intended connector gap is below 0.18 mm and largest yaw below 0.15°. Ground and elevated crossings remain independent rail routes.

The plan-specific nominal X15R template places both diagonal connectors on the 186 mm longitudinal boundary planes, giving a diagonal route of `186 / cos(15°)` mm. Existing crossing templates keep their geometry. The drawing does not dimension the assembled vertical datums: the 60 mm elevated roadbed, support attachment shapes, scenery footprints, canopy heights, signal fittings, and banking transitions are nominal simulator representations that need physical measurement for a purchased layout.

Scenery uses nominal fitted shapes: island ends taper toward their approaches, station end walls allow the curved cab envelope, and one diagonal bridge pier has a 15 mm longitudinal placement adjustment to clear the ground line. These shapes and positions are simulator assumptions, not measured accessory molds.

The preset's static audit distinguishes the designed, closely spaced turnout approaches from independent track collisions. Local mutually exclusive junction routes can produce a planning warning; train collision reserves and occupied-turnout protection remain active. Directional curve allowances distinguish the inside body chord from the outside cab overhang instead of assuming the larger reserve on both sides. Existing layouts retain their clearance behavior.

The documents contain identity differences that the preset does not silently rewrite:

- The drawing shows four S124 and eight S124PC pieces, while the parts list supplies twelve wood-sleeper S124 pieces. Lengths and combined counts agree; the preset follows the drawing's sleeper types.
- S60L/S60R handed labels differ from the purchased package split. Rail centerlines are straight; the notched roadbed is simplified.
- The parts list prints platform kits as 20-120/121; the common key identifies them as **23-120/121**.
- The parts list's PLTW-HA/HB descriptions differ from the common key. New catalog entries follow the key's window identities and the drawing's placed labels.

These added historical track and scenery entries do not replace the existing catalog templates or introduce additional train models. Ordinary placement, custom station names, multi-train operation, coupling, save/export/import, undo, and turnout protection use their existing controls.
