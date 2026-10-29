# v1.7.3 統合受入記録

検証日: 2026-10-29。基点 `d0b08ccaf5969c00f8d021a2e0c2ff3d880121f3`、作業branch `codex/nlth-v1-7-3-security`。未公開v1.7.2のスコアと必要セキュリティ更新を統合した専用worktreeを検証する。評価・公式根拠・緊急度・互換性・rollbackは[計画書](<../Doc/Nowhere Left to Hide PoC v1.7.3 セキュリティ更新計画.md>)、採点規則は[現行仕様18.22〜18.23](<../Doc/Nowhere Left to Hide PoC 現行仕様.md>)。

## 現在の判定

ブラウザで保存メニューの表示更新漏れを再現したため、commit・Pages統合・pushは保留。ユーザーが2026-10-29の追加回答で「管理側から元担当へ修正を戻し、今回は証拠を保存して公開保留」を選択した。この担当によるスコア固有修正は行わず、[引継ぎ記録](v173-score-save-status-handoff.md)を保存する。これは保存破損やスコア不一致ではない。独自のモデル・subagentは起動していない。

## 入力・保全

- 実在origin: `https://github.com/plastichyena/nowherelefttohide.git`。確認時のlocal main、origin/main、専用branchの基点は上記SHA。Pagesは既存main push workflowから公開される。
- 公開版の既存Pages Deploymentは `4958667d85ef01bf950e7a936fa0ca31ecac9ccf`（v1.7.1）。公開HTMLの取得とremote commitの確認は別に扱う。公開済みv1.7.1 portableの実Node版は実物を確定できず未確認。
- mainの未追跡2文書、元v1.7.2の39変更・29新規ファイルを保持。全追跡/未追跡の初回hashは専用treeの `output/v173-security/preservation-before.json`。元担当threadはcompleted、activeRunIdなしを確認してから取り込んだ。
- 68件の取込manifestから67ファイルを専用treeへコピーし、package.jsonはセキュリティ更新版を保持。元treeへの編集・commit・stage・削除はない。App表記1.7.3、新保存枠v28:v173と文書整合以外、元のスコア係数・計算・ゲーム規則を変更しない。
- 22:20 JSTの再照合でmain626ファイル、元v1.7.2の653ファイルの変更/欠落0。元要件のSHA256 `f5fd266b6fd064cf2bd37e7e90ab5d40aceaeacd2b3e35771718cb9faa71bc37` は取込コピーとも一致。旧検証証跡は `validation/v172-*` のまま保持する。
- 統合回帰開始時（12:53:31 UTC）のsrc/scripts/public/workflows/package/config471ファイルを [入力manifest](v173-regression-inputs.json) に固定。集合digest `1b12719c5e3c8280807ce412ecb4359968d67708fed107b0c93042ed1ccb7737`。試験中の変更はREADME・正式仕様・受入記録のみ。途中/終了後照合の変更0。各workerの個別読込時刻を計測したとはしない。

## セキュリティ・clean install

Windows x64 / Node22.23.4 / npm11.21.0。OS全体のNode・セキュリティ設定・Git安全設定は変更していない。

| 確認 | 結果・証跡（output/v173-security/） |
| --- | --- |
| 同一基点package/lockの新品コピーでnpm ci | prefix付き、通常cwd、Linux指定依存解決の3通りで成功。baseline-npm-ci.log / baseline-exact-npm-ci.log / baseline-linux.log。元checkoutそのものでは実施していない |
| 修復lockからのclean npm ci | 成功。npm-ci-after.log、fixed-linux.log。既存node_modulesの流用なし。Linux指定はWindows上の依存解決試験でありLinux実行ではない |
| lock整合 | lzma-linux-x64-gnu 1.5.6記載→実tarball1.5.1、sourcemap-codec1.5.6→1.5.5、es-module-lexer1.7.1→1.7.0。version欄だけ修復。以前のEUSAGEは今回再現せず、その原因を確定したとはしない |
| 必要更新 | Vite6.4.3→6.4.5、source-map-js1.2.1→1.2.2。既存親の依存範囲内。package/lock App1.7.3、.node-version22.23.4とassembly runtime下限を整合 |
| 実導入照合 | installed-tree.json / dependency-inventory.json。npm ls --all成功、実導入57パッケージのlock照合成功 |
| npm audit | 指摘対象パッケージは変更前5、変更後3（@vitest/mocker、tinypool、vitest。moderate1 / critical2）、production0。条件付き指摘は残す。同じ告知から派生する対象を含み、件数を独立したCVE数や安全性の証明にしない |
| source-map回帰 | 同じ過大indexed offsetを旧1.2.1へ与えると期待する即時境界拒否にならず失敗、新1.2.2で期待する拒否と正常mapの変換成功。source-map-before.log / security-tests.log |
| Node policy・Vite | 修正済み版の許可、旧版拒否、loopback既定、明示LAN許可、synthetic .envへの4 queryの403と内容非露出を確認 |
| 実Nodeのassembly拒否 | 過去ローカルpackageのNode22.14.0を実際に指定すると出力作成前に拒否（expected exit1）。assembly-old-node.log。古い配布物が自動更新されたという意味ではない |

