# v1.6.6 実装・検証記録

確認日: 2026-09-25。対象は本記録と同じコミットの実装。測定時は基点`01265c9`に未コミットのv1.6.6差分を適用していたため、ローカルArtifact内のgitCommitは最終実装コミットを示さない。Windows / Node 22.14.0、Chrome、Codex内ブラウザを使用した。サブエージェントは使用していない。

## 実装範囲

- Unit IDの共通単調採番、Save counter検査、Initial Supplyを除外した検問所候補判定、有刺鉄線を攻撃した個体の移動停止と残Charge維持。
- 全Human固定軍需維持費0、Military FactoryのCG10→MG4、救援物資センターのFood20→CG5、人口維持優先・期首入力限定・施設順配分・電力優先順位を共通経済計画へ実装。
- センター建設50、定員5、電力5、Ground Vision1、空施設撤去25、感染・Supply・Save・公開API・日英UI・Balanced/Randomへの接続。
- 固定長movementSummary、明示route/Move Preview、公開情報だけの最大1代替候補、AI・Metrics・historyの移行。legalActions、公開lossless diff、CAS、hash chainを保持。
- 既定ZIP単独の直接出力、明示keep-directory、有限バッファZIP読取、別StoreでのCore Replay、partial・衝突・中断の非破壊拒否。
- 非同期9 Tool登録と世代付きcleanup、同一window照合、read-only smoke、host制約の診断。Liveの巨大な前後Observation文字列描画を抑え、正本Artifactを維持。
- 採用済み原本から256px透過PNGを生成し、通常・Live・Replayで共通Resolverを使用。全Version、利用文書、現行仕様を更新。

## ローカル自動検証

| 検証 | 実行結果 |
| --- | --- |
| 通常回帰（長時間Seed2ファイルを除外） | 123ファイル、1,074成功・1失敗・11 skip。失敗は公開blocker IDの旧期待値1件で、確定要件に合わせて修正後、当該Bridge12件が全成功 |
| 最終変更の追試 | controller / AgentGame / 新production-diagnostics、3ファイル62件成功。上記回帰で未収集だった追加診断テスト1件を含む |
| 有刺鉄線・感染境界 | 2ファイル33件成功 |
| 標準Balanced Seed1 | 正常終局・各Action受理のテスト成功、約318秒 |
| 標準Random Seed1 | 正常終局・各Action受理のテスト成功、約383秒 |
| 本番Build | TypeScript検査とVite build成功。既存のchunkサイズ警告あり |
| Portable smoke | 本番Browser Bridge検証成功。公開APIのみの外部プレイSeed1が10判断・Turn10通常敗北、Core Replay一致 |
| Portable CLI bundle | `npm run build:portable-session`成功 |
| Release補助スクリプト | Nodeテスト8件成功 |
| 実Action通し検証 | 建設→完成→給電→5人配置→生産→OFF/ON→撤収→撤去の10受理Action。Save往復hash一致、Forecastと実資源一致、子分岐の拒否1件を含む11判断のZIP/Core Replay一致 |

通常回帰のコマンド:

```powershell
npx --no-install vitest run --pool=threads --maxWorkers=2 --exclude src/agent/balancedAgent.batch.test.ts --exclude src/agent/balancedAgent.seed198.test.ts
npx --no-install vitest run src/browser/bridge.test.ts --pool=threads --maxWorkers=2
npx --no-install vitest run src/ui/controller.test.ts src/agent/game.test.ts src/core/v166.production-diagnostics.test.ts --pool=threads --maxWorkers=2
npm run build
npm run test:portable
npm run build:portable-session
npx --no-install vite-node --script scripts/v166-local-acceptance.ts
```

最終結果のログは`output/v166-final-regression.log`、`v166-bridge-followup.log`、`v166-final-followup.log`、`v166-wire-infection.log`、`v166-build.log`、`v166-portable-smoke.log`、`v166-portable-build.log`、`v166-release-tools.log`。実ActionのFixture/ZIPは`output/playwright/v166-acceptance-1790302114375/`。outputはGit対象外であり、再生成スクリプトをコミットする。

11 skipは`NLTH_SESSION_DAILY=1`専用の1,000判断チェーン10ブロックと末尾読取1件。通常回帰では意図的に有効化せず、1,000判断と物理512 MiBは専用workflowへ残した。初期の全件・既定fork実行は旧期待値の失敗とworker RPCエラーがあり中断したため、成功証跡に含めない。その後のthreadsによる上記回帰と修正後追試を採用する。30 Seed・Seed198・200ゲーム全体・両OS配布Packageの最終成否はローカルで成功済みと扱わない。

停止診断は、十分なFoodがあるセンターをOFFにした同一入力で誤ったFood不足100を再現し、修正前失敗→修正後成功を確認した（`v166-production-diagnostics-red.log`と追試）。Liveは実hostのactが30秒timeoutする現象を再現し、巨大応答の描画制限後に建設約2秒・EndTurn約2.5秒で受理を確認した。その他の新規境界テストは最終実装上の回帰検証であり、全件について旧実装の失敗を保存したものではない。

有刺鉄線の残Chargeテストは実移動処理で壁を破壊後、隣接目標のある状態をLoadSnapshotして残Charge3で攻撃できる条件を検証する。通常の隣接Human足止めを迂回する自然発生シナリオとは主張しない。

