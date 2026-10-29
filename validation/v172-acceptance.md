# v1.7.2 終局スコア ローカル実装・検証記録

実施日: 2026-10-29（JST）。GPT-6 Astra / Max、単独。実装・対象ローカル検証・正式仕様反映を完了。全体回帰の失敗と限定再検証を以下で分けて記録する。クリーンnpm ciの再現性は失敗のまま。

## 作業境界と保全

- Worktree: `D:/private/t3-code-setup-20261001/t3-data/worktrees/nowherelefttohide/codex-nlth-v1-7-2-score`
- Branch: `codex/nlth-v1-7-2-score`。HEAD / main基点: `d0b08ccaf5969c00f8d021a2e0c2ff3d880121f3`。開始時の専用treeはclean、T3 bindと単一writerを確認。
- `D:/private/nowherelefttohide/AGENTS.md`、安定版現行仕様、v1.7.1関連要件、v1.7.2原本を参照。専用treeにはAGENTS.mdが自動コピーされていない。スコア実装に該当する専用スキルはない。ブラウザはT3 previewを使用。Computer Useの適用条件も確認したが、代替ブラウザ接続は利用不可だった。
- 原本SHA256: `F5FD266B6FD064CF2BD37E7E90AB5D40ACEAEACD2B3E35771718CB9FAA71BC37`。許可されたDoc内コピーも同一。本文は変更しない。両要件文書は比較用として保持。
- mainの追跡対象624ファイルをHEADのGit blobと照合: 279件はバイト一致、345件はCRLF/LFのみ、内容不一致・読取不能0。[環境記録](v172-environment.json)、[最終再照合](v172-environment-final.json)とも同じ結果。mainでの`git status`はdubious ownership拒否のため成功扱いにしない。safe.directory・権限設定を変更せず、内容照合で確認した。
- main checkout、元要件、既存未追跡プレイレポート、他worktreeへ書き込まない。既存の報告書・証跡を削除・移動しない。追加の成果物・ログ・画面は専用tree内。commit / merge / push / 公開 / tag / release、reset / clean / 強制操作、サブエージェント・他モデル起動なし。
- GitHub側のCI・CLI試験は起動・監視・待機・ポーリングしない。後日問題が出た場合は同じ実装担当へ戻す、というユーザー依頼を維持。

## 採用した仕様と実装

`terminal-assets-v1`。Configの`terminalScore`に係数を置き、開始時の`scoreContext`と終局の`GameResult.terminalScore`へ固定する。既定値は健康人口100、初期施設300、初期部隊人員維持最大50。これは今回の実装依頼で採用した合理的既定であり、ユーザーが各値を個別承認したという記録ではない。

Hは所有施設workers、生存味方Human Unit population、有効編成予約、全Checkpointのwaiting/screening/approvedを一度ずつ合算する。未救出中立、感染者、死亡者、未出現増援を含めない。搭乗者はunitsの同じIDを一度だけ数え、cargo参照を再加算しない。Fは初期map施設IDのうち、player所有・owned・感染0・building/disabled/ruined/infected以外を1件。recovering、無人stopped、電源OFF等もこの条件を満たせば加点する。

Iは初期7部隊の同じID・兵種の生存人数を開始人数まで数える。I0は死亡後も45（標準）のまま。新編成・増援はHに含めるが独立したBを得ない。これは全生存隊数への加点から対象を狭める実装上のトレードオフ。Uは参考値のみ。

```text
B = I0 > 0 ? floor(bMax * I / I0) : 0
A = wH * H + wF * F + B
P = wH * Hmax + wF * Fmax + bMax + 1
勝利 = A + 1、敗北 = A - P
標準: Hmax=10425、Fmax=28、I0=45、P=1050951
```

