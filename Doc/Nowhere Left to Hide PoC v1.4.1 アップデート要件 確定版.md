# Nowhere Left to Hide PoC v1.4.1 アップデート要件 確定版

作成日: 2026-09-01
ステータス: Confirmed
対象Release: `1.4.1`

## 1. 文書の位置づけ

本書はv1.4.1の確定アップデート要件であり、実装・テスト・Help・AI Portable Packageの変更目標とする。

実装と検証が完了するまでは、安定版仕様の正本を`Doc/Nowhere Left to Hide PoC 現行仕様.md`とする。両文書が矛盾する場合、現行動作の判断には現行仕様を、v1.4.1で変更する部分の実装目標には本書を用いる。

実装・テスト・動作確認の完了後、本書を現行仕様へ反映し、実装、テスト、Help、Agent API、AI Portable文書との整合を確認する。その後、本書を`Doc/archive/`へ移す。

## 2. 目的

v1.4.1では、次の3点を改善する。

1. AI Portableで1回のLLM回答を超えて同一ゲームを安全に継続できるSession保存・再開機能
2. 軍需品を国家全体の固定維持判定から、ユニットごとの携行・消費・補充へ変更する兵站ルール
3. Fuel 0のHuman Unitへ限定的なEmergency Movementを保証する機動ルール

Fog of Warと公開情報境界は維持する。AIが意思決定へ利用できる情報は、公開Observation、Legal Actions、公開Step結果、公開Event、自身のActionと公開Decision Logだけとする。完全GameStateは再開専用のPrivateデータであり、意思決定には使用しない。

## 3. Version境界

| 対象 | v1.4.1 |
|---|---|
| App / Release | `1.4.1` |
| Game Rules / GameState / Config | `2.1.0` |
| Fixed Map | `fixed-31x31-v1` |
| Save Format | `6` |
| Agent API | `3.0.0` |
| Observation API | `3.0.0` |
| Browser Bridge API | `3.0.0` |
| Artifact Schema | `2.1.0` |
| Checkpoint Schema | `1.0.0` |
| Balanced Agent | `4.1.0` |
| Random Agent | `2.1.0` |

- Fixed MapおよびMap座標はv1.4.0から変更しない。
- `militarySupplyAvailable`削除を含む公開Schemaの非互換変更があるため、Agent、Observation、Browser Bridge APIはMajor更新とする。
- ArtifactはDecision Trace等の追加を中心とするためMinor更新とする。
- v1.4.0以前のSave、自動保存、セーブコードは変換しない。Version不一致として現在Stateを変更せず拒否し、旧データを削除・上書きしない。
- App Versionだけが異なる通常Saveは現行方針に従うが、AI Session CheckpointはBuild IDを含む全必須Versionの一致を要求する。

## 4. スコープ

### 4.1 変更するもの

- AI Portable Session、Active Session、履歴Checkpoint、分岐Session
- Public Decision Logと継続Run Artifact
- Session CLIと`PLAY_WITH_AI.md`
- Unit別軍需品プール、固定消費、戦闘・鎮圧消費、補充
- 軍需不足時の戦闘能力と射程
- Military Goods Forecastと関連Metrics
- Fuel 0 Emergency Movement
- Observation、Legal Actions、Human UI、Help、Balanced Agent
- Save、Replay、Artifact、Browser BridgeのVersion境界と新規Field

### 4.2 変更しないもの

- Fog of War、Visibility、Hidden情報の公開境界
- Fixed Map、補給網の地理判定
- 通常時のMovement 10と既存Terrain Cost
- Fuel 1以上の既存Fuel Cost式と補充規則
- 警察・州兵の基礎HP
- 基礎攻撃力: 警察5、州兵10
- 基礎射程: 警察1、州兵2
- 通常自動鎮圧力: 警察5、州兵10
- 警察は鎮圧時の民間人被害なし、州兵は通常鎮圧時に5人の民間人被害
- 別途明記しない計算の端数切り上げ

## 5. AI Portable Session

### 5.1 層とFair-play境界

Session機能はAgentGameの外側へ置く。

```text
AI Portable Session
  ├─ AgentGame（公開Observation / Legal Actions / step）
  ├─ Public Trace / Run Artifact
  └─ Private Checkpoint State
```

