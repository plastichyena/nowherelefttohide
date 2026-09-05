# Nowhere Left to Hide PoC v1.5.1 アップデート要件 確定版

- 作成日・確定日: 2026-09-05
- ステータス: 実装・短期検証完了、現行仕様へ反映済み（公開先検証と長時間Jobの状態はGitHub Actions参照）
- 対象Release: `1.5.1`
- 基準安定版: `v1.5.0`
- 確定方法: ユーザーとの本タスク内の一問一答9件を反映

## 1. 文書の位置づけ

本書は、v1.5.1で実装するAI向け機能の容量・処理負荷改善、標準バランス調整、Hunter Zombie追加の確定要件である。明示的に変更しないゲームルールは `Nowhere Left to Hide PoC 現行仕様.md` のv1.5.0を維持する。

実装・テスト・動作確認が完了するまで、現行仕様をv1.5.1へ更新しない。完了後に本書の確定内容と検証結果を現行仕様へ反映し、整合確認後、本書を `Doc/archive/` へ移す。本書の数値を実装目標とし、勝率を理由に実装担当が無断で再調整しない。

今回は要件の作成までであり、本書の確定は実装済み・Release済みを意味しない。


### 実装時の確認範囲（2026-09-05）

以下は本実装タスクでのユーザー指定であり、要件作成時の公開・保管手順に優先する。

- GitHub Pagesの実動作とAI Portable Workflowの正常完了まで確認する。
- その他の長時間Job（Balanced Seed 1～30、通常1,000 Decision、512 MiB、v1.5.0／v1.5.1 Seed 1～100比較）はdispatchとJob開始までを確認範囲とし、結果待ちは行わない。結果未確認を試験成功とは記載しない。
- `Doc/archive/`を参照・変更せず、本書は現行仕様との照合用としてDoc直下に保持する。
- Core／UI／Session／Replayの関連テスト、Build、Browser Bridge Smoke、Windows CLIのSeed 1・7 Game Over／Artifact Replayを実施し、要件を現行仕様へ反映した。大容量・長期試験は上記の独立Jobで実施する。

## 2. 目的と実装順序

1. AI Portable Sessionを、51×51 Mapで手数が増えても継続・復帰・分岐・記録出力できるものにする。
2. AIへ毎回渡す情報量と保存の重複を減らし、既存の公開情報、合法手、判断補助、履歴検証へのアクセスを維持する。
3. 指定の標準値とHunterをCoreへ統合し、Human UI、Agent、Save、Replayで同じルールを使用する。
4. 長時間Sessionと通常ゲームの回帰を別々に検証し、Portable Packageまで確認してから現行仕様へ反映する。

Game CoreはPhaser／UIから分離する。ゲーム状態の変更は既存のGameAction → GameEngine経路に限定し、Session最適化のために別の戦闘・合法性判定を作らない。

## 3. AI機能の不具合認識と修正範囲

調査資料は [`SESSION_CLI_TRACE_SIZE_BUG.md`](../output/claude-playtest-20260904/SESSION_CLI_TRACE_SIZE_BUG.md)（2026-09-04、Opus 5、対象commit `36db152`）とする。

同報告ではSeed 7、Turn 38、Decision 220で `trace.ndjson` が538,309,097 bytesになり、全文文字列化時にSession CLIが停止した。分岐先にも527,108,073 bytesの祖先履歴がコピーされた。これは当該プレイの実測であり、「すべてのSeedが必ず同じ手数で停止する」とは扱わない。15×15時代の想定が原因だったという経緯は仮説とし、修正対象は現行コードで確認できる構造とする。

確認した対象:

- `src/session/store.ts`: `load`から全Decisionを読み込み、`validateTraceMirror`でもTrace全体を単一文字列にする。分岐時の`seedDecisionHistory`も祖先の全Decisionを複製する。
- `src/session/types.ts`／`service.ts`: Decisionごとに前後のObservationと事前Legal Actionsを保持し、応答にも同じ情報が重複する。
- Observation: 全Mapの建設位置候補と部隊別の移動コスト表が大きい。
- Artifact: 全Decision、全Observation、復元済みMap、Eventをまとめて構築・JSON出力するため、Traceだけを直しても別経路で再発し得る。
- immutable generationのPublic／Private State、Checkpoint、Mirrorを含むSession総容量も測定対象とする。巨大データを別ファイルへ移すだけで完了としない。

