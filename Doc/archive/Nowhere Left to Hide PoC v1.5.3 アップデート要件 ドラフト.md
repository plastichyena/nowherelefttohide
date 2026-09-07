# Nowhere Left to Hide PoC v1.5.3 アップデート要件 ドラフト

- 作成日: 2026-09-06
- 状態: **履歴資料。第1～70問の回答を記録し、確定版へ整理済み。実装判断には使用しない。**
- 参照先: `../Nowhere Left to Hide PoC v1.5.3 アップデート要件 確定版.md`
- 履歴上の旧候補・未確定見出し・相対パスは作成当時の記録として残す。最終要件は上記確定版を参照する。
- 対象Release候補: `1.5.3`
- 基準: v1.5.2 現行仕様
- 正本: `Nowhere Left to Hide PoC 現行仕様.md`
- 関連（履歴資料）: `archive/Nowhere Left to Hide PoC v1.5.2 アップデート要件 確定版.md`

本書は、v1.5.2のパフォーマンス改善がSOG05実機で十分な効果を確認できた後の次期更新候補を整理するためのドラフトである。v1.5.2で用意したQuery／Combat／Movement／Unit lifecycle／Unit catalog／Map参照の境界を再利用し、UIだけの別ルールや別状態変更経路を作らない。

このドラフトでは、ユーザーから明示された数値・挙動は要件候補として記載する。一方、死亡時範囲damageの適用順、陸軍基地の配置方式・軍需補充・迎撃回数の回復時点、旧Save互換等、明示されていない事項は勝手に補完せず「未確定事項」として残す。

---

# 1. v1.5.3の目的

1. Human UIのUnit編成表示を整理し、Police／National Guard／Riot Policeの性能と編成Costを同じ形式で確認できるようにする。
2. Zombie移動時のPlayer Unitによる物理的な足止めを明確化し、Attack Chargeを失ったPlayer Unitでも経路上の防壁として機能できるようにする。
3. Hunter Zombieのゲーム性能は変更せず、Assetの服装だけを更新して「元陸上選手がオフの日に感染・変異した」視覚的コンセプトを強める。
4. 死亡時に周辺へdamageを発生させるGas Zombieを追加し、v1.5.2で準備したUnit lifecycleと戦闘対象列挙の境界を実際の範囲効果へ拡張する。
5. 新しい恒久施設候補としてArmy Baseを追加し、National Guard編成、早期確保報酬、施設自身の迎撃能力、独立Military Goods Poolを導入する。
6. Power PlantのFuel効率を低下させ、発電とUnit燃料補給の競合を強める。

最低射程、距離別Attack、その他の将来Unitは本ドラフトの実装対象には含めない。ただしv1.5.2の`forecastUnitCombatAtDistance`等、将来機能の受け皿を壊さない。

---

# 2. Human UI: Unit編成表示の整理

## 2.1 現状と目的

現行Human UIではRiot Policeの編成ButtonだけにCostが目立つ形で併記され、Police／National Guardと情報量が揃っていない。v1.5.3ではUnit編成Sectionを他の情報Sectionと同様のAccordion／折りたたみ式に整理し、どのUnitを何のCostで編成できるかを同じ書式で確認可能にする。

## 2.2 表示要件

- Unit編成Sectionは対象Facility内の独立した折りたたみSectionとする。
- Section見出しは日本語・英語Label、Chevron、`aria-expanded`を持ち、スマートフォンで他の情報Accordionと同じ操作感にする。
- 各編成可能Unitを同じ形式のRow／Cardとして表示する。
- 確定回答（第63問）: Unit編成Sectionを展開したとき、各Unitの名前・編成Cost・HP・Attack・Movement・Range・Visionを同じ形式で表示する。Police／National Guard／Riot PoliceとArmy BaseのNational Guard編成入口に共通適用する。
- 表示するUnit性能はConfig由来の値を使い、固定文字列で第二のUnit定義を作らない。
- 編成不可の場合はButton無効化と既存Core Reasonを表示し、見た目だけで合法性を判断しない。
- ButtonごとにCost表記方式を変えない。Riot Policeだけ特殊表示する現行差を解消する。

現行標準Configの編成Costは以下であり、v1.5.3で別途Balance変更を決定しない限り維持する。

| Unit | Population | Civilian Goods | Military Goods |
| --- | ---: | ---: | ---: |
| Police | 5 | 10 | 10 |
| National Guard | 10 | 20 | 25 |
| Riot Police | 10 | 25 | 25 |

Fuelは編成Costではなく、現行どおり完成後にState Fuelから補給される別処理として表示上も混同しない。

Army Base追加後のNational Guard編成入口も同じ共通UIを使用し、Army Base専用の別表示ルールを作らない。

---

# 3. Zombie移動: Player Unitによる経路上の足止め

## 3.1 目的

現行はZombieが移動中にHuman Unitの迎撃射程へ入った場合、迎撃可能なHuman UnitがあればそこでCombatを解決して移動停止する。一方、Player UnitにAttack Chargeが残っていない場合、ZombieがそのUnitの近傍を通過して遠方Targetへ直行できるケースがある。

v1.5.3では、Player UnitがAttack Chargeを使い切っていても「盤面上に存在する防壁」としてZombieの移動を足止めできるようにする。特に高MovementのHunter Zombieが、経路上の大人数Player Unitを無視して遠方のPopulation Target／Capitalへ直行する挙動を抑える。

## 3.2 移動停止要件