Hmaxは初期全施設の容量上限、初期部隊、Finalまでの到着上限、各一度限りの基地・原発・空軍報酬から導出する。隠れた中立人口の実数を使わない。wH/wFは正のsafe integer、bMaxは非負かつ両係数未満。BigIntで計算し、人数内訳・上限・点数はJSONの10進文字列。負・小数・非有限・範囲外をclampしない。既存Number人口台帳の安全域を越えるcustomは理由付き未採点。全customの到達可能性を証明したという意味ではない。

終局の停止信号を先に立て、必須の原子的効果・人口同期・公開Event処理後、candidate検証/commit直前にsnapshotを固定する。即時敗北後に外側の任意Air Base報酬が確定する旧挙動を実際に再現し、その後の報酬/検問所復旧を停止した。拒否candidateのState/RNG/結果は公開しない。再表示・Save・Load・公開Projection・終局後Action拒否で結果を置換しない。

過密は終局の所有都市人数（感染者込み）・容量・都市別超過合計のみ。採点・順位・同点決着へ渡さない。過密履歴、救出猶予/免除台帳、追加RNG、生活シミュレーション、時間/撃破/生産/HP割合の加点なし。新デザイン・演出・ゲーム機能は追加していない。

### 具体例と限界

| H | F | I | B | 勝利 | 敗北（標準P） |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 300 | 20 | 45 | 50 | 36051 | -1014901 |
| 301 | 20 | 45 | 50 | 36151 | -1014801 |
| 300 | 21 | 45 | 50 | 36351 | -1014601 |
| 300 | 20 | 0 | 0 | 36001 | -1014951 |
| 0 | 0 | 0 | 0 | 1 | -1050951 |

ゼロ人数勝利と上限敗北-1は算術境界であり、実ゲームの到達可能性とは別。実Coreの人口0敗北では部隊/検問所等のHが残っていても負になる。異なるConfig/Seed等でPが違う敗北点を直接順位付けしない。

人口1人と施設1件を交換すると既定係数では200点増える場合がある。過密分散50/50と1/99もH/F/Iが同じなら同点。これは重み付きと避難保護の既知の限界。長期の維持費・感染・軍人と民間人の差等も残り、全報酬ハック排除を証明済みとはしない。

## 保存・公開互換

App1.7.2、Rules/State/Config21、Save28、Agent/Observation/Bridge26、Artifact25、Session/Checkpoint22。Action4 / Query1.7 / Summary2 / PlayTurn1.3 / AiSession1.5 / Store1 / ZIP Package2 / Map生成版は維持する。

| データ | 実装・検証した扱い |
| --- | --- |
| v1.7.2途中/終了Save code・JSON | Contextとsnapshotを検証し復元。必須score欠落・不整合は拒否 |
| v1.7.1 Save27 / Rules20 / App1.7.1 | 原checksum・旧shape・旧Descriptorを検証した明示移行。Map/人口/RNG/資産/Event/旧統計を再生成しない |
| v1.7.1途中Save | 固定初期配置規則と保存ConfigからI0を再構成。死亡した初期部隊を分母から落とさず、以後の終局は採点 |
| v1.7.1終了済みSave | 旧結果を保持し「旧版・未計測」。遡及採点なし |
| v1.7.0以前・未知版・混在/破損Save | 理由付き非破壊拒否。版一致検査の一括解除なし |
| 同版終了済みSession/Checkpoint/公開ZIP | 正式CLIの出力、読取、seek、Action Replay、終局後拒否で同一結果 |
| 旧Session/Checkpoint/Replay/Artifact | 通常Save移行とは別。v1.7.1も版不一致で非破壊拒否。旧版対応を宣言しない |

基点の旧コードで生成した真正なv1.7.1保存4件（fixed/random途中、勝利/敗北終了）を`src/testing/fixtures/v171-score-compat.json`に保持。旧Session/公開ZIPの拒否は旧版metadataを持つ合成境界ケースと既存旧ZIP回帰で確認するもので、全旧Sessionの実移行試験ではない。