履歴打ち切り、ゲームのTurn／Decision上限引き下げ、非公開StateのAIへの開放、破損検証の無効化を解決策にしない。

## 4. AIへの公開情報と通常応答

### 4.1 Compact応答

Session CLIの`new`、`status`、`step`、`load-checkpoint`はCompact表示を標準とする。既存7コマンドの役割を維持し、詳細取得用に読み取り専用`query`を追加する。

通常応答に残す情報:

- Version、Session ID、現在Revision、Turn／Phase、勝敗。
- 公開資源・人口、所有施設／Checkpointの基本状態、全部隊の基本状態、現在可視の敵。
- 部隊の位置、HP、熟練度、Attack Charge、移動可否、補給、Fuel／Military Goods、基本／実効戦闘能力。
- Crisis Summary、EndTurn Risk、資源別のEndTurn Forecast要約、公開Horde予告。
- 実行Actionの受理／拒否、理由、今回の公開Event、既存`stateDelta`、作成したCheckpoint。
- 対象別に利用できるAction種別、詳細取得の方法とRevision。部隊や候補を黙って省略しない。

通常応答へ固定Map全文、全移動先、全建設候補、詳細コスト表、前後Observation全文、過去Decision全文を重複して入れない。Compactは構造化した公開Snapshot要約であり、自然言語だけに置き換えない。重大な危機や行動の失敗を詳細取得しなければ分からない構成にしない。

### 4.2 詳細取得と完全情報へのアクセス

`query`は次の情報を対象指定・必要に応じたPaginationで取得できるものとする。

| 対象 | 取得できる内容 |
| --- | --- |
| API情報・Map | 公開ルール、Schema、固定Map、現在Visibility、公開移動／防御属性 |
| Unit | 全詳細、合法Move／Attack、Fuel Cost、Emergency区分、攻撃Cost／Damage、回復／鎮圧予測 |
| Facility／Checkpoint／Branch | 個別詳細、給電・生産・人口・審査・補給・費用・Fallback情報 |
| 建設候補 | Type、支線、範囲、座標で絞り込む合法候補とCoreの不合法理由・将来補給効果 |
| Legal Actions | 全種別の合法手を漏れなく取得する一覧。Action種別／対象による絞り込み |
| Forecast | 省略前のEndTurn／Strategic Forecast全詳細 |
| 履歴 | Decision範囲、Action、理由要約、公開Event、当時の前後Observationと合法手 |
| Full Snapshot | 現在の完全な公開Observationと合法手への明示的アクセス |

- `AgentGame.getObservation()`／`getLegalActions()`による完全情報取得を維持する。既存組み込みAgentは同じ公開情報で動作できるものとし、Compact表示を使うためのゲーム戦略変更を必須にしない。
- 全候補を通常応答から外しても、従来得られた公開候補、不合法理由、Projected Supply、移動コストを取得不能にしない。座標判定はCoreと共通化し、Hidden Enemyを理由差分から漏らさない。
- 応答に取得対象、Revision、返却件数、続きの有無、次Cursorを明示する。安定順と重複なしを保証し、全Pageを結合すれば完全な公開一覧と一致する。
- CursorはSession IDとRevisionへ結び付ける。状態が変わった場合は状態不変の`stale_revision`で拒否し、異なる時点の一覧を混ぜない。
- Paginationは標準100件・最大500件とし、上限を超える要求や不正Cursorを理由付きで拒否する。詳細なCLI引数・応答Fieldは工程1でSchemaと使用例へ固定し、実装経路ごとに別の意味を持たせない。
- `query`はGameState、RNG、Decision番号、正規Action列を変更しない。復帰後も正式コマンドだけで次の合法Actionを選択できる。
- `step`は1回につき既存GameActionを1件受け取る。`decisionSummary`の1～500 Unicode code pointを維持し、任意の`expectedRevision`を追加する。不一致はDecision採番・Action適用前に状態不変で拒否する。Compact Workflowではこの指定を推奨する。
- 大きいFull Snapshot／詳細取得にはPageまたはファイル出力を用意する。出力の省略は明示し、完全取得の手段を常に残す。

## 5. Session保存・復帰・Artifact

### 5.1 損失のない公開履歴

保存形式は「初期／定期の完全公開Snapshot＋保存用の完全差分＋小さなDecision記録」を基本とする。