- Zombie Unitが経路に沿って移動するとき、**経路上で初めてPlayer Unitに隣接するHexへ到達した時点で移動を終了する**。
- 確定回答（第6問）: 行動開始時点ですでにPlayer Unitに隣接しているZombieも、その場で足止めされ、移動せず隣接Player Unitへの攻撃を判定する。攻撃可能なら第3・4問の規則で攻撃し、Attack Chargeが残っていなければその場に留まる。
- この停止判定は、隣接Player UnitのAttack Charge、`canAttack`、携行Military Goods、反撃／迎撃成立可否に依存しない。
- Player UnitがAttack Charge 0でも足止めは成立する。
- 足止めそのものはHuman UnitのAttack Chargeを消費しない。
- 確定回答（第3問）: 足止めしたZombieにAttack Chargeが残っていて攻撃可能な場合、隣接Player Unitへ攻撃対象を切り替え、その場で攻撃する。
- 確定回答（第4問）: 攻撃候補の隣接Player Unitが複数いる場合、現在の部隊人数が最も多いUnitを優先する。同人数の候補は安定順へ正規化し、Seed付き抽選で選ぶ。
- 確定回答（第5問）: 足止め位置でPlayer Unitの迎撃が成立する場合、既存の迎撃とそれに対するZombieの反撃を先に処理する。その後もZombieが生存し、Attack Chargeが残っていて攻撃可能なら、第3・4問の規則で隣接Player Unitへの攻撃を行う。迎撃への反撃でAttack Chargeを使い切った場合は追加攻撃しない。反撃の成立条件とCharge消費は既存Combat規則に従う。
- 迎撃可能なPlayer Unitが存在する場合のCombatは既存の迎撃規則と共通Combat処理を利用し、足止め判定のためだけに別damage規則を作らない。
- Zombieの実移動Hex数、Noise、Target記憶、移動Event、同コスト経路の決定性を維持する。
- `movement.ts`の1 Hex進入処理を基準にし、Zombie AIごとに別の「近傍Unit検出」を実装しない。

## 3.3 適用対象（確定）

確定回答（第2問）: Normal AI系Zombie、Horde Zombie、および新規Gas Zombieを含む全Zombie Typeへ足止めを適用する。隣接Player UnitのAttack Chargeが0でもHorde Zombieの足止めは成立する。

確定回答（第7問）: 人口Target、Noise Target、Horde継承Target等、移動目的を問わず同じ足止め規則を適用する。Spawn後の行動開始Timingは現行どおりとし、実際に行動する際に同じ規則を適用する。足止めの追加によってSpawn直後の行動を新設・前倒ししない。

## 3.4 確認状況

本節の適用対象、攻撃対象の切替・選択順位、迎撃との処理順、行動開始時の隣接、移動目的ごとの扱いは第2～7問で確定した。

---

# 4. Hunter Zombie Asset更新

## 4.1 ゲーム性能

Hunter Zombieの性能・AI・Targeting・Wave Slot・初期配置条件はv1.5.2から変更しない。

標準値は以下を維持する。

- HP 20
- Attack 15
- Movement 15
- Range 1
- Vision 5
- 最大Attack Charge 1
- Normal AI系
- Human Unit死亡からのReanimation対象外

## 4.2 新しい視覚コンセプト

現在のHunter Zombieの長い爪、変異した身体的特徴、単体描画の識別性は維持し、**服装だけを変更する**。

新しい服装:

- 薄い長袖シャツ
- 短いショーツ
- クルーソックス
- ランニングシューズ
- スポーツウォッチ

狙いは「元陸上選手がオフの日に襲われ、その服装のままZombie化し、Hunterへ変異した」印象を強めることである。

## 4.3 Asset要件

- Runtime Pathは既存`units/unit_hunter_zombie.png`を維持する候補とし、Core Type、Save、ObservationへAsset変更を波及させない。
- 既存の画風、透過PNG、256×256 px、低Zoom LODでの識別性を維持する。
- 長い爪等、Hunter識別に使っている既存特徴を弱めない。
- Art reference、生成Prompt、後加工記録、Asset Manifestを更新する。
- Asset変更だけでUnit性能・Hit判定・Targetingを変えない。

---

# 5. Gas Zombie追加

## 5.1 基本性能

新しいZombie Unit Typeとして`Gas Zombie`を追加する。

ユーザー指定の基本値:

| 項目 | 値 |
| --- | ---: |
| HP | 35 |
| Attack | 5 |
| Movement | 3 |
| Range | 1 |
| Vision | 3 |
| 最大Attack Charge | 1 |
| 死亡時隣接damage | 30 |

確定回答（第8問）: Rangeは現行の近接Zombieと同じ1 Hexとする。

第11問回答時のユーザー追加指定: HPを当初案の30から35へ変更する。

確定回答（第13問）: Gas ZombieはNormal AI系とする。行動Targetの優先順位は`Visible Population Target > 継承Horde Target > Noise Target > Idle`とし、有効な目標がなければ待機する。第2～7問で確定した共通の足止め・隣接部隊攻撃規則も適用する。

確定回答（第14問）: ゲーム開始時にGas Zombieを1～2体追加配置する。既存の初期Normal Zombie 25体と初期Hunter Zombie 1～4体は維持し、置き換えではなく追加とする。

確定回答（第15問）: 初期Gas Zombieは通常Zombieと同じ配置条件を使う。Capitalから地形・移動Costを含めないHex Distance 9以上、Map内、Zombie進入可能Terrain、Facility・初期Human Unit・Horde Spawn Reserve・他の初期Zombieと非重複の候補から、Seed付き抽選で重複なく配置する。

確定回答（第16問、第21問回答時の追加指定で対象Waveを限定）: 最終Waveとその1つ前のWaveだけ、非Horde Slot抽選へGas ZombieをWeight 5で追加し、Normal ZombieのWeightを70から65へ減らす。対象Waveの基礎Weightは`zombie 65 / policeZombie 10 / soldierZombie 10 / riotZombie 5 / hunterZombie 5 / gasZombie 5`（合計100）とする。それ以前のWaveではGas Zombieを抽選対象外とし、既存の`70 / 10 / 10 / 5 / 5`を維持する。標準ScheduleではTurn 35・50のみGas Zombieを抽選し、Turn 5・10・20では抽選しない。対象はTurnの固定値でなくSchedule上の最後の2件から導出し、Waveが1件だけの場合は最終Waveだけを対象とする。Hordeの総出現数は増やさずSlot内の置換とし、Rejected Bonusの追加Normal Zombieには適用しない。Weight 5はCap適用前の抽選比率5%を意味し、Cap到達後は既存規則に従って残りTypeのWeightを再正規化する。

確定回答（第17問）: Gas Zombieの出現上限はHunterと同じく、1方向・1Waveにつき最大1体とする。Scheduled／Final Waveの双方へ適用し、Gas ZombieがCapに達した後はその方向の当該Waveの残りSlot抽選から除外する。Riot／Hunterの既存Capはそれぞれ独立して維持する。

確定回答（第18問、第21問回答時の追加指定で対象Waveを限定）: Gas Zombieの出現経路は初期配置と最後の2回のHorde襲来時に限定する。初期配置1～2体は維持する。Human Unit死亡時のReanimation、施設・検問所陥落時やNoise反応による感染者由来SpawnからはGas Zombieを発生させない。既存のHuman Unit別Reanimation先と、感染者由来のNormal Zombie生成規則を維持する。

