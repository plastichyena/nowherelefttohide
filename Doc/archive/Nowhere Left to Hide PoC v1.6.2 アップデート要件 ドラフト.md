# Nowhere Left to Hide PoC v1.6.2 アップデート要件 ドラフト

- ステータス: **ドラフト要件。ゲーム実装・リリースは未完了。**
- 作成日: 2026-09-16
- 基準: v1.6.1 / commit `c311acc4bc654da06169ee793dfff3100dc9ac46`
- 根拠: 依頼者のv1.6.2要望、Claude Opus 5による2026-09-15 v1.6.1プレイテスト、現行v1.6.1実装・GitHub Actionsログ
- 本書はv1.6系の修正・初期条件再調整・AI/Session品質改善を目的とする。v1.7で予定しているRandom Map、Vehicles / aircraft等は前倒ししない。

本書ではClaudeの指摘を、(A)実装修正が必要な不具合、(B)公開情報または説明不足、(C)バランス上の構造問題、(D)プレイヤー／Agent側の戦術上の教訓、に分ける。DまでCoreルールで自動救済してゲーム性を変えることはしない。一方、A〜Cは可能な限りv1.6.2で解消する。

---

## 1. 目的

v1.6.2はv1.6.1の大型機能を作り直す版ではなく、実プレイで露呈した初期展開の弱さ、Checkpoint導入コスト、Temporary Housingの過密、Strict screeningの処理不足、AI向けSession/APIの不整合、長時間AIプレイ時の起動コスト、AI PortableのWindows CI失敗をまとめて直す修正版とする。

主目的:

1. 4方向の初期Checkpointと初期Supply圏内施設を最初からPlayer管理下に置き、序盤の行政負担を軽減する。
2. 初期人口・Unit・資源を増やし、v1.6.1の高い感染・資源・特殊Zombie圧に対して序盤の選択肢を増やす。
3. Temporary HousingをHard Cap化し、意図しない過密ペナルティの温床にしない。
4. 初期Zombie 50体の一部を特殊Zombieへ置換し、開始時から特殊個体への対応を要求する。
5. Claudeプレイテストで確認されたPreview入力検証、construction query、重要施設の人員減少可視性、finite-plan停止条件の弱点を修正する。
6. Checkout上の通常Session実行から`vite-node`の毎コマンド起動を外し、70 Turn級の外部AIプレイに耐える実行経路へ寄せる。
7. v1.6.1 AI Portable Windows失敗の直接原因である速度依存テストを修正し、Linux / Windows両Artifactの生成まで検証する。

既存のGameAction → GameEngine境界、Seed付き決定性、Fog of War、公開情報境界、Replay／Artifact再現性の原則は維持する。

### 1.1 非対象

- Random Map本体
- Vehicles / aircraft
- custom scenario本体
- Zombie AI全体の優先順位再設計
- Final Wave後の勝利条件変更
- Live AI Viewerそのものの再設計
- v1.6.1以前のSave / Replay / Session / Checkpoint / Artifact移行
- Claudeの戦術ミスを自動で防ぐ「自動駐屯」「自動人口抑制」等のCore介入

---

## 2. 要求一覧

