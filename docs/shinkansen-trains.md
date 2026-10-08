# Shinkansen appearance and model references

References inspected on 7 October 2026 and rechecked for livery and roof details on 8 October 2026. The train selector retains the E235 Yamanote Line and adds original procedural representations of the E5, E6, and E7. The photographs below were inspected as visual references; they are not bundled as application textures or redistributed in the site build.

## Official exterior references

| Train | Operator reference | KATO model reference | Main visible distinctions |
| --- | --- | --- | --- |
| E5, Tohoku / Hokkaido | [JR East E5](https://www.jreast.co.jp/train/shinkan/e5.html), [exterior photograph](https://www.jreast.co.jp/train/shinkan/img/e5_img01.jpg) | [KATO E5 Hayabusa](https://www.katomodels.com/product/n/e5kei_hayabusa_slm), sets 10-1969 / 10-1970 / 10-1971 | Broad rounded duckbill with a very long nose; Tokiwa green upper body and window band, Hiun white lower body, and narrow azalea-pink belt. |
| E6, Tohoku / Akita | [JR East E6](https://www.jreast.co.jp/train/shinkan/e6.html), [exterior photograph](https://www.jreast.co.jp/train/shinkan/img/e6_img01.jpg) | [KATO E6 Komachi](https://www.katomodels.com/product/n/e6kei_komachi), sets 10-1566 / 10-1567 | Slender pointed nose; Akane red roof and nose, Hiun white sidewalls, Arrow Silver belt and lower skirt, and dark swept cab glazing. It has a smaller body than the full-size Shinkansen series. |
| E7, Hokuriku / Joetsu | [JR East E7](https://www.jreast.co.jp/train/shinkan/e7.html), [exterior photograph](https://www.jreast.co.jp/train/shinkan/img/e7_img01.jpg) | [KATO E7 / W7](https://www.katomodels.com/product/n/e7kei), E7 sets 10-1980 / 10-1981 / 10-1982 | Shorter, rising streamlined nose; blue roof and central nose, ivory-white body and chin, copper roof-shoulder edging plus a lower copper belt with a thin blue companion line, and shoulder headlights. |

The clean KATO side-quarter photographs were particularly useful for locating the livery boundaries, small passenger windows, slim flush doors, bogie skirts, and pantograph fairings:

- [E5 model photograph](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/images/2025031113552467cfc23cd0252/e5_hayabusa.jpg).
- [E6 model photograph](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/images/201906261659125d1325d0dbfc3/E6-1.jpg).
- [E7 model photograph](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/images/20250107142705677cbb29de380/E7_kagayaki.jpg).

E5 side windows sit within its green band. E6 and E7 side windows sit on their pale sidewalls. Their doors are spaced near the carriage ends, unlike the E235's four pairs of broad commuter doors per side. Both outside ends of a simulated formation have a cab and aerodynamic nose. The E5 model represents JR East's pink-striped E5, rather than the separate lavender-striped H5. The E7 model represents E7 rather than JR West's similarly shaped W7.

## E7 paint and series-specific roof equipment

The [joint E7/W7 design release](https://www.jreast.co.jp/press/2012/20120903.pdf), Annex 2 on PDF page 4, names **空色 (sky blue)**, **アイボリーホワイト (ivory white)** and **銅色（カッパー）(copper)**. JR East and KATO photographs show a saturated blue roof and nose, two copper lines, and an ivory chin. The model now includes the narrow copper shoulder edge along each carriage, a broader copper border around the nose, the lower copper belt and its thin blue companion. Blue and ivory use glossy pigmented paint materials; copper retains a metallic finish. The display palette `#2862d1` / `#f0eee6` / `#c89b69` is tuned against the inspected photographs under the simulator's lighting. These values are renderer choices, not published official RGB or paint codes.

All three series have fitted roof access-panel seams, small flush ventilation grilles and pale cab radio blades. Their raised collectors include joined single-arm members, hinge pins, carbon contact strips, end horns, porcelain bases with connected cores, and local high-voltage wiring. E5 has tall paired noise shields; E6 has lower ramp fairings and a slim longitudinal conduit; E7 retains its blue roof with compact gray fittings. The former generic raised capsule has been removed. [JR East Technical Review 31](https://www.jreast.co.jp/development/tech/pdf_31/Tech-31-11-12.pdf) describes the single-arm collector and E6's underfloor air conditioning; a large invented rooftop AC pod would misrepresent that train.

Inspected roof references:

- KATO formation diagrams: [E5, pantograph cars 3 and 7](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/compositions/2024080109330766aad7c369d41/E5系新幹線「はやぶさ」%20編成図-2.jpg), [E6, cars 12 and 16](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/compositions/2023020216035363db6059d8074/hensei_e6kei.jpg), and [E7, cars 3 and 7](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/compositions/2024030114311065e1681e7e74e/hensei_e7_w7kei.jpg).
- [E6 roof/conduit detail](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/images/201906261659125d1325d0ebfc8/E6-3.jpg).
- [E7 upper view](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/images/20241031184223672350ff4ede1/E7_diorama.jpg) and [antenna/collector view](https://s3.ap-northeast-1.amazonaws.com/kato-model/product/images/20221109171432636b61686d526/E7.jpg).

At the authentic formation count the roof roles follow the numbered prototype cars. Shortened play formations resample those roles: three cars have one collector, and four or more have two interior collectors. The metadata identifies the prototype roof role separately from the play car's number. Both outside cab fittings mirror with their existing exterior. Antenna and panel dimensions, ventilation locations, and fine electrical hardware remain procedural photographic approximations, particularly the small E5/E6 antenna profiles. All fittings remain within the existing conservative 45 mm train clearance envelope, and the body loft, bogie pivots and articulated connections retain their previous dimensions.

## Sourced facts and procedural dimensions

JR East's [E5 development article, Technical Review No.31, pages 11–12](https://www.jreast.co.jp/development/tech/pdf_31/Tech-31-11-12.pdf) identifies the E5's **15 m nose** and ten-car formation. The [E6 development release of 2 February 2010](https://www.jreast.co.jp/press/2009/20100203.pdf) gives an approximately **13 m nose**, **22.825 m end car**, and a seven-car train **148.65 m** long. That release concerns the pre-production train, so its overall length does not establish a measured current KATO coupler pitch. The [E7 / W7 design release of 4 September 2012](https://www.jreast.co.jp/press/2012/20120903.pdf) establishes twelve cars, the blue / ivory / copper color scheme, and the shorter “one-motion line” nose design. The current operator pages separately confirm ten, seven, and twelve-car formations for E5, E6, and E7 respectively.

The meshes use a 1:160 Shinkansen modeling convention, alongside the existing 1:150 E235. Both run on the same 9 mm N-gauge rail. The figures below describe the renderer's selected model dimensions; they are not a verified manufacturing drawing or measurements of purchased KATO models. In particular, body height, widths, bogie placement, E5 / E7 carriage lengths, E7 nose length, and coupling gaps remain procedural choices. The visible nose shape is reconstructed from photographs rather than scanned geometry.

| Mesh dimension, millimeters | E5 | E6 | E7 |
| --- | ---: | ---: | ---: |
| Intermediate-car shell length | 156.25 | 128.125 | 156.25 |
| Cab-car shell length | 165.625 | 142.65625 | 162.5 |
| Body width | 20.9375 | 18.40625 | 20.9375 |
| Roof height above wheel contact | 22.8125 | 22.0 | 22.8125 |
| Nominal nose length | 93.75 | 81.25 | 56.25 |
| Bogie-center separation | 109.375 | 93.75 | 109.375 |

The E6 intermediate shell uses a 20.5 m visual body assumption; it is not inferred as an exact overall coupled length from the 148.65 m seven-car train figure. The model's 4.2 mm car-end gap and articulated connector geometry support smooth appearance on model curves. They do not reproduce the exact KATO diaphragm, tilting mechanism, pantograph motion, or electrical coupler construction. Detailed numbering, service-specific window layouts, interiors, and manufacturer logos are simplified.

## Curve planning and formations

The inspected KATO pages explicitly publish minimum model curve radii of **R315 for E5**, **R282 for E6**, and **R315 for E7**. Those values are specific to the referenced KATO products. A radius meeting that limit alone does not certify walls, platforms, adjacent tracks, grades, couplers, or an assembled layout as physically compatible. Cab overhang is especially noticeable with the long-nosed trains.

The simulator retains the requested **3–11 car** play range. An E5 can therefore use its real ten-car count and an E6 its real seven-car count. An E7's full twelve-car formation lies outside that range, so its selectable formations are shortened representations. Other counts are also play formations rather than claims of actual passenger-service configurations. Changing a trainset's model updates that formation as a whole; E5–E6 coupled operation is not modeled in this update.

Each trainset is part of the working design and named saved layouts, including its independent placement and orientation. Old layouts without a train selection retain one E235. Changing a stopped train's model updates its body shape and proportions as well as its colors, so the three Shinkansen are not recolored copies of the Yamanote train. See [independent train controls](multi-train.md) for selection, placement and safety behavior.
