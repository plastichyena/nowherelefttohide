# Nowhere Left to Hide PoC v1.4.1 アップデート要件 ドラフト

作成日: 2026-09-01  
ステータス: Draft

## 1. 目的

v1.4.1では、ゲームルールそのものの大規模な再設計ではなく、以下の3点を中心に改善する。

1. AI Portable版における長時間プレイの継続性向上
2. 軍需品を「軍事ユニット保有による固定維持費」から「ユニットごとの携行軍需・戦闘消費」へ変更
3. 燃料切れユニットが完全に移動不能になる挙動を、最低限の緊急移動が可能な挙動へ変更

特にAI Portableについては、ChatGPT等のLLMが1回答内の計算資源・実行時間上限に達しても、同一セッション内でゲームを中断・再開し、最終的にゲームを完遂できることを主要目的とする。

本アップデートでもFog of Warの原則は維持する。AIが意思決定に利用できる情報は従来どおり公開ObservationおよびLegal Actionsのみとし、完全GameStateは再開用の非公開セーブデータとして扱う。

---

## 2. スコープ

### 2.1 本アップデートで変更する要素

- AI Portable向けセッション保存・再開
- 完全GameStateチェックポイント
- 公開Observation / Legal Actions / Action / 公開Eventの継続ログ
- 再開用メタ情報とハッシュ
- Run Artifactの途中状態保存と再開後の継続
- 軍需品のユニット別プール化
- 軍需品のターン固定消費量変更
- 戦闘距離に応じた軍需品消費
- 感染鎮圧時の軍需品消費
- 軍需品不足時の戦闘・鎮圧能力低下
- 補給網内での軍需品補充
- 燃料0時の最低移動保証
- Agent Observation / forecast / UI / Artifactへの新しいユニット資源情報の公開
- Balanced Agentの新ルール対応

### 2.2 原則変更しない要素

- Fog of War
- AIが意思決定に使える情報境界
- 既存の燃料通常消費ルール
- 補給網そのものの地理判定
- 警察・州兵の基礎HP
- 警察・州兵の基礎攻撃力
  - 警察: 5
  - 州兵: 10
- 警察・州兵の基礎射程
  - 警察: 1
  - 州兵: 2
- 警察・州兵の通常Movement
- 感染鎮圧の基礎値
  - 警察: 5
  - 州兵: 10
- ゲーム内の端数処理は、別途明記しない限り原則端数切り上げ

---

## 3. AI Portable向けセーブ・再開機能

### 3.1 背景

AI Portable版では、外部AI/LLMが公開AgentGameインターフェースを利用してゲームをプレイできる。

しかしLLM環境では、1回答に割り当てられた計算資源、ツール実行時間、コンテキスト長等に上限がある。そのためゲーム自体が継続可能でも、回答が先に終了し、ゲーム完遂前にセッション実行が途切れる場合がある。

v1.4.1では、1回の回答でゲームを最後まで実行することを必須とせず、複数回答にまたがって同一ゲームを安全に継続できることを目標とする。

### 3.2 Fair-play境界

AIの意思決定時に参照してよい情報は従来どおり以下のみとする。

- `getApiInfo()`
- 公開Observation
- Legal Actions
- 公開Step結果
- 公開Event
- 過去に自身が選択したActionおよび公開ログ

完全GameStateは再開のための保存データとしてのみ扱う。

AIプレイヤーは完全GameStateの内部を読み、隠れたゾンビ位置、非公開RNG状態、隠れたターゲット情報等を意思決定に利用してはならない。

セーブ機能を追加しても、AgentGameの「プレイヤーに見える世界」という意味を崩さないことを原則とする。

### 3.3 Session層

チェックポイント機能は、可能な限りAgentGameそのものではなく、その外側のAI Session / Portable Session層として実装する。

推奨構造:

```text
AI Session
  ├─ AgentGame
  │    ├─ getObservation
  │    ├─ getLegalActions
  │    └─ step
  ├─ Public Trace
  ├─ Run Artifact
  └─ Private Checkpoint State
```

これにより、公開Agent APIと完全GameState保存APIを分離する。

### 3.4 Active Session保存

ゲーム中は、成功したAction適用後に現在状態をActive Sessionとして保存できるようにする。

