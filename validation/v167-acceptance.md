# v1.6.7 ローカル受入・比較記録

2026-09-26。v1.6.6 `d7c71b9` の作業ツリーから実装。既存の文書2件の移動と確定要件は `f269134` で先に保存した。Doc/archiveの本文は参照・編集していない。サブエージェントは使用していない。

## 実装

- 稼働Workerあたり軍需CG10→MG3、軍人人口Food2、方向別Variant5/8/11/11/12。
- 全9種Zombieの初回待機→連続追跡MP+3→noise/idle即解除。既存Target Snapshot・行動待機を維持し、実移動・壁経路Cost・Saveへ接続。
- 未所有人数をnullで統一し、候補・理由・生産入力・復旧条件・差分からの漏えいも修正。可視Zombieの基礎／適用加算／実効MPは直前Phase値として公開。
- 検問所の現在視界ルールを維持し、不足Hexを提示。referenceとUnit Move、同じ地点、迎撃後Charge、play-turn256と再開・再送の契約を案内。
- App1.6.7／Rules17／Save24／Agent・Observation・Bridge22／Artifact21／Session・Checkpoint18。Map v9、Action3、Query1.2、AiSession1.3、PlayTurn1.2、Store1、Package2、Balanced14、Random9は維持。

## 修正前の再現と元記録

BUG-01は `src/core/v167.public.test.ts` の3ケースを実装修正前に実行し、worker候補、populationSources、施設Projection／全Observationの人数依存で失敗を確認した。修正後は3件と確保後公開の追加1件が成功。未所有のpower理由、inputRequired/inputShortage、productionRequirementsも対照Stateで一致させた。

BUG-02は元v1.6.6公開snapshotとlossless diffを読み取り専用で再構成した。Turn11／Revision153とTurn12／169は東道路(31,25)が現在視界外。Turn15／202は経路全体が可視で、Decision203の移設は受理されている。元記録に同Revisionの移設Previewはなく、旧Stateを新Rulesで再実行してはいない。現行の最小Scenarioで不可視目的地／途中のみ不可視／全可視、不可視敵、候補とActionの一致を確認した。

BUG-03の元記録ではoccupied_destination 7件すべて、要求先とそのUnitの直前位置が同一だった。別にout_of_range 1件がある。移動合法性を緩和する根拠はなく、既存route／reference／actionRequired／Revisionの案内を更新した。証拠と同Revisionの記録済みroute応答は [v167-recording.json](v167-recording.json)。再生成は `npx --no-install vite-node --script scripts/v167-recording-evidence.ts`。元Session・ZIPは保持した。

## ローカル検証

