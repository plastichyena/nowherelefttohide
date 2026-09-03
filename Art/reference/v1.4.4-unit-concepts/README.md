# v1.4.4 Unit Asset Concepts

v1.4.4で更新・追加するPolice、National Guard、Police Zombie、Soldier Zombieの承認用原画を保管する。

## Police

- Approved composition: `police_group_approved_source.png`
- Runtime source: `police_group_approved_transparent_source.png`
- Status: approved
- Approved: 2026-09-03
- Generation mode: built-in ImageGen
- Style references:
  - `public/assets/board/units/unit_zombie.png`
  - `public/assets/board/units/unit_horde_zombie.png`
  - 生成した第1 Police案
- Composition: アメリカ風の標準的な巡回警察官5人組。男女混成、濃紺制服、中央1人と後方4人の密集配置。
- Style: 既存Zombie Assetへ寄せたcomic-painted調。低めの頭身、太い輪郭、強い面陰影。実在組織の徽章・文字は使用しない。
- Note: ユーザー比較では、マットな3～4色へ単純化した第3案ではなく、Badgeの立体感を保持した第2案を採用した。

Runtime向けには、承認済み原画の構図と画風を維持したまま256×256 px透過PNGへ仕上げ、`public/assets/board/ASSET_MANIFEST.md`へ生成・後加工・承認情報を追記する。

## National Guard

- File: `national_guard_5_group_approved_source.png`
- Status: approved
- Approved: 2026-09-03
- Generation mode: built-in ImageGen
- Style references:
  - `police_group_approved_source.png`
  - `public/assets/board/units/unit_national_guard.png`
  - `public/assets/board/units/unit_zombie.png`
  - `public/assets/board/units/unit_horde_zombie.png`
- Composition: 武装したアメリカ風州兵5人組。男女混成、迷彩戦闘服、Helmet、Load-bearing vest、Rifle、中央のSquad leaderと後方4人の密集配置。
- Decision: 5人版と10人版を比較し、256×256での過密回避と人物・装備の可読性を優先して5人版を採用した。
- Constraints: 実在部隊章、文字、Flag、Logoを使用しない。Rifleは安全なLow-ready方向とする。

## Police Zombie

- Approved composition: `police_zombie_3_group_approved_source.png`
- Runtime source: `police_zombie_3_group_approved_transparent_source.png`
- Status: approved
- Approved: 2026-09-03
- Generation mode: built-in ImageGen
- Style references:
  - `police_group_approved_source.png`
  - `public/assets/board/units/unit_zombie.png`
  - `public/assets/board/units/unit_horde_zombie.png`
- Composition: 破れた濃紺巡回制服のPolice Zombie 3人組。中央1人と後方2人の密集配置。BadgeとDuty beltで元Policeと識別する。
- Constraints: 武器を使用させず、実在組織の徽章・文字を使わない。傷・血痕・損傷は既存Zombie Assetの表現範囲を超えない。

## Soldier Zombie

- Approved composition: `soldier_zombie_5_group_approved_source.png`
- Runtime source: `soldier_zombie_5_group_approved_transparent_source.png`
- Status: approved
- Approved: 2026-09-03
- Generation mode: built-in ImageGen
- Style references:
  - `national_guard_5_group_approved_source.png`
  - `police_zombie_3_group_approved_source.png`
  - `public/assets/board/units/unit_zombie.png`
  - `public/assets/board/units/unit_horde_zombie.png`
- Composition: 破損した迷彩服・Helmet・Load-bearing vestを着たSoldier Zombie 5人組。中央1人、Flank 2人、後列2人の前傾突進配置。
- Decision: 5人版を採用し、Police Zombieより高い密度・重量感・前進速度をSilhouetteで示す。
- Constraints: 武器を持たせず、実在部隊章、文字、Flag、Logoを使用しない。傷・血痕・損傷は既存Zombie Assetの表現範囲を超えない。

## Runtime candidates

`scripts/build_board_assets.py --v144-only`は承認済み透過原画をLANCZOSでcontainし、現行Runtimeを変更せず`runtime-candidates/units/`へ256×256 RGBA候補を生成する。Police、Police Zombie、Soldier Zombieでは、組成承認後にbuilt-in ImageGenのbackground-extractionで焼き付いたチェッカーボードだけを除去した原画を使用する。National Guard原画は生成時点でgenuine alphaを保持している。

- Status: 全4点を最終承認
- Approved: 2026-09-03
- `runtime-candidates/units/unit_police.png`: 63,299 bytes
- `runtime-candidates/units/unit_national_guard.png`: 68,114 bytes
- `runtime-candidates/units/unit_police_zombie.png`: 51,505 bytes
- `runtime-candidates/units/unit_soldier_zombie.png`: 53,877 bytes
- Candidate total: 236,795 bytes
- Validation: 全4点が256×256 RGBA、alpha extrema `(0, 255)`、四辺の最大alpha `0`。
- Projected runtime PNG total: 既存Police／National Guardを置換し特殊Zombie 2点を追加した場合1,442,395 bytes。3 MiB上限内。

v1.4.4実装で上記4候補を`public/assets/board/units/`へ反映済み。Police／National GuardはRuntime既存ファイルを置換し、Police Zombie／Soldier Zombieは新規追加した。UI Asset Registry、Board Legend、Preload、Fallback、`public/assets/board/ASSET_MANIFEST.md`も同じ変更へ同期している。Runtime候補の承認記録と実ファイルのSHA／サイズを保持し、今後の差し替えはこの承認済み候補を基準にする。