## 5.2 死亡時Gas Explosion

- Gas Zombieが死亡した時点で死亡位置をCenterとして範囲効果を解決する。
- 確定回答（第10問）: 死亡原因を問わず爆発する。別のGas Zombieの爆発で死亡した場合も連鎖爆発する。各Gas Zombieの死亡時爆発は1体につき1回だけ解決する。
- 確定回答（第19問）: Gas Zombieの死亡時は、爆発とそれに伴う連鎖爆発・感染・陥落をすべて解決してから、元の戦闘の残りの処理へ戻る。爆発等で死亡したUnitは、その後に予定されていた反撃・追加攻撃を行わない。復帰時は生存と攻撃成立条件を再評価する。爆発に伴う複数対象・Reanimation・拠点感染等の内部処理順は別途確定する。
- Centerに隣接する全Hexを対象候補とし、Hex列挙には共通`hexNeighbors`／`hexRing(center, 1)`相当を使用する。
- 隣接HexにいるHuman Unit／Zombie Unitへ30 damageを発生させる。
- 確定回答（第11問）: Unitへの爆発damageには既存のTerrain防御軽減を適用する。基礎damageは30とし、Urban上のGround Unitは×0.5、Forest上のZombieは×0.5、Urban優先・重複なしとする。Facility／Checkpointの感染はTerrainで軽減せず、各拠点で最大30人を変換する。現行の「Terrain防御は通常攻撃・反撃・迎撃だけに適用する」規則を、本更新ではGas ExplosionのUnit damageにも拡張する。
- 確定回答（第9問）: 隣接する各Facility／Checkpointにも感染被害を与える。各拠点の健常者を最大30人、同人数の感染者へ変換する（`converted = min(30, healthyPopulation)`、健常者を`converted`減らし感染者を同数増やす）。健常者がいない拠点では感染者を増やさない。建物HPへのdamageとしては扱わない。
- 第9問の感染で健常者が0になった場合は、既存の感染陥落・感染者由来Spawn規則へ接続する。複数拠点への感染、Unit死亡・Reanimation、即時占有、陥落連鎖の処理順は別途確定する。
- 敵味方を区別せず作用する。
- 同一対象へ同じGas Zombieの爆発damageを重複適用しない。
- 確定回答（第20問）: 各爆発の開始時点で範囲内に存在するUnit／Facility／Checkpointを、その爆発の対象として確定する。その爆発に伴うReanimationや陥落Spawnで新たに生成されたZombieは、同じ爆発の対象へ追加しない。別Gas Zombieの連鎖爆発では、その爆発の開始時点で範囲内に存在すれば新生Zombieも対象となる。
- 確定回答（第21問）: 1回の爆発では、まず対象の全部隊への直接damageと全拠点への直接感染を適用し、その後に死亡・Reanimation・陥落・次の連鎖爆発を順に処理する。先に処理した対象から発生する二次効果を、当該爆発の未処理対象への直接効果へ割り込ませない。第19問の「連鎖を解決してから元の戦闘へ戻る」と第20問の対象確定規則を維持する。
- 確定回答（第12問）: 熟練度用のZombie Kill Creditは、Human Unitが通常攻撃・反撃・迎撃の直接Combat Damageで倒したGas Zombieだけを既存規則に従って計上する。爆発・連鎖爆発による巻き添え撃破は熟練度用撃破数へ含めない。
- damage、死亡、Kill Credit、Reanimation、占有・感染等はv1.5.2で分離したCombat／Unit lifecycle境界を通し、UIやZombie AIからHPを直接変更しない。
- 爆発EventとPlayer-facing公開情報はFoWを破らない。

## 5.3 未確定事項

以下はユーザー指定だけでは一意に決められないため、確定前に決める。

- 日英名称、Help／Legendでの警告表現。

## 5.4 Assetの視覚コンセプト（確定）

第9問回答時のユーザー追加指定:

- 群体ではなく、単体のZombieとして描く。
- 周囲にGasを漂わせる。
- 背中を、破裂しそうなGas溜まりのように膨らませる。
- この指定はAssetの外見要件とする。常時のGasによる継続damageや感染効果は追加指定されていないため、本指定だけでゲームルールへ追加しない。

---

# 6. Army Base追加

## 6.1 施設概要

新しい恒久Facility Typeとして`Army Base`を追加する。

ユーザー指定:

- ゲーム開始時は中立状態。
- 確定回答（第39問）: ゲーム開始時のArmy BaseはWorker 0人・感染者0人とする。確保後に都市からWorkerを配置して基地の迎撃能力を持たせる。初期の専用Military Goods 40だけで、Worker不在の基地が迎撃することはない。
- Map内に最大1施設。
- Player Unitを派遣して確保できる。
- ゲーム開始からTurn 20以内に確保した場合、Regular熟練度のNational Guardを1 Unit無料で獲得する。
- 現時点でArmy Baseから編成可能なUnitはNational Guardだけ。
- Worker Capacityは10。
- 確定回答（第52問）: Army Baseが保持する健常人口は配置Workerだけとし、都市のような一般住民の受入先にはしない。Workerとは別の住民Poolを設けず、避難民の都市配置や都市間移住の受入先にも含めない。Workerの配置・撤収は第38問の規則に従い、感染者は既存の施設感染Poolで管理する。
- 確定回答（第53問）: ZombieはArmy Baseも通常施設と同じく、健常Workerが1人以上なら既存の視界・経路条件に従ってPopulation Target候補とし、0人なら人口目標へ選ばない。候補人口には健常Worker数を使い、感染者・専用軍需品・編成待ち人口を加算しない。人口目標に選ばれなくても移動経路上で基地へ到達する場合はあり、その場合も基地到達時の規則を適用する。
- 確定回答（第40問）: Army BaseのVision RadiusはWorker 0人なら1 Hex、1人以上なら5 Hexとする。1～10人の間では人数による追加拡大・縮小を行わない。
- 確定回答（第41問）: Army Baseの視界は通常施設と同じGround Visionとし、森林・山による既存の地上視界の遮蔽規則を適用する。
- 確定回答（第42問）: Army BaseはPlayer所有かつ未陥落の場合に視界を提供する。感染中・停止中・復旧中でも、第40・41問のWorker数に応じたGround Visionを維持する。中立または陥落中の基地はPlayerへ視界を提供しない。
- Army Base自体がRange 2、Attack 10の迎撃能力を持つ。
- 迎撃可能回数は配置Worker数と同値。
- Army Base迎撃が発生した場合、Noise Radius 8のNoise判定を発生させる。
- Army Base固有Military Goods Poolを40持つ。
- Army Base迎撃1回につき固有Military Goodsを2消費する。