- AgentGameへ完全GameState取得メソッドを追加しない。
- Session CLIはCheckpoint IDを扱い、Private State本体を標準出力へ返さない。
- 完全GameState、RNG state、Hidden Enemy、内部Target、非公開ConfigはPrivate領域だけへ保存する。
- AIが同一ファイルシステムを直接探索する行為を技術的に強制隔離することはv1.4.1の対象外とする。Fair-playはAPI、CLI、ディレクトリ境界、文書上の禁止事項で定義する。
- 秘密鍵、署名、別サービスによる対悪意AIの隔離は対象外とする。

### 5.2 Session IDと上書き禁止

- 新規Sessionは一意なSession IDを持つ。
- 既存の非空Session保存先へ新規Sessionを上書きしない。
- 既存Sessionへ可能な操作は、同じSession IDのActive復帰と、Checkpointを親にした新しい分岐Session作成だけとする。
- 既存Sessionを暗黙に消去または再初期化する操作は提供しない。

### 5.3 Active Session

- 形式的に正しい`step`要求を処理するたび、Public Decision Logを追記する。
- accepted Actionの適用後は、完全GameState、公開履歴、Session metadataを原子的にActive Sessionへ保存する。
- 不合法ActionはGameStateとRNGを変更しないが、Decision LogとSession metadataは原子的に更新する。
- Active Sessionは最新の正常状態1件を保持し、保存途中の中断で直前の正常状態を壊さない。
- Active Sessionからの通常復帰は同じSession ID、Decision番号、Run Artifactを継続する。
- Active Sessionが破損している場合、自動で過去へ巻き戻さない。エラーと利用可能なCheckpointを返し、明示的な`load-checkpoint`を要求する。

### 5.4 排他制御

- 同じSessionに対する各CLI操作の原子的更新中だけ排他ロックを取得する。
- 同時更新はSessionを変更せず拒否する。
- CLI処理完了時にロックを解放し、逐次実行を妨げない。
- 異常終了で残ったロックは、記録したPIDのプロセスが存在しない等、無効と安全に確認できる場合だけ自動回収する。

### 5.5 履歴Checkpoint

- 既定間隔は5完了Turnごととし、Session開始時の公開CLIオプションで正の整数へ変更できる。
- Turn 5のEndTurn内部処理が完了し、Turn 6のPlayer Phaseへ入った安定状態を`after-turn-005`として保存する。
- EndTurn途中の内部Phaseは履歴Checkpointにしない。
- 手動Checkpointをいつでも作成できる。
- Game Over確定時は最終Checkpointを自動作成する。
- Active Sessionは履歴Checkpointと別にActionごとに更新する。
- Checkpoint IDはSession内で一意かつ決定的に識別可能とし、同じ完了Turnに複数ある手動Checkpointを衝突させない。

### 5.6 Checkpoint保存単位

Checkpoint単体の持ち出し・配布は対象外とし、Sessionディレクトリ全体を保存単位とする。

各Checkpointは少なくとも次を保持する。

Private:

- Save Format 6の完全GameState
- RNG state
- Event／Unit／Checkpoint等の各IDカウンタ
- 完全Configと再開に必要な非公開情報

Public:

- 現在の公開Observation
- Session metadata
- Public Traceの到達Decision番号
- 到達点のPublic Trace hash
- Run Artifactの継続に必要な公開情報

公開履歴全体をCheckpointごとに重複保存せず、Session内の共有追記TraceをDecision番号とhashで参照する。Checkpointから分岐する際は、親Checkpoint到達点までの必要な公開履歴を新Sessionへ確定コピーする。

### 5.7 Checkpoint metadata

最低限、次をGameState本体を読まず確認できる公開metadataとして保存する。

- Checkpoint Schema Version
- App Version
- Game Rules / GameState / Config Version
- Save Format Version
- Artifact Schema Version
- Agent / Observation / Browser Bridge API Version
- Build ID / Git Commit
- Map ID、Seed、Public Config
- Session ID、Checkpoint ID
- 親Session ID、親Checkpoint ID（分岐時）
- 完了Turn、現在Turn、Phase、Decision番号
- Private State payload hash
- Public Trace到達点hash
- metadata整合検証値