- Decision記録には番号、Turn／Phase、入力Action、公開理由要約、受理／拒否、Error、公開Event／差分への参照、前後公開状態のHash、前Decision Hash、自Decision Hashを保持する。
- 完全SnapshotはMap等の静的情報を参照化し、Observationと合法手を同じ論理構造で復元できるものとする。変更のない情報を繰り返し保存しない。
- 保存用差分は公開情報だけから導出し、追加・変更・削除、配列の順序、Visibility、候補、合法手まで完全に復元する。既存の`stateDelta`は変化の要約であり、保存用完全差分の代用にしない。
- 不合法Decisionも残す。ゲーム状態を変えず、前後の同一公開状態を参照する。入力形式不正やRevision不一致はDecisionを作らず診断として分離する。
- 初期、Checkpoint作成時、直前の完全Snapshotから50 Decision経過時に完全Snapshotを置く。重複するSnapshotは共有できる。履歴の個別参照でゲーム開始から全Actionを再実行しない。
- 圧縮、内容Hashによる重複排除、固定Map参照化を併用する。大きなPayloadは分割保存し、Traceの1行にObservation／合法手全文を戻さない。
- Public／Privateの保存領域を分離する。Private Stateの不変なMapや増加するEvent履歴も重複保存を抑え、完全GameStateとRNGを正確に復元する。公開履歴はPrivate情報に依存せず読めるものとする。
- 公開コマンドは許可した論理IDから公開Payloadだけを解決し、任意ファイルの読み出し口を作らない。保存参照の絶対Path、Root外への遡及・リンク、循環参照、不正Hashを検証し、欠損や過大な入力も診断可能な拒否とする。

### 5.2 読み込みと完全性

- Trace、Decision、Snapshot、Checkpoint、Artifactのすべてで履歴全体の`readFileSync(..., 'utf8')`、全行配列化、巨大な単一`JSON.stringify`を避ける。ストリームと上限のある作業バッファで処理する。
- 通常復帰は現在のPrivate／Public Stateから行い、履歴全体を復元済みObservation配列としてメモリへ保持しない。Snapshotと差分で復元した現在公開状態はCoreから再生成したObservation／合法手と照合する。
- canonical JSONとSHA-256によるDecision chainを維持し、参照先Payload、Snapshot、commit、Version、Build ID、Map、Configも検証対象とする。圧縮済みファイルの一致だけで論理内容の一致を代用しない。
- 過去のcommit済み公開履歴の破損も検出する。通常復帰で必要な履歴検証は小さな記録とPayloadを順次走査し、全Observationの再構築は行わない。未検証のmtime／サイズ／検証済みフラグだけを信頼して検証を省かない。
- 履歴走査のI/O時間まで定数になるとは保証しない。履歴が増えてもメモリが履歴総量に比例せず、全量の重複復元と再シリアライズをしないことを必須とする。
- immutable generation、最終Active commitの原子的確定、Session単位の排他lock、既存のstale lock条件を維持する。中断時に未commitの書き込みを正規履歴へ混入させず、Active破損を暗黙に巻き戻さない。
- Hash chainは破損・不整合の検出を目的とする。全ファイルとHashを任意に書き換えられるローカル攻撃者への外部認証を保証する仕組みとは扱わない。

### 5.3 Checkpointと分岐

- 5完了Turnごとの自動、手動、Game Over時のCheckpointを維持する。
- 分岐は親Session／Checkpoint、分岐点のDecision番号・Trace Head Hash・公開Snapshot Hashを系譜へ保持し、親を変更しない。
- Session Schema 4はimmutableな`branchBase`を必須Fieldとする。Root Sessionはnull、子は`rootSessionId`、`parentSessionId`、`parentCheckpointId`、`baseDecision`、`baseTraceHeadHash`、`basePublicSnapshotHash`、`ancestorManifestHash`を持ち、DescriptorのHashで保護する。Private基準状態の参照はPrivate側に保持する。
- RootのchainはDecision0／ZERO_HASHから始める。子のlocal chainは`baseDecision + 1`から始め、最初の`previousDecisionHash`を`baseTraceHeadHash`とする。子がまだ0件なら現在Headはこの基点Hashである。validatorは子のlocal chainを基点で終端させ、別途immutableな祖先ManifestをRootまで検証する。子の履歴だけをZERO_HASHまでたどらない。
- Session RootにSchema付きStore Manifestを置き、`storeId`と公開Payload用の固定Poolを定める。参照は内容HashからPool内の規定位置へ解決し、祖先ManifestはRootから分岐点までの順序付き履歴範囲と必要なSnapshot／Payload Hashを含む。親のActiveや可変なファイル名を解決規則にしない。循環、範囲の重複・欠落、基点Hash不一致を拒否する。
- 子のTraceは分岐点を検証可能な起点として、その後のDecisionから書き始める。番号は親の分岐点から継続し、親の分岐後のDecisionを取り込まない。
- 祖先の展開済みObservation／Decision全文を子へ複製しない。同一Session Root内のimmutableな履歴Payloadを内容Hashで共有し、所有者が異なる可変ファイルを参照しない。
- 子の継続に必要なPrivate／Public基準状態は分岐時に確保する。親のActiveや分岐点より後の履歴が壊れていても、指定Checkpointと必要な祖先履歴が健全なら明示的分岐できる。
- 親の必要な祖先履歴が欠損・破損している場合、完全なReplayができる分岐として成功を返さない。元のCheckpoint／データは保持する。
- 完全Artifactは分岐点までの祖先履歴と子の履歴を順に収録する。外部への持ち出し時は必要な公開Payloadを1回ずつ梱包し、元のSession Rootなしで読み取れる自己完結Packageとする。
- 共有Payloadを通常コマンドが自動削除しない。Sessionの物理的な移設・削除に関する管理UIやGCは今回の対象外とする。

