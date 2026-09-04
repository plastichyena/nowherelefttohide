# v1.5.0 Riot Unit Asset Concepts

v1.5.0で追加するRiot PoliceとRiot Zombieの承認済み原画を保管する。

## Riot Police

- File: `riot_police_5_group_approved_transparent_source.png`
- Status: approved
- Approved: 2026-09-04
- Generation mode: built-in ImageGen
- Composition: 濃紺の防護装備と大型シールドを持つ架空のRiot Police 5人組。中央のシールド役と後列4人で、既存のPolice Groupと区別できる密集配置。
- Constraints: 実在組織の徽章・文字・旗・ロゴを使用しない。シールドは非攻撃的な装備として表現し、24–34pxでも輪郭を判別できるようにする。

## Riot Zombie

- File: `riot_zombie_3_group_approved_transparent_source.png`
- Status: approved
- Approved: 2026-09-04
- Generation mode: built-in ImageGen
- Composition: 破損した濃紺の防護装備とシールドを持つRiot Zombie 3人組。中央のシールド役と左右の隊員で、Police Zombieとはシールドと防護装備で区別する。
- Constraints: 実在組織の徽章・文字・旗・ロゴを使用しない。傷・血痕は既存Zombie Assetと同じ限定的なcomic-painted表現に留める。

## Runtime candidates

`scripts/build_board_assets.py --v150-only`は承認済み原画をLANCZOSでcontainし、256×256 RGBAのRuntime PNGへ変換する。RuntimeはUI Asset Registryの固有パスからのみ参照し、RiotをPolice／Police Zombieへaliasしない。

- `public/assets/board/units/unit_riot_police.png`: 59,926 bytes
- `public/assets/board/units/unit_riot_zombie.png`: 61,846 bytes
- Validation: 両方が256×256 RGBA、alpha extrema `(0, 255)`。
- SHA-256 (source):
  - `riot_police_5_group_approved_transparent_source.png`: `5757de58a0598bec3bf2dc73325ba306fbe290b9a9275f545459310e48050c0f`
  - `riot_zombie_3_group_approved_transparent_source.png`: `9a563eff0a3b9953ed936336beb22efef53de16ce6a510739797a66080b83d53`
- SHA-256 (runtime):
  - `unit_riot_police.png`: `26bda34be231d205e971735129bb0b78ba5d51718cefbc7cea2e5c19e2b37901`
  - `unit_riot_zombie.png`: `f016eb64055876337a419454d00d67ebe3ae6dff05c67f4457558446c2f4c798`

The assets contain no text, watermark, real-world marks, or third-party imagery. The two high-resolution sources remain references only and are not preloaded by the browser.
