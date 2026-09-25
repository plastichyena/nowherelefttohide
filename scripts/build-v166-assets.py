"""Resize the user-approved v1.6.6 original for the shared board registry."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
source = root / 'Art/reference/v1.6.6-concepts/facility_relief_supply_center_candidate_v1.png'
target = root / 'public/assets/board/facilities/facility_relief_supply_center.png'
Image.open(source).convert('RGBA').resize((256, 256), Image.Resampling.LANCZOS).save(target, optimize=True)
print(f'{target.name}: {target.stat().st_size} bytes')