修復後lock SHA256: `fe8fe99da792a4819b4f387dbfd836504e7f60aa34100edfebf3a68709cbcc59`。npm ciではesbuild postinstallがnpmの既存承認設定により許可されなかった警告が残る。platform executableによる後続buildは成功し、承認設定は変更していない。

## 完成入力に対する試験

| 対象 | 結果 |
| --- | --- |
| npm run typecheck | 成功、integrated-typecheck.log |
| npm run build | 成功、integrated-build.log。chunkサイズ、static/dynamic importの警告あり |
| build:portable-session | 成功、integrated-build-portable.log |
| test:browser-bridge | productionの3 JS bundleと公開HTMLの静的確認成功、integrated-bridge.log。実画面試験とは別 |
| node --test（既存4 release tools＋security2 files） | 15件成功、失敗/skip0、node-tests.log |
| 統合Vitest回帰 | **149ファイル全成功、1304 test成功、11 skip、失敗0、exit0、2883.13秒**。21:53:32〜22:41:35 JST。実行器エラーの報告なし。下記コマンドと同一入力manifestを保持 |
| スコア用fixture生成 | 成功、integrated-fixtures.log / browser-fixtures/evidence.json。勝敗、legacy、huge、公式public ZIPを現入力から生成 |

```text
npx --no-install vitest run --pool=threads --maxWorkers=1 --exclude src/agent/balancedAgent.batch.test.ts --exclude src/agent/balancedAgent.seed198.test.ts --reporter=default --reporter=json --outputFile=output/v173-security/integrated-regression.json
```

上記2ファイルは既存Pages通常ゲートと同じ長時間専用回帰の除外。30seed/seed198専用job、200ゲーム、512MiB制約の完走は本実行の成功に含めない。11件の既存条件付きskipは成功と分ける。ローカルはworker1で実行し、CI worker2の成功を主張しない。[最終検証記録](v173-verification.json)に結果とログhashを保存。通常回帰の成功は、実ブラウザで発見した保存メニュー表示の合格を意味しない。

## Portable

`player-integrated-win` は19ファイル、Node22.23.4、fflateを含むCLI bundle・launcher・必要文書/ライセンスを含む。Node実行体SHA256 `dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f` は公式HTTPS SHASUMSと一致。Vite/Vitest/npm/node_modules/TypeScriptは含めない。system Nodeを更新するだけでは既存ZIPは変わらない。

assemblyのbuildIdは `v173-integrated-local-d0b08cc-dirty`、commitは基点d0b08cc。未commit入力の検証用生成物であり、最終公開commitから作ったrelease ZIPとは表示しない。`portable-zip-receipt.json` のZIP SHA256は `586fbf8b48d18a83cec24eac5ac3aa15fa624859f9221c30aab0454b36d7d5f1`。ZIP再生成・内容列挙は成功、公開なし。

`portable-smoke.mjs --seeds=1,7` はexit0。10コマンド、launcher・有限/対話JSONL・保存・Checkpoint分岐・Artifactを検証。Seed1は15 Decisions、Seed7は16 DecisionsでともにcapitalLost、各Actionの再実行でCompact hashとResultが一致。[portable集計](v173-portable-summary.json)と元portable-smoke.jsonを保持する。外部モデル呼出しはない。

残る11番目のpreview-batchは別の専用Sessionで実Node/launcherから実施し、revision0のEndTurn予測、legal=true、独立実行、既存ファイルhash不変を確認。初回の検証driverは全追加ファイルを禁止したため既存設計の`.lock-history/released-*/owner.json`追加でexit1。ゲーム状態の変更ではないことをservice/storeと照合し、初回記録を残したうえで再検証した。再試験exit0、追加は解放済みlockの証跡1件だけ、予測のrevision変化・既存ファイル変更0（preview-batch-final-receipt.json）。

## 実ブラウザ

T3所有incognito・production preview4174、1280×800と390×844。ユーザーの既存ブラウザ保存を利用しない。[機械可読記録](v173-browser-checks.json)、[モバイル勝利画面](v173-won-ja-mobile.png)。

- App1.7.3でrandom Seed7を新規開始しEndTurn後Turn2、autosave v28:v173、reload→ContinueでTurn2復元。
- 公開window.NLTHはApp1.7.3/Bridge26。fixed Seed1をresetしEndTurnを実行、UIのTurn2と保存bytes不変。
- JSON取込による勝利+17951、敗北-1657301（custom P）、大数+1468173478522781584を確認。390pxで数値が欄内折返し、横方向のはみ出しなし。日英を確認。
- v1.7.1終了Saveは未計測と明示し、新枠へ自動上書きしない。以前のhuge fixtureの保存が残ることを復号して確認。
- 公式public won.zipを実際に取込みPlay、終局+17951を表示。
- getApiInfo全量はT3の64KB上限で返却に失敗したため必要な版・結果だけ取得。保存文字列の最初のJSON.parse検査はgzip形式のため失敗し、その後gzip復号で確認。ツール操作の失敗を製品不具合と混同しない。物理スマートフォンの試験ではない。