## 6.2 早期確保報酬

- 確定回答（第23問）: Playerによる確保成立時のTurnが`turn <= 20`であることを早期確保条件とする。Turn 20を含み、Turn 21以降は早期確保報酬の対象外とする。
- 条件成立時、Regular National Guard 1 Unitを無料獲得する。
- 確定回答（第27問）: 報酬のNational GuardはArmy Baseを確保した直後に出現し、そのPlayer Turnから移動・攻撃できる。通常編成のように次Player Turn Startまで完成を待たない。
- 確定回答（第50問）: 早期確保報酬の無料National Guardは電力不要とし、Supply内であることも条件にしない。停電中やSupply外でもTurn 20以内の確保直後に獲得できる。通常編成の電力需要5や未給電による完成延期はこの報酬へ適用しない。1ゲーム1回の制限と、Fuel 22・携行Military Goods 20を備蓄消費なしで満載する規則は維持する。
- 確定回答（第24問）: 無料National Guard報酬は1ゲームにつき1回だけ取得できる。取得済み状態は陥落・再確保でリセットせず、Turn 20以内の再確保でも再取得できない。Save／Loadでも取得済み状態を維持する。
- 「無料」は少なくとも通常の編成Population／Civilian Goods／Military Goods Costを支払わないことを意味する。
- 確定回答（第25問）: 報酬のRegular National GuardはFuel 22・携行Military Goods 20を満載した状態で獲得する。この初期搭載分は国家備蓄から差し引かず、Army Base固有Military Goods Poolも消費しない。通常編成の完成時Fuel有償補給とは区別する。

次の点は確定前に明示する。

- 確定回答（第26問）: 報酬のNational GuardはArmy BaseのHexへ配置する。確保に来たUnit等で埋まっている場合は、通常編成完了時と同じ配置規則で、最寄りの配置可能な空きHexへ配置する。同距離の候補はSeed付き抽選で選ぶ。

## 6.3 National Guard編成

確定回答（第44・50問）: Army BaseではNational Guard等の通常Unit編成だけに電力を必要とする。視界と基地自身の迎撃は電力がなくても機能し、未給電を理由にそれらを停止しない。所有・感染・稼働状態・Worker・Supply等の各機能の条件は引き続き適用する。電力要件はArmy Baseでの通常編成に適用し、他施設の既存編成規則を本回答だけで変更しない。早期確保報酬は電力不要とする。

確定回答（第45問）: Army BaseのUnit編成に必要な電力量は5 Electricityとする。

確定回答（第49問）: Army Baseへの給電順位は既存施設の後の最後とする。共通Economy Planの配分順は、Capital／City → Farm／Civilian Factory → 入力確保済みMilitary Factory → Refinery → Civilian Drone Base → Army Baseとする。既存施設間の順位を維持し、基地の編成需要は残りの供給可能電力から割り当てる。

確定回答（第46問）: Army Baseの電力需要5は通常編成の予約があるTurnだけ発生する。通常編成の予約がないTurnは電力を要求・消費せず、Worker数や視界・迎撃の稼働だけを理由に電力需要を発生させない。

確定回答（第47問）: 通常編成を予約した後、Turn終了時の電力配分でArmy Baseへ必要な5 Electricityを供給できなかった場合は完成を延期する。予約と支払い済みの人口・物資を保持し、停電を理由に取消・返金・再徴用・再請求しない。未完成の予約は次Turn以降も電力需要を発生させ、必要電力を供給できたTurnの次Player Turn Startに完成する。

確定回答（第48問）: 予約時点で電力不足の見込みでも、他の編成条件を満たしていれば予約を受け付ける。電力不足を予約拒否理由にせず、予約前に完成延期の可能性を警告表示する。警告は当該予約による需要5を含む共通Economy Planの見込みに基づき、実際の完成・延期は第47問のTurn終了時の給電結果で判定する。

- Army BaseではNational Guardだけを編成可能にする。
- Army Baseへ配置したWorkerは施設迎撃能力に使い、National GuardのPopulation Costそのものとして消費しない。基地Workerは徴用対象から常に除外し、都市から必要人口を徴用できない場合も代用しない。
- National Guard編成時に必要なPopulationは、必要人口を持つPlayer所有Cityから差し引く。
- 通常のNational Guard編成Cost、Fuel補給、熟練度規則、完成Unit生成処理を再利用する。完成Timingは通常の次Player Turn Startを基本とし、第47問の未給電による延期を追加する。
- 確定回答（第38問）: Army BaseでのWorker増員とNational Guardの通常編成予約は、既存施設と同じくSupply内で安全かつ操作可能な状態の場合だけ許可する。Supply外、感染中、停止中、復旧中等の操作不能状態では増員・編成予約を許可しない。操作可能になるTurnの判定も既存規則に従う。

確定回答（第28問）: Army Baseの通常National Guard編成は既存編成と同じ都市供給順位を使う。ターン開始時の都市人口降順、同数ならFacility ID昇順で、人口供給資格を持つPlayer所有のCapital／Cityから自動徴用する。感染等で供給不能な都市は除外し、最後の健全民間人口を使う編成は禁止する。都市から必要人口を徴用できなければ編成を拒否し、基地Worker・資源・Action回数等を変更しない。基地Workerを不足分の補填に使う経路は設けない。

確定回答（第67問）: Army Baseが陥落した場合、その基地の未完成の通常編成予約は没収として取り消す。支払い済みの徴用人口・Civilian Goods・Military Goodsは返還せず、Unitも完成させない。再確保しても没収した予約を復活させない。この没収は未完成の編成予約に関するものであり、第37問の基地専用Military Goods残量の保持は変更しない。

確定回答（第68問）: 陥落に至っていない感染・停止・復旧中は、未完成の通常編成予約と支払い済みの人口・物資を保持し、正常稼働と給電が戻るまで完成を延期する。延期を理由に再徴用・再請求せず、陥落した場合だけ第67問の没収へ移行する。完成判定時にも基地の状態と予約の存続を確認し、給電後でも完成前に感染・停止・陥落した予約を無条件に完成させない。

## 6.4 Army Base迎撃