目的は、LLMの回答が予告なく終了した場合でも、最後に成功したActionの直後から再開できるようにすること。

Active Sessionは原則として最新状態1件を保持する。

### 3.5 定期Checkpoint

Active Sessionとは別に、履歴用Checkpointを作成できる。

初期推奨値:

- 5ターンごと
- 明示的な手動保存時
- 必要に応じてGame Over直前・直後

例:

```text
turn-005
turn-010
turn-015
```

5ターン間隔は初期既定値とし、将来的にCLIオプション等で変更可能な構造を許容する。

### 3.6 Checkpoint内容

Checkpointは少なくとも以下を保持する。

#### Private部分

- 完全GameState
- RNG state
- GameState内のイベント・各種IDカウンタ等、完全再開に必要な情報

既存Save Formatが完全GameStateを安全に保存・検証できる場合は、それを再利用する。

#### Public部分

- 現在の公開Observation
- それまでのaccepted Actions
- invalid attempts
- 公開Events
- Observation trace
- 外部AI向け判断ログ
- 現在までのRun Artifact情報

### 3.7 Checkpointメタ情報

各Checkpointは、GameState本体を読まなくても識別・検証できる公開メタ情報を持つ。

最低限含める候補:

- Checkpoint Schema Version
- App Version
- Game Rules Version
- Save Format Version
- Artifact Schema Version
- Agent API Version
- Observation API Version
- Build ID / Git Commit
- Map ID
- Seed
- Turn
- Phase
- Decision number
- 公開Config
- Checkpoint ID
- 完全Stateファイルのhash
- Public Traceのhash

完全Configに非公開情報が含まれる場合、公開メタ情報にはAgent向けPublic Configのみを使用する。

### 3.8 Hash

Checkpointの同一性・破損検出用にハッシュを保持する。

推奨:

- SHA-256

最低限:

- 完全GameState / Save payload hash
- 公開Trace hash

既存Save Format内部のchecksumは引き続き利用できるが、Checkpoint識別用途として別途SHA-256を持つことを許容する。

### 3.9 Public Decision Log

後からAIの判断を検証できるよう、ObservationとActionを対応付けた公開ログを保存する。

1 decisionにつき、少なくとも以下を保持する。

- decision number
- turn
- phase
- 公開Observation
- Legal Actions
- selected Action
- 短い判断理由 / decision summary
- Action適用後の公開Events
- errorの有無

判断理由はAIの非公開chain-of-thoughtを要求しない。

保存対象は、後から人間が「何を見て、どの合法手から何を選んだか」を確認できる短い公開説明とする。

### 3.10 ObservationとActionの対応

単純な`observationTrace[]`と`acceptedActions[]`の別配列だけでなく、レビュー用にはdecision単位で対応関係を保持できる形式を用意することが望ましい。

例:

```json
{
  "decision": 37,
  "turn": 12,
  "observation": {},
  "legalActions": [],
  "action": {},
  "decisionSummary": "...",
  "events": []
}
```

内部Artifact形式は必ずしもこのJSON形状に固定しないが、同等の監査可能性を満たすこと。

### 3.11 Run Artifact継続

GameStateだけをロードして再開した場合でも、ロード前後のプレイが同一Runとして扱われること。

再開時に以下を復元・継続する。

- initial observation
- accepted actions
- invalid attempts
- observation trace
- public events
- decision trace / external decision log
- agent ID
- seed
- config
- build ID

ロード後に新規ゲームとしてArtifact履歴が切断されてはならない。

### 3.12 Cache再構築

Checkpointロード後は、AgentGame / Adapter内部の以下のような派生cacheを破棄・再構築する。

- cached Observation
- cached Legal Actions
- checkpoint candidate projection等のstate依存cache

ロード前の派生値を再利用してはならない。

### 3.13 Portable CLI

AI Portable版に、セッションを明示的に操作できるCLIを追加する。

最低限の想定コマンド:

```text
save-checkpoint
load-checkpoint
```

AIが利用しやすい補助コマンド候補:

```text
status
step
artifact
list-checkpoints
```

`status`は1回の呼び出しで、少なくとも以下を返せることが望ましい。

- 現在の公開Observation
- 現在のLegal Actions
- Session metadata