### 保存メニュー表示の問題（ユーザー判断により公開保留）

再現: 新規ゲームでTurn2を保存→タイトル→Load→won.json取込。結果には「保存済み · 最終保存ターン 2」、メニューaria-labelには「未保存の変更あり」が残る。保存を復号するとstateSecuredと+17951が存在し、結果画面が正しい。メニューのpending表示が更新されていない。

原因: 元v1.7.2の `controller.ts:loadState` はhasUnsavedChanges=trueを設定しrenderGameしてからautosaveする。成功後のrefreshSaveStatusUiは本文とterminal statusだけを更新し、メニューボタンのaria-label/data-pendingを更新しない。元成果から取り込んだ同一ロジックであり、セキュリティ依存更新が採点や保存を破壊したものではない。必要な最小修正候補は保存status更新時にメニューボタンも同期すること。未保存/保存中/保存失敗/成功/旧Save移行で同じ表示状態を確認する必要がある。現時点でこの修正は実施していない。

## 過去結果と未検証

元v1.7.2はnpm ci EUSAGE、最初の149ファイル回帰で143成功/6失敗・1296test成功/8失敗/11skip、後続の限定9ファイル176成功、30seed未完走。その歴史を今回の成功で書き換えない。詳細は[元受入記録](v172-acceptance.md)。

統合前のsecurity-only回帰はApp/package版不一致の1失敗を含み、最新承認の統合へ切り替えたため所有セッションを中断した（exit1、regression.log）。全成功とせず統合回帰とは分ける。source-map試験の初稿も修正版の境界拒否仕様に合わず失敗し、draft logsを保持してから同一の最終試験で旧版/修正版を比較した。

未実施: GitHub Actions/CI結果の監視・待機・poll、Linux native portable実行、Node24/26実行、長時間専用バッチ/200ゲーム/512MiB、実機mobile、全custom/全seed、各CVEの実悪用、公開済み全portable ZIPのNode同定。CI未確認・audit状態・push状態は別の事実。

通常権限でのWin32_Process照会とGit共通ignoreにアクセス制限あり。必要な読み取り照会だけ既存承認経路で実施し、設定変更や未知プロセス停止は行っていない。中断前の実行セッションを回収し、回帰・portable smokeは重複開始しなかった。

## commit・公開・後片付け

未commit・未push。Pages main統合、新commitのremote到達、公開サイト反映はいずれも未実施。既存release/tagの作成やportable公開も行っていない。2026-10-29 22:28 JST頃の再照合でもorigin/mainは基点d0b08cc、専用branchとv1.7.2 branchのremote refは存在しなかった。元担当の修正を管理側へ戻すというユーザー決定に従った公開保留であり、CI待機ではない。後続作業では最新状態・承認を照合し直す。

所有preview tabはclose成功、4173/4174サーバーは所有exec sessionへのCtrl+Cで終了した（終了操作によるexit1）。22:29 JSTの読み取り確認で対象PID13168/408のViteは残存せず、preview_statusもavailable=false。`output/v173-security/process-cleanup.json`を保持。実行中の回帰をこの後片付けで中断していない。無関係プロセス・main・元v1.7.2・既存証跡に変更を加えていない。

README・PLAY_WITH_AI・現行仕様・計画・本記録のローカルリンク50件は最終文書更新後に存在確認成功。外部URLの再取得やanchorの妥当性はこのリンク検査に含まない。`git diff --check`成功、Gitの既存CRLF/ignore権限警告は残る。

22:43 JSTの最終プロセス照合でも、所有する回帰/portable/previewの既知PIDは残っていない。統合回帰exit0、portable smoke exit0、previewは通常終了の記録を`process-final.json`へ保存。HEADは基点のまま、stageされたファイル0件。元担当への修正引継ぎを残し、今回の担当作業をここで止める。

### 管理側への引継ぎ開始後の原本変化

22:44 JST、元担当threadのordinal2 runningを確認。同時刻の最終原本hash照合ではmain626ファイルは不変、元v1.7.2の653ファイル中`src/ui/controller.ts`だけが初回から変わり、保全assertはexit1になった（preservation-final.json）。本担当による原本編集ではなく、元担当の再開と同時に観測した変更として区別する。22:34までは両Controllerの内容hashが完全一致していた。

本統合treeの471試験入力は終了後も不変で、元担当の新変更はまだ取り込んでいない。新修正が試験済みという主張はしない。新しいwriterへ競合せず、元treeへ復元・上書き・追加編集を行わない。修正前のController実体、初回manifest、取込manifest、今回の全回帰と実画面証跡を専用treeへ保持して引き継ぐ。
