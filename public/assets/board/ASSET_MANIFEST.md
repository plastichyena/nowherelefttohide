# Nowhere Left to Hide v1.4.0 Board Asset Manifest

- Generated: 2026-08-31
- Runtime format: 256×256 PNG
- Generated source resolutions: 1254×1254 for most sources, 1362×1155 for the
  twelve-Zombie Horde swarm, and 1536×1024 for Capital and Refinery; every
  checked-in runtime image is normalized to 256×256.
- Runtime total: 30 PNG files, 1,328,850 bytes (approximately 1.27 MiB)
- Source: original assets created for this project; no third-party images, real
  logos, seals, flags, or trademarks are included.
- Provenance / licensing: generated specifically for this repository during
  the v1.3.1 implementation. No third-party asset or external asset-license
  obligation is incorporated into these PNGs.
- Generation: OpenAI built-in image generation. The built-in tool did not
  expose a more specific model identifier for recording.
- Mechanical post-processing: Pillow resize/crop/centering, alpha preservation,
  pointy-top terrain mask, LANCZOS downsampling, and optimized PNG compression.
  The deterministic steps and code-drawn overlays are in
  `scripts/build_board_assets.py`. The v1.4 facility PNGs were normalized to
  the same 256×256 RGBA contract and are loaded only through the UI Registry.

## Art direction and prompt family

Simple, iconic, top-down or near-top-down 2D board-game / war-game art for a
mobile hex map. Thick silhouettes and restrained detail take priority over
standalone illustration quality. The palette uses muted earth, olive, slate,
and dark teal with blue Police, olive National Guard, moss Zombie, and
red-orange Horde accents. The setting is immediately after the outbreak:
normal infrastructure is worn but intact, while infection and ruin are applied
as separate overlays. Images contain no text, numbers, real marks, flags, or
photorealistic gore. The approved Zombie sources use limited comic-painted
wounds and blood marks; revisions must not make those details more graphic.

The generation prompts followed this common structure:

> A single top-down board-game terrain tile or transparent unit/facility icon;
> simple flat 2D war-game style; crisp thick outline; readable at 24–34 px;
> muted dark-teal-compatible palette; immediate-post-disaster but functioning;
> transparent padding where applicable; no text, logo, real seal, flag,
> watermark, glow, severe ruin, or photorealistic gore. Approved Zombie units
> may retain limited comic-painted wounds and blood marks.

Subject-specific prompts supplied the terrain, unit, or facility motifs listed
below. After visual review, the original three-Zombie concept replaced the
abstract normal-Zombie silhouette. A new twelve-Zombie swarm was generated from
that concept as a style reference for Horde, then extracted to genuine alpha.
Police was edited from a shield composition to a fictional rounded six-point
badge/emblem and then extracted to real alpha.

The Horde revision prompt requested 9–12 distinct adult Zombies in the same
bold comic-painted style, with 3–4 readable foreground figures, overlapping
middle and rear rows, a compact triangular crowd silhouette, clean transparent
padding, and no scenery, text, real marks, or photorealistic injury. The final
approved result contains twelve Zombies.

## Runtime files

| File | Core type / UI state | Purpose |
|---|---|---|
| `terrain/terrain_plain.png` | `plain` | Dry grass and compacted-earth base terrain |
| `terrain/terrain_forest.png` | `forest` | Dense tree-crown base terrain |
| `terrain/terrain_mountain.png` | `mountain` | Angular rocky-ridge base terrain |
| `overlays/terrain_road.png` | Road connection segment | Rotated from Hex center toward each connected neighbor |
| `overlays/terrain_urban.png` | `isUrbanHex` | Low-opacity civic blocks below facilities |
| `facilities/facility_capital.png` | `capital` | Fictional intact state government hall |
| `facilities/facility_city.png` | `city` | Regional city-center cluster |
| `facilities/facility_farm.png` | `farm` | Barn, silo, and fields |
| `facilities/facility_civilian_factory.png` | `civilianFactory` | General factory and gear motif |
| `facilities/facility_military_factory.png` | `militaryFactory` | Factory and generic supply motif |
| `facilities/facility_refinery.png` | `refinery` | Storage tanks and pipes |
| `facilities/facility_power_plant.png` | `powerPlant` | Turbine hall and transmission tower |
| `facilities/facility_wind_power_plant.png` | `windPowerPlant` | Wind turbine array and compact control hut; fixed 15 Electricity source |
| `facilities/facility_simple_farm.png` | `simpleFarm` | Small forward farm, field rows, and utility shed |
| `facilities/facility_civilian_drone_base.png` | `civilianDroneBase` | Forward civilian drone pad and communications mast |
| `facilities/facility_checkpoint.png` | Checkpoint base | Barrier and guard booth |
| `units/unit_police.png` | `police` | Fictional badge/emblem, sidearm, and blue laurel |
| `units/unit_national_guard.png` | `nationalGuard` | Olive helmet and rifle |
| `units/unit_zombie.png` | `zombie` | Approved three-Zombie civilian/worker group |
| `units/unit_horde_zombie.png` | `hordeZombie` | Dense twelve-Zombie swarm |
| `overlays/state_unsecured.png` | Unowned facility | Gray dashed perimeter |
| `overlays/state_secured.png` | Player-owned facility | Teal perimeter |
| `overlays/state_stopped.png` | Current `operationalStatus === stopped` | Pause bars; not used for forecast warnings |
| `overlays/state_infected.png` | `infected > 0` | Red-orange infection warning |
| `overlays/state_ruined.png` | Ruined facility/checkpoint | Shared crack overlay |
| `overlays/checkpoint_operational.png` | `operational` | Teal lifecycle ring |
| `overlays/checkpoint_abandoned.png` | `abandoned` | Purple warning and slash |
| `overlays/checkpoint_remnant.png` | `remnant` | Broken ochre lifecycle ring |
| `overlays/unit_horde.png` | Periodic/Final Horde | Shared red-orange threat ring |
| `overlays/unit_final_horde.png` | Final Horde | Additional gold outer marker |

`water` intentionally has no PNG and uses the legacy graphics fallback.
Infection and ruin PNGs are shared by normal facilities and Checkpoints.
Numbers, HP, selection, movement, path, attack, Vision, Fog, Supply, forecast
warnings, and Horde entrance directions remain dynamic UI overlays.

## Regeneration and replacement

1. Preserve the filenames and 256×256 RGBA contract; Registry paths are public
   API for Board and Board Legend.
2. Generate one subject per prompt with the same art-direction block. Do not
   commit generated candidates or high-resolution intermediates unless the
   user explicitly requests a retained reference.
3. Update the approved source mapping in `scripts/build_board_assets.py`, run it
   against the local generated-image directory, then inspect alpha edges and
   small-size silhouettes.
4. Run Registry/file tests, production build, and both reference viewports.
5. Keep the runtime total below 3 MiB and do not add a `water` mapping.

The original single-Zombie concept, approved three-Zombie normal-unit source,
approved twelve-Zombie Horde source, and v1.4 facility references live in
`Art/reference/v1.3.1-zombie-concepts/`. These high-resolution sources are not
preloaded and are excluded from the runtime size budget; their 256px derivatives
are the Registry assets listed above. The v1.4 references are in
`Art/reference/v1.4-facility-concepts/` and are original project artwork only.