これによりAI側のツール呼び出し回数を減らす。

### 3.14 ファイル配置例

```text
output/gpt-session-001/
├─ session.json
├─ trace.ndjson
├─ run.partial.json
├─ private/
│  └─ active.state.nlth
└─ checkpoints/
   ├─ turn-005.meta.json
   ├─ turn-005.state.nlth
   ├─ turn-005.run.json
   ├─ turn-010.meta.json
   ├─ turn-010.state.nlth
   └─ turn-010.run.json
```

具体的な拡張子・ファイル名は実装時に変更可能とする。

重要なのはPublic情報とPrivate GameStateの境界が明確であること。

### 3.15 再開フロー

例:

```text
Turn 1からプレイ
↓
Turn 5 checkpoint
↓
Turn 10 checkpoint
↓
Turn 14途中でLLM回答終了
↓
次回答でActive Sessionをロード
↓
現在の公開Observation / Legal Actionsを取得
↓
Turn 14から継続
↓
Game Over
↓
1本のRun Artifactとして確定
```

### 3.16 AI Portable文書

`PLAY_WITH_AI.md`に以下を追記する。

- Session / Checkpointの利用方法
- AIがprivate stateを意思決定のために読まないこと
- 回答終了前に可能ならcheckpointを保存する推奨フロー
- 回答が突然終了した場合のActive Sessionからの復帰方法
- Public Traceの確認方法

---

## 4. 軍需品システム変更

### 4.1 背景

現行仕様では、軍需品は軍事ユニットが存在するだけで人口ベースの固定維持費として毎ターン消費される。

v1.4.1ではこの方式を大幅に軽減し、燃料と同様に「国家備蓄から補給網を通じて各ユニットへ補充され、実際の活動によってユニットの携行プールから消費される」方式へ変更する。

狙いは以下。

- 軍隊を保有しているだけで大量の軍需品が消える状態を緩和
- 前線で戦闘を継続するユニットほど軍需補給を必要とする構造へ変更
- 補給網から離れた部隊が、携行備蓄を使いながら一定期間戦えるようにする
- 軍需品を単純な弾薬だけではなく、遠距離用高性能装備・弾薬・消耗品等を含む抽象資源として扱う

### 4.2 ユニット別軍需品プール

プレイヤー軍事ユニットは、個別の軍需品プールを持つ。

初期値:

| Unit | 最大軍需品プール |
|---|---:|
| 警察 | 5 |
| 州兵 | 20 |

状態例:

```text
currentMilitaryGoods
maxMilitaryGoods
```

名称は実装時に調整可能。

### 4.3 新規・初期ユニット

新規ゲーム開始時の既存プレイヤーユニットは、原則として軍需品プール満タンで開始する。

新規生産ユニットの初期プールおよびcommissioning時の補充順序は、燃料補充との整合性を保つ形で実装する。

詳細な同時補充順序はテストを踏まえて確定する。

### 4.4 毎ターン固定消費

毎ターンの軍需品固定消費を以下へ変更する。

| Unit | 毎ターン固定消費 |
|---|---:|
| 警察 | 0 |
| 州兵 | 1 |

固定消費はユニット自身の軍需品プールから差し引く。

プールが不足している場合、存在する分だけ消費して0とする。

### 4.5 固定消費不足時のペナルティ

毎ターン固定消費を満たせなかったこと自体による追加ペナルティは設けない。

例:

```text
州兵 currentMilitaryGoods = 0
↓
ターン固定消費1を満たせない
↓
0のまま
↓
追加の能力低下・HP低下・士気低下等は発生しない
```

能力への影響は、実際に戦闘・感染鎮圧等を行う際に必要軍需品を保有しているかどうかで判定する。

### 4.6 戦闘時の軍需品消費

実際に攻撃が発生した場合、攻撃側ユニットの軍需品プールを消費する。

対象:

- プレイヤーからの通常Attack
- counterattack
- interception等、プレイヤーユニットが実際に攻撃を発生させる戦闘

単に攻撃対象になっただけで、反撃が発生しない場合は消費しない。

### 4.7 警察の戦闘消費

警察:

- 射程: 1
- 通常攻撃1回: 軍需品1消費
- 最大プール: 5