Build IDを含む必須Version、Map、Configが一致しないCheckpointはロードしない。異なるBuildへの移行機能はv1.4.1の対象外とする。

### 5.8 Hashと破損検出

- SHA-256を使用する。
- Private State payloadとPublic Traceを個別に検証する。
- Public Decision Logは前Decision hashを含むハッシュチェーンとする。
- State、Trace、metadataの単独改変やファイル間不整合を検出し、Sessionを変更せず拒否する。
- 保証範囲は偶発的破損と不整合の検出である。攻撃者が全ファイルとhashを整合するよう変更するケースへの真正性保証は対象外とする。

### 5.9 派生cache

Checkpointロード後は、cached Observation、cached Legal Actions、候補Projection等、GameState依存cacheを破棄して正データから再構築する。ロード前の派生値を再利用しない。

## 6. Public Decision LogとArtifact

### 6.1 Decision単位の記録

実行中は追記式`trace.ndjson`へ保存し、完了時は同じ内容をArtifact Schema 2.1.0の`decisionTrace`へ統合する。

各Decisionは最低限、次を持つ。

- Decision番号
- Turn、Phase
- Action前の公開Observation
- Action前のLegal Actions
- 入力Action
- `decisionSummary`
- accepted / rejected
- 理由付きerror
- Action適用後の公開Events
- 前Decision hashと現在Decision hash

非公開chain-of-thoughtは要求・保存しない。

### 6.2 `step`入力境界

- `step`入力はJSON objectとし、`action`と`decisionSummary`を必須とする。
- `decisionSummary`はtrim後1～500文字のUnicode文字列とする。短い自由文または理由コードを許可する。
- 形式的に正しい入力を受理した時点でDecision番号を付与する。
- 不合法ActionもDecision番号を消費し、Observation、Legal Actions、Action、Summary、errorを記録する。GameStateとRNGは変更しない。
- JSON破損、必須項目欠落、空Summary、文字数超過はCLI入力エラーとし、Decision番号、Session、Traceを変更しない。
- 再試行には新しいDecision番号を付ける。

### 6.3 Run Artifact継続

Active復帰前後を同一Runとして扱い、次を欠落・重複なく継続する。

- initial observation
- accepted actions
- invalid attempts
- observation trace
- public events
- decision trace
- Agent ID、Seed、Public Config、Build ID
- 最終ResultとMetrics

GameStateだけをロードして新規Artifactを開始してはならない。分岐Sessionは親Checkpointまでの履歴を引き継ぎ、親Session IDと親Checkpoint IDを明示する。

## 7. AI Portable Session CLI

### 7.1 正式コマンド

| Command | 役割 |
|---|---|
| `new` | 新規Sessionを作成する |
| `status` | 公開Observation、Legal Actions、Session metadataを一括取得する |
| `step` | Actionと必須`decisionSummary`を処理する |
| `save-checkpoint` | 手動Checkpointを作成する |
| `list-checkpoints` | 公開Checkpoint metadataを列挙する |
| `load-checkpoint` | 指定Checkpointから新しい分岐Sessionを作成する |
| `artifact` | 途中または最終Run Artifactを取得する |

- 特別な`resume`コマンドは設けない。同じSession IDへの`status`をActive復帰の入口とする。
- `load-checkpoint`は元Sessionを巻き戻さず、新Session IDを必須とする。
- `status`は1呼び出しで公開Observation、Legal Actions、Session metadata、Game Over状態を返す。

### 7.2 JSON入出力

- 全コマンドの正常結果とAction拒否結果は標準出力へJSONで返す。
- CLI自体の致命的エラーは標準エラーへ説明を出し、非0 Exit Codeを返す。
- `step`はJSONファイルまたは標準入力から受け付ける。長いAction JSONのコマンドライン直書きを必須にしない。
- 出力JSONは決定的なField意味を持ち、AIが表示文言を解析しなくても操作できる。

### 7.3 新規Session Config

- 既定は標準Configとする。
- `new`で指定可能な値は、Seed、Checkpoint間隔等の公開項目許可リストに限定する。
- 非公開Noise半径等を含む完全ConfigファイルをSession CLIから入力・表示できない。
- Public Configだけをmetadata、Observation、Artifactへ含める。

### 7.4 配置

