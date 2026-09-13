# Claude再プレイレポートとv1.5.7実装の照合分析

- 分析日: 2026-09-13
- 対象: `claude-playtest-20260912-r2.zip`、seed 1、session `claude-0912-r2`
- ZIP SHA-256: `f68d7ecbeb996b21825e046a3751601b3103e9c3dd187673b45f46ef240f771d`
- 基準commit: `f82110c70b388da6b6b5af17c6fd086d93bf282c`、app 1.5.7
- 成果物: 分析とv1.6.0要件ドラフト。ゲームコードの修正・リリースではない。
- 主要数値の抜粋: [照合用evidence JSON](claude-playtest-20260912-r2.evidence.json)

## 1. 読み方と検証範囲

Claudeの自己分析は有用な仮説であり、仕様や実測結果そのものとして扱わない。本分析ではREPORT.md、logs、公開Artifactの225 Decision、同梱CLIの読めるbundle、基準commitの関連ファイルを照合した。添付に含まれない第1回プレイについては、会話とレポート内の比較以上の独立検証をしていない。

公開Artifactは初期documentとDecisionごとの公開snapshot／diffを順に適用して状態を復元した。Decision payloadはsnapshot 4件、diff 221件。225件中受理188件、無効37件。復元された公開予測と実イベントを区別して集計した。これは全ActionをCoreで再実行する決定的Replay検証や、全hash chainの暗号学的検証を完了したという意味ではない。

bundle内の`// src/...`境界と関数定義を参照し、Browser Bridge・経済予測・Engineの一部・リプレイ等はGitHubの現物でも確認した。CLI実行を伴う追加検証は、新規の隔離Sessionを作ったロック競合試験だけである。アップロードされた元Sessionは変更していない。v1.6.0の実装テスト、全unit test、実ブラウザのWebMCPプレイは未実施。

## 2. 結論

**経済情報にも戦闘と同じ「結果」を、不可逆な支出より前に示すという提案は採用する。** ただし、経済の入力が全く無かったわけでも、警告が常に死後だったわけでもない。今回の最終敗北では、建設後に全滅警告が返っていた。AIがそれを受けてEndTurnした判断と、支払前に結果が見えにくいアプリの設計は、両方を区別して評価すべきである。

優先順位は、全国資源不足と局地的補給不能の誤分類修正、徴兵・建設の事前プレビュー、扶養余力の見出し、終了統計と公開Waveの結果表示。戦闘ルール緩和と動員解除は採用しない。

## 3. 主要指摘の判定表

| 指摘／観測 | 照合結果 | v1.6.0での扱い |
| --- | --- | --- |
| ProduceUnitにも維持コストの結論が欲しい | 有効。ただし住民→予約人口→部隊の転用であり、部隊維持費がそのまま全国維持の純増ではない | 総維持・純増・失われる住民生産を別々に表示 |
| 純増軍需品にcriticalが出る | 確認。d9ではnetBurn -77、未充填2は補給外部隊 | 全国在庫不足と局地補給を分離 |
| 予備がある検問所にもcritical | 現行判定は役割喪失等を強く警告し、代替が実際に機能するかの校正が不足 | 健全なactive／代替先と次の管理能力で判断。予備数だけで降格しない |
| 発電所喪失後に即死するしかなかった | 当該経済フェーズについては不正確。風力着工前は民需品が13残る予測 | 建設費と完成フェーズの事前評価を追加 |
| 全滅警告は死亡時だけ | 不正確。d221で既に警告、実際の死亡はd225 | 警告の欠落ではなく支出前の提示を改善 |
| 最終ターン352人餓死 | 不正確。最終137人、352は累計。最終不足は民需品のみ | 資源・集計期間・人口単位を明示 |
| 撃破171体 | レポートはhunter 4体を省略。種類別合計175 | レポート側の集計を訂正 |
| Agent集計の撃破169体 | gas 6体が合計式から漏れる | アプリの集計不具合として修正対象 |
| 風力がno_workers | 固定出力15で稼働しているのに停止理由がno_workers | 表示／診断の不整合を修正。無労働発電自体は正常 |
| 二重play-turnが即時拒否されない | 独立試験で再現せず。約0.57秒でsession_locked | 確定バグにしない。stderrの読み方と競合回帰を維持 |
| corruptionRejections初期値1 | 添付最終Artifactでは0、diagnosticIntegrityErrorsも0 | 当該原因は未確認。推測で初期化を修正しない |
| 移動の中断で計画が崩れる | 実到達点は既に返る。finite planのmove_interrupted停止も存在 | 結果の構造化を改善し、AIは毎回再評価。中断ルールは維持 |