### 4.8 州兵の射程連動消費

州兵は、実際に戦闘が発生したHex距離に応じて軍需品を消費する。

| 実戦闘距離 | 軍需品消費 |
|---|---:|
| 射程1 | 1 |
| 射程2 | 2 |

これは軍需品を抽象資源として扱い、遠距離戦闘では高性能な遠距離用装備・弾薬等を追加消費することを表現する。

例:

```text
州兵 currentMilitaryGoods = 1
敵まで距離1
→ 通常攻撃可能
→ 1消費

州兵 currentMilitaryGoods = 1
敵まで距離2
→ 射程2通常攻撃に必要な軍需品2を満たさない
```

### 4.9 将来ユニットへの拡張

ユニットごとに攻撃時の軍需品消費方式を変更できる構造を用意する。

推奨概念:

```text
attackMilitaryGoodsCostByRange
```

例:

```json
{
  "1": 1,
  "2": 2
}
```

Config validationでは、対象ユニットの攻撃可能距離に必要な軍需品コスト定義が矛盾しないことを検証する。

将来、射程3以上のユニット、近距離主体ユニット、重火器ユニット等を追加してもCore戦闘ロジックを大きく変更せず設定可能な構造を目指す。

### 4.10 軍需品不足時の攻撃

必要軍需品プールを持たない場合、攻撃力は通常攻撃力の1/5とする。

端数は切り上げる。

初期値:

| Unit | 通常攻撃力 | 軍需不足攻撃力 |
|---|---:|---:|
| 警察 | 5 | 1 |
| 州兵 | 10 | 2 |

軍需品0は「完全に武器が存在しない」ことではなく、正規の戦闘能力を維持できるだけの高品質な軍需品・弾薬・装備が不足している状態として扱う。

### 4.11 州兵の部分残量と射程

州兵については、通常戦闘に必要な軍需品量を実戦闘距離で判定する。

- 軍需品1以上: 射程1で通常攻撃可能
- 軍需品2以上: 射程2で通常攻撃可能
- 軍需品0: 軍需不足状態

軍需品1で射程2通常攻撃は行えない。

この場合に射程2から軍需不足攻撃を許可するかどうかは、v1.4.1実装ドラフト時点では「通常射程2攻撃に必要量を満たさないため正規の射程2攻撃は不可」を基本とする。

軍需品0時の1/5攻撃については、基本射程内での最低戦闘能力として扱う。

※上記の「残量1で射程2に対して1/5攻撃を許可するか」は、実装時にAction legalityとUIの一貫性を確認し、必要なら最終仕様で明示する。

### 4.12 感染鎮圧時の軍需品消費

施設・検問所の感染者自動鎮圧が実際に発生した場合、軍需品を消費する。

| Unit | 通常鎮圧 | 必要軍需品 |
|---|---:|---:|
| 警察 | 5 | 1 |
| 州兵 | 10 | 2 |

### 4.13 軍需品不足時の感染鎮圧

必要軍需品を保有していない場合、感染鎮圧力も通常値の1/5とする。

端数切り上げ。

| Unit | 通常鎮圧 | 軍需不足時 |
|---|---:|---:|
| 警察 | 5 | 1 |
| 州兵 | 10 | 2 |

既存の警察は民間人被害なし、州兵は民間人被害が発生しうる、という基本的な鎮圧特性は維持する。

軍需不足時の州兵による民間人被害計算については、実際に適用された縮小後鎮圧力を基準にすることを第一候補とするが、最終値は実装時に既存計算との整合性を確認する。

### 4.14 軍需品補充

ユニットの軍需品補充条件は燃料と同様に補給網を利用する。

補充対象:

- プレイヤーユニット
- 補給網内に存在
- `currentMilitaryGoods < maxMilitaryGoods`

補給網外にいるユニットは国家軍需品備蓄から補充を受けない。

### 4.15 補充元

補充元は国家資源の`militaryGoods`とする。

国家備蓄からユニットプールへ移した量だけ、国家軍需品備蓄を減少させる。

### 4.16 補充配分

複数ユニットが同時に補充を要求し、国家備蓄が不足する場合、燃料と同様に決定論的な配分方式を使用する。

第一候補:

- Unit ID順
- 1単位ずつラウンドロビン

燃料と軍需品で同じ補充規則を共有できる構造を推奨する。

### 4.17 Economy Forecast

現行の人口ベース軍需品maintenance forecastを廃止・置換する。

新しいForecastでは少なくとも以下を区別する。

- starting militaryGoods stock
- projected militaryGoods production
- unit fixed upkeep demand
- unit refill demand
- projected unit refill allocation
- projected ending stock
- shortage / unfilled refill demand

戦闘・鎮圧はプレイヤーの将来Actionや敵行動に依存するため、End Turn時点ですでに確定している消費のみをforecastに含める。

### 4.18 `militarySupplyAvailable`の扱い

現行のグローバルな`militarySupplyAvailable`不足状態によって州兵の射程を一律2から1へ低下させる方式は、新しいユニット別軍需品プールと役割が重複する。

v1.4.1では、軍需能力低下を原則としてユニット自身の軍需品プールで判定する方向とする。

したがって旧`militarySupplyAvailable`による州兵射程低下は削除または互換用派生値への変更を検討する。

最終的なAPI互換性については実装時に確定する。

---

## 5. 燃料0時の最低移動保証

### 5.1 背景

現行仕様では、プレイヤーユニットのFuelが0になると、Fuelを必要とする全MoveがLegal Actionsから除外され、ユニットは移動不能になる。

一方で、燃料0でも攻撃、反撃、Wait、感染鎮圧等は可能である。

v1.4.1では、Fuelが0でも最低限の緊急移動を認める。

### 5.2 基本ルール

Fuelが1以上ある場合:

- 従来の燃料消費ルールを使用する

Fuelが0の場合:

- 通常のFuel消費Moveではなく、ユニット固有の最低移動保証を使用する
- Fuelは0のまま
- マイナスFuelは許可しない

### 5.3 最低移動保証値

初期値:

| Unit | Fuel 0時の最低移動力 |
|---|---:|
| 警察 | 3 MP |
| 州兵 | 2 MP |

平地・道路等の移動コスト1のHexだけを移動する場合:

- 警察: 最大3 Hex
- 州兵: 最大2 Hex

### 5.4 地形コスト

最低移動保証はHex数固定ではなく、既存のeffective movement costを使用したMovement Point制とする。

例:

警察、Fuel 0、最低移動力3:

- Plain 1 + Plain 1 + Plain 1 → 3 Hex
- Forest 2 + Plain 1 → 2 Hex
- Mountain 3 → 1 Hex

州兵、Fuel 0、最低移動力2:

- Plain 1 + Plain 1 → 2 Hex
- Forest 2 → 1 Hex
- Mountain 3 → 移動不可

道路・Urban等、既存ルールでeffective movement costが1になるHexは1 MPとして扱う。

### 5.5 Emergency Movement

実装上は、Fuel 0時の移動を通常Fuel移動の特殊ケースとして曖昧に処理せず、概念的にはEmergency Movementとして扱う。

例:

```text
currentFuel > 0
→ 通常Movement / Fuel Cost

currentFuel == 0
→ emergencyMovementPointsを上限としてMove
→ Fuelは0のまま
```

Action Typeを新設するか、既存Moveの内部ルールとして処理するかは実装時に決定する。

公開Legal Actionsから見て、プレイヤーが実行可能な移動先が正しく列挙されることを優先する。

### 5.6 Interception

Emergency Movement中も通常Moveと同様に、敵との接触、隠れた敵による移動停止、interception等の既存ルールを適用する。

Fuel 0であることを理由に戦闘解決規則を変更しない。

### 5.7 Fuel補充

Emergency Movementを行ってもFuelは0のまま。

End Turn後、補給網内におり国家Fuel備蓄が利用可能なら、既存ルールに従って補充される。

補給網外ではFuel 0のまま次ターンもEmergency Movementのみ可能。

### 5.8 Observation / UI

AIおよび人間プレイヤーが、Fuel 0でも移動可能であることを再構築せず理解できるようにする。

Observation候補:

- `emergencyMovementPoints`
- `usingEmergencyMovement`
- legal Moveごとの`fuelCost = 0`
- legal Moveごとの移動モード