### 5.4 Artifact・Metrics・Replay

- `artifact`はPublic Artifactをストリームでファイル／Packageへ出力し、標準出力には保存先、Schema、Hash、件数、結果の小さなManifestを返す。巨大ArtifactのJSON全文を標準応答へ埋め込まない。
- Public Decision Log、受理Action列、不正試行、公開Observation／Event、Metrics、Seed、公開Config、Version、Build ID、系譜を欠落させない。内部格納形式を変更しても、各Decisionの前後情報を完全に読み出せるものとする。
- Metricsは履歴を順次集計し、全Observationを一括保持しない。同じ論理履歴なら保存形式に依存せず同じMetricsになる。
- Player-facing ArtifactにはHidden Enemy、RNG state、内部Target、非公開Config／Noise／Rejected Counterを含めない。ローカル／CI専用の完全検証Artifactとは従来どおり分離する。
- この非公開境界は、内部Counter／Bonusや非公開観測を新たに出力しないことを意味する。プレイヤー自身が入力した`TurnAwayCheckpointRefugees`の対象・人数等は既知の行動情報として保持し、公開Action列を伏せない。既知の行動・公開情報から利用者が計算・推察できる内容まで秘匿できるとは保証しない。
- 同一新Version・Build・Seed・Config・受理Action列でReplay一致を検証する。旧v1.5.0のAction列が新バランスでも同じ結果になることは求めない。
- Artifact reader、Replay、Batch、Bridge、Portable Workflowも新Schemaに対応させる。容量対策をSession CLIだけに閉じない。Browser Bridgeはネットワーク・ファイルへアクセスせず、公開APIからの必要範囲の読み出しで扱える形を維持する。

## 6. AIサービスへの負荷と実行環境

- 修正はローカルのデータ構造、保存、取得、起動処理で行う。AIサービスへの新しい通信、API Keyの要求、外部転送、常時Polling、並列大量リクエストを導入しない。
- サービスの制限回避や非公開情報の取得を前提としない。合法手の追加取得が必要でも、対象絞り込みとPage取得で不要な出力・呼び出しを抑える。
- Portable PackageはBundled Nodeだけで実行でき、full commit SHAによるBuild IDを維持する。配布CLIは毎Actionで開発用TypeScript変換を繰り返さない実行入口を用意する。
- 通常CLIは1コマンドごとのプロセス実行を維持する。常駐ネットワークServerや複数Actionの先行一括実行を今回の必須機能にしない。
- 自動検証は公開APIだけを使うローカルDriverで再現可能にし、外部LLMへの有料・大量呼び出しをReleaseの必須条件にしない。

## 7. 標準バランス

### 7.1 Human Unit

| Unit | v1.5.0 Recruit Attack | v1.5.1 Recruit Attack | Regular／Veteran Attack |
| --- | ---: | ---: | ---: |
| Police | 4 | 6 | 8 |
| National Guard | 8 | 12 | 15 |
| Riot Police | 10 | 9 | 12 |

共通式`ceil(recruitAttack × 1.25)`を維持する。Policeの当初指定5は一問一答で6へ訂正済みであり、専用補正は作らない。初期Police／National Guardは引き続きRegularである。Veteranの追加Attack Charge、昇格条件、HP、Move、Range、Vision、人口、編成費用、携行品、回復率は変更しない。