新autosaveは`nowhere-left-to-hide:auto-save:v28:v172`。旧`v27:v171`等の枠は保持し、旧読込だけで新枠へ自動上書きしない。旧Saveに存在するだけで移行を強制しない。保存失敗でもメモリ上の結果と前の成功枠を保ち、再試行可能。

## 依存環境と再現性の区別

`npm ci`はEUSAGEで失敗: `Missing: @napi-rs/lzma-linux-x64-gnu@ from lock file`。クリーン導入の再現性は失敗のまま。既存mainのnode_modulesを専用treeへ複製し、暫定試験環境として使った。依存範囲・lock・セキュリティ設定の修正、package install/updateは行っていない。

実行環境はNode **v22.23.4** / npm **11.21.0**。主要実体はTypeScript5.9.3、Vitest3.2.7、Vite6.4.3、vite-node3.2.4、esbuild0.25.12、Phaser4.2.1、fflate0.8.3、Rollup4.62.5、@types/node22.20.1。9パッケージのmanifest版はlock entryと一致し、mainからの複製manifestとも同一。実パスは専用treeのnode_modules。推移依存全体のtarball integrity、クリーンインストール、Linux optional binaryの導入は保証しない。[環境JSON](v172-environment.json)に確認範囲を記録。

lock SHA256はmainと同じ`196C97ADAE2B9DB46F0E345E27BF769CD56DFC34BB84542184191318D35B363E`。`@napi-rs/lzma-linux-x64-gnu`のversion1.5.6に対してresolvedは1.5.1.tgz、`@jridgewell/sourcemap-codec`もversion1.5.6/resolved1.5.5.tgzという既存不整合を保持。修復が必要な工程では、該当entry/依存元との対応を調べ、最小のlock再生成範囲と影響を別途提示する。今回の型検査・実試験成功でこの不整合が解消したとはしない。

package.jsonのアプリ版だけを1.7.2へ更新したため、変更していないlockのルート版1.7.1とは一致しない。これは依存グラフ修復とは別のメタデータ差分であり、lock全体が最終packageと完全整合しているとは宣言しない。

## 実行した検証

ログは専用treeの`output/v172/`に保持。成功した対象試験の件数を重複合算せず、各実行の件数と終了コードを記録する。

### 実行入力と最終差分の対応

必要範囲の全体回帰は2026-10-29 14:48:44.308 JSTに開始。14:52時点でsrc/scripts/publicとpackage・設定を含む464ファイルの内容hashと更新時刻を[入力manifest](v172-regression-inputs.json)へ固定した。開始後に更新された対象は0件、集合digestは`7ce38d159e8fb9987b1f87257f30d6f4af4f999df28044567525d5ee5376405b`。各Vitest workerが実際に読んだ個別時刻は計測していないため、開始時刻・mtime・途中/終了時hash一致で対応を示す。最初の中断実行中には表示や追加試験が変わっていたため、その部分結果をこの全体回帰の入力と同一扱いにしない。

この実行中は製品コード・試験を変更せず、別の競合試験も起動しなかった。終了後の版メタデータ・旧Save期待値・旧版案内の修正と限定再検証を別記する。正式仕様とマニュアルは必要な修正の再検証後に反映した。全体回帰の失敗を、後の限定成功で「全体を同じ最終版で再実行して全成功」と読み替えない。

全体実行の最終結果: **149ファイル中143成功・6失敗、1,296テスト成功・8失敗・既存11 skip、exit1、1,955.69秒**。15:21 JSTに終了し、[終了時照合](v172-inputs-broad-complete.json)で464ファイルの変更・削除0、集合hashが開始側と一致した。skipは既存の長時間Session用条件付き11件であり、成功には数えない。