UIではFuel 0のユニットが完全移動不能に見えないよう、Emergency Move可能範囲を通常の移動範囲と同様に表示する。

---

## 6. Agent Observation変更

### 6.1 軍需品

プレイヤーユニットObservationに、少なくとも以下を公開する。

- currentMilitaryGoods
- maxMilitaryGoods
- fixedMilitaryGoodsUpkeepPerTurn
- attackMilitaryGoodsCostByRange
- suppressionMilitaryGoodsCost
- 現在の軍需不足状態
- legal attackごとの軍需品必要量
- legal attack実行後の予想残量
- 軍需不足時のeffective attack
- projected refill demand
- projected refill amount

### 6.2 Fuel 0移動

以下を公開する。

- emergencyMovementPoints
- Fuel 0時にEmergency Movementが利用可能か
- legal MoveごとのFuel消費
- legal Moveごとの移動モード

### 6.3 Forecast

AIが国家備蓄から各ユニットへの軍需補充を予測できるよう、End Turn Forecastにユニット単位の軍需補充予定を含める。

隠れた敵行動による将来戦闘消費はforecastしない。

---

## 7. Human UI変更

### 7.1 ユニット情報

警察・州兵の詳細表示に以下を追加する。

- 現在軍需品 / 最大軍需品
- 攻撃時軍需消費
- 感染鎮圧時軍需消費
- 軍需不足時の攻撃力
- Fuel 0時最低移動力

### 7.2 Attack UI

Attack候補に、必要に応じて以下を表示する。

- 対象までの距離
- 必要軍需品
- 攻撃後の軍需品残量
- 軍需不足により攻撃力が低下する場合の警告

特に州兵は距離1と距離2で消費量が異なるため、攻撃前に確認可能にする。

### 7.3 Forecast UI

軍需品の表示を「軍隊人口による毎ターン固定大量消費」から、以下が分かる形へ変更する。

- 国家備蓄
- 今ターンの生産
- 州兵固定消費
- 補給対象ユニットの需要
- 予想補充分
- End Turn後の国家備蓄

---

## 8. Balanced Agent対応

Balanced Agentは新しい軍需品・燃料ルールをObservationだけから判断する。

最低限以下へ対応する。

### 8.1 軍需品

- ユニットごとの現在軍需品を評価
- 州兵の距離1/距離2攻撃コスト差を評価
- 軍需品残量が少ない場合、必要以上に遠距離攻撃を浪費しない
- 軍需不足による1/5攻撃を評価
- 感染鎮圧に必要な軍需品を確保
- 補給外へ進出する際、携行軍需品残量を考慮
- 軍需工場確保・労働者配置の価値評価を新Forecastへ更新

### 8.2 Fuel 0

- Fuel 0を完全移動不能と誤認しない
- Emergency Movement範囲をLegal Actionsから利用
- 補給網への帰還が可能なら最低移動を利用して帰還を試みる
- Fuel 1以上の通常移動との差を評価

### 8.3 AI Portable

Built-in Balanced Agent runner自体は1回答制限を受けないが、新しいSession / Artifact仕様との互換性を保つ。

---

## 9. Save Format / Versioning

### 9.1 GameState追加

軍需品プールおよび関連するユニット状態がGameStateに追加されるため、Save Formatとの互換性確認が必要。

追加候補:

- UnitState.currentMilitaryGoods
- UnitState.maxMilitaryGoods

Emergency Movementが純粋にConfigとcurrentFuelから導出可能なら、追加の永続stateは不要とする。

### 9.2 Save Format Version

既存Save Formatで新しいGameState shapeをそのまま受け入れられない場合、Save Format Versionを更新する。

旧v1.4.0 Saveをv1.4.1で読み込むかどうかは、既存の互換性方針に従い最終仕様で決定する。

### 9.3 Checkpoint Schema

AI Portable Session用として、通常Save Formatとは別にCheckpoint Schema Versionを新設することを推奨する。

初期候補:

```text
Checkpoint Schema 1.0.0
```

---

## 10. API / Artifact Versioning

### 10.1 Agent API

AgentGame本体にCheckpoint用メソッドを追加せずSession層に分離する場合、AgentGameのメソッド集合を維持できる。

