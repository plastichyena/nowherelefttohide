"""Build the checked-in 256px board sprites from approved generated sources.

This is a deterministic post-processing helper for v1.3.1.  It keeps the
runtime files small, preserves alpha, and draws the intentionally simple
state/road overlays without introducing another runtime dependency.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


SIZE = 256
HEX = [(128, 4), (246, 64), (246, 192), (128, 252), (10, 192), (10, 64)]


SOURCE_FILES = {
    "terrain/terrain_plain.png": "exec-f82ee016-22fa-4cc8-a721-6ba1d29854b0.png",
    "terrain/terrain_forest.png": "exec-3a7a166d-c63b-4385-98d1-2dde5db185a0.png",
    "terrain/terrain_mountain.png": "exec-c056154e-c925-4f32-8407-4db8c20eb38c.png",
    "units/unit_police.png": "exec-20e97c62-29c5-4fb9-aad4-b6d175627096.png",
    "units/unit_national_guard.png": "exec-44628075-d9b3-45fa-be4e-29bff1b35ac1.png",
    # The normal unit intentionally uses the approved three-zombie concept;
    # Horde uses the later twelve-zombie swarm in the same painted style.
    "units/unit_zombie.png": "exec-087a7b56-619a-43f5-8369-c9b72a144fc8.png",
    "units/unit_horde_zombie.png": "exec-a8dc1823-ab4f-4e30-a200-489af6ab6c4a.png",
    "facilities/facility_capital.png": "exec-38df97fb-371b-4e72-a008-c21e8e138b4e.png",
    "facilities/facility_city.png": "exec-d681d207-fb45-415d-ab0b-92dcffa7f96e.png",
    "facilities/facility_farm.png": "exec-525d9acf-b074-409b-aabd-4cfc514485ee.png",
    "facilities/facility_civilian_factory.png": "exec-1fc8bb56-ee14-4f39-81dd-052a119c7e70.png",
    "facilities/facility_military_factory.png": "exec-30ff3744-361a-472f-9615-818e44bc2597.png",
    "facilities/facility_refinery.png": "exec-e25d0baf-90c6-45d8-aab8-eecc733f4013.png",
    "facilities/facility_power_plant.png": "exec-1ce684b2-f841-4e51-99ca-15ddb7ce0979.png",
    "facilities/facility_checkpoint.png": "exec-f7da9ed3-9ef1-47df-bc41-3f81cd6f9437.png",
}

V140_SOURCE_FILES = {
    "facilities/facility_wind_power_plant.png": "wind_power_plant_concept.png",
    "facilities/facility_simple_farm.png": "simple_farm_concept.png",
    "facilities/facility_civilian_drone_base.png": "civilian_drone_base_concept.png",
}


def contain(source: Image.Image, bounds: tuple[int, int], y_offset: int = 0) -> Image.Image:
    image = source.convert("RGBA")
    image.thumbnail(bounds, Image.Resampling.LANCZOS)
    result = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    x = (SIZE - image.width) // 2
    y = (SIZE - image.height) // 2 + y_offset
    result.alpha_composite(image, (x, y))
    return result


def terrain(source: Image.Image) -> Image.Image:
    image = source.convert("RGB")
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    rgba = image.convert("RGBA")
    mask = Image.new("L", (SIZE * 4, SIZE * 4), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon([(x * 4, y * 4) for x, y in HEX], fill=255)
    mask = mask.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    rgba.putalpha(mask)
    return rgba


def overlay_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def draw_overlays(output: Path) -> None:
    image, draw = overlay_canvas()
    draw.polygon([(128, 102), (256, 102), (256, 154), (128, 154)], fill=(45, 48, 51, 224))
    draw.line([(128, 110), (256, 110)], fill=(210, 188, 122, 180), width=3)
    draw.line([(128, 146), (256, 146)], fill=(210, 188, 122, 180), width=3)
    draw.line([(148, 128), (246, 128)], fill=(232, 210, 143, 220), width=4)
    image.save(output / "overlays/terrain_road.png", optimize=True)

    image, draw = overlay_canvas()
    blocks = [(34, 55, 84, 101), (94, 38, 143, 92), (156, 52, 218, 101), (46, 139, 102, 196), (116, 116, 169, 174), (180, 132, 224, 190)]
    for index, box in enumerate(blocks):
        fill = (126, 138, 147, 54 if index % 2 else 44)
        draw.rounded_rectangle(box, radius=5, fill=fill, outline=(181, 191, 196, 80), width=3)
    draw.line([(24, 119), (232, 119)], fill=(203, 183, 147, 78), width=8)
    draw.line([(110, 24), (110, 232)], fill=(203, 183, 147, 66), width=7)
    image.save(output / "overlays/terrain_urban.png", optimize=True)

    def ring(name: str, color: tuple[int, int, int, int], width: int = 14, dashes: bool = False) -> None:
        layer, pen = overlay_canvas()
        if dashes:
            for start in range(0, 360, 40):
                pen.arc((24, 24, 232, 232), start=start, end=start + 24, fill=color, width=width)
        else:
            pen.ellipse((24, 24, 232, 232), outline=color, width=width)
        layer.save(output / f"overlays/{name}.png", optimize=True)

    ring("state_unsecured", (154, 166, 172, 230), dashes=True)
    ring("state_secured", (64, 205, 187, 238), width=12)

    image, draw = overlay_canvas()
    draw.rounded_rectangle((82, 48, 112, 208), radius=9, fill=(161, 174, 181, 238), outline=(31, 39, 45, 255), width=6)
    draw.rounded_rectangle((144, 48, 174, 208), radius=9, fill=(161, 174, 181, 238), outline=(31, 39, 45, 255), width=6)
    image.save(output / "overlays/state_stopped.png", optimize=True)

    image, draw = overlay_canvas()
    draw.polygon([(128, 24), (232, 210), (24, 210)], fill=(218, 84, 48, 72), outline=(245, 117, 67, 240), width=12)
    for x, y in ((128, 104), (95, 160), (161, 160)):
        draw.ellipse((x - 18, y - 18, x + 18, y + 18), fill=(242, 109, 55, 220), outline=(84, 29, 23, 255), width=5)
    image.save(output / "overlays/state_infected.png", optimize=True)

    image, draw = overlay_canvas()
    cracks = [[(126, 20), (112, 74), (141, 105), (119, 145), (136, 181), (109, 236)], [(35, 83), (82, 98), (101, 127)], [(221, 74), (177, 104), (157, 141)], [(42, 204), (91, 178), (119, 145)], [(213, 204), (166, 180), (136, 181)]]
    for points in cracks:
        draw.line(points, fill=(75, 62, 62, 235), width=12, joint="curve")
        draw.line(points, fill=(189, 118, 102, 165), width=3, joint="curve")
    image.save(output / "overlays/state_ruined.png", optimize=True)

    ring("checkpoint_operational", (94, 220, 221, 238), width=11)
    image, draw = overlay_canvas()
    draw.polygon([(128, 28), (222, 198), (34, 198)], outline=(165, 111, 153, 240), width=13)
    draw.line([(66, 66), (194, 194)], fill=(190, 126, 165, 242), width=15)
    image.save(output / "overlays/checkpoint_abandoned.png", optimize=True)

    image, draw = overlay_canvas()
    draw.arc((25, 25, 231, 231), start=34, end=152, fill=(210, 184, 112, 238), width=16)
    draw.arc((25, 25, 231, 231), start=208, end=326, fill=(210, 184, 112, 238), width=16)
    draw.rectangle((40, 112, 78, 144), fill=(210, 184, 112, 220))
    draw.rectangle((178, 112, 216, 144), fill=(210, 184, 112, 220))
    image.save(output / "overlays/checkpoint_remnant.png", optimize=True)

    ring("unit_horde", (235, 98, 55, 240), width=13)
    image, draw = overlay_canvas()
    draw.ellipse((14, 14, 242, 242), outline=(255, 205, 87, 248), width=15)
    draw.ellipse((34, 34, 222, 222), outline=(239, 103, 65, 220), width=7)
    for angle_box in ((115, 5, 141, 36), (220, 115, 251, 141), (115, 220, 141, 251), (5, 115, 36, 141)):
        draw.ellipse(angle_box, fill=(255, 205, 87, 248))
    image.save(output / "overlays/unit_final_horde.png", optimize=True)


def build(source_root: Path, output_root: Path) -> None:
    for relative in SOURCE_FILES:
        (output_root / relative).parent.mkdir(parents=True, exist_ok=True)
    (output_root / "overlays").mkdir(parents=True, exist_ok=True)

    terrain_names = {"terrain/terrain_plain.png", "terrain/terrain_forest.png", "terrain/terrain_mountain.png"}
    for relative, source_name in SOURCE_FILES.items():
        source = Image.open(source_root / source_name)
        if relative in terrain_names:
            result = terrain(source)
        elif relative.startswith("units/"):
            result = contain(source, (202, 202))
        else:
            result = contain(source, (218, 218), y_offset=3)
        result.save(output_root / relative, optimize=True, compress_level=9)
    draw_overlays(output_root)


def build_v140(source_root: Path, output_root: Path) -> None:
    """Post-process the three v1.4.0 facility concepts without rebuilding legacy assets."""
    for relative, source_name in V140_SOURCE_FILES.items():
        destination = output_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        source = Image.open(source_root / source_name)
        contain(source, (218, 218), y_offset=3).save(
            destination,
            optimize=True,
            compress_level=9,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--v140-only", action="store_true")
    args = parser.parse_args()
    if args.v140_only:
        build_v140(args.source_root, args.output_root)
    else:
        build(args.source_root, args.output_root)


if __name__ == "__main__":
    main()
