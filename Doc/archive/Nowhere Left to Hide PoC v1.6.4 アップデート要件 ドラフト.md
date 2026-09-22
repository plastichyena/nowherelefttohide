# Nowhere Left to Hide PoC v1.6.4 アップデート要件 ドラフト

> Status: Draft  
> Base: v1.6.3  
> 作成日: 2026-09-21  
> 主な根拠: v1.6.3 Claudeプレイテスト、および現行 `main` 実装確認

## 0. 目的

v1.6.3プレイテストで確認された長期戦時の経済・補給上の問題を修正するとともに、WebMCPリアルタイム観戦を既存Replay相当の視認性へ引き上げる。

同時に、v1.6系のUnit variants拡張として新ユニット **Field Artillery / 野戦砲** を追加する。

ゲームルール、Agent API、WebMCP、Replayの間で同一の状態・情報公開ルールを維持し、WebMCP観戦専用の別ゲーム表現や別ルールを増やさないことを原則とする。

---

# 1. 簡易施設のバランス変更

| 項目 | v1.6.3 | v1.6.4 |
|---|---:|---:|
| Temporary Housing / 仮設住宅 建設費 | 民需品25 | **民需品50** |
| Simple Farm / 簡易農場 建設費 | 民需品25 | **民需品50** |
| Simple Farm 建設数 | 道路分岐数まで | **無制限** |
| Temporary Housing 建設数 | 無制限 | 変更なし |

現行 `constructibleLimit()` ではTemporary Housingはすでに事実上無制限だが、Simple Farmには `state.map.roadBranches.length` による上限が存在する。

v1.6.4ではSimple FarmもTemporary Housingと同様に建設数上限を持たない。

`constructibleFacility.limitPerTypeDivisor` はCivilian Drone Base等で引き続き使用するため、設定自体は削除しない。

---

# 2. 陥落した検問所の復旧

## 2.1 v1.6.3で発生している問題

プレイテストでは東側検問所が `ruined / infected=0` となった後、

- RelocateCheckpointでは元検問所が配置を妨害
- BuildCheckpointでは後方配置制限に抵触
- ActivateCheckpointではruinedが対象外
- Human Unitを駐留させても状態変化なし

となり、Supply Radiusが永久に縮小した。

現行実装にはすでに「ruined checkpointの感染をSuppressして0にするとOperationalへ復旧する」処理が存在する。

しかし `suppressCheckpoint()` 自体が `infected <= 0` を拒否するため、**陥落した時点ですでにinfected=0になった検問所だけ復旧処理へ到達できない**。

## 2.2 v1.6.4仕様

Ruined Checkpointについて、

**感染者0・敵ユニット不在の検問所へHuman Unitが進入した場合、自動的に復旧する。**

感染者が残っている場合は従来通りSuppressが必要であり、最後の感染者を駆除した時点で同一の復旧処理を使用する。

復旧後のRoleは既存ルールを維持する。

| Branch状態 | 復旧後 |
|---|---|
| Activeなし | Active |
| Activeあり、Standby枠あり | Standby |
| Activeあり、Standby枠なし | Dormant |

復旧時には `overrunProcessed=false` とし、`checkpoint_recovered` Eventを発行する。

## 2.3 実装方針

`suppressCheckpoint()` 内に存在する復旧ロジックを共通関数へ分離する。

例:

`recoverRuinedCheckpoint()`

これを、

- Suppression完了時
- Human Unit進入・占領判定時

の双方から利用する。

新しい `RecoverCheckpoint` Actionは追加しない。

Agent/Public ProjectionにもCheckpoint Recovery条件を公開し、なぜ復旧していないかをAIと人間の双方が確認できるようにする。

---

# 3. WebMCPリアルタイム観戦画面をReplayと共通化

現在の `src/browser/live-ai.ts` はReplayとは異なる簡易Canvas Rendererを持ち、

- Terrain = 単色矩形
- Facility = 円
- Human Unit = 青い円
- Zombie = 赤い円

という簡易表示になっている。

一方Replay Viewerは、

- Hex Map
- Road
- Bridge
- Fog / Visibility
- Facility Assets
- Checkpoint Assets
- Unit Assets
- Zombie Assets
- pan / zoom

を備えている。

## 3.1 v1.6.4仕様

WebMCP Live PlayをReplayと同等の描画へ変更する。

ただしReplayの描画コードをコピーするのではなく、**Public Board Rendererとして共通化する。**

概念的には、

