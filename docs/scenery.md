# Scenery builder

The **Scenery** tab adds lightweight 3D surroundings to any preset or self-built railway. It uses the current track and accessory geometry to find space for decorations. Existing layouts open with their original surroundings until you choose to generate and keep a scene.

## Build and preview

1. Open **Scenery** and choose **City**, **Countryside**, or **Hills**.
2. Select **Buildings**, **Roads**, **Cars**, **People**, **Trees**, **Parks**, or **River**, and choose **Quiet**, **Balanced**, or **Busy** density.
3. Optionally describe the setting, or choose one of the example prompts.
4. Press **Build my city**, **Build my countryside**, or **Build my hills**.
5. Rotate and zoom to inspect the preview. **Keep this city** or **Keep these surroundings** accepts it; **Try another** makes a different arrangement; **Cancel** restores the accepted scene.

Preview scenery is not saved until you keep it. Keeping or removing surroundings creates one Undo step. The tracks, train models, and train controls retain their existing behavior.

## City neighbourhoods

City generation arranges buildings in plots facing the streets. Houses have roofs, porches, planted gardens, and parking; shops have glazed fronts, signs, awnings, and outdoor tables; apartments and offices have distinct façades, windows, entrances, and rooftop equipment. Paved forecourts and paths join building plots to the streets. Trees, garden patches, parks, and small paved squares fill suitable spaces between the railway and neighbourhoods.

City streets have pavements, lane markings, pedestrian crossings, streetlights, and bus shelters. Local streets use clear ground inside and around the railway; they can form separate neighbourhoods or end before the protected rail boundary. Buildings face these streets, while the railway's track geometry, bridges, supports, and trains stay in place.

Saved arrangements are preserved when you open an older scene. To generate a city with the improved v0.16.1 arrangement, open **Scenery**, choose **City**, clear any marked area for a whole-scene change, then press **Build my city**. Explore the preview and choose **Keep this city** when you like it. **Try another** offers another arrangement, and **Undo** restores the previous accepted scene. Use **Save changes** to update an existing named layout, or save a copy to keep both versions.

## Supported descriptions

The guided generator runs entirely in the browser. It recognizes scenery words in English and Chinese and combines them with the selected choices. It does not contact an AI service or require an account or API key. The text field also works with your device's dictation.

| Request | Examples |
| --- | --- |
| Theme | city / 城市, countryside / 乡村, hills / 山丘 |
| Buildings | houses / 房子, apartments / 公寓, shops / 商店, offices / 办公 |
| Streets and life | roads / 道路, cars / 汽车, people / 行人 |
| Greenery and water | trees / 树, park / 公园, river / 河流 |
| Size and density | smaller / 小一点, taller / 高一点, fewer / 少一点, more / 多一点 |

For example, try “A quiet city with small houses, shops and trees” or “乡村，有房子、道路、汽车和树木.” Prompts can add requested features or change the theme, size, and density. Use the checkboxes to control the feature selection; unrestricted conversation, arbitrary positioning instructions, and complex negative instructions are outside this first version. An unrecognized description produces guidance instead of an invented interpretation. Descriptions are limited to 500 characters.

Buildings use house, apartment, shop, and civic-building models. A requested school uses the civic model, and a playground appears as a small park. Pedestrians are stationary miniature figures. Hills, trees, and water use the simulator's miniature railway appearance. The supported English and Chinese descriptions and preview controls continue to work with the improved city design.

## Change a place

Choose **Mark an area**, then click the ground to place a circle or drag to choose its radius. **Small**, **Medium**, and **Large** adjust the marked area. The circle supplies the location for “here”; dragging elsewhere after marking still moves the camera.

Describe a local change, such as “A park with trees,” then press **Change this area**. Objects and ground patches whose centres are inside the circle are replaced by the preview, while those outside remain in place. New footprints must fit within the circle and clear the railway. **Keep this change** accepts the replacement, and **Cancel** returns to the accepted surroundings.

“Remove” or “clear” with a marked area previews clearing its scenery objects. **Clear area** removes the selection circle. **Remove surroundings** removes the whole accepted scene and supports Undo.

Local changes preserve existing roads, rivers, and traffic definitions. Build the whole setting first to add a road or river; this version does not draw new road or river routes inside a marked circle.

## Roads and traffic

The main road forms a rounded, connected perimeter loop around the railway. Generated cities also add local streets where they fit safely. Cars, vans, and buses follow the closed perimeter road in both directions with Japanese left-hand traffic and a following gap. Requesting cars also requests a road, so vehicles have a route to follow. Moving vehicles remain on their saved road loop; local streets do not add vehicle junction routing.

Use **Moving road traffic** to pause or resume vehicles without changing train playback. It also works in a preview. Local scenery changes retain traffic routes and definitions. Junction traffic control, walking pedestrians, custom road drawing, and tunnels are future possibilities.

## Placement and railway changes

The generator checks every rail route, including turnout branches and both double-track lanes, and existing catalog accessories. It reserves ground space beneath elevated and graded tracks as well, rather than assuming there is room for scenery underneath. Generated roads and rivers avoid the railway and each other; scenery does not silently insert a railway bridge, alter a ramp, or reroute a track to accommodate them.

When an area is too small, the preview may contain fewer objects and explains when requested scenery could not fit. The arrangement is bounded and deterministic for the same geometry, request, and seed; **Try another** uses a new seed.

Changing railway geometry cancels a stale preview. **Keep** rechecks the current railway before accepting a scene. Accepted decorations that conflict with later track or accessory edits are hidden while that conflict exists; compatible saved objects remain available. These conservative visual checks are separate from the simulator's existing railway and physical-shopping checks.

## Save and reopen

Accepted surroundings are included in autosaves, named layouts, copies, exported JSON files, and reopening. They are stored as an optional scenery plan alongside the existing version 5 layout data. Older layouts without that plan remain supported.

Saved data includes the arrangement, object variations, landscaped plot details, ground patches, road and river routes, vehicle definitions, prompt, and traffic pause setting. Vehicle animation positions are runtime state: reopening starts from the saved initial vehicle placement rather than the exact frame at which you left. Unaccepted previews and marked-area selections are drafts.

The plan supports at most 400 decorative objects, 256 ground patches, and 36 moving vehicles. Repeated model parts use instanced rendering to keep the scene lightweight. Preview views and simulator screenshots show the actual 3D environment, including its roads, parcels, and buildings; the earlier generated illustration was the concept used to guide the city improvements.