標準構造は次とする。具体的な内部ファイル名を変更する場合も、PublicとPrivateの境界および本書のSchemaを維持する。

```text
output/sessions/<session-id>/
├─ session.json
├─ trace.ndjson
├─ run.partial.json
├─ private/
│  └─ active.state.nlth
└─ checkpoints/
   ├─ after-turn-005.meta.json
   ├─ after-turn-005.public.json
   └─ after-turn-005.state.nlth
```

## 8. Unit別軍需品

### 8.1 StateとConfig

Human Unitへ次を追加する。

```text
currentMilitaryGoods
maxMilitaryGoods
```

標準Config:

| Unit | 最大携行軍需品 | End Turn固定消費 |
|---|---:|---:|
| 警察 | 5 | 0 |
| 州兵 | 20 | 1 |

- `currentMilitaryGoods`は0以上`maxMilitaryGoods`以下の整数とする。
- 最大量、距離別戦闘Cost、鎮圧Cost、固定消費、軍需不足倍率をUnit Configで定義する。
- 初期警察・州兵は満タンで開始し、その携行分を初期国家備蓄75から差し引かない。

### 8.2 新規編成Unit

- 現行の編成費用、警察の軍需品10、州兵の軍需品25を維持する。
- 編成費用に初期携行軍需品を含める。
- 完成時、追加の国家軍需品消費なしで警察5 / 5、州兵20 / 20とする。
- Fuelは現行どおり`currentFuel = 0`で完成し、State Fuelから有償commissioning補給する。

### 8.3 固定消費

- End Turn Economy開始時、生存中の州兵は自身の携行軍需品を1消費する。
- 0の場合は0のままとし、HP、人口、士気、Action、射程への追加ペナルティを発生させない。
- 警察は固定消費しない。
- 固定消費後の実際の戦闘・鎮圧能力は、その時点の携行量で判定する。

## 9. 戦闘時の軍需品

### 9.1 共通原則

- 通常Attack、Counterattack、Interceptionへ同じ判定を適用する。
- 攻撃が実際に成立した場合だけ、攻撃側Human Unitの携行軍需品を消費する。
- 攻撃前にUnitが破壊された、射程外で反撃できない等、攻撃が発生しなければ消費しない。
- 軍需Costを支払った攻撃は、命中結果、Terrain防御、対象の残HPにかかわらず返金しない。
- Fuelは攻撃、反撃、迎撃を制限・消費しない。

### 9.2 警察

| 距離 | 必要軍需品 | 軍需品1以上 | 軍需品0 |
|---|---:|---:|---:|
| 1 | 1 | 攻撃力5、1消費 | 攻撃力1、消費0 |

軍需品0は攻撃不能ではなく、通常攻撃力の1/5を端数切り上げした最低戦闘能力とする。

### 9.3 州兵

| 距離 | 必要軍需品 | 成立条件 | 威力・消費 |
|---|---:|---|---|
| 1 | 1 | 軍需品1以上 | 攻撃力10、1消費 |
| 1 | 0 | 軍需品0 | 攻撃力2、消費0 |
| 2 | 2 | 軍需品2以上 | 攻撃力10、2消費 |

- 距離2で軍需品が0または1の場合、攻撃、反撃、迎撃を不可とする。Legal Actionsへ含めない。
- 距離2の軍需不足版1/5攻撃は存在しない。
- 距離1では軍需品0でも攻撃力2で攻撃できる。
- `attackMilitaryGoodsCostByRange`は警察`{1: 1}`、州兵`{1: 1, 2: 2}`を標準とする。
- Config validationは各Unitの攻撃可能距離にCost定義があり、非負整数であることを検証する。

### 9.4 TerrainとCombat Noise

- 軍需不足による基礎攻撃力を先に決め、その値を既存Terrain Damage計算へ渡す。
- 軍需品0の弱体攻撃も通常Combatであり、既存の攻撃権、自然回復区分、Combat Noiseを適用する。

## 10. 自動鎮圧