`AgentObservation / SessionPublicDocument`  
→ `PublicBoardFrame`  
→ `PublicBoardRenderer`

という構造とする。

Replay ViewerとWebMCP Live Viewerの双方が同じRendererを利用する。

通常ゲームのprivate `GameState` をLive Viewerへ渡してはならない。

Live ViewerはAIへ公開されているObservationだけを描画し、Fog of Warや未発見Zombieについて追加情報を人間側へ漏らさない。

共通化対象:

- Hex座標変換
- Terrain
- Road / Bridge
- Visibility / Fog
- Facility Assets
- Checkpoint Assets
- Barbed Wire
- Human Unit Assets
- Zombie Assets
- Unit State別Asset
- pan / zoom / fit
- Missing Asset fallback

---

# 4. Horde Wave / Zombie調整

## 4.1 Gas Zombieを全Horde Waveで抽選可能にする

v1.6.3では、

- `gasZombieCapPerDirection = 1`
- Gas Zombieは最後の2 Waveのみ抽選対象

という二重の制限が存在する。

v1.6.4では**両方の制限を撤廃する。**

Gas Zombieを第1 WaveからFinal Waveまで、すべてのHorde Waveの特殊Zombie抽選対象とする。

同一方向から出現できるGas Zombie数にも上限を設けない。

Gas Zombieの出現頻度そのものは既存の `specialZombieWeights.gasZombie` によって制御する。

したがって早期Waveでも低確率でGas Zombieが出現し、抽選結果によっては同一方向へ複数出現する可能性がある。

実装上は `gasEligible` によるWave時期判定および `gasZombieCapPerDirection` による個数制限を廃止する。

## 4.2 Horde Wave内のNormal ZombieをすべてHorde Zombie化

v1.6.3では各Waveの `compositionPerDirection.zombie` が「non-Horde slot」として特殊Zombie抽選へ渡され、抽選結果が `zombie` だった場合は通常ZombieがHorde Waveへ混在する。

さらに、難民の拒否・追い返しによる追加スポーンは、

`ceil(rejectedTotal / 5)`

個の追加slotとして同じRoster生成へ加算されている。

v1.6.4では、**Horde Waveに所属するNormal Zombieは、基本Wave分・追加スポーン分を問わず、すべてHorde Zombieとして生成する。**

対象には以下を含む。

1. `compositionPerDirection.zombie` に由来するslot
2. 特殊Zombie抽選でNormal Zombieが選ばれた結果
3. 難民拒否・追い返しによる追加slot
4. 上記追加slotの抽選でNormal Zombieが選ばれた結果
5. 将来Horde Wave Rosterへ追加される処理のうち、Normal Zombieを生成するもの

実装上は、Horde Wave Roster確定時に抽選結果 `zombie` を `hordeZombie` へ正規化する。

Special Zombieは従来通り各固有Unit Typeとして生成する。

例:

- policeZombie → policeZombie
- soldierZombie → soldierZombie
- riotZombie → riotZombie
- hunterZombie → hunterZombie
- gasZombie → gasZombie
- screamerZombie → screamerZombie
- zombie → **hordeZombie**

難民拒否ボーナスについても同じ規則を適用する。

つまり、従来Event上で `extraNormalZombies` と表現されていた追加数は、v1.6.4では「追加Wave Slots」または「追加Horde Reinforcements」に相当する意味へ変更し、通常Zombieを保証する名称・説明を残さない。

### 非対象

Horde Waveに由来しないNormal Zombieは変更しない。

具体的には、

- 初期配置Zombie
- Facility / Checkpoint陥落によるZombie Spawn
- Fallen SiteのNoise Respawn
- Reanimation等の非Wave生成

は従来通りNormal Zombieまたは既存ルールで定められたZombie Typeを使用する。

### Public API /命名整理

現行の `nonHordeSlotCountPerDirection` / `possibleNonHordeTypes` は、Normal Zombie結果がHorde Zombie化されるため名称が実態と一致しにくくなる。

v1.6.4では可能なら、

- `variantSlotCountPerDirection`
- `possibleVariantTypes`

等の中立的な名称へ整理する。

互換性上旧名を残す場合でも、公開説明では「特殊/変種抽選slotであり、Normal結果はHorde Zombieになる」ことを明記する。

## 4.3 Gas Zombie死亡時爆発

現在のGas Zombie死亡爆発はHuman/Zombieの双方へ同一の `explosionDamage=30` を与える。

v1.6.4では、

| 対象 | Base Explosion Damage |
|---|---:|
| Human Unit | 30 |
| Zombie Unit | **15** |
| Facility / Checkpointへの感染 | 現行値維持 |

