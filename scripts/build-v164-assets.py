"""Compile the user-approved v1.6.4 originals into the existing 256px runtime format."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
for mode in ('packed', 'deployed'):
    source = root / f'Art/reference/v1.6.4-concepts/unit_field_artillery_{mode}_candidate_v1.png'
    target = root / f'public/assets/board/units/unit_field_artillery_{mode}.png'
    image = Image.open(source).convert('RGBA').resize((256,256),Image.Resampling.LANCZOS)
    image.save(target,optimize=True)
    print(f'{target.name}: {target.stat().st_size} bytes')