鎮圧力は従来どおり現在の有効攻撃力から導出し、独立した旧固定値を残さない。Riot PoliceはPolice同様、都市を含む感染Siteの鎮圧で健常な住民・労働者を傷つけない。National Guardの民間被害計算と軍需不足時の計算式も維持し、攻撃力変更後の結果をテストする。

### 7.2 Zombie

| Type | HP | Attack | Move | Range | Vision | 最大Attack Charge |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 通常Zombie | 15 | 5 | 3 | 1 | 3 | 1 |
| Horde Zombie | 40 | 5 | 3 | 1 | 3 | 2 |
| Police Zombie | 10 | 5 | 3 | 1 | 5 | 1 |
| Soldier Zombie | 20 | 5 | 5 | 1 | 5 | 1 |
| Riot Zombie | 60 | 5 | 3 | 1 | 5 | 1 |
| Hunter Zombie | 20 | 15 | 15 | 1 | 5 | 1 |

通常ZombieのHP変更をPolice Zombieへ波及させない。Horde出身の特殊Zombieも、そのTypeの性能とChargeを使う。全値をConfig化し、Help／Agentに別の固定値を持たせない。

### 7.3 Horde Zombieの攻撃権利

- `hordeZombie`だけを最大Charge 2とする。通常攻撃、反撃、迎撃で共通の権利を消費する。既存の補充タイミングを維持し、Player Phaseで消費した権利をZombie Phase開始時に追加補充しない。
- Zombie Phaseの能動攻撃も残Charge回数分、最大2回行う。Charge数だけを変更して能動攻撃を1回のままにしない。
- 同じ生存対象への2回攻撃を許す。対象撃破・占有・感染・連鎖・反撃の解決後、残Chargeがあれば現在位置から合法な対象を再評価する。別対象の優先順位と同点処理は既存のCoreルールに従い、決定的にする。
- 移動は最大1回で、攻撃後は再移動しない。反撃で自身が死亡した場合やGame Overになった場合は残り処理を停止する。
- 各戦闘で既存の反撃、Terrain軽減、軍需消費、Noise、施設占有を適用する。権利がなくても移動できるか等の既存ルールは維持する。

## 8. Wave Scheduleと特殊抽選

Warning Lead 2、Spawn Turn、方向抽選、非Horde Slot数、Final条件を維持し、全Waveの各方向のHorde Zombieを1体ずつ増やす。

| Turn | 方向数 | 各方向Horde | 各方向非Horde Slot | Wave合計 | 旧版比 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 | 1 | 3 | 3 | 6 | +1 |
| 10 | 2 | 2 | 5 | 14 | +2 |
| 20 | 1 | 5 | 7 | 12 | +1 |
| 35 | 3 | 3 | 7 | 30 | +3 |
| 50・Final | 4 | 5 | 8 | 52 | +4 |
| 合計 | 11方向分 | 41体 | 73体 | 114体 | +11 |

表はRejected Bonusを含まない基礎構成である。Finalは1方向13体・全4方向52体。Horde Spawn Reserve内の配置可能数、既存Zombieとの競合、全方向の原子的Spawnを新構成で検証する。

| 非Horde SlotのType | 基礎Weight | 1方向・1Waveの上限 |
| --- | ---: | ---: |
| 通常Zombie | 70 | 個別上限なし |
| Police Zombie | 10 | 個別上限なし |
| Soldier Zombie | 10 | 個別上限なし |
| Riot Zombie | 5 | 1 |
| Hunter Zombie | 5 | 1 |

- Police ZombieのWeightを15から10へ減らし、Hunterへ5を割り当てる。合計100で、相対的な5%減ではなく5 percentage pointsの移動である。
- 各SlotをSeed付き乱数で順次抽選し、Riot／HunterはそれぞれCap到達後に対象から外して残Weightを再正規化する。両方がCapに達した場合も同様。5%はCap適用前の基礎Weightであり、Cap後まで固定の出現率ではない。
- Capは方向・Waveごとの今回Spawn数にかかる。初期Hunterや別Waveの生存個体はCapへ数えない。
- 抽選順を`zombie → policeZombie → soldierZombie → riotZombie → hunterZombie`、方向順をNorth／East／South／Westとして固定する。
- HunterはSlot置換であり追加Slotではない。Rejected Bonusは従来どおり追加の通常Zombie固定とする。
- Hunterを含むSlot由来個体はGroup／Scheduled／Final所属を継承し、Victory判定に含める。Spawn前のType抽選結果と非可視個体は公開しない。

