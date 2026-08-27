# Balanced Agent 改善メモ — 「施設接触拒否」戦略の実装

## 目的

現在の Balanced Agent は Standard / seed 1 で早期敗北する一方、LLMによる手動プレイでは同一seedを大幅に延命でき、さらに「州兵の射程2・対ゾンビ確殺を利用し、味方インフラへの接触を徹底的に防ぐ」という戦略原則を明示した再試行では T30 生存勝利まで到達した。

本メモでは、この勝ち筋を Balanced Agent に落とし込むための改善方針を整理する。

---

## 1. 根拠となるプレイ結果

### 1.1 既存 Balanced Agent

Opusによるバッチ評価では Balanced Agent は以下の結果だった。

- Balanced 100戦: 0勝
- 生存ターン中央値: 9.5
- 平均生存ターン: 12.6
- 最長: 24
- 敗因: population 0 が 92%、state capital fall が 8%
- 300戦では生存ターン分布が二峰性
  - T5–6で死亡する群
  - T13以降まで生存する群
  - T7–12での死亡は0
- seed 1 は T5 で敗北

seed 1 の早期敗北では、farm-1への依存と感染による労働者消失により食料・民需品生産が停止し、資源不足死が発生していた。

### 1.2 Claude Opus low 手動プレイ

ユーザーから以下の攻略方針を事前に与えた状態で実施。

> 州兵は射程2でゾンビを確殺できる。これを利用し、味方インフラへの感染を徹底的に防ぐ。

結果:

- seed 1
- T27途中まで生存（ツール実行上限で中断）
- 施設8つすべて健在
- T1で farm-2 / farm-3 を確保
- 州兵の射程2を使って接触前にゾンビを排除
- 州都感染時は「ゾンビ排除 → 警察駐留 → 自動鎮圧」で復旧
- 軍需品枯渇時は軍需工場を確保し、州兵射程2を回復
- farm-1感染時は警察で鎮圧しつつ farm-2 を緊急稼働して食料不足を回避
- Hordeの増加に合わせて州兵2体目を生産

### 1.3 ChatGPT 手動プレイ — 方針を最上位ルールとして固定しない試行

同一 seed 1 を ChatGPT 一時実行環境で1手ずつプレイ。

結果:

- T30到達後、T30終了処理で `capitalLost`
- `resourceShortageLosses: 0`
- `infectionLosses: 80`
- 最終資源は food 460 / civilianGoods 311 / fuel 158 / militaryGoods 0

重要点:

- 早期の資源不足死は完全に回避できた
- 敗因は経済ではなく、前線で警察を消耗させた後に軍需工場への接触を許し、感染連鎖と軍需供給喪失が発生したこと
- Balancedの T5 敗北が不可避ではないことを確認

### 1.4 ChatGPT 手動プレイ — 「施設接触拒否」を最上位ルールとして再試行

同一 seed 1 で以下を明示的な最上位方針として再試行。

> 州兵の射程2・対ゾンビ確殺を利用し、味方インフラへのゾンビ接触を何よりも優先して防ぐ。警察は原則として感染鎮圧用に温存する。

結果:

- **T30生存勝利**
- outcome: `won`
- reason: `maxTurnsSurvived`
- `civilianLosses: 54`
- `infectionLosses: 24`
- `resourceShortageLosses: 30`
- `hordeInterceptions: 8`
- T21まで感染0を維持
- T29で初めて farm-1 に感染

この比較から、勝敗に強く寄与したのはモデル性能差だけではなく、**「施設への接触を最優先で防ぐ」という戦略知識を評価関数として持っていたかどうか**と考えられる。

---

## 2. 現在の Balanced Agent と勝ち筋のギャップ

対象: `src/agent/balancedAgent.ts`

### 2.1 施設接触リスクを直接評価していない

現在の `Move` 評価は主に以下。

- 最寄りゾンビへ近づく
- 感染施設へ近づく
- 未確保施設へ近づく
- Horde入口へ近づく

しかし、