| ID | 内容 | 扱い |
| --- | --- | --- |
| INIT-CP-01 | North / East / South / West各Branchの初期Supply限界点へ1基ずつ、計4基のCheckpointを初期配置 | 必須 |
| INIT-CP-02 | 初期CheckpointのPolicyは`normal`、4基すべてActive / Operational | 必須 |
| MAP-01 | 幹線道路上で初期Supply限界点にある恒久FacilityをCapital側へ1 Hex移動 | 必須 |
| INIT-FAC-01 | 初期Supply内の恒久中立Facilityを開始時Player所有へ変更 | 必須 |
| CP-COST-01 | 初回Checkpoint格安建設を廃止し、全BuildCheckpointを現行RelocateCheckpointと同額に統一 | 必須 |
| INIT-POP-01 | 初期市民を現行値+10人 | 必須 |
| INIT-UNIT-01 | 初期Player UnitをPolice 4 / Riot Police 1 / Recon Team 1 / National Guard 1へ変更 | 必須 |
| INIT-RES-01 | Food / Civilian Goods / Military Goods / Fuelを現行値+100 | 必須 |
| HOUSE-01 | Temporary HousingをSoft CapからHard Capへ変更 | 必須 |
| INIT-Z-01 | 初期Zombie 50体のうち10体をGas 4 / Hunter 4 / Screamer 2へ置換 | 必須 |
| INIT-Z-02 | 上記特殊ZombieはArmy Baseを初期Vision内に収めない | 必須 |
| REF-01 | Strict screeningの構造的処理不足を緩和 | 必須 |
| OBS-01 | 所有Facilityの健康人口減少と生産低下をImportant Changesから見落としにくくする | 必須 |
| API-01 | Preview / Step / Play-turnで同じGameAction構造検証を使う | 必須 |
| API-02 | `ok:true`と`accepted:false`の意味をHelp/API schemaで明確化 | 必須 |
| API-03 | `query construction`でCheckpoint候補を正しくfilter可能にする | 必須 |
| API-04 | finite-planに意図したCrisis変化の限定的allowlistを追加 | 必須 |
| DOC-01 | v1.6.1で確認されたpin / Unit action順序 / infection制約等をAI向けHelpへ明記 | 必須 |
| AGENT-01 | Built-in Balanced Agentが重要施設防衛・感染抑制・資源runwayを優先判断できるよう更新 | 必須 |
| PERF-01 | 通常の`npm run session`から毎回の`vite-node`起動を除去 | 必須 |
| PERF-02 | `vite-node`直実行は開発用別commandとして残す | 必須 |
| CI-01 | v1.6.1 AI Portable Windows失敗の速度依存テストを修正 | 必須 |
| CI-02 | Linux / Windows両Portable packageとevidence Artifactの生成をRelease Gate化 | 必須 |
| COMPAT-01 | v1.6.1以前のSave / Replay / Session / Checkpoint / Artifact互換を提供しない | 必須 |

---

## 3. 初期Map / Supply / Checkpoint

### 3.1 初期Checkpoint — INIT-CP-01..02

`checkpoint.initialSupplyRadius = 5`は維持する。Capital `(25,25)`を中心として、4本の幹線Branch上の距離5 Hexへ以下の4基を最初から配置する。

| ID | Branch | Position | Policy | Status | Role |
| --- | --- | --- | --- | --- | --- |
| `checkpoint-1` | north | `(25,20)` | `normal` | `operational` | `active` |
| `checkpoint-2` | east | `(30,25)` | `normal` | `operational` | `active` |
| `checkpoint-3` | south | `(25,30)` | `normal` | `operational` | `active` |
| `checkpoint-4` | west | `(20,25)` | `normal` | `operational` | `active` |

初期状態は以下で固定する。

- waiting / screening / approved / infected = 0。
- 各`roadBranches[].activeCheckpointId`は上記IDを参照する。
- 各Branchの`currentPolicy`も`normal`。
- 初期4基はプレイヤーActionによる「建設」ではないため、建設費を消費しない。
- 初期4基は`statistics.checkpointsBuilt`へ加算しない。
- `nextCheckpointNumber = 5`から開始する。
- CheckpointがCapitalから距離5にあるため、開始時Supply Radiusは従来どおり5であり、**初期CheckpointだけではSupplyを6以上へ拡張しない**。
- 4基とも開始時点でBranchをmanagedにする。
- 既存のstandby / dormant / fallback機構はそのまま利用する。

### 3.2 初期Supply限界上のFacility移動 — MAP-01

現行固定MapでCapitalから距離5かつNorth幹線上にある`city-1`を、Checkpointとの衝突を避けるためCapital側へ1 Hex移動する。

```text
v1.6.1: city-1 = (25,20)
v1.6.2: city-1 = (25,21)
```

他の恒久Facilityは「幹線道路上かつ距離5」を同時に満たさないため、この要件による移動対象は`city-1`のみとする。

この変更によりMap IDを更新する。Terrain / Road接続生成、Strategic Map、Route Query、Facility tile参照も新座標を正本として再生成する。

### 3.3 初期Supply内FacilityのPlayer所有化 — INIT-FAC-01

MAP-01適用後、ゲーム開始時にCapitalから距離5以内にあり、v1.6.1では中立だった恒久FacilityをPlayer所有として開始する。

現行固定Mapでは対象を次の2施設に確定する。

- `city-1` `(25,21)`
- `military-factory-1` `(21,25)`

扱い:

- `owner = player`, `status = owned`として開始する。
- Neutral Survivor抽選の対象から除外する。
- v1.6.1で当該Facilityに設定されている開始Workerが0なら0のまま開始する。所有化を理由にランダムSurvivorを追加しない。
- `firstCaptureRewardClaimed = true`相当として扱い、ゲーム開始後に初回確保資源報酬やSurvivor救出報酬を二重取得できない。
- `securedOrder` / assignment順序は他の初期Player Facilityと同じ初期化規則へ統合する。
- この変更以外の初期Supply外中立Facilityはv1.6.1のSurvivor仕様を維持する。

