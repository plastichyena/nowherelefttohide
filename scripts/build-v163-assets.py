"""Compile the approved v1.6.3 image originals into the existing 256px runtime format."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'Art/reference/v1.6.3-concepts'
outputs = {
    'terrain_water.png': 'terrain/terrain_water.png',
    'terrain_bridge.png': 'overlays/terrain_bridge.png',
    'facility_nuclear_power_plant.png': 'facilities/facility_nuclear_power_plant.png',
    'unit_special_forces.png': 'units/unit_special_forces.png',
    'unit_pack_zombie.png': 'units/unit_pack_zombie.png',
}
for name, target in outputs.items():
    image = Image.open(source / name).convert('RGBA')
    image = image.resize((256, 256), Image.Resampling.LANCZOS)
    destination = root / 'public/assets/board' / target
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)
    print(f'{target}: {destination.stat().st_size} bytes')