ただしUnit Observation、Forecast、Config schema等の公開構造が変更されるため、既存のSemantic Versioning方針に従ってAgent / Observation APIの更新要否を判断する。

### 10.2 Artifact

Decision単位のPublic Traceを正式なRun Artifactに追加する場合、Artifact Schemaのminor updateを検討する。

例:

```text
2.0.0 → 2.1.0
```

具体的なversion値は実装完了時に確定する。

---

## 11. テスト要件

### 11.1 AI Session round-trip

同一Seed・同一Config・同一Action列で以下を比較する。

A:

- セーブ・ロードなしで連続実行

B:

- 指定TurnでCheckpoint保存
- プロセス終了
- Checkpointロード
- 同一Action列を継続

以下が一致すること。

- Public Observation
- Legal Actions
- 公開Events
- RNG結果
- 最終Result
- 最終GameState hash

### 11.2 Artifact継続

Checkpointロード前後でRun Artifactが1本の履歴として継続すること。

- acceptedActionsが欠落しない
- observation traceが欠落しない
- decision numberingが重複しない
- public eventsが欠落・重複しない

### 11.3 FoW漏洩

Public Session metadata / trace / artifactに以下が漏洩しないこと。

- 非可視ゾンビ座標
- 非可視敵ID
- hidden target memory
- private RNG state
- 非公開Noise半径・hidden reaction count等

Private checkpointには完全GameStateを保存してよい。

### 11.4 Hash破損

- Stateファイル改変
- meta改変
- trace改変

を検出し、不整合なCheckpointを安全に拒否できること。

### 11.5 軍需品プール

警察:

- 最大5
- 固定消費0
- 通常戦闘1回で1消費
- 鎮圧1回で1消費

州兵:

- 最大20
- 固定消費1
- 距離1戦闘で1消費
- 距離2戦闘で2消費
- 鎮圧1回で2消費

### 11.6 軍需不足戦闘

- 警察軍需0 → 攻撃力1
- 州兵軍需0 → 攻撃力2
- terrain defense適用時も、まず軍需不足によるbase attackを決定した後、既存terrain damage計算へ渡す

### 11.7 軍需不足鎮圧

- 警察軍需不足 → 鎮圧1
- 州兵軍需不足 → 鎮圧2
- 州兵の民間人被害が最終仕様どおり計算される

### 11.8 反撃・迎撃

- プレイヤーユニットが実際に反撃した場合のみ軍需消費
- 実距離に応じた消費
- 攻撃前にユニットが破壊された場合等、不成立戦闘で誤消費しない

### 11.9 軍需補充

- 補給内のみ補充
- 補給外は補充なし
- 国家備蓄を超えて補充しない
- 最大プールを超えない
- 複数ユニット時に決定論的
- forecastと実処理が一致

### 11.10 固定消費不足

州兵の軍需品が0の場合:

- 固定消費を満たせなくても追加ペナルティなし
- HP低下なし
- 追加Action制限なし
- 実戦闘・鎮圧時のみ軍需不足ルールを適用

### 11.11 Fuel 0 Emergency Movement

警察:

- Plainのみなら3 Hexまで
- 3 MPを超える経路は不可

州兵:

- Plainのみなら2 Hexまで
- 2 MPを超える経路は不可

地形:

- Forest / Mountain / Road / Urbanの既存effective costを使用

共通:

- Fuelは0のまま
- interception等は通常どおり
- 補給内ならEnd Turn後にFuel補充可能
- 補給外なら次ターンもEmergency Movement可能

### 11.12 Agent Observation

Agentが内部GameStateを読まず、公開ObservationとLegal Actionsだけで以下を判断できること。

- 攻撃に必要な軍需品
- 攻撃後の残量
- 軍需不足攻撃力
- 鎮圧時消費
- End Turn時の補充見込み
- Fuel 0時の移動可能範囲

---

## 12. 実装順序案

