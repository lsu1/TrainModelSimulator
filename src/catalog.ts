import type { CatalogItem } from './catalogTypes'

const PDF = 'https://katousa.com/wp-content/uploads/2026/03/us_unitrack_1-40_20251028-%E8%BB%BD.pdf'
const PC = 'https://www.katomodels.com/product/n/unitrack_pc_tie2'
const PLATFORM = 'https://www.katomodels.com/product/n/platform'
const PLATFORM_DX = 'https://www.katomodels.com/product/n/kinko_homu_dx'
const STATION = 'https://www.katomodels.com/product/n/unitrack_koukaeki'
const ELEVATED = 'https://unitrack.katomodels.com/products/line_single/elevated_line'
const page = (n: number) => `${PDF}#page=${n}`
const radians = (degrees: number) => degrees * Math.PI / 180

function straight(kind: string, sku: string, length: number, name = `${length} mm straight`, options: Partial<CatalogItem> = {}): CatalogItem {
  return { kind, sku, label: `S${length}`, name, category: 'straight', shape: 'straight', length,
    bed: 'ballast', sourceUrl: page(length >= 124 ? 10 : 11), verification: 'verified', ...options }
}
function curve(kind: string, sku: string, radius: number, degrees: number, options: Partial<CatalogItem> = {}): CatalogItem {
  const angle = radians(degrees)
  return { kind, sku, label: `R${radius}-${degrees}`, name: `${radius} mm radius · ${degrees}° curve`,
    category: 'curved', shape: 'curve', radius, angle, length: radius * angle, bed: 'ballast',
    sourceUrl: page(15), verification: 'verified', ...options }
}
function doubleStraight(kind: string, sku: string, length: number, bed: CatalogItem['bed'] = 'ballast', category: CatalogItem['category'] = 'double'): CatalogItem {
  return straight(kind, sku, length, `${length} mm double ${bed === 'ballast' ? 'concrete-tie track' : `${bed} track`}`, {
    label: `WS${length}${bed === 'slab' ? 'S' : bed === 'viaduct' ? 'V' : 'PC'}`, category, shape: 'doubleStraight', bed, lanes: 2, laneSpacing: 33,
    sourceUrl: page(bed === 'slab' ? 20 : bed === 'viaduct' ? 21 : 18),
  })
}
function doubleCurve(kind: string, sku: string, innerRadius: number, outerRadius: number, degrees: number, bed: CatalogItem['bed'] = 'ballast'): CatalogItem {
  const radius = (innerRadius + outerRadius) / 2
  return curve(kind, sku, radius, degrees, {
    label: `WR${outerRadius}/${innerRadius}-${degrees}`, name: `${outerRadius}/${innerRadius} mm double ${bed} curve · ${degrees}°`,
    category: bed === 'viaduct' ? 'viaduct' : 'double', shape: 'doubleCurve', bed, innerRadius, outerRadius, lanes: 2, laneSpacing: 33,
    sourceUrl: page(bed === 'slab' ? 20 : bed === 'viaduct' ? 21 : 19),
    ...(degrees === 22.5 ? { verification: 'nominal' as const } : {}),
    notes: degrees === 22.5
      ? 'Catalog radii and 22.5° plan angle are verified. The retail pack contains distinct left/right banking approaches, with flat and banked ends. Those end roles are not modeled, so physical compatibility requires review.'
      : 'Catalog centerline radii and angle are verified. This is banked track; flat straights must connect through the matching approach pieces. Banking geometry and end compatibility are simplified in the simulator.',
  })
}
function accessory(kind: string, sku: string, label: string, name: string, accessoryType: CatalogItem['accessoryType'], footprint: NonNullable<CatalogItem['footprint']>, sourceUrl: string): CatalogItem {
  return { kind, sku, label, name, category: 'accessory', shape: 'accessory', accessoryType, length: footprint.length,
    footprint, bed: 'none', sourceUrl, verification: 'nominal',
    notes: 'Product identity is catalog sourced. The simplified scenery model and footprint are nominal, not a measured product template.' }
}

