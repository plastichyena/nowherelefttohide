# v1.6.5 空軍基地・多目的ヘリコプター候補

生成日: 2026-09-23。方式: built-in `image_gen`。

状態: **依頼者が3枚すべて採用を承認（2026-09-23）**。`scripts/build-v165-assets.py` で既存と同じ256px Runtime PNGへ変換し、共通Asset Resolverへ組み込む。生成原本は保持する。

要件: [v1.6.5アップデート要件 確定版](../../../Doc/archive/Nowhere%20Left%20to%20Hide%20PoC%20v1.6.5%20アップデート要件%20確定版.md)

| ファイル | 内容 |
| --- | --- |
| [facility_air_base_candidate_v1.png](facility_air_base_candidate_v1.png) | 滑走路・格納庫・管制塔を持つ空軍基地 |
| [unit_multipurpose_helicopter_landed_candidate_v1.png](unit_multipurpose_helicopter_landed_candidate_v1.png) | 静止した主ローター、着陸姿勢のヘリ |
| [unit_multipurpose_helicopter_airborne_candidate_v2.png](unit_multipurpose_helicopter_airborne_candidate_v2.png) | 同じ機体の飛行・回転ローター。v1から画像端の余白を調整 |

正確な生成プロンプト、入力画像、出力IDは [prompts.json](prompts.json) に記録。既存陸軍基地と野戦砲の画像を画風確認に使用し、新規基地・着陸ヘリの生成には画像入力を指定していない。飛行ヘリは着陸ヘリを編集して作成した。

3画像とも1254×1254、32-bit ARGB PNG、左上alpha=0を読み取り検査で確認。原寸で滑走路、静止/回転ローター、機体の同一性を目視確認した。小縮尺の実盤面確認は実装工程で行う。ファイルは生成原本から無加工でコピーし、Codex側の原本も保持している。

SHA-256:

- Air Base: `C3C4F72814CA368B4916655FF93264578589E1506088F513E1BF5E4C485F8C04`
- Landed: `4AF03FFFF1BCB0B8DC7AACD9ECE07898BA88B74001C618C4D66E5D028922C30F`
- Airborne v2: `99209CA4E3B019C5A685DEDA72C97DF4B935C61F651E012797BF2B593C5A53F1`