> 「このゾンビが次ターンに味方施設へ接触可能か」

は評価していない。

そのため、単純に近いゾンビを追うだけで、**本当に止めるべき『施設接触直前のゾンビ』を後回しにできる。**

### 2.2 Attack が「接触阻止」を優先しない

現在の Attack は、

- Attack基本点
- 確殺ボーナス
- 低HP時の危険回避

が中心。

「この1撃で施設接触を防げる」「この敵は次ターン州都へ入る」といった対象価値がない。

州兵が射程2・対ゾンビ確殺である以上、**Attack対象の優先順位に施設接触リスクを入れることが最重要**と考えられる。

### 2.3 Horde対応が感染対応より優先される

`primaryGoal()` は現在、概ね以下の順。

1. avoid_defeat
2. defend_horde
3. suppress_infection
4. restore_economy

Hordeが近いと感染施設への対応より `defend_horde` が優先される。

しかし手動プレイでは、感染施設の放置は数ターンで施設陥落・生産停止・連鎖崩壊につながるため、**局所的なHorde迎撃より緊急度が高いケースがある。**

### 2.4 警察を温存する役割分担がない

現在、警察には感染鎮圧ボーナスがあるが、通常攻撃やMoveでも前線候補になる。

手動プレイでは、

- 州兵 = 接触拒否・殲滅
- 警察 = 感染鎮圧・後方救援

という役割分担が有効だった。

特にChatGPT初回敗北では、警察を前線戦闘で消耗したことが、その後の感染連鎖の大きな原因となった。

### 2.5 軍需品の閾値効果を事前評価していない

`facilityResourceValue('militaryFactory')` は `militarySupplyAvailable === false` になって初めて価値が上がる。

しかし実際には、

> 軍需不足 → 州兵射程2を喪失 → 接触拒否戦術が崩壊 → 感染リスク急増

という非線形な閾値効果がある。

したがって「供給が切れてから復旧」では遅く、**数ターン先の軍需消費まで見て閾値を割らないようにする必要がある。**

### 2.6 州都人口を敗北バッファとして見ていない

手動プレイでは州都人口が5〜11程度まで落ちた時、工場などから人口を戻して感染1〜2回分の緩衝を作った。

現行の TransferPopulation は主に overcrowding relief と Horde方向からの避難評価であり、

> 州都人口 = capitalLostに対する耐久値

という評価がない。

### 2.7 生産拠点の冗長性を評価していない

seed 1 では初期食料が farm-1 単独依存で、収支もほぼ均衡。

Claude / ChatGPTとも T1 で farm-2 / farm-3 を確保することで、farm-1停止時の代替生産を可能にした。

現行は「今不足している資源」を主に見るため、**平時のバックアップ施設確保の価値が低く見積もられる。**

### 2.8 1ターン先中心で、複合的な数ターン計画が弱い

`endTurnForecast` は使っているが、実際の勝ち筋では以下を同時に見る必要がある。

- 次Hordeまでのターン
- 軍需備蓄と将来消費
- 州兵増産後の軍需消費増
- 感染施設停止中の代替生産
- 州都人口の感染耐久

単純な1アクションスコアの積み上げでは、これらの相互作用を取りこぼしやすい。

---

## 3. Balanced Agent に追加すべき戦略原則

### P0: Facility Contact Denial（最優先）

味方施設へのゾンビ接触を、通常の「攻撃できる敵」より高い優先度で扱う。

#### 具体ルール

各ゾンビについて以下を算出する。

- 現在、味方施設上にいるか
- 次の敵行動で味方施設へ到達可能か
- 対象施設が州都か
- 対象施設が単一供給源か
- 対象施設が軍需工場か
- そのゾンビを今ターン州兵が確殺できるか

優先度例:

1. 州都へ次ターン接触可能
2. 稼働中の単一供給施設へ接触可能
3. military factoryへ接触可能
4. その他の味方施設へ接触可能
5. 施設から遠い通常ゾンビ

### P0: State Guard は接触拒否用火力として扱う