確定回答（第43問）: Army BaseはPlayer所有かつ正常稼働中で、Workerが1人以上、残り迎撃回数が1以上、専用Military Goodsが2以上の場合に、施設自身を攻撃SourceとしてZombieへ迎撃を行う。中立・感染中・停止中・復旧中・陥落中は迎撃しない。Supply内であることは迎撃の必要条件にせず、Supply外でも他の成立条件を満たせば迎撃できる。

確定回答（第35問）: Army Baseに感染者が1人でも発生した場合、鎮圧して復旧するまで基地自身の迎撃を停止する。Gas Explosion等で迎撃途中に感染した場合も、その時点で残りの迎撃を中止する。迎撃回数や専用Military Goodsが残っていることを理由に感染中の迎撃を許可しない。

確定回答（第51問）: 基地自身の迎撃に対してZombieの通常Counterattackは発生させない。基地Hex上で迎撃を生き残ったZombieによる基地への被害は、第29・30問の感染処理として解決する。駐留Human Unitとの戦闘には既存の攻撃・反撃規則を適用し、基地自身の迎撃とは区別する。Gas Zombie死亡時の爆発・感染は通常Counterattackではなく、第9～21問の規則で解決する。

基本値:

- Range: 2 Hex
- Attack: 10
- 迎撃回数上限: 配置Worker数
- Military Goods Cost: 1迎撃につきArmy Base Poolから2
- Army Base Military Goods Pool上限候補: 40
- Noise Radius: 8

確定回答（第31・32問）: Army BaseのHexへ到達する前に、基地からHex Distance 1～2で基地の迎撃を受けたZombieは、既存Human Unitの迎撃と同じくその地点で移動を終了する。この距離での基地迎撃はZombie 1体の1回の移動につき1回だけとする。残り迎撃回数を使う連続迎撃は、基地Hexへ到達した場合だけ第30問の規則で行う。

既存Human UnitのInterceptionと同じ距離判定・damage・Terrain処理を可能な限り共通Combat Queryへ寄せる。ただしFacilityはUnitではないため、Attack Charge、熟練度、Fuel、自然回復を無理にUnit型へ擬態させない。

第29問回答時のユーザー追加指定・確定回答（第30問）: Army BaseのHex上へ到達したZombie 1体に対し、そのZombieを撃破するか、基地の残り迎撃回数が0になるか、固有Military Goodsが1迎撃分の2未満になるまで連続迎撃する。各迎撃で残り回数1と固有Military Goods 2を消費し、1体に残り回数を使い切ることもある。迎撃判定をすべて行った後もZombieが生存している場合に基地への感染を処理し、感染を迎撃より先に適用しない。死亡時Gas Explosionによる感染は第9～21問の別効果として扱う。各迎撃後には基地と対象の状態を再評価し、迎撃不能になった場合は続行しない。

確定回答（第54問）: 基地Hex上で迎撃を生き残ったZombieによる感染は、通常施設と同じく`converted = min(zombie.attack, healthyWorkers)`とする。健常Workerを`converted`減らし、基地の感染者を同数増やす。例えばAttack 5・健常Worker 8人なら5人を変換する。Gas Zombieの死亡時爆発による最大30人の感染は、この到達時感染とは別効果とする。

確定回答（第55問）: 感染によってArmy Baseの健常Workerが0人になった場合は陥落する。既存の恒久施設と同じく、陥落時の実感染者5人につきNormal Zombie 1体、1解決最大6体を隣接Hexへ生成する。配置候補、配置不能時の残存感染者保持、生成成功1体につき感染者5人を減らす処理、即時占有・FIFO連鎖は既存の共通規則を使用する。Army Baseは恒久施設として残り、専用Military Goodsは第37問どおり保持する。

確定回答（第56問）: 健常Workerと感染者がともに0人のArmy BaseをZombieが占有した場合、感染者を新たに増やさず停止状態（disabled）にする。この空基地占有だけを原因とする感染者由来Spawnは発生させない。基地は恒久施設として残り、再確保・復旧まで通常編成や軍需品自動補充を利用できない。視界は第42問の所有・未陥落条件に従い、専用Military Goodsの残量を保持する。

確定回答（第57問）: 停止・陥落したArmy Baseは、基地Hex上のZombieを排除し、感染者を0人にしてHuman Unitで再確保した後、次のPlayer Turnから正常稼働へ戻る。再確保後は復旧中として扱い、正常稼働への復帰時のWorkerは0人とし、都市から改めて配置する。専用Military Goodsの残量と早期確保報酬の取得済み状態は維持する。

確定回答（第58問）: 同じ地点でHuman UnitとArmy Baseの両方が迎撃できる場合は、先にHuman Unitの迎撃とZombieの反撃を既存規則で解決する。その後もZombieが生存し、基地側の迎撃条件を満たしていればArmy Baseも迎撃する。基地迎撃の回数は距離1～2なら第31・32問、基地Hex到達時なら第30問に従う。各Combat中のGas Explosionと連鎖は第19～21問どおり解決し、その結果を反映して後続の迎撃成立条件を再評価する。足止め後のZombieの追加攻撃は、この一連の迎撃を解決した後に第3～5問の条件で判定する。

## 6.5 Army Base固有Military Goods Pool


- Army Baseは国家備蓄とは別にMilitary Goods Poolを持つ。
- 初期／最大値として40が指定されている。
- 確定回答（第37問）: Army Baseが陥落しても専用Military Goodsの残量を保持し、再確保・復旧後に再利用できる。陥落・再確保・復旧で残量を初期値40へ戻さず、不足分は第33・34・36問の通常自動補充で補う。Save／Loadでも保持する。
- 迎撃1回ごとに2減少する。
- Pool不足時の迎撃成立条件をCore Queryと実処理で共通化する。
- Facility固有状態としてSave／Load／Replay／Observation／Agent APIへの公開範囲を検討する。

確定回答（第33問）: Player所有のArmy BaseがSupply内にあり、第36問の稼働条件を満たす場合、毎ターン国家備蓄のMilitary Goodsから専用Poolを最大40まで自動補充する。国家備蓄から実補充量を差し引き、不足時は補充可能な分だけ補充する。Supply外では自動補充しないが、残っている専用Military Goodsによる迎撃は可能とする（他の迎撃成立条件は満たす必要がある）。

確定回答（第36問）: 軍需品自動補充は、補充判定時にPlayer所有・正常稼働中・Supply内のすべてを満たすArmy Baseだけを対象とする。中立・感染中・停止中・復旧中・陥落中は補充せず、国家備蓄も消費しない。