1. UnitConfig / UnitStateへ軍需品プール定義を追加
2. Save validation / invariants対応
3. 戦闘時軍需品消費
4. 射程距離別軍需品コスト
5. 軍需不足攻撃力
6. 感染鎮圧軍需品消費・不足時効果
7. 州兵固定消費
8. 国家軍需品からのユニット補充
9. Economy Forecast再構築
10. Fuel 0 Emergency Movement
11. Observation / Legal Action preview更新
12. Human UI更新
13. Balanced Agent更新
14. Run Artifact / Public Decision Log拡張
15. AI Session / Active State / Checkpoint実装
16. Portable CLI追加
17. `PLAY_WITH_AI.md`更新
18. round-trip / FoW / regression test
19. バッチシミュレーションとバランス再評価

AI Portable SessionはGame Rulesから比較的独立しているため、実装上は軍需・Fuel変更と並行作業してもよい。

---

## 13. バランス上の想定効果

### 13.1 軍需品

現行の軍需品システムでは、警察・州兵を保有しているだけで軍需品が大量に失われる。

新方式では、平時消費を大幅に減らし、戦闘頻度が高い前線ほど補給負荷が高くなる。

これにより軍需工場の役割は、単純な「軍隊保有税を払い続ける施設」から「継戦能力を維持する兵站施設」へ変化する。

### 13.2 補給外行動

補給外へ進出した部隊は即座に弱体化せず、携行Fuel・軍需品を消費しながら活動を継続できる。

ただし補充を受けられないため、長期間孤立すると機動力・戦闘能力が低下する。

### 13.3 Fuel 0

Fuel切れは完全停止ではなく、大幅な機動力低下として作用する。

軍需品不足も完全攻撃不能ではなく、大幅な戦闘能力低下として作用する。

したがってv1.4.1では、兵站不足を以下の共通思想で扱う。

```text
Fuel不足
→ 最低限は移動可能
→ 正常な機動力を失う

Military Goods不足
→ 最低限は戦闘・鎮圧可能
→ 正常な戦闘能力を失う
```

### 13.4 州兵の射程2

州兵の射程2は引き続き重要な戦術的強みだが、距離2射撃は距離1より多くの軍需品を消費する。

これにより、射程2から常に無条件で攻撃するだけではなく、

- 遠距離で接触を阻止する価値
- 軍需品を節約して距離1まで引き付ける価値
- 補給状況
- Horde接近
- 施設防衛の緊急度

を比較する余地が生まれる。

---

## 14. 未確定事項

本ドラフト時点で、以下は実装またはテスト結果を踏まえて最終確定する。

1. 軍需品1の州兵が距離2に対し「1/5遠距離攻撃」を行えるか、Action自体を不可とするか
2. 軍需不足状態の州兵感染鎮圧における民間人被害計算の基準
3. 新規生産ユニットの軍需品commissioning補充順序
4. FuelとMilitary Goodsの補充順序を同一Economy phase内でどう整理するか
5. `militarySupplyAvailable`フィールドを削除するか、互換用派生値として残すか
6. Save Format Version更新値
7. Agent / Observation / Artifact APIの具体的なversion値
8. Checkpointファイル拡張子とCLIの正式名称
9. Checkpoint既定間隔を固定5ターンとするか設定可能とするか
10. Public Decision LogをRun Artifact本体へ統合するか、Session traceとして独立させるか

---

## 15. 成功条件

- ChatGPT等のAIが、1回答で完遂できなくても同一ゲームを次回答から継続できる
- Checkpointロード後もFoW情報境界が維持される
- ロード前後のゲーム進行が決定論的に一致する
- Run Artifactが複数回答をまたいでも1本のプレイ履歴として成立する
- 警察保有だけでは毎ターン軍需品を消費しない
- 州兵の平時固定軍需消費が1/Turnになる
- 実際の戦闘・鎮圧によってユニット軍需品が消費される
- 州兵の射程2攻撃が射程1より高い軍需コストを持つ
- 補給網内の部隊だけが国家備蓄から軍需補充を受ける
- 軍需不足でも完全攻撃不能にはならず、規定の1/5能力が機能する
- 州兵固定消費不足だけでは追加ペナルティが発生しない
- Fuel 0でも警察3 MP、州兵2 MPの最低移動が可能
- Emergency Movementが既存地形コスト・interception・FoWを破らない
- Human UIとAgent Observationの双方から新しい兵站状態を再構築せず判断できる
- Balanced Agentが新ルールで合法かつ合理的に行動できる
- 回帰テストおよびAI Portable round-trip testが通過する
