# v1.6.0 Oil Field concept

Approved project-local source for the v1.6.0 Oil Field facility. The high-resolution sources are retained for provenance; only the normalized 256×256 derivative is intended for runtime use.

## Files

| File | Purpose | SHA256 |
| --- | --- | --- |
| oilfield_concept_initial.png | First built-in generation output. It has a checkerboard baked into RGB and is provenance only. | 05097289AC5D652F925ED18B8AEECDD10E0C8D7B51D6794C798871519DE72560 |
| oilfield_concept_transparent.png | Approved 1254×1254 RGBA source after background extraction. | E41887ACF1D49F3A27E96FA90E6CFD99E5F84A649D1A864137F6BE5B251C7AFE |
| [facility_oilfield.png](../../../public/assets/board/facilities/facility_oilfield.png) | Runtime 256×256 RGBA derivative. | 532FE404A7264CBC5AA41E4B5ECF056410AEBAEB4E5BCED6859816B4DE94457C |

Generated on 2026-09-13 with OpenAI built-in image generation. The built-in tool did not expose a more specific model identifier.

## Source references

The generation used these repository images as style and scale references only:

- public/assets/board/facilities/facility_refinery.png
- public/assets/board/facilities/facility_power_plant.png
- public/assets/board/facilities/facility_wind_power_plant.png

## Generation prompt

> Use case: stylized-concept
> Asset type: square game board facility token for a mobile-first zombie hex strategy game
> Input images: Images 1–3 are style and scale references only; do not edit or combine them. Match their established isometric game-asset rendering, outline weight, material detail, lighting direction, transparent padding, and visual density.
> Primary request: create one oil field facility asset whose unmistakable main subject is a single large conventional beam pumpjack.
> Scene/backdrop: genuinely transparent background; a compact irregular dirt-and-sparse-grass footprint under the equipment is allowed, consistent with the references.
> Subject: one large pumpjack as the dominant silhouette, accompanied only by one small low cylindrical storage tank and a few short ground-level pipes.
> Style/medium: polished isometric 2D game illustration with crisp dark outlines, detailed painted metal, restrained post-apocalyptic industrial wear, and strong readability at 32–64 px.
> Composition/framing: centered three-quarter isometric view, square canvas, generous transparent margin, full pumpjack visible, compact footprint comparable to the reference facilities.
> Lighting/mood: neutral daylight from upper left, readable highlights and shadows.
> Color palette: dark charcoal steel, muted rusty ochre, restrained industrial yellow accents, small muted teal details, natural dirt and sparse green grass.
> Materials/textures: worn painted steel, subtle rust and grime, concrete/earth footing, clean silhouette.
> Constraints: exactly one pumpjack; pumpjack must be much larger than the tank; genuinely transparent background and preserved alpha; no text; no numbers; no logos; no flags; no watermark; no people; no vehicles; no zombies; no state overlays.
> Avoid: tall drilling derrick, refinery distillation towers, smokestacks, factory building, multiple pumpjacks, large tank farm, flames, smoke plume, hex border, circular badge, UI frame, solid or checkerboard background.

## Background-extraction prompt

> Use case: background-extraction
> Asset type: transparent game board facility token
> Input images: Image 1 is the exact edit target.
> Primary request: remove only the gray-and-white checkerboard background and replace it with genuine alpha transparency.
> Constraints: preserve the pumpjack, small tank, short pipes, dirt-and-grass footprint, composition, proportions, colors, outlines, textures, lighting, and all object edges unchanged; clean cutout with genuinely transparent background; preserve fine grass tips and pipe edges; no halo; no added shadow outside the footprint; no new objects; no text; no logo; no watermark.
> Avoid: painted checkerboard, white background, gray background, crop, restyling, object removal, object addition.

## Runtime normalization

The approved source alpha bounding box, (0, 21)–(1222, 1222), was cropped, resized with Pillow LANCZOS to fit within 217×217, centered on a transparent 256×256 RGBA canvas, and saved with optimized PNG compression. The runtime alpha bounding box is (20, 31)–(234, 234).

No status, ownership, infection, ruin, or selection state is baked into the asset. Existing board overlays must render those states.
