# v1.4 Facility Concepts

These three PNGs are the original concept references for the v1.4.0 facility
assets. They are retained for provenance and visual review only; the game does
not preload them. Runtime images are the normalized 256×256 derivatives in
`public/assets/board/facilities/` and are addressed exclusively by
`src/ui/boardAssets.ts`.

| Reference | Runtime asset | Core type | Gameplay role |
|---|---|---|---|
| `wind_power_plant_concept.png` | `facility_wind_power_plant.png` | `windPowerPlant` | Fixed 15 Electricity, Fuel 0, Vision 1, Zombie Target 5 |
| `simple_farm_concept.png` | `facility_simple_farm.png` | `simpleFarm` | Constructible forward Food source; 10 workers, Required Power 5 |
| `civilian_drone_base_concept.png` | `facility_civilian_drone_base.png` | `civilianDroneBase` | Constructible forward Vision source; 5 workers, Vision worker × 2 |

All artwork is project-original and contains no third-party logos, seals,
flags, text, or trademarks. Runtime conversion preserves transparent RGBA
padding and the existing muted, thick-outline board-game style. The conversion
workflow and size accounting are recorded in
`public/assets/board/ASSET_MANIFEST.md`.