確定回答（第34問）: Army Baseへの自動補充は、毎ターンの既存Human UnitへのMilitary Goods補充をすべて終えた後、国家備蓄の残量から行う。備蓄不足時はHuman Unitへの補充を優先し、基地用の先取り予約やUnit補充との同順位配分は行わない。

## 6.6 Workerと迎撃回数

Worker Capacityは10とする。

確定回答（第29問）: 毎回のZombie Phase開始時に、その時点の配置Worker数まで迎撃回数を回復する。前Phaseの未使用回数は加算・繰越しせず、現在のWorker数を新しい上限とする。

残る確認事項:

- 基地自身の迎撃回数と駐留Human UnitのAttack Chargeは別管理とし、駐留Unitの攻撃・反撃で基地の迎撃回数を消費しない。基地迎撃に対するZombieの通常Counterattackは第51問で発生しないと確定。
- 確定回答（第64問）: Zombie Phase途中でWorkerが減った場合、残り迎撃回数を`min(変更前の残り迎撃回数, 現在の健常Worker数)`へ切り下げる。例として残り5回・Worker 3人なら残り3回とする。感染が発生した場合は第35・43問どおり残り回数にかかわらず迎撃を停止する。Worker増加を理由に迎撃回数を途中回復せず、回復は第29問のZombie Phase開始時に行う。

確定回答（第38問）: Facility Workerの配置・撤収は既存`AssignWorkers`、人口所在地、感染、操作可能Turnの規則を再利用する。増員にはSupply内の条件を必要とし、Supply外の撤収は既存の帰還条件に従って許可する。

## 6.7 Army Base Noise

- Army Baseによる実際の迎撃Combat 1回につきNoise Radius 8判定を発生させる。
- 確定回答（第65問）: 基地の迎撃1回ごとにRadius 8のNoise Pulseを発生させ、既存Human Combat Noiseと同じ`pendingNoisePulses`／次Zombie Phase評価の仕組みを再利用する。通常AI系Zombieが移動Targetとして反応するのは次のZombie Phaseからとする。基地Hexでの連続迎撃も実迎撃1回ごとに1 Pulseを発生させる。
- Player-facing UIでは既存Noise公開方針に合わせ、Hidden Zombie Target等を漏らさない。

Army Base NoiseをHuman Combatと同じNoise Class表現にするか、施設固有Source Typeとして公開するかは未確定。

## 6.8 配置方式（確定）

現行v1.5.2は`fixed-51x51-v1`の51×51固定Mapで、29恒久FacilityのID・Type・座標を固定定義している。

確定回答（第22問）: Army Baseは安全性と到達性を検証済みの複数候補Hexから、新規ゲーム時にSeed付き抽選で1か所を選ぶ。他のTerrainと既存29恒久Facilityの配置は維持する。新規ゲームでは30番目の恒久Facilityとして中立Army Baseを1施設配置する。

確定回答（第66問）: Army Baseの配置候補はCapital周辺の初期Supply圏（標準Radius 5）の外に限定する。標準ConfigではCapitalからHex Distance 6以上とし、初期Supply圏内には配置しない。Worker配置・通常編成にはSupply圏拡張が必要となるが、早期確保報酬は第50問どおりSupply外でも獲得できる。

候補Hexの安全性・到達性・施設非重複、PRNG順、Map ID、Save validation、Agent metadata、Session replayの整合を検証する。具体的な候補座標は第22・66問の条件に基づいて整理する。旧通常Saveは第61問どおり移行対象外とする。

## 6.9 Army Base Assetの視覚コンセプト（確定）

確定回答（第59問）: フェンスに囲まれた兵舎・格納庫・監視塔を配置した外観とする。小さく表示しても都市やMilitary Factoryと区別できる見た目にする。これらは外観要素であり、個別建設物や追加機能として扱わない。

## 6.10 その他未確定事項

- 確定回答（第69問）: Player所有のArmy Baseの健常Workerも、健全民間人口0による敗北判定の生存人口に含める。都市や他の生産施設の健常者が0人でも、基地に健常Workerが残っていれば人口全滅による敗北とはしない。感染者や編成待ち人口は含めず、州都陥落等の他の敗北条件は維持する。総人口・敗北予測・最後の健全民間人口保護を共通の人口判定と整合させる。ただし第28問の基地Worker徴用禁止は維持する。
- 確定回答（第70問）: 感染・停止・復旧中のArmy Baseは、未完成の通常編成予約を保持したまま電力需要を0にする。正常稼働へ戻ってから必要電力5を再び要求する。異常状態で編成用電力を割り当てて消費しない。


- Legend、Help、Facility Sheetでの迎撃残回数・Military Goods表示（Board Assetの外観は第59問で確定）。

---

# 7. Power Plant Fuel消費変更

現行v1.5.2では、Wind Power Plant供給で不足する実割当5 ElectricityごとにTurn-start State Fuel 1を消費する。

v1.5.3ではこのFuel Costを**1から2へ増加**する。

候補となる明文化:

- Wind供給で足りない実割当5 ElectricityごとにTurn-start State Fuel 2を消費する。
- 利用可能なPower Plant由来電力は、Fuel 2単位につき5 Electricityとして算定する。
- 余剰発電CapacityにはFuelを消費しない。
- Wind Power Plantは引き続きFuel不要。
- 当TurnのRefinery生産Fuelは引き続き同Turnの発電へ使わない。
- 発電後に残ったFuelをHuman Unit補給へ回す既存順序を維持する。
- Forecast、Strategic Forecast、EndTurn実処理、Human HUD、Agent Queryは同じEconomy Planから新Costを取得する。

確定回答（第60問）: Power Plantは5 ElectricityにつきFuel 2を必要とし、Fuel 1で2.5 Electricityを作る部分発電は行わない。Fuelが1しか残っていない場合はPower Plant由来の発電に使わず残す。余りのFuelは既存の処理順に従って、その後のHuman Unit補給に利用できる。Fuel制約によるPower Plantの利用可能電力は`floor(turnStartFuel / 2) × 5`を上限とし、物理発電Capacityと実際の割当需要も適用する。Wind Power Plantは引き続きFuel不要とする。

---

## 7.1 追加要望: 各支線の避難民到着数を2倍にする