---

## 4. 初期人口・Unit・資源

### 4.1 初期市民 +10 — INIT-POP-01

現行v1.6.1の初期Player健康市民100人に対し、**固定で+10人**する。追加10人はCapitalへ配置する。

```text
capital workers: 41 -> 51
farm-1: 23 (据え置き)
civilian-factory-1: 23 (据え置き)
refinery-1: 10 (据え置き)
power-plant-1: 3 (据え置き)
その他の初期所有Facility: 0 unless separately configured
```

したがってUnit人口を除く開始時Player健康市民は110人とする。INIT-FAC-01で新たに所有化された`city-1` / `military-factory-1`へ追加人口を自動配分しない。

### 4.2 初期Player Unit — INIT-UNIT-01

開始時Unitを以下に固定する。Proficiencyは全て`regular`とし、Fuel / Military Goodsは各UnitのMaxまで補充済みとする。

| Unit | Count |
| --- | ---: |
| Police | 4 |
| Riot Police | 1 |
| Recon Team | 1 |
| National Guard | 1 |

固定初期位置:

| ID | Type | Position |
| --- | --- | --- |
| `police-1` | Police | `(24,25)` |
| `police-2` | Police | `(25,24)` |
| `police-3` | Police | `(25,26)` |
| `police-4` | Police | `(24,26)` |
| `riot-police-1` | Riot Police | `(24,24)` |
| `recon-team-1` | Recon Team | `(26,26)` |
| `national-guard-1` | National Guard | `(26,25)` |

要件:

- 全Unitが互いに異なる合法Hexへ配置される。
- Facility / Checkpoint / 初期Zombieと重複しない。
- 初期Zombie placementは7 Unitの全位置を占有禁止として扱う。
- 初期配置だけで中立Facilityを自動確保する副作用を作らない。
- `nextUnitNumber`等のID発行は上記IDと衝突しない値から開始する。

### 4.3 初期資源 +100 — INIT-RES-01

v1.6.1の現行値へ各+100する。

| Resource | v1.6.1 | v1.6.2 |
| --- | ---: | ---: |
| Food | 230 | **330** |
| Civilian Goods | 255 | **355** |
| Military Goods | 75 | **175** |
| Fuel | 92 | **192** |

Electricityは在庫資源ではないため対象外とする。

---

## 5. 初期Zombie再構成

### 5.1 「50体のうち10体を置換」の定義 — INIT-Z-01

v1.6.1実装では`initialZombieCount = 50`のNormal Zombieに加え、Hunter 1..4体とGas 1..2体を別枠で追加している。v1.6.2では依頼の「初期配置Zombieのうち10体を置換」を曖昧にしないため、**開始時Zombie総数を50体に固定**し、別枠追加方式を廃止する。

開始時構成:

| Type | Count |
| --- | ---: |
| Normal Zombie | **40** |
| Gas Zombie | **4** |
| Hunter Zombie | **4** |
| Screamer Zombie | **2** |
| Total | **50** |

- v1.6.1の`initialHunterCount 1..4`、`initialGasCount 1..2`による開始時追加抽選はv1.6.2既定Game Rulesでは使用しない。
- Configで別シナリオを作る場合の拡張可能性は残してよいが、既定値は上表を正本とする。
- 同Seed / Map / Configで各初期位置は決定的である。
- 全50体は互いに重ならず、Player初期Unit / Facility / Checkpointと重ならない。

### 5.2 Army Base視界安全 — INIT-Z-02

Army Base位置を決定した後に初期Zombie候補を確定し、少なくともGas / Hunter / Screamerの10体すべてについて次を満たす。

```text
hexDistance(zombie.position, armyBase.position) > zombie.vision
```

v1.6.1ですでに求めているNormal ZombieのArmy Base視界安全も維持する。初期Zombie再構成によってArmy Baseの位置抽選やOil Field等、無関係なSeed streamの結果を不必要に変えない。

---

## 6. Checkpoint / Housing / Refugee調整

### 6.1 Checkpoint費用の完全統一 — CP-COST-01

現行:

```text
first BuildCheckpoint = 5 Civilian Goods
subsequent BuildCheckpoint = 25
RelocateCheckpoint = 25
```

v1.6.2:

```text
all BuildCheckpoint = 25 Civilian Goods
all RelocateCheckpoint = 25 Civilian Goods
```

