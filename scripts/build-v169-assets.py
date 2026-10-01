"""Prepare the already approved IFV artwork for the existing 256px registry."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
source = root / 'Art/reference/v1.6.9-concepts/unit_ifv_candidate_v1.png'
target = root / 'public/assets/board/units/unit_ifv.png'
Image.open(source).convert('RGBA').resize((256, 256), Image.Resampling.LANCZOS).save(target, optimize=True)
print(f'{target.name}: {target.stat().st_size} bytes')
