# Passenger-service speeds

Checked on 8 October 2026. The speed slider and motion engine use the fastest passenger-service speed for the represented model and line, in real-world km/h.

| Train | Simulator maximum | Source and route context |
| --- | ---: | --- |
| E235-0 Yamanote Line | 90 km/h | [Nippon.com’s Yamanote overview](https://www.nippon.com/en/japan-topics/b11302/) states a 90 km/h top speed. [Toyo Keizai’s railway report](https://toyokeizai.net/articles/-/107141?page=2) distinguishes the 90 km/h operating limit from vehicle design speed. |
| E5 Shinkansen | 320 km/h | [JR East E5](https://www.jreast.co.jp/train/shinkan/e5.html) lists 320 km/h, reached in Tohoku service. [JR Hokkaido](https://www.jrhokkaido.co.jp/train/shinkansen.html) gives a 260 km/h operating maximum on its section; some shared sections have lower limits. |
| E6 Shinkansen | 320 km/h | [JR East E6](https://www.jreast.co.jp/train/shinkan/e6.html) lists 320 km/h in the Shinkansen section. The conventional Morioka–Akita section is limited to 130 km/h in [JR East’s transport overview, printed pages 29–30](https://www.jreast.co.jp/youran/pdf/2019-2020/jre_youran_group_p27-32.pdf). |
| E7 Shinkansen | 275 km/h | [JR East E7](https://www.jreast.co.jp/train/shinkan/e7.html) lists 275 km/h. The [Joetsu announcement](https://www.jreast.co.jp/press/2022/niigata/20230217_ni02.pdf) confirms the increase on 18 March 2023. Hokuriku service is limited to 260 km/h. |

The [original JR East Yamanote E235 announcement](https://www.jreast.co.jp/press/2014/20140701.pdf) and [current E235 family page](https://www.jreast.co.jp/train/local/e235.html) give a **120 km/h vehicle specification**. The simulator represents the E235-0 on Yamanote, so it uses that line’s 90 km/h operating limit. The 90 figure above is corroborated by the cited railway reporting; it is not quoted from JR East’s 120 km/h specification.

E5 and E6 correctly share a 320 km/h maximum. Route notes under the slider explain the lower limits on other lines. A custom KATO layout does not automatically adopt real railway sections or their local speed limits.

## Controls, movement and saved layouts

The selected train’s slider retains 5 km/h increments and displays its own maximum. Other trainsets retain their independent requested speeds. Changing a train’s model reduces its requested speed when it exceeds the new model’s limit. Actual speed ramps towards the request; existing acceleration, braking and collision protection remain the simulator’s simplified play behavior.

Rail movement converts real-world speed to model millimeters using each model’s scale: `km/h ÷ 3.6 × 1000 ÷ scale`. E235 uses 1:150 and the three Shinkansen use 1:160. At 320 km/h, a Shinkansen travels about 555.6 model mm/s. Close-train updates retain bounded rail steps, and background-tab elapsed time is capped to prevent a large catch-up jump.

Version 3 saves retain independent speeds up to 320 km/h. Existing Yamanote saves set above 90 km/h reopen with a 90 km/h request while keeping their track, scenery, formations, positions, orientations and selection. Zero remains valid in saved data. Imports reject negative, non-finite or above-320 values and clamp supported speeds to the imported model’s limit. Reopened trains start paused.