- 初回だけ安い分岐を廃止する。
- `hasBuiltCheckpoint`は費用決定には使わない。別用途も不要なら削除してよい。
- Configに`constructionCivilianGoods` / `subsequentConstructionCivilianGoods`を残す場合でも双方25でなければならず、Coreに初回例外を残さない。
- UI / Agent API / forecast / legal action reasonは同じ25を参照する。

### 6.2 Temporary Housing Hard Cap — HOUSE-01

Temporary Housingの人口上限10人をSoft Capから**Hard Cap**へ変更する。

- `populationLimitKind = hard`。
- workers / healthy residentsは10を超えない。
- TransferPopulation、Refugee受入先選択、再配置等、全ての人口増加経路でHard Capを共通検証する。
- 10人に達したTemporary Housingは新たな受入先候補から外れる。
- 超過分を自動消滅させない。別の合法受入先、Checkpoint queue、拒否／滞留等、既存ルール上の正しい場所へ残す。
- Temporary Housing自身を原因とする`overcrowding_forecast`を発生させない。
- Permanent City等、他の人口上限意味論は本要件だけでは変更しない。

### 6.3 Strict screening処理能力 — REF-01

ClaudeプレイテストではStrictが5 Turn処理、screeningCapacity 20のため実効処理能力4人/Turnとなり、既定Arrivalの平均約5人/Turnを下回って構造的にQueueが増えやすかった。

v1.6.2ではStrictを以下へ変更する。

```text
strict.turns: 5 -> 4
strict.workerRate: 0.5 (据え置き)
strict.infectionRate: 0 (据え置き)
strict.infectionPopulationRate: 0 (据え置き)
screeningCapacity: 20 (据え置き)
```

これにより理論処理能力は5人/Turnとなり、既定Arrival平均と同程度になる。Burstや4 Branch同時運用、既存Queueによる危険は残るため、Strictを「安全かつ高スループット」にするものではない。

Normal / Pass Through / Denyの審査Turn・率は変更しない。

---

## 7. Claudeプレイテスト由来の公開情報・Session/API修正

### 7.1 Facility人員減少をImportant Changesへ出す — OBS-01

Claude本線ではCivilian Factoryの健康人口が30 -> 19へ感染等で減って生産300 -> 190へ落ちても、完全停止ではないため`productionStops`だけでは見落としやすかった。

v1.6.2では、Player所有Facilityの健康人口がDecision / EndTurn解決によって減少した場合、`importantChanges.facilityChanges`へ最低限次を記録する。

- `facilityId`
- healthy population before / after / delta
- infected population before / after（公開可能なPlayer所有Facilityのみ）
- production output before / afterの公開projection差、または生産低下reason
- 変化を起こした公開Eventから判別可能なら`infection` / `combat` / `transfer`等の公開reason

意図的なWorker Assignmentで減らした場合も事実として記録してよいが、Crisisを自動発生させる必要はない。重要なのは「完全停止しなかったため変化が消える」状態をなくすこと。

`status` / `play-turn`のCompactは、既存方針どおり直近EndTurn以降のImportant Changesを保持する。

### 7.2 Preview / Step / Play-turn GameAction検証統一 — API-01

v1.6.1では通常AiSession側には厳密なAction shape検証がある一方、Portable / CLI `SessionService.preview()`は入力ActionをJSON化して`GameAction`へcastし、未知fieldをCore Previewへ渡せる経路がある。

Claudeが確認した誤入力:

```json
{"type":"ProduceUnit","facilityId":"capital","unitType":"police"}
```

これは`facilityId`が未定義fieldであり、正しいProduceUnitは`unitType`と必要なら`destination`を使う。

v1.6.2要件:

- GameActionの構造schema / validatorを共有moduleへ一本化する。
- `preview`, `step`, interactive `play-turn`, finite-plan `play-turn`, AiSessionの全入力経路が同じvalidatorを通る。
- Action typeごとに未知fieldを拒否する（`additionalProperties: false`相当）。
- malformed ActionはCoreへ渡さず、Decision番号・State・RNGを消費しない。
- 上記誤ProduceUnitをPreviewすると`invalid_preview_input`または統一した`invalid_action_input`で失敗し、projectionを返さない。
- well-formedだが現在illegalなActionは従来どおり「構造は正しいがlegal=false / rejected」と区別する。
- 同じraw ActionについてPreviewとAction適用経路で「構造上validか」が一致する。

### 7.3 `ok`と`accepted`の意味 — API-02

v1.6.2では既存の二層意味論を維持する。