州兵の価値は単純な攻撃力ではなく、**射程2から反撃を受けずに接触前排除できること**にある。

- 州兵は「接触危険ゾンビ」を射程2から確殺する位置取りを最優先
- 接触危険がない場合のみHorde入口・未確保施設へ移動
- 低HP州兵は接触拒否が維持できる範囲で後退・回復

### P0: Police Preservation

警察は原則として通常戦闘へ投入しない。

通常攻撃は以下の場合のみ許可候補とする。

- 州都への接触をその攻撃以外では防げない
- 攻撃後も高確率で生存できる
- 他に感染施設がなく、直近に感染発生リスクも低い

それ以外は、

- 感染施設への移動
- 州都 / 重要施設近傍で待機
- 回復

を優先する。

### P0: Military Supply Reserve

`militarySupplyAvailable === false` をトリガーにするのではなく、**将来必要量に対する備蓄率**を見る。

例:

- 現在ユニット数に基づく次ターン軍需消費
- ProduceUnit後の新消費量
- 次Hordeまで2〜3ターン分の安全備蓄

最低目標:

> currentMilitaryGoods >= projectedConsumption * reserveTurns + productionCostBuffer

を下回る場合、militaryFactoryの確保・増員を高優先度にする。

### P1: Capital Population Buffer

州都人口に最低安全ラインを設定する。

例:

- infected == 0 の平時: 10〜15人
- Horde直前 / 周囲にゾンビあり: 15〜20人
- 州都感染中: 可能な限り即時補充

州都が安全ラインを下回ったら、民需品・食料など在庫に余裕のある施設から人口を戻す。

### P1: Production Redundancy

単一施設依存を検出する。

例:

- 食料生産の大半が1農場
- 軍需供給が1工場のみ
- 燃料供給が1製油所のみ

単一障害点がある場合、今の収支が黒字でもバックアップ施設確保に価値を与える。

### P1: Infection Recovery Plan

感染施設を単に `SuppressInfection` するだけでなく、

1. 接触中ゾンビを排除
2. 警察を投入
3. その施設の停止中に不足する資源を計算
4. 代替施設へ労働者を移す

までを1つのプランとして扱う。

---

## 4. 実装案

### 4.1 Threat map を追加

Observationから各ゾンビに `facilityThreatScore` を計算するヘルパーを追加する。

概念例:

```ts
interface ZombieThreat {
  zombieId: string;
  contactNextTurn: boolean;
  targetFacilityId?: string;
  targetFacilityType?: FacilityType;
  threatensCapital: boolean;
  threatensCriticalFacility: boolean;
  lethalByStateGuard: boolean;
  score: number;
}
```

### 4.2 Attack スコアへ施設防衛ボーナス

例:

```ts
if (targetThreat.contactNextTurn) score += 250;
if (targetThreat.threatensCapital) score += 400;
if (targetThreat.threatensCriticalFacility) score += 220;
if (attacker.type === 'stateGuard' && attacker.attack >= target.hp) score += 120;
```

数値は仮。既存100〜200点級の重みを超える必要がある。

### 4.3 Move スコアを「最寄り敵」から「射撃位置」へ変更

現状:

> zombieへ近づくほど加点

改善:

> 次ターン接触危険ゾンビを、州兵が射程2で攻撃可能になる位置へ移るほど加点

単純な距離短縮より、**攻撃可能かつ反撃距離外**を評価する。

### 4.4 警察の前線ペナルティ

警察が感染施設救援以外でゾンビへ近づく Move / Attack をする場合、強いペナルティを与える。

ただし州都即死回避などの非常時には解除する。

### 4.5 primaryGoal の見直し

単純な一列優先順位ではなく、少なくとも以下を最上位判定に追加する。

```text
avoid_defeat
prevent_facility_contact
rescue_critical_infection
defend_horde
restore_military_supply
restore_economy
...
```

特に `prevent_facility_contact` は Horde の有無に関係なく優先させる。

### 4.6 軍需の予測不足判定

`!militarySupplyAvailable` だけでなく、

