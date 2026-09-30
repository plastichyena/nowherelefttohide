# v1.6.9 IFV source asset

Generated on 2026-10-01, after finalizing the v1.6.9 requirements, using built-in image_gen.

- `unit_ifv_candidate_v1.png`: one tracked infantry fighting vehicle, olive palette, elevated three-quarter view, transparent PNG. Generated source candidate; no runtime integration or user acceptance of the specific image has been recorded.
- `prompt-v1.txt` and `prompts.json`: exact generation prompt and method.
- `image-checks.json`: dimensions, pixel format, sampled alpha values and SHA-256.

The existing packed field artillery source was visually inspected for style, palette and view, but was not supplied as a generation input. The new image was visually checked for a single tracked vehicle, turret, complete silhouette, no people and no text. The generated file was copied into this directory without image modification; its original remains in Codex generated_images.

Runtime 256×256 preparation, board-scale verification, registry integration, icons and in-game testing belong to the implementation phase. No game code was changed by this generation task.