Zombieへのダメージのみ50%とする。

対象別Base Damageを決定した後、既存のTerrain Damage補正を適用する。

Gas Zombie同士の連鎖爆発は引き続き発生する。

Agentの `deathExplosion` preview、Combat Preview、Replay Eventにも対象別ダメージを反映する。

---

# 5. National Guard → Soldier 名称統一

プレイヤー向け名称を、

**National Guard / 州兵**  
→  
**Soldier / 兵士**

へ統一する。

内部ID `nationalGuard` は互換性維持のため変更しない。

現在 `nationalGuard` は、

- UnitType
- Population
- Statistics
- Agent API
- Army Base Reward
- Save State
- Asset Path

などで広範囲に使用されている。

したがって、

`unitType: "nationalGuard"` = internal compatibility ID

Display Name = `"Soldier"` / `"兵士"`

とする。

UI、Agent説明、ルール文書、Replay表示、仕様書などユーザーへ露出する名称はSoldierへ統一する。

既存Asset filenameは互換性のため変更不要。

---

# 6. Field Artillery / 野戦砲

## 6.1 基本仕様

内部UnitType:

`fieldArtillery`

生産場所:

**Army Baseのみ**

1ゲームを通して最大 **2個部隊** まで生産可能。

破壊されたField ArtilleryもLifetime Production Countから減算しない。

Pending Productionは上限に含める。

Army Base陥落などによりProductionそのものがForfeitされた場合は生産済み数へ含めない。

### 共通値

| Stat | Value |
|---|---:|
| HP | 25 |
| Population | 5 |
| Vision | 5 |
| Military Goods capacity | 100 |
| Fuel capacity | 100 |
| Production Population | 5 |
| Production Civilian Goods | 100 |
| Production Military Goods | 200 |
| Production Fuel | 100 |

完成時は **Packed / 梱包状態**。

Production Fuel 100は発注時に確保・消費し、完成したField ArtilleryをFuel 100の状態で配備する。

通常ユニットのように完成時にGlobal Fuel Poolから追加補給しない。

## 6.2 感染鎮圧能力

Field Artilleryは**Packed / Deployedのどちらの状態でも感染鎮圧を行えない。**

つまり、

- Facility Suppression不可
- Checkpoint Suppression不可

とする。

Packed状態のRange 1 Attackも通常Combat専用であり、感染者駆除能力として利用できない。

既存 `suppressionMilitaryGoodsCost` を利用して疑似的に禁止するのではなく、Capabilityとして明示する。

例:

`canSuppressInfection: false`

Agent APIのSuppression CandidateにもField Artilleryを含めない。

## 6.3 Packed / 梱包状態

| Stat | Recruit | Regular | Veteran |
|---|---:|---:|---:|
| Movement | 10 | 10 | 10 |
| Attack | 7 | 9 | 9 |
| Range | 1 | 1 | 1 |
| Noise Radius | 6 | 6 | 6 |
| Military Goods / attack | 4 | 4 | 4 |
| Fuel / Movement Point | 10 | 10 | 10 |
| Fuel枯渇時MP | 1 | 1 | 1 |
| Attack Charges | 1 | 1 | 1 |

Regular Attackは既存の、

`ceil(7 × 1.25) = 9`

を利用する。

Veteranによる追加Attack ChargeはField Artilleryには適用しない。

## 6.4 Deployed / 展開状態

| Stat | Recruit | Regular | Veteran |
|---|---:|---:|---:|
| Movement | 0 | 0 | 0 |
| Attack | 40 | 50 | 50 |
| Minimum Range | 10 | 10 | 10 |
| Maximum Range | 200 | 200 | 200 |
| Noise Radius | 40 | 40 | 40 |
| Military Goods / attack | 50 | 50 | 50 |
| Attack Charges | 1 | 1 | 1 |

Visionは5のままとする。

Maximum Rangeが200であっても、**現在プレイヤー/AIから視認できていないEnemyをTargetとして指定することはできない。**

Recon Team等による前方索敵を前提とする。

## 6.5 Packed ↔ Deployed

新しいAction:

`ChangeUnitMode { unitId, mode: "packed" | "deployed" }`

を追加する。

Mode切り替えには1ターンを消費する。

条件:

- そのPlayer TurnでまだMoveしていない
- Attackしていない
- Suppressionしていない
- Mode Changeしていない

Field Artilleryのみ実行可能。

Action実行直後にMode表示は切り替えるが、

