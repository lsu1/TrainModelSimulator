import type { PlacedAccessory } from './layout'
import type { Track } from './track'
import { pathsFor } from './track'
import { KATO_CATALOG } from './catalog'

/** Physical centers from KATO plan 06-15, fitted with the adjacent rigid rails.
 * Piers and station shops are installed at the assembly arrows, not callout positions.
 * Coordinates precede the preset's common centering translation. Heights are nominal.
 */
const SCENERY: readonly (readonly [kind: string, x: number, y: number, angle: number, elevation: number])[] = [
  ['a-platform-suburban-island', 2049.049993393, 2366.879368289, -0.000365031608, 0], // POI-A; rail 27
  ['a-platform-suburban-island', 2049.673980124, 2463.969402366, -0.001133530386, 0], // POI-A; rail 13
  ['a-platform-suburban-island', 2545.252894603, 2464.089729770, 0.000132184767, 0], // POI-A; rail 8
  ['a-platform-suburban-island', 2791.178919694, 2366.825695623, -0.000301887163, 0], // POI-A; rail 41
  ['a-platform-suburban-island', 2792.639923506, 2463.680090606, 0.000658326799, 0], // POI-A; rail 1
  ['a-platform-suburban-island', 2544.248488324, 2366.663883231, -0.000586562084, 0], // POI-A; rail 35
  ['a-platform-suburban-island-stairs', 2296.658557003, 2367.061716857, -0.000581439900, 0], // POI-B; rail 26
  ['a-platform-suburban-island-stairs', 2297.624949502, 2464.182942549, -0.000546052924, 0], // POI-B; rail 11
  ['a-platform-suburban-island-end', 2950.543361467, 2366.385921869, 3.140821479149, 0], // POIE-A; rail 29
  ['a-platform-suburban-island-end', 2952.021323875, 2464.292205925, 3.142398310396, 0], // POIE-A; rail 7
  ['a-platform-suburban-island-end', 1888.984730962, 2367.355308980, -0.000816532160, 0], // POIE-A; rail 38
  ['a-platform-suburban-island-end', 1890.558080396, 2464.702011617, -0.001880327390, 0], // POIE-A; rail 16
  ['a-platform-suburban-side', 2840.615885915, 2201.594308220, 0.000708098676, 60], // POF-A; rail 259
  ['a-platform-suburban-side', 2592.615907105, 2201.418699734, 0.000708098676, 60], // POF-A; rail 259
  ['a-platform-suburban-side', 2096.796958420, 2200.783508517, 0.001800952118, 60], // POF-A; rail 254
  ['a-platform-suburban-side', 1600.473850090, 2199.809677537, 0.002425102603, 60], // POF-A; rail 256
  ['a-platform-suburban-side', 1352.984714014, 2199.209372980, 0.002714313093, 60], // POF-A; rail 257
  ['a-platform-suburban-side', 1601.696815303, 2034.059478490, 0.001871067807, 60], // POF-A; rail 250
  ['a-platform-suburban-side', 1353.345990098, 2033.594667450, 0.001941977340, 60], // POF-A; rail 252
  ['a-platform-suburban-side', 2840.756651719, 2035.979587858, 0.001262110287, 60], // POF-A; rail 247
  ['a-platform-suburban-side', 2593.204443116, 2035.667149503, 0.001262110287, 60], // POF-A; rail 247
  ['a-platform-suburban-side', 2097.054285545, 2034.921114590, 0.001689745686, 60], // POF-A; rail 251
  ['a-platform-suburban-side-stairs-left', 2344.675507380, 2201.146123017, 0.001098140618, 60], // POF-BL; rail 258
  ['a-platform-suburban-side-stairs-left', 1849.599650365, 2034.502834385, 0.001787968344, 60], // POF-BL; rail 253
  ['a-platform-suburban-side-stairs-right', 1848.858920513, 2200.336836574, 0.002121298471, 60], // POF-BR; rail 255
  ['a-platform-suburban-side-stairs-right', 2345.304665176, 2035.311969259, 0.001431546463, 60], // POF-BR; rail 248
  ['a-platform-suburban-side-end-left', 1193.396251287, 2199.000017294, 0.002714313093, 60], // POFE-AL; rail 257
  ['a-platform-suburban-side-end-left', 3000.244463803, 2035.925045967, 0.001059469383, 60], // POFE-AL; rail 246
  ['a-platform-suburban-side-end-right', 1194.205917165, 2033.061688773, 0.001941977340, 60], // POFE-AR; rail 252
  ['a-platform-suburban-side-end-right', 3000.146138558, 2201.864262949, 0.000287153549, 60], // POFE-AR; rail 260
  ['a-platform-local-p06', 2604.883066353, 438.807245291, -0.789358471774, 0], // PLIF; rail 113
  ['a-platform-local-p06', 2342.569864772, 705.491407336, -0.788461659647, 0], // PLIF; rail 103
  ['a-platform-local-p06', 2255.991830687, 793.048353894, -0.788462957096, 0], // PLIF; rail 103
  ['a-platform-local-p06', 2343.946237393, 420.215307074, -0.522705540448, 0], // PLIF; rail 167
  ['a-platform-local-p06', 2450.799523784, 358.203794179, -0.522692926265, 0], // PLIF; rail 167
  ['a-platform-local-p06', 2236.509392868, 483.266192667, -0.520101199752, 0], // PLIF; rail 141
  ['a-platform-local-p06', 2129.158655706, 545.192191812, -0.520088612224, 0], // PLIF; rail 141
  ['a-platform-local-p06', 2021.670379096, 608.157882763, -0.519312662364, 0], // PLIF; rail 137
  ['a-platform-local-p06-slope', 2662.103755225, 380.537180858, -0.794476750717, 0], // PLIF-S; rail 113
  ['a-platform-local-p06-slope', 2198.271880968, 851.270440435, -0.793591270399, 0], // PLIF-S; rail 103
  ['a-platform-local-p06-slope', 2522.251259464, 316.051035101, -0.535072310745, 0], // PLIF-S; rail 173
  ['a-platform-local-p06-slope', 1950.966240891, 648.937852538, -0.529497884437, 0], // PLIF-S; rail 137
  ['a-platform-local-p06-end-af', 2548.547559385, 299.945030446, 1.037698457945, 0], // PLIF-AF; rail 157
  ['a-platform-local-p06-end-af', 1924.004517193, 664.286558543, 1.042109379041, 0], // PLIF-AF; rail 137
  ['a-platform-local-p06-end-bf', 2683.953703533, 358.738644322, 0.776320391185, 0], // PLIF-BF; rail 113
  ['a-platform-local-p06-end-bf', 2176.389109369, 874.302657865, 0.770637114159, 0], // PLIF-BF; rail 159
  ['a-station-deck-248', 2096.336453421, 2167.880430098, 0.001461108628, 60], // PLT248-99; rail 261
  ['a-station-deck-248', 3087.635347437, 2168.731126990, -0.001826172003, 60], // PLT248-99; rail 269
  ['a-station-deck-248', 2839.725743853, 2068.881485675, 0.001059469383, 60], // PLT248-99; rail 246
  ['a-station-deck-248', 2839.671944001, 2168.691808841, 0.000287153549, 60], // PLT248-99; rail 260
  ['a-station-deck-248', 2591.914332412, 2068.567590809, 0.001431546463, 60], // PLT248-99; rail 248
  ['a-station-deck-248', 2591.816146721, 2168.514944063, 0.001098140618, 60], // PLT248-99; rail 258
  ['a-station-deck-248', 2344.008966993, 2068.212277900, 0.001572469267, 60], // PLT248-99; rail 249
  ['a-station-deck-248', 2343.888594948, 2168.242130925, 0.001461108628, 60], // PLT248-99; rail 261
  ['a-station-deck-248', 2096.456867280, 2067.823009510, 0.001572469267, 60], // PLT248-99; rail 249
  ['a-station-deck-248', 3336.046117733, 2069.778797881, -0.000072769643, 60], // PLT248-99; rail 232
  ['a-station-deck-248', 1848.103618693, 2067.403052246, 0.001689745686, 60], // PLT248-99; rail 251
  ['a-station-deck-248', 1847.961192693, 2167.432758976, 0.001800952118, 60], // PLT248-99; rail 254
  ['a-station-deck-248', 1600.198159752, 2066.959518931, 0.001787968344, 60], // PLT248-99; rail 253
  ['a-station-deck-248', 1600.033851345, 2166.906375116, 0.002121298471, 60], // PLT248-99; rail 255
  ['a-station-deck-248', 1352.292628418, 2066.495437793, 0.001871067807, 60], // PLT248-99; rail 250
  ['a-station-deck-248', 3336.321116128, 2168.228494095, -0.000905685195, 60], // PLT248-99; rail 264
  ['a-station-deck-248', 3087.876267325, 2069.177378728, 0.000704842543, 60], // PLT248-99; rail 268
  ['a-station-deck-248', 1351.658948716, 2166.303623539, 0.002425102603, 60], // PLT248-99; rail 256
  ['a-station-deck-248', 1104.387138193, 2066.013810834, 0.001941977340, 60], // PLT248-99; rail 252
  ['a-station-deck-248', 1104.179513349, 2165.631360504, 0.002714313093, 60], // PLT248-99; rail 257
  ['a-station-deck-248', 855.615168001, 2065.969057244, 0.002690799216, 60], // PLT248-99; rail 243
  ['a-station-deck-248', 855.105545675, 2164.415173815, 0.003119442844, 60], // PLT248-99; rail 266
  ['a-station-wall-high-window', 1848.407618509, 2018.161609266, 0.001689745686, 60], // PLTW-HA; rail 251
  ['a-station-wall-high-window', 2344.307191947, 2018.970799607, 0.001572469267, 60], // PLTW-HA; rail 249
  ['a-station-wall-high', 2096.307343729, 2018.580827146, 0.001572469267, 60], // PLTW-HB; rail 249
  ['a-station-wall-high', 1600.506996193, 2017.718106048, 0.001787968344, 60], // PLTW-HB; rail 253
  ['a-station-wall-high', 1352.605898325, 2017.254051383, 0.001871067807, 60], // PLTW-HB; rail 250
  ['a-station-wall-high', 2591.757755673, 2019.325429842, 0.001431546463, 60], // PLTW-HB; rail 248
  ['a-station-wall-high', 2839.550731401, 2019.639386255, 0.001059469383, 60], // PLTW-HB; rail 246
  ['a-station-wall-high', 1351.760666984, 2215.545905933, 0.002425102603, 60], // PLTW-HB; rail 256
  ['a-station-wall-high', 1600.150188085, 2216.148623611, 0.002121298471, 60], // PLTW-HB; rail 255
  ['a-station-wall-high', 1848.093304001, 2216.674967676, 0.001800952118, 60], // PLTW-HB; rail 254
  ['a-station-wall-high', 2096.037550785, 2217.121936848, 0.001461108628, 60], // PLTW-HB; rail 261
  ['a-station-wall-high', 2344.037440893, 2217.484291885, 0.001461108628, 60], // PLTW-HB; rail 261
  ['a-station-wall-high', 2591.535003352, 2217.756555936, 0.001098140618, 60], // PLTW-HB; rail 258
  ['a-station-wall-high', 2839.430621186, 2217.933632492, 0.000287153549, 60], // PLTW-HB; rail 260
  ['a-station-wall-high', 3087.945495868, 2217.972533631, -0.001826172003, 60], // PLTW-HB; rail 269
  ['a-station-wall-high', 3088.131199730, 2019.935659820, 0.000704842543, 60], // PLTW-HB; rail 268
  ['a-station-wall-high', 1103.786665103, 2016.806530936, 0.000340681599, 60], // PLTW-HB; rail 267
  ['a-station-wall-high', 1103.819470506, 2214.872455546, 0.002714313093, 60], // PLTW-HB; rail 257
  ['a-station-wall-low', 855.444791219, 2214.070024198, 0.002725378965, 60], // PLTW-L; rail 237
  ['a-station-wall-low', 855.968916352, 2016.727944482, 0.002690799216, 60], // PLTW-L; rail 243
  ['a-station-wall-low', 3335.815237734, 2020.536928188, -0.000072769643, 60], // PLTW-L; rail 232
  ['a-station-wall-low', 3335.829272879, 2217.879740703, -0.000107500032, 60], // PLTW-L; rail 262
  ['a-station-wall-end-left', 731.276768060, 2180.270865710, 0.003119442844, 60], // PLTWE1W; rail 266
  ['a-station-wall-end-left', 3459.989826971, 2053.390823984, -0.000905685195, 60], // PLTWE1W; rail 264
  ['a-station-wall-end-right', 731.530741660, 2049.496319354, 0.005650577488, 60], // PLTWE2W; rail 273
  ['a-station-wall-end-right', 3460.651262010, 2184.253392987, -0.002843376369, 60], // PLTWE2W; rail 272
  ['a-station-p06', 2337.067150687, 2068.201352990, 0.001572469267, 0], // SV-T; rail 249
  ['a-station-p06', 1841.162031404, 2067.391313610, 0.001689745686, 0], // SV-T; rail 251
  ['a-station-shops-p06', 2150.843617958, 2067.908521967, 0.001572469267, 0], // SV-S; rail 249
  ['a-station-shops-p06', 2026.937893933, 2067.705227871, 0.001689745686, 0], // SV-S; rail 251
  ['a-station-shops-p06', 2522.748551314, 2068.468567605, 0.001431546463, 0], // SV-S; rail 248
  ['a-station-shops-p06', 1655.032639083, 2067.057552241, 0.001787968344, 0], // SV-S; rail 253
  ['a-station-local-p06', 2508.413112380, 606.525237241, -0.789378173873, 0], // SL; rail 125
  ['a-station-overtrack', 2580.722366280, 2461.168424601, 0.000060539330, 0], // SOV; rail 0
  ['a-station-overtrack-extension', 2529.599952350, 2380.586196506, -0.000440577714, 0], // SOV-EX; rail 24
  ['a-station-overtrack-stairs-right', 2637.683237950, 2539.531669511, 0.000132184767, 0], // SOV-SR; rail 8
  ['a-train-shed', 1796.627832896, 1478.040493403, 0.256669284697, 0], // TW; rail 190
  ['a-train-shed', 2157.150748213, 1574.052585995, 0.256598119194, 0], // TW; rail 180
  ['a-train-shed', 1977.057642323, 1525.843345628, 0.256668974211, 0], // TW; rail 190
  ['a-train-shed', 1616.090932127, 1429.814520129, 0.256709230343, 0], // TW; rail 209
  ['a-auto-crossing-main', 3541.531550223, 1218.772953736, 1.572775536588, 0], // S124EC-II-M; rail 48
  ['a-auto-crossing-opposite', 3641.679369172, 1218.969997524, 1.572775533530, 0], // S124EC-II-O; rail 49
  ['a-auto-crossing-slope', 3499.899735307, 1218.690555533, 1.572775536588, 0], // S124EC-II-SL; rail 48
  ['a-auto-crossing-slope', 3683.311184089, 1219.052395600, 1.572775533530, 0], // S124EC-II-SL; rail 49
  ['a-pier-frame-p06', 4133.551368958, 1562.797501649, 5.101785271775, 0], // 5W; rail 293
  ['a-pier-double-p06', 3461.589670634, 2119.437987998, -0.002843376369, 0], // PIER5; rail 272
  ['a-pier-frame-p06', 731.830921672, 2115.654106001, 3.147243231078, 0], // 5W; rail 273
  ['a-pier-frame-p06', 579.456896972, 2084.472551366, 3.539454408293, 0], // 5W; rail 274
  ['a-pier-frame-p06', 365.062352230, 1867.500001162, -1.962760705385, 0], // 5W; rail 275
  ['a-pier-frame-p06', 367.069655441, 1563.137469912, -1.176879287258, 0], // 5W; rail 276
  ['a-pier-frame-p06', 453.897757653, 1435.458521947, -0.782092790138, 0], // 5W; rail 289
  ['a-pier-frame-p06', 585.486866459, 1305.208667292, 2.359821932806, 0], // 5W; rail 289
  ['a-pier-double-p06', 717.460761351, 1174.050592928, 2.359188415269, 0], // PIER5; rail 280
  ['a-pier-double-p06', 893.981792957, 998.463152588, -0.783628126426, 0], // PIER5; rail 278
  ['a-pier-frame-p06', 1025.194282418, 867.074011566, 5.498724862486, 0], // 5W; rail 279
  ['a-pier-frame-p06', 1113.180133541, 779.756334123, -0.784387398766, 0], // 5W; rail 284
  ['a-pier-frame-p06', 1241.882621670, 693.902683041, 2.746635577553, 0], // 5W; rail 284
  ['a-pier-frame-p06', 1546.610772008, 693.212133398, 3.530786475519, 0], // 5W; rail 283
  ['a-pier-double-p06', 1675.612360091, 780.236867798, 0.783179196779, 0], // PIER5; rail 288
  ['a-pier-double-p06', 1807.386336051, 911.011686195, 0.781867987070, 0], // PIER5; rail 290
  ['a-pier-double-p06', 2088.323940124, 1026.089853767, 6.276958446192, 0], // PIER5; rail 297
  ['a-pier-double-p06', 2274.891790176, 1025.069191172, 3.137472894191, 0], // PIER5; rail 297
  ['a-pier-double-p06', 2522.783326079, 1024.382114472, -0.004573859130, 0], // PIER5; rail 281
  ['a-pier-double-p06', 2770.787654788, 1023.148516732, 3.136300547159, 0], // PIER5; rail 271
  ['a-pier-double-p06', 3018.342303484, 1022.285088887, -0.005548631205, 0], // PIER5; rail 298
  ['a-pier-double-p06', 3266.792818977, 1021.353025508, -0.005732715450, 0], // PIER5; rail 299
  ['a-pier-double-p06', 3515.226189069, 1018.138241806, 3.135859938140, 0], // PIER5; rail 299
  ['a-pier-double-p06', 3762.889871090, 1018.284188441, -0.003768679285, 0], // PIER5; rail 295
  ['a-pier-double-p06', 4048.413321097, 1692.595361883, -0.791306744280, 0], // PIER5; rail 292
  ['a-pier-double-p06', 3872.370118754, 1871.913330599, 2.350934762060, 0], // PIER5; rail 296
  ['a-pier-double-p06', 3742.409516783, 2000.848072356, 5.492921872114, 0], // PIER5; rail 296
  ['a-pier-frame-p06', 4131.400870866, 1263.347579016, 1.169230606223, 0], // 5W; rail 293
  ['a-pier-frame-p06', 3914.824514591, 1045.867950048, 3.527184081164, 0], // 5W; rail 295
  ['a-pier-frame-p06', 2469.230183341, 2168.604167894, 0.001098140618, 0], // 5W; rail 258
  ['a-pier-frame-p06', 2221.302834946, 2168.286860301, 0.001461108628, 0], // 5W; rail 261
  ['a-pier-frame-p06', 1970.689142592, 2167.877627115, 0.001800952118, 0], // 5W; rail 254
  ['a-pier-frame-p06', 1725.895319574, 2167.397206136, 0.002121298471, 0], // 5W; rail 255
  ['a-pier-frame-p06', 1480.206406942, 2166.839205960, 0.002425102603, 0], // 5W; rail 256
  ['a-pier-frame-p06', 1479.497879190, 2066.733438612, 0.001871067807, 0], // 5W; rail 250
  ['a-pier-frame-p06', 1228.250361803, 2166.191969660, 0.002714313093, 0], // 5W; rail 257
  ['a-pier-frame-p06', 1227.115914220, 2066.252138528, 0.001941977340, 0], // 5W; rail 252
  ['a-pier-frame-p06', 980.932964518, 2165.027592840, 0.008203036412, 0], // 5W; rail 265
  ['a-pier-frame-p06', 979.238998342, 2066.301695845, 0.002690799216, 0], // 5W; rail 243
  ['a-pier-frame-p06', 2721.634459577, 2168.831335401, 0.000708098676, 0], // 5W; rail 259
  ['a-pier-frame-p06', 2720.367719373, 2068.730215164, 0.001262110287, 0], // 5W; rail 247
  ['a-pier-frame-p06', 2965.086124052, 2168.951662355, 0.000287153549, 0], // 5W; rail 260
  ['a-pier-frame-p06', 2963.797018083, 2069.012926333, 0.001059469383, 0], // 5W; rail 246
  ['a-pier-frame-p06', 3213.944837832, 2168.724304628, -0.001826172003, 0], // 5W; rail 269
  ['a-pier-frame-p06', 3213.012463669, 2069.787741889, -0.000072769643, 0], // 5W; rail 232
]

