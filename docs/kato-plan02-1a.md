# KATO plan 02-1A: sources, parts, and modeling limits

Checked against official KATO material on 7 October 2026. The source layout is **プラン02-1A ロングラン満喫プラン（基本プランA）**, approximately “Plan 02-1A: enjoy a long run, basic plan A.” KATO describes it as **M1 + V1 + V2 + additional R315-45 track**. The additional curves are necessary; the three boxed sets alone do not supply the drawing's track inventory.

## Official sources

- [KATO plan page](https://www.katomodels.com/unitrackplan/plan_p2), section 02-1A: plan identity, M1/V1/V2 combination, additional R315-45, and approximate size 2600 × 1400 mm.
- [Plan drawing PDF](https://www.katomodels.com/unitrackplan/plan/plan02-1a.pdf): track labels, geometry, bridge crossing, support positions, and **2620 × 1403 mm** printed size. SHA-256: `2dbe3b432254050508b5dbda1b44a01dec899b35cf554b2b0a747b1565801c9a`.
- [Plan parts-list PDF](https://www.katomodels.com/unitrackplan/plan/plan02-1a_partslist.pdf): legacy boxed sets and one additional 20-120 pack. This is a scanned table, inspected as an image. Its M1 is **20-850** with a Standard S controller, so its prices and controller code are historical. SHA-256: `ee139b08c29433b56b97e97f6c357e9a1fe87479292d011c80afb0d4ddaee8de`.
- [Official symbol key PDF](https://www.katomodels.com/unitrackplan/common_parts_namelist.pdf), updated 24 March 2020: pages 1–2 map track symbols to product codes; page 3 identifies `S`, `SPC`, numbered piers, and `SJ`. SHA-256: `600efd48ff272b1c1f7bc0b59e1a73a0aff7c68fe6e8fe9a551ec506937d7c23`.
- [Current M1/M2 product page](https://www.katomodels.com/product/n/m1_m2): M1 **20-852**, its complete track contents, and Standard SX controller.
- [Current V1 product page](https://www.katomodels.com/product/n/v1set): **20-860**, its complete track contents and two turnout switches.
- [Current V2 product page](https://www.katomodels.com/product/n/v2_set) and [official V-set overview](https://unitrack.katomodels.com/products/line_set/v_line_set_series): **20-861**, its track contents, red truss bridge, and basic incline pier set.
- [KATO USA 2025 track catalog](https://katousa.com/wp-content/uploads/2026/03/us_unitrack_1-40_20251028-%E8%BB%BD.pdf), page 6: V2 also lists **four additional No.5 piers**. Page 13 documents basic and auxiliary pier sets; page 16 shows the #6 turnout's 186 mm main length.
- [Official turnouts/crossings page](https://unitrack.katomodels.com/products/line_single/branch_cross), #6 configuration graphic: #6 + S64 + R718-15 gives **66 mm** parallel track centers and matches S248 on the straight route. Without S64, #6 + R718-15 gives 49.5 mm centers and matches S186. The graphic also annotates the 15° S64's horizontal projection as 62 mm.
- [Official elevated-track page](https://unitrack.katomodels.com/products/line_single/elevated_line): current pier product codes and component heights. Its official [23-015-1 package photo](https://s3-ap-northeast-1.amazonaws.com/kato-model/item/images/20231214173612657abe7c937ec/y_0041_23-015-1-1.jpg) says **Incline Pier Set 15–50 mm**. The page describes No.5 as a 50 mm pier; the separate 23-069 tapered pier has an explicit **50 mm pier / 60 mm track-bottom** datum.

The application links these sources. It does not bundle KATO's PDF or photographs as application-owned artwork.

## Track inventory in the drawing

Counts were checked both against the PDF's embedded labels and its rendered drawing. There are **51 track pieces**, including two turnouts and one truss bridge. Side ramps, support parts, and S-Joiners do not add track pieces.

| Drawing symbol | Product / principal geometry | Required | Source kit |
| --- | --- | ---: | --- |
| S248 | 20-000, ground straight 248 mm | 14 | M1: 4; V1: 6; V2: 4 |
| S124 | 20-020, ground straight 124 mm | 1 | M1 |
| S62 | 20-040, ground straight 62 mm | 1 | M1 |
| S62F | 20-041, feeder straight 62 mm | 1 | M1 |
| S124C | 124 mm crossing/rerailer track; see version note below | 1 | M1 |
| S64 | 20-030, ground straight 64 mm | 2 | V1 |
| R315-45 | 20-120, ground radius 315 mm, 45° | 12 | M1: 8; additional pack: 4 |
| R718-15 | 20-150, ground radius 718 mm, 15° | 2 | V1 |
| EP718-15L | 20-202, electric #6 left turnout, 186 mm main | 1 | V1 |
| EP718-15R | 20-203, electric #6 right turnout, 186 mm main | 1 | V1 |
| S248V | 20-400, single viaduct straight 248 mm | 4 | V2 |
| S124V | 20-420, single viaduct straight 124 mm | 2 | V2 |
| R315-45V | 20-520, single viaduct radius 315 mm, 45° | 8 | V2 |
| S248T(RD) | 20-430, red single truss bridge 248 mm | 1 | V2 |

For an owner of the ordinary M1 with the listed contents, the track purchases are **V1 20-860 × 1, V2 20-861 × 1, and R315-45 20-120 × 1 four-piece pack**. An additional S124 is not required. Check the owned M1's actual contents and the retailer's V2 box contents before ordering support accessories.

M1 **20-854 M1-PC** uses concrete sleepers, and earlier M1/controller packages have different codes. Their appearance and accessory contents must be checked rather than inferred from the name “M1.” The track table above follows the legacy ground-track drawing and current ordinary M1 20-852.

`S124C` is not an additional S124 straight. KATO's symbol key explicitly uses the same symbol for the older 20-021 crossing and the 20-026/20-027 rerailer/crossing arrangement. The drawing also labels **S124C-S × 2**, meaning the crossing's two side ramps. Current M1 lists a 124 mm rerailer; that verifies the route length but does not establish that it supplies these historical crossing ramps. The ramps are scenery accessories, so their omission does not remove 124 mm from the railway.

## Topology

The main route is one long continuous single-track circuit with an elevated section. The two #6 turnouts near the bottom provide an alternative passing-siding route. The red bridge crosses over an upper horizontal ground straight at about 45°; the crossing is not a rail junction.

The elevated route consists of eight R315-45V curves, four S248V straights, two S124V straights, and the 248 mm bridge. Each bridge end has an S124V between the bridge and its adjacent elevated curve/straight assembly. All main R315 curves, at ground and elevated levels, retain their catalog radius. The source drawing is a plan view with piece and pier labels, rather than an engineering drawing of the pitched three-dimensional rail endpoints.

## Supports and elevations

The rendered plan marks **16 S-Joiner/support positions** along the elevated chain:

**S → 1 → 2 → 3 → 4 → 5 → 5 → 5 → 5 → 5 → 5 → 4 → 3 → 2 → 1 → S**.

Reading from the lower-left approach through the elevated section gives that order; reversing the route gives the same sequence. Two further `SPC` positions are on the ground approaches.

| Symbol | Meaning established by official symbol key | Drawing count | Support-height evidence |
| --- | --- | ---: | --- |
| S | Stair/step transition supplied in basic incline set 23-015, now 23-015-1 | 2 | Exact supported roadbed-bottom datum not established |
| 1 | Basic incline pier No.1 | 2 | Basic set's overall range is 15–50 mm; no individually dimensioned datum verified |
| 2 | Basic incline pier No.2 | 2 | No individually dimensioned datum verified |
| 3 | Basic incline pier No.3 | 2 | No individually dimensioned datum verified |
| 4 | Basic incline pier No.4 | 2 | No individually dimensioned datum verified |
| 5 | Standard pier No.5, basic set / 23-017, now 23-017-1 | 6 | Pier component height 50 mm verified; attachment/deck datum remains distinct |
| SPC | Spacer, identified in auxiliary incline set 23-016, now 23-016-1 | 2 | Exact supported roadbed-bottom datum not established |
| SJ | S-Joiner connecting/supporting structures | 16 labels | Connector hardware; not sixteen extra piers |

The current basic incline set contains two steps and two each of No.1–5. Therefore the drawing needs **four No.5 piers beyond the basic set**. The official USA V2 inventory lists those four additional piers. However, the old plan parts-list table lists `SPC, SW, 1, 2, 3, 4, 5` as two each, while its drawing uses six No.5 positions. The historical `SW` label appears to denote the steps marked `S` in the drawing; KATO's inspected common symbol key defines `S`, rather than `SW`. It is not counted as a separate track. The drawing and that historical table are inconsistent on the No.5 total.

The current Japanese V2 web description abbreviates the support contents to one basic incline set and does not separately enumerate the four No.5 piers or SPC spacers. This does not prove that current V2 omits either item. It also does not verify the SPC contents of every regional/versioned box. The physical purchaser should confirm that the V2 box includes **six total No.5 piers, two each No.1–4, two steps, and two SPC spacers**, or obtain the missing supports separately. The auxiliary set includes two SPC spacers according to KATO's symbol key; current codes are 23-016-1 for that set and 23-017-1 for a five-piece No.5 pack. Do not automatically add both retail packs if V2 already supplies the required parts.

An individually verified height table for all numbered piers and their supported roadbed-bottom elevations was not found in the inspected official material. Any simulator mapping of No.1–4 to 15/25/35/45 mm components, any extra attachment allowance, and any assigned step/spacer elevation must remain **nominal**. The numbering alone does not establish uniform 10 mm increments. The separate tapered 23-069 product's explicit 50/60 mm datum is useful evidence for that product, but it does not certify every basic-set support combination.

The preset's nominal roadbed-bottom heights are **SPC: 5 mm; S: 10 mm; No.1: 25 mm; No.2: 35 mm; No.3: 45 mm; No.4: 55 mm; No.5: 60 mm**. No.1–4 use the nominal component heights above with a 10 mm modeled structural allowance. The stair model's 5 mm component and 10 mm supported-track elevation, and the spacer's 4 mm component and 5 mm elevation, are likewise assumptions. These are model parameters, not additional manufactured pier sizes or a verified KATO dimension table. The No.1–4 and S catalog entries identify **23-015-1 as their retail assortment**, while ordinary No.5 also belongs to **23-017-1**. The spacer belongs to the **23-016-1** auxiliary assortment.

## Physical-planning limits

The preset is a sourced visual reconstruction with simplified three-dimensional grades and turnout routes. A continuous simulator route does not certify exact rigid-part closure, joiner pitch freedom, support contact, vehicle clearance, or traction. Raising a catalog-length rigid straight changes its horizontal projection; the flat drawing does not give the manufacturing and joint tolerances needed to determine the assembled three-dimensional endpoints exactly.

The model retains catalog-sized track pieces and uses explicit joint-angle adjustments of at most **0.245°** to fit both assembled routes. Every joined connector has a coincident position, within numerical precision; the existing general 0.25 mm / 0.25° connection tolerances are unchanged. Physical straight lengths and catalog curve radii/angles are retained. The corrections are fixed in `src/katoPlan.ts`, rather than stretching pieces or adding hidden track. These angular adjustments are a simulator reconstruction choice; they do not establish an officially allowed UniJoiner tolerance. In particular, a fitted route must not be used as evidence that a real assembly has the same three-dimensional endpoints or grades.

The fitted model's centerline bounds are approximately **2541 × 1335 mm**, or **2566 × 1360 mm** with the nominal 25 mm roadbed width. KATO's drawing prints **2620 × 1403 mm**. Use KATO's stated size when planning table space; the simulator's simplified fitted footprint does not replace that size or allow for scenery and access around the railway.

The #6 main route is 186 mm, with a catalog R718/15° branch. The official configuration with S64 between the turnout and R718-15 uses **66 mm track centers**, as in this plan. The shorter configuration without S64 uses 49.5 mm centers. A pure 718 mm radius arc at 15° produces 24.465 mm lateral offset, so two such arcs produce 48.930 mm rather than 49.5 mm; adding an ideal 64 mm diagonal yields about 65.494 mm rather than 66 mm. The fitted preset's passing-straight midpoint spacing is approximately **65.03 mm**. Its nominal roadbed flanges also touch briefly immediately beyond the two turnout exits; the clearance audit allows this local flange contact while continuing to reject overlapping train corridors. Consequently the generic turnout's idealized branch cannot be described as an exact measured KATO connector template. Any visual closure or route adjustment in the preset must stay distinct from a verified product dimension.

No E235-specific maximum gradient or guarantee for a long train on these grades is established by this plan. Actual grade transitions, motor performance, couplers, consist length, bridge walls, and supports still require physical review. The official plan's size label, track inventory, and pier-number order are sourced facts; the simulator's detailed deck heights and assembled 3D surfaces remain approximations wherever the evidence above is incomplete.