```text
militaryGoods - projectedConsumption * N < reserveThreshold
```

を「潜在不足」として扱う。

ProduceUnit評価時には、新ユニットの維持費まで計算してから生産スコアを付ける。

### 4.7 州都安全人口の導入

TransferPopulation / AssignWorkers の評価に、州都人口バッファを追加する。

州都人口が閾値以下なら、他施設の追加生産より州都への人口回帰を優先する。

---

## 5. 検証計画

### Phase 1: seed 1 の回帰テスト

まず seed 1 を固定して、以下を確認する。

- T5資源不足死を回避できる
- T1〜5で farm-2 / farm-3 の少なくとも一方を確保する
- 州都感染時に警察を鎮圧へ回す
- 警察を通常前線で早期消耗させない
- militarySupplyAvailable を失う前に軍需を増産する
- T15以降まで感染0または低水準を維持する
- T30勝利可能性が出る

### Phase 2: 100 seed 比較

現行 Balanced vs 改善版で比較。

最低限見る指標:

- win rate
- median / mean survival turn
- T5–6死亡率
- T7–12の分布
- infectionLosses
- resourceShortageLosses
- capitalLost率
- facility contact / infection event数
- police losses
- state guard losses
- militarySupplyAvailable=false の発生ターン数
- secured facilities

### Phase 3: 300 seed 再評価

既存の二峰性がどう変化するか確認する。

特に重要なのは、単純な勝率だけではなく以下。

- T5–6の早期死亡群が縮小するか
- 0件だったT7–12に分布が現れるか
- T30到達が発生するか
- 早期感染イベント数が減るか

もし改善版でこれらが大きく変化するなら、従来の「感染係数が強すぎる」という解釈は弱まり、

> Balanced Agent がゲームの主要戦略を理解していなかった

という説明がより強くなる。

---

## 6. バランス調整への示唆

現時点では感染速度を弱める変更を先に行わない方がよい。

理由:

- 人間プレイでクリア実績がある
- Claude Opus low は勝ち筋提示後、seed 1でT27まで安定
- ChatGPTも同じ勝ち筋を最上位ルールとして再試行するとT30勝利
- 同一ChatGPTでも、方針を徹底しない試行はT30でcapitalLost

したがって、現在のデータは

> 感染が不可避に強すぎる

よりも

> 感染は非常に危険だが、施設接触拒否という戦略で予防可能

を支持している。

Balanced Agent を人間の基本攻略レベルまで引き上げた後で、改めて300+ seedを測定し、その結果を見てゲームバランス変更を判断するべき。

---

## 7. 推奨実装優先順位

### P0

1. `facilityThreatScore` / 接触予測の導入
2. State Guardの「射程2確殺による接触拒否」評価
3. Policeの前線投入抑制
4. 軍需備蓄の先読み

### P1

5. 州都人口バッファ
6. 生産施設の冗長性評価
7. 感染復旧時の代替生産計画

### P2

8. 2〜3ターン先の簡易lookahead
9. Horde方向に応じた防衛線形成
10. 交代要員を含むState Guardローテーション

---

## 結論

今回の手動プレイ比較から、Balanced Agent 改善の中心は「より賢く攻撃する」ことではなく、**ゲームの敗北連鎖を理解して予防すること**に置くべき。

中心となる因果関係は次の通り。

```text
ゾンビが施設へ接触
  ↓
感染発生
  ↓
生産停止・人口減少
  ↓
資源 / 軍需供給悪化
  ↓
州兵の射程2維持困難
  ↓
さらに接触を許す
  ↓
感染連鎖 / capitalLost
```

逆に勝ち筋は、

```text
州兵の射程2・確殺
  ↓
施設接触前に排除
  ↓
感染を発生させない
  ↓
生産基盤を維持
  ↓
軍需供給を維持
  ↓
次のHordeでも射程2接触拒否を継続
```

という正の循環である。

Balanced Agent v2 は、この循環を評価関数に直接埋め込むことを主眼とする。
