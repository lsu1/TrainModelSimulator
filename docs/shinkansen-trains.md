# Shinkansen appearance and model references

References inspected on 7 October 2026. The train selector retains the E235 Yamanote Line and adds original procedural representations of the E5, E6, and E7. The photographs below were inspected as visual references; they are not bundled as application textures or redistributed in the site build.

## Official exterior references

| Train | Operator reference | KATO model reference | Main visible distinctions |
| --- | --- | --- | --- |
| E5, Tohoku / Hokkaido | [JR East E5](https://www.jreast.co.jp/train/shinkan/e5.html), [exterior photograph](https://www.jreast.co.jp/train/shinkan/img/e5_img01.jpg) | [KATO E5 Hayabusa](https://www.katomodels.com/product/n/e5kei_hayabusa_slm), sets 10-1969 / 10-1970 / 10-1971 | Broad rounded duckbill with a very long nose; Tokiwa green upper body and window band, Hiun white lower body, and narrow azalea-pink belt. |
| E6, Tohoku / Akita | [JR East E6](https://www.jreast.co.jp/train/shinkan/e6.html), [exterior photograph](https://www.jreast.co.jp/train/shinkan/img/e6_img01.jpg) | [KATO E6 Komachi](https://www.katomodels.com/product/n/e6kei_komachi), sets 10-1566 / 10-1567 | Slender pointed nose; Akane red roof and nose, Hiun white sidewalls, Arrow Silver belt and lower skirt, and dark swept cab glazing. It has a smaller body than the full-size Shinkansen series. |
| E7, Hokuriku / Joetsu | [JR East E7](https://www.jreast.co.jp/train/shinkan/e7.html), [exterior photograph](https://www.jreast.co.jp/train/shinkan/img/e7_img01.jpg) | [KATO E7 / W7](https://www.katomodels.com/product/n/e7kei), E7 sets 10-1980 / 10-1981 / 10-1982 | Shorter, rising streamlined nose; sky-blue roof and central nose, ivory-white body, copper belt with a thin blue companion line, and shoulder headlights. |

The clean KATO side-quarter photographs were particularly useful for locating the livery boundaries, small passenger windows, slim flush doors, bogie skirts, and pantograph fairings:

- [E5 model photograph](https://s3-ap-northeast-1.amazonaws.com/kato-model/product/images/2025031113552467cfc23cd0252/e5_hayabusa.jpg).
- [E6 model photograph](https://s3-ap-northeast-1.amazonaws.com/kato-model/product/images/201906261659125d1325d0dbfc3/E6-1.jpg).
- [E7 model photograph](https://s3-ap-northeast-1.amazonaws.com/kato-model/product/images/20250107142705677cbb29de380/E7_kagayaki.jpg).

E5 side windows sit within its green band. E6 and E7 side windows sit on their pale sidewalls. Their doors are spaced near the carriage ends, unlike the E235's four pairs of broad commuter doors per side. Both outside ends of a simulated formation have a cab and aerodynamic nose. The E5 model represents JR East's pink-striped E5, rather than the separate lavender-striped H5. The E7 model represents E7 rather than JR West's similarly shaped W7.

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

The simulator retains the requested **3–11 car** play range. An E5 can therefore use its real ten-car count and an E6 its real seven-car count. An E7's full twelve-car formation lies outside that range, so its selectable formations are shortened representations. Other counts are also play formations rather than claims of actual passenger-service configurations. Selecting a train changes the selected formation as a whole; E5–E6 coupled operation is not modeled in this update.

The selected train is part of the working design and named saved layouts. Old layouts without a train selection retain the E235. Changing the dropdown updates the body shape and proportions as well as the colors, so the three Shinkansen are not recolored copies of the Yamanote train.
