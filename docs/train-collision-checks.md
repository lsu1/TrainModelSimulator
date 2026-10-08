# Train contact checks on curves and slopes

Version 0.7.3 corrects the false “This curve is too tight” stops on the KATO M1 + V1 + V2 preset. The three-car E235 stopped at the uphill transition around main piece 20; the eleven-car E5 stopped at the same transition.

## Cause and correction

The previous self-contact check treated the train’s conservative 45 mm clearance reserve as a solid, full-width carriage. When neighboring cars tilted differently on an incline, their reserved space could intersect even though the rounded bodies and localized roof fittings remained clear.

Within one train, the check now derives convex parts from the procedural car meshes, retaining individual roof fittings and separate instanced components. It first tests a containing car envelope, including protruding nose paint, gangway frames and end fittings, then tests the relevant solid parts. Adjacent cars receive the same contact checks as other cars. Only the identified inter-car coupler mounts are excluded as intentionally joined connection hardware.

The existing 45 mm reserve, braking lookahead and swept motion protection between independent trainsets remain in use. Track and accessory clearance audits also retain their existing planning rules. Genuine self-contact still stops the train and now displays “The cars would touch here. Check the curve, slope, or loop size.”

The Shinkansen meshes also had tiny body/end-fitting intersections on combined curve and grade transitions with the earlier nominal 4.2 mm spacing. Their procedural gap is now 4.8 mm, with corresponding fixed coupling-link lengths. The E235 retains its 4.2 mm gap. Body lengths and bogie chords remain unchanged, and the bodies and links do not stretch during a journey. These are renderer dimensions, not measurements of KATO’s coupling mechanisms.

## Existing designs and verification

Layouts keep their tracks, heights, supports, train types, counts and saved positions. A train saved at the former stopping point reopens paused at that position and can resume with Play. Blocked reasons are runtime state and are not persisted as layout defects.

Complete-circuit regressions cover three- and four-car E235, eleven-car E5, seven-car E6 and eleven-car E7 formations, both turnout routes and both directions at their model-specific maximum speeds. Focused geometry checks verify that every retained car vertex lies inside its self-contact broad phase, that the former clearance-only overlap is allowed, and that genuinely contacting adjacent cars on an abrupt grade remain detected. Existing following, opposing, junction, short-loop and stalled-frame safety checks remain required.

The shapes are convex bounds of original procedural meshes, not a manufacturer-certified physical simulation. Bogie collision parts currently tilt with the car body, while the renderer additionally rotates the bogies to their rail tangents. Wheels, traction, coupler forces and derailment dynamics are simplified. KATO’s official plan and product instructions remain the references for a purchased layout; the preset’s nominal grade/support datums and assembled connector fit still require the checks described in [the plan notes](kato-plan02-1a.md).
