# Shinkansen nose coupling

Version **0.9.0** lets any two **E5, E6, or E7** trainsets join nose to nose, including two of the same model. Both cab ends have opening mechanisms, and the simulator chooses the nearby ends automatically. Joining and separating can happen on curves and grades when the rails connect and the train bodies and opening covers have enough room.

These are playful combinations. The E5/E6 references below inspire the appearance; the E7 mechanism, opposite-end mechanisms, and unrestricted pairings do not represent real production capabilities. E235 remains independent, and a Shinkansen can have one partner at a time.

## Choose and join a pair

Open **Layouts → Coupling station**. Choose each train's model and **3–11 cars**, then press **Start coupling practice**. The practice oval uses fixed S248 straights and R381-30 curves; it grows its straight sections to fit the selected pair. The sets start paused with their closed noses 80 model mm apart. **Try 17 cars: E6 (7) + E5 (10)** starts that longer configuration directly. Changing the practice choices starts a new railway, so save an existing design first.

Select either train and press **Couple trains**. For another layout, stop two independent Shinkansen with any two noses near each other on the same connected rail route. The interface detects the ends and explains an unmet condition. Parallel lanes and overpasses do not become connected just because their noses look close in 3D. The approach must be within **200 model mm** of engagement and clear for every car and both opening mechanisms.

The covers and couplers take **three seconds** to open fully. One set then creeps toward the other at an N-scale equivalent of **3 km/h**, and the mechanical heads lock. The shorter connector brings the open nose centers close together while remaining articulated through curves and slopes.

Joining and separating open **Nose view** automatically and bring the scene into view. This camera follows the mating faces. Drag to orbit, scroll to zoom, or press **Nose view** again to reset the close-up. Other camera views remain available. **Pause coupling**, **Pause all**, or Space freezes an active operation; **Continue coupling** or Space resumes it.

## Drive, resize, and separate

Selecting either connected train addresses the whole formation: one shared speed, acceleration, braking, pause, and reverse command. Each set retains its own model, identity, car ordering, and roof equipment. With **3–11 cars per set**, the pair can contain **6–22 cars**. Its maximum shared speed is the lower member limit: **275 km/h with E7**, otherwise **320 km/h**.

Stop the formation to change either partner's **Cars** value. A change keeps the partnership when the new complete formation fits on the existing rails and clears other trains; an unsafe change is rejected. Separate partners before changing their models, moving an individual set, or removing it.

To separate, stop with enough clear connected track and press **Decouple trains**. The heads unlock, one set moves back **55 model mm**, and the couplers retract and covers close over **three seconds**. Both original sets then remain paused with separate controls and their rail placements preserved. Curves and grades remain allowed when the mechanisms and bodies have sufficient clearance.

Track editing, switch changes, driving, layout loading/saving/exporting, and undo wait until a coupling operation finishes. A completed join or split is one undo step. Only the intended mechanical-head contact is exempted from contact checks; covers, arms, bodywork, other cars, and unrelated trains retain the physical checks and collision reserves.

## Save and reopen

Layout **version 5** stores settled partnerships and the cab ends used. The two train IDs remain distinct. Internal `e6Id` and `e5Id` field names are retained for compatibility: they identify the reference train and its partner, which can now be any Shinkansen models. Optional `e6End` and `e5End` identify their physical cab ends. When absent, they use the original rear/front pairing. Named designs, copies, autosave, and exported layouts retain a settled pair. Reopened sets start **paused**, with joined noses open and locked.

Earlier **v1–v4** files remain readable. Version 4 restores its E6/E5 relationship with the original cab ends; version 3 preserves independent sets; versions 1 and 2 migrate to one trainset.

Animation progress stays in runtime state. Autosave and browser-close recovery keep the last settled independent or coupled snapshot during a transition. Reloading during joining restores the original stopped independent sets with closed covers; reloading during separation restores the original stopped coupled pair. Partial relationships and overlapping closed noses are not written to saved layouts.

## Appearance and geometry

Opening caps are partitioned from the original shell and paint triangles, keeping the original closed outline and materials. Their opening edges are beveled so the noses can meet closely through a curve while the wider side edges retain clearance. Caps keep their inner skins and original geometry throughout opening, using rigid translations rather than fades, replacement geometry, or animated stretching. Separate liner and rim sectors preserve the open cavity in physical contact checks.

Each cab exterior uses local +X outward, +Y upward, and Z lateral. `NOSE_COUPLER_PROFILES` in `couplingTypes.ts` defines the body-mounted pivot and fixed extension for each model. All three models use a **3.5 mm pivot-to-mating-face reach**, giving a **7 mm joint between the two body-mounted pivots**. The opening rims have approximately **1 mm clearance at their centers** on straight track. Bevels provide more room at their sides. These dimensions are procedural visual choices, not measurements of KATO hardware.

The retained guide socket surrounds a rigid sliding arm and mechanical head. The assembly swivels about its body mount toward the shared joint axis. Its extended reach remains fixed through curves and gradients. The selected cab opens while the opposite cab stays closed. Only the head carries the `mechanicalCouplerContact` marker.

`getNoseCouplerDiagnostics()` reads current rendered transforms for the selected cab end, pivot, mating face, mechanical head, and covers. Focused checks cover every model/end pairing, fixed reach, preserved closed shell and paint geometry, retained opening panels, curves and grades, larger formations, shared controls, and saved-layout migration.

## Visual references

- [KATO E5 product page](https://www.katomodels.com/product/n/e5kei_hayabusa_slm) identifies E514's opening nose coupling mechanism.
- [KATO E6 product page](https://www.katomodels.com/product/n/e6kei_komachi) identifies E611/car 11 as the E5/H5 coupling end.
- Photographs of the [E5 open nose](https://www.dreamstime.com/editorial-stock-image-e-series-bullet-train-opens-nose-cover-coupling-process-iwate-japan-april-green-high-speed-aomori-couples-image76584224) and [E6 open nose](https://www.dreamstime.com/editorial-image-e-series-bullet-train-opens-nose-cover-coupling-process-iwate-japan-april-red-high-speed-akita-couples-image76584340), taken at Morioka on 19 April 2016, show a retained rim, dark opening, exposed central mechanical head, and covers stowed inside the nose.
- [JR East Technical Review No. 31, page 29, section 2.1](https://www.jreast.co.jp/development/tech/pdf_31/Tech-31-29-30.pdf) describes covers that advance, open sideways, and stow inside the body on the predecessor FASTECH360 test vehicles. It does not verify production E5/E6 mechanism paths.
- Production video references were located for [E5 opening](https://www.youtube.com/watch?v=FWXyoYbv29k) and an [E611-1 mechanism demonstration](https://www.youtube.com/watch?v=I8ZFWFxvdMQ). The cloud proxy blocked those pages during the original implementation, so their frames could not be inspected.

The procedural motion uses a clear-seam, sideways, inward sequence inspired by those photographs and the test-vehicle description. Model-specific cap dimensions and stow paths are illustrative rigid motion, rather than measured hinge or actuator kinematics. Photographs are references only and are not bundled as textures.