- 2026-09-06のユーザー追加指定として、各支線の避難民の来る数を現行の2倍へ変更する。
- 現行は各支線で2～4ターンごとに1回5～10人が到着する。
- 確定回答（第1問）: 各支線の到着間隔は現行の2～4ターンを維持し、1回の到着人数を10～20人（両端・奇数を含む整数）へ変更する。現行の抽選人数を2倍して偶数だけにする方式は採用しない。
- 到着終了、Checkpoint不在時の受入、審査、感染、維持費、拒絶者によるHorde強化との関係を確定要件で明示する。

---

# 8. Core設計方針

v1.5.3ではv1.5.2で準備した境界を利用する。

```text
UI / Headless / Agent / Session
          ↓ 公開Query / GameAction
GameEngine: 検証 → 作業状態 → 処理順制御 → 不変条件 → commit
          ↓
Combat / Movement / Unit lifecycle / Economy / Zombie AI
          ↓
Unit catalog / Map reference / Terrain / Hex / RNG / JSON型
```

- Zombie足止めはMovementの1 Hex進入処理へ置き、Hunter専用分岐にしない。
- Gas Zombieの死亡爆発はUnit lifecycleから共通damage適用へ接続し、個別ActionからHPを直接減らさない。
- Army Base迎撃はCombat Query／適用を再利用するが、FacilityをHuman Unitとして偽装しない。
- Power Plant Cost変更はEconomy Planを正本にし、Forecast専用計算を作らない。
- Unit／Facilityの新Typeはcatalog／Config／型／validation／Agent公開／Asset Registryを一貫して追加する。
- 新しい範囲効果のためにPhaser Boardをルール判定源にしない。範囲Hex・対象・damageはCoreが決め、UIはProjectionを描画する。

---

# 9. Human UI・Help・Agent公開

## 9.1 Human UI

- Unit編成Sectionの整理を日本語・英語の双方へ反映する。
- Gas Zombieは可視時にType、HP、Attack、Movement、Range、Visionと死亡時危険性を確認できるようにする。
- Army Base Sheetは所有状態、Worker、迎撃能力、迎撃残回数、固有Military Goods、National Guard編成入口、早期確保報酬の状態を表示する候補とする。
- Power Plant SheetとPower ForecastはFuel 2 Costを反映する。
- Hunter Zombie Assetだけの変更は数値UIを変えない。

## 9.2 Help／Board Legend

- Gas Zombieの死亡爆発を日英で説明する。
- Army Baseの確保報酬、National Guard編成、Worker迎撃、固有Military Goods、Noiseを説明する。
- Power Plantの発電Fuel CostをConfig／Forecast由来で表示する。
- Hunter Zombieの説明数値は据え置き、Assetの服装変更をゲームルールとして説明しない。

## 9.3 Agent／Browser Bridge

新Unit／Facilityの追加によりAgentが合法手と公開危険性を判断できるようにする。ただしHidden情報を追加公開しない。

- Visible Gas Zombieの公開基本性能と、死亡時爆発の公開可能な範囲・damageを返す。
- Army BaseのPlayer-visible状態、編成可能Unit、固有Military Goods、迎撃可能性を必要範囲で公開する。
- Zombie足止め規則を合法Move／Threat Projectionと一致させる。
- Power Forecastは新Fuel CostをHuman／Agentで共有する。

Observation／Agent／Artifact／Session schema Versionを上げる必要があるかは、最終的な公開field追加内容を確定後に決める。

---

# 10. Save・互換性・Version

v1.5.3ではGas Zombie Type、Army Base Facility Type、Army Base固有Military Goods／迎撃状態等がGameStateまたはConfigへ追加される可能性が高い。

確定回答（第61問）: v1.5.3は新規ゲーム専用とし、v1.5.2以前の通常Saveは読み込み対象外とする。旧Saveは変更・削除せず保持し、読み込み時にVersion非対応を明示して現在のゲーム状態を変更せず拒否する。旧MapへのArmy Base追加、旧Saveの編成待ち状態の変換等の移行処理は作らない。新規ゲームからv1.5.3のMap・ルールを使用する。

残るVersion・互換方針:

- Game Rules／GameState／Config Version、Fixed Map ID、Save Format、Observation、Artifact、Session／Checkpoint Versionのうち、実際に契約が変わるものだけを更新する。
- 確定回答（第62問）: AI Session／Replay／Artifactもv1.5.2以前からの移行対象外とし、v1.5.3で新規開始する。旧AIデータは変更・削除せず保持し、読み込み時はVersion非対応を明示して状態不変で拒否する。旧SessionのCheckpointからの復元も旧データ移行経路にはしない。v1.5.3内のSave／Load／Session再開／Replay一致は検証対象とする。

互換性のために新fieldを黙って推測補完したり、旧Saveを無断で削除・上書きしたりしない。

---

# 11. 主要受入テスト候補

## 11.1 UI

- Police／National Guard／Riot Policeの編成表示が同一形式でCostを表示する。
- Riot PoliceだけButton内表示が特殊にならない。
- 編成Accordionの開閉、44 CSS px以上の操作域、`aria-expanded`、日英表示。
- 各Facilityで合法なUnitだけを表示／有効化し、Core Reasonと一致する。
- Army BaseのNational Guard編成も同じUI Componentを利用する。

## 11.2 Zombie足止め

- Attack ChargeありHuman Unit隣接経路で従来迎撃＋停止が成立する。
- Attack Charge 0でもZombieが最初の隣接Hexで停止する。
- Hunter Zombieが高Movementでも経路上のPlayer Unit近傍を通過して遠方Targetへ直行しない。
- 複数Player Unit、複数同Cost経路でも決定性を維持する。
- 足止めだけでHuman UnitのCharge／Military Goods／Fuelを消費しない。
- Noise、Target memory、Eventの順序が確定仕様と一致する。

## 11.3 Gas Zombie

- HP 35、Attack 5、Movement 3、Range 1、Vision 3、Charge 1。
- 死亡位置の隣接6 Hexだけへ範囲効果を発生し、Distance 2へ漏れない。
- 敵味方共通damage 30。
- Unitへの基礎damage 30に既存Terrain防御を適用し、該当するUrban／Forestでは15となる。Facility／Checkpointの感染は地形にかかわらず最大30人とする。
- 盤端で存在しないHexを安全に除外する。
- 複数対象・同Hex占有規則・死亡順・連鎖を確定仕様どおり処理する。
- FoW外の爆発結果からHidden Unit位置を漏らさない。
- Save／Load／ReplayでGas Zombieと爆発結果を再現する。

