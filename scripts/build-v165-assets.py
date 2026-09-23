"""Compile the three user-approved v1.6.5 originals to 256px runtime PNGs."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
for name, suffix, category in [
    ('facility_air_base', 'v1', 'facilities'),
    ('unit_multipurpose_helicopter_landed', 'v1', 'units'),
    ('unit_multipurpose_helicopter_airborne', 'v2', 'units'),
]:
    source = root / f'Art/reference/v1.6.5-concepts/{name}_candidate_{suffix}.png'
    target = root / f'public/assets/board/{category}/{name}.png'
    image = Image.open(source).convert('RGBA').resize((256, 256), Image.Resampling.LANCZOS)
    image.save(target, optimize=True)
    print(f'{target.name}: {target.stat().st_size} bytes')