export const KATO_CATALOG: CatalogItem[] = [
  straight('s248', '20-000', 248),
  straight('s186', '20-010', 186),
  straight('s124', '20-020', 124),
  straight('s64', '20-030', 64),
  straight('s62', '20-040', 62),
  straight('s29', '20-091', 29, '29 mm adjustment straight', { notes: 'One individual piece from the 29 mm / 45.5 mm assortment.' }),
  straight('s45-5', '20-091', 45.5, '45.5 mm adjustment straight', { notes: 'One individual piece from the 29 mm / 45.5 mm assortment.' }),
  straight('s33', '20-092', 33, '33 mm adjustment straight', { notes: 'One individual piece from adjustment set B.' }),
  straight('s38', '20-092', 38, '38 mm adjustment straight', { notes: 'One individual piece from adjustment set B.' }),
  straight('s93', '20-050', 93, 'Expansion straight · set to 93 mm', { label: 'S78–108', verification: 'nominal', notes: 'Real piece adjusts between 78 and 108 mm. This simulator uses its nominal midpoint, 93 mm.' }),
  straight('s248-pc', '20-007', 248, '248 mm concrete-tie straight', { label: 'S248PC', sourceUrl: PC }),
  straight('s186-pc', '20-017', 186, '186 mm concrete-tie straight', { label: 'S186PC', sourceUrl: PC }),
  straight('s124-pc', '20-028', 124, '124 mm concrete-tie straight', { label: 'S124PC', sourceUrl: PC }),
  straight('s62-pc', '20-054', 62, '62 mm concrete-tie straight', { label: 'S62PC', sourceUrl: PC }),
  straight('s62-feeder', '20-041', 62, '62 mm feeder straight', { label: 'S62F' }),
  straight('s62-feeder-pc', '20-055', 62, '62 mm concrete-tie feeder', { label: 'S62FPC', sourceUrl: PC }),
  straight('s124-rerailer', '20-026', 124, '124 mm rerailer', { label: 'S124 rerailer' }),
  curve('c117', '20-176', 117, 45, { notes: 'Compact radius: suitable for selected short vehicles, not an E235 train.' }),
  curve('c150', '20-174', 150, 45, { notes: 'Compact radius: suitable for selected short vehicles, not an E235 train.' }),
  curve('c183', '20-172', 183, 45, { notes: 'Compact radius: suitable for selected short vehicles, not an E235 train.' }),
  curve('c216', '20-170', 216, 45),
  curve('c216-15', '20-171', 216, 15),
  curve('c249', '20-100', 249, 45),
  curve('c249-15', '20-101', 249, 15),
  curve('c282', '20-110', 282, 45),
  curve('c282-15', '20-111', 282, 15),
  curve('c315', '20-120', 315, 45),
  curve('c315-15', '20-121', 315, 15),
  curve('c348', '20-132', 348, 45),
  curve('c348-30', '20-130', 348, 30),
  curve('c381', '20-140', 381, 30),
  curve('c481', '20-160', 481, 15),
  curve('c718', '20-150', 718, 15),
  curve('c282-pc', '20-114', 282, 45, { label: 'R282-45PC', name: '282 mm concrete-tie curve · 45°', sourceUrl: PC }),
  curve('c315-pc', '20-124', 315, 45, { label: 'R315-45PC', name: '315 mm concrete-tie curve · 45°', sourceUrl: PC }),
  curve('c348-pc', '20-135', 348, 45, { label: 'R348-45PC', name: '348 mm concrete-tie curve · 45°', sourceUrl: PC, notes: 'Listed by Kato for October 2026 release; a catalog entry does not establish retail stock.' }),
  ...([
    ['t6l', '20-202', 186, 718, 'Left'], ['t6r', '20-203', 186, 718, 'Right'],
    ['t4l', '20-220', 126, 481, 'Left'], ['t4r', '20-221', 126, 481, 'Right'],
  ] as const).map(([kind, sku, length, branchRadius, direction]) => straight(kind, sku, length, `#${branchRadius === 718 ? 6 : 4} ${direction.toLowerCase()} turnout`, {
    label: `#${branchRadius === 718 ? 6 : 4} ${direction}`, category: 'turnout', shape: 'turnout', branchRadius, branchAngle: radians(15), branchLength: branchRadius * radians(15),
    sourceUrl: page(16), verification: 'nominal', notes: 'Catalog SKU and branch radius are verified. Frog, lead-in, and branch endpoints use simplified nominal geometry; not a construction template.',
  })),
  straight('x15l', '20-300', 186, '15° left diamond crossing', { label: 'X15 Left', category: 'crossing', shape: 'crossing', crossingAngle: radians(-15), sourceUrl: page(16), verification: 'nominal', notes: 'The 186 mm main route and 15° crossing angle are catalog sourced. The secondary route length and four connector positions are not an exact verified product template.' }),
  straight('x15r', '20-301', 186, '15° right diamond crossing', { label: 'X15 Right', category: 'crossing', shape: 'crossing', crossingAngle: radians(15), sourceUrl: page(16), verification: 'nominal', notes: 'The 186 mm main route and 15° crossing angle are catalog sourced. The secondary route length and four connector positions are not an exact verified product template.' }),
  straight('x90', '20-320', 124, '90° diamond crossing', { label: 'X90', category: 'crossing', shape: 'crossing', crossingAngle: radians(90), sourceUrl: page(16) }),
  straight('scissors', '20-210', 310, '310 mm double crossover', { label: 'WX310', category: 'turnout', shape: 'scissors', lanes: 2, laneSpacing: 33, sourceUrl: page(16), verification: 'nominal', notes: '310 mm overall length and product identity are catalog sourced. Crossover paths and frogs are nominal.' }),
  doubleStraight('ds248', '20-004', 248),
  doubleStraight('ds186', '20-012', 186),
  doubleStraight('ds124', '20-023', 124),
  doubleStraight('ds62', '20-042', 62),
  doubleCurve('dc315', '20-183', 282, 315, 45),
  doubleCurve('dc414', '20-181', 381, 414, 45),
  doubleCurve('dc480', '20-185', 447, 480, 45),
  doubleCurve('dc315-approach', '20-184', 282, 315, 22.5),
  doubleCurve('dc414-approach', '20-182', 381, 414, 22.5),
  doubleCurve('dc480-approach', '20-186', 447, 480, 22.5),
  doubleStraight('slab248', '20-006', 248, 'slab'),
  doubleStraight('slab186', '20-014', 186, 'slab'),
  doubleStraight('slab124', '20-025', 124, 'slab'),
  doubleStraight('slab62', '20-044', 62, 'slab'),
  doubleCurve('slab414', '20-187', 381, 414, 45, 'slab'),
  doubleCurve('slab414-approach', '20-188', 381, 414, 22.5, 'slab'),
  ...([
    ['v248', '20-400', 248], ['v186', '20-410', 186], ['v124', '20-420', 124], ['v62', '20-440', 62],
  ] as const).map(([kind, sku, length]) => straight(kind, sku, length, `${length} mm single-track viaduct`, { label: `S${length}V`, category: 'viaduct', bed: 'viaduct' })),
  ...([
    ['v249', '20-505', 249, 45], ['v282', '20-510', 282, 45], ['v315', '20-520', 315, 45],
    ['v348', '20-530', 348, 45], ['v348-30', '20-531', 348, 30], ['v381', '20-540', 381, 30],
  ] as const).map(([kind, sku, radius, degrees]) => curve(kind, sku, radius, degrees, { label: `R${radius}-${degrees}V`, name: `${radius} mm viaduct curve · ${degrees}°`, category: 'viaduct', bed: 'viaduct' })),
  doubleStraight('dv248', '20-401', 248, 'viaduct', 'viaduct'),
  doubleStraight('dv186', '20-411', 186, 'viaduct', 'viaduct'),
  doubleStraight('dv124', '20-422', 124, 'viaduct', 'viaduct'),
  doubleCurve('dv414', '20-544', 381, 414, 45, 'viaduct'),
  doubleCurve('dv414-approach', '20-545', 381, 414, 22.5, 'viaduct'),
  ...([
    ['b248-brown', '20-429', 'Reddish brown', '#884f42'], ['b248-red', '20-430', 'Red', '#ba3b36'],
    ['b248-green', '20-431', 'Green', '#2e6a54'], ['b248-gray', '20-432', 'Gray', '#8a9191'],
    ['b248-silver', '20-433', 'Silver', '#b6bdc0'], ['b248-black', '20-434', 'Black', '#333a3d'],
  ] as const).map(([kind, sku, colorName, color]) => straight(kind, sku, 248, `${colorName} single-track truss bridge`, { label: `S248T ${colorName}`, category: 'bridge', bed: 'bridge', color, sourceUrl: page(10) })),
  ...([
    ['b186-red', '20-450', 'Red', '#ba3b36'], ['b186-green', '20-451', 'Green', '#2e6a54'],
    ['b186-gray', '20-452', 'Gray', '#8a9191'], ['b186-silver', '20-453', 'Silver', '#b6bdc0'], ['b186-black', '20-454', 'Black', '#333a3d'],
  ] as const).map(([kind, sku, colorName, color]) => straight(kind, sku, 186, `${colorName} single-track plate girder bridge`, { label: `S186T ${colorName}`, category: 'bridge', bed: 'bridge', color, sourceUrl: page(10) })),
  ...([
    ['b124-red', '20-460', 'Red', '#ba3b36'], ['b124-green', '20-461', 'Green', '#2e6a54'],
    ['b124-gray', '20-462', 'Gray', '#8a9191'], ['b124-black', '20-464', 'Black', '#333a3d'],
  ] as const).map(([kind, sku, colorName, color]) => straight(kind, sku, 124, `${colorName} deck girder bridge`, { label: `S124T ${colorName}`, category: 'bridge', bed: 'bridge', color, sourceUrl: page(11) })),
  ...([
    ['b448-red', '20-465', 448, 'Red', '#ba3b36'], ['b448-green', '20-466', 448, 'Green', '#2e6a54'], ['b448-gray', '20-467', 448, 'Gray', '#8a9191'],
    ['b481-red', '20-470', 481, 'Red', '#ba3b36'], ['b481-green', '20-471', 481, 'Green', '#2e6a54'], ['b481-gray', '20-472', 481, 'Gray', '#8a9191'],
  ] as const).map(([kind, sku, radius, colorName, color]) => curve(kind, sku, radius, 15, { label: `R${radius}-15T ${colorName}`, name: `${colorName} curved deck girder bridge · R${radius}-15°`, category: 'bridge', bed: 'bridge', color })),
  ...([
    ['db248-blue', '20-436', 'Light blue', '#75adbb'], ['db248-gray', '20-437', 'Gray', '#8a9191'],
    ['db248-black', '20-438', 'Black', '#333a3d'], ['db248-green', '20-439', 'Light green', '#94bca2'],
  ] as const).map(([kind, sku, colorName, color]) => ({ ...doubleStraight(kind, sku, 248, 'bridge', 'bridge'), label: `WS248T ${colorName}`, name: `${colorName} double-track truss bridge`, color, sourceUrl: page(21) })),
  ...([
    ['db186-blue', '20-455', 'Light blue', '#75adbb'], ['db186-green', '20-456', 'Light green', '#94bca2'],
    ['db186-gray', '20-457', 'Gray', '#8a9191'], ['db186-black', '20-458', 'Black', '#333a3d'],
  ] as const).map(([kind, sku, colorName, color]) => ({ ...doubleStraight(kind, sku, 186, 'bridge', 'bridge'), label: `WS186T ${colorName}`, name: `${colorName} double-track plate girder bridge`, color, sourceUrl: page(21) })),
  accessory('a-platform', '23-150', 'DX island platform', 'Modern DX island platform A · 248 mm', 'platform', { length: 248, width: 32, height: 40 }, PLATFORM_DX),
  accessory('a-platform-dx-b', '23-151', 'DX island B', 'Modern DX island platform B · 248 mm', 'platform', { length: 248, width: 32, height: 40 }, PLATFORM_DX),
  accessory('a-platform-dx-end', '23-152', 'DX platform end', 'Modern DX island platform end B · 200 mm', 'platform', { length: 200, width: 32, height: 9 }, PLATFORM_DX),
  accessory('a-platform-dx-side', '23-153', 'DX side platform', 'Modern DX side platform A · 248 mm', 'platform', { length: 248, width: 28, height: 40 }, PLATFORM_DX),
  accessory('a-platform-dx-side-b', '23-154', 'DX side B', 'Modern DX side platform B · 248 mm', 'platform', { length: 248, width: 28, height: 40 }, PLATFORM_DX),
  accessory('a-platform-island', '23-171', 'Island platform', 'Island platform A with kiosk · 248 mm', 'platform', { length: 248, width: 32, height: 40 }, PLATFORM),
  accessory('a-platform-stairs', '23-172', 'Island with stairs', 'Island platform B with stairs · 248 mm', 'platform', { length: 248, width: 32, height: 40 }, PLATFORM),
  accessory('a-platform-open', '23-173', 'Open platform', 'Island platform C without canopy · 248 mm', 'platform', { length: 248, width: 32, height: 9 }, PLATFORM),
  accessory('a-platform-end', '23-174', 'Island end', 'Island platform end A · 200 mm', 'platform', { length: 200, width: 32, height: 9 }, PLATFORM),
  accessory('a-platform-side', '23-178', 'Side platform', 'Side platform A · 248 mm', 'platform', { length: 248, width: 28, height: 40 }, PLATFORM),
  accessory('a-platform-side-stairs', '23-179', 'Side with stairs', 'Side platform B with stairs · 248 mm', 'platform', { length: 248, width: 28, height: 40 }, PLATFORM),
  accessory('a-station', '23-230', 'Viaduct station', 'Viaduct station building · 248 × 113 mm', 'station', { length: 248, width: 113, height: 50 }, STATION),
  accessory('a-station-shops', '23-231', 'Station shops', 'Viaduct station shops · 248 × 113 mm', 'building', { length: 248, width: 113, height: 50 }, STATION),
  accessory('a-station-local', '23-241', 'Small station', 'Small local-line station building', 'station', { length: 100, width: 65, height: 45 }, 'https://www.katomodels.com/product/n/local_station'),
  accessory('a-platform-shop', '23-164', 'Platform kiosk', 'Modern platform shops', 'building', { length: 35, width: 22, height: 24 }, PLATFORM_DX),
  accessory('a-platform-waiting', '23-165', 'Waiting room', 'Modern platform waiting room and elevator', 'building', { length: 40, width: 22, height: 25 }, PLATFORM_DX),
  accessory('a-footbridge', '23-234', 'Station footbridge', 'Suburban station pedestrian footbridge', 'building', { length: 65, width: 110, height: 50 }, PLATFORM),
  accessory('a-pier', '23-017', 'Single pier', '50 mm single-track pier', 'pier', { length: 24, width: 32, height: 50 }, page(13)),
  accessory('a-pier-double', '23-019', 'Double pier', '50 mm double-track pier', 'pier', { length: 24, width: 65, height: 50 }, page(22)),
  accessory('a-pier-frame', '23-020', 'Frame pier', 'Double-track viaduct framework pier', 'pier', { length: 32, width: 70, height: 50 }, page(22)),
  accessory('a-pier-cone', '23-047', 'Bridge pier', 'Single-track bridge pier No. 5', 'pier', { length: 30, width: 30, height: 50 }, page(13)),
  { ...accessory('a-pier-tapered', '23-069', '60 mm track support', 'Tapered No. 5 pier · 50 mm pier / 60 mm roadbed', 'pier', { length: 30, width: 30, height: 60 }, ELEVATED), supportDeckHeight: 60, supportComponentHeight: 50,
    notes: 'KATO documents the pier component at 50 mm and supported roadbed bottom at 60 mm. The rendered 60 mm height represents the support assembly including its additional 10 mm attachment/viaduct structure. The lateral footprint and appearance remain nominal.' },
  accessory('a-catenary', '23-059-1', 'Catenary', 'Single-track catenary pole', 'catenary', { length: 8, width: 34, height: 45 }, page(26)),
  accessory('a-catenary-double', '23-060-1', 'Double catenary', 'Double-track square-corner catenary poles', 'catenary', { length: 8, width: 70, height: 45 }, page(26)),
  accessory('a-catenary-wide', '23-061', 'Wide catenary', 'Double-track wide catenary poles', 'catenary', { length: 8, width: 86, height: 45 }, page(26)),
  accessory('a-catenary-arch', '23-062', 'Arch catenary', 'Double-track wide arch catenary poles', 'catenary', { length: 8, width: 86, height: 45 }, page(26)),
  accessory('a-catenary-truss', '23-063', 'Truss catenary', 'Truss catenary pole for double track', 'catenary', { length: 8, width: 86, height: 45 }, page(26)),
  accessory('a-catenary-four', '23-064', 'Four-track catenary', 'Four-track wide catenary poles', 'catenary', { length: 8, width: 135, height: 45 }, page(26)),
  accessory('a-signal', '20-606-1', '3-color signal', 'USA 3-color automatic signal with 124 mm track', 'signal', { length: 12, width: 12, height: 42 }, page(11)),
  accessory('a-buffer', '20-046', 'Buffer stop', 'Type A buffer from 62 mm bumper track', 'buffer', { length: 14, width: 22, height: 12 }, page(12)),
  accessory('a-crossingGate', '20-027-1', 'Crossing gates', 'Crossing gate and 124 mm rerailer scenery', 'crossingGate', { length: 70, width: 90, height: 30 }, page(10)),
  accessory('a-building', '23-240', 'Roundhouse', 'Three-stall roundhouse kit', 'building', { length: 200, width: 130, height: 70 }, page(17)),
]

