# v1.7.3 セキュリティ更新計画・評価

調査日: 2026-10-29。基点 `d0b08ccaf5969c00f8d021a2e0c2ff3d880121f3`、作業branch `codex/nlth-v1-7-3-security`。本書は最新承認に従った実施判断と範囲を固定する。実施結果は [受入記録](../validation/v173-final-acceptance.md) に記す。

進行状況更新: 保存メニュー表示の更新漏れを元v1.7.2担当へ戻した後、限定修正完了とユーザーの公開再開承認を受領した。指定patchのhashと原本・統合treeを照合し、git apply --check成功後に取り込んだ。修正後55件・型・build・実ブラウザの成功を[最終受入記録](../validation/v173-final-acceptance.md)に保存した。[引継ぎ記録](../validation/v173-score-save-status-handoff.md)と修正前1304成功/11skipの証跡は履歴として保持し、修正後の全体回帰成功とはしない。以下の承認済み公開手順を再開する。

## 判断と作業境界

**v1.7.3を実施する。通常の保守更新を基本とし、旧Viteの開発サーバーを第三者から到達可能にしている環境では優先して適用する。** Viteの修正版があり、既定の `server.host: '0.0.0.0'` は全interfaceで待ち受ける。ネットワーク経路やFirewall等が接続を許す場合に第三者到達の条件が重なる。端末の実公開範囲や漏洩・侵害の発生自体を確認したわけではない。静的PagesとPlayer CLIにViteのHTTPサーバーは含まれない。

mainの未追跡2文書とv1.7.2の39変更・29未追跡ファイルを読み取り確認し、追跡・未追跡全ファイルのSHA-256を専用tree内 `output/v173-security/preservation-before.json` に保存した。v1.7.2は未commit・未統合・未pushだった。最新の「今回の修正含めて1.7.3として公開」承認により、**終局スコア、Save28、Rules21と必要セキュリティ修正を統合して公開する**。以前の「修正不要の場合だけv1.7.2公開」という条件は置き換わった。スコア係数・設計は元成果のまま採用する。

取込開始時に元担当 `mcp:77447112-45c9-47af-8787-1b07f3c60681` はcompleted、activeRunIdなし。同プロジェクトの実行中threadは本担当のみだった。元ファイルを再hashし初回一致を確認後、`v172-import-manifest.json` の68件を基準に専用treeへコピーした（package.jsonだけはセキュリティ更新済み1.7.3を保持）。元treeへcommit・編集・削除を行わない。スコア固有修正の発見後は公開保留のユーザー判断に従い、管理側へ戻す。22:44 JSTに元担当の再開と元Controllerの更新を検出し、本担当は統合コードを固定して引継ぎ記録のみを確定した。

実在するoriginは `https://github.com/plastichyena/nowherelefttohide.git`。mainは上記基点、公開Pagesの最新Deployment記録は `4958667d85ef01bf950e7a936fa0ca31ecac9ccf`（v1.7.1、2026-10-04、success）。HTMLも直接取得した。GitHub Releases一覧は空。取得した最新100件のActions Artifact一覧からv1.7.1 portableの実物は確定できなかった。公開済み全ZIPのNode版を推定しない。

許可範囲は専用branchのcommit・通常pushと、既存Pages公開元 `origin/main` への安全なfast-forward統合・push、`ls-remote`による到達確認まで。main作業treeの未追跡文書を触らないため、remote/mainが確認済み基点であることを確認して専用treeから `HEAD:refs/heads/main` を通常pushする。公開は既存main push workflowに委ね、release/tag作成・手動dispatch・CI監視・待機・継続pollはしない。push後のサイト反映は別の事実として一度確認し、未反映なら未確認とする。

## 実際の依存と露出

- ブラウザ: Phaser 4.2.1 → eventemitter3 5.0.4、fflate 0.8.3。Pagesは生成済み静的JS。サーバー側Node/Viteは配布されない。
- Player portable: `build-portable.mjs` がesbuildでSession CLIをESM化し、`assemble-portable.mjs` が**指定された実Node実行ファイル**を `runtime/node/` にコピーする。CLIはNode組込みfs/crypto/zlib等とbundle内fflateを使用。Vite/Vitest/Phaser/node_modules/npm/TypeScriptを配布しない。ZIPもNodeの `ZipFile` ではなく既存fflate/独自読取を使用し、zlib利用はgzip/gunzip/inflateRaw。Brotli・HTTP/TLS/DNSサーバー・SQLite・SEA/startup snapshot利用は確認されない。
- ローカル実物例 `D:/private/nowherelefttohide/output/v163-portable-final-win/PORTABLE_PACKAGE.json` はApp1.6.3 / Node22.14.0。これは過去のローカル成果であり、現行配布のNode版を証明しない。
- checkout CLI: `npm run session` はesbuild済みCLIを実行。`session:dev` / `sim` / 試験driverはvite-node 3.2.4 → Vite。開発・ビルドはVite6.4.3、esbuild0.25.12、Rollup4.62.5、PostCSS8.5.26 → source-map-js1.2.1。試験はVitest3.2.7 → mocker3.2.7、tinypool1.1.1等。`@types/node` / undici-typesは型定義でNode本体・実Undiciの更新にならない。
- Vitest設定はNode環境、通常 `vitest run`。`@vitest/ui` / `@vitest/browser`、公開mockerPlugin/interceptorPlugin、APIサーバーを有効にする設定はない。ゲーム入力がtinypoolオプションに渡される経路も確認されない。