- `ok: true` = CLI / protocol command自体は正常に処理され、結果を返せた。
- `accepted: true` = GameActionがCoreに受理され、Game Stateへ適用された。
- `ok: true, accepted: false` = コマンド処理は成功したが、well-formedなGameActionはゲーム上拒否され、Rejected Decisionとして記録された。

変更事項:

- `PLAY_WITH_AI.md`で「Action結果は`ok`だけでなく`accepted`を必ず確認する」と明記する。
- `run-session --help`と`query --target=api`のmachine-readable schemaへ同じ定義を入れる。
- built-in driver / smoke testも`accepted`を確認する。
- `ok`をAction成功の意味へ変更して既存エラー層を混ぜない。

### 7.4 `query construction`のCheckpoint filter — API-03

v1.6.1では実装がCheckpoint候補をcollectionへ含める一方、Query Schemaの`facilityType` enumがConstructible + `barbedWire`のみで、`checkpoint`を受け付けない不整合がある。

v1.6.2:

- Checkpoint候補Itemに`facilityType: "checkpoint"`を付与する。
- `construction.facilityType` enumへ`checkpoint`を追加する。
- `actionType` enumは少なくとも次を扱う。
  - `BuildCheckpoint`
  - `RelocateCheckpoint`
  - `ActivateCheckpoint`
  - `BuildConstructibleFacility`
  - `BuildBarbedWire`
- `{"facilityType":"checkpoint"}`で、そのRevisionの公開可能なCheckpoint construction候補だけをfilterできる。
- `query api`が返すJSON Schemaと実際のfilter validatorを同じ定義から生成する。
- CLI SessionとAiSessionの双方で同じ結果をテストする。

### 7.5 finite-planの意図したCrisis変化 — API-04

finite-planは安全側停止を維持する。ただしClaudeが確認したように、意図的にMilitary FactoryのWorkerを0へしたAction等、自分で作った既知のCrisisまで`new_crisis`として直ちに停止するケースを限定的に扱えるようにする。

`expectations`へ任意fieldを追加する。

```json
{
  "allowedNewCrisisReasonCodes": ["production_outage"],
  "allowedWorsenedCrisisReasonCodes": []
}
```

要件:

- allowlistされたReason Codeだけ、そのActionによる`new_crisis` / `crisis_worsened`停止理由から除外できる。
- allowlist外のCrisis、新規Enemy発見、Unit loss、unexpected damage、movement interruption、rejected、Game Over、EndTurn completedは従来どおり停止する。
- 空配列またはfield省略時はv1.6.1と同じ安全側挙動。
- 未知Reason Codeは入力エラー。
- Help/API schemaへ明記する。

### 7.6 AI向けに明文化する既存挙動 — DOC-01

v1.6.1プレイテストで「動作は仕様どおりだが事前に分かりにくい」と確認された以下を`PLAY_WITH_AI.md`とAPI Helpへ明記する。

- Enemyに隣接されるとMove legal actionを失う場合があり、接触前に退避判断が必要。
- 同一Unitは1 Turn内でAttack後にMoveできない。Move後のAttackは条件を満たせば可能。
- 移動中のInterceptionでAttack Chargeを消費し、移動後の明示Attackができなくなる場合がある。
- Unit Productionは1 Turnの共有上限を持ち、Army Baseの無償National Guard取得も既存実装上その枠を消費する場合は、その事実をAPI metadataとHelpで明記する。実装が意図と異なるならCore側を統一し、Helpだけで辻褄を合わせない。
- Infected FacilityではWorker操作が制約される。
- Capitalがinfected状態の場合のPopulation Transfer制約を明記する。
- Strictは感染0の代わりにNormalより遅く、Queue増加リスクを持つ。
- 「安全人口の固定値」は存在しない。Population Intakeは`runway`, `guaranteed_resource_defeat`, production capacity, queue demandを見て判断する。

---

## 8. 戦術上の教訓をどう扱うか

Claudeの本線敗北は、South breakthroughでPower Plantを失って電力105 -> 15、Civilian Goods不足へ連鎖したこと、Capital感染を抑えず`capitalLost`へ至ったことが主因だった。一方BranchではRiot PoliceをPower Plantへ置いた場合に経済を維持できた。

これらはCoreが自動駐屯して解決すべき不具合ではない。v1.6.2では以下で支援する。

### 8.1 Human / External AI向け

Helpへ「Capital / Power Plant / 主要Food / Civilian Goods生産拠点は戦略的Critical Siteであり、侵入経路が近い場合は守備Unitを残す価値が高い」と明記する。