- `canMove=false`
- `canAttack=false`

となり、次のPlayer Turn Startから新しいModeで行動可能になる。

## 6.6 Deployed砲撃の着弾ずれ

砲撃対象は視認済みEnemy Unitを指定する。

攻撃時に、

1. Intended Target Hex
2. Actual Impact Hex

を決定する。

### Recruit

50%:

Intended Target Hexへ正確に着弾。

50%:

Intended Targetから **Hex Distance 1～2** の別Hexへ着弾。

中心HexはScatter候補へ含めない。

### Regular

50%:

Intended Target Hexへ正確に着弾。

50%:

Intended Targetから **Hex Distance 1** の別Hexへ着弾。

### Veteran

100%:

Intended Target Hexへ着弾。

Scatter先はMap内に存在する候補HexからSeeded RNGで選択する。

UIやReplay側で乱数を発生させない。

Replay/Eventには、

- Intended Target
- Accuracy roll
- Scatter発生有無
- Actual Impact Hex

を記録する。

## 6.7 砲撃の範囲攻撃

Actual Impact Hexへ、

**ATK 100%**

隣接する6 Hexへ、

**ATK 50%**

を適用する。

### Damage

Recruit:

- Impact Hex = 40
- Adjacent Hex = 20

Regular / Veteran:

- Impact Hex = 50
- Adjacent Hex = 25

各Unitへ既存Terrain Damage補正を個別に適用する。

## 6.8 Friendly Fire

Field ArtilleryのDeployed Attackには**完全なFriendly Fireを適用する。**

攻撃対象のFactionによる範囲ダメージ除外を行わない。

Impact HexおよびSplash Hex内に存在する、

- Human Unit
- Zombie Unit

の双方へ同じ砲撃Damage判定を行う。

したがってScatterによって味方部隊へ直撃する可能性もある。

味方Field Artillery自身が別のField Artilleryの砲撃範囲に入った場合も例外扱いしない。

Friendly FireでHuman Unitが死亡した場合は通常のUnit Loss / Population Deathとして処理する。

Friendly Fireによる死亡から発生するGas Zombie Explosionなども通常のUnit Lifecycleへ接続する。

## 6.9 AIのField Artillery運用ルール

AIは**味方ユニット周辺への砲撃を避ける。**

これは砲撃そのものをEngine上Illegalとするルールではない。

プレイヤー自身はFriendly Fireの危険を承知で砲撃可能とする。

AI側では、命中点だけでなく**Scatter可能範囲＋Splash範囲全体**をFriendly Fire Risk Areaとして評価する。

最大危険半径は、

| Proficiency | Scatter | Splash | Potential Risk Radius |
|---|---:|---:|---:|
| Recruit | 2 | 1 | **3 Hex** |
| Regular | 1 | 1 | **2 Hex** |
| Veteran | 0 | 1 | **1 Hex** |

とする。

Target周辺のPotential Risk Area内にHuman Unitが存在する場合、その砲撃候補を通常は選択しない。

Built-in Agentでは砲撃候補評価時にFriendly Fire Riskを強い除外条件として扱う。

外部AI/WebMCPへも、

- `friendlyFirePossible`
- `friendlyUnitIdsAtRisk`
- `possibleImpactHexes`
- `possibleBlastHexes`

等をPreviewとして公開する。

公開ルールにも「Field Artillery should avoid firing near friendly units.」相当の運用指示を明記する。

これはHuman Unitを絶対に巻き込まない保証ではなく、AIの運用方針である。

## 6.10 Facilityへの砲撃被害

Field ArtilleryのImpactまたはSplash範囲にFacilityが存在した場合、その施設内部にも砲撃被害を発生させる。

FacilityそのものにHPを新設するのではなく、**内部人口への被害**として処理する。

実装上の対象は既存Facility State内の、

- Healthy population / workers
- Infected population

とする。

現在のゲームモデルではFacility内部のZombie側人口は `infected` として保持されているため、この値を「施設内部に存在するゾンビ側人口」として砲撃抽選へ使用する。

通常のMap UnitとしてFacility Hex上に存在するZombieは、この内部人口とは別に通常の範囲Unit Damageも受ける。

### Casualty Resolution

そのFacility Hexへ本来与えられる砲撃Damageを `D` とする。

例:

- Recruit direct impact → D=40
- Recruit splash → D=20
- Regular direct impact → D=50
- Regular splash → D=25

Facility内部に、

- Healthy 30
- Infected 10

が存在し、D=20だった場合、