export const CATALOG_SOURCES: { title: string; url: string; note?: string }[] = [
  { title: 'KATO USA 2025 UNITRACK catalog', url: PDF, note: 'Official 40-page catalog, downloaded and checked on 7 October 2026. Track centerline measurements and product SKUs are from its N scale pages 8–26.' },
  { title: 'KATO concrete-tie single track', url: PC, note: 'Official Japanese product page, updated August 2026. Includes the new PC straight and curved pieces.' },
  { title: 'KATO modern DX platforms', url: PLATFORM_DX, note: 'Official platform lengths, product codes, platform doors, and station scenery.' },
  { title: 'KATO island and side platforms', url: PLATFORM, note: 'Current replacement SKUs, 248 mm platforms and 200 mm ends.' },
  { title: 'KATO viaduct stations', url: STATION, note: 'Official 248 × 113 mm station and shop footprints.' },
  { title: 'KATO viaducts and support heights', url: ELEVATED, note: 'Banking approach requirements and the explicit 23-069 support datum: 50 mm pier height, 60 mm roadbed-bottom height.' },
  { title: 'KATO USA UNITRACK', url: 'https://katousa.com/unitrack/', note: 'Official track system introduction and current catalog links.' },
]

/** Only trackElevation is a confirmed support datum; pier height alone is insufficient. */
export interface CatalogSupport {
  kind: string;
  pierHeight: number;
  /** Height of the supported track's roadbed bottom above the table, in millimeters. */
  trackElevation?: number;
  verified: boolean;
  sourceUrl: string;
  notes?: string;
}