| 全体実行の失敗 | 根拠と修正／切り分け |
| --- | --- |
| `agent/game`のpackage版、`release-seed-report`のpackage版（計2件） | 製品版は1.7.2だがpackage metadataが1.7.1のままだった。package.jsonのversionだけを1.7.2へ更新し、版一致assertは維持。依存範囲とlockは変更しない |
| `agent/game`のSave版（1件） | 新しい開始Context・係数・終局snapshotを要求するSave28へ更新したため、旧27の期待値を28へ更新。Saveの版一致検査は緩めない |
| `core/v170.map`の旧状態hash（1件） | 追加された`scoreContext`、`config.terminalScore`、`result.terminalScore`だけをv1.6.9への比較射影から除く。旧6 Seed×初期/3ターンのhash原本、既存世界/人口/RNG/統計/Eventの比較はそのまま |
| `core/v160`のWind fixture（1件） | State生成後に兵員160と発電量30のConfigを直書きしていた。Configを先に設定してからStateを作る形へ修正。137民間人/160軍人、CG273、予測・建設費150・2回目拒否のassertを維持し、製品のContext不整合拒否を維持 |
| `core/v168.core`難民2件、`agent/history`履歴1件 | 2 workerで20秒×2／30秒の時間切れ。閾値・Seed数・assert・製品処理を変更せず、全体終了後の単一workerで12.915秒／13.554秒／19.791秒、全件成功。2 workerでの再走や性能保証ではない |

このほか全体後に、Save拒否文言と公開APIの日英互換案内だけをv1.7.2／v1.7.1通常Save限定移行へ整合した。採点・人口・勝敗・RNG・終局固定・表示rendererの処理は全体入力から変えていない。[限定実行の入力](v172-inputs-repair-start.json)では差分6ファイルを内容hash付きで列挙した。同じ入力で9ファイル（失敗6＋保存/移行/Controller）を`--pool=threads --maxWorkers=1`で実行し、**176件成功、失敗/skip/実行器エラー0、exit0、237.20秒**（15:22:59 JST開始）。[終了時照合](v172-inputs-repair-complete.json)でも集合hash`abbd32599b9119803427e2f6154f1768fbf46d3de286224eb44b46ebb27c4fa3`は不変だった。

限定再検証後は現行仕様・README・PLAY_WITH_AI・公開API HTML・Workflowの版ラベルを更新した。実行入力集合の追加差分は`public/agent-api.html`の説明だけであり、製品ロジック・試験の追加変更はない。[最終入力](v172-inputs-final.json)に記録し、この状態で型検査と新規出力先への本番/Portableビルド、production Bridge検査を成功させた。既存画面確認時からrendererとControllerの内容も変わっていない。

| 受入境界 | 主な対応試験・確認 |
| --- | --- |
| 人口所在地・搭乗・編成・新部隊稼ぎ | `core/terminal-score.test.ts`、`core/terminal-score-actions.test.ts` |
| 重み・符号・上限・大数・不正値・Config/開始基準 | `core/terminal-score.test.ts`、既存Config/初期配置回帰 |
| 終局原子性・Final Pending・人口0・同時敗北・拒否候補・以後不変 | `core/terminal-score-actions.test.ts`、`core/terminal-score.test.ts`、既存Core回帰 |
| v1.7.1真正Save移行・新Save・未計測・破損拒否 | `persistence/v172-compat.test.ts`、`persistence/save.test.ts` |
| 公開境界・Runner失敗/上限・同じ結果 | `agent/terminal-score.test.ts`、既存Agent/Session/Replay回帰、external-ai Seed1 |
| 終了Session出力と再実行・旧形式拒否 | `session/v171-terminal.test.ts`、`session/session.test.ts`、`replay/package.test.ts` |
| 日英・大数・参考過密・旧版表示・保存失敗 | `ui/terminalScore.test.ts`、既存Controller回帰、T3実画面と保存故障注入 |