## 公式根拠と最小対処

| 対象・公式根拠 | 対象範囲・成立条件と本件の判断 | 修正版・実施 |
| --- | --- | --- |
| Vite同梱launch-editor [GHSA-587h-7wmj-h5pm](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm) / CVE-2026-112942、[GHSA-698v-4r3x-3vcv](https://github.com/vitejs/launch-editor/security/advisories/GHSA-698v-4r3x-3vcv) / CVE-2026-112943、[GHSA-r825-w8mm-5pxw](https://github.com/vitejs/launch-editor/security/advisories/GHSA-r825-w8mm-5pxw) / CVE-2026-112944 | Vite≤6.4.3。到達可能な開発サーバーのeditor入口、細工されたfile引数、Windowsのshell展開や該当editorの引数解釈が条件。既定LAN待受があるため開発者側の対処が必要。実editor構成ごとの悪用は試していない | launch-editor2.14.2を含むVite6.4.4で対処。ただし次行の回帰を避け **6.4.5** を採用 |
| Vite [GHSA-rq7h-c2jc-7f22](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22) | ≤6.4.3。非Windowsで、importのroot相対pathが実OS絶対pathに一致し、deny対象外かつ到達可能なdev serverが必要。今回のWindowsでは当該経路は非該当。Linux開発時の条件付きリスク | 6.4.4修正。6.4.5採用 |
| Vite [GHSA-8g5g-mxqh-grgj](https://github.com/vitejs/vite/security/advisories/GHSA-8g5g-mxqh-grgj) | **6.4.4だけ**に発生したdeny query回帰。現在6.4.3がこの告知の直接対象という意味ではない | 6.4.5修正。中間6.4.4へ止めない |
| Vite [GHSA-9jrq-w75r-8gcw](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw)、[GHSA-vfpm-58rq-9qcg](https://github.com/vitejs/vite/security/advisories/GHSA-vfpm-58rq-9qcg) | 前者はcustom middlewareの未加工URL → transformIndexHtmlが条件。本件にない。後者は8.2/8.3系のみで6系は対象外 | 前者は6.4.4以後。後者目的のmajor更新は不要 |
| source-map-js [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) / CVE-2026-93749、[upstream release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) | 1.0.0〜1.2.1。攻撃者由来のindexed source mapの過大offsetが同期処理を占有。PostCSS経由の開発/ビルド入力が対象。ゲームのセーブ/Replay入力からは使わない | **1.2.2**へlock内の1件だけ更新。PostCSSの既存範囲内 |
| [Node 2026-10 security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)、[22.23.4](https://nodejs.org/en/blog/release/v22.23.4/) | Node22のCVE-2026-111497はBrotli悪性入力、105482はNUL入りDNS名、106069/106072はTLSの非正規IP、105481はHTTP接続再利用、106074はstartup snapshot/SEAの乱数cache、106073はpermission model realpathが条件。現CLIの通常経路でこれらの成立は確認されないが、Node実体を配布する以上古い版の再梱包を防ぐ | 22.23.4（24系24.22.1、26系26.12.1）。CIは22.23.4を固定し、assemblyで修正済みLTSだけ許可。既存ZIPは自動更新されない |

Node同梱依存のc-ares/OpenSSL/Undici/SQLite/証明書更新も上記Nodeリリースに含まれる。個別の同梱依存すべてについて悪用試験をしたわけではない。22系の保守継続、20系のEOLは [Node公式](https://nodejs.org/en/about/previous-releases) で確認。Vite6.4は [公式保守範囲](https://vite.dev/releases) にあり、8系へのmajor更新を必要としない。NodeのOS全体の変更はしない。

## 更新しないものと残留リスク

- [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) と [GHSA-qxg6-89mg-rqv8 / CVE-2026-112949](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8) はmocker3.2.7を対象に含む。公開mocker WebSocket pluginによる任意file読取/JS注入が条件で、本件はplugin未使用。完全対処版は4.1.12/5.0.3（4.1.11のWindows回帰 [GHSA-xp26-3454-mjgp](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp) に注意）。Vitest major変更は今回行わない。
- tinypool1.1.1は [GHSA-5gmw-xhrv-c9v3 / CVE-2026-104848](https://github.com/tinylibs/tinypool/security/advisories/GHSA-5gmw-xhrv-c9v3) と [GHSA-85c8-ppgw-ccpr / CVE-2026-104849](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr) の対象。**事前のprototype pollutionとworker option参照**が必要。前者2.1.1、後者2.1.2で修正。現在の信頼済みNode試験に外部からのpollution入口は確認していないが、不在の完全証明ではない。`^1.1.1`を無検証で2系overrideしない。untrusted plugin/試験やUI/APIを新規導入する時点でVitest系の更新判断を再開する。auditのcriticalを消したことにはしない。
- [Vitest GHSA-p458-7748-mcp3](https://github.com/vitest-dev/vitest/security/advisories/GHSA-p458-7748-mcp3) は5系のUI/browser/APIでの問題。本件の3系plain Node試験に該当しない。
- Phaser4.2.1/fflate0.8.3/eventemitter3は維持する。[Phaser](https://github.com/phaserjs/phaser/security/advisories)、[fflate](https://github.com/101arrowz/fflate/security/advisories)の公開告知とproduction auditを照合する。告知やauditが0でも無欠陥の証明ではない。esbuild0.25.12、Rollup4.62.5、TypeScript5.9.3も不要更新しない。

## lock再現性

基点lock SHA-256 `196c97adae2b9db46f0e345e27bf769cd56dfc34bb84542184191318d35b363e`。既報はnpm ci EUSAGE（lzma Missing）で、元基点checkoutそのものでは未実施。今回、基点と同一package/lockの新品コピー2か所をWindows Node22.23.4/npm11.21.0で導入したところprefix付き・通常 `npm ci` とも成功。元checkoutでは実行していない。以前の失敗を取り消したり「同じ失敗を再現した」としない。

実在する不整合は以下3件。registryのtarball/integrityと既存の親の要求版を照合して、**実tarballに合わせversion欄だけを訂正**する。意図しない新tarballへ置換しない。

- `@napi-rs/lzma-linux-x64-gnu`: version1.5.6 / resolved1.5.1。Rollupが要求するのは1.5.1。1.5.1へ整合。
- `@jridgewell/sourcemap-codec`: version1.5.6 / resolved1.5.5。実導入1.5.5。1.5.5へ整合。
- `es-module-lexer`: version1.7.1 / resolved1.7.0。実導入1.7.0。1.7.0へ整合。

全lock再生成・npm audit fix・OS設定/安全設定変更・他worktreeのnode_modules流用はしない。

## 互換性と検証計画

package/Core/UI/公開APIのApp版は **1.7.3**。元スコア成果のRules/State/Config21、Save28、Agent/Observation/Bridge26、Artifact25、Session/Checkpoint22を引き継ぐ。新autosaveは `v28:v173` とし、旧 `v27:v171` と未公開スコア検証版の `v28:v172` を上書きしない。v1.7.1通常Saveだけを元実装の厳密検証付きで移行し、終了済み結果は未計測のまま保全する。v1.7.0以前・未公開v1.7.2・別App/BuildのSession/Checkpoint/Replayを一般に互換扱いしない。ゲーム係数・採点ロジック・非採点の過密方針は変更しない。

1. 修正前後のlock整合性、clean npm ci、installed version、全依存/production auditを記録。Linux向け依存解決は別ディレクトリで確認し、WindowsでのLinux指定installをLinux実行試験と称さない。
2. Node policyは旧版を拒否し修正済みLTSを通す。実assemblyの旧Node拒否と新NodeでのWindows package再生成、Node版/contents/ZIPを確認する。Linux実機がない場合は未実施と明記。
3. 型検査、production build、Browser Bridge smoke、完成コードの全体回帰を既存Pages手順と同範囲で実施。以前のworker競合によるtimeoutを避けworker1を使い、既存の長時間 `balancedAgent.batch.test.ts` と `balancedAgent.seed198.test.ts` は除外する。30seed/200ゲーム/512MiB専用試験は成功扱いにしない。入力hashを実行前後で照合する。
4. 実ブラウザでデスクトップ/モバイル幅の新規ゲーム・EndTurn・保存/復元、公開Bridgeを確認。ユーザーの既存保存領域を使わない。
5. Windows portableでCLI契約、プレイ、保存・分岐・Artifact/Replay、元データ不変を確認。新規検証出力は専用tree内のみ。
6. 取り込んだ元成果と必要セキュリティファイルだけ明示stageしcommit。main/v1.7.2のhash/statusを再照合後、専用branchとPages公開元mainへ通常pushしremote SHA一致を確認する。CI未確認・remote到達・サイト反映を別に記録する。

v1.7.2自身の旧検証制約（clean install失敗、初回全体149ファイル中6失敗・8test失敗・11skip、後続限定176成功、未完走30seed）はそのまま残る。本件でv1.7.2合格・公開可能と読み替えない。

## リスクとロールバック

Viteのpatch変更によるビルド/開発サーバー挙動、source-map validationの厳格化、Node最低版引上げがリスク。対象ローカル試験で確認する。Node22.23.4以外の対応LTSはpolicy上許可しても今回の動作検証とは区別する。既存の古いZIPは配布停止/差替えを自動実行しない。後日配布する際は新しいZIP全体へ置換し、旧Sessionは旧packageと一緒に保管する。

必要ならこの統合commitを通常のrevertで戻せる。旧依存/Nodeに戻すrollbackには既知リスクが復活する。スコア導入後のSave28をv1.7.1へ逆変換する機能はなく、rollback時は保全した元Save27または旧packageを使う。新旧保存枠と検証生成物・既存証跡・利用者データは削除しない。main push後もCIやPages更新成功を先取りしない。