## 9. Hunter Zombie

### 9.1 初期配置

- Type IDを`hunterZombie`とし、通常Zombie25体を維持した上でHunterを追加する。
- 標準初期数は1～4体の整数を等確率で抽選する。Seed付き乱数を使い、同じ新Version・Seed・Configで数、座標、Unit ID、以後の乱数列を再現する。
- 州都から地形／移動コストを含めない最短Hex Distanceで20以上離す。距離19以下への配置や候補不足時の距離条件緩和は禁止する。
- 通行不能Terrain、Horde Spawn Reserve、恒久Facility、Human Unit、通常Zombie、他のHunterと重なる位置を除外する。それ以外の道路・通行可能Terrainは候補にできる。
- 既存の通常Zombie25体の座標選択を先に確定し、その後Hunter数、Hunter位置を順に抽選する。候補をq／r安定順とし、重複なしの選択手順とRNG消費順をテストで固定する。旧版とのゲーム全体の乱数列一致は要求しない。
- 候補が抽選数より少なければ診断可能な初期化エラーとし、数を黙って減らさず、部分的な新規ゲームをCommitしない。
- Countのmin／maxと州都最小距離をConfig化する。min／maxは非負整数かつmin ≤ max、距離は非負整数とし、標準を1／4／20とする。ゲーム内設定UIの追加は不要。
- 初期Hunterの`spawnGroupId`／`hordeKind`はnull。初期配置の詳細や不可視Hunter数を公開しない。Save境界ではSeed・Configに対応する初期生成情報を検証する。

### 9.2 行動と共通ルール

- Police／Soldier／Riot Zombieと同じNormal AI系とし、`Visible Population Target > 継承Horde Target > Noise Target > Idle`を使う。
- 継承、記憶解除、Noise反応、同点処理は既存Normal AIと共通。Capitalを常時知る専用Targetや独自の追跡能力は追加しない。目標がなければ停止する。
- Move15は既存のTerrain重み付き移動力として扱い、15Hexの地形無視移動とはしない。迎撃停止、占有、感染、陥落、Kill Credit、Visibility／LOSは共通ルールに従う。
- 初期配置とWave Slotから生成する。Human死亡時のReanimation、感染者由来Spawn、Noise再SpawnをHunterへ変更しない。
- Human Unitの直接Killでは他のZombie同様にVeteran昇格用Killへ数える。

### 9.3 Assetと表示

- Hunterの盤面Assetは1体描き。フード付きパーカーを着た筋骨隆々の陸上選手型ゾンビを、前傾姿勢と両手の異様に長い爪で表現する。
- 既存のComic-paintedな画風に統一し、過度に写実的なGoreを増やさない。Runtimeは256×256 pxの透過PNG、UI専用Asset Registry経由とする。
- 小さい表示でもフード・姿勢・長い爪が識別できる形にし、低Zoom LOD、読み込み失敗Fallback、選択Marker、Mixed Horde Markerとの重なりを確認する。
- 日英名は「ハンターゾンビ」／`Hunter Zombie`。Unit詳細、Board Legend、Help、Wave混成可能Type、Agent API情報へ性能とAIの説明を追加する。
- Asset Manifestと出典／生成記録を更新し、既存のRuntime盤面Asset合計3MiB上限内に収める。画面表示とCore状態を結び付けない。

## 10. Version・保存互換

| 境界 | v1.5.1 |
| --- | --- |
| App／Release | `1.5.1` |
| Game Rules／GameState／Config | `4.0.0` |
| Fixed Map ID | `fixed-51x51-v1`（地形・施設配置を変更しない） |
| Save Format／autosave key | `11`／`nowhere-left-to-hide:auto-save:v11` |
| Agent／Observation／Bridge API | `8.0.0` |
| Artifact Schema | `7.0.0` |
| Session／Checkpoint Schema | `4.0.0` |
| Balanced／Random Strategy | `5.0.0`／`3.0.0`（戦略自体は変更しない） |