## 4. 終盤の時系列 — 支払前プレビューが必要な理由

### 4.1 発電所喪失の実イベント

Decision 219のEndTurn内、ターン61のzombieフェーズで、`event-10892 / site_fallen`が発生している。対象は`power-plant-1`、原因は`gas_explosion`、位置は(25,27)、`infectedAtFall=4`。その後に施設overrunがあり、同Decisionの後方イベントで守備部隊の破壊が記録される。「ターン62に守備部隊が先に死んで発電所が落ちた」という順序ではない。

d219の終了応答はターン62開始状態である。Actionの実行ターンと応答の現在ターンがずれるため、レポートではイベントのturn／phaseも併記すると誤読を防げる。

### 4.2 d219〜d225の経済

以下はそれぞれのDecision応答にある「今EndTurnした場合」の公開予測。維持対象は健全市民137人＋部隊人口160人＝297人、民需の生産入力需要は0。

| 状態 | 民需在庫 | 民需生産 | 維持需要 | 民需不足 | 資源不足後の健全市民 | 保証敗北 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| d219後、建設前 | 273 | 37 | 297 | 0 | 137 | false |
| d220後、風力1基着工 | 173 | 37 | 297 | 87 | 50 | false |
| d221後、風力2基着工 | 73 | 37 | 297 | 187 | 0 | true |

着工前は`273 + 37 - 297 = 13`。風力1基100を支払うと不足87、2基では不足187になる。完成は後のプレイヤーターン開始なので、この経済フェーズの発電に間に合わない。d221のcriticalには`guaranteed_resource_defeat`が含まれる。その後、無効Attack、Attack、Moveを経てd225でEndTurnし、資源不足による敗北となった。

**反実仮想の限界:** 風力を建設しなければ、当該経済フェーズの資源不足死は公開予測上回避できた。次の敵フェーズ、生産回復、最終勝利まで保証されたわけではない。既に基幹電力を失った状態が危険であることと、残る備蓄を使った建設が直近の全滅を確定させたことは両立する。

### 4.3 実死亡と累計

d225の`event-11179`はfood 0／civilianGoods 187の不足。人口損失は続くイベントの37＋20＋10＋10＋30＋30＝**137人**。食料の終了在庫は809で、ここを食料飢餓と呼ぶのは不適切。累計`resourceShortageLosses=352`なので、最終ターンより前の累計損失は215人。

同時に存在する軍需品の`resource_shortage`は部隊補充に関する別イベントであり、この人口損失と混同しない。人口損失数は残存人口に制限されるため、民需不足187＝死亡187でもない。

## 5. 軍需品criticalの原因 — 符号より需要の分類

d9、ターン2の公開予測は以下。

| 項目 | 値 |
| --- | ---: |
| 全国在庫 | 74 |
| 生産見込み | 80 |
| 全部隊の満タンまでの補充需要 | 3 |
| netBurn | -77 |
| 実配賦見込み | 1 |
| 未充填 | 2 |
| 終了在庫見込み | 153 |

未充填2は`national-guard-1`。補給圏外で、19から固定消費1を引いて18/20、補充は0。補給圏内の別部隊は1補充される。国庫に物資がないわけではない。