最初の`npm test -- --maxWorkers=2`は長時間30 Seedバッチも含めた実行で、既存v1.7.1のローカル全体回帰手順と異なっていた。完了前に自分の実行セッションをCtrl+Cで中断（exit1）し、`full-tests.log`を保持。全体成功として扱わない。必要範囲を既存手順と揃え、`--pool=threads --maxWorkers=2 --exclude src/agent/balancedAgent.batch.test.ts --exclude src/agent/balancedAgent.seed198.test.ts`で取り直す。seed198は中断前に単独ファイルとして1件成功（400.948秒）しており、最終実行では重複しない。30 Seedバッチの完走は未検証。

除外の根拠は、現行仕様18.21の通常回帰範囲、保持されたv1.7.1確定要件§8.3の「長時間のRandom／Balanced等のシミュレーションは今回の必須範囲に含めない」、実在する[ci-pages.yml](../.github/workflows/ci-pages.yml)の通常ゲートと長時間専用jobの分離。`npm test`の無指定glob自体は両ファイルを含むが、通常ゲートはこの2ファイルを明示除外する。両者は**通常ローカル必須ゲート外の長時間専用回帰**であり、プロジェクト全体で不要な任意試験という意味ではない。CIには独立jobがあるが、今回は起動も監視もしていない。

| 除外ファイル | 本来の役割 | 今回の実行有無 |
| --- | --- | --- |
| `balancedAgent.batch.test.ts` | 標準fixed Map・既定Balanced Seed1～30を各終局まで進め、技術失敗/判断上限なしを検査する専用job | 最初の広範実行に含めたが実行全体を中断。ファイル完了の合格記録なし。最終回帰から除外し、別途完走させていない |
| `balancedAgent.seed198.test.ts` | 過去の検問所感染問題をSeed198・100 Turn以内で回帰する専用job | 最初の実行内で1/1成功（400.948秒）。その実行全体は中断なので、これを最終差分での全回帰成功には数えない。重複した別実行はしていない |

ユーザーの追加指示に従い、時間切れの切り分けでは閾値・Seed数・assertを変えず、全体終了後に単一workerで対象を再実行する。固定マップの旧hash fixtureは書き換えず、v1.7.2で追加した採点欄だけを旧データ比較から除外して、残りの世界・人口・RNG・Action列の一致を保つ。

- Coreスコア18件、実Action7件、保存互換11件、Renderer2件、Agent2件の対象回帰。数式例・符号・上限・大数・不正値、各人口プール、移住/編成/完成/搭乗/降機、救出/再奪還、同時敗北/Final Pending、拒否candidate、不変結果、真の旧Save、非公開情報除外を検証。
- `src/session/v171-terminal.test.ts`の勝敗2件: fresh processの公式Windows CLI、Session/Checkpoint、public ZIP Reader、seek、Core Action replay、元Session全ファイル不変を確認し、同じterminalScoreもassert。
- 最終`npm run typecheck`成功（`typecheck-release-final.log`）。最終`npm run build -- --outDir output/v172/dist-final --emptyOutDir false`成功（`build-final.log`、118 modules、Vite工程9.89秒）。最終`npm run build:portable-session -- --out=output/v172/portable-final/session-cli.mjs`成功（`portable-build-final.log`）。新規出力先を使用し、既存生成物を空にしない。chunkサイズ・dynamic/static importの既存警告は残る。
- `npm run test:browser-bridge`は旧固定schema marker24.0.0で一度失敗。中央の現行版と新score項目へ検査を更新して成功。最終は`npm run test:browser-bridge -- --dist=output/v172/dist-final`で3 JS bundleと公開API HTMLを検査してexit0（`browser-bridge-release-final.log`）。静的配布検査であり実ブラウザ試験と区別する。
- `npm run test:external-ai-e2e -- --seed=1 --out=output/v172/external-ai-seed1.json`成功。公開APIのEndTurn方針、random Seed1、15 Decisions、Turn15 capitalLost。H49/F2/I35、A5538、P1050951、S=-1045413。Result・Observation trace・Artifactの再実行一致。外部モデル呼出しはない。
- プロジェクトにはlint script/設定がないため独立lintは未実施。依存を追加せずTypeScriptと`git diff --check`を実行した。

