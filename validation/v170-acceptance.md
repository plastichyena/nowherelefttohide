# v1.7.0 受入・検証記録

検証日: 2026-10-03。`f79eae9`のmain作業ツリーを継続。開始時のGit差分・未追跡ファイルはなし。文書整理は既存Commitに含まれていた。サブエージェントは使用していない。`Doc/archive/`は参照・変更せず、確定要件は依頼どおりDoc直下に保持する。

実装規則は[現行仕様](../Doc/Nowhere%20Left%20to%20Hide%20PoC%20現行仕様.md) 7.0／18.20、変更の入力は[v1.7.0確定要件](../Doc/Nowhere%20Left%20to%20Hide%20PoC%20v1.7.0%20アップデート要件%20確定版.md)。**今回の依頼ではGitHub Workflowの起動確認までを行い、結果確認・監視は行わない。** リモート未確認を成功と扱わない。

## 実装と固定した条件

- 全開始入口でrandomが既定、fixedを明示選択。UNA標準Config、custom有効設定、root／map／gameplay Seedを共通解決する。
- 独自の整数格子補間で内陸地形を生成。51×51、Reserve392、十字幹線101、州都・4検問所・7 Humanは固定。恒久28／所有8を実地図から数え、残る27施設を再配置する。
- 地形率Plain55〜75／Forest15〜30／Mountain5〜15／Water2〜8%、初期建設12、Army6〜9／Air7〜10／原発12〜18／油田10〜18は要件の初期値を採用。修復160 Hex、生成64試行、同地図での敵配置8試行を固定。
- 連続河川・接続湖、複数渡河、単一橋への依存なし、全施設道路接続・地上到達・Core Supply Sector拡張を検査。固定油田spurをrandomへ使わない。
- 専用静的fallback、Worker進捗と中止、customの限定補正の承認・拒否・再検査、APIの補正なし拒否、開始前State／autosave保護を実装。
- MapDescriptorと実地図・Config・RNGを保存。公開hashにはHidden敵・非公開人口・RNGを含めない。ロードで地形を再生成しない。旧版Save／Session／ZIPは非破壊拒否。
- AI-01〜13の公開投影、供給・移動残状態・型付き攻撃・Gas危険・回復・期待条件による注意停止・未知／対象外／省略・正式終局を共有計算へ接続。compact／handoffにも戦闘情報と省略数・詳細Queryを保持。
- v1.6.9と比較してUnit性能、費用、生産、Wave、敵AI、回復規則は調整していない。

Versionは`src/core/versions.ts`へ集約。App1.7.0、Rules/State/Config20、Save27、API/Observation/Bridge25、Artifact24、Session/Checkpoint21、Action4、Summary2、Query1.7、AiSession1.5、Balanced15／Random10。Play-turn1.3、Store1、ZIP外枠2は維持し内包schemaを検証する。

## マップ・再現性・合法経路

環境: Windows x64、Node22.14.0、AMD Ryzen 7 3700X。計測はこの端末の値で、受入の秒数上限ではない。

| 検証 | 結果 |
| --- | --- |
| 通常seed1〜100＋境界6（0、-1、2^32−1、2^32、MIN/MAX_SAFE_INTEGER） | 106初期化成功、hard invariant違反0、生成不能0 |
| 標準通常群fallback率 | 0/100＝0%、上限10%以内 |
| 27可動施設の位置多様性 | 各施設39〜100種類。州都を除く全施設で位置が変化 |
| 生成時間 | p50 255.70ms、p95 287.12ms、max 378.85ms |
| 重要4施設×seed1/2/3/42/100 | 20合法経路成功、確保Turn1〜4、供給Turn1〜3 |
| 全20中立施設×seed1/42 | 40合法経路成功 |
| 固定互換 | v1.6.9 HEADから保全した6seedの初期＋3 EndTurn digest一致 |
| 固定／random Save・Session再開・Checkpoint分岐 | 一致 |
| 公開ZIP先頭・中間・最終seek／別途Action再実行 | 両モード一致、3 Decision |
| 強制64棄却→専用fallback→Save／Engine復元 | 成功 |

生成証跡は[v170-map-validation.json](v170-map-validation.json)。各seedのDescriptor、棄却、地形成分、橋／道路、建設余地、施設距離・方面、MP/Fuel、工程時間、RSS、終端を保持する。経路のAction列・MP/Fuel・費用・実供給は[v170-terrain-routes.json](v170-terrain-routes.json)と[v170-terrain-routes-all.json](v170-terrain-routes-all.json)。敵だけを除いたfixtureで、初期全Human・視界・費用・補給・Refugee規則を使う。遠距離の検問所移設では州都側の道路全区間を現在視界に入れる必要があり、経路計画もこの条件を満たす。敵との戦闘成功や同時確保を保証する試験ではない。

ブラウザとNodeのseed42 mapHashはともに`95f4e2c00834b5f08de10fe2b2d3499bc5a0b8bd7ed0d4174504e1e30f7d4f58`。設定hashは`711ed3a16162e0858521bde548e44cb059b2c4fb9bebc415a7978d940420c2d7`。個別gameplay Seed変更時の地図同一性、設定property順変更時の同一性を検査する。Windows/Linux別processは専用Workflowで比較し、結果未確認。