- 感染施設またはCheckpointへ駐留するHuman Unitは、軍需品量にかかわらず感染者数の増加を停止する。
- 攻撃権が残り、軍需品が1以上なら、End Turnの既存感染Phaseで通常の自動鎮圧を行い、軍需品1を消費する。
- 警察は感染者を5減らし、民間人被害を出さない。
- 州兵は感染者を10減らし、既存式`ceil(10 × 0.5) = 5`の民間人被害を出す。
- 軍需品0では自動鎮圧を行わず、攻撃権を消費しない。感染拡大阻止だけを維持する。
- 軍需不足時の1/5鎮圧力は設けない。
- Fuelは自動鎮圧を制限・消費しない。

## 11. 軍需品のEnd Turn処理と補充

処理順を次で固定する。

```text
1. 州兵の携行軍需品固定消費
2. 既存電力・入力配分を経たMilitary Factory生産
3. 当ターンMilitary Goods生産を国家備蓄へ追加
4. Supply内Human Unitへ国家備蓄から補充
5. 既存のRefugee処理
6. 自動鎮圧（補充後の携行軍需品を使用）
7. Zombie Phase
```

- 補充対象は生存中、Supply内、`currentMilitaryGoods < maxMilitaryGoods`のHuman Unitとする。
- Supply外のUnitは補充しない。
- 当ターン生産したMilitary Goodsを当ターンのUnit補充へ利用できる。
- 複数Unitの需要に国家備蓄が足りない場合、Unit ID昇順で1単位ずつラウンドロビン配分する。
- 最大量を超えず、実補充量だけ国家備蓄を減らす。
- FuelとMilitary Goodsは別備蓄のため、相互の配分優先順位を設けない。
- 国家備蓄0や補充未充足による国家全体のHP、人口、士気、射程ペナルティは設けない。
- `militarySupplyAvailable`をGameState、Save、Observation、Forecast、Agent判断から削除する。
- 能力低下は各Unitの携行軍需品だけで決める。
- Unit撃破時の残存携行軍需品は失われ、国家備蓄へ戻さない。

## 12. Military Goods Forecast

旧人口ベースMilitary Goods maintenance forecastを廃止し、最低限次を返す。

- starting national stock
- projected production
- Unit別固定消費前携行量
- Unit別固定消費量と固定消費後携行量
- Unit別refill demand
- Unit別projected refill amount
- total unfilled refill demand
- projected national ending stock
- Unit別補充後携行量
- 今End Turnで確定するUnit別自動鎮圧消費
- Unit別自動鎮圧後の最終携行量
- 自動鎮圧の成立／感染拡大阻止のみの区分

今のStateでEnd Turnした場合に確定する自動鎮圧はForecastへ含める。将来のPlayer Action、Zombie行動、Hidden Enemyによる未確定戦闘消費は含めない。ForecastはCoreの実処理と同じ純粋計算を使い、State、Resource、Action回数、PRNGを変更しない。

## 13. Fuel 0 Emergency Movement

### 13.1 基本ルール

- `currentFuel > 0`では既存の通常MoveとFuel Cost式を使う。
- `currentFuel == 0`ではEmergency Movementを使用できる。
- Fuelは0のままで、負値を許可しない。
- Emergency Movementは既存の`Move` GameActionとして扱い、新Action Typeを追加しない。

| Unit | Emergency Movement上限 |
|---|---:|
| 警察 | 3 MP |
| 州兵 | 2 MP |

### 13.2 経路と戦闘

- 上限はHex数ではなく既存effective movement costの合計で判定する。
- Plain、Road、Urbanは既存判定で1 MP、Forest 2 MP、Mountain 3 MPとする。
- 警察はPlainのみなら最大3 Hex、州兵は最大2 Hex移動できる。
- 通常Moveと同じPathfinding、FoW、Hidden Enemy直前停止、Interception、行動権を使用する。
- 移動後に生存し攻撃権が残っていれば、通常どおりAttackまたはWaitを選べる。
- Fuelは移動だけを制限し、Attack、Counterattack、Interception、Wait、自動鎮圧を制限しない。
- End Turn時にSupply内なら既存規則でFuel補充を受け、Supply外なら次TurnもEmergency Movementを使用できる。

### 13.3 公開Schema

Unit ObservationとLegal Moveへ最低限次を追加する。

- `emergencyMovementPoints`
- `emergencyMovementAvailable`
- Legal Moveごとの`movementMode: "normal" | "emergency"`
- Legal Moveごとの`fuelCost`
- Legal Moveごとのeffective MP cost
- Move後Fuel