export function makeKatoPlan06Scenery(tracks: Track[]): PlacedAccessory[] {
  const scenery = SCENERY.map(([kind, x, y, angle, elevation], index) => ({
    id: `kato06-scenery-${String(index + 1).padStart(3, '0')}`,
    kind, x, y, angle, elevation,
  }))
  const straightKinds = new Set(KATO_CATALOG.filter(item => item.shape === 'straight' || item.shape === 'doubleStraight').map(item => item.kind))
  // Each rigid rail was fitted separately. Center the full island sections
  // between the fitted station roads rather than following just one rail's fit.
  for (const platform of scenery.filter(piece => piece.kind === 'a-platform-suburban-island' || piece.kind === 'a-platform-suburban-island-stairs')) {
    const rails = tracks.filter(track => straightKinds.has(track.kind) && (track.elevation ?? 0) === platform.elevation)
      .flatMap(track => pathsFor(track).flatMap(path => {
        const a = path.pointAt(0), b = path.pointAt(path.length)
        if (Math.abs(b.x - a.x) < path.length * .98 || platform.x < Math.min(a.x, b.x) - 1 || platform.x > Math.max(a.x, b.x) + 1) return []
        const y = a.y + (b.y - a.y) * (platform.x - a.x) / (b.x - a.x)
        return Math.abs(y - platform.y) < 45 ? [{ y, angle: Math.atan((b.y - a.y) / (b.x - a.x)) }] : []
      }))
    const north = rails.filter(rail => rail.y < platform.y).sort((a, b) => b.y - a.y)[0]
    const south = rails.filter(rail => rail.y > platform.y).sort((a, b) => a.y - b.y)[0]
    if (north && south) {
      platform.y = (north.y + south.y) / 2
      platform.angle = (north.angle + south.angle) / 2
    }
  }
  // The schematic end-wall anchors are nominal. Keep the central opening
  // clear of the long Shinkansen cab envelope through the curved approaches.
  for (const wall of scenery.filter(piece => piece.kind.startsWith('a-station-wall-end-'))) {
    const offset = wall.y < 2116 ? -4 : 4
    wall.x -= Math.sin(wall.angle) * offset
    wall.y += Math.cos(wall.angle) * offset
  }
  // At the diagonal ground crossing, the nominal pier foot needs 15 mm of
  // longitudinal relief. It still supports the same bridge-end approach.
  const diagonalPier = scenery[120]
  diagonalPier.x += 15 * Math.cos(diagonalPier.angle)
  diagonalPier.y += 15 * Math.sin(diagonalPier.angle)
  return scenery
}