| 実行 | 結果と範囲 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm run build` | 成功。既存の500kB超bundle注意は継続 |
| CI通常回帰と同じVitest範囲 | 1,130件を一度実行。1,094成功、25失敗、既存のdaily専用11件skip。旧Version・旧数値・旧非null期待と新Session fixtureを修正し、失敗対象を再検証して全件成功 |
| 失敗ファイル16件の再検証 | 215件中211成功、4失敗。その後に残った旧Wave／旧拒否文言を修正し45件成功。Sessionの既存60秒上限超過は単独実行58.96秒で成功、上限は変更していない |
| v1.6.7追加Core／公開境界 | 44件成功。さらに実Road移動で初回3Hex→次Phase6Hexを検証して成功。待機・適用・解除後のSave再現を含む |
| 新Session統合 | 1件成功（約61秒）。新serviceインスタンス、Checkpoint分岐、compact、handoff、ZIP実行Replay、Viewerの公開frame |
| 検問所候補 | 15件成功。不足Hexが実際に視界外であることとCore結果を検証 |
| 最終の移動関連確認 | 公開砲撃判断・接触回避・wireの29件成功 |
| Node検証script | 8件成功 |
| Browser Bridge | 本番bundleの契約・必要文字列・assets検査が成功 |
| 外部AI経路smoke | `npm run test:external-ai-e2e` 成功、外部プロセス経由の対局とReplay一致 |

通常回帰コマンドは `npx --no-install vitest run --pool=threads --maxWorkers=2 --exclude src/agent/balancedAgent.batch.test.ts --exclude src/agent/balancedAgent.seed198.test.ts`。除外2件はCIの独立した長時間ジョブ。daily 11件は既存の `NLTH_SESSION_DAILY=1` 条件で、今回skipを追加していない。個別再検証で `-t` により選択外となったケースは、その再実行の成功件数へ含めない。成功済み通常回帰全体の反復はしていない。

初回と再検証の機械可読ログはローカル `output/v167-full.json`、`output/v167-recheck.json`、各 `output/v167-*.log`。初回の失敗を最初から成功したものとして扱わない。

## 受入要件の対応

| 要件 | 証拠 |
| --- | --- |
| T-ECO-01 | v167.core、economy.v127、v152.capacity、v166.economy。0/1/10worker、入力9/10/19/20、停止条件、予約と実決算 |
| T-ECO-02/03 | v167.coreの全7Human Type、Crew／cargo／飛行、徴用予約→配備→除去。既存の衛生・飢餓・過密・救援入力回帰 |
| T-WAVE-01 | config、v150/v151、既存Wave/Pending/Save回帰。基礎179、Final80＋Pack1、二重増量なし |
| T-MP-01/02 | v167.coreの全9種の遷移・実Phase・Save。noise/idle解除後の再取得とSave。既存Spawn／再生／飛行Target回帰 |
| T-MP-03 | 実Road3→6、壁Costへの実効MP、既存terrain／water／bridge／wire／interception回帰。地形規則は変更しない |
| T-SAVE-01 | v167.core、v167 Session、既存Save／Session。旧形式の拒否、連続記憶不正の拒否、分岐後同一結果 |
| T-PUB-01/02 | 対照State全Observation・候補・供出元・確保後公開、Session／handoff／ZIPのnullと非公開記憶除外 |
| T-CP-01 | checkpointCandidates、既存Core Preview／Checkpoint回帰、元記録Turn11/15の再構成 |
| T-ROUTE-01 | route／v165.contract-boundary／v166.movement、既存航空・移動回帰、元同位置拒否7件 |
| T-UI-01 | 下記の実ブラウザ確認 |

## 実ブラウザ

Playwright CLI＋実Chrome、PC1440×1000／mobile390×844、日英で通常ゲーム、Help、Live、新規公開ZIP Replayを操作した。`scripts/v167-browser-fixture.ts` で実GameActionからSaveとZIPを作成し、通常の読込画面と観戦画面へ投入した。

- 通常／ReplayのPackは基礎10＋3＝13。通常詳細が合計10と表示する不整合をブラウザで再現して修正し、同じ操作で13になることを確認。
- Foodは健常民間110＋軍人人口45×2＝200。accordionは110／90、実人数155。Helpの軍需10→3、Food2はConfig由来で日英確認。
- LiveはStartしたSessionに登録済みnlth_act経由で4回EndTurn。可視Gasの3＋3＝6がObservationと詳細で一致。
- Live診断の長いJSONによる内部横溢れを修正。document幅とpanel内要素のscrollWidthを確認し、操作・縦スクロールを維持。
- Live操作はローカル登録アダプターで行った。実クライアントのhost discoveryは未検証で、成功扱いにしない。

画面と操作scriptはローカル `output/playwright/v167/`。PC／mobileの各 `normal-*`、`food-*`、`help-*`、`live-*`、`replay-*` PNGを保存し、代表画面を目視した。全対象の表示文字列・画面幅はDOMでも検査した。物理端末のメモリやタッチ性能の検証ではない。

## 固定Seed比較と限界

比較集計を [v167-balance.json](v167-balance.json) へ保存した。同じBalanced14・Seed1/2/4・100Turn／100判断毎Turn／3100判断毎ゲーム。旧版はd7c71b9の専用参照checkout、新版は今回実装で実行し、Private計測値をAIへ戻していない。受理Action列を対応する各Rulesで再実行し、終局と4資源が一致することも6件すべてで確認した。

10／20／35／50／70と終局の資源在庫・生産・消費、軍人人口、軍需／救援稼働、補充不足、Wave実数・初戦闘、施設陥落・部隊損失・感染損失・飢餓死亡、首都最小人口・補充移送、野砲の使用／消費／熟練／直接・爆風・Gasを記録する。定義はJSON冒頭に明記し、終了後のサンプルはnullとする。

終局時点の在庫・軍人人口・累積損失は、最後の受理Action後のStateから採取する。直近の経済決算は `terminal.latestEndTurn` に分離する。旧Seed1はTurn20のAttack後に終局しており、Turn19の決算後の損失数を終局値に代用しない。首都最小人数は感染者を含む住民実人数で、陥落時の0も含む。移送回数は首都向けの明示的なTransferPopulationのみ。

再生成は対象版のcheckoutで `scripts/v167-balance.ts` と `scripts/v167-balance-replay.ts` を実行する。旧版にはこの計測scriptだけを配置し、ゲームコードはd7c71b9のままにする。両scriptの第1引数は出力ディレクトリで、balanceの任意の第2引数は `1,2,4` のようなSeed列。新版の最終出力はローカル `output/v167-balance-final/1.6.7`、旧版は `output/v167-balance-complete/1.6.6`。集計コマンドは次のとおり。

```text
node scripts/v167-balance-report.mjs output/v167-balance-complete output/v167-balance-final/1.6.7
```

有刺鉄線の実効MP評価を接続した最終コードでSeed4を取り直した。Seed1/2は有刺鉄線の建設・存在が0で、この追加分岐は実行されない。途中候補のSeed4出力は最終比較へ混ぜない。

| 版 | Seed | 敗北Turn | 第1Wave初戦闘 | Turn10軍人人口 | 終局部隊損失 | 終局感染損失 | 終局餓死 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.6.6 | 1 | 20 | 12 | 65 | 4 | 187 | 17 |
| 1.6.6 | 2 | 23 | 19 | 60 | 6 | 171 | 65 |
| 1.6.6 | 4 | 24 | 17 | 60 | 14 | 298 | 0 |
| 1.6.7 | 1 | 16 | 12 | 60 | 8 | 186 | 21 |
| 1.6.7 | 2 | 18 | 13 | 60 | 8 | 180 | 0 |
| 1.6.7 | 4 | 23 | 12 | 80 | 25 | 282 | 5 |

全6戦がTurn35より前に敗北し、35／50／70のサンプルはnull。野砲の使用・砲弾消費・熟練到達・各撃破区分は全て0で、終盤備蓄や野砲の継続運用性能を評価できる比較ではない。Wave方向・施設確保・軍編成も変わるため、接触や敗北Turnの差をMP加算だけの効果とは解釈しない。確定バランス値の追加調整はしていない。

首都人口最小値は全6戦で0（終局を含む）。首都向け移送回数はSeed1／2／4の順で旧版6／7／6、新版5／4／10。任意の徴用・移送における首都最低1人の規則と、感染・襲撃による0は区別する。

| 版 | Seed | Turn10 Food生産 | 実消費 | 決算後在庫 | Food維持必要 | 軍需決算後在庫 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.6.6 | 1 | 0 | 157 | 63 | 157 | 93 |
| 1.6.6 | 2 | 0 | 0 | 0 | 187 | 387 |
| 1.6.6 | 4 | 320 | 255 | 1547 | 255 | 203 |
| 1.6.7 | 1 | 0 | 0 | 0 | 167 | 79 |
| 1.6.7 | 2 | 230 | 236 | 0 | 267 | 315 |
| 1.6.7 | 4 | 320 | 350 | 860 | 350 | 207 |

追加の外部モデルによるseed4再プレイは未実施。旧外部AI記録の「ベテラン後78撃破」を新たな野砲総撃破数やバランス比較値へ読み替えない。

## GitHub

依頼どおりCI／Portable／Release Validationの起動確認のみを行い、完了を待たず監視しない。200ゲーム、長履歴1,000判断、物理512MiB、Pages公開後の実サイト検証は、対応workflowの結果確認まで未確認とする。
