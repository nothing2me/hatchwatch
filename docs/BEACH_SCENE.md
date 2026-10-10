# Beach scene design

## Shore water

The current WebGL scene uses one custom water surface and one thin ground-conforming wash surface in [`web/environment.ts`](../web/environment.ts). The water vertex shader adds low swells and stronger nearshore displacement. Its fragment shader combines crossed ripples, view-angle reflectance, a sun or moon highlight, shallow-water color, and broken wave-crest foam. The wash shader moves an irregular run-up front across wet sand and gives its leading edge translucent, lacy foam. Both use the simulation clock, so saved frames are deterministic when captured in a different order.

The official [Three.js `Water` addon](https://threejs.org/docs/pages/Water.html) is a useful reflective *flat* surface, but it has no shoreline breaker or foam model and renders reflections to another texture. For these fixed research cameras, the custom one-pass water plus wash keeps the breaker tied to the beach and the recording cost predictable. It remains an artistic approximation, not fluid simulation.

## Sand and dunes

The 134,400 physical particles in [`web/sand.ts`](../web/sand.ts) are about 18 cm across, far larger than real grains. Rendering every untouched cell as a pebble would make the beach look less real. The fine visible surface therefore uses [Coast Sand 02](https://polyhaven.com/a/coast_sand_02) color, normal, and roughness maps with four seeded texture offsets per sample to break tiling. A quarter-metre local mesh now holds lasting travel tracks and excavation hollows. A separate smooth pressure ridge follows each alternating flipper stroke, so the sand visibly changes while the turtle crawls. Travel exposes only a sparse sample of grains; digging exposes all displaced struck cells as small sand clumps. The broad ground adds small undulations, rises inland into a dune, and continues beyond the camera edge. Track color is sampled in the sand shader, so it follows that relief. This is a coarse granular simulation with a detailed rendering surface, not a simulation of every real sand grain.

The optional local turtle is a single unrigged mesh. Its front and rear flipper vertices now sweep and lift in alternating crawl strokes, with a small body weight shift. A proper skeleton and joint weights would allow more anatomically faithful motion.

## Beach objects

The baseline scene scatters small shell or pebble fragments, thin patches of washed-up seaweed along a wrack line, a few pieces of driftwood outside the central nesting lanes, and sparse dune grass. These are static visual context, not simulated collision objects.

For distinct challenge scenarios, plausible obstacles include larger driftwood, pallets or fishing gear at the strandline; dense roots or vegetation at the dune edge; storm-cut sand banks; and human equipment or litter. Their placement should be sparse and scenario-specific. Large objects should alter a turtle's path or block a camera before they are used to test behavior or detection. [NPS describes vegetation, roots, and woody debris as causes of failed nesting attempts](https://home.nps.gov/bisc/learn/nature/2011-sea-turtle-nesting.htm); [NOAA advises removing beach equipment and keeping nesting beaches dark](https://www.fisheries.noaa.gov/feature-story/what-can-you-do-help-sea-turtles).

The moonlit mode is visual-light footage with a simulated moon and blue directional light. It is not infrared. This visual revision needs fresh registered detector evaluation before its results can be compared with earlier experiments.
