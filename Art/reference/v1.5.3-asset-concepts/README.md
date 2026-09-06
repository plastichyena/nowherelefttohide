# v1.5.3 Gas Zombie and Army Base Asset Concepts

v1.5.3 で追加した Gas Zombie と Army Base の生成記録、後加工記録、Runtime 検証値を保管する。高解像度の生成候補は Runtime に同梱せず、built-in ImageGen の出力識別子と SHA-256 だけを記録する。

## Gas Zombie

- Runtime: `public/assets/board/units/unit_gas_zombie.png`
- Source output: `exec-241e6709-0a91-4c48-8942-ffd4b02f2bb6.png` (1254×1254 RGBA, 1,592,824 bytes)
- Source SHA-256: `D0E5BB106F85A7C8ACC768B7B1916E8637B2E3F811219BEB9414B63570073782`
- Runtime: 256×256 RGBA PNG, 54,468 bytes
- Runtime SHA-256: `04B7DA9A8D4C4019B6D30D88C24EE900985F9E1694E5FC6F0C9C86A8583B59B`
- Generation: built-in ImageGen, 2026-09-06

### Prompt record

```text
Use case: stylized-concept
Asset type: game character render for a mobile hex strategy board unit
Primary request: one full-body Gas Zombie, a single adult zombie with a visibly swollen rupture-ready gas sac bulging from its back and shoulders, subtle green gas vapor drifting around the sac; the gas is an external visual motif only
Scene/backdrop: genuinely transparent background with no ground, no scenery, no cast shadow
Subject: one distinct undead gas carrier, hunched and heavy-backed, arms hanging forward, sickly gray-green skin, restrained comic-painted decay, the swollen back sac and vapor unmistakable in silhouette
Style/medium: existing Nowhere Left to Hide unit art style, comic-painted zombie character illustration, hand-painted texture, bold dark ink-like outlines, readable at small board size, cohesive with the existing normal Zombie and Hunter units
Composition/framing: centered full-body single figure, three-quarter view so the inflated back sac is visible beside the torso, generous transparent padding, compact silhouette, no group
Lighting/mood: dramatic but clean directional light, ominous high-contrast game asset
Color palette: muted moss green, olive, charcoal, rust red, and ochre accents matching the existing units; gas vapor pale toxic green with low-opacity edges
Materials/textures: rough worn clothing, brush-painted fabric folds, inflated translucent organic sac with cracked patches, controlled comic texture
Constraints: square raster asset intended for final 256x256 PNG, preserve transparent alpha; keep one figure, swollen back gas sac, visible green vapor, and clean silhouette unmistakable; no text, no logo, no watermark, no extra characters, no scenery, no weapons
Avoid: gas mask, tanks, backpack, industrial canister, laboratory equipment, excessive gore, dismemberment, blood splatter, photorealistic rendering, opaque background, cropped limbs, duplicate figures
```

## Army Base

- Runtime: `public/assets/board/facilities/facility_army_base.png`
- Source output: `exec-efb7de25-827a-4ab9-a01d-51e9927cd022.png` (1254×1254 RGBA, 2,090,686 bytes)
- Source SHA-256: `6C889038639037A090A87632BD4003EE842043BD52AA6BBBDD71C732E48556F9`
- Runtime: 256×256 RGBA PNG, 75,190 bytes
- Runtime SHA-256: `F5EAFF9ED8538F097FA39439A59DECE7B4F0B3F4BBC832380A329EEAF191614A`
- Generation: built-in ImageGen, 2026-09-06

### Prompt record

```text
Use case: stylized-concept
Asset type: game facility render for a mobile hex strategy board
Primary request: one compact Army Base facility icon enclosed by a clear perimeter fence, with three distinct readable structures: a barracks, a military hangar, and a watchtower; include a small gate and a few generic crates, but keep the silhouette uncluttered
Scene/backdrop: genuinely transparent background with no ground plane, no scenery beyond the facility, no cast shadow
Subject: fictional post-outbreak Army Base viewed from a high three-quarter top-down angle; fenced compound, olive and slate military structures, watchtower visibly taller than the barracks and hangar; no flags or real insignia
Style/medium: existing Nowhere Left to Hide facility art style, crisp hand-painted 2D board-game strategy icon, bold dark outlines, compact isometric forms, readable at small board size, cohesive with the existing City and Military Factory PNGs
Composition/framing: centered single facility compound, fence forming a strong outer shape, barracks and hangar separated enough to read as two buildings, watchtower at one corner, generous transparent padding, no text
Lighting/mood: clean directional daylight with muted post-disaster atmosphere
Color palette: muted olive green, dark teal, slate blue, warm gray, weathered tan, small rust-orange accents; restrained teal and ochre outlines
Materials/textures: weathered corrugated metal, concrete barriers, chain-link or panel fence, roof vents, simple gate, controlled hand-painted texture
Constraints: square raster asset intended for final 256x256 PNG, preserve transparent alpha; fence, barracks, hangar, and watchtower must remain identifiable after 256px downsampling and at low zoom; no text, no logo, no watermark, no real-world flag, seal, or military insignia
Avoid: city skyline, dense urban blocks, factory smokestacks, refinery tanks, wind turbines, aircraft, weapons firing, soldiers, vehicles dominating the icon, photorealistic rendering, opaque background, excessive ruin
```

## Mechanical post-processing

Both assets were converted to RGBA and passed through `contain()` in `scripts/build_board_assets.py` with `--v153-only`. Unit Gas Zombie uses the existing 202×202 contain bound; Army Base uses the existing 218×218 facility bound and `y_offset=3`. Each result is centered on a transparent 256×256 canvas and saved with optimized PNG compression level 9. Both runtime alpha channels have extrema `(0, 255)` and keep transparent padding around the silhouette. The final registry paths are the only browser-preloaded files; no third-party artwork, text, logos, flags, or water assets were added.