## 11.4 Army Base

- 初期中立、最大1施設。
- Turn 20以内の確保報酬と期限後の非報酬。
- Regular National Guard無料取得のCost／Fuel／Military Goodsが確定仕様と一致する。
- Army BaseからNational Guardだけ編成できる。
- Population供給元Cityが確定仕様どおり選ばれ、最後の健全民間人口等の既存不変条件を破らない。
- 都市の徴用可能人口が不足し、基地Workerを加えれば必要人口を満たす場合でも編成を拒否する。拒否によって基地Worker・都市人口・資源・Action回数等を変更しない。
- Worker 0～10と迎撃回数上限が一致する。
- Range 2境界、Attack 10、Military Goods 2消費、Pool 40境界。
- Pool不足、Worker不足、感染／停止／Supply等の不成立理由。
- Army Base迎撃Noise Radius 8と次Zombie Phase反応。
- Save／Load／ReplayでPool、Worker、報酬取得済み状態、迎撃状態を再現する。

## 11.5 Power

- Wind不足分5 ElectricityあたりFuel 2を消費する。
- Fuel不足時の利用可能発電量、未給電Facility、Unit補給残Fuelを正しく計算する。
- Forecast／EndTurn実績一致。
- Refineryの当Turn生産Fuelを同Turn発電へ使わない。

## 11.6 Asset

- Hunter ZombieのRuntime Path、PNG Decode、256×256、透過、LOD、Manifest。
- 既存の長い爪等のHunter特徴を維持し、服装だけ指定内容へ更新する。
- Gas Zombie、Army Baseへ新規Assetを追加する場合、Registry／Legend／Fallbackを同期する。

---

# 12. 確定前に回答が必要な事項

1. 【確定・第2問】Zombie足止めはHorde Zombieを含む全Zombie Typeへ適用する。
2. 【確定・第3問】足止めしたZombieが攻撃可能な場合、隣接Player Unitへ攻撃対象を切り替え、その場で攻撃する。
3. 【確定・第8問】Gas ZombieのRangeは1 Hex。
4. 【確定・第9問】隣接Unitへ30 damage。隣接する各Facility／Checkpointでは健常者を最大30人、同人数の感染者へ変換する。健常者0なら感染者を増やさない。
5. 【確定・第10問】Gas Zombieは死亡原因を問わず爆発し、別Gas Explosionによる死亡でも連鎖爆発する。
6. 【確定・第11問】UnitへのGas Explosionには既存Terrain防御を適用する。Facility／Checkpointの感染は軽減せず最大30人。
7. 【確定・第13～17問、第21問追加指定】Gas ZombieはNormal AI系で、通常Zombieと同じ配置条件（CapitalからHex Distance 9以上等）で初期配置に1～2体追加する。最後の2回のHordeだけ非Horde SlotへWeight 5で追加し、Normal Zombieを65へ減らす。それ以前はGasを除外してNormalを70に維持する。Gas ZombieのCapは1方向・1Waveにつき最大1体。
8. 【確定・第22問】Army Baseは検証済み候補地点から新規ゲーム時にSeed付き抽選で1か所を選ぶ。他の地形・既存施設配置は維持する。
9. 【確定・第23・24問】Army Base早期確保報酬はTurn 20を含み、1ゲームにつき1回だけ。陥落・再確保で再取得しない。
10. 【確定・第25問】無料National GuardはFuel 22・携行Military Goods 20を満載し、国家備蓄から差し引かない。
11. 【確定・第28問】既存のターン開始時都市供給順位で自動徴用する。基地Workerは常に対象外で、都市人口不足時も代用せず編成を拒否する。
12. 【確定・第29問】毎回のZombie Phase開始時に、その時点の配置Worker数まで迎撃回数を回復する。
13. 【確定・第33・34・36問】Player所有・正常稼働中・Supply内の基地だけ、毎ターン既存Human Unitへの軍需品補充後の国家備蓄から最大40まで自動補充し、不足時は部分補充。中立・感染・停止・復旧・陥落中やSupply外は補充しない。Supply外でも他の迎撃条件を満たせば残量で迎撃可能。
14. 【第40～42問確定】Vision RadiusはWorker 0人なら1、1人以上なら5で、森林・山の遮蔽を受けるGround Vision。Player所有かつ未陥落なら感染・停止・復旧中も視界を維持する。【第35・43問確定】基地迎撃はPlayer所有かつ正常稼働中で、Worker・残り回数・専用軍需品の条件を満たす場合だけ可能。Supply外でも可能だが、中立・感染・停止・復旧・陥落中は不可。【第38問確定】Worker増員・通常編成予約はSupply内で安全かつ操作可能な場合だけ許可し、Supply外の撤収は既存の帰還条件に従う。
15. 【確定・第60問】Fuel 1での部分発電は行わず、Power Plant由来の発電には使わず残す。残量は後続の既存Unit補給に利用可能。
16. 【確定・第61問】v1.5.3は新規ゲーム専用。v1.5.2以前の通常Saveは変更・削除せず保持し、Version非対応として状態不変で拒否する。移行処理は作らない。

---

# 13. 作業順候補

1. 本ドラフトの未確定16項目を一問一答で確定する。
2. v1.5.3のSave／Map互換方針とVersion境界を確定する。
3. Unit編成UI整理とHunter Asset更新を、ルール変更から独立して先に実施可能にする。
4. Zombie足止めをMovement共通処理へ実装し、既存Zombie AI／Horde／Noise回帰を確認する。
5. Gas ZombieをUnit catalog、Config、Combat／lifecycle、AI、公開Projectionへ追加する。
6. Army BaseのMap／Facility State／Combat／Economy／UI／Saveを追加する。
7. Power Plant Fuel Costを共通Economy Planで変更する。
8. Headless、Human UI、Agent、Save、Replay、Session、Browser Bridge、Asset、固定Seed回帰をまとめて検証する。
9. 実装・検証完了後に現行仕様へ反映し、本ドラフトを確定版へ更新する。

性能面ではv1.5.2の改善を維持し、新しいGas Explosion、Army Base迎撃、Zombie足止めによってHuman UIの主要操作やZombie Phaseが明らかに退行しないことを固定fixtureで確認する。新機能実装を理由に盤面全再構築、毎Action autosave、全Agent Observation依存等のv1.5.1以前の重い構造へ戻さない。
