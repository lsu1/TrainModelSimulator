# E5 / E6 nose mechanisms

The simulator couples the E5 E514 cab (car 10) to the E6 E611 cab (car 11). The existing model arrays retain these roles in short formations: E5 index 0 and E6's last index. The opposite cabs, E7, and E235 have no opening nose mechanism.

## Play and operation

Open **Layouts → Coupling station**, select either set, then press **Couple trains**. The practice oval uses fixed S248 straights and R381-30 curves, with 2,976 mm straight approaches. Its two three-car sets start paused with their closed noses 80 mm apart. The same straight also fits the authentic seven-car E6 plus ten-car E5 formation.

Joining and separating open **Nose view** automatically and bring the scene into view. Continuing a paused operation also brings the scene back into sight. This camera follows the two mechanical mating faces, so the opening panels and shared joint stay visible. Drag to look around and scroll to zoom; press **Nose view** again to reset the close-up. Other camera views remain available.

Joining requires one independent E5 and one independent E6, both fully placed and stopped. Their equipped noses must face each other along the same connected, straight, nearly level rail route. Parallel lanes and overpasses are not accepted merely because they are close in the 3D view. The approach must be within 200 model mm of engagement and clear for the complete formation and opening panels. The interface explains the first unmet condition.

Both noses open before the E5 creeps toward the stationary E6 at a scale equivalent of 3 km/h. The mechanical heads lock at their shared mating face. There is one common speed, acceleration, braking and reverse command after joining; selecting either train controls both. Individual sets still use 3–11 cars, so the combined count can be 6–22. The maximum shared speed is 320 km/h. Bodies, wheelbase chords, internal links and the nose joint remain rigid through curves, grades and selected turnout routes.

To separate, stop on another clear, straight, nearly level section and press **Decouple trains**. After unlocking, E5 moves back 55 model mm. The couplers retract and covers close only after this clearance is reached. Both original sets then remain paused with separate controls and exact rail placements. Individual model/count changes, moving and removal require separating first.

**Pause coupling**, **Pause all**, or Space freezes the active operation; **Continue coupling** or Space resumes it. Camera controls remain usable. Editing track, changing switches, driving trains, loading/saving/exporting layouts and undo wait until the operation finishes. A completed join or split is one undo step. Only the intended mechanical-head contact is exempted; other car parts and unrelated trains retain physical contact checks and the existing conservative collision reserves.

## Saves and interrupted operations

Layout version 4 stores trainsets and their settled relationship, with E6's original cab as the canonical rail reference and E5's exact reference derived by the shared formation solver. Named saved designs, copies and exported layouts retain the pair. All reopened trainsets start paused; coupled sets retain open, locked noses. Earlier v1/v2/v3 layouts remain readable and preserve their existing track and fleet data.

Animation progress is runtime state. Periodic autosave and browser-close recovery retain the last settled independent/coupled snapshot during a transition. Reloading midway through joining therefore restores the original stopped independent sets with closed covers; reloading midway through separation restores the original stopped coupled formation. This prevents partial relationships and overlapping closed noses in saved files.

## References and limits

- [KATO E5 product page](https://www.katomodels.com/product/n/e5kei_hayabusa_slm) identifies E514's opening nose coupling mechanism.
- [KATO E6 product page](https://www.katomodels.com/product/n/e6kei_komachi) identifies E611/car 11 as the E5/H5 coupling end.
- Photographs of the [E5 open nose](https://www.dreamstime.com/editorial-stock-image-e-series-bullet-train-opens-nose-cover-coupling-process-iwate-japan-april-green-high-speed-aomori-couples-image76584224) and [E6 open nose](https://www.dreamstime.com/editorial-image-e-series-bullet-train-opens-nose-cover-coupling-process-iwate-japan-april-red-high-speed-akita-couples-image76584340), taken at Morioka on 19 April 2016, show a retained rim, a dark opening, an exposed central mechanical head, and covers stowed inside the nose.
- [JR East Technical Review No. 31, page 29, section 2.1](https://www.jreast.co.jp/development/tech/pdf_31/Tech-31-29-30.pdf) describes a cover that advances, opens sideways, and stows inside the body. This article concerns the predecessor FASTECH360 test vehicles; it does not verify production E5/E6 mechanism paths.
- Production video references were located for [E5 opening](https://www.youtube.com/watch?v=FWXyoYbv29k) and an [E611-1 mechanism demonstration](https://www.youtube.com/watch?v=I8ZFWFxvdMQ). The cloud proxy blocked both video pages during implementation, so their frames could not be inspected.

The implementation uses the photographed open appearance and a clear-seam, sideways, inward translation sequence. E5 and E6 have separate cap dimensions, lateral clearance, retract distances, and timing. These paths are illustrative rigid motion, not measured production hinge/actuator kinematics. Coupler head dimensions, mechanical details, and extension distances are procedural approximations rather than KATO mechanism specifications.

## Retained geometry and coordinates

The coupling-equipped nose is cut from its existing triangle surfaces. The shell, primary paint, chin paint, and any intersecting belt are split at the same longitudinal plane, then at the center line into left/right cap pieces. Interpolated positions, normals, and texture coordinates retain the original closed outline and shared materials. Paint is attached to the moving cap, rather than opening only a silver overlay while leaving a solid shell underneath.

Caps retain inner skins and all original geometry throughout opening. Their group transforms use translations only; there are no opacity fades, geometry substitutions, object visibility changes, or animated scale changes. The cavity has separate lining/rim sectors, which preserve the open void when safety extracts convex mesh parts.

Each cab exterior uses local +X outward, +Y upward, and Z lateral. The E6 rear exterior already has its existing 180-degree rotation, so the same local convention applies to both ends. `NOSE_COUPLER_PROFILES` in `couplingTypes.ts` defines the body-mounted pivot from the original nose tip and its fixed full extension. At full extension, the mating face is exactly 11 mm from the E5 pivot and 10 mm from the E6 pivot. Both pivots are 9.5 mm above rail contact.

The retained guide socket surrounds a rigid sliding arm and mechanical head. The whole assembly swivels about the body mount toward the formation solver's shared joint axis. Its full extension stays fixed while taking curves and gradients. Only the mechanical head has `mechanicalCouplerContact: true`; covers, arms, mounts, electrical details, bodywork, and other cars retain ordinary physical checks.

`getNoseCouplerDiagnostics()` reads actual current transforms for the pivot, mating face, mechanical head, and covers. These diagnostics allow browser checks to confirm the rendered anchors, including parked nose animation, rather than substituting idealized nominal tips.

## Focused verification

Nose tests compare closed shell/paint triangle areas with unchanged opposite cab geometry, to within two parts per million. They also check the correct physical cab roles, retained rigid geometry across opening/closing, exact pivot/face dimensions, articulated fixed-length reach, isolated mechanical-contact marking, unaffected E7/unsupported ends, and disposal of all retained geometry/materials. The existing Shinkansen body and roof tests continue to pass.
