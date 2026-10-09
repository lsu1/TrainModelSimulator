# Independent trains

The simulator supports independent E235 Yamanote Line, E5, E6 and E7 trainsets on one railway. You can add the same model more than once. Existing train meshes, colors, car dimensions, bogies and articulated inter-car connections are reused for every instance.

## Add, select and drive

Use **Your trains** below the scene to choose a model and **3–11 cars**, then press **Add train**. The simulator searches connected rails for a free place where the complete formation fits. If no suitable place is available, the new train stays unplaced and offers a placement preview. Trainsets have separate identities and names, including repeated models.

Choose a train from **Driving**, click its card, or click its body in the scene. The existing Play/Pause, speed, reverse and horn controls address that train. **Train view** follows the selected formation. Other trains retain their own position, speed and operating state when selection changes. **Pause all** stops every train immediately.

Speed changes use a short acceleration or braking ramp. Pause stops the selected train immediately. Reversing a moving train brakes it to a stop before changing direction; reversing a stopped train preserves its physical placement. Change a train's model or car count while it is stopped. The change must fit at the existing rail position and must clear other trainsets.

**Move train** or **Place train** starts manual placement. Hover over a rail lane to see the whole formation: green means valid, red means invalid. Choose the direction with the placement control, then click to place. A rejected click retains the old placement. Cancel leaves the train where it was. Placement pauses the fleet so its preview cannot become stale while another train approaches.

**Remove selected train** removes only that set. Track pieces and the other trainsets remain. The current limit is **12 trainsets**, with performance depending on carriage count, layout size and browser graphics capabilities.

## Trains sharing the railway

Every train follows the existing track graph and rigid-car pose solver independently. Parallel tracks and tracks at different heights remain separate. The safety controller uses whole-car body envelopes, braking lookahead and small swept movement steps to stop following, opposing and conflicting trains before their bodies overlap. Long Shinkansen cab overhang counts in these checks.

A blocked train displays a reason such as another train ahead or an open end. Move the obstruction, select another route, or reverse, then press Play to restart it. This is basic collision prevention; the simulator does not implement a real railway signalling or timetable system.

Contact between cars in the same formation uses their rounded procedural bodies and localized roof fittings. Version 0.7.3 fixes the false curve stops caused by treating reserved headroom as solid bodywork on the KATO preset’s incline. Genuine contact still stops the train. See [curve and slope contact checks](train-collision-checks.md) for the correction and verification limits.

Turnouts beneath **parked or moving** trains cannot change until the complete formation clears. A clear switch can still change without relocating unrelated trains. Moving, rotating, raising or deleting occupied track is also rejected. Move or remove its train first. Harmless track edits retain valid train positions; changes to the track network pause the fleet for review. Undo restores the saved fleet at the preceding edit boundary.

New placement requires every car to fit on connected track and rejects overlap or a formation wrapping into itself on a short loop. Original single-train layouts retain their older partial-train behavior on unfinished open track. This compatibility case does not permit unsafe placement of additional trainsets.

## Save and reopen

Named layouts, autosave and exported JSON files include each train's identity, model, car count, track position, direction, orientation and requested speed, plus the selected train. Reopened or imported trains start **paused**. Running animation state is deliberately excluded from saved files.

Version **5** stores the fleet, settled Shinkansen partnerships, and each partner's connected cab end. Version 4 E5/E6 partnerships retain their original ends; version 3 retains its independent sets; earlier version 1 and 2 layouts migrate to one independent trainset. A missing model selection still defaults to E235. Named saved designs continue using the existing layout library. Browser storage remains local to this browser and computer, so export a layout file for a portable backup. During a joining/separating animation, autosave retains the last complete configuration; an interrupted operation reopens safely paused at that configuration.

## Implementation and checks

`fleet.ts` defines stable train snapshots and runtime state. `fleetMotion.ts` advances all trains from one shared clock and commits resolved motion together. `trainPlacement.ts` validates placement; `trainSafety.ts` builds and checks train footprints. `Scene3D.tsx` retains separate rendered cars and connections for each stable train identity. Selection changes the controls and camera target without replacing the rest of the fleet.

Unit checks exercise placement, head-on and following conflicts, crossing approaches, parallel and elevated tracks, multi-train interactions, saved-layout migration and clearance review. Browser checks cover all four models and duplicate E5 sets, independent controls, selection, removal, unsafe placement, high-speed conflicts, paused saves, old layouts and a small-screen interface. Existing single-train curve and gradient checks continue to verify the same car and connector geometry.

## Connected Shinkansen

Version **0.9.0** lets any two E5, E6, or E7 sets join, including two of the same model. Either cab end can connect on straight, curved, or graded track, with the nearby ends detected automatically. They still need a shared rail route and enough clear space for the complete formation and opening covers. These are playful combinations; real trains do not support every pairing. E235 remains independent, and each Shinkansen can have one partner.

Both original train IDs, names, models, counts and roof roles remain distinct while one shared solver advances the formation. Selecting either member drives both. The shared maximum speed is the lower member limit: **275 km/h when E7 is included**, otherwise **320 km/h**. Pause or reverse affects both partners.

Choose each model and **3–11 cars** in **Layouts → Coupling station**, or use **Try 17 cars: E6 (7) + E5 (10)**. The practice oval grows to fit the chosen sets. A connected formation can therefore have **6–22 cars**; its complete length must fit safely on the railway. Stop both partners to change either car count while keeping them joined. A count change is rejected if the resulting formation would not fit or would touch another train. Separate partners before changing their models, moving an individual set, or removing it. See [joining, splitting and mechanism references](shinkansen-nose-coupling.md).
