# v1.6.9 受入・検証記録

検証日: 2026-10-01。現行仕様とv1.6.9確定要件に従って現在の作業ツリーを継続した。サブエージェントは使用していない。採用済みIFV原画から既存手順でランタイム画像を加工し、新しい画像は生成していない。

## 実装

- UNAのシナリオ選択と日英の指定導入文、PRH/ACの利用不可表示、従来のカスタム画面、12番目のヘルプ「あらすじ」。開始APIとUIが同じシナリオ解決を使い、UNAのConfig上書きを拒否する。
- IFVの指定性能、Army Base限定の生涯1回の生産、費用・予約・完成、歩兵5種の輸送、燃料救援、死亡人口・Reanimation、可視情報からの轢殺予測、移動費・耐久停止・Gas連鎖、通常迎撃の免除。指定値のバランス変更はしていない。
- 現役検問所不在のcritical警告、感染人数の数値/null区別、駐留鎮圧条件と条件付き復旧予測、全Actionの型付き公開要約。Agent/Session/Bridge/Batch Previewで同じ投影を使用する。
- 公開APIだけで実行する例、Portable同梱例、意図・実行結果・推測を分けた報告テンプレート、公開イベント/historyの抽出例。
- App1.6.9、Rules/State/Config19、Save26、Agent/Observation/Bridge24、Artifact23、Session/Checkpoint20、Action4、AiSession1.5、Balanced15/Random10。v1.6.8以前の継続・公開観戦は非破壊拒否。

引き継いだ未追跡文書・原画は64679c8で内容を変えずコミットした。archive内の未追跡ドラフトも引き継ぎ内容のまま登録したが、本文を読まず、実装判断に使わず、編集・移動していない。今回の要件文書はDoc直下に保持する。

## 不具合の再現

- `v169.regression.test.ts`: crisis.ts/public-entities.tsを開始時コミット64679c8の内容に戻した限定実行で、active不在警告と非公開感染人数の2テストが意図どおり失敗した。作業中のコードを復元し、同じ入力の3テストが成功した。ログ: `output/v169-regression-before-fix.txt` / `output/v169-regression-after-fix.txt`。3件目は公開観戦差分のnull保持を検証する。
- 降車歩兵が同ターンに自動鎮圧できる問題を、IFV/ヘリ両方の乗降操作で再現した。修正前の鎮圧previewがnullでなく2件失敗。修正後は同じ操作でpreviewがnull、EndTurnでも鎮圧イベントなし、反撃用Chargeは維持された。`output/v169-disembark-before.txt` / `output/v169-suppression-ui-final.txt`。

## ローカル検証

初回の全体回帰（重いBalanced seed1〜30/198を除く）は135ファイル、112成功/23失敗、1157成功/40失敗/11 skipだった。旧版の期待値、IFVを追加した閉じた型一覧、シナリオ解決での既存RunnerのConfig引き継ぎ、新イベントの保存allowlistを修正した。失敗した23ファイルすべてについて、入力・検証対象を保持した対象再実行の成功を確認した。初回実行自体を成功とは扱わず、成功済みの全体回帰を繰り返してはいない。

再実行中の失敗も保存した。`v169-targeted-recheck.txt`にはfork poolのtask-update timeoutが1件あり、その実行をクリーンな成功とはしない。以後はthreads poolを使った。テスト用のUnit番号・施設人数上限、CLI/Bridge例の入力形、旧文言の期待値も修正し、対象を再実行した。