`calculateMilitaryGoodsPlan`が補給圏外も含めて`totalUnfilledRefillDemand`を計上し、`deriveResourceRunwayForecast`がその値を全国資源の`nextEndTurnShortage`へ接続している。この意味の混同を解くべきで、「黒字なので全警告を消す」ではない。局地的な弾薬切れは重要な警告として残す。燃料は支払と生産の順序が異なるため、黒字でも直近不足が起こる例外も維持する。

根拠: evidence JSON `militaryRunwayExample`、`src/core/economy-query.ts`、`src/core/resource-runway.ts`、`src/core/crisis.ts`。

## 6. 徴兵と扶養余力 — Claudeの提案をそのまま式にしない

現行の`produceUnit`は`withdrawFromSupplyCities`で人口を取り出し、予約を作る。人口同期では予約も部隊人口に含まれる。既存住民も食料・民需品を消費していたので、10人部隊を予約すると全国消費が必ず10増えるという説明は誤りになる。

正しい費用表示は、一時費用、当該部隊の総維持費、全国維持費の純増、住民の民需品生産喪失、過密と電力配賦の変化、実際の配備時期を分ける。通常の生産できる都市の10人と、容量超過や停電で生産できない10人を一律に扱わない。

「扶養余力」は有用だが、人口内訳だけで固定の全国人口上限を計算しない。民需工場等の入力消費、都市ごとの稼働条件、油田追加後の有限燃料枠を含めた現在条件の資源収支として示す。詳細式とAction契約は要件ドラフト5〜6章を正本とする。

過剰な増産、非稼働施設への反復割当、実到達点を確かめない次の移動、最後の在庫を支出する判断はAI側の学習対象。一方、ゲーム側はプレイヤーがその判断を下す場所に結果を添える。合法手を不合法に変えたり、解隊を追加したりして救済する話ではない。

## 7. 統計とWave — 正確な単位で結果を見せる

### 7.1 撃破合計の二つの漏れ

最終statisticsの種類別値はnormal 96、horde 34、police 12、soldier 16、riot 7、hunter 4、gas 6。合計は**175**。

REPORTの171はhunterを省いた値であり、AI側の集計ミス。一方、Agent metricsの169は`src/agent/metrics.ts`の合計式がgasを含まない値であり、アプリ側の集計漏れである。全敵種を一度ずつ数える定義を共有して修正する。

`unitLosses=8`は兵員8人ではなく部隊8体。兵員死者人数として表示するには別の正確な人口統計が必要。説明の印象を強めるために単位を変えない。

### 7.2 公開された結果の比較

今回の`refugeesDeparted=340`、`finalHordeSpawned=78`、基本最終編成52との比較は、事後統計として確認できる。ただし、追い返した340人全員が一対一で78体へ変わったと説明しない。

`horde.waves`の既に公開された基本／確定編成を並べる改善は採用する。内部の確定だけを理由に公開時期を早めない。方向別の数値と4方向等の総数、生成済みと保留を区別する。反感カウンタや未来の編成は現行の非公開境界に留める。

## 8. その他の実装照合

**風力の停止理由:** 初期`wind-power-plant-1`は`constructible=false`、`windPower.operational=true`、generation 15、workers 0なのに`production.stoppedReason=no_workers`。発電の機能不全ではなく説明の誤りである。

**風力の建設枠:** 現行は初期配置を除いた建設施設を数える。4道路で現行の新設枠4を8へ変えると、初期1基を含めた盤上総数は最大9になる。依頼が総数8を意図した可能性を残し、ドラフトは既存定義の維持案として明示する。

**リプレイの有刺鉄線:** `src/replay/view.ts`にはHP表示の固定分母`/10`が残る。v1.5.7の最大HP20と不整合になるので、ライブ描画の共通化時に公開maxHpを参照する。

**検問所:** 最終統計には予備からのfallback 4回、流入無管理を防いだ回数4、無管理ターン0がある。これは予備が実際に役立った裏付けであって、全時点の感染危機が誤報だった証拠ではない。