export const KATO_SUPPORT_DATA: CatalogSupport[] = [
  { kind: 'a-pier', pierHeight: 50, verified: true, sourceUrl: page(13), notes: 'Official component height is 50 mm. Its roadbed-bottom datum was not separately dimensioned in the inspected source, so this entry must not automatically certify a track elevation.' },
  { kind: 'a-pier-double', pierHeight: 50, verified: true, sourceUrl: page(22), notes: 'Official component height is 50 mm. Supported roadbed elevation is unconfirmed.' },
  { kind: 'a-pier-frame', pierHeight: 50, verified: false, sourceUrl: page(22), notes: '50 mm is only the current visual mesh height; the inspected catalog does not give a component or support datum.' },
  { kind: 'a-pier-cone', pierHeight: 50, verified: true, sourceUrl: page(13), notes: 'Official component height is 50 mm. Use only a separately confirmed support datum for physical planning.' },
  { kind: 'a-pier-tapered', pierHeight: 50, trackElevation: 60, verified: true, sourceUrl: ELEVATED, notes: 'KATO explicitly documents 50 mm pier height and 60 mm track-bottom height for 23-069. This is the roadbed-bottom datum, not top of rail. The adapter/viaduct structure must bridge the additional 10 mm. Footprint and appearance remain nominal.' },
]

/** R315 is an official starter-set choice, not a published minimum or traction guarantee. */
export const E235_ENGINEERING_DATA: { minimumRadiusMm?: number; recommendedRadiusMm: number; generalDesignRadiusMm: number; generalDesignSourceUrl: string; sourceUrl: string; notes: string } = {
  recommendedRadiusMm: 315,
  generalDesignRadiusMm: 249,
  generalDesignSourceUrl: 'https://katousa.com/faq/',
  sourceUrl: 'https://www.katomodels.com/product/n/e235_yamanote_slm',
  notes: 'The current KATO E235 starter set uses R315 for smooth running. KATO USA separately gives R249 ground-level track as its general N-scale factory-coupler design curve, with individual evaluation required below that radius or on viaducts. This general reference is not a published E235-specific minimum. The inspected E235 page does not publish a minimum radius or maximum gradient; both remain unconfirmed. A planning gradient target is an application choice, not a manufacturer specification.',
}
