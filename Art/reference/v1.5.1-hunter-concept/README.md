# v1.5.3 Hunter Zombie Asset Concept

v1.5.3 の Hunter Zombie 服装更新に対応する単体原画と Runtime 候補を保管する。性能、単体描画、長い爪、Runtime Path は維持する。

## Hunter Zombie

- Source: `hunter_zombie_approved_transparent_source.png`
- Runtime: `public/assets/board/units/unit_hunter_zombie.png`
- Status: approved v1.5.3 candidate
- Generated: 2026-09-06
- Generation mode: built-in ImageGen
- Generation output: 1254×1254 RGBA PNG, 1,321,013 bytes
- Runtime output: 256×256 RGBA PNG, 45,390 bytes
- Runtime SHA-256: `CF0BBDA1CFCE675DE415E1B0DF778DDD8174A8650B528E9D653825CD1AC4437C`
- Source SHA-256: `F99B199C5BC6291E1055E84A00074A0AC86B5577B39E8B537DB31109B0400F51`

既存 `public/assets/board/units/` の9枚を目視参照し、中央寄せの全身シルエット、太い輪郭、comic-painted の面陰影、抑制した傷表現を合わせた。新規生成のため ImageGen へ既存画像を入力画像として渡さず、画風要件をプロンプトで指定した。服装は薄い長袖シャツ、短いショーツ、クルーソックス、ランニングシューズ、スポーツウォッチへ更新し、フードと長ズボンは避けた。

### Prompt record

```text
Use case: stylized-concept
Asset type: game character render for a mobile hex strategy board unit
Primary request: one full-body Hunter Zombie character, a muscular track-and-field athlete type zombie wearing a thin long-sleeve athletic shirt and short running shorts, crew socks, running shoes, and a small sports watch clearly visible on one wrist; leaning forward in an aggressive runner's stance, with both hands reaching toward the viewer and unnaturally long claw-like fingernails clearly visible
Scene/backdrop: genuinely transparent background with no ground, no scenery, no cast shadow
Subject: single adult zombie hunter; mutated athletic build, broad shoulders, powerful runner's legs, tattered but recognizable running clothing, pale sickly gray-green skin, intense predatory expression, subtle undead decay
Style/medium: existing Nowhere Left to Hide unit art style, comic-painted zombie character illustration, hand-painted texture, bold dark ink-like outlines, readable at small board size, cohesive with the existing unit PNGs
Composition/framing: centered full-body single figure, three-quarter front view, strong silhouette, slight forward lean, both elongated claws separated from the torso and easy to read, sports watch visible, generous transparent padding, no group
Lighting/mood: dramatic but clean directional light, ominous high-contrast game asset
Color palette: muted charcoal, slate blue, and faded athletic colors for clothing; pale gray-green skin; restrained rust red and ochre accents matching the existing units
Materials/textures: brush-painted fabric folds, worn thin knit athletic shirt, scuffed shorts, crew socks, running shoes, controlled comic texture
Constraints: square raster asset intended for final 256x256 PNG, preserve transparent alpha; keep thin long-sleeve shirt, short shorts, crew socks, running shoes, sports watch, forward lean, athletic build, and both long claws unmistakable; no text, no logo, no watermark, no extra characters, no weapons
Avoid: hoodie, hood, long pants, photorealistic rendering, excessive gore, dismemberment, blood splatter, background, props, cropped limbs, hidden hands, short normal fingers, duplicate figures
```

The Runtime derivative was produced mechanically with the repository's `contain()` helper in `scripts/build_board_assets.py` using `--v153-only`: RGBA conversion, LANCZOS contain into a 202×202 bound on a transparent 256×256 canvas, and optimized PNG compression. Runtime alpha extrema are `(0, 255)` and the maximum alpha on all four edges is `0`. The checked-in board PNG total after the v1.5.3 assets is `1,739,215` bytes (approximately 1.66 MiB), below the 3 MiB limit.

The image contains no text, logo, watermark, real-world mark, weapon, or third-party imagery. The source is retained for review only; the browser should preload the 256px Runtime derivative through the UI Asset Registry.