合計40人の中からランダムに1人ずつ20回選択して除去する。

つまり各Casualtyについて、**その時点で残っているFacility内部人口から1人を一様ランダム選択する。**

そのためHealthy / Infectedの被害確率は、その時点の残存人数比に比例する。

`1 Damage = 1 internal population casualty`

として扱う。

D回処理する前にFacility内部人口が0になった場合、その時点で終了する。

Seeded RNGを使用し、Replayで完全再現可能とする。

### Healthyが選ばれた場合

- `workers` または該当Healthy Populationを1減少
- `cumulativeDeaths` +1
- `civilianLosses` +1

### Infectedが選ばれた場合

- `infected` -1
- 感染者死亡として既存統計へ反映
- Zombie Unit Killとしては扱わない

内部Casualty Resolution終了後、Facilityの人口状態が陥落条件を満たした場合は既存Facility Fall処理を実行する。

砲撃によってHealthy/Workersだけが失われた結果Facilityが停止する場合も、既存Operational Status判定へ従う。

施設構造そのものを砲撃で破壊するFacility HPシステムはv1.6.4では導入しない。

## 6.11 Checkpointへの砲撃

本ドラフトで指定するFacility内部人口への砲撃ルールはFacilityに限定する。

Checkpoint内部の、

- waiting
- screening
- approved
- infected

へのArtillery内部人口Damageは、現時点では追加しない。

Checkpoint Hex上に存在するUnitは通常のFriendly Fire / Area Damage対象になる。

Checkpoint人口にもFacilityと同様の内部人口砲撃被害を適用する場合は別途仕様追加する。

## 6.12 Experienceとの統合

Field Artilleryも通常の、

Recruit → Regular → Veteran

進行を使用する。

昇格条件は既存ルールを維持する。

効果:

| Proficiency | Packed | Deployed |
|---|---|---|
| Recruit | ATK7 | ATK40 / Scatter 2 Hex |
| Regular | ATK9 | ATK50 / Scatter 1 Hex |
| Veteran | ATK9 | ATK50 / Scatterなし |

Veteran Attack Charge増加はField Artilleryには適用しない。

## 6.13 Config / State設計

Field Artilleryは既存HumanUnitConfigだけでは表現しきれないため専用設定を追加する。

最低限、

- `packed`
- `deployed`
- `scatter`
- `productionLimitPerGame`
- `productionFuel`
- `canSuppressInfection`
- `friendlyFire`
- `facilityPopulationDamage`

を設定可能な構造とする。

UnitStateには、

`mode: "packed" | "deployed"`

を追加する。

既存コードが `unit.attack / movement / range` を広く参照しているため、全面的なDerived Stat化は行わず、

`applyFieldArtilleryModeStats()`

のような共通処理を用いて、

- Production
- Mode Change
- Recruit → Regular
- Regular → Veteran
- State Load Validation

時に有効Statを同期する。

Combat QueryにはMinimum Rangeを追加する。

## 6.14 Production Limit

将来の特殊ユニット追加を考慮し、

`productionLimitPerGame`

をHuman Unit側の共通機構として実装する。

Field Artillery:

`2`

既存ユニット:

`Unlimited`

Lifetime Produced CountはUnit死亡では減少しない。

## 6.15 Art Assets

2種類追加する。

`unit_field_artillery_packed`

トラックで牽引されている野戦砲。

`unit_field_artillery_deployed`

展開・据砲された野戦砲。

`BOARD_ASSET_REGISTRY` はUnit Typeに加えてModeを参照してAssetを選択する。

このState-aware Asset Resolverを、

- Normal Game
- Replay
- WebMCP Live Viewer

のすべてで共有する。

---

# 7. v1.6.3プレイテスト由来の小規模修正候補

## 7.1 Route QueryでRecon TeamがEnemy扱いされる問題

`query --target=route` でPlayer Recon TeamをEnemyとして拒否するケースを修正する。

Faction判定をUnit Typeごとの個別処理ではなく、既存 `isPlayerUnit` / Human faction判定へ統一する。

## 7.2 RelocateCheckpointのbranchId契約不一致

公開説明では `checkpointId + position` で実行可能に見える一方、実際には `branchId` を要求する箇所が存在する。

Checkpoint自身からBranchを一意に取得できる場合は内部推論する。

API上に `branchId` を残す場合もoptionalとし、不一致値が明示された場合のみrejectする。

---

# 8. テスト重点項目