### 実画面の限定確認

T3 incognito localhost、通常画面1280×800 / 390×844 / 360×800。終了Saveを実際のJSON取込で復元し、勝利+17951、敗北-1657301（試験customなのでPは標準と別）、大数+1468173478522781584、旧終了Save未計測を確認。日英切替で数値とlocal保存bytes不変、再表示時に追加EndTurnなし。Replayへ公式public ZIPを取込み、同じ+17951を再生表示。過密は感染者込みの参考表示、正負の理由を区別する。

終了済みLoadから結果画面が開かない経路、390px大数の隣欄への重なり、JSON取込の保存失敗時に未保存Turnを「最後の成功」と出す経路を実画面で確認して修正。数値は丸めず折返し、同じ不変snapshotの再表示だけを行う。Storage書込み失敗を一時注入し、前保存維持・失敗表示・再試行・同一スコアを確認。通常操作後に注入を復元。

画面証跡: [日本語勝利](v172-score-won-ja-mobile.png)、[英語敗北](v172-score-lost-en-mobile.png)、[大数](v172-score-large-en-mobile.png)、[旧版](v172-score-legacy-en-mobile.png)、[Replay](v172-score-replay-en-mobile.png)、[PC勝利](v172-score-won-en-desktop.png)。[保存故障注入・再試行・言語切替](v172-browser-checks.json)も保持。開発サーバーの既存Noise診断は背景に見えるが、production bundleからの除外は静的検査で確認。新スコアの公開情報に隠れた中立人数・敵ID/座標・RNG・初期private manifestを追加していない。WebGL readPixelsのブラウザ警告は観測されており、警告0件という主張はしない。

未実施: GitHub CI/CLI監視・Pages公開・Linux Portable実行・配布ZIPの全11コマンド・200ゲーム/512MiB等のRelease一式、Live画面での実終局操作、全Seed/全custom/全操作列の証明。これらをローカル対象試験の成功へ混ぜない。残る依存修復・広範バランス調整は今回の変更に含めない。

## 最終整理

[実行証跡](v172-verification.json)は各ログのSHA256、出力時刻、終了コード、対応する入力manifestを保持する。最終入力集合hashは`ecab77e6d7f943dfc4667da08283a1d2a5ecc6ac7d1ca0e79c3c6ab33d3d637c`で、最後の照合時にコード差分0。旧固定マップfixtureのSHA256も`37AFF2C3CAB63DE48171700B4D021163D86B6B8F12A5515B8CE701012BC55906`のまま。元要件と専用treeコピーは双方指定hashと一致した。

[文書リンク検査](v172-doc-links.json)ではローカル49リンクが存在し、外部URL・見出しanchorの到達検査はしていない。その後追加した記録リンクを含めた最終結果は`v172-doc-links-final.json`。`git diff --check`で現行仕様の末尾余分な空行1件を検出して除去し、再確認はexit0（`output/v172/diff-check-clean.log`）。従来のCRLF変換警告・Git共通ignore読取権限警告は、権限設定を変えず保持した。

S5との負荷重複を避ける追加指示に対し、所有するテスト・ビルド実行は完了し、検証Vite実行もCtrl+Cで終了、所有previewタブはclose要求成功後に利用可能タブなしを確認した。[プロセス状態](v172-process-status.json)。重い再試験は予定しない。OSの全子プロセス・port一覧は権限拒否、5178のTCP照会はtimeoutのため、OS上の全プロセス消滅を網羅確認したとはしない。所有不明の他プロセスを停止せず、以後は軽量な文書・差分確認だけを行う。

未解決の実装上の仕様判断はない。後工程で判断が必要なのは既存依存/lock修復、長時間専用回帰・配布/公開工程を実施する範囲、別条件でのバランス調整。重み付きの交換可能性や過密非採点の限界、初期以外の新部隊に独立Bを与えないトレードオフは上記のとおり残る。全報酬ハック排除は主張しない。