- v1.5.1は新規ゲーム向けとする。v1.5.0以前のSave、Replay、Artifact、Session、Checkpointを変換・移行せず、理由付きで状態不変の拒否とする。
- 旧データとautosave keyを上書き・削除しない。Opusの停止済みv1.5.0 Sessionを新版本体へ引き継ぐ救済機能は対象外とする。
- 同じv1.5.1でもSession／CheckpointのBuild ID等の完全なVersion境界を照合する。新しくConfig化した初期Hunter、特殊Cap、Zombie Chargeを完全検証し、欠落を旧値で黙って補わない。
- Hunter、Horde残Charge、Wave抽選、初期乱数、所属、Noise等をSave／Load、Session Resume、Checkpoint分岐、Replayで再現する。
- タイトル画面、package、API metadata、Help、Portable README、`PLAY_WITH_AI.md`、Workflowを同じVersion／コマンド仕様へ更新する。

## 11. 実装計画と担当境界

| 工程 | 主な対象 | 完了条件 |
| --- | --- | --- |
| 1. 基準計測・契約定義 | `src/session/`、`src/agent/types.ts`、公開Projection、テストFixture | 現行容量の内訳、Compact／query／保存差分／ArtifactのSchemaとFoW境界を固定 |
| 2. Session基盤修正 | `src/session/store.ts`、`service.ts`、`types.ts`、Hash／reader | 損失なし保存、Stream検証、原子的更新、祖先共有、分岐、容量試験 |
| 3. 公開API・配布接続 | Agent、Session CLI、Artifact／Metrics／Replay、Bridge、Portable | Compactと詳細取得の同値性、全正式コマンド、直接Node実行、公開情報非漏洩 |
| 4. バランス・Hunter Core | `src/core/config.ts`、`types.ts`、`state.ts`、`map.ts`、`engine.ts`、保存検証 | 数値、2回攻撃、初期配置、抽選Cap、Seed／Save／Replay一致 |
| 5. UI・Asset・説明 | `src/ui/`、日英表示、`public/assets/board/`、Help、README | 性能・Charge・予告・Hunter表示が現在Configと一致し、モバイルで識別可能 |
| 6. 統合・Release検証 | Unit／Session／UI試験、Batch、`.github/workflows/`、Portable | 下記受入条件を満たし、結果を保存。現行仕様へ反映して文書をarchive |

共有型、Core境界、Version、保存契約は親が所有する。契約確定後、Session実装とCore／UIのうち独立したファイルを分担できる。子へ担当外の変更をさせず、実装後は別工程でSession／Core／UI／保存互換の接続を確認する。孫エージェントは起動しない。

## 12. 受入条件

### 12.1 AI容量・性能・完全性

- 現行報告に相当する51×51・21部隊規模の公開Fixtureで、Compact、全詳細Page、Full Snapshotの情報同値性を確認する。保存用差分から全Decisionの前後Observation／合法手を完全復元する。
- 同じ論理履歴を旧方式と新方式で符号化して比較する。通常応答のUTF-8 bytesは旧応答の25%以下、Session総保存量は旧方式の50%以下を受入基準とする。総量にはTraceだけでなくPrivate／Public generation、Checkpoint、共有Payloadを含め、Root内の実体を1回ずつ数える。
- 少なくとも1,000 Decisionの長期Session試験を行う。不合法Actionだけで水増しせず、状態変化を伴う受理Actionを含む制御Fixtureを使用する。別途、通常ルールのプレイをFinal Wave後まで進める検証を設ける。
- 512MiBを超える有効な履歴ファイル／Packageを専用大容量試験で生成し、復帰、追加step、Checkpoint、分岐、query、Artifact export／read／Replayが巨大文字列化なしに動作することを確認する。旧Schema移行の試験とはしない。
- 同一の現在Stateで履歴長を増やす測定を行い、Peak RSSと通常応答サイズが展開済み履歴総量に比例して増加しないことを確認する。各コマンドのp50／p95時間、読み込み量、Traceと総保存量、起動方法、OS／Nodeを記録する。通常経路で全Observationを再構築していないことも確認する。
- 小容量Smokeは日常CI、大容量試験は専用Release Jobで各1回を基本とする。失敗や追加変更なしに同じ重い検証を繰り返さない。
- 履歴途中／末尾、差分、Snapshot、参照先、親履歴、Active、Version／Build不一致の破損注入を試験する。正規State／RNG／Action列を変更せず拒否し、診断記録以外の暗黙修復をしない。
- 書き込み中断、同時step、stale lock、古いCursor／Revision、query後の状態変化、不合法Decision、Game Over後の操作を試験する。
- 分岐直後に祖先全文を複製していないこと、共有履歴で再開できること、自己完結Artifactを別Rootで読めることを確認する。空の子、複数世代の分岐、基点Hash不一致、祖先Manifestの範囲欠落・循環も試験する。
- `stateDelta`を含む公開出力、query、履歴、ArtifactでFoW非漏洩を確認する。非可視個体の数・位置や未公開の初期抽選結果を、候補件数・不合法理由・履歴参照へ混入させない。公開Actionと既知情報に基づく推察は5.4の境界に従う。