`critical_site_infection_uncontained`, `capital_infection_uncontained`, `production_outage`, `resource_runway_risk`, `guaranteed_resource_defeat`等の既存Crisisを削除せず、OBS-01の人員減少表示と組み合わせる。

### 8.2 Built-in Balanced Agent — AGENT-01

Balanced Agentは少なくとも次を優先規則へ反映する。

1. Capitalで感染が発生し抑制可能なら、Police / Riot PoliceによるCivilian Damage 0の抑制をNational Guardより優先する。
2. visible threatがCritical Siteへ近づく場合、全戦力を前線へ出さずCapital / Power /主要Food / Civilian Goodsの防衛余力を残す。
3. Player所有生産Facilityの健康人口が減り、available city populationで補充可能なら、資源runwayを比較して重要施設のWorker復旧を検討する。
4. `guaranteed_resource_defeat`を最優先級で回避する。人口受入が原因ならNormal / Denyを含むCheckpoint Policy変更を検討する。
5. Temporary Housing Hard Capを前提に、容量超過を計画しない。

Balanced Agentの変更はCore合法性を迂回しない。Fog of War外の情報も使用しない。

---

## 9. 70 Turn級Session実行性能 — PERF-01..02

### 9.1 現状判断

Claude環境ではCheckoutの`npm run session`、すなわち`vite-node --script src/session/session-cli.ts`を1 commandごとに起動すると約40秒、`node scripts/build-portable.mjs`が生成する`dist/portable/session-cli.mjs`を直接実行すると約3秒だった。

現行`build-portable.mjs`はすでにSession CLIをesbuildで単一ESMへbundleし、「各stepでVite / TypeScript変換を起動しない」構成を持つ。したがって新しい技術スタックの導入やSession Coreの全面再設計は不要で、v1.6.2で解決対象とする。

### 9.2 v1.6.2の既定実行経路

Repository checkoutの通常利用を以下へ整理する。

- `npm run session -- ...` = **ビルド済み`dist/portable/session-cli.mjs`をNodeで実行する通常経路**。
- `npm run session:dev -- ...` = `vite-node --script src/session/session-cli.ts`を使う開発・デバッグ専用経路。
- `npm run build:portable-session` = 明示的なbundle生成を維持。

`npm run session`用の薄いlauncherを用意し、bundleが無い、またはSession CLIが依存する`src/core`, `src/agent`, `src/session`, build script, lockfile等がbundleより新しい場合だけ再buildする。変更がなければ再buildせずNodeで直接実行する。

- 通常Session実行中にVite server / vite-node / runtime TypeScript transpilationを起動しない。
- CLIのcommand / JSON契約はPortableとCheckoutで同じSession CLI moduleを正本にする。
- interactive `play-turn`は引き続き1 Turn中1 processを保持する推奨経路とする。

### 9.3 性能受入

厳密な秒数だけをGame Ruleにしないが、Release検証としてGitHub-hosted runner上で以下を記録する。

- cold build時間
- built CLIの`--help` / `new` / `status` / `query`の起動時間
- 同一revisionでのread-only command 10回のmedian / p95

最低受入:

- 通常`npm run session`の既定pathに`vite-node`が含まれない。
- warm実行は再bundleしない。
- 10回warm commandのp95が10秒未満を目標とし、v1.6.1の約40秒級退行をRelease Gateで検出する。
- Portable packageのdirect Node経路とCheckout built経路でSession contract testが同じ結果になる。

70 Turn全てを1processへ固定する必要はない。Turn間でprocessを閉じても、毎commandのVite/TS変換を除去することで長期プレイを現実的にする。

---

## 10. AI Portable GitHub Actions失敗 — CI-01..02

### 10.1 v1.6.1失敗の直接原因

2026-09-15の`AI Portable Player Package v1.6.1` runではLinux x64 package jobは成功し、Windows x64 jobがpackage assembly前のcheckout validationで失敗した。

失敗test:

```text
src/core/v153.engine.test.ts
v1.5.3 integrated rules
places one seed-bound base outside initial supply and distinct Gas, without reroll
```

当該testは40 seed分の`GameEngine`初期化とMap / Supply / placement検証を1 test内で行い、末尾に固定`20000ms` timeoutを持つ。Windows runnerでは約21.9秒かかり、Vitestの20秒上限を超えた。91 test files / 832 testsは通過しており、Portable Windows組み立て処理そのものまで到達していない。