1. Temporary Housing / Simple Farmの建設費が50になること。
2. Simple FarmをRoad Branch数を超えて建設できること。
3. `infected=0` でRuinedとなったCheckpointへHuman Unitが進入すると復旧すること。
4. Active不在時のCheckpoint RecoveryでSupply Radiusが復元されること。
5. Gas ZombieがWave 1を含む全Horde Waveで抽選候補になること。
6. 同一方向へ複数Gas ZombieがSpawn可能なこと。
7. Horde Waveの基本slotで抽選結果がNormal Zombieの場合、`hordeZombie` としてRosterへ入ること。
8. 難民拒否ボーナスの追加slotでもNormal Zombie結果が `hordeZombie` になること。
9. Horde Waveに属さない初期配置・施設陥落・Noise RespawnのNormal Zombieは従来通り `zombie` であること。
10. Horde Roster / Public API / Replay上でNormal→Horde変換が一貫していること。
11. Gas ExplosionがHumanへ30、Zombieへ15 Base Damageを使用すること。
12. Live ViewerとReplayが同一Public Board Rendererを利用すること。
13. 非可視ZombieをLive Viewerが描画しないこと。
14. Field ArtilleryのLifetime Production Limitが2であること。
15. Production時Fuel 100を正しく消費し、完成時Fuel 100となること。
16. Packed/Deployed Mode Changeが1 Turnを消費すること。
17. Field ArtilleryがPacked状態でも感染Suppressを行えないこと。
18. Minimum Range 10未満へDeployed Artilleryが攻撃できないこと。
19. Recruit / Regular / VeteranでScatter範囲が正しいこと。
20. Artillery ScatterがSeeded RNGで完全再現できること。
21. Impact 100% / Adjacent 50% Damageが正しいこと。
22. Friendly Human UnitへArtillery Damageが発生すること。
23. Scatter先のFriendly Unitにも通常通りDamageが発生すること。
24. Built-in AIがPotential Friendly Fire Area内への砲撃を避けること。
25. Agent PreviewがFriendly Fire Riskを公開すること。
26. Facility ImpactでHealthy / Infectedから合計Damage分がランダム除去されること。
27. Facility Casualty RNGがReplayで再現可能なこと。
28. ArtilleryによるFacility Casualty後に既存Facility Fall条件が正常に処理されること。
29. ArtilleryによりGas Zombieが死亡した場合、Gas Explosion Chainが正常に継続すること。
30. ReplayにIntended TargetとActual Impactが記録されること。
31. Packed / Deployed AssetがNormal / Replay / WebMCPで一致すること。

---

# 9. 実装順序

推奨順:

**既存バグ修正**  
→ **Balance変更**  
→ **Horde Wave / Gas Zombie変更**  
→ **Shared Public Renderer**  
→ **Soldier表示名統一**  
→ **Field Artillery State / Production**  
→ **Mode Change**  
→ **Minimum Range / Artillery Attack Resolution**  
→ **Scatter**  
→ **Friendly Fire**  
→ **Facility Internal Casualties**  
→ **Agent Preview / AI安全運用**  
→ **Replay / WebMCP統合**  
→ **Assets**  
→ **Regression / Playtest**

Horde Roster抽選、ArtilleryのScatter、Friendly Fire、Facility Casualty抽選はすべてCore側のSeeded RNGで決定する。

UI、Replay Viewer、WebMCP Viewerは結果を描画するだけとし、ゲーム結果を決定する乱数処理を持たせない。

---

# 10. 実装上の注意

- v1.6.4はv1.6.3のルール変更として、Game Rules / Agent Public Config / Replay Schema / Save FormatのどこにVersion bumpが必要かを実装時に明示する。
- Horde WaveのNormal Zombie→Horde Zombie化は、単に表示名を変えるのではなく、実際のUnit Type・AI挙動・Targeting・Horde membershipを `hordeZombie` として扱う。
- Wave由来のUnitは既存 `spawnGroupId` / `hordeKind` を維持し、Final / Periodic Hordeの追跡や勝利条件を壊さない。
- 難民拒否ボーナスのEvent/統計名に「Normal Zombie」を残す場合は意味が不正確になるため、v1.6.4で命名整理または互換Aliasを検討する。
- Field Artilleryの広域攻撃は既存Combatの単一Target前提を拡張するため、結果順序を決定論的に固定し、Gas Explosion等の連鎖Effectも既存Unit Lifecycleへ接続する。
- AIへ公開するArtillery Previewは、隠れた敵情報を利用せず、現在公開されている味方位置・可視敵・地形・施設情報だけから算出する。