### 12.2 ゲームルール・UI

- Recruit／Regular／Veteranの攻撃力、Terrain軽減、軍需0時の弱体化、鎮圧数、Riot／Policeの民間被害0を検証する。
- Hordeの同一対象2回攻撃、対象撃破後の別対象、反撃死、迎撃での権利消費、権利補充、攻撃後再移動禁止、Game Overによる停止を検証する。
- 通常・Police・Soldier・Riot・Hunterの性能が混同されず、Wave出身という理由だけで特殊ZombieのChargeが2にならないことを確認する。
- 初期Hunterの数1～4、距離20境界、重複なし、Reserve／施設除外、候補不足、Seed再現、通常25体維持を検証する。等確率は抽選範囲と決定的Fixtureで確認し、確率的に落ちるテストにしない。
- HunterのNoise／Horde継承／Idle、Move15と地形・迎撃、Kill Credit、初期とWaveの所属差を検証する。
- 全Waveの基礎H41／Slot73／Total114、Final52、RiotとHunterの独立Cap、両Cap後の再正規化、Rejected Bonus、原子的Spawnを検証する。
- Warning／Spawn直前後、2回攻撃の途中、Hunterが関与するNoise／CombatをSave・Session・Checkpoint・Replayで照合する。
- Human UI、Agent、Help／Legendの日英表示とCore値を照合し、モバイル縦画面、低Zoom、FallbackでHunterと残Chargeを確認する。

### 12.3 統合評価・Release

- 型検査、関連Unit／UI／Session／Replay試験、Build、Browser Bridge Smoke、Portableの既存7コマンド＋queryとファイルArtifactのSmokeを完了する。
- v1.5.0とv1.5.1を各版の正しいConfigで、Random／BalancedそれぞれSeed 1～100、同じRunner上限100 Turnで比較する。既存の条件一致した基準結果を再利用できる。Technical FailureとReplay／Session不一致を0とする。
- 勝率、生存Turn、損失、経済、Zombie別撃破、Horde進行を比較資料にする。今回の明示的なバランス変更にv1.5.0時の「勝率差±10 percentage points」を合否条件として流用しない。Runner上限到達とゲーム敗北・Technical Failureを区別する。
- 公開Observation／合法手だけを読む外部AI相当DriverでSeed 1と7をGame Overまで実行し、Artifact／Replay一致を確認する。短期敗北だけでは長期Session検証を満たさないため、12.1のFinal Wave後までのプレイと大容量試験も別途必須とする。
- WindowsでSession実行を確認し、既存Linux Portable PackageもBundled Nodeだけで検証する。Windows向け新規Portable配布形式の追加は必須としない。
- PagesとPortableのWorkflowを検証し、最終commit SHA・Version・検証結果を記録する。公開操作はその実装タスクでのユーザーの指示に従う。
- 要件・実装・テスト・Help・保存形式の整合を確認して現行仕様へ反映する。今回の計画作成ではこれらの実装検証を実施済みと記載しない。

## 13. 一問一答で確定した判断

| No. | 確定内容 |
| --- | --- |
| 1 | PoliceはRecruit6、Regular／Veteran8。既存の1.25倍・切り上げを維持 |
| 2 | 初期Hunterは州都から最短Hex Distance20以上 |
| 3 | 通常Zombie25体にHunter1～4体をランダム追加。等確率・Seed付きで具体化 |
| 4 | Hunterは既存特殊Zombieと同じNormal AI |
| 5 | Hordeは通常攻撃・反撃・迎撃で2回分共有。最大2回能動攻撃、移動最大1回 |
| 6 | Hunterも1方向・1Wave最大1体。Cap到達後は再正規化 |
| 7 | v1.5.0データは保持し、v1.5.1へ移行しない |
| 8 | AI通常応答はCompact化し、詳細を必要時取得。公開情報へのアクセスは維持 |
| 9 | Hunter Assetは指定イメージ・既存画風の1体描き |