その後mainのcommit `c311acc4...`でWindows job全体の`timeout-minutes`を20 -> 40へ増やしたが、**個別testの20秒timeoutは別物であり、直接原因を解消していない**。

### 10.2 修正方針

単に20秒を大きくするだけではなく、速度依存を減らす。

1. 「SeedごとのArmy Base候補選択が全候補を覆う」等の純粋な決定性検証を、可能な限り軽量なselector / generator単体testへ分離する。
2. 完全な`GameEngine`初期化が必要な統合testは代表seedへ絞り、同じ性質を40回重複して検証しない。
3. Windows CIの残る重いintegration testには、runnerばらつきを吸収する明示的timeoutを設定する。目安60秒。ただし高速化後も20秒を恒常的に使い切る設計にしない。
4. Linux / Windowsで同じassertion内容を維持する。Windowsだけtestを削除しない。

### 10.3 workflowの重複検証整理

`workflow_run`で成功済み`CI and GitHub Pages`の同一`head_sha`からAI Portableを作る場合、Portable workflow内で全通常Vitest suiteを再度丸ごと実行する必要はない。

- `workflow_run` path: verified SHAの確認、typecheck/build、Portable固有test / smoke / package verificationを必須とする。
- `workflow_dispatch` path: 単独起動なので通常testも実行する。
- どちらもPortable固有のSession smoke、replay match、package manifest / license / build identity検証は省略しない。

この整理は任意の高速化ではなく、「通常CIが成功した同じcommitをpackagingする」というworkflow_runの契約を明示するものとする。

### 10.4 AI Portable Release Gate — CI-02

v1.6.2のRelease条件:

- Linux x64 AI Player package job = success
- Windows x64 AI Player package job = success
- 両方でpackage ZIP Artifactが存在
- 両方でevidence Artifactが存在
- package内にNode runtime / `session-cli.mjs` / launcher / license類が存在
- package内に`node_modules`, repository `src`, Vite, TypeScript sourceを含めない
- Seeds 1 / 7 portable smokeが成功
- replay match = true
- 10 Session command interfaceのsmokeが成功
- `preview` malformed ProduceUnit regression testが成功
- package version / workflow name / BUILD_INFOが1.6.2を示す

---

## 11. Version / Compatibility — COMPAT-01

v1.6.2では初期Map、初期State、Game Rules、Action入力検証、Observation / Query contract、Session protocolを変更するため、v1.6.1以前との互換を持たせない。

確定version:

| Contract | v1.6.1 | v1.6.2 |
| --- | --- | --- |
| App | 1.6.1 | **1.6.2** |
| Game Rules / Config | 11.0.0 | **12.0.0** |
| Map ID | fixed-51x51-v6 | **fixed-51x51-v7** |
| Save Format | 18 | **19** |
| Agent API | 16.0.0 | **17.0.0** |
| Observation API | 16.0.0 | **17.0.0** |
| Bridge API | 16.0.0 | **17.0.0** |
| Artifact Schema | 15.0.0 | **16.0.0** |
| Checkpoint Schema | 12.0.0 | **13.0.0** |
| Session Schema | 12.0.0 | **13.0.0** |
| Play-turn Protocol | 1.0.0 | **1.1.0** |

- v1.6.1以前のSave / Replay / AI Session / Checkpoint / Artifactはv1.6.2でloadしない。
- 自動migrationを書かない。
- version mismatchとして明示的に拒否し、新規v1.6.2 game開始を案内する。
- Replayはv1.6.2内で同Seed / Action列なら決定的に再現する。

---

## 12. Release受入テスト

### 12.1 初期状態

Seedを複数変えても以下は固定で成立する。

1. Checkpointは4基、North/East/South/Westに各1。
2. 座標は `(25,20)`, `(30,25)`, `(25,30)`, `(20,25)`。
3. 全てnormal / active / operational / queue 0。
4. 4 BranchのSupply Radiusは開始時5のまま。
5. `city-1=(25,21)`。
6. `city-1`と`military-factory-1`はPlayer owned。
7. 両施設は開始時Neutral Survivor reward / first capture rewardを持たない。
8. Capital workers = 51、開始Player健康市民 = 110。
9. Player Unit = Police4 / Riot1 / Recon1 / NG1、全てregular。
10. 初期資源 = Food330 / Civilian Goods355 / Military Goods175 / Fuel192。
11. Zombie総数50 = Normal40 / Gas4 / Hunter4 / Screamer2。
12. 初期特殊Zombie全10体がArmy BaseをVision内に含めない。
13. 初期Unit / Zombie / Facility / Checkpoint位置に不正重複がない。