## 14. Observation、API、UI、Help

### 14.1 Unit Observation

Human Unitごとに最低限次を公開する。

- `currentMilitaryGoods` / `maxMilitaryGoods`
- `fixedMilitaryGoodsUpkeepPerTurn`
- `attackMilitaryGoodsCostByRange`
- `suppressionMilitaryGoodsCost`
- 距離別の現在攻撃可否、軍需不足理由、effective attack
- Legal Attackごとの距離、必要軍需品、実行後予想残量、予想Damage
- projected refill demand / amount
- 固定消費後、補充後、自動鎮圧後の予想携行量
- 撃破時にFuelと携行軍需品が失われる静的ルール
- Emergency Movement関連Field

`getApiInfo()`は、軍需品、距離別Cost、軍需不足攻撃、自動鎮圧、補充順、撃破時喪失、Emergency Movementを公開静的ルールとして返す。

### 14.2 Human UI

Unit詳細へ次を表示する。

- 現在／最大携行軍需品
- 固定消費、予測補充、自動鎮圧後残量
- 距離別攻撃Cost
- 軍需品0の最低攻撃力
- 州兵の距離2必要量と不足時に攻撃不可であること
- 自動鎮圧Cost 1、軍需品0では感染拡大阻止のみであること
- 撃破時に残存Fuelと軍需品が失われること
- Fuel 0 Emergency Movement上限

Attack確認UIは距離、必要軍需品、攻撃後残量、effective attack、Terrain適用前後予想Damage、軍需不足警告を表示する。Fuel 0 Unitも移動不能表示にせず、Emergency範囲を通常Moveと同じ操作で表示し、modeを識別できる文言または表示を付ける。

### 14.3 Forecast UIとHelp

- 国家備蓄、生産、固定消費、補充需要、実補充、未充足量、国家終了備蓄を区別する。
- Unit別に固定消費後、補充後、鎮圧後の携行量を確認できる。
- Helpは日英で新軍需ルール、補充順、国家備蓄不足の意味、射程2条件、鎮圧、撃破時喪失、Emergency Movementを説明する。
- `PLAY_WITH_AI.md`はSession作成、`status`、`step`、Active復帰、Checkpoint、分岐、Public Trace、Private State閲覧禁止、破損時の明示復旧を説明する。

## 15. Balanced / Random Agent

Balanced Agent 4.1.0は公開ObservationとLegal Actionsだけから次を評価する。

- Unit別携行軍需品と補充見込み
- 州兵の距離1／2 Cost差と距離2の必要量2
- 軍需品0の距離1弱体攻撃
- 鎮圧用軍需品1と、0で感染拡大阻止のみになること
- Supply外進出時の携行Fuel・軍需品
- Military Factoryの価値を新Forecastの未充足需要から評価
- Fuel 0を移動不能と誤認せず、Emergency Moveで補給圏へ帰還可能かを評価
- 撃破時の残存Fuel・軍需品喪失リスク

Built-in Agentは`decisionSummary`に非公開思考過程ではなく、既存の優先目標、理由コード、上位候補の短い公開説明を使う。Random Agentは新しいLegal Actionsと共通Runnerを使い、GameStateを直接参照しない。

## 16. Save、Replay、Artifact

- Save Format 6はUnitの`currentMilitaryGoods`、最大量との整合、関連Config、v1.4.1統計を検証する。
- Save Format 6はUnitStateの`maxMilitaryGoods`がUnit Configの標準最大量と一致することも検証する。
- Emergency Movementの利用可否はConfigと`currentFuel`から導出し、永続Stateを増やさない。
- Forecast、Supply、Visibility、Legal Actions等の導出値は保存せず再計算する。
- Replayは同一Version、Build、Config、Map、Seed、初期State、Action列から軍需消費、補充、鎮圧、Emergency Movement、結果を一致させる。
- Artifact Schema 2.1.0はPublic Decision Log、Session lineage、軍需・Emergency Metricsを追加する。
- Browser BridgeとPlayer-facing ArtifactへPrivate Checkpoint、完全GameState、非公開Config、Hidden情報を含めない。

## 17. Metrics

最低限、次を追加する。

