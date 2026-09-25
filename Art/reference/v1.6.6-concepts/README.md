# v1.6.6 救援物資センター候補

生成日: 2026-09-24。方式: built-in `image_gen`。

状態: **候補生成・提示済み。依頼者による画像の採用判断とゲームへの組込みは未実施。**

要件: [v1.6.6アップデート要件 確定版](../../../Doc/Nowhere%20Left%20to%20Hide%20PoC%20v1.6.6%20アップデート要件%20確定版.md)

| ファイル | 内容 |
| --- | --- |
| [facility_relief_supply_center_candidate_v1.png](facility_relief_supply_center_candidate_v1.png) | 小型倉庫・配給テント・物資箱を組み合わせた救援物資センターの透過PNG原本 |
| [prompt-v1.txt](prompt-v1.txt) | 実際に使用した生成プロンプト |
| [prompts.json](prompts.json) | 生成方式、原本パス、参照画像、採用状態、画像検査結果 |

既存の簡易農場・民需工場のRuntime画像を目視して画風・視点を確認した。今回の生成には画像入力を指定せず、斜め俯瞰・太めの輪郭・落ち着いた配色をプロンプトへ反映した。

生成原本から無加工でコピーし、Codex側の原本も保持している。1254×1254、32-bit ARGB、左上alpha=0、完全透過970,764ピクセルを読取検査で確認。小型倉庫・テント・物資箱の構成と、文字・実在ロゴがないことを目視確認した。ゲーム用256px加工、小縮尺・PC/モバイル・3表示経路の確認は実装工程で行う。

採用後のRuntime配置予定: `public/assets/board/facilities/facility_relief_supply_center.png`。本作業では既存のRuntime Asset Registryやゲームコードを変更していない。

SHA-256: `E1B44793C3C03029C78DE20CD89B76C38615122CDBAC0CE5C7C976A88B052D7C`