| 確認範囲 | 最終結果・主なログ |
| --- | --- |
| IFVの指定性能・全9敵種・全5乗員・燃料/HP境界・生産・鎮圧・確保・検問所復旧・降車制限 | 48テスト成功。`output/v169-suppression-ui-final.txt`、生産台帳の死亡後保持を含む最終実行は`output/v169-verified.txt` |
| シナリオ/原文一致/公開要約/Batch/不正filter/stale/通常到達/迎撃中断/燃料不足/Balanced危険回避 | 8テスト成功。`output/v169-contract-final.txt` |
| 警告・非公開感染人数・観戦差分 | 3テスト成功。`output/v169-regression-after-fix.txt` |
| Browser Bridge | 13テスト成功。`output/v169-bridge-final.txt`。IFV/汎用乗降入力と拒否summaryを含む |
| Session再開・Checkpoint分岐・実行Replay・公開ZIP・UNA再生 | 新規2テスト成功。UI49テストと合わせ51成功。`output/v169-last-integration.txt` |
| 既存回帰の失敗箇所 | `v169-fixed-regression.txt`、`v169-final-fixes.txt`、`v169-integration.txt`等で解消。最後のUI旧文言失敗も上記51テストで解消 |
| 型検査・production build | 成功。`output/v169-build-final.txt`。既存の大きなbundle/dynamic import警告は残る |
| Portable CLIビルド・Windows配布物 | 成功。`output/v169-portable-build-final.txt`。Node/CLI/ライセンス/例を含む18ファイルを組立て、同梱Nodeで同梱例を実行して2 Action受理。`output/v169-package-assembly-final.txt` / `output/v169/bundled-example.jsonl` |
| 生成済みPages bundleのBridge smoke | 成功。`output/v169-portable-final.txt` |
| 外部公開API E2E | seed1、EndTurn方策10 Decision、T10敗北、Replay一致。敗北は技術的失敗ではない。同ログ |
| 公開例 | checkout版とPortable CLI版を実行。各2受理Action（Move/EndTurn）、1不合法preview（実行しない）、実行拒否0、入力/queryエラー0、技術的失敗0。`output/v169-public-example.jsonl` / `output/v169-portable-example.jsonl`。開発中の失敗とは区別した最終実行の集計 |
| 公開証拠抽出 | node:test 2件成功。action-resultとhistory、実行とquery合法性を区別 |
| release report/reuse検証ツール | 既存3ツール成功。`output/v169-release-tools.txt` |

11 skipは既存の`NLTH_SESSION_DAILY=1`専用1000 Decision試験で、通常実行では有効化していない。新しいskipや検証対象のモック化は追加していない。200ゲーム、Balanced seed1〜30/198、物理512MiB Sessionの最終結果はGitHub側の確認待ち。

### IFVとバランスの根拠

`validation/v169-ifv-fixture.json`は固定したカスタム局面の実イベント/Stateから作成した。HP200からHorde残Charge4を轢殺し、損傷20、残HP180、燃料100→80、軍需120/Charge3を維持、本体と搭乗者が生存した。生成元は`src/testing/v169-fixture.ts`。生産上限・費用・完成・破壊後の枠は48テストで別途検証した。

これは通常UNAの勝率・標準Seed生存率の測定ではない。200ゲーム結果が出る前に強化・弱体化や勝率改善を主張しない。

## 画面・操作

Playwright CLI、Chrome、Windowsのローカルproduction previewで1440×1000と390×844を確認した。

- 日英のタイトル→シナリオ→UNA Seed→指定導入→開始。PRH/ACは名前とcurrently unavailableを表示して無効。UNAはSeedだけを入力。390pxで横溢れなし、長文末尾と開始ボタンへスクロール可能。
- 既存Config項目がカスタムゲームに残り、導入文なしで開始する。保存の「続きから」とJSON読込も導入文を挟まない。
- Helpは12項目、あらすじ4節と末尾まで表示。原文はテストでも固定文書と一致。
- IFV画像、人口・熟練度・Charge3/4・120軍需/100燃料・搭乗部隊・降車候補を表示。地上輸送には離着陸を出さない。
- 現役検問所不在のcritical警告、未所有油田の感染人数「不明（非公開）」、復旧と生産再開条件、条件付き予測をPC/390pxで確認。読める範囲をスクロール可能、body幅はviewport390と一致。
- 実ブラウザの`window.NLTH`はApp1.6.9、IFVの不適切な生産先をゲームルールで拒否し、accepted:falseのsummaryを返した。

画像は`output/playwright/v169-*.png`、操作snapshotは`.playwright-cli/`に保存した。実機スマートフォン、実外部LLMの長期プレイ、ブラウザ上での大容量ZIP耐久は今回のローカル確認とは区別する。

## 元プレイの公開根拠

`validation/v169-public-evidence.json`は152MBの公開transcriptをストリーム抽出した実記録。

- T30/revision325/request T30-end/event-3968・3969: special-forces-42が油田を鎮圧し復旧。
- T54/revision533/request t54-f4-0/event-6423: farm-4の30人がcity-4へ帰還。
- 同revisionのpopulation-transfers queryはcity-4からの再移送が最大30人まで合法と示す。移送実行の証拠としては扱わない。

## GitHubと未確認事項

ユーザー指定によりCI and GitHub Pages、AI Portable Player Package v1.6.9、v1.6.9 Release Validationは実行登録・起動の確認までとする。200ゲーム、全Replay、大容量Session/ZIP、Linux配布、Pages公開の結果を監視せず、成功とは記載しない。Run URLは実装完了時の回答に記載する。今回の現行仕様反映はローカル確認済み実装についてのもので、リモート検証の全成功を意味しない。
