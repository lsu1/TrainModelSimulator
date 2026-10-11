# Yamanote cab coupling

Version **0.13.0** lets two **E235 Yamanote Line** trainsets join at their facing cabs. The simulator uses exposed mechanical couplers below the cab faces, without the retracting couplers or opening nose covers used by its Shinkansen models. E235 can join only another E235, and each trainset can have one partner.

## What the real train supports

[TOMIX N information room No. 255](https://www.tomytec.co.jp/tomix/report/n/nj_255.html), published by TOMYTEC on 23 December 2020, compares Yamanote **E235-0** with Yokosuka/Sobu **E235-1000**. It states: **「先頭車同士の連結は非常時以外は行われていません」** — coupling between Yamanote leading cars is performed only in emergencies. The same article explains that the E235-1000 regularly combines an 11-car main set and a four-car additional set, and has a different cab coupler/skirt arrangement.

This source supports emergency physical cab-to-cab coupling for E235-0. It does not establish ordinary coupled passenger operation, shared traction commands, an electrical control arrangement for rescue, or a permitted towing speed. The simulator's shared play controls and **90 km/h** cap are deliberate simplifications, not a real rescue procedure or authorized rescue speed. Its short approach and separation animations are also illustrative. Coupler dimensions and movement are procedural visual choices rather than measured train or KATO hardware specifications.

## Join, drive, and separate

Use **New train**, choose **E235 Yamanote Line** and **3–11 cars**, then **Add train** for each set. Stop both sets with their facing cabs nearby on the same connected rail route. Select either train, choose the other E235 as its partner in the lower driving dock, and press **Couple trains**. Either front or rear cab can connect; the nearby ends are detected automatically. Parallel lanes and overpasses remain separate routes.

The exposed heads approach and lock without a cover-opening stage. **Coupler view** follows the joint; drag to orbit and scroll to zoom. **Pause coupling** and **Continue coupling**, or Space during the operation, freeze and resume it. The complete combined formation must fit on connected rails and clear other trainsets and scenery.

A joined pair has **6–22 cars** while retaining both original identities, names, models, car ordering, and roof equipment. Selecting either member drives both with shared speed, braking, pause, and reverse controls. Stop both sets before changing a car count; the new complete formation must still fit safely. Separate them before changing a model or removing one set.

Stop with room to move apart and choose **Decouple trains**. The heads unlock and one set moves back **55 model mm**. Both sets remain paused with independent controls; their cab couplers stay exposed. Occupied-track protection, turnout protection, and checks against unrelated trains remain active while the sets are joined and during approach and separation.

## Save and reopen

Settled E235/E235 partnerships use the existing **version 5** layout format, storage keys, and named-design library. The existing `e6Id` and `e5Id` fields identify the reference train and its partner; optional `e6End` and `e5End` preserve their connected cab ends. A front-to-front pair exports and imports with those ends and its original track positions intact. Named copies remain independent snapshots.

Reopened trains start paused, and the joint is reconstructed from the saved partnership. During a transition, autosave and browser-close recovery retain the last complete state rather than a partial join. Version 4 keeps its original E6/E5 validation; older independent E235 layouts remain independent until the user couples them. Mixed E235/Shinkansen saved relationships are rejected.

The former Coupling station practice shortcut remains removed. Add trains to an ordinary existing or newly built railway; no additional preset is required.
