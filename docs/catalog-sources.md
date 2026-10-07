# KATO N scale library: sources and geometry

Research checked on 7 October 2026. The library contains **135 placeable entries**: 17 single-track straights, 19 single-track curves, 5 turnout/crossover entries, 3 diamond crossings, 16 double-track or slab pieces, 15 viaduct pieces, 29 bridge color/shape variants, and 31 scenery accessories.

Every entry identifies its KATO product code and links to the product page or the exact catalog page used. These are individual placeable pieces or scenery models, rather than complete retail packs. For example, both a 29 mm and a 45.5 mm adjustment straight belong to assortment **20-091**; selecting either entry places one piece. Retail stock and pack quantities are not tracked.

## Primary sources

1. [KATO USA 2025 HO & N Track Catalog](https://katousa.com/wp-content/uploads/2026/03/us_unitrack_1-40_20251028-%E8%BB%BD.pdf), linked from the current [official catalog page](https://katousa.com/catalogs/). The downloaded document has 40 pages. N scale standards are on pages 8–9; single-track straights, bridges, and adjustment pieces on pages 10–11; bumpers and crossings on page 12; single-track piers on page 13; curves and curved bridges on page 15; turnouts and crossings on page 16; the roundhouse on page 17; concrete-tie double track on pages 18–19; slab track on page 20; double-track viaduct and bridges on page 21; double-track piers on page 22; and catenary poles on page 26.
2. [KATO concrete-tie single track](https://www.katomodels.com/product/n/unitrack_pc_tie2), updated 7 August 2026. This directly verifies the new **20-017 S186PC**, **20-114 R282-45PC**, **20-124 R315-45PC**, and **20-135 R348-45PC**, along with the established concrete-tie straight pieces. The R348 concrete-tie curve is listed for October 2026 release; inclusion is not a retail-stock claim.
3. [KATO modern DX platforms](https://www.katomodels.com/product/n/kinko_homu_dx): product codes **23-150** through **23-154**, platform shops **23-164**, and waiting room/elevator **23-165**. The official description gives 248 mm platform sections and 200 mm platform ends.
4. [KATO island and side platforms](https://www.katomodels.com/product/n/platform): current **23-171–23-174**, **23-178–23-179**, and footbridge **23-234**. The product page gives 248 mm platform lengths and 200 mm end lengths. These current codes replace some older platform catalog codes, so the simulator uses the current codes rather than labelling new platforms as the old **23-100** series.
5. [KATO viaduct stations](https://www.katomodels.com/product/n/unitrack_koukaeki): station building **23-230** and shops **23-231**. The official page gives a 248 × 113 mm footprint for each.
6. [KATO small local-line station](https://www.katomodels.com/product/n/local_station): station building **23-241**. Its model footprint is nominal because the inspected product description does not provide those dimensions.
7. [KATO USA UNITRACK introduction](https://katousa.com/unitrack/): official description of the joiner system and installation, with links to the catalog.

During the initial network restriction, a [public mirror of the track PDF](https://raw.githubusercontent.com/hrefcl/kato-unitrack/main/data/source/us_unitrack_1-40_20251028.pdf) was useful for research. After access became available, the PDF was downloaded directly from KATO USA. Its SHA-256 hash matched the mirrored document exactly. The mirror repository's AI-extracted JSON was used to locate candidate pages only; catalog identity and dimensions were checked against the actual PDF and official product pages.

## Measurements and simplified models

Track units are millimeters. Curve angles are radians in code, and `length` is the centerline arc length: radius × angle. Double-track spacing is 33 mm. For double curves, `innerRadius` and `outerRadius` are the actual catalog rail-route radii; the stored `radius` is their midpoint. In particular, KATO's large double curve is **480/447 mm**, not 481/448 mm. Single curved deck-girder bridges are the distinct **R448-15°** and **R481-15°** products.

The original save identifiers `s248`, `s124`, `s62`, `c249`, `c282`, `c315`, and `c348` are preserved. **R348-45°** is SKU **20-132**; **20-130** is the separate R348-30° piece. The compact curve entries include true catalog products down to R117. Tight compact curves are designed for selected short vehicles; their availability in the library does not imply that a long E235 train is physically compatible with them.

`verification: 'verified'` means the product code and main track centerline measurements were checked against an official source. It does not claim that the procedural mesh is a scan of the product. Real sleeper spacing, joiner mechanisms, rail frogs, molding details, and superelevation are simplified for browser performance. Double-curve approach pieces use the correct plan-view angle/radii but do not reproduce a measured banking transition.

`verification: 'nominal'` applies to all accessory meshes, the adjustable straight at its default 93 mm midpoint, and the switch/crossover geometry. Their real product identities remain sourced, but some rendered dimensions or routes are approximations:

- The expansion track's real adjustment range is 78–108 mm. The simulator initially places it at 93 mm.
- The #4 and #6 turnout catalog branch radii are 481 mm and 718 mm. Their simulated branches use idealized 15° arcs; the lead-in, frog, and branch endpoints are not exact engineering templates. The double crossover has its real 310 mm overall length with nominal interior routes.
- A platform's catalog length can be exact while its rendered width, canopy, signage, and other scenery dimensions remain nominal. The viaduct station's 248 × 113 mm footprint is sourced, while its height is approximate.
- A signal accessory represents the signal scenery from **20-606-1**, whose physical product includes a 124 mm straight. The buffer represents the stop from **20-046**, whose physical product includes a 62 mm straight. The crossing-gate accessory represents scenery from **20-027-1**, whose physical product includes a 124 mm rerailer. Placing these scenery entries does not add their supplied rails automatically.
- The bridge color variants use verified product codes, lengths, and catalog color names, with approximate display colors.

The library intentionally focuses on individually useful track, bridges, stations, and scenery. Electrical controllers, cables, packaged layout sets, HO products, UNITRAM street plates, flexible track, turntables, special widening sections, and unimplemented wye/compact point geometries are not placeable entries in this version. This is a broad sourced library, not a claim of the entire KATO product range.

## Appearance reference

Actual product photographs in the official PDF were inspected for the 3D materials and construction. Standard single track has a beveled, textured gray ballast roadbed, dark wooden sleepers, nickel-silver rails, and visible joiner ends. Concrete-tie pieces use pale sleepers. Single-track viaduct sections have darker raised retaining walls. Modern double-track viaducts use pale concrete walls and slab track. Truss bridges have open steel frames; plate-girder and deck-girder bridges have distinct solid or underneath supports. The catalog photographs on pages 10, 16, and 21 were the main visual references.

An [official KATO E235 Yamanote diorama photograph](https://s3-ap-northeast-1.amazonaws.com/kato-model/product/images/2024073114040766a9c5c784fa3/E235yamanote_nmi_m_1.jpg), embedded on the [current E235 product page](https://www.katomodels.com/product/n/e235_yamanote_slm), was also downloaded and inspected. It shows a silver E235 with lime-green vertical door panels and a lime front surrounding dark cab glazing; the lower cab face uses a dotted fade. The elevated tracks in this reference use pale concrete sleepers, mottled gray ballast, silver rails, pale viaduct parapets, and separate steel girder structures. The public image host requires the normal product-page HTTP referrer when downloading the embedded photograph.

The app uses original procedural geometry and materials. The manufacturers' product photographs and PDF are linked as research sources and are not bundled as application textures or presented as app-owned artwork.