## ローカル回帰と修正過程

横断回帰はCIと同じ範囲で1回実施した（Balanced長時間専用2ファイルを除外）。初回は**139ファイル、1195成功・48失敗・11skip**、1122.95秒。初回を全成功とは記録しない。

失敗には旧版・固定座標を暗黙に仮定したfixture、実Artifact Map IDの誤った固定化、抽象Session fixtureのidentity、descriptor未定義のcompact cloneが含まれた。固定座標を検査する既存試験は明示fixedへ変更し、Config変更fixtureは正しいdescriptorを再構成した。実装不具合は同じ失敗入力で修正後の成功を確認した。

対象21ファイル再実行は164成功・27失敗・11skip。その失敗3ファイルを修正し75成功・1失敗・11skip。残るcompactの旧「map無し」期待値を新Map識別契約へ更新し、最後のファイルは5成功・11skip。これにより初回失敗の全対象を解消した。テストの削除・新規skip・恒真assertへの変更はしていない。

追加確認は範囲別に実行した。件数は重複を含むため合算しない。

- AI・Live・Query: 3ファイル12件成功。
- map・AI・回復・移動要約・Checkpoint: 5ファイル38件成功。
- fallback Saveと両モードSession／Replay: 2ファイル8件成功。
- 文書契約・公開戦闘・handoff: 5ファイル32件成功。
- 設定列挙順・初期敵配置不能・handoff戦闘情報の追加確認: 4ファイル18件成功、既存日次11skip。
- 最終Save互換表示・非破壊拒否・復元: 22件成功。
- 配布レポート／証跡ツール: 10件成功。
- 型検査・production build、production Browser Bridge smoke、Portable Session bundle生成、公式公開API例の実行: 成功。従来のbundleサイズ／dynamic import警告は残る。
- 生成したPortable bundleを直接起動し、既定random／明示fixed＋個別Seedの新規Sessionを確認。別Node processのrandom42 hashも上記と一致。
- 外部公開API E2E: seed1でTurn15の正式`capitalLost`終局、実行Replay一致。EndTurn方策のsmokeであり組み込みAIの勝率評価ではない。

11skipは既存の日次専用Session試験で、実行用環境フラグを指定していない。Balanced seeds1〜30／198はGitHub専用job、大規模SessionはCI／Release Validationへ委ねる。元Solプレイのログ／ZIPは今回再実行していない。限定fixtureの成功を元プレイの再現成功と呼ばない。

## UIと目視

production previewをWindows Chromiumで確認。PC1280×720と390×844、日英、UNA random、fixed詳細Seed、custom半径0→5補正、生成進捗と中止、補正拒否後のContinue、承認後開始、JSON読み込み、専用fallback常時表示、道路／川／橋／Supply overlay、Live AI、ZIP観戦最終seekを確認した。中止前後のautosave文字列は一致し、Live開始でも通常saveは不変。モバイルのタイトル重なりを修正した。**390×844はブラウザ幅の検証であり、実機スマートフォン試験ではない。**

seed1〜32を[一覧画像](v170-32-maps.png)で目視。連続する川と湖、複数橋、森林／山地のまとまり、施設と進入路を確認した。個別UI証跡はローカル`output/playwright/v170-*.png`。公開ZIPの観戦は保存された公開地図を表示する。

## 自動プレイ・リモート計画

ローカルsmokeはmapSeed1／gameplaySeed1、Random10／Balanced15、Rules20、標準UNA random、上限3ターン。Random233.09秒、Balanced63.43秒で、いずれも技術失敗なし・**未終局打切り**。敗北や成功ゲーム数へ算入しない。[実測とMetrics](v170-auto-play-smoke.json)を保存した。

この実測を根拠に事前計画を600から**60ゲーム（mapSeed1〜10×gameplaySeed1/2/3×2方策）**へ調整した。100ターン上限は維持する。通常生成はseed1〜10,000、散在1,000件を生成版の固定domainから選び、失敗seedを除外しない。固定比較は従来Release ValidationのRandom／Balanced各100、合計200ゲームを明示fixedで別集計する。

起動対象:

1. CI and GitHub Pages: 横断回帰、Balanced1〜30／198、通常1,000 Decision、Build／Pages。
2. v1.7.0 Map and gameplay acceptance: Windows/Linux100＋境界、hash比較、11,000生成、60自動プレイ、合法経路、Save／Replay。
3. v1.7.0 Release Validation: fixed200ゲーム・Replay、512MiB Session等。
4. AI Portable Player Package v1.7.0: Linux／Windows配布物、Bundled Node、起動・Replay・ライセンス。

各結果、配布完了、公開Pagesのv1.7.0実動作は未確認。後続の結果確認では失敗・timeout・turn_limitを区別し、この記録へ追記する。

## ライセンス

simplex-noiseは候補から採用せず、第三者コードを追加していない。整数演算だけの小さな独自ノイズで環境差と依存を抑えた。package-lockの変更はアプリ版のみ。既存Phaser／fflate／Node等の通知とLICENSE本文は配布スクリプトで保持する。本作全体のPolyForm Noncommercial＋追加許諾、画像条件は変更しない。最終配布物の同梱結果は上記Workflowで確認する。