## 画面・WebMCP確認

- 通常画面の日英、PC幅と390×844で、施設画像、5人のFood100→CG25、OFF時入力0、電力停止理由、撤去返却25とVision1を確認。空施設の実撤去でCGが25増加し、施設が1つ減ることを確認した。
- 最終子分岐ZIPだけをブラウザへ選択し、初期停止、コメント、Turn1→2→1→3の前後seek、稼働時と空施設の詳細を確認。再読込直後のCancel loadingで`Loading cancelled. Select another ZIP.`を確認した。
- LiveのPC/390pxで画像と詳細を確認し、document幅はviewportと同じ390px。通常・Live・Replayの画像Resolverを共通化した。画面記録は`output/playwright/v166-center-mobile-en-expanded.png`、`v166-refund-mobile-ja.png`、`v166-live-center-pc.png`、`v166-live-center-mobile.png`、`v166-replay-center-details.png`、`v166-replay-mobile.png`。
- Codex内ブラウザの実`document.modelContext`で9 Toolの発見、context/legal/preview、建設とEndTurnの実act、Revision0→2を確認。hostのgetToolsはname/origin/pageUrlを返すがwindowを返さないため、ページ内selfTest/smokeは`registered_tool_window_unavailable`。登録9/9・Session readyとは分けて表示する。
- ChromeのLive画像確認では画面テスト専用の非同期WebMCP shimを使用した。window付きshimではSelf Test/smokeがpassed、Revision3不変。これを実host接続成功の根拠にはしない。Codex側の画像captureはtimeoutしたが、DOMと実Tool操作は継続できた。
- ChatGPT Desktop自体、配信後GitHub Pagesの最終Build、実機iPhone/Androidは未確認。オープンウェイト軽量モデルの追加比較は利用環境未準備のため未実施。軽量モデルのプレイ品質や実機RAM改善を主張しない。

参照contractは[OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp)と[WebMCP Draft](https://webmachinelearning.github.io/webmcp/)（2026-09-25確認、Draft日付2026-09-17）。

## A/C容量比較

51×51、ヘリを含む8 Unit、同一State/同一3 Action列（拒否Wait・合法Wait・EndTurn）、同一gzip条件。v1.6.6の全4行には同じmovementSummaryを残し、旧全件列挙とディレクトリ保持だけを切り替えた。v1.6.5は`01265c9`の独立checkoutで測り、新版Readerへ旧Artifactを渡していない。

| 条件 | units UTF-8 | 公開Payload展開 | 同gzip | Session論理量 | Artifact directory | ZIP | 合計論理量 | NTFS割当量 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 同ルール比較元 | 787,806 | 4,736,787 | 157,569 | 282,459 | 252,316 | 255,914 | 508,230 | 526,800 |
| Cのみ | 787,806 | 4,736,787 | 157,569 | 282,459 | 0 | 255,914 | 255,914 | 258,048 |
| Aのみ | 20,814 | 3,603,421 | 111,479 | 236,367 | 206,229 | 209,827 | 416,056 | 432,592 |
| A+C | 20,814 | 3,603,421 | 111,479 | 236,367 | 0 | 209,827 | 209,827 | 212,992 |
| 元v1.6.5（参考・異なるルール） | 784,636 | 4,415,273 | 148,857 | 275,494 | 243,990 | 247,588 | 491,578 | 509,744 |

単位は実bytes。全件列挙・新要約を除いた残り17,644 bytesに対し、新応答20,814は回帰予算`17,644 + 8×2,048 = 34,028`以下。新要約の追加3,170 bytesを旧版の削減分に混ぜない。固定シナリオのunitsは97.36%、Artifact二重保存合計は58.71%削減。CだけでZIP自体が縮むとは扱わない。

生成/読取時間、Observation単体bytes、Session割当量を含む全値は[v166-capacity.json](v166-capacity.json)。NTFS、クラスタ4,096 bytes、`GetFileInformationByHandleEx(FileStandardInfo).AllocationSize`の実ファイル合計を使用し、directory metadataや共有Filesystem overheadを除く。トークン推定なし。時間は他のローカル検証と並行した参照値で、速度保証ではない。

再現は`scripts/v166-capacity.ts`を現版と元版の別checkoutで実行し、両reportを`scripts/v166-disk-allocation.ps1 -CurrentReport ... -BaselineReport ...`へ渡す。容量スクリプトは旧列挙を測定用に復元するが、製品の既定応答・保存経路へ戻さない。

この小規模比較は1,000判断・物理512 MiBを代替しない。テスト閾値は維持する。

## GitHub workflow

依頼者の指示に従い、最終コミットpush後のCI/Pages、`v140-release-validation.yml`（session_only=false、reuseなし）、`ai-portable.yml`について実行開始の確認まで行う。200ゲーム、Session1,000判断以上、実Artifact512 MiB以上、巨大ZIP seek/cancel、Linux/Windows配布検証を残している。結果の監視・成功判定は行わず、Run URLは作業完了報告に記載する。

引継ぎ済み文書移動は`01265c9`に保存した。それ以降Doc/archiveを読解根拠に使用せず変更していない。現行仕様へ反映した確定要件は、今回のarchive変更禁止に従いDoc直下へ保持する。