### 17.1 軍需品

- Unit Type別固定消費量
- Unit Type別通常攻撃／反撃／迎撃消費量
- Unit Type別自動鎮圧消費量
- Unit Type別補充量、未充足補充量
- Unit Type別撃破時喪失量
- Unit Type別軍需品0弱体攻撃回数
- 州兵の距離1／距離2攻撃回数と消費量
- 国家軍需補充不足Turn数

### 17.2 Emergency Movement

- Unit Type別Emergency Movement回数
- Unit Type別Emergency移動Hex数、消費MP
- Emergency MovementによるSupply内帰還回数

### 17.3 Session

- Active Session復帰回数
- 手動／定期／最終Checkpoint作成数
- 分岐Session作成数
- hash／Version／Build／破損による拒否数
- 不合法Decision数と入力形式拒否数

Session Metricsはゲーム成績と分離する。Hidden Enemyを推測できるMetricsは現行の完全検証Artifact境界を維持し、Production Observation、公開Event、Browser Bridge Artifactへ出さない。

## 18. テスト要件

### 18.1 Session round-trip

同一Seed、Config、Action列について、連続実行と、複数地点でプロセス終了・Active復帰・Checkpoint分岐を行う実行を比較し、次を一致させる。

- Public Observation、Legal Actions、公開Events
- RNG結果、最終Result
- accepted Actions、invalid attempts、Decision番号
- 最終GameState hash
- Run ArtifactとReplay結果

### 18.2 原子性・排他・破損

- Action適用、Trace追記、Active State置換の各中断点で直前正常状態を失わない。
- 同時更新を状態不変で拒否する。
- 終了済みPIDの古いロックだけを回収する。
- State、Trace、metadataの単独改変とhash chain不一致を検出する。
- Active破損時に暗黙の巻き戻しを行わない。
- Build ID、Version、Map、Config不一致を状態不変で拒否する。

### 18.3 Artifact継続と分岐

- 復帰前後で履歴が1本に継続し、欠落・重複しない。
- invalid ActionがDecision番号とerrorを持つ。
- malformed `step`はDecision番号とTraceを変更しない。
- 分岐Sessionが親履歴をCheckpoint到達点まで保持し、親Sessionを変更しない。
- Game Over時に最終Checkpointと最終Artifactが確定する。

### 18.4 FoW

Public metadata、Trace、Artifact、CLI出力に、非可視Enemy座標・ID、内部Target、RNG state、完全Config、正確な非公開Noise情報を含めない。Private Stateには完全再開情報を保持してよい。

### 18.5 軍需品

- 初期Unitが警察5、州兵20で国家備蓄を追加消費しない。
- 新規Unitが編成費用以外のMilitary Goodsを使わず満タンで完成する。
- 州兵固定消費1、警察0、不足時追加ペナルティなし。
- 警察距離1は軍需1で攻撃5・1消費、0で攻撃1・0消費。
- 州兵距離1は軍需1以上で攻撃10・1消費、0で攻撃2・0消費。
- 州兵距離2は軍需2以上で攻撃10・2消費、0／1では全Combat種別で不可。
- 通常Attack、Counterattack、Interceptionが同一Ruleを使う。
- 不成立Combatで消費せず、成立CombatではTerrain結果にかかわらず消費する。
- 鎮圧は両Unitとも軍需1を消費し、通常効果を適用する。
- 軍需0の駐留Unitは感染拡大だけを止め、鎮圧・攻撃権消費を行わない。
- 固定消費、当Turn生産、Round Robin補充、鎮圧の順序とForecastが一致する。
- Supply外補充なし、国家備蓄・最大量超過なし。
- 撃破時残量を国家備蓄へ戻さない。
- `militarySupplyAvailable`がGameState、公開Schema、判断ロジックに残らない。

### 18.6 Emergency Movement

- Fuel 0の警察がeffective cost 3以内、州兵が2以内を移動できる。
- Forest、Mountain、Road、Urbanへ既存effective costを使う。
- 上限超過ActionをState／RNG不変で拒否する。
- Fuel 0のまま負値にならない。
- Hidden Enemy停止、Interception、移動後Attack／Waitが通常Moveと一致する。
- Supply内なら既存補充、Supply外なら次TurnもEmergency Moveを利用できる。
- Observation、Legal Actions、UI、Replayが同じ`movementMode`とCostを返す。