**無効手:** 37件の内訳は`facility_not_operational`29、`action_not_legal`6、`invalid_refugee_turn_away_count`2。配属可能時期と合法手の再照会を徹底するべきで、ゲームが無効な命令を受け入れる修正にはしない。拒否対象はwaiting、引数はcountであり、normal／strictの名称だけで可否を決めない。

## 9. 二重play-turnの独立試験

添付CLIを用い、元Sessionとは別のrootへ新しいseed 1のSessionを作成。1本目の`play-turn`を起動し、ロックが存在するまで待ち、stdinを開いた状態で2本目を起動した。

結果: **2本目は終了コード1、約0.573秒、stderrにJSONの`session_locked`、stdoutは空。** 1本目はclose命令で終了した。bundleでも`beginPlayTurn`からのロック取得時にlive ownerを確認して拒否する処理がある。

従って、この入力条件では「2本目が即座に失敗しない」を再現できない。stdoutしか読まないシェル処理、pipeや起動順、別OS等の影響は排除していない。レポート自体を虚偽と断定せず、原因未確定とする。既存ロックを置き換えるより、stdout／stderr双方と終了コードを扱う説明、および競合回帰を維持する。

同様に、最終ArtifactのSession metricsは`corruptionRejections=0`、`diagnosticIntegrityErrors=0`。periodic checkpointは12件で、REPORTの9件とは異なる。測定した時点や対象ファイルが異なる可能性はあるが、このZIPだけで初期化バグと認定しない。

## 10. WebMCP／ライブ観戦への実装上の含意

`src/main.ts`では通常UIのGameEngineと、`installBrowserBridge`のAgentGameが別々に作られる。WebMCPが既存の`window.NLTH`を呼ぶだけでは、画面上の人間用ゲームは同じ状態にならない。

`src/replay/view.ts`は公開document専用の読取ビューで、GameEngineや永続化にアクセスしない。この境界を生かし、AIの同一AgentGameが出す公開documentを通常プレイ風の観戦UIへ渡す方針が妥当。ゲーム状態を二重に進めず、公開結果の表示完了と短い保持を次Action受付の条件にする。

クライアント対応は要件ドラフト12章の一次資料と条件を参照する。公式に対応経路があること、今回の実機確認、全製品でURLだけ渡せることは別である。今回、ChatGPT／GeminiによるこのゲームのWebMCP実プレイは実施していない。

## 11. 証拠の所在と再確認手順

evidence JSONは主要値とイベントの抜粋であり、巨大な元Artifactや私有Sessionの再配布ではない。原本を持つレビュー者は次の箇所で再確認できる。

1. `artifact/claude-0912-r2.nlth-artifact/artifact.ndjson`の初期公開stateを読み、各Decisionの`publicPayload`が示すgzip chunkを連結・展開する。snapshotは置換、diffは記録順に適用する。途中状態を保存する場合はdeep copyする。
2. d9のmilitaryGoods、d219／220／221の`forecastSummary.endTurn`とcrisisを読む。d219内event-10892、d225内event-11179〜11185のturn／phaseとpopulationLostを確認する。
3. `logs/final-result.json`の種類別statisticsと、Artifact footerのgame／session metricsを比較する。異なる集計指標を同じ値と仮定しない。
4. 同梱`tools/session-cli.mjs`の`calculateMilitaryGoodsPlan`、`deriveResourceRunwayForecast`、`produceUnit`、`zombiesKilled`の合計式、`beginPlayTurn`を確認する。

基準commitへの実装参照:

- [economy-query.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/core/economy-query.ts)、[resource-runway.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/core/resource-runway.ts)、[crisis.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/core/crisis.ts)
- [engine.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/core/engine.ts)、[metrics.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/agent/metrics.ts)
- [browser/bridge.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/browser/bridge.ts)、[main.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/main.ts)、[replay/view.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/replay/view.ts)
- [session/store.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/session/store.ts)、[session/session-cli.ts](https://github.com/plastichyena/nowherelefttohide/blob/f82110c70b388da6b6b5af17c6fd086d93bf282c/src/session/session-cli.ts)
