# Beach scene design

## Shore water

The current WebGL scene uses one custom water surface and one thin ground-conforming wash surface in [`web/environment.ts`](../web/environment.ts). The water vertex shader adds low swells and stronger nearshore displacement. Its fragment shader combines crossed ripples, view-angle reflectance, a sun or moon highlight, shallow-water color, and broken wave-crest foam. The wash shader moves an irregular run-up front across wet sand and gives its leading edge translucent, lacy foam. Both use the simulation clock, so saved frames are deterministic when captured in a different order.

The official [Three.js `Water` addon](https://threejs.org/docs/pages/Water.html) is a useful reflective *flat* surface, but it has no shoreline breaker or foam model and renders reflections to another texture. For these fixed research cameras, the custom one-pass water plus wash keeps the breaker tied to the beach and the recording cost predictable. It remains an artistic approximation, not fluid simulation.

## Sand and dunes

The physical particle bed in [`web/sand.ts`](../web/sand.ts) still drives disturbance. Its cells are much larger than real grains, so the visible undisturbed ground uses [Coast Sand 02](https://polyhaven.com/a/coast_sand_02) color, normal, and roughness maps. The material blends four seeded texture offsets per sample to break obvious square tiling. The ground mesh adds small undulations, rises inland into a broad dune, and continues far beyond the right edge of both camera views. Sand marks conform to that surface. The local model and terrain remain separate from detector inputs and evaluator truth.

## Beach objects

The baseline scene scatters small shell or pebble fragments, thin patches of washed-up seaweed along a wrack line, a few pieces of driftwood outside the central nesting lanes, and sparse dune grass. These are static visual context, not simulated collision objects.

For distinct challenge scenarios, plausible obstacles include larger driftwood, pallets or fishing gear at the strandline; dense roots or vegetation at the dune edge; storm-cut sand banks; and human equipment or litter. Their placement should be sparse and scenario-specific. Large objects should alter a turtle's path or block a camera before they are used to test behavior or detection. [NPS describes vegetation, roots, and woody debris as causes of failed nesting attempts](https://home.nps.gov/bisc/learn/nature/2011-sea-turtle-nesting.htm); [NOAA advises removing beach equipment and keeping nesting beaches dark](https://www.fisheries.noaa.gov/feature-story/what-can-you-do-help-sea-turtles).

The moonlit mode is visual-light footage with a simulated moon and blue directional light. It is not infrared. This visual revision needs fresh registered detector evaluation before its results can be compared with earlier experiments.