### 18.7 Observation、UI、Help、Agent

- Observationだけから距離別軍需Cost、攻撃後残量、effective attack、鎮圧、補充、撃破時喪失、Emergency範囲を判断できる。
- Forecast QueryがStateとPRNGを変更せず、End Turn実績と一致する。
- Mobile 390×844とDesktop 1280×720で軍需情報、Attack確認、Emergency範囲、Forecastを確認できる。
- Help、`getApiInfo()`、`PLAY_WITH_AI.md`の日英または対象言語説明がCore値と一致する。
- Balanced Agentが全新RuleでLegal Actionだけを選び、Random Agentと同じ公開境界を使う。

## 19. Release検証

- 全Unit Test、Invariant Test、Save／Replay／Artifact／Session round-trip、Browser Smoke、Portable Package Smokeを成功させる。
- Random／Balancedを標準Config、固定Seed 1～100で技術的失敗なく完遂する。
- Balancedを標準Config、固定Seed 1～300で技術的失敗なく完遂する。
- 技術的失敗、決定性違反、Replay／Checkpoint不一致、FoW漏洩は0件を必須とする。
- 勝率を機械的な合否条件にしない。v1.4.0との差が大きい場合は新Metricsで原因をレビューする。
- 軍需品、Emergency Movement、Session再開のMetricsをv1.4.0または同一v1.4.1基準Runと比較し、重大なバランス異常を記録・解消する。

## 20. 実装順

1. Version、共有型、Unit Config／State、Save validation
2. 戦闘・反撃・迎撃の距離別軍需Rule
3. 固定消費、Military Goods生産後補充、自動鎮圧
4. Military Goods Forecast、Observation、Metrics
5. Fuel 0 Emergency MovementとLegal Move preview
6. Human UI、Help、Balanced／Random Agent
7. Artifact Schema 2.1.0とPublic Decision Log
8. Session層、原子的Active保存、Checkpoint、hash、排他制御、分岐
9. Session CLIと`PLAY_WITH_AI.md`
10. Unit／Invariant／Round-trip／FoW／Browser／Portable Test
11. Seed Simulation、Build、Pages、Portable Package、Release検証
12. 本書を現行仕様へ反映し、実装・テスト・Helpとの整合を確認

Game CoreはPhaser／DOM／CLIから分離し、状態変更をGameAction → GameEngine経由に限定する。UI、Agent、Session CLIは同じLegal ActionsとCore validationを使用する。Session層はPrivate Stateの永続化を担当するが、ゲームルールを独自実装しない。

## 21. 完成条件

1. Version境界が本書の表と一致し、v1.4.0以前のSaveを状態不変で拒否する。
2. AIが1回答で完遂できなくても、同一Active Sessionを次回答から継続できる。
3. Actionごとの原子的保存、5完了TurnごとのCheckpoint、手動・最終Checkpointが機能する。
4. Public Decision LogとRun Artifactが不正Actionを含めて欠落・重複なく継続する。
5. Checkpoint分岐、排他制御、hash、Build一致、破損時の明示復旧が機能する。
6. Checkpoint復帰後もFog of Warと決定性を維持する。
7. Unit別軍需品の固定消費、戦闘・鎮圧消費、補充、撃破時喪失が確定Ruleどおり動く。
8. 州兵の距離2は軍需品2を必須とし、軍需品0の最低攻撃は距離1だけで機能する。
9. 軍需品0の駐留Unitは感染拡大を止めるが自動鎮圧しない。
10. 国家軍需不足は未補充分だけへ作用し、旧グローバル軍需状態が残らない。
11. Fuel 0でも警察3 MP、州兵2 MPのEmergency Movementと移動後Actionが機能する。
12. Observation、Legal Actions、UI、Help、Agent、Forecast、Replayが同じCore判定を使用する。
13. Session CLIの7コマンドとJSON入出力がPortable Packageで利用できる。
14. 全必須Test、固定Seed Simulation、Build、Pages、Portable Package検証が成功する。
15. 実装完了後、本書の変更が現行仕様へ漏れなく反映され、旧文書がarchiveへ整理される。