### 12.2 Checkpoint / Housing / Refugee

- 最初の追加BuildCheckpointも25 Civilian Goods。
- 2基目以降も25。
- Relocateも25。
- 初期4基は資源消費0。
- Temporary Housing 10人の状態で+1 Transferがlegalにならない。
- Refugee自動受入でもTemporary Housingが11人以上にならない。
- Temporary Housing由来のovercrowding penaltyが起きない。
- Strict 20人queueは4 Turnで処理完了する条件が成立する。

### 12.3 Session / API regression

- malformed ProduceUnit `facilityId`版をpreviewするとinput error。
- 同Actionをstep / play-turnへ渡しても構造上同じ判定。
- well-formed illegal Actionはaccepted=falseとして区別される。
- `ok:true, accepted:false`の意味が`--help`と`query api`に存在。
- `query construction` + `facilityType=checkpoint`がschema validationを通り、Checkpoint候補のみ返す。
- `actionType=BuildConstructibleFacility`もconstruction filterで利用可能。
- finite-planのCrisis allowlistが指定Reasonだけを停止除外し、別Reason / enemy / unit lossは停止する。
- Player所有Facilityの健康人口減少がImportant Changesへ残る。

### 12.4 Claude報告の再現fixture

完全に同じプレイ結果を要求するのではなく、報告で見つかった欠陥を小さいfixtureへ切り出す。

- Civilian Factory 30 -> 19の健康人口減少がCompact / Important Changesから観測可能。
- Power Plant陥落による電力不足が従来どおりproduction / crisisへ反映される。
- Capital infection critical alertが維持される。
- Temporary HousingがHard Capを超えない。
- Strictの処理能力が4 -> 5人/Turn相当へ改善している。

### 12.5 CI / Performance

- Linux / Windows AI Portable両job成功。
- Windowsで旧20秒timeout testが速度理由だけでfailしない。
- `npm run session` warm pathにvite-nodeが存在しない。
- built CLIとPortable CLIの契約testが一致。
- warm command benchmarkのmedian / p95をCI evidenceへ残す。

---

## 13. 実装順序

依存関係を減らすため、以下の順を推奨する。

1. Version / Map ID / Config version bump。
2. `city-1`移動、初期Supply内Facility owned化。
3. 初期Checkpoint 4基とCheckpoint費用統一。
4. 初期人口・Unit・資源。
5. 初期Zombie 40/4/4/2再構成。
6. Temporary Housing Hard Cap、Strict 4 Turn。
7. Player-owned Facility人口減少のImportant Changes。
8. GameAction validator共有化、Preview修正。
9. construction query schema修正。
10. finite-plan Crisis expectation拡張。
11. Balanced Agent / PLAY_WITH_AI / Help更新。
12. Session built CLI既定化とperformance evidence。
13. v153 heavy test分割、AI Portable workflow整理。
14. Linux / Windows package Release Gate。
15. Save / Replay / Session incompatibility rejectionと全体回帰。

---

## 14. ドラフト内で確定扱いとする判断

次の点は追加質問なしで実装へ進める前提とする。

- 「4つの初期Checkpoint」は**4 Branchに各1基、合計4基**を意味する。
- 初期Checkpoint位置はSupply Radius 5の幹線上 `(25,20)/(30,25)/(25,30)/(20,25)`。
- 境界Facility移動は現行固定Mapでは`city-1`のみ、`(25,20)->(25,21)`。
- 初期Supply内で新たにPlayer-ownedとなるのは`city-1`と`military-factory-1`。
- これら2施設へNeutral Survivorのランダム人口は追加せず、+10市民はCapitalへ固定追加する。
- 初期資源は330 / 355 / 175 / 192。
- 初期Zombieは「Normal 50 + special別枠」ではなく、**総数50の内訳40/4/4/2**へ整理する。
- Temporary HousingだけをHard Cap化し、他のPopulation Limitを一括変更しない。
- Strictは5 Turnから4 Turnへ変更する。感染0等の率は据え置く。
- `ok`の意味は変えず、`accepted`確認をmachine-readableに明文化する。
- 70 Turn性能問題は現技術構成で解決可能と判断し、通常Session入口をbuilt ESMへ変更する。Core全面再設計はしない。
- AI Portable失敗はWindows package本体ではなく、package前の`v153.engine.test.ts`固定20秒timeoutが直接原因であり、job全体timeout延長だけでは解決扱いにしない。
- Save / Replay / Session / Checkpoint / Artifactの旧版互換は実装しない。

以上。