# v1.5.1 Hunter Zombie Asset Concept

v1.5.1 の Hunter Zombie 盤面 Asset 用に生成した単体原画と Runtime 候補を保管する。

## Hunter Zombie

- Source: `hunter_zombie_approved_transparent_source.png`
- Runtime: `public/assets/board/units/unit_hunter_zombie.png`
- Status: generated candidate
- Generated: 2026-09-05
- Generation mode: built-in ImageGen
- Generation output: 1254×1254 RGBA PNG, 1,240,861 bytes
- Runtime output: 256×256 RGBA PNG, 43,328 bytes
- Runtime SHA-256: `7AB8039981214120FB110E001F465D5A604D7C0B8BE7717434FB59D7EF443C79`
- Source SHA-256: `8175CF08FD46AB3D5FEA1DD57914EEE68E867F2BDA417B3A60C520EDD5E791B6`

既存 `public/assets/board/units/` の8枚を目視参照し、中央寄せの全身シルエット、太い輪郭、comic-painted の面陰影、抑制した傷表現を合わせた。新規生成のため ImageGen へ既存画像を入力画像として渡さず、画風要件をプロンプトで指定した。

### Prompt record

```text
Use case: stylized-concept
Asset type: game character render for a mobile hex strategy board unit
Primary request: one full-body Hunter Zombie character, a muscular track-and-field athlete type zombie wearing a hooded pullover hoodie, leaning forward in an aggressive runner's stance, with both hands reaching toward the viewer and unnaturally long claw-like fingernails clearly visible
Scene/backdrop: genuinely transparent background with no ground, no scenery, no cast shadow
Subject: single adult zombie hunter; hood up and framing the face; athletic broad shoulders, powerful runner's legs, tattered practical hoodie and worn athletic pants; pale sickly skin, intense predatory expression, subtle undead decay
Style/medium: existing Nowhere Left to Hide unit art style, comic-painted zombie character illustration, hand-painted texture, bold dark ink-like outlines, readable at small board size, cohesive with the existing unit PNGs
Composition/framing: centered full-body single figure, three-quarter front view, strong silhouette, slight forward lean, both elongated claws separated from the torso and easy to read, generous transparent padding, no group
Lighting/mood: dramatic but clean directional light, ominous high-contrast game asset
Color palette: charcoal and deep navy hoodie, muted athletic clothing, pale gray-green skin, restrained rust red and ochre accents matching the existing units
Materials/textures: brush-painted fabric folds, worn knit hoodie, scuffed running shoes, controlled comic texture
Constraints: square raster asset intended for final 256x256 PNG, preserve transparent alpha; keep hood, forward lean, athletic build, and both long claws unmistakable; no text, no logo, no watermark, no extra characters, no weapons
Avoid: photorealistic rendering, excessive gore, dismemberment, blood splatter, background, props, cropped limbs, hidden hands, short normal fingers, duplicate figures
```

The Runtime derivative was produced mechanically with the repository's `contain()` helper in `scripts/build_board_assets.py`: RGBA conversion, LANCZOS contain into a 202×202 bound on a transparent 256×256 canvas, and optimized PNG compression. Runtime alpha extrema are `(0, 255)` and the maximum alpha on all four edges is `0`. The checked-in board PNG total after adding Hunter is `1,607,495` bytes (approximately 1.53 MiB), below the 3 MiB limit.

The image contains no text, logo, watermark, real-world mark, weapon, or third-party imagery. The source is retained for review only; the browser should preload the 256px Runtime derivative through the UI Asset Registry.
