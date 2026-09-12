# Nowhere Left to Hide

## PoC 現行仕様

- ステータス: 現行正本
- 現行Version: v1.5.7
- 基準日: 2026-09-12
- 実装照合日: 2026-09-12
- 直近の反映済み変更要件: `Nowhere Left to Hide PoC v1.5.7 アップデート要件 確定版.md`

本書は現在の実装が従う唯一の正本である。実装、テスト、ヘルプ、保存形式が本書と矛盾する場合は本書を優先する。過去の資料は現行判断には使用しない。v1.5.7の実装と検証状況は18.7に記録する。

---

# 1. 目的と優先指標

ゾンビ流行下の架空のアメリカ風州を舞台に、スマートフォンおよびPCブラウザで遊べるターン制ヘックスストラテジーPoCを実装する。

検証する中心体験:

> 限られた人口・部隊・物資で領土と生産力を拡大したい一方、人口増加・感染・防衛範囲拡大によってリスクも増える。予告されるHordeを見据え、「何を確保し、何を守り、何を諦めるか」を考えることが面白いか。

判断に迷う場合は次を優先する。

1. 現在の安全と将来の生産力のトレードオフ
2. 位置、射程、Horde予告を使う計画性
3. スマートフォン縦画面での理解・操作性
4. 演出量よりゲーム状態の可読性
5. UI上の便宜的な直接変更よりGameActionとGameEngineによる一貫した状態遷移

---

# 2. 実装範囲

## 2.1 必須

- 51×51固定ヘックスマップ、29静的恒久施設とSeedで決まるArmy Base 1基、4方向の道路支線とHorde入口
- 固定Terrain、重み付き移動、Urban／Forest防御
- Human Unit・管理施設を合成したVisionとFog of War
- PCおよびスマートフォン縦向き
- Police・National Guard・Riot Policeの熟練度、Attack Charge、移動、攻撃、反撃、迎撃、待機、自然回復
- Gas Zombieを含む6種Normal AI系ZombieとHorde ZombieのAI、施設感染、鎮圧、陥落、復旧、Human Unit損失時のReanimation
- 所在地を持つ民間人口、都市、生産施設、5資源、過密
- Police・National Guard・Riot Policeの追加編成
- 道路支線ごとの複数Checkpoint Post、Fallback、避難民、審査、Queue維持費、Turn Away、潜伏感染
- Human CombatとHorde実移動がNormal AI系Zombieと陥落拠点へ作用する共通Noise Pulse
- Horde予告、出現、戦闘、勝敗
- Seed付き乱数と主要値のConfig化
- ローカル自動保存、セーブコード、JSON保存・復元
- 日本語・英語切り替え（デフォルト日本語）
- 初回ガイド、常設ヘルプ、終了統計
- UI専用Asset Registryを使う盤面用2D Asset、個別Fallback、低Zoom LOD、Board Legend
- Phaserなしで進行できるHeadless Game Interface
- 公開情報だけを返すAgent ObservationとAgentGame Adapter
- 共通Runnerを使う決定的なRandom Test AgentとBalanced Agent
- 同一Seed比較、Metrics、Replay／Failure Artifact、JSON／CSV出力を持つBatch Simulation CLI
- 通常UI・保存領域と分離したDeveloper / Browser Bridge
- 外部AIが複数プロセスで継続できるAI Portable Session、Public Decision Log、Checkpoint、分岐、Artifact
- タイトルから公開ZIPを開く、コメント付きの読み取り専用AI観戦
- Unit Test、不変条件試験、複数Seed自動完走試験
- GitHub Actionsによるテスト、ビルド、GitHub Pages公開

## 2.2 対象外

- ランダムマップ、Terrain自動生成、高低差、Waterを使う標準Map
- 外部LLM自体の同梱、`balanced`以外の組み込みStrategy
- AI観戦、AI思考表示、After Action Report、Browser BridgeからのBatch実行
- 強化学習、Minimax、MCTS、人間より強いAIの保証
- リアルタイム操作、大量個体描画、複雑な基地建築
- 完成品相当のアート、アニメーション、音響

---

# 3. 技術境界

- TypeScript、Phaser、Vite、HTML5 / WebGL / Canvasを使用する。
- Game CoreはPhaser、DOM、描画、入力へ依存させない。
- UIはGameStateをRead Onlyで参照し、変更は必ずGameActionをGameEngineへ渡す。
- UI、Headless、Test Agentのために別ルールや別状態変更経路を作らない。
- AgentはGameStateを直接参照せず、AgentObservationと合法手だけからActionを選ぶ。
- GameState、Config、Action、EventはJSON化可能にする。
- ゲームルール内で`Math.random()`を使用しない。
- 依存物は原則MIT、Apache-2.0、BSD、ISC等の許諾的ライセンスに限定し、第三者通知を保存する。

```text
UI / Phaser / Test Agent
          ↓ GameAction
       GameEngine
          ↓
       GameState
          ↓ Read Only
UI / Phaser / Test Agent
```

---

## 3.1 読み取りと計算境界

- `GameEngine.getQuery()`は確定Revisionに対応する読み取り専用Providerを返す。合法手、対象別合法手、視界、Supply、Forecast、移動・攻撃Projection、建設候補を共有し、返却値の変更で内部State／cacheを壊せない。受理step・reset・new・LoadでRevisionを更新し、失効Queryは冷／温どちらでも拒否する。未確定候補Stateを長寿命cacheへ登録しない。
- UIは必要な公開Unit／Facility／Checkpoint／Tileを共通の純粋Projectionから取得し、部分表示のために全Agent Observationを再生成しない。Core Queryは描画、保存、RNG消費、Event追加を行わない。
- Combat／Movement／Unit Lifecycleは限定的な内部効果処理へ分け、GameAction→GameEngine以外から状態変更しない。経済計画・公開Projection・移動QueryはEngineへ逆依存しない。10 Unit定義と列挙順をcatalogへ集約し、Gasの死亡キュー、Army Baseの予約・専用軍需・迎撃・報酬など実際のルールだけをStateへ持つ。
- 経路探索は安定した優先度Queueと局所索引を使い、同コスト時の順序・経路・RNG・イベント順を維持する。Supplyの静的形状はMap IDだけで同一視せず、実際の形状を識別し上限付きで再利用する。
- 盤面は静的Layerと動的更新を分け、Image／Textを再利用する。連続パン・ズームはフレーム内でまとめ、LOD境界以外で全盤面Objectを作り直さない。既存画質・解像度・DPR・情報・LOD条件を維持する。

# 4. ゲーム概要

- 全言語共通タイトル: Nowhere Left to Hide
- 日本語UIでもタイトルは英語表記の`Nowhere Left to Hide`に統一する。
- プレイヤー: 州知事
- HordeはConfigの固定Wave Scheduleを使い、標準ではTurn 5 / 10 / 20 / 35 / 50に発生する。Final Horde Turnは最後の`final: true` Waveから導出し、標準値は50である。ゲームルール上のTurn上限はない。Runnerの100 Turn安全上限到達は`limit_reached`として記録し、ゲーム内敗北およびTechnical Failureとは区別する。
- Final roster freeze後、Final Pendingが0かつMap上のFinal所属Zombieが0で勝利する。非Final Zombieや感染は勝利条件に含めない。
- Final Wave以後に追加の周期Hordeは生成しない。

次のいずれかが成立した瞬間に敗北し、残りの状態遷移を停止する。

1. 州都が陥落する。
2. 所有中の州都・地方都市・Temporary Housing・生産施設およびArmy Baseにいる健全民間人口の合計が0になる。

ユニット人口、検問所内人口、感染者、編成待ち人口は2の敗北回避に数えない。Player所有Army Baseの健常Workerだけは数えるが、都市住民・避難民・徴用可能人口にはしない。

---

# 5. UI・操作

## 5.1 レイアウト

- スマートフォン縦向きを基準に、盤面を上部、選択情報と操作を下部へ配置する。
- タイトル画面にはローカライズした`App Version`を常時明示する。表示値は実行中の`APP_VERSION`から導出し、固定文字列やBuild IDで代用しない。
- マップはドラッグパンとピンチズームに対応し、PCではマウス操作にも対応する。
- 上部にターン、フェーズ、総人口と、Food／Civilian Goods／Military Goods／Fuel／Electricityの単一展開Accordionを表示する。折りたたみ時は4備蓄と電力需要／供給を表示し、Core Forecast上の未充足がある資源だけ文字`!`と警告Styleを付ける。展開時は開始量、集約収支、終了見込み、未充足内訳だけを盤面上へ重ねて表示し、別資源Tap、再Tap、外側Tap、Escape、盤面操作で閉じる。
- 次WaveのTurn・方向数・Horde Zombie数・非Horde Slot数・混成可能Type・Finalフラグと、Warning開始後の全方向・残りTurnは独立した警告カードで確認可能にする。Spawn前の特殊Type抽選結果は公開しない。警告カードは初期状態を折りたたみとし、見出しとHorde進行状態を常時表示したまま詳細を開閉できる。Warning前にRandom方向は表示しない。
- ターン、Hordeの見出し・進行状態、致命的不足等を折りたたみ領域だけへ隠さない。

## 5.2 Bottom Sheet

選択情報・内政・行動領域は次の3状態へスナップする。

1. 折りたたみ: 対象名、HP、感染、稼働状態等のみ
2. 標準: 要約、収支、主要Action
3. 展開: 人口、駐留、感染推移、詳細Actionを内部スクロール

- ハンドルまたはヘッダーをドラッグ・タップして切り替える。
- 地図操作とパネルスクロールを競合させない。
- iPhone Safe Areaを考慮する。
- タッチ対象は原則44 CSS px以上とする。
- Bottom Sheetは原則として選択中の1対象だけを表示し、同一Hexに複数対象があれば存在する`Unit / Facility / Checkpoint / Hex` Tabだけを表示する。Unit／Facility／Checkpoint Panelへ完全な地形詳細を重複させない。
- 未選択時だけCrisis、人口概要、Checkpoint支線、最新50件までの重要Event、建設概要をAccordion表示する。初期状態はCriticalがあるCrisisだけ展開し、各見出しは44 CSS px以上、Chevron、`aria-expanded`、日英Labelを持つ。Eventは最新10件から10件ずつ増やす。
- 対象名、主要状態、合法な主要Actionは固定Action領域へ置き、内部Scrollに依存させない。詳細Formは対象内Sectionとして1つだけ展開する。
- パネルとAccordion状態はUI状態でありGameStateへ保存せず、新規開始・Load時に初期化する。

## 5.3 Unit Action Mode

- Player Unitを選択した時点では情報、Vision、HP、射程、補給状態だけを表示し、別Hexのタップから移動・攻撃へ暗黙移行しない。
- 選択Unitの近傍に`Move / Attack / Wait`のAction Menuを表示する。各Actionの有効状態はCoreが列挙するLegal Actionsだけから導出し、UI独自の合法性判定を持たない。
- Move Modeでは合法な移動先、Attack ModeではFoWを維持した合法な攻撃対象だけを強調する。対象選択後は対象Hex近傍へ左`×`／右`✓`の確認UIを表示し、既存`Move`／`Attack` Actionを実行する。
- WaitはAction Menuから即時実行して選択を解除する。Target確認中のCancelは同じAction Mode、Action Mode中のCancelはUnit Selected、Unit Selected中の空白タップまたは同Unit再タップは未選択へ1段ずつ戻す。
- Waitは能動行動を終了するが残Attack Chargeを消費せず、自動鎮圧、Counterattack、Interceptionへ保持する。Veteranが1回攻撃後もChargeを残す場合は、移動不能と追加攻撃可能を分けて表示する。
- Action Menuと確認UIは44 CSS px以上のタッチ対象とし、画面端では盤面内へ収め、パン・ズーム・リサイズへ追随する。これらの状態はController内だけのUI状態であり、GameState、Save、Replay、Agent APIへ含めない。
- Bottom Sheetの既存Move確認とWaitは移行期間の補助操作として残せるが、盤面近傍UIを主要操作とし、主要Unit ActionはBottom Sheetまで指を移動せず完結できる。

## 5.3.1 Unit編成Accordion

- 編成可能な施設は、Police／National Guard／Riot PoliceとArmy BaseのNational Guardを共通の折りたたみ欄で表示する。初期状態は閉じ、Chevron、日英見出し、`aria-expanded`、44 CSS px以上の操作域を持つ。開閉はUI状態だけでありGameStateを変更しない。
- 開いた欄は対象施設で編成できる全Unitの名前、人口・Civilian Goods・Military Goodsのコスト、HP、Attack、Movement、Range、Visionを同じ書式で示す。性能とコストは現在のConfigと共通Queryから取得し、基礎値と完成時熟練度を混同しない。
- Coreが編成を拒否する場合はボタンを無効化して理由を表示する。Army Baseの正常稼働中の予約については、予測電力不足を警告しても予約を拒否しない。

## 5.4 人口操作UI

- 生産施設への割り当てはスライダーと数値入力を併用し、双方向に即時同期する。
- 数値は整数へ正規化し、0から合法な最大値へクランプする。
- 数値入力へ`inputmode="numeric"`を設定する。
- 都市間移住は移動元、移動先、人数、実行後人口と過密予測を確認してから確定する。
- 新規確保・感染復旧した施設は次ターンから操作可能であることを無効理由とヘルプ／Tipsへ表示する。

## 5.5 ガイドとヘルプ

- 初回ガイドで移動、攻撃、人口配置、ターン終了を説明する。
- 日本語・英語の常設ヘルプを提供する。
- 人口は盤面上の所在地から消せないこと、施設撤収時の帰還、都市過密、Army Base Workerの都市住民・避難民・徴用対象外、編成拠点制限、v1.5.6以前の通常SaveおよびAI Replay／Artifact／Session／Checkpointの非互換を説明する。
- 道路別の次回到着（Final Wave Spawn後は新規到着停止）、未管理時の素通りリスク、都市のソフトキャップ超過受入を表示する。
- 補給オーバーレイは常設切替を持ち、新設・移設、検問所選択、労働者配置で自動表示する。補給範囲、セクター境界、検問所半径、候補の将来範囲、建設を妨げるZombieを盤面上で識別できる。
- Farm、Civilian Factory、Military Factory、Refinery、Civilian Drone BaseはBottom SheetからPower Supply ON/OFFを切り替え、現在配置とTurn-start Fuelに基づく次回EndTurnの予測要求・給電、基本出力、予測出力、停止理由、直前EndTurnの実績給電を区別して表示する。Army Baseは通常州兵予約を持つ正常稼働Turnだけ、Worker 0でも編成専用の電力5を要求する。Required施設は未給電またはOFFなら対象生産・機能を停止する。
- 都市はRequired Powerの予測給電と人口由来Civilian Goods出力を表示する。停電時も人口保持、移住、編成、所有、補給、感染、防衛が利用可能であることを停止表示と混同しない。
- 資源不足予測は警告するが、人口0敗北が確定しない限り無視してEndTurnできる。
- ユニットBottom Sheetは名前横へ熟練度、Regularまでの生存Turn、Veteranまでの直接Kill、昇格待ち、Attack Chargeを常時Text表示する。補給状態、次のプレイヤーターン開始時の回復区分・率・基礎量・成立条件、携行軍需品の現在量／最大量、固定消費、補充・鎮圧後予測、距離別攻撃Cost、基本射程と実効射程、駐留による感染封じ込めと自動鎮圧見込みも表示する。Fuel 0時はEmergency Movementの上限、利用可否、Legal Moveごとの通常／Emergency区分と実効MPを表示する。
- 盤面上のHuman Unit文字情報はUnit名、HP、Attack Charge、補給内外だけとする。可視Zombieは直接選択でき、Type、HP、Attack、Movement、Rangeと公開Wave所属だけを専用Panelへ表示する。内部Target、Noise Target、非公開Spawn情報、Group IDは表示しない。
- 施設Bottom Sheetは上限、1人あたりと現在見込みの入出力、Power Mode、要求電力・発電量、予測／実績給電、停止理由、感染・陥落時の生産損失を表示する。検問所は現在／審査中方針、残り時間と3方針の交換関係を表示する。
- ヘルプは熟練度、Attack Charge、Riot Police／Riot Zombie、Gas Zombieの死亡爆発と連鎖、回復10%／20%／0%、駐留封じ込めと残Charge回数の自動鎮圧、Unit別の民間被害差、携行軍需品、距離別Cost、軍需0の最低攻撃、National Guard距離2の必要量、Fuel 0時Emergency Movement、電力5ごとの燃料2、Army Baseの視界・報酬・州兵予約・迎撃・専用軍需、発電停止の波及、厳格方針の合格率50%を日本語・英語で説明する。
- 新規ゲームUIは標準の固定Wave Scheduleを使用し、旧Periodic初回／増加／Finalの6入力を持たない。HelpはWarning Lead 2、Turn 5 / 10 / 20 / 35 / 50の全Wave、方向数、方向別の基礎Composition、Final Waveを日英で説明する。拒絶した避難民が将来Hordeを強化し得ること、Final Horde確定後の拒絶はBonusを増やさないことを説明する。Wave開始後は基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を公開するが、Rejected Counter生値、拒絶人数の由来、正確なType内訳は表示しない。
- Help／Board LegendはGasを含む6種Normal AI系ZombieとHorde Zombieの基礎性能、Targeting差、Mixed Horde Marker、固定Wave Schedule、特殊Slot Weight／Capを現在Configから日英で説明する。GasはHP 35、Attack 5、Move 3、Range 1、Vision 3、Charge 1、死亡時に隣接6 Hexへ直接効果を与えるNormal AIとして表示する。Hunterは日英名「ハンターゾンビ」／`Hunter Zombie`、HP 20、Attack 15、Move 15、Range 1、Vision 5、最大Charge 1、Normal AI、Reanimation対象外として、Unit詳細、Legend、Help、Wave混成Type、Agent APIの同一Config値から表示する。
- 外周のHorde Spawn Reserveを常時OverlayとLegendで識別し、Player Unitの進入・通過・配置、CheckpointのBuild／Relocate／Activate、Constructible FacilityのBuildは禁止だが、Reserve内ZombieへのAttack、Counterattack、Interception、Damageは可能であることを説明する。
- 内政タブでは空の幹線道路Hexを選択でき、Coreの`BuildCheckpoint`候補が合法な選択地点だけに局所Buildボタンを表示する。不合法な場合は座標一覧を出さず、選択地点に対するCore Reason Codeの短い日英文言を1行表示する。Facilityまたは既存Checkpointがある道路Hexではそれぞれの選択を優先し、Checkpoint操作や不合法理由をFacility Sheetへ混在させない。
- Human UIはBuild候補座標一覧とBuild全候補盤面Markerを持たない。Relocateは既存Checkpoint選択からPlacement Modeへ進み、対象支線の合法／不合法MarkerとCore Reasonを維持する。Stateまたは選択候補が変わった場合は古い理由を残さない。
- EndTurn Forecastは未給電施設をID／理由で全件列挙せず件数だけを表示する。Required PowerのPlayer所有施設が次回EndTurn予測で未給電なら、視界外やPlayerによるOFFを含め盤面へ動的文字Marker`⚡×`を表示し、給電見込みへ戻った時点で消す。個別Facility Sheetは予測理由を区別して表示する。
- Checkpoint Bottom Sheet／Branch Panelは`waiting / screening / approved`のFood／Civilian Goods維持需要、初回／以降Build Cost、Relocate Cost、Turn Away入力と、Final Wave後の新規到着停止を表示する。拒絶の方向別Counterや増援数は表示しない。
- 支線パネルはActive／Standby／Dormant、Fallback可否、支線Policy、準備済みPost数を表示する。Active失陥時には州都側のStandby、次にDormantへ即時Fallbackし、前線とSupplyが後退することを説明する。
- Unit詳細、Help、Combat LogはPolice／Riot Policeを公開Noise Class `medium`、National Guardを`large`、Army Base迎撃を`armyBase`とし、Human Combat、Horde実移動、基地迎撃の共通NoiseがGasを含む6種Normal AI系Zombieと条件を満たす陥落拠点へ次Zombie Phaseから作用すること、およびTarget優先順位を表示する。基地迎撃Radiusは8と公開する。反応数、対象ID、発生位置、ZombieのNoise TargetはProduction UIへ出さない。
- Coreが公開Stateだけから返す`Crisis Summary`はCritical／Warning／Advisoryの全件をHuman UIとAgentで共有する。Human UIは上部Stripと未選択Accordionへ段階表示する。EndTurnは合法性を変えず、Criticalがあるか未使用Attack Charge／自動鎮圧がある場合だけ短い確認を出す。
- Help／Board LegendはGround LOS、Forest／Mountainの最初の遮蔽Hex、Aerial Vision、実感染者5人ごとの隣接Spawn、最大6体、即時占有、FIFO連鎖、Noise再Spawnを現在Configから日英で説明する。
- UIはCore Eventから最新50件の重要イベント履歴を再構築し、陥落拠点ID／Type／座標、感染者数、Requested／Actual Spawn、残存感染者、原因、連鎖起点を表示する。新規イベントはToast表示し、複数拠点Chainだけを集約する。Load直後に過去Toastを再表示しない。
- 開発BuildだけはCoreが提供する読み取り専用診断を使い、Noise Center、正確なRadius、範囲Hex、反応したNormal Zombie、内部Noise Targetをオーバーレイで確認できる。Production Build、Save、Replay、Agent API、Browser Bridgeには含めず、表示がState、RNG、Action列へ影響してはならない。

## 5.6 盤面Asset・Layer・Board Legend

- Runtime盤面画像は`public/assets/board/`配下の256×256 px透過PNGとし、Plain／Forest／Mountain、Road／Urban、Police／National Guard／Riot Police／Zombie／Horde Zombie／Police Zombie／Soldier Zombie／Riot Zombie／Hunter Zombie／Gas Zombie、Capital／City／Farm／Civilian Factory／Military Factory／Refinery／Power Plant／Wind Power Plant／Army Base／Checkpoint／Simple Farm／Civilian Drone Base／Temporary Housing、施設・Checkpoint・Horde状態Overlay、および独立obstaclesカテゴリのBarbed Wireを収録する。WaterはPNGを持たず既存描画へFallbackする。
- 通常Zombieは承認済みの3体Group、Horde Zombieは同画風の12体密集Swarmとする。両AssetのComic-paintedな傷・血痕は許容するが、写実的またはこれ以上GraphicなGoreと死体表現は使用しない。
- Policeはアメリカ風制服の5人Group、National Guardは武装した州兵の5人Group、Riot Policeは防護装備とShieldを持つ5人Group、Police Zombieは濃紺巡回制服の3人Group、Soldier Zombieは迷彩装備の5人Group、Riot Zombieは損傷した防護装備とShieldを持つ3人Group、Hunter ZombieとGas Zombieは各1体描きとする。Gas Zombieは背中のガス溜まりを持つが、常時damage領域を表さない。Army Baseは兵舎・格納庫・監視塔とフェンスで識別する。Temporary HousingはFEMA等の災害時緊急住宅を想起させるprefab／container housing群とし、軍事基地や恒久集合住宅に見せない。描画人数はTokenが表すゲーム上の人口・個体数ではない。Riot 2 Assetは`Art/reference/v1.5.0-unit-concepts/`の承認済み透過原画を使用し、Hunter Zombieは`units/unit_hunter_zombie.png`を使用する。`0.75`未満では人物数の細部に依存せず陣営色とSilhouetteで識別する。
- TypeScriptのUI専用Asset RegistryをPathとCore Typeの唯一の対応表とし、Game Core、GameState、Save、Observation、ReplayへAsset Path、読込状態、LOD、表示Marker、Help開閉状態を含めない。BoardとBoard Legendは同じRegistryと状態Mappingを使用する。
- Runtime PNG合計は3 MiB以下とし、生成・後加工・出所・第三者Asset不使用・再生成方法を`public/assets/board/ASSET_MANIFEST.md`へ記録する。Hunterの生成Promptと後加工記録は`Art/reference/v1.5.1-hunter-concept/README.md`へ記録する。App VersionまたはBuild IDをURLへ付与してCache Bustingする。
- ゲーム盤面を表示する前にRegistryの全Assetを一括Preloadし、Loading進捗を表示する。Missing、Load、Decode、Texture登録の失敗はAsset単位で記録し、成功済みAssetを維持したまま失敗対象だけ既存図形・文字描画へFallbackする。読込成否は操作、GameState、RNG、Save、Observationへ影響させない。
- 描画順は`Terrain → Road → Urban → Facility Base → Facility State → Fog暗転 → Obstacle → Unit → 動的Overlay`とする。視界外でもTerrain、Road、Urban、施設、Checkpointを暗転して識別可能にし、Enemy Unitは描画しない。自軍Unitと選択・移動・攻撃・HP・感染・停止予測・Vision・Supply・Horde方向等の操作情報はFogより上に置く。
- Roadは保存済みの明示接続辺だけを描画し、幹線／集散路／進入路を幅6／3.5／2で区別する。隣接するだけの道路を接続せず、形状別PNGを持たない。施設とUnitが同じHexにある場合は施設を中央、Unitを右下へOffsetし、双方を識別可能にする。
- Camera Zoomが`0.75`未満ではPNGの細部を省いたLODへ切り替え、最小Zoom`0.35`でも陣営、Police／National Guard／Riot Police、Normal／Horde／Police／Soldier／Riot／Hunter／Gas Zombie、Army Baseを含む主要施設状態を色とSilhouetteで区別する。LODは旧`P / G / Z / H / F`固定文字へ戻さず、閾値と表示状態をGameStateへ保存しない。
- Help内に折りたたみ可能な`盤面アイコン / Board Legend`を設け、Terrain、Road／Urban、10 Unit、Scheduled／Final Horde、Army BaseとTemporary Housingを含む13施設Type、一般施設とCheckpointの複合状態、通常Zoom／LOD、動的Overlay、Config由来のRule値を日本語・英語で説明する。進行中は現在GameState Config、GameStateがない場合は標準Configを表示する。Player向けLegendには強制Fallback表示を含めない。
- 上部電力HUDは`requiredPowerDemand / availableGenerationCapacity`を`予測需要量 / 利用可能供給量`で表示する。日本語Labelは`電力 需要/供給`、英語Labelは`Power Demand/Available`とし、TooltipとAccessible Nameで需要、供給、Core Forecastの不足量を名前付きで伝える。`electricity.shortage > 0`の場合だけ不足状態とし、`0/0`を安全に表示する。実消費量とは呼ばない。

---

## 5.7. コメント付き観戦リプレイ

### 5.7.1 再生方式

- 公開Artifact内の記録済みObservation / Action / Event / decisionSummaryを再生する。
- 観戦でGameEngineによるAction列の再実行を必須条件にせず、記録済み盤面を読む。
- 検証用の決定的Replayと、プレイヤー向け観戦再生を区別する。
- 通常ゲームのState、autosave、進行中Sessionを変更しない。
- FoWはその時点でAIに公開された情報に従う。全知視点は追加しない。

### 5.7.2 v1.5.7の基本操作

- タイトル画面の「AIリプレイ観戦」から端末内の単一ZIPをファイル選択で読み込む。読込後は先頭の判断直前で一時停止し、再生操作で開始する。観戦終了時はタイトルへ戻り、通常ゲームのautosaveを維持する。
- 再生・一時停止・速度変更・前後のDecisionへの移動・ターン指定移動を提供する。
- 現在Turn、Decision、行動主体、Action、結果を表示する。
- 攻撃・撃破・施設陥落・Wave到来等の重要Eventを盤面とログで識別できる。
- コメント表示、盤面操作、ログ閲覧がモバイル画面で両立する。
- 移動を補間表示する場合も、記録にない経路や敵移動を推測して事実として再生しない。
- EndTurnは処理前後の記録済み盤面を切り替え、その間の公開Eventを記録順のログで表示する。中間盤面や敵移動経路を推測しない。ログは次の判断へ進んだ後も閲覧できる。

### 5.7.3 意思決定コメント

- 既存decisionSummaryを利用する。非公開の詳細な思考過程は収集しない。
- 判断直前の公開盤面でコメントを提示し、その後に行動と結果を表示する。
- 「AIの判断コメント」と「ゲームの結果ログ」を区別し、AIの誤認を仕様説明として表示しない。
- コメントがない記録でも再生可能とし、後付けでAIの意図を捏造しない。
- 拒否されたActionは状態を進めず、拒否理由を表示する。未実行計画は実行履歴へ追加しない。
- コメントは通常テキストとして表示し、HTML等として実行しない。
- AIプレイ用文書に、短い目的・判断根拠を記す推奨例を追加する。

- 自動再生は「判断直前の盤面とコメント → 行動結果の盤面とログ → 次の判断」の順。標準速度は1倍。コメントは文字数に応じて3～8秒、結果は1秒とする。文字数換算の初期値は min(8, max(3, ceil(Unicode code point数 / 20))) 秒とする。
- 速度は0.5倍・1倍・2倍・4倍。コメントと結果の時間を倍率で割る。一時停止中は残時間を進めず、コメントを時間制限なく読める。コメント欠損時は意図を補作せず、コメント待ち時間を省略する。
- 前後Decision・Turn指定は判断直前へ移動し、一時停止する。指定Turnに複数Decisionがある場合は最初へ移動する。記録のないTurnは理由を表示し、盤面を捏造しない。末尾で停止し、自動ループしない。

### 5.7.4 読込・互換性・性能

- v1.5.7で作成した公開Artifactを必須対応とする。
- v1.5.6以前のArtifactは観戦でも非対応とし、理由付きで拒否する。変換・移行しない。
- 公開Artifact Packageを単一ZIPにまとめて出力する。AIプレイ終了後に取得でき、既存の途中記録exportも維持する。Manifest、固定Map、公開Decision / Event、必要な差分・Snapshot・Payload・lineageを自己完結させる。Private Stateや外部Sessionへの依存を含めない。
- ZIPは端末内で読み込む。サーバーアップロード、GitHub Pages上の記録保存・配信基盤は追加しない。Pagesはゲーム本体を配信し、展開・再生はブラウザ側で行う。
- 圧縮済み観戦ZIPの対応容量は50 MB（50,000,000 bytes）を暫定目標とする。強制的な上限ではなく、超過だけを理由に拒否しない。標準50ターン10 MB以下、圧縮1 GiB・展開4 GiBは必須要件にしない。
- 50 MB超の事例は、ZIP実容量、ZIP内データと内部圧縮Payloadそれぞれの展開量、Turn数、Decision数、端末・ブラウザ、読込・シーク時間、取得可能なメモリ指標、成否・原因を検証記録へ残す。実装完了後の現行仕様に制約・注釈と記録の参照先を反映する。端末資源不足等で読込不能なら理由を表示して中止し、再選択・タイトル復帰を可能にする。
- ZIP容量、内部Payload展開量、全差分から復元したObservationの累積量、ピークメモリを別指標にする。いずれも同じ「展開後サイズ」として扱わない。
- ZIPエントリ名・重複・Manifest参照・hash・Versionを検証し、外部URLを取得しない。宣言サイズだけを信用せず展開量を監視する。解析・展開単位とキャッシュに有限の上限を設けるが、50 MB超の一律拒否で代用しない。
- 欠損、破損、未対応Versionは読込理由を表示して停止し、通常ゲームへ影響させない。
- 全履歴を単一文字列や全Observation配列へ一括展開しない。ZIP・内部Payloadを必要範囲で読み、索引・Snapshotからの差分展開・上限付きキャッシュを利用する。読込を中止でき、処理分割またはWorkerによりUIの長時間停止を避ける。
- シーク時もコメント・盤面・結果の対応を維持する。分岐Sessionの履歴はArtifactのlineageに従う。

### 5.7.5 今回含めないもの

- 音声実況、動画書き出し、SNS投稿、オンライン共有基盤。
- 自動ハイライト編集、高度な演出カメラ、全知視点。
- リプレイ途中から通常ゲームを開始する機能。


# 6. GameState・GameAction・乱数

## 6.1 GameState

最低限、次を保存する。

- Game Version、使用Configの完全なコピー
- Seed、疑似乱数状態、ターン、Final Horde発生Turn、フェーズ
- マップID、基礎Terrain、タイル、道路／Urban Overlay、施設、各Tileの`playerOccupancyAllowed`、静的な外周2列392 Hexの`hordeSpawnReserve`
- 道路支線ID、道路ヘックス、州都への接続、支線ごとの次回到着ターン（停止時は`null`）、到着終了状態、ターン内操作状態、`activeCheckpointId`、重複しない`standbyCheckpointIds`、支線所有の`currentPolicy`、支線ごとの`hasBuiltCheckpoint`
- 施設の所有、恒久／建設物区分、Type、確保・建設順、操作可能ターン、Power Supply、`operational`／`building`／`disabled`／`recovering`等の状態、陥落、感染。Temporary Housingと建設Windも同じ施設Stateとして保存する。Army Baseは専用Military Goods、Zombie Phaseごとの迎撃残回数、報酬取得状態、通常州兵予約と`powerReady`を保存する。
- 産業施設のPower Supply ON/OFFと直前EndTurnの実績給電
- 都市別住民、生産施設別労働者、Army Base Worker、ユニット人口、報酬による`cumulativeReinforcements`
- ターン開始時の全所有都市・仮設住宅の供給順位・受入順位と人口操作資格
- 4備蓄資源と当Turn電力Capacity
- ユニット、HP、位置、行動状態、`proficiency`、Recruit生存Turn、Regular直接Kill、Veteran昇格待ち、`attackChargesRemaining`／`maxAttackCharges`、`currentFuel`／`maxFuel`、`currentMilitaryGoods`／`maxMilitaryGoods`
- Checkpointの物理状態、支線、避難民、審査中、配置待ち合格者、感染者、審査中方針、残り時間。RoleはCheckpointへ重複保存せず、支線のActive／Standby参照から`active`／`standby`／`dormant`を導出する。
- Direction別のRejected Refugee Counter（`normalRejected`、`strictRejected`、`turnedAway`）。これはGameStateの非公開正データであり、Production UI／Agent／Browser Bridge／公開Artifact／Replay／終了結果へ含めない。
- 有刺鉄線のID・位置・現在HP／最大HP・建設Turn、次の壁番号。Human再生で壁上に発生したZombieだけに退出までの例外を保存する。
- 次のCheckpoint／Constructible Facility／Unit／Event番号
- `nextWaveIndex`、`nextSpawnTurn`、Warning済みの全方向、開始済みWaveごとのFrozen Roster／方向別Spawn Group ID／出現済み数／Pending、Final Spawn Group ID配列・状態、特殊ZombieのScheduled／Final由来、Zombie内部Target、`waveCapitalAnchor`、`previousFallbackPosition`、`fallbackTarget`、次Zombie Phase用`pendingNoisePulses`、初期HunterとGas Count／配置、Army Base配置の検証metadata、直近イベント、累積統計、Victory進捗、勝敗

人口合計等の導出値は正データから再計算し、重複する可変の正データを持たない。
補給圏内タイル、施設の補給可否、セクターは正データから共通の純粋関数で決定的に導出する。

## 6.2 GameAction

最低限、次を提供する。

- Move
- Attack
- Wait
- AssignWorkers
- TransferPopulation
- SetCheckpointPolicy
- SetPowerSupply
- BuildCheckpoint
- BuildConstructibleFacility
- BuildBarbedWire
- DecommissionConstructibleFacility
- RelocateCheckpoint
- ActivateCheckpoint
- TurnAwayCheckpointRefugees
- ProduceUnit
- EndTurn
- StartNewGame
- LoadSnapshot

自動鎮圧等もGameEngine内部の決定的な処理とする。不正Actionは状態を変更せず、理由付きエラーを返す。人口移動Actionは移出と移入を原子的に完了させる。

## 6.3 Seed付き乱数

次はSeed付き乱数を使う。

- ゾンビAIの同順位
- Wave Warning開始時の方向抽選（`directionCount < 4`のみ）と同距離配置。`directionCount = 4`はRNGを消費せずNorth / East / South / Westを用いる。
- Hordeの非Horde Slot Type抽選と、同距離Noise Center／Target候補の決定。配列は安定順へ正規化してから抽選する。
- 避難民到着間隔・人数、感染判定、潜伏感染発生先
- Configで有効化した初期人口抽選
- ユニット完成時の同距離配置候補
- 初期Army Base候補と初期Gas数・配置、Gas Chain内の安定した対象順

同じVersion、Config、Map、Seed、Action列から同じ結果を得る。

## 6.4 Headless Interface

```ts
interface HeadlessGame {
  reset(seed: number, config: GameConfig): Readonly<GameState>;
  getState(): Readonly<GameState>;
  getLegalActions(): GameAction[];
  getCheckpointPositionCandidates(): CheckpointPositionCandidate[];
  getConstructibleFacilityPositionCandidates(facilityType: ConstructibleFacilityType): ConstructibleFacilityPositionCandidate[];
  step(action: GameAction): StepResult;
  isGameOver(): boolean;
  getResult(): GameResult | null;
}
```

- Game Over後の`step`は状態を変更せず拒否する。
- `getLegalActions()`は原子的Actionを返し、人口配置の全組合せを一括列挙しない。
- Random Test Agentは同一ターンのループを避けるAction上限を持ち、合法ならEndTurnへ進める。

## 6.5 Version境界

- App / Release `1.5.7`、Rules / State / Config `9.0.0`、Map `fixed-51x51-v4`、Save Format `16`。
- Agent / Observation / Bridge `14.0.0`、Artifact `13.0.0`、Session / Checkpoint `10.0.0`、Balanced `8.0.0`、Random `6.0.0`。
- v1.5.6以前の通常SaveおよびAIデータは移行せず、現在状態・旧データを変更せずにVersion mismatchとして拒否する。Map IDとSave Formatを独立に検証し、必須metadataを旧値で補わない。
- Build IDはCIではcommit SHA、ローカルではSHAとdirty状態またはlocal-unknown。乱数やゲーム結果には影響しない。Session / CheckpointはBuildを含む完全な境界を照合する。

## 6.6 Agent ObservationとAgentGame

Agent向け正式入力はGameStateではなく、JSON互換の`AgentObservation`とする。API／Game Rules Version、Turn、Phase、静的マップ、公開中の資源・人口・施設・部隊・ゾンビ・Checkpoint、Horde、Crisis Summary、EndTurn Risk、EndTurn Forecast、Strategic Forecast、勝敗に加え、初期補給半径、道路支線と次回到着、Active／Standby／Dormant／Remnant／Ruined／AbandonedのRole、構造上のFallback可否、支線Policy、決定的な補給圏タイル、施設・都市・ユニットの補給状態、支線ごとのターン内操作済み状態、Core生成の全Checkpoint／Constructible Facility位置別候補を含む。

- 人間ユニットは熟練度、昇格進捗／待ち、Attack Charge、基本／実効射程と携行軍需不足理由、`currentMilitaryGoods`／`maxMilitaryGoods`、固定消費、距離別Combat Cost、補充・鎮圧後予測、Legal Attack別の消費・残量・実効攻撃・Terrain軽減前後Damageを返す。軍需不足時の実効攻撃は各Unit Configの`militaryGoodsShortageAttackMultiplier`と標準端数処理から導出し、固定値をAPIへ重複定義しない。さらに`currentFuel`／`maxFuel`、Legal Move別Fuel Cost・移動後Fuel・`normal`／`emergency`・実効MP、Supply状態、EndTurn補給需要／予測量、回復区分・率・基礎量・成立条件、感染封じ込め能力、残Chargeに基づく自動鎮圧力・回数・民間被害・対象を返す。
- 施設は所有・恒久／建設物・状態・補給・人口・上限に加え、1人あたり入出力、`required | none | conditional`のPower Mode、required Power Capacity、切替対象だけのPower Supply ON/OFF、予測要求・給電・理由、直前実績、基本／予測生産、停止理由、感染・陥落時に失う現在生産、Vision、Zombie Target Value、封じ込め・鎮圧予測を返す。Temporary Housingは総在所人数、Soft Capacity、occupied／empty電力Tier、停電原因と追加維持費を返す。Windは初期／建設由来、発電、Noiseの状態を返す。Army BaseはWorker、専用軍需／40、迎撃残回数、報酬状態、予約の都市人口・支払い・電力待ち／没収理由と機能別の可否を返す。Civilian Drone Baseは合法な場合の`decommissionRefundCivilianGoods`も返す。旧boost Fieldは公開しない。
- ForecastはFoodの開始備蓄、予測生産、Checkpoint健常Queueを含む維持必要量、終了備蓄、維持不足を返す。Military Goodsは開始備蓄、生産、Unit ID順の固定消費・補充・鎮圧の後のArmy Base専用軍需補充・未充足・終了備蓄を国家集計とUnit別に返す。Civilian Goodsは市民維持とMilitary Factory入力を分離する。FuelはWind、Power Plantの実使用（電力5ごとにFuel 2）、発電後Fuel、Unit補給需要／実績、合計不足、Refinery生産、終了備蓄を分離し、電力はphysical／Fuel-limited／available generation capacity、required demand／allocated、shortage、施設別停止理由を返す。Army Base予約なし・非正常時の要求は0とする。
- Checkpointは物理status、導出Role、3人口プール、感染、残り時間、screening batch capacity 20、推定Throughput、Queue Pressure、Queue Food／Civilian Goods維持需要、補給提供、封じ込め・鎮圧予測を返す。Road Branchはnullableな`nextArrivalTurn`と`turnsUntilArrival`、`arrivalsEnded`、今回のBuild／Relocate Cost、拒絶が将来Hordeを強化し得る定性的Riskを返す。Activeだけが到着・新規審査・Supply・Visionを提供する。方針の静的な率と時間は`getApiInfo()`へ置く。
- Checkpoint候補は`actionType`、`branchId`、必要時の`checkpointId`、`position`、`legal`、`reasonCode`、Projected Supply Effectを安定順で返す。Constructible候補は全Mapの安定座標順でType別合法性と最初のCore Reasonを返す。候補、合法手、実Actionは同じCore Validationを使用し、Hidden Enemyの存在・位置・IDを候補差分から漏らさない。
- PRNG内部状態、将来乱数、出現前の特殊Slot抽選結果、デバッグ専用値を含めない。
- Map Terrain、Road／Urban属性、実効移動コスト、防御補正、各Hexの`visibleToPlayer`と`playerOccupancyAllowed`、静的`hordeSpawnReserve`を返す。Enemy配列は現在Visibleな`zombie`／`hordeZombie`／`policeZombie`／`soldierZombie`／`riotZombie`／`hunterZombie`／`gasZombie`だけを含め、Scheduled／Final Wave所属Booleanを公開する。
- Hordeは次Wave index／Spawn Turn／残りTurn／方向数／方向別Horde数／非Horde Slot数／混成可能Type／Final flag、Warning種別・Warning後の全方向・Final Horde状態を返す。Wave開始後はDirection／Group／kind、基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を返す。Warning前の方向は空配列である。Enemy内部Target、Noise記憶、Hidden位置・ID・個体数、特殊抽選結果、Rejected Counter生値、拒絶人数の由来、正確なType内訳を返さない。
- `getApiInfo()`は熟練度、Attack Charge、Riot／Hunter／Gasの基礎性能、Gas爆発とArmy Baseの静的規則、Crisis理由、特殊Slot Weight／Cap、公開Noise RuleとしてClass一覧、Human Unit別Class、Horde移動とArmy Base迎撃のRadius 8、Hex Distance、Terrain非減衰、6種Normal AI系Zombieが対象であること、`visible_population > inherited_horde > noise > idle`を返す。Human Combatの正確なRadius、反応したHidden ZombieのID／数、Noise Target、Pulse源位置は返さない。
- 通常`AgentObservation`は常に完全な公開SnapshotでありDeltaを含めない。AI Portable Sessionの各受理Decision応答だけが、直前と直後の公開Observationから導出した`stateDelta`を追加する。Sessionの保存用完全差分は別途、公開Snapshotを完全復元できる形式で保持する。
- 配列順を決定的にし、取得によってStateを変更せず、返却値と内部参照を共有しない。
- Game Over後の合法手は空配列とする。
- Agent向けStepResultはObservation、公開Event、理由コード付きError、勝敗だけを返し、GameStateを含めない。
- 一覧外または不正なActionはState、RNG、正規Action列を変更せず、不正試行として分離記録する。

```ts
interface AgentGame {
  getApiInfo(): AgentApiInfo;
  reset(options?: AgentResetOptions): AgentObservation;
  getObservation(): AgentObservation;
  getLegalActions(): GameAction[];
  step(action: GameAction): AgentStepResult;
  isGameOver(): boolean;
  getResult(): AgentGameResult | null;
  getRunArtifact(): AgentPublicRunArtifact;
  getArtifactPage(options?: AgentArtifactPageOptions): AgentArtifactPage;
}
```

## 6.7 組み込みAgentと統一Runner

- `random`と`balanced`は同じAgentGame、Runner、安全上限、Metrics、Artifact形式を使用する。各Decisionは非公開思考過程ではなく、優先目標、理由コード、上位候補を500 Unicode code point以下で要約した`decisionSummary`を公開する。
- Random Agentの選択乱数はGameEngineから独立したSeed付き乱数とする。
- Balanced Agent Versionは`8.0.0`、Random Agent Versionは`6.0.0`とする。Balancedは独自乱数を使わず、ObservationとLegal Actionsだけから、安定したActionキーで決定する。
- VisibleなGasを含む6種Normal AI系ZombieとHorde Zombie、Terrain Movement Cost、Urban／Forest防御、Vision Coverage、Horde警告、Checkpoint Role／Fallback深度、Crisis、残Attack Charge、熟練度、公開Noise Class、Final PendingとMap上のFinal所属Zombieを評価する。非Final Zombieや感染が残っていてもFinal勝利条件を満たし得ることを前提に行動する。
- BalancedはGuaranteed Defeat回避をHard Priorityとし、施設接触拒否、施設／Checkpoint Queue感染の鎮圧、Horde防衛、軍需備蓄、食料・民需品・燃料・電力、州都人口バッファ、過密、生産冗長性を含む施設確保、部隊編成と損傷、全支線のActive Checkpoint確立、状況に応じた後方Standby、支線方針、有益なActionがない場合のEndTurnを評価する。州全体感染時はStrict方針を加点し、Normal／Pass Throughを減点する。
- Food単一障害点ではSimple Farm、Horde方向・Fog・給電余力ではCivilian Drone Base、CheckpointではProjected Supply Effect、前線ではQueue Pressureを評価する。Move距離、Unit Type別Fuel Cost、移動後Fuel、Supply内補給見込みを評価し、Horde緊急防衛を除いてSupply外で移動不能になる進出を減点する。Horde Spawn Reserveへ移動・配置するActionを生成せず、Reserve内のVisible Zombieへの合法Attackは評価する。`checkpoint_supply_zombie_blocked`はCheckpoint戦略の放棄理由にしない。
- Policeの15 MPは州内即応・感染／Checkpoint危機へ使い、Riot Policeは高HP・民間被害なし鎮圧・Blockadeへ、Veteranは追加Chargeの価値を残すよう評価する。Queue維持費、Simple Farm最大4基、Build／Relocate Cost、Turn Awayの定性的Trade-offを評価する。Police／Soldier／Riot／Hunter／Gas ZombieはNormal AI系Enemyとして扱い、Warning前の特殊Typeを推測しない。Random Agentは新Actionを合法手から決定的に扱う。
- 所有中かつ健全民間人口がいる施設に対し、各Zombieが現在接触中か、次のZombie Turnに移動力内から接触可能かを公開Observationだけで予測する。州都、単一供給源、軍需工場、健全民間人口の多い施設を高脅威として扱う。
- National Guardは射程2と対Zombie確殺を利用する接触拒否火力として扱い、接触脅威への攻撃、安全な射撃位置、Horde方向側の所有施設防衛を優先する。Horde入口へ直接進出すること自体は目的にしない。
- Policeは感染鎮圧用として温存し、通常の前線移動・攻撃を抑制する。ただし州都への接触を他の手段で防げない場合は防衛へ参加できる。
- 複数Zombieが次の敵行動で到達できる位置への移動・攻撃を露出として減点し、低HP Unitの危険接近を抑制する。
- 未管理道路の流入リスク、Checkpointの新設・方針・Active化・前進・後退、Build／Relocateが同Hexに共存する場合の異なる効果、補給圏を考慮した施設価値・労働者・編成・回復、Checkpoint跡と荒廃地点の防衛・鎮圧・再前進を評価する。全支線を常に3重化するHard Ruleにはしない。
- 軍需品はUnit別携行量、固定消費、距離別Combat Cost、補充不足、鎮圧需要、Army Baseの専用軍需・迎撃、編成用バッファを評価し、供給停止前に軍需工場の確保・稼働を進める。National Guardが1隊だけで、軍需品・人口・生産基盤を維持できる場合は2隊目を編成する。
- Food／Civilian Goods／Military Goodsは当ターン生産後の最終収支、Fuelは翌ターンの発電備蓄として評価する。Required都市・施設、Housingのoccupied／empty Tierと停電追加維持費、WindとPower Plantのphysical generation capacity、Fuel不足、Civilian Goodsの市民維持不足とMilitary Factory入力不足を区別し、労働者再配置、建設、人口移送、SetPowerSupplyを評価する。複数方向Warningでは全戦力を一方向へ縮約せず、次Waveまでの5～15 Turnに電力、Fuel、Military Goods、人口、Unit、Checkpoint depthを再評価する。
- 州都の健全民間人口は平時15人、州都への接触脅威がある場合20人を目標バッファとする。これを下回る人口配置・編成を減点し、安全都市からの帰還を評価する。
- Farm、Civilian Factory、Refinery、Power Plant、Military Factoryの単一依存を検出し、黒字時でも代替施設の確保と適量稼働を評価する。労働者は最大投入ではなく、不足解消、冗長性、入力資源、州都人口を考慮した目標人数へ近づける。
- 同一ターン内で同じ施設の労働者数や検問所方針を繰り返し変更しないようAction Family単位の反復抑制を行う。接触脅威や感染が残っていても、対応可能なUnit Actionがなければ不要な内政Actionを挟まずEndTurnできる。
- 評価重みと閾値をデータとして分離し、Decisionごとに優先目標、選択Actionと点数、上位候補、理由コードを機械可読Traceとして残す。文章上の思考過程は保存しない。
- `effectiveRange`、携行軍需不足、距離別Combat Cost、Fuel 0時Emergency Movementによる補給圏帰還、負傷部隊の後退、戦闘回復と休養回復の比較、駐留封じ込めと自動鎮圧、州兵の鎮圧時民間被害、電力・生産波及、人口・感染・防衛に応じた検問所方針を評価する。Traceは回復、後退、鎮圧、射程、軍需、Emergency Movement、電力、方針の理由コードを持つ。
- 非緊急のForest上Zombieへの非致死Attackを下げ、Urban Defenseを維持し、Plainへ誘導できるWait／Repositionを候補に残す。Capital、Active Checkpoint、重要Facility、民間人口への即時Threat、今TurnのOverrun、Final Horde収束はTerrain／Noise Penaltyより優先する。
- AttackのNoise Riskは、攻撃Unit自身のVision内にいるVisible Normal Zombie数と公開Classだけから近似する。内部RadiusやZombie Target Memoryを推測・使用しない。Urban Defense上ではNoiseを理由に過剰にAttackを避けない。
- Runnerは1ターン、1ゲーム、最大ターンの安全上限をGameConfigと別管理する。標準の最大100 Turnへ到達した場合は正常な`limit_reached`結果として記録し、ゲーム内敗北およびTechnical Failure（例外、不変条件違反、不正Action、Agent停止）とは区別する。ゲーム内敗北は正常完遂である。
- 既定では失敗Artifactを残して次のゲームを続け、`fail-fast`指定時だけ停止する。

## 6.8 Batch SimulationとBrowser Bridge

`npm run sim -- --agent=balanced --games=1000 --seed=1 --out=output/simulations/run-name`相当のCLIを提供する。Agent、Seed集合、完全Configまたは検証済みoverride、Runner上限、出力先、fail-fastを指定でき、Random／Balancedを同一Seed・標準Configで比較できる。

- 通常モードは正本`run.json`、固定列UTF-8 `games.csv`、成功・敗北・`limit_reached`を含むゲーム単位Replay Artifact、技術的失敗時のFailure Artifactを出力する。100 Turn安全上限到達は`limit_reached`としてゲーム内敗北およびTechnical Failureと別集計する。
- `--summary-only`は行動とMetricsを通常モードと同一に保ちつつ、`run.json`／`games.csv`だけを出力し、ゲーム単位の完全Replay Artifactを作らない。Traceは初期・最終のコンパクトな記録だけで、固定MapやAction列を持たずReplay入力には使用できない。
- 既存出力を既定で上書きせず、明示指定時だけ許可する。
- Artifactは各Version、Build ID、Map、Seed、Config、Agent、受理Action列、不正試行、Result、Metrics、Public Decision Logを持つ。Session ArtifactはSession ID、親Session／CheckpointのlineageとDecision hash chainを加える。大きなArtifactはstreamで出力・読込し、標準応答へ全文を埋め込まず、公開履歴のlossless diffと参照Payloadから復元する。
- Failure Artifactは直前Observation、エラー、Decision番号と、ローカル／CIデバッグ用途の直前・直後GameStateを追加できる。
- ReplayはAction列を再実行し、最終Result、Action数、Observationの不一致理由を報告する。

ゲームページでは追加設定なしに`window.NLTH`を公開する。Bridgeは通常UIとは別のインメモリAgentGameを1つだけ保持し、ページ再読み込みで破棄する。自動保存、localStorage、セーブコード、通常UI状態、ネットワーク、ファイル、Batchへアクセスしない。AgentGameとBridgeの`getApiInfo()`は同じ生成元からVersion、Build ID、公開メソッド、Schema、推奨順序、Fair Play境界、回復・感染・射程・Checkpoint Role／方針／Capacity・Noise・Required電力・固定Wave Schedule・Warning Lead・Spawn Reserveの静的ルールを返す。BridgeのProduction ArtifactはNoiseの公開ClassだけをConfigへ含め、正確なRadiusとHidden Noise Metricsを含めない。ローカル／CIの完全な検証Artifactだけは決定的Replay用の完全Configと内部検証Eventを保持できる。

公開メソッドは`getApiInfo`、`reset`、`getObservation`、`getLegalActions`、`step`、`isGameOver`、`getResult`、`getRunArtifact`、`getArtifactPage`だけとし、`getState`、`LoadSnapshot`、`StartNewGame`を公開しない。入力を境界で検証し、1回の`step`で1Actionだけを処理する。API説明ページ、最小プロンプト、Smoke手順、外部AI E2Eチェックリストを公開する。

---

## 6.9. AI向け情報開示

### 6.9.1 共通原則

- 公開Observationから導出できる情報を、判断する対象と同じ場所へまとめる。
- Compactは反復判断に必要な小さな要約を持ち、施設別・Action別の詳細はQueryで取得する。
- Hidden Enemy、内部Target、将来乱数、拒絶Counter等の非公開境界は維持する。
- 確定結果、条件付き結果、未計算の結果を区別する。公開情報だけでは確定しない将来の敵行動を保証として出さない。
- UIとAIで共通のCore Queryを利用し、予測用のルールを別実装しない。維持費内訳、Gas撃破時の被害予測、施設復旧・生産停止理由は人間向けUIでも提供する。通常画面は要約、詳細パネルは内訳と条件を表示し、日英UI・ヘルプを整合させる。
- フィールドは `maintenancePopulation`、`maintenanceBreakdown`、`gasExplosion`、`recovery`、`populationTransferCandidates`、`turnAwayPreview` を使用する。

### 6.9.2 維持人口と資源収支

CompactのEndTurn予測に以下を追加する。

- 維持人口の内訳: 都市・住宅住民、生産施設等の労働者、部隊人口、Checkpoint健常Queue。
- Queueはwaiting / screening / approvedを区別し、維持対象外の感染者と混同しない。
- Food / Civilian Goodsの基本維持費、過密追加費、住宅停電追加費、合計維持費。
- Civilian Goodsの生産、軍需工場投入、維持消費を分離した収支。
- 給電不足・感染・復旧待ち等の主な生産停止原因と詳細Queryへの導線。

「維持可能人口＝Civilian Goods生産量」という無条件の人口上限は表示しない。人口配置、過密、電力、投入資源に依存するため、現在の構成の予測収支を正本にする。

### 6.9.3 Gas Zombieの攻撃プレビュー

- 直接攻撃による撃破時に起きる死亡爆発について、影響する隣接Hexを示す。
- 公開範囲のUnitについて、地形軽減・残HPを反映した被害と死亡見込みを示す。
- 公開Facility / Checkpointについて、予測感染数、健常人口0への到達、陥落・停止への影響を示す。
- 爆発による敵への利益と、自軍への損失を同じプレビューで示す。
- 公開情報で求められる連鎖と、隠蔽情報のため確定できない範囲を区別する。隠蔽個体の存在を示すフラグは出さない。
- 非致死攻撃では即時爆発が発生しないことを区別する。
- 敵フェーズの追跡・迎撃・反撃による将来爆発を、この即時プレビューの確定結果に含めない。

### 6.9.4 施設復旧・防御の説明

- ruined / disabled等の状態とは別に、施設種別に応じた復旧可否を示す。
- 奪還、感染鎮圧、敵排除、復旧待ち等、現在不足している条件を示す。
- 復旧開始前の日時nullと、回復不能を区別する。
- 生産再開には別途人口・補給・電力等が必要な場合、それを奪還と区別する。
- 地形防御の理由と倍率が一致することを確認し、Urban Overlayを施設・Checkpointと対応付けて説明する。

### 6.9.5 Action契約と候補検索

- `PLAY_WITH_AI.md`と機械可読API情報に、主要Actionの必須フィールド・例・対象条件を示す。
- Move / Attack / AssignWorkers / TransferPopulation / SetCheckpointPolicy / TurnAwayCheckpointRefugees等を対象にする。
- TransferPopulationはCoreで許可される任意整数人数をAgent APIからも指定可能にする。
- 移送元・移送先ごとに、指定可能な整数人数の最小値・最大値・制約・RevisionをQueryで取得する。TransferPopulationのfromFacilityId / toFacilityId / peopleを指定して実行する。0人は実行候補にせず、合法範囲が空なら理由を返す。
- 列挙型Legal Actionsは有限の具体例として維持し、人口移送の全合法人数を網羅する契約にはしない。例に存在しない人数もCoreが合法と判定すれば受理する。機械可読APIでパラメータ候補の取得先と列挙の非網羅性を明示し、既存Agentの具体例利用経路も維持する。
- 人数・対象資格・ターン開始Snapshot・Action予算は既存Core検証を使用し、不正Actionの状態不変を維持する。
- 建設候補を支線・施設種別等で絞り込めるようにし、Checkpointの補給差分へ全候補取得なしで到達できるようにする。
- Turn Awayはwaitingのみが対象であること、退去可能人数、対応する維持費減少を示す。全Queueを退去可能と誤認させない。
- Normal / Strictの審査拒否とTurn Awayのどれも将来Wave強化に関係し得ることを説明する。ただし現行どおりFinal roster freeze後の拒絶はBonusを増加させない。正確な非公開CounterやBonus計算状態は公開しない。

### 6.9.6 実行確認

- 既存play-turnの実行済み・拒否・未実行の結果を推奨経路にする。
- バッチ停止後は未実行Actionを適用済みとして扱わないことを文書化する。
- 受理された結果のRevisionと観測された状態を確認する例を載せる。


### 6.9.7 v1.5.7 Compact・変更理由・壁情報

- 維持人口・維持費内訳・資源終値予測を保ち、利用可能都市人口を`availableCityPopulation`として総人口と分ける。
- Compactは全4支線のID・managed・Active Checkpoint IDまたはnull・方針・次回到着Turnまたはnull・到着終了・現在Queueを返す。支線別`latestPublicFlow`は直近4件の公開到着／審査を処理Turn付きで返す。未管理素通りと検問所受入は公開payloadで区別する。
- 確定Revision間の`facilityChanges`と`branchFlowChanges`をAction/EndTurnへ返す。状態から確認した変化と関連公開Eventを分ける。status/newは現在状態のみ。支線Queueの前後差を到着人数や累積値と混同しない。
- `productionStops`はPlayer施設の停止ID・理由・給電理由・予測出力を最大8件、総数と省略数、同Revisionのfacilities Query導線付きで返す。電源喪失、Fuel不足、容量／割当不足、感染、復旧待ち、人口不足を区別する。大きな停止と失われた電源はwarningの`production_outage`。未計算の将来枯渇・不可避敗北を保証しない。
- `population-transfers`はfromReason/toReason/actionBudgetReason、任意正整数のmin/maxを返す。`worker-assignments`はtargetReason/populationReason/actionBudgetReasonと都市別の健常人口・供給可能人口・不適格理由を返す。Turn開始Snapshotを途中で作り直さない。
- 現在可視の`barbedWire`と建設候補・不許可理由、静的`barbedWire`規則、HumanのMP5と実移動Hex由来Fuelを提供する。Mapの基礎移動値と動的壁による実効値を分け、Artifact復元時にも壁を反映する。
- 壁上Humanの`conditionalIncomingCombat`は視認済み敵ごとに攻撃値・壁Damage・残壁HP・Human貫通Damage・残HPを返す。敵が実際に移動／選択／攻撃するという予告ではない。攻撃時の条件付き反撃予測と既存Gas撃破プレビューも維持する。
- 公開建設数、視認済み破壊数、可視Damage、Human肩代わり量だけをMetrics化する。Hiddenな壁HP・破壊・敵IDはObservation、Event、Artifact、UIへ漏らさない。
- 日英Help／Legendと内政のHex選択に性能・配置図・禁止理由を示す。壁とHumanは同Hexタブで選び分け、見出しの壁HPとHuman HPを分ける。修理・撤去・返金・視界源は追加しない。
- Balancedは公開壁の突破コスト・Human被害軽減・合法建設を評価し、RandomはLegal Actionsを安定キーで扱う。全面戦略改修や勝率保証は行わない。

---

# 7. 固定マップと初期状態


### 6.9.8 v1.5.7 公開判断情報とQuery契約

- 公開判断の解釈をStore、CLI、Browser Transportから独立した純粋関数として共有する。Full Observationを差分専用にせず、公開情報への完全なアクセスを維持する。
- CompactのimportantChangesは、直近の受理EndTurn以降（そのEndTurnを含む）の施設喪失・停止・復旧、生産/電源喪失、人口・感染・補給・Unit・Checkpoint・新規視認の重要な変化を保持する。受理Decisionの公開前後差分とEventだけを根拠にし、通常消費を施設喪失と混同しない。
- 各項目は安定ID、severity、entityIds、reasonCodes、関連Event、二次影響を持ち、重大度・新しいDecision・安定IDの順に最大10件、内側配列も最大10件とする。total/omittedとrevision固定のhistory Query案内で省略を明示する。Step/play-turnは自身のDecision、Statusは最近の期間を返す。Restart/Resume後も復元し、Branchは分岐後のみ、Rejected Actionとidempotent再送では重複追加しない。
- Compact施設はoperationalStatus、capacity、population操作可否/理由/増減、production/recoveryの理由を短く公開する。詳細は既存施設Queryへ委ねる。
- combatHazardsは既存の合法Attack Previewにある致死Gas攻撃から、公開された味方Unit死亡・自拠点陥落の危険だけを最大5件抽出する。巻き添え配列は最大10件、件数と追加Query案内を持つ。Hidden状態、合法でない攻撃、仮想の未来探索を根拠にしない。
- api.queryContractは全targetのfilters、必須値、enum、既定値、pagination、response/error、実行可能例をJSON Schema 2020-12の対応部分集合で返す。入力Validatorも同じSchemaを使用する。未知key、不正型/null、不正enum/負数を理由付きinvalid_queryで拒否し、expectedRevision不一致はstale_revisionとする。
- strategic-map Queryは道路の次数2区間を圧縮し、施設・Checkpoint・分岐/端点・閉路の安定NodeとEdgeを公開する。未接続施設も明示し、collection=nodes/edgesを独立ページ化する。Map IDは固定Mapを維持する。
- route QueryはUnit指定時に現在位置・実移動/燃料/補給規則を使い、Unitなしのsource/destination指定は移動能力を持たない参考経路として区別する。到達不能理由、距離/必要MP、戦略Node列、補給遷移、任意Hex列を返す。長い配列はrangesで別々にページ化し、詳細列の省略と経路不存在を混同しない。通常一覧は既定100/最大500件、revision固定で取得する。

## 7.1 マップ

- Map IDは`fixed-51x51-v4`、寸法は51×51、有効座標は`q=0..50`、`r=0..50`とする。Capitalは`(25,25)`、Horde EntranceはNorth `(25,0)`、East `(50,25)`、South `(25,50)`、West `(0,25)`とする。
- 外周2列、すなわち`q = 0 | 1 | 49 | 50`または`r = 0 | 1 | 49 | 50`の重複を除く392 Hexを、公開の静的Map Rule `hordeSpawnReserve`とする。各Tileは`playerOccupancyAllowed`を持ち、Reserveではfalse、その他ではtrueである。
- RoadはCapital Junctionを含む`q=25`の全Hexと`r=25`の全Hexから成り、North／East／South／Westの4支線はCapitalから各Entranceまで25 Hexとする。Entranceと恒久FacilityのRoad Hexも支線へ含めるが、Facility HexはCheckpoint候補外とする。
- 基礎Terrainは`plain`、`forest`、`mountain`、`water`。Road、Urban、Facility、CheckpointはOverlay／属性として分離する。標準MapにWaterは置かず、Random MapやSeedによるTerrain生成も行わない。
- 180度回転を`R(q,r) = (50-q, 50-r)`とする。Mountainは次のSeed集合とその`R`像、Forestは次のSeed集合とその`R`像から生成する。

```text
Mountain seed
r=4:  q=14..18
r=5:  q=13..18
r=6:  q=12..17, q=36..39
r=7:  q=11..16, q=35..39
r=8:  q=10..15, q=34..38
r=9:  q=9..14,  q=34..37
r=10: q=8..13,  q=33..36

Forest seed
r=1:  q=2..9,   q=38..48
r=2:  q=2..11,  q=36..48
r=3:  q=3..13,  q=35..47
r=4:  q=3..12,  q=34..46
r=5:  q=4..12,  q=33..45
r=6:  q=4..11,  q=32..44
r=7:  q=3..10,  q=31..43
r=8:  q=4..9,   q=31..44
r=9:  q=3..8,   q=32..45
r=10: q=4..7,   q=32..46
r=11: q=33..45
r=12: q=34..44
r=13: q=5..11
r=14: q=4..12
r=15: q=5..13
r=16: q=6..14
r=17: q=7..15
```

- Mountainを先、Forestを後に配置し、重複時はMountainを優先する。その後、従来の幹線Roadと恒久Facilityの座標をPlainへ戻す。追加の集散路・進入路は基礎Terrainを変更しない。最終内訳はPlain 1961、Forest 514、Mountain 126、Water 0の全2601 Hexである。
- 進入先の実効Costを消費し、開始Hexは消費しない。Plain 1、Forest 2、Mountain 3、Waterは進入不能とする。RoadまたはUrban Hexは基礎Terrainに関係なくCost 1とする。
- HumanとGasを含む6種Normal AI系Zombieは同じ決定的な重み付き最短経路を使い、同Cost経路は安定座標順で決める。
- Player UnitはReserveへ進入、通過、停止、初期・完成・復帰配置できない。CheckpointのBuild／Relocate／ActivateとConstructible FacilityのBuildもReserveを拒否する。候補、Pathfinding、Legal Actions、Save validation、不変条件は同じMap RuleとReason Codeを使い、拒否はState、Resource、Action回数、RNGを変更しない。ZombieのSpawn、移動、停止、およびReserve内ZombieへのAttack、Counterattack、Interception、Damageは許可する。
- Urban Hex上のGround Unitは被通常Combat Damage×0.5、Forest上のZombieは×0.5。Urbanを優先し、重複しない。RoadはForest防御を消さない。Terrain防御は通常攻撃、反撃、迎撃にだけ適用する。
- Human UnitのGround Visionは5、Normal／Horde／Gas Zombieは3、Police／Soldier／Riot／Hunter Zombieは5。CapitalのGround Visionは5、所有・未陥落施設とActive CheckpointはGround Vision 1を提供する。Player所有で未陥落のArmy BaseはWorker 0でGround Vision 1、Worker 1..10でGround Vision 5を提供し、感染・停止・復旧・Supply外・停電でもこれを維持する。Standby、Dormant、Remnant、Ruined、AbandonedはVisionを提供しない。
- Ground LOS、Visibility、Hidden Enemyの公開・実行時停止の境界、Aerial Visionの遮蔽無視は共通の純粋Queryを維持する。Visibility外Enemyの位置・個体情報・Target・移動・正確なSpawn位置は公開せず、Last Known Positionも保持しない。

静的恒久Facilityは29施設とし、座標と初期状態を次へ固定する。

| ID | Type | 座標 | 初期状態 |
|---|---|---:|---|
| `capital` | Capital | `(25,25)` | owned |
| `city-1` | City | `(25,20)` | disconnected |
| `city-2` | City | `(24,8)` | disconnected |
| `city-3` | City | `(33,25)` | disconnected |
| `city-4` | City | `(43,24)` | disconnected |
| `city-5` | City | `(25,34)` | disconnected |
| `city-6` | City | `(26,43)` | disconnected |
| `city-7` | City | `(16,25)` | disconnected |
| `city-8` | City | `(7,26)` | disconnected |
| `farm-1` | Farm | `(23,25)` | owned |
| `farm-2` | Farm | `(21,11)` | disconnected |
| `farm-3` | Farm | `(39,20)` | disconnected |
| `farm-4` | Farm | `(29,39)` | disconnected |
| `farm-5` | Farm | `(10,29)` | disconnected |
| `civilian-factory-1` | Civilian Factory | `(27,25)` | owned |
| `civilian-factory-2` | Civilian Factory | `(29,13)` | disconnected |
| `civilian-factory-3` | Civilian Factory | `(22,38)` | disconnected |
| `civilian-factory-4` | Civilian Factory | `(11,28)` | disconnected |
| `military-factory-1` | Military Factory | `(21,25)` | disconnected |
| `military-factory-2` | Military Factory | `(22,10)` | disconnected |
| `military-factory-3` | Military Factory | `(28,40)` | disconnected |
| `refinery-1` | Refinery | `(25,23)` | owned |
| `refinery-2` | Refinery | `(38,21)` | disconnected |
| `refinery-3` | Refinery | `(25,39)` | disconnected |
| `refinery-4` | Refinery | `(11,30)` | disconnected |
| `power-plant-1` | Power Plant | `(25,27)` | owned |
| `power-plant-2` | Power Plant | `(40,22)` | disconnected |
| `power-plant-3` | Power Plant | `(10,28)` | disconnected |
| `wind-power-plant-1` | Wind Power Plant | `(26,24)` | owned |

- Type別内訳はCapital 1、City 8、Farm 5、Civilian Factory 4、Military Factory 3、Refinery 4、Power Plant 3、Wind Power Plant 1である。Capitalを除く各Typeは最低1基がCapitalからDistance 5以内にある。初期所有はCapital、Farm 1、Civilian Factory 1、Refinery 1、Power Plant 1、Wind Power Plant 1の6基に限る。
- 新規ゲームでは上の29施設に加え、固定候補からSeed付きで選ばれた中立の`army-base-1`をちょうど1基置く。候補はCapitalからDistance 6以上、初期Supply外、施設・初期Human Unit・Reserveと非重複であり、選択位置は初期metadataへ保存する。Save／Loadで再抽選せず、実Stateは静的29＋Army Base 1の計30施設である。
- 全恒久FacilityはUrban Overlayを持ち、Road座標上ではRoad Overlayも維持する。全恒久Facility座標の基礎TerrainはPlainとする。4支線、Sector、Supply、Map Query、UI、Observation、Save、Replay、Testは同じ固定Map定義を使う。

## 7.2 人口上限

- 州都: ソフトキャップ100
- Temporary Housing: ソフトキャップ10、Hard Capなし
- 地方都市: ソフトキャップ50
- 生産施設: ハード上限30

都市はソフトキャップを超過できる。各値はConfig化する。

## 7.3 初期人口・部隊

民間人口100人:

- 州都41
- 農場1に23
- 民需工場1に23
- 製油所1に10
- 発電所1に3

Wind Power PlantはWorker 0固定である。初期未配置人口は存在しない。RegularのPolice 1隊（人口5）を`(24,25)`、RegularのNational Guard 1隊（人口10）を`(26,25)`へ配置する。

- 初期資源はFood 230、Civilian Goods 255、Military Goods 75、State Fuel 92とする。
- 初期PoliceのUnit Fuelは12、National Guardは22の満タンとし、State Fuel 92から差し引かない。
- 初期Normal ZombieはGame Seedで決定する25体とする。安定座標順の候補から置換なしで選び、Map内、CapitalからDistance 9以上、Facility・初期Human Unit・Reserve・既存初期Zombieと非重複、Zombie進入可能Terrainを満たす。Road／Urbanだけを理由に除外しない。候補不足は決定的にConfigを拒否する。
- 初期Hunter Zombieは通常Zombie 25体を確定した後、`initialHunterCount { min, max }`（標準1～4）を等確率で抽選し、Capitalから地形・移動コストを含めない最短Hex Distance `initialHunterMinDistance`（標準20）以上の通行可能かつ未占有の候補へ重複なく配置する。候補不足は初期化をCommitせず診断可能なエラーとする。初期Hunterの`spawnGroupId`と`hordeKind`は`null`である。
- 初期Gas ZombieはNormal 25体とHunterを確定した後、`initialGasCount { min, max }`（標準1～2）を等確率で抽選し、CapitalからHex Distance 9以上、Map内、Zombie通行可能、施設・初期Human Unit・Reserve・既存初期Zombieと非重複の候補へ置換なしで配置する。`spawnGroupId`と`hordeKind`は`null`である。
- 同じVersion、Map、Config、SeedはArmy Base、初期Normal Zombie、Hunter、Gasの数、座標、PRNG消費順、Unit ID順を再現する。通常Zombie、Hunter、GasはいずれもHorde由来ではなく、所属情報は`null`である。

## 7.4 連絡途絶施設

- デフォルト無人。Human Unitが進入すると、Zombie駒がいなければ即時確保する。
- 荒廃感染施設は内部感染者を0にするまで復旧しない。
- 初期生存者・感染者は施設別固定値またはSeed付き範囲をConfigで指定できる。
- 新規確保・復旧した施設は次のプレイヤーターンから人口操作・編成に使用できる。

---

## 7.5. 固定マップの施設間接続道路

### 7.5.1 採用方針と今回の対象

2026-09-09のユーザー合意に基づき、「既存幹線を固定の骨格として維持し、地区連絡道・施設進入路・少数の周回路を決定的に生成する」方式を採用する。本章の採用方針は、方式選択から再確認する対象にしない。数値は4.8の実装開始値として具体化し、検証済みの最適値とは扱わない。

- 目的は、災害前から地方都市・農工業地区を支えていた道路網の表現である。美術上の基準を「平地の多い、農工業地区と複数の地方都市が点在する架空のアメリカ内陸州」とする。特定の実在州、実測道路密度、実寸の街区の再現は要求しない。
- 51×51の固定マップ、既存4幹線、州都、29静的恒久施設の位置・種類・初期人口、Army Baseの配置候補と抽選方式、Wave体系を維持する。
- 接続対象は29静的恒久施設と初期配置Army Base 1基とする。初期所有・未所有を問わず接続する。すでに幹線や生成道路上にある施設には、接続本数を満たすためだけの追加道を作らない。
- 基本道路網は固定入力から自動生成し、ゲームごとに作り替えない。Army Baseだけは配置決定後に局所的な進入路を追加する。固定マップ用生成器の導入であり、ランダムマップの提供ではない。
- 都市・工業地区の周囲は相対的に密に、地区間は疎にする。全域を均等な格子で埋めず、すべての施設を州都へ個別に直結せず、すべての施設間を相互接続しない。
- Playerが後から建設する施設への自動敷設、道路の建設Action・費用・維持費・破壊・修復は追加しない。施設の所有変更・陥落・撤去でも初期道路を再生成しない。
- 橋、トンネル、立体交差、高速道路の出入口、市街地発展シミュレーション、本格的な方位場生成は今回含めない。

### 7.5.2 ゲーム効果と変更しない境界

- 接続道路Hexへ入る移動コストは1とし、Human / Zombie双方に適用する。ZombieにはHorde・特殊Zombieを含む。道路の種類によるMP差は付けない。
- 現行の「進入先Hexで移動コストを決める」方式を維持する。道路の描画上の接続方向に沿った移動だけを割引する方式へは変更しない。道路外との出入りにも既存のHex移動規則を使う。
- 通行可否を先に判定する。水域などの通行不可地形、PlayerのSpawn Reserve進入禁止、その他の既存移動制約を道路で解除しない。
- 接続道路は完成済み基礎地形へ重ねるOverlayとし、Forest / MountainをPlainへ変換しない。道路だけではUrban防御を付与せず、基礎地形の防御・LOS遮蔽を変更しない。施設やCheckpointによる既存Urban判定は維持する。
- Supply Source、Supply Sector、幹線の支線所属、Checkpoint配置資格・候補・Fallback、避難民の入口・到着方面・経路、Wave入口・Spawn Zone・Spawn Reserveを変更しない。接続道路を新たな幹線支線として登録しない。
- 接続道路の有無だけでは施設の建設資格を変えない。接続道路上のPlainは、Supply・占有・施設重複等の既存条件を満たせば建設可能とする。既存幹線上の建設禁止は維持する。建設後も道路は残り、施設によるUrban効果は従来どおり適用する。
- 燃料消費式、移動力、Unit能力値、Noise、Target選択、道路優先AIは変更しない。ただし実効MPの変化による経路・実移動距離・燃料消費・接触時期の変化は許容し、7.5.13で比較する。
- Plainは道路なしでもMP1であるため主に景観効果となる。見た目を道路に沿わせる目的で、同コスト経路の優先順位を新設・変更しない。
- 入口やWave設定の不変と、出現後のZombieの進路・到達時期の不変を混同しない。後者は保証しない。

### 7.5.3 道路の階層と生成入出力

| 区分 | 役割 | 生成・描画上の扱い |
| --- | --- | --- |
| 幹線 `trunk` | 既存の広域流入軸 | 既存経路・支線定義を保持。最も強く表示する |
| 地区連絡道 `collector` | 都市・施設群・幹線を結ぶ | 基本道路網を形成し、地区ごとに方向のまとまりを持たせる |
| 施設進入路 `access` | 個別施設と道路網を結ぶ | 短い枝道。農場・生産施設・Army Baseでの行き止まりを許容する |

- `collector`と`access`は生成・描画・検証用の分類であり、新たなゲーム性能の区分ではない。都市内の細街路をすべて盤面道路として敷くことはしない。
- 生成器はCore内の純粋処理とし、地形・マップ境界・道路新設禁止区域・初期恒久施設・既存幹線・Layout Seed・道路Style設定を入力に取る。Phaser、DOM、現在のUnit、所有者、現在人口、感染、Supply状態を参照しない。
- 出力は道路区分付きの連続Hex経路、正規化した接続辺、生成器Version、入力・設定の識別情報、および検証用の生成結果レポートとする。正本と派生情報の関係は7.5.10に従う。
- 固定座標への依存は固定マップ側の入力作成に閉じ込める。生成器内部へ「q=25だから幹線」「特定Facility IDだけ特別な経路」といった分岐を埋め込まない。

```text
固定地形・既存幹線・29静的恒久施設
  → 地区の抽出
  → 地区連絡道による必須接続
  → 個別施設の必須進入路
  → 有効な周回路・横の連絡を予算内で追加
  → 基本道路網を確定
  → 既存方式で配置を決めたArmy Baseの進入路を追加
  → 不変条件検証・保存用道路データの確定
```

### 7.5.4 地区の抽出と接続点

- 州都と各地方都市を別々の地区中心とする。近接する都市を一つへ併合しない。道路用の地区はSupply Sector・幹線支線とは独立した生成上の分類であり、ゲームルールへ持ち込まない。
- 都市から6 Hex以内の非都市施設は、到達可能な最寄り都市へ割り当てる。同距離は座標q、r、Facility IDの安定順で決める。水域・禁止区域を隔て、道路として接続できない都市への所属は認めない。
- 都市へ割り当てられない施設は、安定順で未所属施設を起点にし、全メンバー間の最大Hex距離が6以下となる範囲で施設群にする。隣接関係の連鎖だけで長大な地区を作らない。単独施設の地区も許容する。
- 都市地区の代表接続点は都市Hexとする。非都市の施設群では、メンバーとの距離合計が最小の施設を代表とし、その近傍の通行可能・新設可能な非施設Hexから距離合計最小の接続点を選ぶ。候補不足時は探索範囲を段階的に広げ、上限はマップ内全候補とする。同評価は座標順で決める。
- 非都市施設の敷地を他施設への新設通過路にしない。地区道を施設群の近くへ通し、各施設へ短い進入路を付ける。都市Hexの通過と、既存幹線が元から施設Hexを通る部分は許容する。
- 地区・施設の重要度は静的な種別に基づく。初期値は州都4、地方都市3、複数施設群2、単独施設1とし、現在人口・戦況では変えない。これは道路生成の優先度であり、施設のゲーム能力値ではない。

### 7.5.5 必須接続の作成

- 既存幹線を接続済みの根として、未接続の地区を順次つなぐ。最小全域木の考え方を用いたPrim法に近い貪欲接続とし、道路共用で評価が変化するため厳密な最小全域木とは称さない。
- 各地区の近傍4地区と近隣の幹線接続点を初期候補とする。候補グラフが分断される、または実経路が作れない場合は近傍数を拡大し、最終的に全地区・利用可能な既存ネットワーク接続点を調べる。近傍4件を接続保証の前提にしない。
- 直線距離・Hex距離は候補の絞り込みにだけ使う。採否は4.6による地形込みの実経路と生成用コストで決める。山を横断する直近の相手を先に確定してから経路を押し込まない。
- 接続済みと未接続の間の実現可能候補のうち、生成用コストの小さいものを採用する。同コストは新設辺数、曲がり数、端点座標・ID、経路の座標列の順で決める。採用ごとに接続状況・共用コストを更新する。
- 新設経路が先に既存ネットワークへ到達した場合、その地点で合流させる。元の目標点まで不要な並走区間を増設しない。近接する接続点は原則2 Hex以内で合流を検討し、独立した隣接交差点を乱造しない。合流までの実経路も隣接Hex列で作り、座標の飛びや描画だけの接続で代用しない。新設5方向以上の交差点になる場合は別の接続点を選ぶ。
- 地区連絡道を確保した後、未接続の各施設を既存道路網へ最小負担の進入路でつなぐ。非都市施設は原則1本の進入路でよく、施設間を直接結ぶためだけの貫通路は作らない。
- 必須接続は任意道路の予算では打ち切らない。すべての対象施設が幹線へ到達できたことを検証してから、任意道路の追加へ進む。
- 幹線の根への縮約は接続判定に限る。経路評価・迂回距離の測定では幹線の実距離を使い、幹線内を距離0で移動した扱いにしない。

### 7.5.6 道路生成専用の経路評価

ゲーム中のMP最短経路とは別の生成用コストを使う。下表は敷設しやすさを表す無次元の重みであり、Playerが支払う建設費・移動MP・燃料消費ではない。

| 通過・新設対象 | 初期コスト |
| --- | ---: |
| Plainへ新設 | 10 |
| Forestへ新設 | 25 |
| Mountainへ新設 | 80 |
| 既存道路の接続辺を共用 | 3 |
| 水域・マップ外・道路新設禁止区域・Spawn Reserveへの新設 | 不可 |

- 土地の基礎コストに、不要な方向変更、地区の基準方向からの逸脱、既存道路直近での不要な並走への非負ペナルティを加える。既存道路の共用優遇は実際の接続辺にだけ適用し、道路Hexが隣接するだけでは共用とみなさない。
- 方向変更の初期ペナルティは60度相当3、120度相当6とし、直前の辺への即時逆行は禁止する。地区基準方向からの逸脱は2、1 Hex以内での不要な並走は8を初期値とする。施設入口・合流のために不可欠な短い近接区間は並走罰から除く。
- 地区の基準方向はHexの三つの対向軸から二つを選ぶ。固定マップの初期設定はq軸・r軸とし、地区単位で統一する。完全な90度格子は要求せず、Hexへの近似による細かな折れは描画で目立たなくする。毎Hexに独立した強いノイズを与えて蛇行させない。
- 共用優遇なしで求めた同じ端点間の実現可能経路の延長を基準に、共用による大回りは原則1.5倍までとする。超過する場合は共用優遇なしで再探索する。水域や禁止区域を横断する直線を基準距離にしない。
- 曲がりを評価する探索状態は少なくとも「Hex位置＋直前の進行方向」とする。位置だけをキーにすると異なる向きからの到達を誤って同一視するため、既存の移動用検索へ曲率ペナルティだけを追加しない。
- 道路専用の決定的なDijkstra探索を基本とする。A*へ最適化する場合は最小コスト3を含めて下界を守る。ゲーム中のUnit経路探索の同コスト時の順序は変更しない。
- 禁止区域は優先度を下げる対象ではなく、経路から除外する対象である。接続不能を解消するために禁止を解除したり地形を書き換えたりしない。既存幹線のSpawn Reserve内区間はそのまま維持し、追加道はReserve外で接続する。

### 7.5.7 周回路・横の連絡と道路量

- 必須接続後、都市・施設群・既存交差点の間で「近いが、道路上では大きく迂回する」候補を評価する。非都市施設の敷地やArmy Baseを周回路の中継点にしない。
- 道路延長は、隣接Hexを結ぶ重複のない無向辺の数で測る。同じ区間の複数回利用、逆向き表現、複数RoadSegmentへの所属を重複計上しない。道路Hex数も補助指標として別に記録する。
- 29静的恒久施設の必須接続で新設した辺数をBとし、任意道路の新設辺数上限を`floor(B × 0.30)`とする。既存幹線とArmy Base進入路はBに含めない。予算は使い切る目標ではなく上限であり、価値のない道を足して消化しない。
- 候補追加の前後で、端点間の道路グラフ上の実最短距離を測る。初期採用条件は「追加前距離が追加後の1.5倍以上」かつ「3辺以上短縮」とする。距離は地形上の移動MPではなく、明示的な道路接続辺の長さである。
- 採用条件を満たした候補を`(追加前距離 − 追加後距離) × 端点重要度の合計 ÷ 新設辺数`で評価し、高いものから採用する。新設辺数0は除外する。採用ごとに距離・予算・候補評価を更新する。同点は新設辺数の少ない順、端点座標・ID順で決める。
- 任意接続の端点間Hex距離は、初期値で`max(6, floor(min(width, height) / 4))`以下とする。現行51×51では12 Hexとなる。地区単位の連絡を優先し、州全体を横断する別の幹線や州都を必ず囲む環状道路を作らない。
- 追加によって6辺未満の短い閉路を作る候補、新たに5方向以上が集中する交差点、実質的な重複・不要な並走を作る候補は採用しない。新設交差点は原則3方向、上限4方向とする。既存幹線の接続形状は変更しない。
- 農場・Army Base等の行き止まりは許容する。一方、施設にも交差点にもつながらない意味のない末端は残さない。任意道路を削減・不採用にしても必須接続を失わないよう、接続を再検証する。

### 7.5.8 初期パラメータと調整の裁量

| 項目 | 実装開始値・扱い |
| --- | --- |
| 都市への施設割当半径 | 6 Hex |
| 都市に属さない施設群の最大直径 | 6 Hex |
| 初期近傍候補数 | 4。接続失敗時は全候補まで拡大 |
| 接続点の合流検討範囲 | 2 Hex |
| 地形・共用・方向等の重み | 4.6の表とペナルティを使う |
| 共用による迂回上限 | 優遇なしの実現可能経路延長の1.5倍 |
| 任意道路予算 | 必須新設辺数Bの30%を上限とする |
| 任意接続の最低効果 | 距離比1.5以上、かつ3辺以上短縮 |
| 最短の新規閉路 | 6辺 |
| 新設交差点の接続方向数 | 原則3、上限4 |
| 任意接続の距離上限 | 4.7のマップ寸法連動式。現行12 Hex |

これらは本書で選定した設計初期値であり、生成図・経路・難度の実測で妥当性を確認する。個々の係数、線幅、地区半径、候補数について、ユーザーに数値を個別選択させる必要はない。

実装側は4.1・7.5.2の境界と7.5.13の受入条件を守り、変更前後の生成図・指標・理由を残して調整できる。任意道路予算はまず20～40%の範囲で調整する。ほかの調整で対応できないとして対象施設・MP効果・幹線・補給・建設資格等の採用方針そのものを変える場合だけ、具体的な矛盾や検証結果を添えて判断へ戻す。未測定であることだけを理由に、方式や係数を未確定事項へ差し戻さない。

### 7.5.9 Army Base・Seed・生成タイミング

- 基本道路網は29静的恒久施設から先に生成する。固定マップのLayout Seed初期値は0とし、Game Seedを使って基本道路網を変化させない。生成器Version初期名は`connector-roads-v1`とする。
- Army Baseの位置は既存のGame Seedと既存の抽選処理で決め、その後に基地から基本道路網へ1本の必須進入路を追加する。すでに道路網上なら追加は不要とする。基地のために既存経路・地区・周回路を引き直さない。
- 基地進入路は必須接続として任意道路予算から除外し、既存経路へ最初に接続した地点で終える。基地を通過して別地区へ抜ける道や、基地由来の追加周回路は作らない。
- 道路生成は独立した乱数系列を使い、Army Base・初期Zombie・Hunter・Gas・避難民・感染・Wave用の既存RNGを消費しない。初期配置候補を道路の有無で変えない。
- 基地進入路の再現キーは基本道路網の識別情報と基地座標とする。基地位置が同じなら異なるGame Seedでも同じ進入路となる。乱数が不要な同点処理は座標・IDの安定順で決める。
- 生成はNew Gameのマップ初期化時に完了させる。毎Turn、Query、描画、Save読込、観戦シークでは生成し直さない。キャッシュする場合はMap IDだけでなく地形・施設・設定・Versionを含む内容識別子を使い、保持上限を設ける。
- RNG分離は道路以外の乱数列を不要にずらさないための保証であり、道路追加後のゲーム展開をv1.5.4と同一にする保証ではない。

### 7.5.10 接続データ・描画・保存

- 道路の正本は、区分と安定IDを持つ連続した隣接Hex経路とする。例となる意味上の型は`RoadSegment { id, role: 'trunk' | 'collector' | 'access', path: HexCoord[] }`である。実際の型名・配置先は既存構造へ合わせてよい。
- 正本から重複のない無向辺と六方向接続マスクを導出する。A→BとB→Aの接続が一致し、非隣接Hex・マップ外・自己辺を拒否する。派生情報も保存する場合は正本との一致を検証し、独立した二重の正本にしない。
- 既存幹線の接続辺は`roadBranches`等の実経路から導出する。道路Hexが隣接しているという理由だけで辺を作らない。道路が同じHexで交わる場合は平面交差として接続し、今回実装しない立体交差として隠して通さない。
- 描画は接続マスクに従う。幹線を最も太く・強く、地区連絡道を一段細く、施設進入路を控えめに表示する。同じ辺を共用する場合は幹線、地区連絡道、進入路の順で上位の見た目を使うが、幹線資格を新設道路へ伝播させない。
- 線端・曲がりを整えてHexの細かな折れを目立たなくしてよい。ただし非道路Hexへ経路があるように見せず、描画だけで別の道を接続しない。道路表示の区分は凡例・Hex情報へ反映する。
- 遠景では進入路を簡略化できるが、選択・経路確認時には必要な道筋を読めるようにする。道路のためにFacility / Checkpoint / Unitの表示・選択・タッチ領域を阻害しない。通常盤面と観戦で同じ描画規則を使う。
- Save / Session / 公開Artifactには確定した道路配置と生成器Version・Layout Seed・設定識別情報を保持する。Seedだけを保存し、読み込み時の最新生成器に道路を任せる方式にはしない。Version番号そのものの一覧は第6・9章で扱う。
- HumanとAgentの道路・実効移動情報を一致させ、道路・施設の公開範囲は既存の静的Map / FoW契約に従う。敵位置・内部Target・現在人口等を道路生成メタデータへ混入させない。
- 対応VersionのArtifactはその記録に保存された道路を使い、現在の生成器で置き換えない。旧Versionは拒否する。破損・不一致は理由を付けて拒否し、通常State・autosaveを変更しない。

### 7.5.11 現行コードへ統合する際の必須注意点

以下は追記時点の実装との接続上の注意であり、新機能の実装済み宣言ではない。

- `src/core/map.ts`の既存道路集合は地形生成時のPlain化と固定マップ検証にも使われている。接続道路をこの集合へ単純に足してForest / Mountainを消す変更は禁止する。基礎地形の生成後に別Overlayとして追加する。
- `road` / `isRoad()`の参照箇所を用途別に監査する。幹線資格用と移動道路用の判定を分離し、例えば`isTrunkRoad()`と`hasMovementRoad()`に相当する責務を持たせる。既存フラグの意味を一括で「全道路」へ広げない。
- `terrain.ts`の単体・検索用の移動コスト、移動Query、Human / Zombieの経路、UI / Agentの公開MPを同じCore規則へ統合する。タイルの基礎地形コストとOverlay適用後の実効コストを混同しない。
- Supply、Checkpoint候補、施設建設候補、初期配置、Map検証、Save / Session信頼境界、公開Map Projectionを確認する。特に既存の「道路では建設不可」を接続道路へ誤適用しない。
- Mapの正規化・同一性検証は「不変の基礎地形・幹線」「確定した接続道路」「Seed依存の基地進入路」を区別する。旧Mapの正規化結果をそのまま通す、または道路検証を省略して互換を装う変更はしない。
- `src/core/path.ts`の位置ベースの検索を道路生成へ流用する場合も、方向依存コストが必要な部分は4.6の専用探索へ分離する。既存ゲーム経路のタイブレーク変更を道路実装へ混ぜない。

### 7.5.12 将来のランダムマップと失敗時の扱い

- 地区抽出・地区道・施設進入路を分離し、将来の生成地形・幹線・施設も同じ入力契約から渡せるようにする。本版で地形・施設配置をランダム化する必要はない。
- 将来は「地形→都市中心・幹線→地区道→道路付近への施設配置→進入路」の順にも組み替えられる境界を保つ。現行固定配置をこの順序へ作り替えることはしない。
- 必須接続ができない場合は、近傍候補拡大、接続点の再選択、共用・曲がり等の美観上の優遇を外した再探索の順に有限回で試す。それでも不可能なら、対象施設・遮断条件・探索結果を含む生成エラーを返す。接続済みと偽って道路のない施設を残さない。
- 固定マップと全Army Base候補はリリース前に接続成功を必須とする。実行時に失敗した場合は理由を表示して新規開始を止め、既存Saveを維持する。失敗した部分道路だけでゲームを開始しない。
- 将来のランダムマップで必須接続に失敗した場合は上位の施設配置・マップ生成側へ差し戻す。上位側が上限付き・決定的な再配置または再生成を行う。道路生成器が水域・禁止区域を解除したり、無限再試行したりしない。
- 任意道路の候補が成立しない場合は単に不採用とする。任意予算を使い切れないことだけでは生成失敗にしない。

### 7.5.13 道路の受入条件と検証証跡

**構造・決定性**

- 全29静的恒久施設とArmy Baseが、明示的な道路接続辺を通って既存幹線へ到達できる。全Army Base候補位置を網羅して検証する。
- 追加経路は連続・範囲内で、新設禁止区域・水域・Spawn Reserveを踏まない。接続マスクが双方向で一致し、隣接しているだけの別道路が勝手につながらない。
- 道路区分、総延長、必須・任意別新設辺数、幹線共有率、地形別通過数、交差点次数、行き止まり数、閉路・迂回改善をレポートへ記録する。新設5方向交差点、短すぎる閉路、無意味な孤立末端を残さない。
- 同一入力・設定・Version・Layout Seedから正規化道路データとhashが一致する。入力配列を並べ替えても同じ結果になるよう安定順を固定する。`Math.random()`、日時、描画順へ依存しない。
- Game Seedを変えても基本道路網は同一であり、基地位置が同じなら基地進入路も同一となる。基地位置変更では基本道路網の辺・区分が変わらない。道路処理による既存RNGの追加消費が0であることを確認する。
- 切断地形、端点候補不足、任意予算0等の小さな合成Mapで、失敗・不採用・候補拡大を試験する。ランダムマップ機能の実装はこの試験の条件にしない。

**既存ルールの保全**

- 同一地形・施設・Unit・Checkpoint状態で道路Overlayだけを切り替え、Supply、支線所属、Checkpoint候補・理由、施設建設候補、防御、LOS、入口・Spawn Zone・Reserveが一致する。
- Plain / Forest / Mountain上の接続道路でHuman / 通常Zombie / 特殊Zombie / Hordeの実効MPが1となる。非道路は従来の地形コストのままで、Player Reserve進入禁止・水域禁止を解除しない。
- 接続道路上のPlainへの合法建設と、幹線・占有・Supply等による従来の不許可をそれぞれ試験する。道路方向に沿わない出入りも7.5.2の進入先Hex規則と一致する。
- UI / Agent / Coreの実効移動情報、Save Round Trip、Session再開、検証Replay、公開Artifact観戦の道路表示が一致する。

**景観・性能・間接的難度**

- 同じ基礎マップを「追加道路なし」「必須接続のみ」「任意道路込み」の3段階で可視化する。地形、施設、道路区分、基地進入路、禁止区域を識別できる検証図を残す。
- 都市・施設群では道がまとまり、地区間に余白があり、すべての施設を周回路へ押し込んでいないことを確認する。全域の道路Hex率だけで合否を決めない。地図画像・測定値が未作成の時点では、景観確認済みと記載しない。
- 住宅・AI変更をそろえた同一条件で3段階を比較し、主要施設間の到達MP・経路長・燃料消費、Waveから州都・主要防衛点への接触時期、Hunterの到達範囲を記録する。1戦の勝敗だけで難度を断定しない。
- Forest / Mountainを横切る追加道路を一覧化し、著しい短絡がある場合は経路重み、任意道路、または明示的な道路新設禁止区域で調整する。禁止区域は入力データとして理由付きで保持し、生成器内の座標例外にしない。
- New Game生成時間、道路データ量、道路描画による負荷を測定する。毎Turn・Query・パン・ズームで再探索せず、PCとモバイル相当viewportで施設・Unit・Checkpointの可読性と選択を確認する。実機未測定の場合は実機性能を保証しない。
- 最終採用した設定、生成図、正規化道路hash、全基地候補の接続結果、3段階比較の結果を検証用fixture・レポートへ残す。具体的な生成座標やhashを要件確定時点で捏造しない。


# 8. ユニット・戦闘

## 8.1 基礎性能

| ユニット | HP | Recruit Attack | Move | Range | Vision | 人口 |
|---|---:|---:|---:|---:|---:|---:|
| Police | 25 | 6 | 15 | 1 | 5 | 5 |
| National Guard | 50 | 12 | 10 | 2 | 5 | 10 |
| Riot Police | 75 | 9 | 10 | 1 | 5 | 10 |
| 通常Zombie | 15 | 5 | 3 | 1 | 3 | — |
| Horde Zombie | 40 | 5 | 3 | 1 | 3 | — |
| Police Zombie | 10 | 5 | 3 | 1 | 5 | — |
| Soldier Zombie | 20 | 10 | 5 | 1 | 5 | — |
| Riot Zombie | 60 | 5 | 3 | 1 | 5 | — |
| Hunter Zombie | 20 | 15 | 15 | 1 | 5 | — |
| Gas Zombie | 35 | 5 | 3 | 1 | 3 | — |

すべてConfig化する。Policeは州内即応、National Guardは接触拒否火力、Riot Policeは高耐久・民間被害なしの感染鎮圧とBlockadeを主な役割とする。Regular／Veteran AttackはRecruit Attackへ`ceil(recruitAttack × 1.25)`を適用し、Police 8、National Guard 15、Riot Police 12となる。通常Zombieは最大Charge 1、Horde Zombieは最大Charge 4、Police／Soldier／Riot／Hunter／Gas Zombieは最大Charge 1とし、Horde以外のWave所属ではChargeを4へ変更しない。

Police／Riot Policeは`maxFuel = 12`、National Guardは`maxFuel = 22`のUnit固有Fuel Poolを持つ。Police／Riot Policeは`maxMilitaryGoods = 5`、National Guardは`maxMilitaryGoods = 20`のUnit固有携行軍需品を持ち、初期Unitは満載で開始して国家備蓄を追加消費しない。

## 8.2 熟練度とAttack Charge

- Human Unitは`recruit / regular / veteran`の熟練度を持つ。初期Police／National GuardはRegular、新規完成UnitはConfigの`productionProficiencyByType`に従い標準Recruitとなる。
- Recruitとして完成・配置されたPlayer Turnを0とし、以後5回のPlayer Turn Startを生存して迎えると、回復・補給・Action開始前にRegularへ昇格する。Recruit時代のKillは持ち越さない。
- Regular昇格後、通常攻撃、Counterattack、Interceptionの直接Combat DamageでZombie Unitを5体撃破すると`veteranPromotionPending`になり、次Player Turn StartにVeteranへ昇格する。施設内感染者の鎮圧や二次効果はKill Creditへ含めない。
- Recruit／Regularの最大Attack Chargeは1、Veteranは2である。通常Attack、Counterattack、Interception、自動感染鎮圧が同じChargeを消費する。5体目撃破のTurn中にChargeを追加しない。
- Player Turn Startに生存Human UnitのChargeを熟練度上限へ補充する。Waitは残Chargeを保持し、移動後にChargeが残ればAttack可能、1回Attack後は移動不能だがVeteranは残Chargeで再Attackできる。

## 8.3 行動

- 各人間ユニットはプレイヤーターン中に1回アクティベートでき、Attack ChargeだけがVeteranの追加Combatを許す。
- 移動のみ、攻撃のみ、移動後攻撃、移動後またはその場で待機を選べる。
- 攻撃後は移動できず、攻撃または待機で行動を確定する。
- 1タイルに存在できるユニット駒は敵味方を問わず1つ。施設はタイル属性である。

## 8.4 移動Fuel

- 経路合法性はPoliceでは進入Terrain Costの累積`<= 15`、National Guard／Riot Policeでは`<= 10`で判定する。Fuel CostはTerrain Costでなく実際に進入したHex数を使う。
- PoliceのFuel Costは距離0で0、1..5 Hexで1、6 Hex以降は1 Hexごとに1増加する。式は`distance <= 5 ? 1 : 1 + (distance - 5)`とする。
- Riot PoliceはPoliceと同じFuel Cost、National Guardは距離0で0、1..5 Hexで1、6 Hex以降は1 Hexごとに2増加する。式は`distance <= 5 ? 1 : 1 + 2 * (distance - 5)`とする。
- Move開始時に予定経路のFuelを保有しないActionは拒否する。Hidden Enemyで途中停止した場合は実進入Hex数から再計算する。
- Attack、Wait、Counterattack、Interception、自動鎮圧はFuelを消費しない。死亡Unitの残FuelはState Fuelへ戻さない。
- `currentFuel = 0`のHuman UnitだけはEmergency Movementを利用できる。通常のMovement Budgetに代えてPolice 3 MP、National Guard／Riot Police 2 MPを上限とし、Terrain Costを累積する。Emergency MoveはFuelを消費せず、移動後もFuel 0のまま、通常移動と同様に行動状態を更新する。Fuelが1以上ならEmergency候補を出さない。

## 8.5 戦闘・迎撃

- 攻撃側が先にAttack分のダメージを与える。
- 生存した防御側が、射程内かつAttack Chargeありの場合だけ反撃する。
- 通常攻撃、反撃、迎撃は実行UnitのAttack Chargeを1消費する。
- 移動経路で初めて敵射程へ入った地点で迎撃し、その地点で移動を終了する。
- 生存していれば攻撃または待機できる。
- HPを0未満にせず、死亡ユニットを盤面と合法手から除外する。
- 防御側HexのTerrain防御を攻撃、反撃、迎撃へ適用し、軽減前後Damageと防御源をEvent／Metricsへ残す。
- Human Unitが行う通常攻撃、反撃、迎撃は、命中処理の直前に距離別の携行Military Goodsを確認・消費する。Police／Riot Police距離1、National Guard距離1は1を消費し、不足0なら消費0・Attackを`max(1, ceil(unit.attack × militaryGoodsShortageAttackMultiplier))`へ弱体化する（標準Multiplier 0.2のRegular時の結果はPolice 2、National Guard 3、Riot Police 3）。National Guard距離2は2を必要とし、0または1なら全Combat種別で不成立とする。消費順序と結果は通常攻撃、反撃、迎撃で共通とし、死亡Unitの残軍需は国家備蓄へ戻さない。

## 8.6 自然回復

Human Unitは次のプレイヤーターン開始時、判定時に補給圏内で生存していれば1回だけ自然回復する。通常攻撃・反撃・迎撃・自動鎮圧を行った場合は最大HPの10%、移動のみ・待機・移動後待機・未行動の場合は20%、補給圏外は0%とする。標準端数処理は各ユニット個別の切り上げで、Configの`combatRate`、`restRate`、`rounding`に従う。HP上限を超えず、Zombieは回復しない。移動済みでも休養回復を妨げず、補給判定は回復時点で再評価する。

## 8.7 追加編成

- Police／Riot Policeは操作可能な州都・地方都市、National Guardは操作可能な州都だけで予約できる。
- 編成拠点は補給圏内でなければならない。予約後に補給圏を失っても支払い済みの編成は予定どおり完成する。
- 次の自ターン開始時に完成し、そのターンから行動可能とする。
- 完成拠点が埋まっていれば最寄り空きヘックスへ置き、同距離はSeed付き乱数で決める。
- 人口はターン開始時の供給順位で都市から徴用する。
- 最後の健全民間人口を使う編成は拒否する。
- 初期コストはPoliceが人口5・民需品10・軍需品10、National Guardが人口10・民需品20・軍需品25、Riot Policeが人口10・民需品25・軍需品25。
- 完成Unitは`currentFuel = 0`で生成し、直後にState Fuelから同時完成UnitのID昇順1 Fuel単位Round Robinで有償補給する。不足時は部分補給とし、そのPlayer Turnから保有Fuelで支払えるMoveを実行できる。
- 完成UnitはConfig指定熟練度（標準Recruit）で、編成Cost以外に国家備蓄を消費せず、`currentMilitaryGoods = maxMilitaryGoods`の満載で生成する。

## 8.8 全Zombieの足止め・隣接攻撃

- Normal AI系、Horde、Gasを含む全Zombieは、経路上で初めて生存Player Unitへ隣接したHexに到達すると移動を終える。行動開始時から隣接なら移動0であり、Human UnitのCharge、canAttack、携行軍需、迎撃可否には依存しない。
- 先に移動Human Unitの既存迎撃とZombie反撃、次に可能なArmy Base迎撃を処理する。直接効果と連鎖後もZombieが生存し、攻撃Chargeと条件を満たせば隣接Player Unitへ通常攻撃する。複数候補は人数最大、同数はUnit ID安定順を正規化したSeed付き抽選で決める。攻撃後は再移動しない。
- Army Base自体は足止め源ではない。実迎撃が距離1..2で発生した場合だけそのZombieを止める。迎撃、反撃、死亡、Gas連鎖で候補が変わるたびに生存・射程・合法性を再評価する。

## 8.9 Gas Zombie

- Gas ZombieはNormal AIで、`visible population > inherited Horde target > noise target > idle`の優先順に行動する。初期は1..2体を追加し、通常Zombie 25体とHunter 1..4体を維持する。Waveでは最後とその前のWaveだけが対象で、標準ではTurn 35／50でのみ出現する。
- 非Horde Slotは対象前が`zombie 70 / police 10 / soldier 10 / riot 5 / hunter 5`、最後の2 Waveでは`zombie 65 / police 10 / soldier 10 / riot 5 / hunter 5 / gas 5`とする。Gasは1方向・1 Waveにつき最大1体で、上限到達Typeを除いて重みを再正規化する。Rejected BonusもBaseの後に同じ重み表で抽選し、Riot／Hunter／Gas CapをDirection単位で共有する。
- Gasは死亡原因を問わず1回だけ、死亡Hexの隣接6 Hexへ爆発する。中心と距離2以上は対象外で、範囲の全Unitへdamage 30（UrbanのGround UnitまたはForestのZombieは15）、Facility／Checkpointの健常者へ`min(30, healthyPopulation)`の感染変換を与える。City住民、Worker、Checkpointの`waiting → screening → approved`を既存人口として扱う。
- 各爆発は対象Snapshotを確定して直接効果を全て適用してから、Unit死亡、Reanimation、拠点陥落・Spawn・即時占有を処理する。死亡GasはUnit ID安定順、爆発キューはFIFOで連鎖させ、同じ爆発で新生した個体をその対象へ加えない。巻き添え撃破はHuman Unitの熟練度Kill Creditへ加えない。

## 8.10 Army Base

- Army BaseはWorker上限10、初期Worker 0、感染者0、専用Military Goods 40／40の恒久施設である。Workerは食料・Civilian Goods維持、感染、Zombie人口目標、人口敗北判定に含むが、都市住民・避難民受入・都市間移住先・通常州兵の徴用対象にはしない。基地は資源生産・Supply Sourceではない。
- Player所有で未陥落ならWorker 0でVision 1、Worker 1..10でVision 5を提供する。中立・陥落中はVisionを提供しない。確保時Turn `<= 20`なら、1ゲームに1回だけRegular National Guardを人口・資源・電力不要で即時得る。Fuel 22と携行Military Goods 20で生成し、基地Hexが埋まっていれば通常完成Unitと同じ最寄り合法Hexへ置き、全Mapに配置先がない場合は権利を保留する。
- 基地ではNational Guardだけを通常編成できる。安全で操作可能かつSupply内のPlayer所有基地で予約し、人口10はターン開始時のCapital／City供給順位からだけ徴用する。Civilian Goods 20と国家Military Goods 25を支払い、専用軍需は使わない。通常完成はRecruit、携行Military Goods 20、既存の有償Fuel補給を使う。
- 正常稼働中で予約があるTurnだけ、Worker 0でも電力5を要求する。給電順位はCapital／City、occupied Temporary Housing、Farm／Civilian Factory、入力確保済みMilitary Factory、Refinery、Civilian Drone Base、Army Base予約、empty Temporary Housingの順である。予約前Forecastはこの需要を含め、不足は警告しても予約を拒否しない。未給電、感染、disabled、recoveringでは予約と支払いを保持して需要0とし、正常稼働後の給電を待つ。基地が陥落すれば予約を没収し、人口・資源を返さず、再確保で復活させない。
- 各Zombie Phase開始時、Player所有・正常稼働でWorkerがいる基地の迎撃残回数をWorker数にする。距離0..2のZombieへAttack 10、1射ごとに残回数1と専用軍需2を消費し、`armyBase` Noise Radius 8を発生させる。距離1..2では1射でZombieを止め、距離0では撃破・残回数0・軍需不足・基地機能停止まで連射する。基地迎撃はSupply・電力不要で、ZombieのCounterattackを発生させない。
- Unitへの通常軍需補充を全て終えた後、Player所有・正常稼働・Supply内の基地だけを、国家Military Goods残量から専用軍需40まで補充する。部分補充を許し、Supply外・感染・disabled・recovering・陥落中は補充しない。専用軍需と報酬状態は陥落・復旧を通じて保持する。

---

# 9. 人口移動・都市

## 9.1 原則

すべての民間人口は州都、地方都市、Temporary Housing、生産施設、Army Base、検問所、感染施設のいずれかに所在地を持つ。所在地のない「無職者」「未配置人口」は持たない。Army Base Workerは専用の施設人口で、都市住民・避難民・移住先・通常編成の供給人口と混同しない。

## 9.2 ターン開始時スナップショット

ターン開始時に、所有中かつ陥落していない州都・地方都市・Temporary Housingについて、供給・受入の安定順と人口操作資格を固定する。

- 供給順位は健常人口降順、同数は`facilityId`昇順とする。Supply外Temporary Housingは人口供給、移住、編成の候補から除く。
- 自動受入は通常CityのSoft Cap空き、Temporary HousingのSoft Cap空きの順で使う。Housingの空きと混雑率には`workers + infected`、通常Cityには既存の在所人数を使う。
- 全候補がSoft Capへ達した後は在所人数／Soft Capが最小の候補を選び、同率はSnapshotの安定順とする。

同時に、安全かつ前ターン以前に確保・復旧済みかを人口操作資格として固定する。感染都市も順位と資源不足時の損失順には含めるが、供給・受入・移住・編成ではスキップする。ターン途中に順位を再計算せず、途中で感染・陥落した候補は利用不能にする。途中で新規確保・復旧した都市は次ターンまで順位表・候補へ追加しない。

## 9.3 生産施設への配置・撤収

- 安全で操作可能な所有生産施設だけを変更できる。
- 追加人口は補給圏内の施設に限り、供給順位都市から順に差し引く。
- 撤収人口は受入順位都市をソフトキャップまで順に満たす。
- 通常都市の空き、次に仮設住宅の空きを使う。全候補がSoft Cap到達後は総在所人数／Soft Capが最小の候補へ1人ずつ配分し、同率は既存安定順とする。
- 供給不足または安全な帰還先なしの場合はAction全体を拒否する。
- 感染中の施設は追加・撤収とも禁止する。
- 補給圏外でも既存労働者の生産と減員・帰還は継続し、自動撤収、即時停止、人口損失は発生させない。
- Army Baseの増員は安全・操作可能・Supply内でのみ都市供給順位から行い、撤収は既存の帰還条件を使う。Supply外であることだけを撤収禁止理由にしない。

## 9.4 都市間移住

- 操作可能な安全都市間で、距離を無視して任意人数を原子的に移動できる。
- 移動元人口を超えない。
- 移動先のソフトキャップ超過を許可する。
- 感染中、新規確保直後、復旧直後の都市は使用できない。

## 9.5 無人施設

- 手動移動または資源不足で人口0になっても所有を維持し、無人・停止状態になる。
- 通常施設は感染によって健常人口0になった場合に陥落する。空のPlayer-owned CapitalはZombie侵入で即陥落・敗北し、空のTemporary Housingは即消滅する。

---

# 10. 資源・生産・過密

## 10.1 資源

- 食料、民需品、軍需品、燃料は備蓄する。
- 電力は備蓄せず、そのターンのCapacityとする。

生産初期値:

| 施設 | Power Mode | Demand | 無給電／OFF | 給電時または通常出力 |
|---|---|---:|---|---|
| 州都・都市 | required | 10 | 民需品0 | SoftCapまで民需品1 / worker |
| 農場 | required | 5 | 食料0 | 食料10 / worker |
| 民需工場 | required | 15 | 民需品0 | 民需品10 / worker |
| 軍需工場 | required | 20 | 軍需品0 | 民需品Input成立時に軍需品4 / operating worker |
| 製油所 | required | 10 | 燃料0 | 燃料5 / worker |
| Civilian Drone Base | required | 5 | Vision 0 | 既存Vision |
| Army Base | conditional | 5 | 通常州兵予約の電力需要0 | 正常稼働中の予約だけ電力5 |
| Simple Farm | none | 0 | — | 食料5 / worker |
| Power Plant | none | 0 | — | 燃料2で電力5（物理Capacity 15 / worker） |
| Wind Power Plant | none | 0 | — | Electricity 15 |
| Temporary Housing | required | 5 | 居住者がいれば追加維持費 | 条件付きでCivilian Goods最大5 |

## 10.2 同ターン生産と備蓄原則

- EndTurn開始時の人口・Unit・Checkpoint健常Queue・過密からFood、Civilian Goods、Unit別Military Goods固定消費を先に固定する。Checkpointの`waiting + screening + approved`を維持人口へ加え、`infected`は除く。Food不足死亡で同ターンのCivilian Goods必要量を減らさない。
- 当ターン生産したFood、Civilian Goods、Military Goodsは同ターンの維持消費へ使用できる。
- 当ターン生産した資源は別工程の生産入力へ使用できない。当ターンRefinery生産Fuelは次ターンから発電へ、当ターン生産Civilian Goodsは次ターンからMilitary Factory入力へ使用できる。
- 同ターンCivilian Goods増産で市民維持用予約が減った場合は、余ったTurn-start Civilian GoodsをMilitary Factory入力へ回せる。Turn-start Civilian Goodsが0なら同ターン増産だけでMilitary Factoryを稼働できない。

## 10.3 電力利用区分

- Required需要はCapital／City 10、Farm 5、Civilian Factory 15、Military Factory 20、Refinery 10、Drone 5、Housing 5。Army Base予約は正常稼働時だけ5。各施設の必要量を一括給電し、部分給電しない。
- Capital／Cityは健常住民がいるとき自動要求し、停電時は民需品出力だけ停止する。Housingは完成・未陥落なら健常住民0でも要求し、健常住民の有無によって順位を分ける。HousingのSupply切断時はGrid給電なし。
- SetPowerSupplyは既存Farm／Civilian Factory／Military Factory／Refinery／Droneだけ。Housingにtoggleを追加しない。既存の無料・同Turn内繰り返し可能なAction条件を維持する。
- Simple Farm、Power Plant、Wind、CheckpointはPower Mode none。Army Baseの予約条件とSupply喪失後の継続は8.10に従う。

## 10.4 発電、優先順位別割当、Unit補給

- 稼働中Wind Power PlantはFuel不要の固定Electricity 15を先に供給する。Power Plantの物理発電Capacityは全所有・非感染・非陥落発電所の`workers × 15`を州全体で合算する。
- Windで足りない実割当5 ElectricityごとにTurn-start State Fuel 2を消費する。利用可能電力は`operationalWindCapacity + min(powerPlantPhysicalCapacity, floor(turnStartFuel / 2) × 5)`で、余剰CapacityへFuelを消費しない。Fuel 1で部分発電はしない。
- 電力はCapital／City、occupied Housing、Farm／Civilian Factory、入力確保済みMilitary Factory、Refinery、Drone、Army Base予約、empty Housingの順で割り当てる。occupiedはworkers > 0であり、infectedだけのHousingはemptyとする。
- 各段階内は確保時期が古い施設、同順位は`facilityId`昇順とする。未給電理由は物理Capacity不足、Turn-start Fuel不足、同段階の順位負け、Power Supply OFF、人口／労働者0または非対象、Military Factory入力なしを区別する。
- 複数発電所のCapacityと電力は州全体で共有し、送電線、地域別停電、蓄電、発電所ごとのFuel在庫は扱わない。
- 発電Fuel消費後、施設生産前に残るState Fuelから、判定時点で生存かつSupply内のHuman Unitを補給する。`maxFuel - currentFuel`を需要とし、Unit ID昇順の1 Fuel単位Round Robinで満タンUnitを飛ばして配分する。Supply外Unitは補給しない。
- 当TurnのRefinery生産Fuelは発電にもUnit補給にも使わず、Ending Stockへ加えて次Turnから利用する。ForecastとEndTurnは同じ純粋計算経路を使う。

## 10.5 Civilian Goods予約と経済処理順

Civilian Goodsの市民維持をMilitary Factory入力より優先する。

```text
maintenanceReservation
= max(0, maintenanceRequired - projectedSameTurnCivilianProduction)

productionInputAvailable
= max(0, startingStock - maintenanceReservation)
```

経済処理は、維持必要量固定、Wind供給確定、Power需要とPower Plant物理Capacity確定、優先順位別給電、実割当分の発電Fuel消費、残FuelによるSupply内Unit補給、施設生産、生産物追加、Food／Civilian Goods維持消費、Unit ID昇順の携行Military Goods固定消費・補充、Army Base専用軍需の補充、自動鎮圧、不足被害の順とする。Civilian Goodsの維持予約はMilitary Factory入力より優先し、ForecastとEndTurnは同じ純粋計算経路を使う。

## 10.6 通常消費

- 食料: 都市住民＋生産施設労働者＋Army Base Worker＋警察人口＋州兵人口＋Checkpointの`waiting + screening + approved`と同数
- 民需品: 同上
- 軍需品は民間人口やUnit人口による州全体維持消費を持たない。Supply内の生存Human UnitをUnit ID昇順に処理し、Police 0、National Guard 1の固定消費を携行量から差し引いた後、国家備蓄から各Unitの最大量まで1単位Round Robinで補充する。Supply外Unitは固定消費も補充も行わない。
- Human Unit補充後、Player所有・正常稼働・Supply内のArmy BaseをFacility ID順に処理し、国家備蓄の残量から専用Military Goodsを最大40まで補充する。Supply外を含む他状態では国家備蓄を消費しない。
- Checkpoint健常3Poolは通常維持消費に含めるが、感染者は含めない。Checkpoint人口は都市過密率そのものには加えない。ただし都市過密率による追加消費は、Checkpoint健常者を含む通常消費全体へ適用する。
- Food不足、続くCivilian Goods不足ではCheckpoint健常者を都市・生産施設人口より先に減らす。複数CheckpointはNorth／East／South／West、同支線内Checkpoint ID、Pool内`waiting → screening → approved`の安定順とする。不足死亡はRejected Counterに加算せず、人口不足Metricsだけへ記録する。
- Civilian Goodsの`productionInputShortage`はMilitary Factory減産理由であり、市民死亡へ変換しない。`maintenanceShortage`だけを不足被害へ使う。

## 10.7 過密

```text
都市民需品生産 = min(都市人口, SoftCap)
都市過密率 = max(0, 都市人口 - SoftCap) / SoftCap
州全体過密率 = Σ 都市過密率
追加消費 = ceil(通常消費 × 州全体過密率)
```

- 過密率合計に上限を設けない。
- 過密都市があり、対象の通常消費が正なら追加消費を最低1とする。
- 食料・民需品へ別々に追加し、軍需品、燃料、電力へ適用しない。
- EndTurn時点で計算し、その直後の経済処理に課す。
- UI予測と実消費を一致させる。

## 10.8 不足被害

- 食料不足1、民需品不足1につき民間人口1人を失い、両者を別々に処理する。
- 食料不足を先、民需品不足を後にする。
- 都市住民をターン開始時の供給順位で先に減らす。
- 次に、確保順が新しい生産施設から減らし、同順は`facilityId`昇順とする。
- 個別施設が0人になっても感染による0でなければ陥落しない。
- 健全民間人口合計0で即時敗北する。
- 軍需品不足は民間人口損失を起こさない。全州一括の軍需供給状態や一括射程低下は持たず、各Unitの現在携行量とCombat距離から実効射程・攻撃力をその都度導出する。

## 10.9 Wind Power Plant

### 10.9.1 Player-built Wind

- Wind Power を Constructible に追加する。
- 建設費: Civilian Goods 100
- Generation: 15 固定
- Worker: 0
- 建設条件は Temporary Housing と同じく Plain + Supply + 既存 Constructible 禁止条件。
- 建設 Turn は building で発電・Noiseなし。次 Player Turn Start から Operational。
- Player-built Wind の Build Limit は `roadBranches.length`。現Mapでは4。
- 初期配置 Wind はこの上限 Count に含めない。
- Player-built Wind は `building / operational / disabled / recovering` の間すべて slot を消費する。
- Wind は decommission 不可。

### 10.9.2 Initial / player-built parity

- 初期 Wind と Player-built Wind は、建設由来を除き同じ性能・Vision・Zombie contact / disabled / recovery semantics を持つ。
- Zombie contact 時は既存 Wind と同じ disabled / recoverable behavior とし、Temporary Housing のように消滅しない。
- Vision も既存 Wind rule を継承する。

### 10.9.3 Supply

- Build 時だけ Supply が必要。
- 完成後は Supply Network 外になっても、owned + operational である限り発電15とNoiseを継続する。

### 10.9.4 Noise

- `zombieTargetValue=5` を初期 Wind / Player-built Wind の両方から完全廃止する。
- Wind 自体は Visible Population Target 候補にならない。
- operational Wind は毎 Turn、その Wind Hex を中心に Radius 8 の Noise Pulse を 1 回発生させる。
- 4基あれば4 Pulse。各Pulseは独立し、既存共通Noise ruleにより Fallen Site Respawn をPulseごとに発生させ得る。
- `building / disabled / recovering` 中は generation 0 / Noise 0。
- operational 復帰 Turn から generation / Noise を再開する。
- 複数 Wind の Noise は既存 stable facility order（securedOrder、それで同値なら既存ID/座標 stable order）で1基ずつ完全解決する。
- Wind order に RNG を使わない。

### 10.9.5 Zombie Phase timing

EndTurn の順序を次のようにする。

`INTERNAL INFECTION -> WIND NOISE EMIT -> ZOMBIE TARGET SNAPSHOT -> ZOMBIE MOVE / COMBAT`

- Wind Noise は同じ EndTurn の Zombie target snapshot に反映する。
- これは mid-phase retarget ではなく、snapshot 取得前の Noise emission とする。
- `wave_capital` を持つ Wave Normal / 特殊 Zombie は Anchor が Noise より優先されるため、Wind Noiseでは逸れない。

## 10.10 Constructible Facility

- 共通条件: Supply内・Plain・Reserve外、Road／Entrance／Facility／Checkpoint／Player Unit／Visible Zombieなし。Hidden Zombieは公開合法性を妨げない。建設は1 Player Actionを消費し、建設Turnは効果なし、次Player Turn開始時に完成する。
- Simple Farm: Civilian Goods 25、最大roadBranches.length基、Worker0..10、Food5/worker、電力不要。既存のSupply喪失・disabled／recovering・感染時消滅を維持する。
- Civilian Drone Base: Civilian Goods 50、最大ceil(roadBranches.length/2)基、Worker0..5、給電5でVision workers×3。空・非感染・非building・Zombie非占有ならSupply外でも撤去可、1 Action、返却25。
- Temporary Housingは10.13、Windは10.9に従う。Wind撤去不可、Simple Farm撤去不可。
- 各上限は建設中・operational・disabled・recovering等の現存建設物を数え、初期Windを建設Wind上限へ含めない。

## 10.11 Strategic Forecast

- CoreはFood、Civilian Goods、Military Goods、Fuel、Electricityごとに、現在不足、寄与Facility、最大寄与Facility、最大寄与量、その1施設を仮想喪失した場合の不足量とSingle Point of Failureを純粋計算する。
- 現在の公開状態のままEndTurnした経済処理でFood、続いてCivilian Goods不足を適用し、健全民間人口0が確定する場合はGuaranteed Defeatを返す。Zombie行動、Hidden Zombie、潜伏感染、避難民乱数、将来Horde接触は含めない。
- CheckpointのBuild／Relocate／Activate候補は現在・予測支線半径、新規Supply／Supply喪失Hex数とFacility ID、Facility差分、新規Constructible建設可能Hex数を同じCore Validationから返す。Visible Zombieだけを阻害へ使う。
- Checkpoint Queue Pressureは`waiting + screening + approved`を人数、screening capacity 20を容量とし、0は`none`、1..20は`low`、21..40は`medium`、41以上は`high`とする。将来到着・潜伏感染の乱数は公開しない。
- Forecastと候補QueryはState、Resource、Action回数、PRNGを変更せず、UI、Observation、Balanced Agentが同じ結果を使う。


### v1.5.7 資源持続見込み

Strategic Forecastの各資源runwayは現在備蓄、現在生産、最大寄与施設の生産、同施設喪失時生産、需要内訳、netBurn、最初に不足する相対Turnを公開する。現状継続と単一最大寄与施設喪失の仮定を分け、static_current_conditionsを明示する。Food等の生産/維持順序、民需品の生産入力予約、Fuelの当Turn生産先取り禁止、Army Base軍需補充要求を既存EndTurn処理と揃える。使い切って不足しなかったTurnを不足Turnと数えない。Electricityは非貯蔵、減耗なし、入力依存で推定不能の場合はnullと理由を返す。これは将来の敵行動や複数施設連鎖の保証ではない。resource_runway_riskは次EndTurn不足をcritical、2～3Turnをwarningにし、同じ資源のGuaranteed Defeatと重複させない。

## 10.12 AI向けProduction Capacity

- `strategicForecast.productionCapacity`をAI Observation、Session Compact要約と詳細Queryへ公開し、人間HUDには新しい余力表示を追加しない。現在生産は実処理と同じ経済計画から取得する。
- Session Compactは資源ごとに`projectedEndTurnOutput`、`ratedUpperBoundAtCurrentCityPopulation`、`ratedGapUpperBound`、`utilizationRatio`、`blockingReasonCounts`を、対象Turn、人口基準、上限の同時達成可否、理由の重複、再配置最大量が未計算であること、利用可能人口・残Actionの前提とともに返す。電力は利用可能量、需要、実割当、未割当利用可能量、貯蔵不可、Fuel基準を要約する。設備別内訳、中間段階値、都市Soft Cap詳細は`query forecast`で取得する。
- 食料・民需品・軍需品・燃料について、実行予測生産、所有完成設備の定格上限、現都市健全人口（Soft Capまで）による生産、現配置労働者の定格、現計画の電力反映前生産、定格差分、稼働率を分離する。都市Soft Capまでの人口不足も施設詳細へ公開する。定格0の稼働率はnullと`no_rated_capacity`を返す。
- 設備上限は感染・停止・復旧中の所有完成施設も含み、未確保・建設中・破壊済みを除く。労働者不足、感染、復旧、電力、入力資源不足等の理由は重複可能として公開する。理由数や資源別上限は加算して同時達成可能量と解釈しない。
- 電力は定格、現労働者能力、現計画の物理能力、実供給可能量、需要、割当、未割当を分離する。貯蔵不可、発電Fuelはターン開始備蓄に基づくことを明示する。再配置後の実現可能余力は探索せず`feasibleHeadroom: not_computed`とし、現在の配置可能都市人口・残Action・前提を併記する。

## 10.13 Temporary Housing

### 10.13.1 基本

- 新 Constructible Facility `temporaryHousing` を追加する。
- 建設費: Civilian Goods 25
- 電力需要: 5
- Soft Capacity: 10
- 建設上限: なし
- Civilian Goods output: 正常稼働・Supply内・給電中・感染者0のとき、住宅ごとに `floor(min(健常住民,10) × 0.5)`。0/1人は0、2人は1、9人は4、10人以上は5。完成前は生産せず、通常経済処理の順序で当ターン維持費へ利用する。
- Recruitment Hub 能力: なし
- Unit recruitment / production action は提供しない。
- Player-built Temporary Housing 自身は recruitment hub ではないが、Supply 内の健常住民は既存の共通 population pool に参加し、Capital 等の合法 Recruitment Hub での人口 cost に利用可能。

### 10.13.2 建設

- 現在視認中のPlain + Supply 上のみ建設可（全Constructible共通）。
- 既存 Constructible の禁止条件をすべて維持する。幹線Road / Entrance / Reserve / existing Facility / Checkpoint / Player Unit / visible Zombie 等がある Hex は不可。
- 視界外の建設先はHidden Zombie／壁の有無と無関係に`constructible_not_visible`で拒否する。視認判定より先にHiddenな占有状態を理由へ出さない。
- 建設 Turn は `building` で効果なし。次 Player Turn Start に Operational 化する。
- Operational 化した Turn から Capacity / population function / Power Demand が有効になる。

### 10.13.3 City-like population behavior

- Temporary Housing は人口収容・Refugee reception・population transfer・healthy civilian defeat count 等について City-like として扱う。
- ただし Recruitment Hub ではない。
- 健常住民は healthy civilian defeat condition に含める。
- Vision 1 を持つ。Power outage / Supply disconnect 中でも Vision 1 を維持する。
- Zombie Visible Population Target Value は健常住民 `workers` のみを使う。`workers=0` なら感染者がいても Visible Population Target 候補にはならない。

### 10.13.4 Refugee auto-distribution

- 新規 Refugee はまず通常 City の Soft Capacity 空きを優先する。
- その後 Temporary Housing の Soft Capacity 空きを使用する。
- Temporary Housing の受入余力判定では `workers + infected` を使う。
- 全 eligible City / Housing が Soft Capacity 到達後も受入を継続する。
- Soft Capacity 超過後の自動配分先は、受入混雑率 `(workers + infected) / softCapacity` が最も低い Facility とする。同率時は既存 stable order。
- 実際の Overcrowding Penalty 計算は健常住民 `workers` のみで行う。
- 感染者が多い Housing を自動受入先として優先しない。

### 10.13.5 Population transfer

- 手動人口移送は健常住民 `workers` のみ。
- 感染者の施設間移送機能は追加しない。
- Temporary Housing への手動移送は Soft Capacity 10 を超えても合法。Capacity は Hard Cap ではない。
- `workers + infected` が 10 以上でも、明示的な Player transfer 自体は阻害しない。ただし UI / Agent は総在所人数と warning を表示できる。

### 10.13.6 Supply disconnect

- 建設には Supply が必要だが、建設後に Supply Network から切断されても Facility・既存住民・Soft Capacity は維持する。
- Supply 外では次を停止する。
  - 新規 Refugee 自動受入
  - Supply population pool 参加
  - 他 City との population transfer 元 / 先
  - Recruitment 用 population contribution
- Supply 復旧後に再参加する。
- Supply 外でも Vision 1、Overcrowding 判定、healthy civilian defeat count、Zombie Target eligibility は維持する。

### 10.13.7 Power allocation / outage penalty

Power allocation priority は次のとおり。

1. Capital / normal City
2. occupied Temporary Housing
3. 既存 production / normal-demand tiers（Farm / Civilian Factory -> Military Factory -> Refinery -> Drone -> Army Base reservation の現行順）
4. empty Temporary Housing

- Temporary Housing に Player Power Supply ON/OFF toggle は設けない。
- occupied 判定は健常住民 `workers > 0` のみ。
- `workers=0 / infected>0` は Power allocation 上 empty Housing tier とする。
- empty unpowered Housing は outage penalty 対象外。
- occupied Housing が power を得られない場合、1棟につき通常 Food / Civilian Goods maintenance に +1% の追加 maintenance penalty を与える。
- Supply disconnect により Grid power を受けられない occupied Housing も同じ outage penalty 対象。
- 原因表示は `power_shortage` と `supply_disconnected` を区別できるようにする。
- outage count を先に合計し、各 resource ごとに一度だけ計算する。
  - `ceil(normalFoodMaintenance * outageCount / 100)`
  - `ceil(normalCivilianGoodsMaintenance * outageCount / 100)`
- Overcrowding Penalty と outage penalty は独立原因・独立 breakdown とする。
- 両方該当すれば両方加算する。
- どちらも penalty 適用前の通常 maintenance を基礎に独立計算し、相互に複利計算しない。

### 10.13.8 Turn snapshot

- EndTurn 中の Power Allocation は EndTurn 開始時 snapshot で固定する。
- EndTurn 途中の Refugee reception により empty -> occupied へ変化しても、その EndTurn 中は Power tier を再配分しない。
- 次 Player Turn から occupied tier として扱う。

### 10.13.9 Overcrowding

- Soft Capacity は 10。Hard Cap ではない。
- Temporary Housing の Overcrowding 判定・Penaltyには健常住民 `workers` のみを数える。`infected` は Penalty 人口に数えない。
- ただし受入余力・自動配分混雑率には `workers + infected` を使う。

### 10.13.10 Zombie contact / fall

- `workers=0 / infected=0` の Temporary Housing に Zombie が侵入した場合、即座に fall / disappear する。追加 Zombie spawn は無い。侵入した Zombie は Hex に残る。
- `workers=0 / infected>0` は空 Housing 特例にしない。通常の infection / fall 処理を行う。
- `workers>0` の場合も通常 City と同じ infection progression を行い、fall 条件成立時に Housing を削除する。
- infection / fall で生成する Zombie は現行 site spawn と同じ Normal Zombie 固定。Wave weighted table は使わない。
- Housing 消滅後は Fallen Site を残さず、通常 Plain Hex へ戻す。

### 10.13.11 Decommission

- Temporary Housing は decommission 可。
- 条件:
  - Player-owned
  - `workers=0`
  - `infected=0`
  - building ではない
  - Zombie 非占有
- Supply 接続は不要。
- 1 Player Action を消費。
- Refund 0。

### 10.13.12 民需品生産とMetrics

正常稼働・Supply内・給電中・感染者0の全条件で、健常住民10人まで×0.5を住宅ごとに切り捨てて生産する。感染者が残る間は健常者がいても停止する。生産は既存経済フェーズのみで実行し、感染解消直後の即時生産は行わない。給電順位・通常維持費・過密・追加停電維持費は維持する。満員住宅でも通常民需品維持費10に対し生産は5であり、食料・電力を別途必要とする。

公開統計は `housingBuilt`、`housingResidentTurns`（健常住民の累積人ターン）、`housingCivilianGoodsProduced`、`housingOutageFacilityTurns`（棟ターン）。Metricsの `housingResidentsFinal` は終局時点の健常住民数であり、累積値と区別する。

## 10.14 次ターン過密・住宅停電予測

### 10.14.1 目的

Human / AI の両方へ、次 Turn に確定的に発生する Overcrowding と Temporary Housing outage penalty を事前通知する。

### 10.14.2 予測対象

- 未来 RNG は予測・推測しない。
- deterministic な人口移動・既に結果が確定した Screening outcome 等だけを予測に含める。
- 建設中 Temporary Housing が次 Player Turn Start に確実に Operational 化する場合、その +10 Soft Capacity を予測へ含める。
- 建設中 Wind が次 Player Turn Start に確実に Operational 化する場合、その +15 Generation を予測へ含める。
- 建設中 Housing の +5 Power Demand 等、確定済み build completion を含めて次 Turn Power Allocation を再計算する。

### 10.14.3 更新タイミング / performance

- Player Action 成功など、予測結果へ影響する Game State mutation の直後に再計算する。
- UI render frame ごとには再計算しない。
- 結果を cache し、Human UI / Agent Observation は cache を読む。
- 人口移送・建設・decommission 等で予測 penalty が0になったら、該当 warning を即座に UI / Observation から削除する。
- 過去 warning の履歴は Event Log 等にのみ残す。

### 10.14.4 Public output

Overcrowding と Temporary Housing outage は別 Crisis Reason Code とする。

Human / AIへ、各Reasonについて以下を公開する。

- 発生有無
- 原因 / 対象
- penalty ratio
- Food の具体的追加 maintenance 予測
- Civilian Goods の具体的追加 maintenance 予測

例:

- Overcrowding: Food +4 / Civilian Goods +4
- Temporary Housing outage: 2棟, +2%, Food +2 / Civilian Goods +2

未来 RNG や hidden information は公開しない。

---

## 10.15 有刺鉄線（Barbed Wire）

### 10.15.1 基本性能

| 項目 | 確定仕様 |
| --- | --- |
| 日本語/英語表示 | 有刺鉄線 / Barbed Wire |
| 最大HP | 20 |
| 建設費 | Civilian Goods 5 + Military Goods 5 |
| 個数上限 | 固定上限なし。配置資格と通常Action予算は適用 |
| 修理・自然回復 | なし |
| 視界・補給・人口・生産・電力 | 提供せず、需要・維持費も持たない |
| Human | 通過・停止可能。進入先の実効移動コスト5 |
| Zombie | HPが残る間は進入・通過・停止不可。隣接から攻撃可能 |
| HP0 | 直ちに消滅。元の基礎地形・道路を維持 |

- 施設/Unitではなく、HPを持つ独立した障害物として扱う。既存の施設上限、Urban判定、施設Vision、Zombie人口Target、供給Sourceへ暗黙に混入させない。
- 地形防御、LOS遮蔽を追加・除去しない。元のForest等のLOSは残る。
- Humanの進入MP5は道路MP1・地形コストより優先し、追加5ではなく合計5。水域・Spawn Reserve等の通行禁止は解除しない。
- 移動力不足やEmergency Movementでも同じMP5を要求し、足りなければ入れない。Fuelは既存の実移動Hex数による式を維持し、MP5を5Hex分のFuelと扱わない。
- Humanが壁上から退出する際は、進入先Hexのコストを払う。退出時の追加壁コストはない。
- 任意撤去・売却・返金・アップグレードは追加しない。

### 10.15.2 建設

- BuildBarbedWire相当のGameActionを追加し、1回に1Hex、内政Action枠1を消費して即時完成する。建設Unitや労働者は要求しない。
- 現在視認中、補給内、通行可能、Spawn Reserve外の空きHexだけを許可する。
- 既存施設・建設中施設・荒廃施設・Checkpointとその残存跡、既存壁、Human/Zombie UnitのあるHexには建設不可。
- 幹線/接続道路上も建設可能。Checkpoint用の幹線資格や既存施設用の幹線建設禁止を有刺鉄線へ流用しない。
- Enemy隣接地には建設不可。Hidden Enemyの存在を候補の合法性から漏らさないよう、隣接6Hexも現在視認できることを建設資格とし、その全HexがEnemy不在であることを確認する。盤外Hexは視認確認対象から除外する。
- 10.15.3で新設壁と不適格な前後関係になる可能性がある距離1/2のHexも、現在視認できることを要求する。そこでの既存壁の有無を公開情報だけで判定し、視界外の壁破壊を建設候補の変化から漏らさない。視認不足は敵/壁の実在にかかわらず同じ理由で拒否する。
- 補給喪失や視界喪失で既存壁を消滅させない。
- 壁のあるHexへの後続の施設/Checkpoint建設・移設を禁止する。建設順で施設共存禁止を回避できないようにする。
- 建設施設の対象Hexも現在視認を必須とする。壁建設後に視界を失った場合、壁が残っていても消滅していても同じ視認不足理由で拒否する。候補・実行・建設可能範囲の予測へ共通適用する。
- 資源不足、不適格、古いRevisionの拒否は資源・Action枠・State・RNGを変更しない。

### 10.15.3 放射方向の間隔制限

- 目的は横につながる防衛線を許し、州都へ向かって短い間隔で壁を重ねる配置を禁止すること。
- 以下を確定規則とする。州都C、異なる2壁A/Bについて、地形・道路・障害物を含めない最短Hex Distanceをdとする。
- Aが内側になるようd(C,A) <= d(C,B)と並べる。`d(C,B) = d(C,A) + d(A,B)`なら、州都への最短経路上で前後に並ぶ組とする。
- この組は`d(A,B) >= 3`を必須とする。すなわち間に少なくとも2Hexを置く。1または2なら建設不可。
- 州都から等距離の別Hex同士は横方向の配置として許可する。単なる「全壁同士の距離3以上」にはしない。
- 生存する全壁の組へ適用し、建設順や連結成分ごとの判定で回避させない。HP0で消滅した壁は制限対象から除く。
- 任意の敵の現在Target・Hidden経路には依存しない。州都を中心とする固定ルールとし、UI/AIで理由を再現できるようにする。
- 直線・斜め・折れた最短経路、同半径の連結、2Hex間隔、建設順逆転の図とfixtureを実装時に用意する。

### 10.15.4 壁への攻撃

- 全Zombie種は隣接Hex Distance1から攻撃できる。壁単独への攻撃もAttack Chargeを1消費し、DamageはそのZombieの実効攻撃力とする。
- 壁に地形防御・回避・反撃・感染・Reanimation・熟練度を付与しない。壁破壊をUnit KillやVeteran進捗へ加算しない。
- Humanから壁だけへの攻撃Actionは追加しない。壁はZombieのUnit占有制約を解除せず、他のZombieが隣接攻撃位置を占有している場合に同じ位置へ重ならない。
- 空き壁への攻撃はHuman Combat Noiseを発生させない。壁上Humanとの戦闘では通常のHuman Combat Noiseを維持する。
- HP0にした時点で壁を除去し、過剰Damageを周囲や後続Hexへ波及させない。壁上Humanへの攻撃の場合だけ10.15.5の貫通を適用する。
- 壁が残り、攻撃Chargeも残る場合は、同一敵フェーズに再攻撃できる。Hordeの4 Chargeは4回分として働く。

### 10.15.5 Humanへの肩代わり

- Humanが有刺鉄線のあるHex上で通常攻撃・反撃・迎撃のDamageを受ける場合、同Hexの壁が先に肩代わりする。壁がない/HP0なら通常処理とする。
- 攻撃側の既存の軍需不足補正等を適用した実効攻撃DamageをD、壁HPをHとする。壁Damageは`min(D,H)`、貫通分は`max(0,D-H)`とする。
- 壁自体への地形軽減は行わない。貫通分だけにHuman側の既存地形防御・端数処理を1回適用する。貫通分0ならHuman Damageは0で、最低1Damage規則を適用しない。
- 例: 壁HP20、Damage25、Humanに地形防御なしなら壁が消滅しHuman Damage5。壁HP20、Damage5なら壁HP15、Human Damage0。
- Humanを対象にした攻撃は、壁が全量肩代わりしても1回の通常戦闘である。生存Humanは既存の射程・Charge・軍需条件で反撃可能。壁Damageを理由に追加反撃や追加Charge消費を発生させない。
- 壁上Humanへ隣接したZombieは既存のHuman隣接停止を受ける。Humanへの攻撃で壁を壊しても、Human攻撃後の再移動禁止を維持する。
- Gas死亡爆発は肩代わり対象外とし、既存どおりHumanへ直接作用する。Gas爆発で壁HPは減少しない。感染・資源不足・その他の非戦闘損失も壁で防がない。
- Humanが同Hexにいる場合に、空の壁への攻撃として扱ってHumanへの貫通・反撃を回避する処理はしない。

### 10.15.6 Zombie移動・経路更新

- 既存Target優先順位を維持し、壁そのものに人口誘引を付けない。目的地への経路を塞ぐ壁を突破対象として扱う。
- 壁を単に永久通行不可として最短経路から除外し、完全な防衛線を前にZombieが無期限にidleになる実装は禁止する。迂回と突破の両方を探索対象にする。
- 経路評価は壁HP・攻撃力・残Chargeと通常移動コストを用いた決定的なルールとし、迂回か突破かの係数・タイブレークは実装時に固定・記録する。追加の乱数消費を必要としない。
- 空き壁だけへの攻撃は、破壊後に残MPで移動を継続できる特例とする。攻撃そのものはMPを消費せず、Chargeだけを消費する。元のTurn移動予算から既に使ったMPを差し引き、移動予算をリセットしない。
- 破壊後Hexへの進入は復元された地形/道路コストを払う。破壊だけで自動進入・ワープさせない。
- 壁破壊直後、同じ敵フェーズ中に通行情報・到達距離・経路cacheを失効させる。破壊した本人と未行動の後続Zombieが新しい盤面を参照する。
- 行動済みZombieへ再行動を与えず、残Charge0のZombieは移動できても追加攻撃できない。既存の移動不能・迎撃停止・Human隣接停止・死亡・終局を解除しない。
- 破壊後に新たなHuman・基地迎撃条件へ入ったら、既存の順序で処理する。壁破壊が移動中の迎撃を免除しない。
- State変更ごとに生存・占有・合法性を再評価し、既に消滅した壁への二重攻撃やHP負値を防ぐ。


### 10.15.7 決定的な経路評価と再生の境界

- 壁進入の探索コストは基礎Terrain／道路MP + 必要攻撃回数 + 将来Charge補充Turn数 × Zombie移動力。必要攻撃回数はceil(壁HP / 実効攻撃力)、将来補充Turn数はceil(max(0, 必要攻撃回数 − 残Charge) / 最大Charge)。同値は既存の座標経路順で決め、追加乱数を消費しない。
- 経路候補には迂回・突破の両方を残す。通常Terrainのcacheは壁を含めず、壁Damageは生存壁を毎回参照する。混雑時到達距離cacheのキーにも壁HPと敵の攻撃・Charge・移動力を含める。
- 既存のHuman死亡時の同Hex Reanimationを維持するため、Gasなどの非戦闘死亡で壁が残る場合は、再生したZombieの発生・退出までだけ壁上の例外とする。壁HPは減らさず、通常の新規発生時の行動不可も維持する。退出後の再進入は禁止。通常Zombieの初期配置・施設Spawn・移動にはこの例外を使わない。
- 配置図とfixture: `src/testing/fixtures/v156-spacing.svg` / `v156-spacing.json`。表示図と自動テストで同じ組を使う。

---


### 10.15.8 ビジュアルと共通統計

- 承認sourceから派生した256×256透過PNGを独立obstaclesカテゴリに登録し、一括Preloadする。Fogの後、Unitの前に描き、Human同居時も両方を識別できる。道路・Plain・Forest・Mountainで使い、低Zoom/Asset失敗時はFence形のFallbackとHPを維持する。Unit選択と壁選択、日英Legend/Helpで同じ意味とHP20を示す。
- 成功建設数、破壊数、実被ダメージ、Human肩代わり、空壁Charge、壁上Humanへの攻撃ChargeをGameStatisticsに保持し、通常終了画面、Agent結果、公開Replay結果で共有する。API名はbarbedWireBuilt/barbedWireDestroyed/barbedWireDamageTaken/barbedWireAbsorbedDamage/barbedWireEmptyAttackCharges/barbedWireOccupiedAttackCharges。
- 肩代わりは実被ダメージの内数。損傷壁HP3に5を与えても両方を5とは数えず実減少3を数える。HP20空壁へ5なら実被害5/肩代わり0/空壁Charge1、同居Humanへ25なら実被害20/肩代わり20/同居Charge1。破壊を一度だけ数え、Gas・予測・Query・Rejected Action・再送は加算しない。
- 建設成功と公開視認できる戦闘だけを集計対象にする。視界外の壁被害/Chargeを公開統計から推測させない。Save/ResumeとCheckpoint分岐は記録済み値を正確に維持する。

# 11. 感染・陥落・復旧

## 11.1 通常施設

ゾンビが施設タイル上でゾンビターンを終了した場合:

```text
newInfected = min(zombieAttack, healthyPopulation)
healthyPopulation -= newInfected
infected += newInfected
```

鎮圧されていない施設は、感染者が残る限り毎ターン次を行う。

```text
spread = min(infected, healthyPopulation)
healthyPopulation -= spread
infected += spread
```

## 11.2 鎮圧

- Human Unitが感染施設へ駐留すると内部感染の加算を停止する。
- EndTurn時、残Attack Charge数だけUnit ID順に自動鎮圧を判定する。通常攻撃・反撃・迎撃に使ったChargeは鎮圧へ使えず、Waitまたは移動だけなら残Chargeを使える。Veteranが2 Chargeを残せば最大2回鎮圧する。
- Police／Riot Policeは熟練度込みAttack相当を減らし、民間人被害0とする。National Guardは同じくAttack相当を減らす一方、各回`ceil(Attack × 0.5)`の民間人被害を出す。
- 自動鎮圧はUnit別Military Goods固定消費と補充の後に行う。1回につき携行軍需1を消費し、保有0なら感染加算を止める封じ込めだけを行って感染者数を減らさず、Chargeも消費しない。
- 即時`SuppressInfection`は公開Action、合法手、Human UI、Agent API、Bridgeから除去する。直接入力も状態とRNGを変えず拒否する。

## 11.3 陥落

- 通常施設は感染処理で健常人口0になった場合に陥落する。空CapitalのZombie侵入と空Housingの消滅は専用規則に従う。
- 通常施設は荒廃感染施設、検問所は荒廃検問所となる。
- 陥落時点の実感染者数だけを使い、Capacity補正や潜在感染者の自動加算は行わない。
- 標準Configは感染者5人につきNormal Zombie 1体、1解決最大6体、Spawn Radius 1、Noise再Spawn有効とする。要求数は`min(6, floor(currentInfected / 5))`、実生成数は要求数と隣接空き候補数の小さい方である。
- 候補は拠点からHex Distance 1、Map内、Unit不在、Normal Zombieが進入可能な基礎TerrainのHexに限る。Facility、Checkpoint、Road、Urban、Horde Spawn Reserve上は候補にできる。座標順へ正規化してSeed付きPRNGで選び、距離2以上は探索しない。
- 実際に生成できた1体につき感染者5人だけを減らす。配置不能はTechnical Failureにせず、恒久Facility／Checkpointには未変換感染者を残す。感染者0の空Checkpoint破壊では生成しない。
- Simple Farm／Civilian Drone Base／Temporary Housingは共通Spawn後に消滅し、残存感染者を死亡として計上して0にする。Wind Power Plantは感染者由来Spawnの対象外である。
- 生成Zombieは同じZombie Phase中に移動、通常Attack、Targetingを行わず、次回Zombie Phaseから通常行動する。ただし生成先のFacility／Checkpointへは生成直後に占有処理を1回行う。
- 即時占有で別拠点が陥落した場合は同じ共通式で生成を連鎖させる。生成Unit ID順のFIFOキューで各Unitを1回だけ処理し、新規生成Unitを末尾へ追加する。Action全体は原子的かつ同一Seedで決定的に解決する。
- 州都陥落時は共通Spawn、即時占有、連鎖、Event、Metricsをすべて処理した後に即敗北する。

## 11.4 復旧

恒久施設の感染者が0・ruinedで、生存Humanが同Hexに駐留し、Enemyが同HexにいなければPlayer所有・人口0で再確保する。進入完了時に加え、既に駐留している場合も自動鎮圧と内部感染処理の再評価で判定する。感染者0の再確保にCharge・軍需品は不要。残感染者には通常鎮圧を必要とする。人口操作・編成は次Player Turnからとし、電力・人口などの生産再開条件は別に評価する。建設施設は消滅後に復旧せず、Wind・Army Baseの専用停止／予約／報酬規則と終局判定を維持する。検問所は既存の所有・方針・Role規則を維持する。公開recoveryは同じCore条件から生成する。

## 11.5 Army Baseの感染・停止・復旧

- 基地Hexへ到達し、基地迎撃後も生存したZombieは`min(zombie.attack, healthyWorkers)`をWorkerから感染者へ変換する。隣接Gas爆発の感染も同じWorker Poolへ直接適用し、Worker Capacityを超える架空の人口は作らない。
- 健常Workerが0になれば通常の感染者5人ごとのNormal Zombie SpawnとFIFO占有を使って陥落する。基地は恒久施設として残り、専用軍需と報酬取得状態を保持し、未完成通常州兵予約は没収する。
- 健常Worker・感染者とも0の基地をZombieが占有すれば`disabled`にする。感染者を生成せず、陥落ではないので予約は保留する。Zombie排除、感染者0、Human Unitの再確保を経て`recovering`となり、次Player TurnからWorker 0の`operational`へ戻る。
- 感染、disabled、recovering、陥落中は基地迎撃と専用軍需補充を止める。Player所有・未陥落のVision、早期確保報酬、予約の保存条件は各機能の規則を維持する。

---

# 12. Checkpoint Fallback Network・避難民

## 12.1 Road BranchとPost Role

- 固定マップは州都の共有交差点から外側へ延びる東西南北の4支線を持つ。各支線は独立した次回到着予定（間隔2～4ターン、1回10～20人）を持ち、到着後に同じ支線の次予定をSeed付きで抽選する。到着人数は端点と奇数を含む整数を直接抽選し、旧値の倍化で得ない。新設、移設、Role変更、荒廃、復旧で到着予定を再抽選しない。Final roster freeze後は自然到着を終了し、`nextArrivalTurn`は`null`となり、次予定を抽選しない。
- Checkpointの物理`status`は`operational`、`remnant`、`ruined`、`abandoned`を維持する。行政Roleの正本は`RoadBranchState.activeCheckpointId`と重複しない`standbyCheckpointIds`であり、`CheckpointState`へ可変Roleを保存しない。
- `operational`でActiveでもStandbyでもない同支線PostはDormantである。Observation、UI、EventはCore共通導出関数から`active`、`standby`、`dormant`、`remnant`、`ruined`、`abandoned`を表示する。
- 各支線はActive最大1、Active＋Standby最大5とする。Configは`checkpoint.maxPreparedPostsPerDirection = 5`である。Dormant、Remnant、Ruined、Abandonedは上限を消費しないが、物理地点として残り同じHexへの建設を妨げる。Standby専用維持費はない。上限到達時のStandby新設は`checkpoint_prepared_post_limit_reached`で拒否し、自動撤去・自動降格・`DecommissionCheckpoint`は導入しない。

## 12.2 Active・Standby・Dormantの機能

- Activeだけが新規Refugee Arrivalを受け、Screening Queueを開始し、支線Policyを適用し、Supply FrontとCheckpoint Visionを提供する。
- StandbyはoperationalでAutomatic Fallbackの第一候補だが、新規到着、Screening開始、Supply、Visionを提供しない。
- DormantはoperationalだがActive／Standby上限外のPostであり、新規到着、Screening、Supply、Visionを提供しない。FallbackではStandbyがない場合だけ第二候補であり、Playerは手動でActive化できる。
- 現在Activeに属する既存Screening QueueとRemnantは通常どおり処理を続ける。Standby／Dormantは新規Queueを開始しない。

## 12.3 道路自然流入、方針、配置、潜伏感染

- Final roster freeze前の到着時にActiveがあればそこへ`waiting`として受け入れ、Activeがなければ素通り方針で同じ避難民フェーズ中に合格、都市配置、潜伏感染を処理する。未管理道路に不可視のPostや人口プールを作らず、安全な受入都市がない回の避難民は州内へ入れず繰り越さない。Final roster freeze後は新規到着を発生させず、既存Queueの審査、配置待ち、感染、Turn Awayは通常どおり続ける。
- ActiveとRemnantは`waiting`（審査待ち）、`screening`（審査中）、`approved`（配置待ち合格者）を持つ。審査枠は20人で、空きが生じた時点で最大20人を次Batchへ移す。超過分は切り捨て、延期、他道路への振替をしない。Policyは審査開始時に固定し、変更は次Batchから適用する。

| 方針 | 審査Turn | Batch Capacity | 理論最大Throughput | 合格率 | 感染発生率 | 発生人数率 |
|---|---:|---:|---:|---:|---:|---:|
| 素通り | 0 | 20 | 20 / Turn | 100% | 50% | 50% |
| 通常 | 2 | 20 | 10 / Turn | 75% | 25% | 25% |
| 厳格 | 5 | 20 | 4 / Turn | 50% | 0% | 0% |

- 合格人数は切り捨て、感染人数は切り上げる。安全な受入候補都市へ受入順位で自動配置し、通常Cityの空きを優先し、次にHousingの空き、超過後は総在所人数／SoftCapの最小比率を選ぶ。候補がなければ`approved`のままPostに留め、健常Queueとして通常維持費を消費する。候補が生じた次のPlayer Turn Startに配置する。素通りでは安全な都市があればSoftCap超過後も同フェーズ中に全員を配置する。
- 審査完了時の潜伏感染はSeed付きで判定する。配置済みなら健常人口のいる所有施設からSeed付きで発生先を選ぶ。`approved`で待機する場合はCheckpoint内で即時発生し、`approved → screening → waiting`の順に感染者へ変換する。この逆順は潜伏感染発覚時だけに使う。
- Policyの正本は`RoadBranchState.currentPolicy`で、初期値は`normal`である。`SetCheckpointPolicy`は`checkpointId`でなく`branchId`を受け、Activeがある支線だけ変更できる。Active不在中も直前値を保持し、Build、Relocate、Activate、Fallback、Recoveryで`normal`へ戻さない。開始済みBatchは開始時Policyを保持する。

## 12.4 Supply Sector

- Checkpointに関係なく、州都からHex Distance 5以内を全方向の初期Supply圏とする。各Tileは最も近い幹線道路支線のSectorとし、2本以上が同距離ならすべての同距離Sectorに含める。
- 州都からActiveまでの距離を`R`とし、その支線SectorのSupply半径を`max(5, R)`とする。共有境界はいずれか1つの有効Sectorで満たせばSupply内である。Standby／Dormant／Remnant／Ruined／AbandonedはSupplyを提供しない。
- ActiveのBuild、Relocate、Activate、Automatic Fallback、Recoveryの直後にSupplyを再計算する。Fallback A→BではB基準へ即時後退し、A-B間の前方施設はOut of Supplyになり得るが、Bより州都側のSupplyを無条件に失わない。
- Supply圏外では生産施設の労働者増員、Human Unitの自然回復、都市での新規編成予約を禁止する。施設確保・復旧、既存生産、減員・帰還、移動・攻撃・待機・鎮圧、都市間移住、避難民受入は制限しない。

## 12.5 Build・Relocate・Activate

- `BuildCheckpoint`は対象支線の空き幹線道路Tileで即時完成し、支線ごとのCheckpoint操作1回と全体Action 1回を消費する。各支線でゲーム開始以来初めてのBuildだけ民需品5、`hasBuiltCheckpoint`が真の以降Buildは民需品25を消費する。失陥、削除、Active不在、Fallback、Recoveryで初回価格へ戻らない。施設、既存Post、州都交差点、Player Unit駐留Tile、Horde Entranceを含むSpawn Reserveには設置できない。Facilityは恒久／Constructible、所有者、状態を問わずCheckpointと同一Hexを使用できない。
- Build／Relocateは対象Hexが現在のPlayer Vision内で、対象支線の州都側先頭から対象indexまでの全`roadTiles`が同時に現在のPlayer Vision内である場合だけ合法とする。一度見た`explored`履歴は使用しない。対象が未可視なら`checkpoint_target_not_visible`、対象は可視だが途中区間が未可視なら`checkpoint_route_not_visible`を、Zombie・Facility・上限・資源等より優先する。
- Activeがない支線へBuildしたPostはActiveになる。Activeがある支線では現Activeより州都側の空き道路TileだけにStandbyとして直接Buildできる。Build／Relocateとも候補Supply Sector内にいる現在Player Vision内のZombieだけを`checkpoint_supply_zombie_blocked`として扱い、Hidden Zombieは候補と実行の合法性を変えない。
- `RelocateCheckpoint`はActiveだけを同支線の別道路Tileへ移設し、民需品25、支線操作1回、全体Action 1回を消費する。前線側・州都側のいずれへも移設できる。移設元Active自身の感染だけが移設を妨げ、別Postの感染は妨げない。新地点はActiveとなり、旧Activeに管理人口、感染者、またはZombieが残る場合はRemnant、それ以外は上限に空きがあればStandby、なければDormantになる。
- `ActivateCheckpoint`は同支線のStandbyまたはDormantをActiveへ切り替え、民需品を消費せず、支線操作1回と全体Action 1回を消費する。対象TileのVisible Zombieは利用を阻害する。前線側へSupplyを再拡大する場合だけ`checkpoint_supply_zombie_blocked`をVisible Zombieで判定する。旧ActiveはRemnant条件または上限に従ってStandby／Dormantへ原子的に遷移する。
- 同一後方HexにStandby追加のBuildと即時後退のRelocateが成立する場合、候補Query、Human UI、Agent Observation、`getLegalActions()`はAction種別ごとの両候補を返す。Activate候補も対象Postごとに返す。全候補Query、合法手、実Actionは同じCore Validationを使う。
- 受理されたBuild、Relocate、Activateを合算し、各支線で1ターン1回までとする。拒否ActionとPolicy変更は支線操作を消費しない。候補Reasonは`invalid_checkpoint_tile`、`invalid_checkpoint_branch`、`unknown_road_branch`、`checkpoint_target_not_visible`、`checkpoint_route_not_visible`、`checkpoint_facility_occupied`、`checkpoint_prepared_post_limit_reached`、`checkpoint_standby_requires_rear_position`、`unknown_operational_checkpoint`、`checkpoint_not_activatable`、`checkpoint_same_position`、`checkpoint_wrong_branch`、`checkpoint_infection_blocked`、`checkpoint_branch_action_limit`、`checkpoint_abandoned_forward_block`、`checkpoint_supply_zombie_blocked`、`insufficient_civilian_goods`、`action_limit`、`wrong_phase`、`game_over`等の最初のCore Error Codeとする。不正ActionはState、資源、Action回数、PRNGを変更しない。

## 12.6 Automatic Fallback・Remnant・Recovery

- Activeが敵襲、感染、荒廃などで`operational`でなくなった直後、同支線で州都側にある候補を選ぶ。最初に失陥地点へ最も近い前方のStandby、なければ同条件のDormantをActiveへ昇格し、どちらもなければ`activeCheckpointId = null`とする。前線側のPostは自動昇格しない。
- Fallback候補はGame Truth上でそのHexにZombieがいるPostを除外する。Hidden Zombieの存在、候補除外理由、ID、位置はUI、Observation、公開Event、Reason Codeへ出さない。公開`fallbackAvailable`は州都側に物理statusとRole上の候補があるという構造上の可否であり、Hidden Zombieによる除外を反映しない。
- Fallbackは次のPlayer Turn Startまで遅延せず、失陥処理の直後にRole、Supply、Observationを更新する。次のRefugee Arrival／unmanaged判定、Supply Frontを使う経済・人口判定、後続Unit行動または自動Subphaseより前に解決する。UI通知は次Player Phaseにまとめてもよい。
- Fallback後の新規到着は新Activeへ入る。旧Activeの`waiting`、`screening`、`approved`、`infected`は移動させず、物理statusに従って処理を続ける。Fallbackは前方領土、Supply、Defense Line、Economic Capacityの喪失を無効化しない。
- Relocate／Activate後の旧Active Remnantは、4人口値（`waiting`、`screening`、`approved`、`infected`）がすべて0で、Hex上にZombieがいない時点で削除せずoperationalへ戻る。Active＋Standbyが5未満ならStandby、5ならDormantとなる。Zombieがいる間はRemnantのままとする。
- Ruined Postは感染者0かつHex上にZombieがいない時にoperationalへRecoveryする。支線にActiveがない場合だけRecovered PostをActiveにし、別Activeがあり上限に空きがあればStandby、なければDormantにする。Recoveryは既存Activeを奪わずSupplyを自動前進させない。前線側のReserveを再びFrontにするにはPlayerが明示的にActivateする。
- ZombieがPost Tile上でTurnを終えた場合は襲撃感染を行う。襲撃と内部感染は`waiting → screening → approved`の順に健常者を感染者へ変換し、3Pool合計0かつ感染者1人以上でOverrunする。空のActive TileへZombieが到達した場合も荒廃し、Active失陥なら即時Fallbackを試みる。感染したRuined／Abandoned地点は同距離・外側への再前進を阻害し、感染者0でAbandoned Postは除去できる。

## 12.7 Turn AwayとRejected Counter

- TurnAwayはactive/remnantのwaitingのみ、1以上の整数、1 Player Action。screening／approved／infectedは対象外、資源・PRNGを消費しない。

### 12.7.1 Counter

- Turn Away と Normal / Strict Screening rejection は既存どおり Direction 別 Rejected Counter に加算する。
- Wave に参加する Direction だけ、Wave roster freeze 時に Counter を Bonus へ変換し、その瞬間に Counter を 0 にする。
- 参加しない Direction の Counter は保持し、次にその Direction が参加する Scheduled Wave まで持ち越す。
- Final Wave は全 Direction 参加のため、Final roster freeze 時に全 Direction Counter を消費する。
- Final roster freeze 後に既存 Checkpoint Queue の Refugee を Turn Away しても Rejected Counter へ加算しない。
- Human / AI には「Final Horde確定後の拒絶は Horde Bonus を増加させない」ことを明示する。

### 12.7.2 Bonus count / type draw

- Bonus count 算出は既存の `ceil(rejected / 5)` を維持する。
- Rejected Bonus は Normal Zombie 固定ではなく、現行 Base non-Horde Wave Slot と完全に同じ weighted table を使う。
- Normal Zombie も weighted candidate に残す。
- Base non-Horde Slots を既存順・既存 RNG semantics で先に抽選する。
- その後に Rejected Bonus Slots を抽選する。
- Riot / Hunter / Gas caps は Base Slots と Bonus Slots で Direction 単位に共有し、Base が先に cap を消費する。
- 複数 Direction 同時 Wave では現行の固定 Direction order を維持し、各 Direction について `Base draw -> Bonus draw -> roster freeze` を完了する。
- 公開はWave開始後の基礎人数・Bonus込み確定人数・出現済み・Pending、Direction／Group／kind。Rejected Counter生値、拒絶人数の由来、正確なType内訳、Hidden位置は非公開。

# 13. ゾンビAI・Horde

## 13.1 ゾンビAI

Zombie陣営は`zombie`、`hordeZombie`、`policeZombie`、`soldierZombie`、`riotZombie`、`hunterZombie`、`gasZombie`からなる。Combat、感染、占有、不変条件は共通で、Horde／Final Horde帰属はWaveのHorde Zombieと非Horde Slot由来の全特殊Typeへ持たせる。初期配置、Human Unit死亡、Noise再Spawn由来個体は`spawnGroupId`と`hordeKind`を`null`にする。

- Zombie自身のVision内にあり経路を持つ、施設健常人口、検問所の健常3プール、Human Unit人口をPopulation Target候補とする。感染者だけ、人口0、死亡Unitは候補外とする。
- 候補は重み付き最短経路Cost、健常人口の多さ、Seed付き乱数の順で選ぶ。
- Zombie Phase開始時のSnapshotで全Horde Zombie、次にNormal AI系Zombieを確定してから、Unit ID安定順で移動・戦闘を解決する。
- `zombie`、`policeZombie`、`soldierZombie`、`riotZombie`、`hunterZombie`、`gasZombie`は`Visible Population Target > wave_capital／継承Horde Target > Noise Target > Idle`の順に行動Targetを決める。いずれもなければ移動しない。Horde ZombieはVisible Population、Capitalの順を維持し、Noise Targetを持たない。
- 継承はHordeのSnapshot上のTarget Hex座標で、Hordeを見失っても保持する。Visible Populationを一時優先しても記憶を保持し、座標到達時に有効Targetがなければ解除する。
- Normal AI系Zombieに継承TargetがなくVision内にHorde Zombieがいる場合だけ`hordeZombie -> zombie | policeZombie | soldierZombie | riotZombie | hunterZombie | gasZombie`へTargetを伝播する。継承した場合はNoise Targetを破棄する。Normal AI系Zombie間、通常からHordeへの伝播は禁止する。
- 複数Horde候補はHex Distance、同距離ならUnit ID昇順で選ぶ。
- Visible Populationを発見したNormal AI系ZombieはNoise Targetを破棄し、そのPopulationを見失っても旧Noise地点へ再開しない。Horde ZombieはVisible TargetをVision外まで記憶しない。Scheduled Wave由来Normal／特殊Zombieも独立したwave_capital Anchorを保持する。
- Player Unitが参加する通常Combatの開始時、Human UnitがいるHexをCenterとしてNoise Pulseを1回発生させる。Player Attack、Zombie／Horde Attack、Interception、同Combat内のCounterattackが対象で、Counterattackによる二重Pulseは発生させない。Moveのみ、Wait、感染鎮圧、Resource Shortage、Infection Spread、Facility Overrun自体は発生させない。RadiusはPolice 4、National Guard 8、Riot Police 5である。
- Horde Zombieが実際に1 Hex以上移動したとき、移動終了HexをCenterとして毎回Radius 8のHorde Movement Noise Pulseを発生させる。停止、移動0、Spawn直後は発生させない。Horde自身はこのPulseに反応しない。
- PulseはTerrain等で減衰せず`pendingNoisePulses`へ積み、次Zombie Phase開始時にまとめて評価する。Windだけは同EndTurnのTarget Snapshot直前に発生させ、そのSnapshotに反映する。Normal AI系Zombieは全pending PulseのうちHex Distanceが最短のCenterを選び、同距離は安定順へ正規化後にSeed付きRNGで選ぶ。現在Noise Targetと同距離なら現在Targetを保持する。Visible Population／Horde継承は常に優先する。
- 各Pulse直後、範囲内にある感染者5人以上の陥落済み恒久FacilityとRuined／Remnant CheckpointをID昇順（同一IDはFacility優先）で11.3と同じ隣接Spawnへ即時反応させる。成功1体につき感染者5人を減らし、残れば後のPulseで再試行できる。生成Unitには即時占有とFIFO連鎖を適用する。
- Human Combatの公開Eventはsource Unit TypeとNoise Classだけを持つ。Horde MovementはHorde由来とRadius 8、Army Baseは`armyBase`とRadius 8を公開できるが、source Unit ID、Center、経路、正確な反応個体／数、Noise Target、非可視Spawn位置は公開しない。

## 13.2 特殊ZombieとReanimation

- Police ZombieはHP 10／Move 3、Soldier ZombieはHP 20／Move 5、Riot ZombieはHP 60／Move 3、Hunter ZombieはHP 20／Attack 15／Move 15、Gas ZombieはHP 35／Attack 5／Move 3／Vision 3とし、全てRange 1、最大Attack Charge 1のNormal AI系である。Wave Slot由来ならScheduled／Final Horde個体として扱い、Supply内Zombie clearへ含める。HunterのMove 15もTerrain重み付き移動力であり、地形を無視しない。
- Police Unit死亡時はPolice Zombie、National GuardはSoldier Zombie、Riot PoliceはRiot Zombieを死亡Hexに1体生成する。Hunter ZombieとGas ZombieはHuman Unit死亡時のReanimationでは生成しない。生成Zombieは死亡Unitの熟練度、Charge、Fuel、Military Goods、HP、Targetを継承せず、残Fuel／軍需品をState備蓄へ返却しない。
- 生成直後は同じPhaseに通常Move、Attack、Targetingをせず、死亡HexがFacility／Checkpointなら即時占有・感染を1回解決する。陥落した場合は通常の感染者SpawnとUnit ID順FIFO連鎖を解決し、次回Zombie PhaseからNormal AI系として行動する。

## 13.3 Horde

- 標準Wave ScheduleはTurn5 H3/S3×1方向、Turn10 H2/S5×2、Turn20 H5/S7×1、Turn35 H3/S7×3、Turn50 H5/S8×4（Final）。Warning Lead2、North/East/South/West安定順、4方向以外のWarning方向のみSeed付き抽選。
- Baseの非Horde抽選と既存RNG semanticsは維持し、その後Bonus抽選を同じ表と共有Capで行う。Horde以外は最大Charge1、Hordeは4。各Spawn Turnは行動せず次Zombie Phaseから行動する。

### 13.3.1 Horde Spawn Reserve

- 51x51 Map の外周 2 rows / columns を Horde Spawn Reserve とする。
- Reserve は Player Unit の進入・建設を禁止する。
- 2列 Reserve 全体を Scheduled Horde 専用にはしない。Initial Zombie、facility fall、Noise Respawn 等は各既存 Spawn rule を維持し、合法なら Reserve 上へ Spawn し得る。
- このReserveとDirection Spawn Zoneを含むMap IDは`fixed-51x51-v4`とする。

### 13.3.2 Directionごとの22 Hex Spawn Zone

- Scheduled Horde は各 Direction の専用 22 Hex Spawn Zone 内だけに Spawn する。
- 他 Direction や Map interior への spill はしない。
- Zone は固定座標を直接ハードコードせず、その Direction の実 Road Entrance を基準に動的生成する。
- Entrance を中心に横方向 ±5 Hex、Reserve 2列を組み合わせ、11×2 = 22 Hex とする。
- West / East は道路中心 row の前後 5 Hex、North / South は道路中心 column の前後 5 Hexを使う。
- Map validator は各 Direction について必ず 22 Hex が Map 内・Reserve 内に生成できることを検証する。

### 13.3.3 Spawn Hex priority

- Zone 内は Road Entrance 中心から外側へ広がる順で使う。
- 同距離では左右を交互にし、片側へ偏らせない。
- Reserve 2列も同じ位置ごとに交互に使う。
- Spawn Hex 順序に RNG は使わない。
- 同一 Spawn batch では、その batch に出す Horde Zombie を先に中央寄り Hex へ配置し、その後に Normal / 特殊 Zombie を Frozen Roster 順で配置する。

### 13.3.4 Scheduled Wave roster freeze

- Scheduled Turn に Wave を開始し、その Direction の full roster を確定・freeze する。
- freeze 対象には以下を含む。
  - Horde count
  - Base non-Horde type draws
  - Rejected Bonus count / type draws
  - group ID / kind
- Spawn Zone に空きが 0 で実 Spawn が 0 体でも、Wave は開始済みとする。
- Wave start 時点で Rejected Counter 消費、public count 更新、Final なら自然到着終了を行う。
- Spawn できない roster entry は Pending Spawn として保持する。
- Pending entry は Map Unit ではなく、座標・Vision・Target・Attack・Noise reaction を持たない。

### 13.3.5 Pending Spawn

- 各 Horde Phase に、その Direction の 22 Hex Zone の空き Hex へ可能な数だけ Pending を Spawn する。
- Spawn できなかった分は次 Horde Phase へ持ち越す。
- capacity shortage は正常な Pending 状態であり、技術的 Spawn failure としない。
- Spawn した個体は、その Spawn Turn には移動・攻撃しない。次回 Zombie Phase から行動する。
- Pending から実 Spawn した Wave Normal / 特殊 Zombie は、その時点で `wave_capital` Anchor を受け取る。

### 13.3.6 複数Waveの重なり

- 前 Wave の Pending が残っていても、次の Scheduled Wave は予定 Turn どおり開始し、独立 roster を freeze する。
- 同一 Direction に複数 Pending Wave がある場合は oldest Wave first。
- 古い Wave を同じ Horde Phase 中に完了し、空き Hex が残れば新しい Wave も続けて Spawn できる。
- group ID / kind / Final affiliation は Wave ごとに独立する。

### 13.3.7 Horde Zombieのbatch分散

- Wave が複数 Spawn Turn にまたがる場合、既存 Horde Zombie 数を可能な限り各 Spawn Turn に分散する。
- Horde Zombie 数を増やしてはならない。
- Spawn Turn 数が Horde 数を超えた場合、Horde を使い切った後の batch は Normal / 特殊のみでよい。
- 実際の Spawn Zone の空き不足で予定外に複数 Turn 化した場合も、後続 Turn に最低 1 Horde を残せる範囲で残す。
- 各 Horde Phase 開始時点の実際の空き枠、remaining roster、remaining Horde だけを使って最小必要 Spawn 回数を再推定し、残 Horde を可能な限り均等配分する。未来の空き枠は予測しない。
- 同一 Direction に複数 Pending Wave がある場合、この均等配分は Wave ごとに独立計算する。Wave 間で Horde を融通しない。

### 13.3.8 Wave public counts

Wave 開始時点で Human / AI 双方へ以下を公開する。

- `baseWaveUnitCount`: Scheduled Wave 本体のみ
- `committedWaveUnitCount`: Rejected Bonus 込みの確定 roster 総数
- `spawnedSoFar`
- `pendingCount`
- direction
- group ID / kind（公開上必要な識別子）

例: Scheduled 52 + Bonus 15 の場合、`baseWaveUnitCount=52`, `committedWaveUnitCount=67`。

非公開:

- Rejected Counter 生値
- Bonus が何人の拒絶から生成されたか
- exact Zombie type breakdown
- hidden unit positions

### 13.3.9 Wave events

- Wave roster freeze 時に `horde_wave_started` 相当の Event を 1 回発行する。
- 各 Horde Phase の実 Spawn ごとに `horde_spawn_batch` 相当の Event を発行する。
- batch Event は `spawnedThisBatch / spawnedSoFar / pendingCount` を公開する。
- Type 内訳・Hidden position は公開しない。
- 旧 `horde_spawned` の意味を曖昧に拡張せず、Wave start と実 Spawn を別概念にする。

## 13.4 Victory

- Final Wave の Scheduled Turn に Final roster を freeze した時点で新規 Refugee の自然到着を終了する。
- Pending Spawn が残っていても自然到着を再開しない。
- 既存 Checkpoint Queue の Screening / Accept は継続できる。
- Final victory は次の両方を満たした時だけ成立する。
  - Final Pending = 0
  - Map 上の Final roster 所属 Zombie = 0
- Map 上の Final 所属 Zombie が一時的に 0 でも Pending が残っていれば勝利しない。
- Final 以前や facility fall / Noise Respawn 等の非Final ZombieがMap上に残っていても、上記2条件を満たせば勝利する。
- 各受理Action後・自動サブフェーズ後はDefeatを先に判定する。finalHordeDefeatedとFinal Pendingを公開する。補給圏掃討・感染排除の既存指標は情報として維持しても勝利ゲートにしない。

## 13.5 混雑時fallback

### 13.5.1 基本方針

- Zombie は他 Zombie の Hex を通過しない。
- Zombie 同士の 1-Hex overlap は許可しない。
- 既存の Human Unit interception / pin / base interception は維持する。
- Target selection priority 自体は変更しない。
- `decision.target != null` の Zombie に対してのみ、通常の `targetPath` が使えない場合に congestion fallback を実行する。
- Target を持たない Idle Zombie は fallback で移動しない。
- congestion fallback は Horde Zombie だけでなく、Normal / Police / Soldier / Riot / Hunter / Gas 等、すべての Zombie Type とすべての Target reason に共通適用する。

### 13.5.2 fallback候補

1. 現在 Hex より Target への Terrain-only weighted distance が短い、合法かつ到達可能な空 Hex を候補にする。
2. 1 が無い場合だけ、現在と同距離の横移動 Hex を候補にする。
3. Target から遠ざかる Hex は候補にしない。
4. 通常の movement budget / terrain cost / per-hex interaction をそのまま適用する。

Tie-break は RNG を使わず、次の順で決定する。

1. Target への Terrain-only weighted distance
2. その Hex へ入る実 Movement Cost
3. 既存の決定的な座標 stable order

### 13.5.3 直前Hexへの戻り禁止

- fallback による横移動を行った場合、Zombie Unit State に `previousFallbackPosition` 相当を保存する。
- 次回 fallback では、その Hex への即時帰還を候補から除外する。
- この State は Turn をまたいで保持し、Save / Replay 対象とする。
- 次の場合にクリアする。
  - 通常 path で Target へ前進できた。
  - Target が変わった。
  - Target 距離が短くなる fallback に成功した。
- `previousFallbackPosition` 以外に合法 fallback が無い場合、その Turn は停止する。唯一候補であっても戻りは許可しない。

## 13.6 空CapitalとWave Anchor

### 13.6.1 人口0 Capitalの陥落

- Player-owned Capital が `workers = 0 / infected = 0` でも、Zombie が Capital Hex へ侵入・占有した時点で Capital を即 Ruined とし、敗北判定する。
- Zombie Type / 出自は問わない。Normal / Police / Soldier / Riot / Hunter / Gas / Horde すべてに適用する。

### 13.6.2 Wave Capital Anchor

- Scheduled Horde Wave から Spawn した Normal / 特殊 Zombie は、Spawn 時に Capital 座標を `wave_capital` Anchor として持つ。
- Rejected Bonus 由来個体も対象。
- `hordeZombie` は既存 Horde AI の `Visible Population > Capital Strategic Anchor` を維持し、Normal Zombie 向けの Anchor State を必須としない。
- Wave Capital Anchor は Capital の人口、Vision、Noise、同Wave Horde Zombieの生死・距離・Visionに依存しない。
- Normal / 特殊 Wave Zombie の Target priority は次のまま。
  - Visible Population
  - `wave_capital` / inherited Horde Target
  - Noise
  - Idle
- Visible Population がある間はそちらを一時優先するが、`wave_capital` は消去しない。Visible Population が消えれば Capital へ戻る。
- Wind Noise を含む Noise は `wave_capital` より下位であり、Anchor が有効な Wave Zombie を逸らさない。
- Initial Zombie、reanimation、facility fall / Noise Respawn 等の Wave 外 Zombie には `wave_capital` を付与しない。
- Capital Hex に実際に到達し、その Hex で必要な戦闘・感染・陥落処理を解決した時点で `wave_capital` を解除する。

# 14. ターン処理

```text
PLAYER TURN START
  次Wave Warning開始時に全方向を抽選・公開（4方向Waveは抽選なし）
  熟練度昇格判定・Veteran昇格待ち確定
  自然回復
  Human UnitのAttack Charge・行動権回復、存命Horde ZombieのAttack Chargeを最大値へ補充（refillPlayerStart）
  予約ユニット完成・Army Base早期確保報酬の保留配置・有償commissioning Fuel補給・携行軍需満載
  新規確保・復旧・建設施設の操作解禁、Wind／Constructible Recovery完了
  都市供給・受入順位スナップショット作成
  配置待ち合格者の自動配置
  敗北条件確認
        ↓
PLAYER / DOMESTIC ACTION
  移動・迎撃・攻撃・待機・施設確保
  労働者配置・撤収・都市間移住
  Power Supply ON/OFF
  支線Policy・Checkpoint新設／移設／Active化・Turn Away
  Constructible Facility建設／Drone Base撤去・ユニット編成予約
        ↓
END TURN VALIDATION
  資源・電力・過密予測と警告
        ↓
ECONOMY
  EndTurn開始時の通常維持必要量を固定し、過密追加消費と住宅停電追加消費を通常維持費から独立計算
  Turn-start Fuel、Wind供給、物理発電Capacityを決定
  Capital／City → occupied Housing → Farm／Civilian Factory → 入力確保済みMilitary Factory
    → Refinery → Civilian Drone Base → Army Base通常編成予約 → empty Housingへ給電
  Civilian Goods維持予約・Military Factory入力配分
  Wind不足分の実割当だけ発電Fuel消費
  残FuelからSupply内Human UnitをID順Round Robin補給
  生産物追加（Refinery Fuelは次Turnから利用）
  Food → Civilian Goods維持消費
  Unit ID順の携行Military Goods固定消費 → 国家備蓄からRound Robin補充 → Army Base専用軍需補充
  携行軍需を使う自動鎮圧
  不足被害・敗北確認
        ↓
REFUGEES
  直前のActive失陥があればFallback済みのRole／Supplyを使用
  Final Wave Spawn後は新規到着なし。既存Queueは審査・合格・自動配置または配置待ちを継続
  潜伏感染・敗北確認
        ↓
INTERNAL INFECTION
  鎮圧後の残存感染による内部感染・Checkpoint Active失陥時の即時Fallback・復旧・敗北確認
        ↓
ZOMBIE TURN / INFECTION
  operational WindのNoiseをstable facility順で各1回完全解決
  前Phaseまでのpending Noise PulseとWind Pulseを評価
  Phase開始時Target Snapshot（Visible > wave_capital／Horde継承 > Noise > Idle）
  AI・全Zombieの隣接足止め・Human迎撃／基地迎撃・隣接攻撃・Gas死亡連鎖・Human Combat／Horde移動／基地迎撃Noise・施設／Checkpoint感染
  Active失陥時の即時Fallback・敗北確認
        ↓
  SCHEDULED WAVE START / PENDING SPAWN（予定Turnにfreeze、各Directionのoldest Pendingから空き枠へ分割Spawn、次Zombie Phaseから行動）
        ↓
  DEFEAT CHECK → FINAL PENDING / FINAL MAP MEMBERS VICTORY CHECK / NEXT TURN
```

各サブフェーズ内の順序は決定的にする。即時敗北成立後は残り処理を行わない。

## 14.1 AI Portable Session

- AI Portableは長時間の外部AIプレイをプロセス境界で継続するSession層を提供し、`new`、`status`、`step`、`save-checkpoint`、`list-checkpoints`、`load-checkpoint`、`artifact`、`query`の既存8コマンドに`play-turn`を加えたJSON CLIを公開する。既存8コマンドは単発実行と復旧用に維持し、通常の外部AIプレイは配布版Bundled Nodeの`play-turn`を推奨する。`query`は読み取り専用の詳細取得とする。
- `play-turn`は1ターン1プロセスのJSON Lines対話を正式経路とし、読み取りQuery、1 Action、明示的closeを受ける。各Actionに現在Revision、Session内で一意なrequestId、1～500 Unicode code pointの短い公開理由を必須とする。自動戦略を実行せず、明示的EndTurn成功／Game Overで終了する。EOF、idle timeout、closeは暗黙のEndTurnを行わない。
- 有限計画は開始Revisionと最大64件のAction列を受け、各手を検証・保存して公開結果を返す。不合法、新しい可視敵、移動中断、想定外の損害、危機の発生・悪化等で残りを止める。Crisis比較は公開reason・対象ID・Severity・型付き事実の悪化方向で行い、文言変更だけでは停止しない。EndTurn成功とGame Overは状況変化より優先して終了する。
- requestId再送は永続化済み記録から元のDecision／Revision／応答を返し、Actionを二重適用しない。同じIDで異なる内容は拒否する。照合は排他内で行い、commit後・応答前の中断も再送で回復する。
- 対話中は検証済みRuntime・現在State・公開Projectionを再利用する。Queryでも毎回復元せず、次の操作前に現在commitを確認する。別プロセスの旧`step`がcommitした場合は古いRevisionの後続操作を拒否し、再読込を要求する。複数の書き込み`play-turn`はSession単位で排他する。全履歴Observationや二重の初期ObservationをRuntimeに保持しない。
- 入力1行1 MiB、有限計画8 MiB／64 Actions、対話256要求、idle timeoutを上限とし、stdoutはJSONL応答のみ、診断はstderrとする。stdout backpressureを待ち、入力と応答を無制限に蓄積しない。上限、停止条件、Input Schema、Linux／Windows launcher、開発用経路は`query api`の`sessionPlayTurn`と各応答capabilityで公開する。
- `new`、`status`、`step`、`load-checkpoint`の標準応答はCompactな構造化公開Snapshot要約とし、Version、Session ID、現在`revision`、Turn／Phase、勝敗、公開資源・人口、所有施設／Checkpoint、全部隊、現在可視の敵、Crisis Summary、EndTurn Risk、Forecast要約、公開Horde予告、Actionの受理／拒否、理由、公開Event、`stateDelta`、作成Checkpoint、利用可能Action種別を含める。固定Map全文、全候補、詳細コスト、前後Observation全文、過去Decision全文を重複させない。
- `step`は既存`GameAction`と1～500 Unicode code pointの`decisionSummary`だけを受け取り、1回につき1 ActionをGameEngineへ渡す。任意の`expectedRevision`を受け付け、不一致はDecision採番・Action適用前に`stale_revision`として状態不変で拒否する。入力形式不正はDecision番号を付けず、合法性拒否は番号、Error、Action、公開前後状態への参照、公開Eventを持つDecisionとして記録する。
- `query`はAPI情報／Map、Unit、Facility／Checkpoint／Branch、建設候補、全Legal Actions、Forecast、Decision履歴、完全な公開Snapshotを対象指定とPaginationで返す。標準Pageは100件、最大500件とし、応答には対象、`revision`、返却件数、続きの有無、次Cursorを含める。CursorはSession IDとRevisionへ結び付け、状態変更後は`stale_revision`で拒否する。`query`はGameState、RNG、Decision番号、正規Action列を変更しない。
- `query`で固定Map、全候補、詳細コスト、前後Observation全文、過去Decision全文へ明示的にアクセスできる。全Pageの結合は安定順の完全な公開一覧と一致し、Compact化によって従来の公開情報、合法手、不合法理由、Projected Supply、移動コストを失わない。大きなFull SnapshotはPageまたはファイル出力とし、省略は明示する。
- 受理Decision応答の`stateDelta`は前後の公開Observationから導出した変化の要約とする。保存用には追加・変更・削除、配列順、Visibility、候補、合法手を完全復元できるlossless diffを別に保持する。新規感染／荒廃Site、新規発見／公開Eventで喪失確認できたEnemy、Human Unit HP／補給、Checkpoint Role、公開施設の所有・状態・人口・停止理由、支線Queueの変化を公開Deltaへ含め、視界外へ移動したEnemyを喪失と断定しない。
- Active SessionはPrivate State、Public State、Public Decision Logを分離する。Private Stateだけが完全GameStateとRNGを保持し、公開CLI出力、Trace、Checkpoint metadata、ArtifactへHidden Enemy、内部Target、RNG state、完全な非公開Configを含めない。
- 初期および直前の完全Snapshotから50 Decision経過ごとに完全公開Snapshotを置き、その間は保存用の完全lossless diffと小さなDecision記録を積む。固定Map参照、圧縮、Content-Addressed Store（CAS）による内容Hash重複排除、chunk分割を併用し、Traceの1行にObservation／合法手全文を戻さない。履歴全体の復元済みObservation配列を通常経路で保持しない。
- 各Decisionは前Decision hashを含むcanonical JSONのSHA-256でchain化する。参照先Payload、Snapshot、commit、Version、Build ID、Map、公開Configの不一致・破損を状態不変で拒否し、Active破損時に暗黙の巻き戻しをしない。大きなTrace、Snapshot、Artifactはstreamと上限付き作業バッファで処理し、全履歴を単一文字列化または一括JSON化しない。
- 更新は新しいimmutable generationへPrivate／Public StateとDecisionを書き、最後にActive commitを確定する。Session単位の排他lockを使い、同時更新は状態不変で拒否し、同一hostで終了済みPIDのlockだけをstaleとして回収する。
- 既定で5完了Turnごと、手動要求時、Game Over時にCheckpointを作る。Checkpoint／Session Schemaは`10.0.0`で、immutableな`branchBase`を必須とする。Rootはnull、子は`rootSessionId`、`parentSessionId`、`parentCheckpointId`、`baseDecision`、`baseTraceHeadHash`、`basePublicSnapshotHash`、`ancestorManifestHash`を持つ。`load-checkpoint`は新Session IDへ分岐し、親Sessionと親Checkpointを変更しない。
- RootのDecision chainはDecision 0／ZERO_HASHから始め、子のlocal chainは`baseDecision + 1`と`baseTraceHeadHash`から始める。RootのStore Manifestは共有Payload Poolと祖先履歴範囲を定義し、子へ祖先の展開済みObservation／Decision全文を複製しない。完全Artifactは分岐点までの祖先履歴と子の履歴を必要なPayload各1回で梱包する。
- `.git`を含まないPortable PackageでもWorkflowから注入したfull commit SHAをBuild IDとGit Commitとして固定し、別Buildまたはv1.5.6以前のSession／Checkpointを拒否する。Portable PackageはLinux／Windows x64のBundled Nodeだけで既存8コマンドとJSONL `play-turn`のSmokeを行い、公開Observation／Legal Actionsだけを使う外部AI Seed 1／7 Game Over・Artifact・Replay一致を確認する。

---

### v1.5.7 Player Portable配布

Linux/Windows x64のPlayer ZIPにはBundled Node、bundle化Session CLI、launcher、プレイ文書、Version情報、必要なライセンスのみを含める。src、開発用node_modules、fixture、build toolは配布しない。Checkout側でtypecheck/test/buildを実行後、展開Packageの同梱Nodeだけで全command・Seed 1/7終局・Artifact/Replay一致を検証する。ZIP bytes、展開bytes/ファイル数、Session disk-usage、Compact/Full JSON bytesの測定条件と実測を証跡へ残す。既存Store schema 1、Replay Package schema 1、完全な公開Queryと再開整合性は維持する。

# 15. 保存・復元

- 人間側は新規ゲームの確定初期状態、正常に完了して次の自ターン開始までcommitしたEndTurn、確定した勝利・敗北を自動保存する。移動・攻撃・待機・内政Action途中や拒否されたEndTurnでは自動保存しない。
- 手動保存で任意の確定状態を保存する。自動保存と同じローカル1枠を使い、最後に成功した保存を「続きから」で復元する。セーブコードとJSON出力は別途保管に使用する。
- 保存中・完了・失敗、最後に成功した保存Turn、未保存の変更を表示する。保存失敗時も直前の成功情報を維持する。未保存で終了した場合は直前の成功状態へ戻る。処理中の保存は確定後に可能とし、ブラウザ終了時の保存成功には依存しない。AI Sessionは各Decision保存を維持する。
- セーブコードはVersion、Config、Map ID、Seed、完全なGameState、チェックサムを含む。
- 同内容をJSONファイルで入出力できる。
- Version不一致、破損、不正Config、不変条件違反を検出し、現在状態へ適用しない。
- ロード後は保存時Configを使う。
- v1.5.7はGame Rules / GameState / Config `9.0.0`、Fixed Map `fixed-51x51-v4`、Save Format `16`を使う。
- v1.5.6以前の自動保存、セーブコード、JSON Save、AI Replay、Artifact、Session、Checkpointは変換・移行しない。Version不一致は現在Stateを変更せず、日本語・英語の理由付きで拒否する。旧autosave keyは読み取り確認だけを行って上書き・削除せず、新規ゲームはautosave key `nowhere-left-to-hide:auto-save:v16`を使う。
- Save 16は51×51 Map、静的29施設とSeedで決まるArmy Base 1基、Temporary Housingと建設Wind、Seed付き初期Normal Zombie 25体、Hunter 1～4体、Gas 1～2体と配置metadata、Reserve／Direction Spawn Zone、Unit熟練度／昇格Counter／Attack Charge／Fuel／軍需、Army Base専用軍需・迎撃残回数・報酬・予約`powerReady`、特殊Horde Slot／Weight／Cap／provenance、Frozen Roster／出現済み数／Pending Spawn、Horde最大Charge 4、Warning／Wave／Final Group、RNG、Rejected Counter、Zombie Target／`waveCapitalAnchor`／`previousFallbackPosition`／`fallbackTarget`、`pendingNoisePulses`、拠点感染者Pool、Noise／Reanimation／Gas爆発結果、Event、Statisticsを完全に検証する。Forecast、Crisis Summary、EndTurn Risk、Supply、Visibility等の導出値は保存せず再計算する。必須のv1.5.7 metadataやVersion値を旧値で黙って補わない。
- Artifact Schema `13.0.0`は固定Map情報をゲーム単位で1回だけ保存し、Turn Observation Traceでは`mapId`から参照する。Public Decision Log、受理Action列、不正試行、公開Observation／Event、Metrics、Seed、公開Config、Version、Build ID、Session lineageを欠落させず、保存用lossless diffから各Decisionの前後情報を完全に読み出せるようにする。Artifactはstreamでファイル／Packageへ書き、標準出力には小さなManifestだけを返す。Player-facing Artifact／ReplayはWaveの公開人数とPendingを保持するが、Rejected Counter、拒絶人数の由来、正確なBonus Type内訳、Hidden Noise情報を残さない。
- Player-facing ReplayにはFoWを適用し、Browser BridgeのArtifactへ内部情報を含めない。Browser Bridge ArtifactのConfigは公開情報だけを含む。ローカル／CI Runnerの完全な検証Artifactだけが`verificationEvents`、完全Config、Internal Event列を保持し、Replay時に一致確認する。Live Observation、`query`のFull Snapshot、Browser Bridgeは完全な公開情報へ明示的にアクセスでき、公開情報を参照差分だけに制限しない。

---

# 16. Event・統計

移動、戦闘、Charge消費、Kill Credit、昇格待ち／昇格、Gas爆発・連鎖、Army Base報酬・予約完了／没収・迎撃、施設・人口・資源・Checkpoint・Horde・Noise・Crisis／EndTurn Risk監査・Game Overを理由付きEvent／Statisticsとして保持する。`horde_warning`は基礎総数、Horde数、非Horde Slot数、可能Typeだけを公開し、抽選結果とRejected Bonusを出さない。roster freeze時に`horde_wave_started`を1回発行し、基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を公開する。各実Spawnでは`horde_spawn_batch`に当該batch人数、累積出現済み人数、Pending人数を記録し、視界境界を守る。Internal EventだけがType別Frozen RosterとRejected詳細を持つ。

`noise_emitted`の公開PayloadはHuman Unit TypeとNoise Class、Horde Movement、またはArmy Base由来とRadius 8だけを持つ。Pulse源ID／位置、反応個体／数、TargetはInternal Eventだけに残す。拠点EventとGas爆発Eventは視界外でも対象、座標、実生成数、残存感染者数、連鎖起点を公開する一方、生成Zombieの個体ID、配置Hex、Targetを除く。

終了統計:

- 勝敗、生存ターン
- 最終・最大人口
- 最終・最大確保施設数
- 民間人損失、ユニット損失
- 感染・資源不足による損失
- Horde迎撃数、主な敗北原因
- Gas爆発・連鎖数、Army Base迎撃・報酬・予約没収数

人口を変えるEventは移動元、移動先、人数、理由を追跡可能にする。

Agentゲーム単位Metricsは、各Version、Build ID、Map、Seed、Config、Agent、勝敗、Game Over理由、最終Turn、Decision／受理／不正Action数、Action／優先目標別件数に加え、次を記録する。

- 初期・最終・最大人口、民間人損失、感染・資源不足損失、Army Base報酬の累積増員、受入避難民、最大過密
- 道路別・合計の到着、未管理素通り、方針別審査、受入、州外退去
- Checkpoint新設、Standby／Dormant作成、移設、Active化、Fallback（支線別、Standby由来、Dormant由来、未管理到着防止）、Active失陥、後退、荒廃、復旧、放棄、消滅、未管理道路ターン
- 補給圏内施設数、最大補給半径、補給喪失、補給理由の拒否Action
- 確保・喪失・最終所有施設数
- Unit Type別の初期・完成・損失・最終生存隊数と生存率、補給圏外損失、Type／回復区分別の実回復HP・回数、10%／20%選択回数
- 単一／全生産施設の最大労働者数、26～30人施設Turn、発電所停止Turn、電力不足Turn
- Facility Type別Power requested / supplied / unavailable Turn、Power Supply OFF Turn、給電停止によるResource別生産損失、Refinery停電Turnと次Turn Fuel不足、Simple Farm生産量とFood不足回避Turn、停電都市Turn、Refinery／Power Plant追加確保数
- Active Checkpointの方針別branch-turn比率と、方針別Batch開始人数・完了人数・平均Queue、Capacity利用率、推定Throughput、Queue Pressure Turn
- Zombie撃破、Horde迎撃
- Wave別開始Turn／Spawn Turn、選択Direction、基礎人数／Bonus込み確定人数、方向別batch／累積Spawn／Pending／撃破数、Wave別撃破数、最終個体撃破Turn、Final Horde生成／撃破／全滅、通常／Horde Zombie撃破、最大Visible Zombie、Final Horde後Turn数、Supply内Zombie／感染Clear Turn、Victory Turn
- 初期Normal Zombie数、初期Hunter数、初期Gas数、Scheduled／FinalのHorde数、非Horde Slot数、特殊Type別生成／撃破。標準初期はNormal 25体、Hunter 1～4体、Gas 1～2体、基礎Wave ScheduleはH41 / Slot73 / Total114、Final WaveはH20 / Slot32 / Total52である。Rejected Bonusは完全検証Metricsだけで区別し、Final集計はGroup内の全Typeを合算する。
- Army BaseのSeed位置・所有・Worker・専用軍需・予約電力・迎撃・報酬、初期Normal Zombie数25、初期Hunter数1～4とDistance 20以上、初期Gas数1～2とDistance 9以上のSeed付き座標、Human Unit Type別移動とFuel、Drone Vision、Checkpoint Queue維持、Police／Soldier／Riot／Hunter／Gas Zombieの生成・撃破・最終生存数、Human Unit Type別Reanimation（Hunter／Gasを生成しない）、Gas爆発・連鎖、Final後に防止されたArrival、Drone Base撤去・返却を記録する。
- Terrain別進入、Urban／Forest防御、通常Zombie Idle、Horde Target継承／解除、Noise Pulse総数、Human Unit Type別Pulse数、Horde Movement Pulse数、Noise反応陥落拠点数、再Spawn、未生成感染者、Noise起点連鎖と発生Unit Type別内訳
- Unit Type別Recruit編成数、Regular／Veteran昇格、直接Kill Credit、Attack Charge使用／未使用、Riot生産／損失／Reanimation、特殊Horde Type別生成／撃破
- Ground Visionの遮蔽前Potential／遮蔽後Visible／Blocked Hex、Blocked最大・Turn平均、Civilian Drone Base建設数と最大Vision Radius、Aerial VisionがGround遮蔽範囲で新たに発見したEnemy数。Aerial Enemy発見数はVerification／Batch専用とする。
- Site Kind／Type別の初回感染、感染陥落、Zombie占有破壊、陥落時実感染者数、Requested／Actual Spawn、陥落／Noise由来Normal Zombie、最大6体Spawn、未生成感染者、即時感染、連鎖陥落数・最大長・起点、感染者からZombieへの変換人口、Constructible残存感染者死亡、Turn 5以前の拠点損失
- Map幅／高さ、Human Unit Type別移動Hex数・最大移動距離・6 Hex以上の長距離移動
- Unit Type別Fuel消費・補給・commissioning Fuel、Supply外終了Turn、Fuel不足で移動不能となったUnit、Power／UnitへのState Fuel支出、Fuel不足Turn
- Unit Type別の携行Military Goods固定消費、通常攻撃／反撃／迎撃／自動鎮圧消費、補充量、未充足補充量、撃破時喪失量、軍需0弱体攻撃回数、National Guardの距離1／距離2攻撃回数と消費量、Army Base専用軍需補充／不足／迎撃消費、国家軍需補充不足Turn
- Unit Type別Emergency Movement回数、Emergency移動Hex数、消費MP、Emergency MovementによるSupply内帰還回数
- Wind発電量・停止Turn・Overrun・Recovery
- Simple Farm／Civilian Drone Baseの建設・破壊、Simple Farm Food生産、最大Drone Vision、Constructible Overrun、建設拒否Reason
- Guaranteed Defeat警告／無視、Resource別Single Point of Failure Turn、Supply増加なしCheckpoint移動、Queue Pressure Class別Turn
- 完全な検証Metricsには`normalZombiesNoiseTargeted`、`noiseTargetsReached`、`noiseTargetsOverriddenByHorde`、`noiseTargetsOverriddenByVisiblePopulation`、Aerial VisionによるEnemy発見数も含める。これらのHidden Enemy状態を推測し得る値はActive Game Observation、Production終了結果、公開Event、Browser Bridge Artifactから除く。
- Direction／Policy別Rejected人数、Turn Away人数、Direction・Type別Rejected Bonus、Counter resetはInternal Metrics／完全検証Artifactだけに保存する。Production側はWaveの基礎人数、Bonus込み確定人数、出現済み人数、Pending人数だけを公開し、Rejected詳細をAgent、Player-facing Artifact／Replay／終了結果へ含めない。
- 最終食料、民需品、軍需品、燃料

Agent別集約は実行・完遂・`limit_reached`・技術的失敗・勝敗・勝率、主要値の平均・中央値・最小・最大・p10・p90、Game Over理由、Action／優先目標件数、同一Seed差分を持つ。`limit_reached`はゲーム内敗北およびTechnical Failureへ合算しない。

Session Metricsはゲーム成績と分離し、Active Session復帰、手動／定期／最終Checkpoint作成、分岐Session作成、hash／Version／Build／破損による拒否、不合法Decision、入力形式拒否の回数を記録する。Hidden Enemyを推測できる値はSession Metricsへ含めない。

---

# 17. 自動テストと不変条件

## 17.1 必須ルールテスト

- 移動、経路迎撃、攻撃、反撃、10%／20%／0%自然回復、回復Eventと予測一致
- 初期Regular、新規Recruit、Config別完成熟練度、5 Turn生存昇格、直接Kill 5体の昇格待ちと次Turn Veteran化、Kill重複防止
- Recruit／Regular 1 Charge、Veteran 2 Charge、通常Attack／Counterattack／Interception／自動鎮圧の共通消費、Wait保持、1回Attack後移動禁止と追加Attack
- Riot Policeの性能・生産拠点・Cost・Fuel・軍需・鎮圧・自然回復・Riot Zombie Reanimation、Hunterの性能・初期配置・Normal AI・Wave Slot、Gasの性能・初期配置・Normal AI・死亡爆発・Wave Slot
- 施設確保、操作解禁ターン、感染、鎮圧、陥落、復旧
- 人口供給・受入順位、配置、撤収、都市間移住、編成
- ソフトキャップ、都市生産上限、過密追加消費
- 5資源、同ターン維持利用と生産入力への連鎖禁止、Wind先行の優先順位別給電、電力5ごとのFuel 2、Unit補給、Army Base専用軍需補充、Required / none / conditional電力、都市停電、不足被害
- SetPowerSupplyの合法条件、行動上限非消費、同一Phase中の反復、即時Forecast更新、不正時State／RNG不変
- Civilian Goods維持予約とMilitary Factory入力不足、Fuel希望／実使用／不足、物理Capacity不足の分離、ForecastとEndTurn実績一致
- Active／Remnant Checkpointの3プール、支線Policy、合格、配置、2種類の感染順、陥落
- 4支線の独立到着、未管理素通り、不可視プール不在、到着予定維持
- 初期半径5、同距離共有Sector、Activeによる拡張・Fallbackによる即時縮小、補給制約、候補別Visible Zombie阻害
- CheckpointのActive／Standby／Dormant、支線Policy、直接Standby Build、Relocate、Activate、支線別操作回数、Remnant、空Activeの荒廃、Automatic Fallback、Recovery、Abandoned、消滅
- FallbackのStandby優先、Dormant第二候補、州都側限定、Game TruthのZombie候補除外、Hidden除外情報非漏洩、Refugee Arrival／Supply更新より前の解決
- Checkpoint全道路／Post候補の安定順、候補Reasonと実Action一致、Build／Relocate／Activateの同Hex共存、複数理由の優先順、失敗時State／資源／Action回数／PRNG不変
- 外周2列392 HexのHorde Spawn Reserve、Player Unit Move／Path／初期・完成配置、Checkpoint／Constructible候補・Actionの拒否、State／Resource／Action回数／RNG不変、Zombie Spawn／移動／停止とReserve内Attack／Counterattack／Interception／Damageを試験する。
- Wave Config validation、Turn 5 / 10 / 20 / 35 / 50の方向数と方向別Horde／Slot数、対象前Weight 70/10/10/5/5、最後の2 WaveのWeight 65/10/10/5/5/5、Riot／Hunter／Gas Cap 1、Spawn時抽選、Cap後の再正規化、Warning非漏洩、固定方角順、4方向WaveのRNG非消費を試験する。
- Warning開始、Wave roster freeze直前・直後、Pending分割Spawn中のSave Round Trip、Session Resume、Checkpoint分岐、Replayで方向、Wave進行、Group ID、Frozen Roster、特殊Type、RNGが一致することを試験する。Base抽選後のRejected Bonus weighted抽選、Direction単位の共有Cap、Final 4 Groupの基礎52体、基礎H41 / Slot73 / Total114 Metricsを試験する。
- 固定Terrain数・座標・Overlay、重み付き移動、Road／Urban Cost、Water不可、同Cost決定性
- Urban／Forest防御の攻撃・反撃・迎撃と非Combat Damage非適用
- Ground Unit／Capital／通常Facility／CheckpointのVision和集合、`hexLine()`のForest／Mountain遮蔽、Blocking Hex自身の可視、複数遮蔽物、盤端、Aerial Vision非遮蔽、Visibility更新、UI Overlay／Observation／Legal Actions／EventのFoW、Hidden移動停止とCheckpoint公平性
- Checkpointの対象Hex未可視／対象だけ可視で途中道路未可視／全経路可視、可視Zombie妨害とHidden Zombie非妨害、Facility占有、Active＋Standby 5基と6基目拒否をBuild／Relocateで試験する。
- Checkpoint候補、`getLegalActions()`、Human UI局所Build、実Actionの合法性とReason一致、拒否時State／資源／Action回数／PRNG不変、Observation／Bridge／Artifact一致、Hidden Enemy非漏洩
- Human UIの空道路選択とFacility／Checkpoint選択優先、Build候補座標一覧／全候補Marker不在、Relocate Marker維持、EndTurn未給電件数、Player所有Required施設の視界外／OFFを含む`⚡×`と給電回復時消去、日英表示
- 通常／Hunter／Gas Zombie Idle／Horde継承／Noise記憶／解除、HordeのCapital指向、Target伝播方向、`Visible > wave_capital／Horde継承 > Noise > Idle`、複数Horde決定性、Snapshot順序
- Police 4／National Guard 8／Riot Police 5とHorde移動8のNoise境界、Terrain非減衰、通常Combat 1回1Pulse、Horde実移動ごと1Pulse、Counterattack二重Pulseなし、pendingの次Zombie Phase評価、複数Pulse最短再選択、同距離RNG、現在同距離保持、Horde／Visible優先
- 実感染者0～4／5／30以上、最大6体、隣接空き不足、Distance 2不使用、Checkpoint共通化、Constructible消滅、Wind除外、生成Unitの同Phase行動禁止と即時占有、Unit ID順FIFO連鎖、州都連鎖敗北を試験する。
- Combat Noiseによる陥落拠点のID安定順再Spawn、未生成感染者保持、後続Pulse再試行、即時感染／連鎖、Hidden Spawn個体情報の非公開、最新50件の重要イベント履歴とToast集約を試験する。
- Production UI／Agent API／公開Event／終了結果／Browser Bridge ArtifactがNoise Classだけを公開し、正確Radius、反応Hidden ZombieのID／数、Noise Target、Hidden Noise Metricsを漏らさないこと。Development Buildの読み取り専用診断だけが正確なCenter／Radius／範囲／反応／Targetを確認できること。
- Scheduled Waveの規模・Timing・22 Hex Direction Zone、roster freeze、oldest-first Pending、batch分散、Spawn次Turn行動、特殊Type provenance、Turn 50後の継続、Final Pending 0かつMap上Final所属Zombie 0のVictory、非Final Zombie／感染の非ゲート化、Defeat優先、Runner 100 Turn到達の`limit_reached`分類
- 勝利・即時敗北、v1.5.7 Save Format 16の保存・復元、v1.5.6以前の通常SaveおよびAI Replay／Artifact／Session／Checkpointの状態不変な拒否
- UI数値入力とスライダー同期
- 51×51固定Map `fixed-51x51-v4`、外周2列392 HexのReserve、方向別22 Hex Spawn Zone、静的29恒久FacilityとSeed固定Army Base 1基、初期Unit、初期Normal Zombie 25体・Hunter 1～4体・Gas 1～2体のSeed付き決定配置・非重複・Normal／Gas Distance 9以上・Hunter Distance 20以上・PRNG順、Terrain生成順、4支線距離25、建設用Plain候補
- Police Movement Budget 15／National Guard・Riot Police 10、Type別Fuel表、Fuel不足拒否、Hidden Enemy途中停止、発電後Round Robin補給、新Unit有償補給、死亡時Fuel喪失
- Police・Riot Police 5／National Guard 20の携行軍需、固定消費、補充、距離別Combat Cost、軍需0弱体、National Guard距離2拒否、残Charge鎮圧／封じ込め、死亡時喪失
- Fuel 0でだけ使えるPolice 3 MP／National Guard・Riot Police 2 MPのEmergency Movement、Terrain実効Cost、Hidden Enemy途中停止、補給圏帰還、Fuel非消費
- 初期／建設WindのFuel不要発電15、Vision、Supply外継続、Radius 8 Noise、Target Value 0、Disable／Recoveryと、Constructible Facilityの候補、費用、上限、建設Turn、Power、Supply喪失、感染／消滅／Recovery、Housing／Drone Base撤去・返却・上限解放・Simple Farm拒否
- Simple Farm最大4基のPowerなしFood 5 / worker、Required Farm／Civilian Factory／Military Factory／Refinery／Drone Baseの未給電停止と給電出力、Drone Vision 0 / 3 / 6 / 9 / 12 / 15、都市未給電時のCivilian Goods停止、HousingのCity-like人口・受入順・Supply切断・occupied／empty電力Tier・独立outage penalty・EndTurn snapshot、確定建設／審査結果だけを含む次ターン予測、mutation後cache更新、Strategic Forecast、Checkpoint Queue維持需要、Queue Pressure、Query純粋性とHidden情報非漏洩
- 建設中／disabled／recoveringのFacilityへ`AssignWorkers`をLegal Actionsとして列挙せず、直接Actionも状態不変で拒否すること
- Temporary Housingを含む全Asset Registry Pathの実File、PNG Decode、256×256 px、透過、3 MiB上限、Water非収録、Type／状態Mapping、BoardとLegendのRegistry同一性
- 一般施設とCheckpointの複合状態、現在停止と停止予測、Scheduled／Final Horde Marker、Road接続方向、施設・Unit Offset
- 全Asset成功と個別Missing／Decode／Texture登録失敗のFallback、成功Assetの維持、Loading完了、Fallback中の操作継続とState／RNG不変
- Fog外の既知情報暗転とEnemy非表示、Layer順、Zoom`0.75`境界と最小`0.35`のLOD、10 UnitのAsset／Legend／Fallback、Hunter／Gas／Army Baseの表示、日英Board Legend、現在／標準Config、電力HUD
- v1.5.4の同一Config、Map、Seed、Action列について熟練度／Charge、Riot、Hunter、Gas、Army Base、特殊Wave、Frozen Roster／Pending Spawn、fallback履歴、Wind Noise、Housing、pending Noise、感染／Reanimation（Hunter／Gasなし）、Checkpoint、Result、主要MetricsのReplay一致を確認する。
- Queue健常3PoolのFood／Civilian Goods維持費・不足順、初回5／以降25のCheckpoint Build履歴、Relocate 25、Turn Awayのwaiting限定・Action消費、Normal／Strict／Turn Away Counter、`ceil(total / 5)`、参加Directionだけのreset、Final後のCounter非加算を試験する。
- Production UI、Agent、Bridge、公開Event、Player-facing Artifact／Replay／終了結果が基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を公開しつつ、Rejected Counter生値、拒絶人数の由来、正確なType内訳、Rejected詳細Metricsを漏らさないことを試験する。
- Police／Soldier／Riot／Hunter／Gas Zombieの性能、Normal AI、Wave／非Wave provenance、Human Unit死亡からの生成（Hunter／Gasを生成しない）、Gas爆発FIFO連鎖、同Phase行動禁止、即時感染、Victory対象を試験する。
- Core由来Crisis全Category／Severity／reason、Human UIの段階表示とAccordion、上部資源Accordion、対象別Panel、Zombie選択、局所建設、EndTurn Risk短縮表示を日英・390×844・1280×720で試験する。
- Sessionの連続実行、Compact応答、`query`の全対象・Pagination・Cursor／Revision、Active復帰、Checkpoint分岐、`branchBase`／Store Manifest、State Deltaと保存用lossless diff、chunk／圧縮／内容Hash共有、stream読み書き、Observation、Legal Actions、公開Event、RNG結果、Decision hash、Artifact、Replay一致、Version／Build拒否、FoW非漏洩を試験する。
- 1,000件以上の受理Decision、512 MiB超の大容量履歴、破損注入、同時更新、古いRevision、stale lock、子分岐を対象に、履歴全体の単一文字列化・全Observation配列化なしで復帰、追加step、Checkpoint、分岐、`query`、Artifact export／read／Replayが完了することを試験する。Runner 100 Turn到達は`limit_reached`としてTechnical FailureおよびGame Overと別集計する。
- 51×51・21部隊規模の公開FixtureでCompact、全詳細Page、Full Snapshotの情報同値性を確認し、通常応答のUTF-8 bytesを旧方式の25%以下、Session総保存量（Trace、Private／Public generation、Checkpoint、共有PayloadのRoot内実体を各1回計上）を旧方式の50%以下とする。履歴長を増やしたときのPeak RSSと通常応答サイズが展開済み履歴総量へ比例しないこと、各コマンドのp50／p95時間と読み込み量を記録する。
- 全Zombieの開始時隣接・最初の隣接地点での足止め、Human迎撃／反撃→基地迎撃→隣接攻撃の順、Charge 0、同人数Target、基地距離0／1／2の迎撃を試験する。
- Gasの初期1／2、距離9境界、Turn 35／50だけのWave抽選、隣接6 Hex・中心／距離2除外、Terrain半減、拠点感染、Snapshot、Gas連鎖FIFO、二次Kill Credit除外を試験する。
- Army BaseのSeed位置、Worker 0/1視界、人口敗北例外、Turn 20報酬、都市限定徴用、予約の電力5／供給外継続／感染保留／陥落没収、Base最後順位、専用軍需補充、迎撃Noiseを試験する。
- Fuel 0／1／2／3、Wind、余剰物理Capacity、当Turn Refinery Fuel非利用、残Fuel Unit補給とForecast／EndTurn一致、および各支線の10..20人到着を試験する。

## 17.2 不変条件

常に次を満たす。

```text
HP >= 0
CityPopulation >= 0
FacilityWorkers >= 0
UnitPopulation >= 0
WaitingRefugees >= 0
ScreeningRefugees >= 0
ApprovedRefugees >= 0
Infected >= 0
Resources >= 0
0 <= UnitCurrentMilitaryGoods <= UnitMaxMilitaryGoods
0 <= ArmyBaseMilitaryGoods <= 40
0 <= ArmyBaseInterceptionsRemaining <= ArmyBaseHealthyWorkers
UnitMaxMilitaryGoods == UnitConfigMaxMilitaryGoods
UnitProficiency in recruit | regular | veteran (Human only)
0 <= AttackChargesRemaining <= MaxAttackCharges
MaxAttackCharges == 2 iff Human Unit is veteran or Zombie Type is hordeZombie; otherwise 1
```

加えて:

- 所在地のない民間人口が存在しない。
- 人口移動・編成の前後で人口保存則を満たす。
- 1タイル1駒。
- 死亡Unitは再行動不可。攻撃後は移動不可だが、Veteranは残Chargeがあれば追加Attackできる。
- Game Over後に状態遷移しない。
- Human UnitとHorde ZombieのChargeはPlayer Turn Startに各Typeの最大値へ補充し、Zombie Phase開始時の追加補充は行わない。Horde Zombie以外のZombieは最大Charge 1である。
- 生産施設上限を超えない。
- 感染施設へ人口を追加・撤収しない。
- 新規確保・復旧施設を同じターンに人口操作しない。
- 同一Version、Config、Map、Seed、Action列で結果が一致する。
- 各支線のActiveは最大1、`activeCheckpointId`と`standbyCheckpointIds`は重複せず、Standbyは同支線のoperational Postだけを参照する。Active＋StandbyはConfig上限以下であり、Remnant／Ruined／AbandonedはActive／Standbyにならない。
- Activeだけが新規Arrival、Supply、Visionを提供し、Role変更、Fallback、Supply再計算、Event生成はGameEngine内で原子的かつ決定的に行う。
- `noiseTarget`と継承Horde Targetは`zombie`、`policeZombie`、`soldierZombie`、`riotZombie`、`hunterZombie`、`gasZombie`だけが持ち、`hordeZombie`は持たない。Normal AI系特殊ZombieはHorde Capital Strategic Anchorを持たない。
- 補給圏とセクターは同じ純粋関数から導出し、Human UI、Headless、Agent、Browser Bridgeで判定を分岐させない。
- Zombieの携行Military Goodsは常に0とし、Emergency Movement利用可否は保存せずConfigと`currentFuel`から導出する。
- Player Unit、Player所有Facility、Constructible Facility、CheckpointはHorde Spawn Reserveを占有しない。`hordeSpawnReserve`とTileの`playerOccupancyAllowed`は固定Mapと一致する。
- Horde Stateの次Wave、Warning方向、開始済みWave、Frozen Roster、方向別Group ID、特殊Type provenance、Pending、Final Group ID、Final状態はConfigの固定Wave Scheduleと整合し、Warning前は方向・特殊抽選結果を保持・公開しない。
- pending Noise Pulseは次Zombie Phaseだけで評価し、処理後に残さない。公開State／Eventはsource位置、反応個体、内部Targetを含めない。
- Mapは51×51、Reserveは外周2列392 Hex、各Direction Spawn Zoneは22 Hex、静的施設29とSeedで決まるArmy Base 1基、標準初期Normal Zombieは25体・Gasは1～2体でCapital Distance 9以上、初期Hunterは1～4体でCapital Distance 20以上、Police Movement Budgetは15、Drone Vision Radiusは0..15である。Army BaseのWorker上限は10、専用軍需上限は40、報酬は一度だけ、予約`powerReady`は予約状態と整合する。Rejected Counterは0以上で、参加Directionのroster freeze時だけresetし、Final roster freeze後はRejected Counterへ加算せず新規Arrivalを生成しない。

## 17.3 Random Test Agent

- UIなしでHeadless Interfaceだけを使う。
- 各Action後と各ターン後に不変条件を検査する。
- 日常CIで固定Seed 1～30を実行する。
- ローカルではConfig指定で1,000ゲーム以上実行可能にする。
- 失敗時にVersion、Config、Map、Seed、Action列、エラー、直前GameStateを保存する。

## 17.4 Agent／Batch／Bridge

- ObservationがJSON互換、非共有、決定的で、取得時にStateを変更せず、非公開情報を含まないことを試験する。
- 回復・鎮圧・実効射程・Gas直接効果・Army Base予約／迎撃／専用軍需・部分稼働生産・電力予測がCoreの合法手と実処理に一致し、`getApiInfo()`がAgentGameとBridgeで同じ静的契約を返すことを試験する。
- Legal Actionsがすべて受理され、一覧外ActionでStateとRNGが変わらず、AgentStepResultにGameStateを含まないことを試験する。
- BalancedのCrisis、残Charge、Veteran価値、Riot Police鎮圧／Blockade、Gas危険、Army Base確保／予約／迎撃、施設接触拒否、実効射程と携行軍需、回復、Emergency Movement、負傷部隊後退、経済、感染、混成Horde、Checkpoint、EndTurnの固定Scenarioを意図ベースで試験する。
- Balancedが`checkpoint_supply_zombie_blocked`でもCheckpoint Goalを放棄せず、Non-urgent Forest Hordeへの非致死Attackを抑え、Urbanから不要に離れず、Plainへ誘えるWaitを残し、公開Noise ClassとUnit Vision内のVisible Normal AI系ZombieだけでNoise Riskを評価し、即時Capital ThreatではTerrain／Noise Penaltyより防衛を優先することを試験する。
- v1.5.4はルール・Map・Save契約を更新するため旧Versionとの結果一致を合否にしない。同一v1.5.4 Config、Map、Seed、Action列のRandom／BalancedでTechnical Failure／Replay／Session不一致を0とする。100 Turn到達は`limit_reached`として記録し、ゲーム内敗北およびTechnical Failureと別集計する。
- Random／Balancedの同一Seed比較、決定性、JSON／CSV／通常モードのゲーム単位Artifact、`--summary-only`のコンパクト出力、失敗継続、fail-fast、Replay一致を試験する。
- Production Buildに`window.NLTH`とAPI説明が含まれ、公開メソッド限定、通常UI／保存分離、入力拒否時の状態保持をSmoke Testする。
- 公開Pagesでは公開Observation／Legal Actionsだけを読むブラウザ操作可能な外部Agentを使い、API発見、不正Action訂正、Seed 1と7のGame Over、Result／Artifact取得とReplayを手動E2E確認する。PagesのWorkflow成功を必須とし、個別ゲームの勝利は合格条件にしない。
- v1.5.7 Release ValidationはVersion Metadata、Rules／Map／Save拒否、Reserve／Direction Zone、Frozen Roster／Pending Spawn、Rejected Bonus、Final Victory、Zombie fallback、Temporary Housing、Wind、電力／予測の固定fixture、同Version Replay／Session決定性を確認する。Pages deploy成功後、独立したAI Portable Package Workflowを確認する。Linux／Windows x64 ZIPはCommit SHA・App・Node Versionを記録し、Bundled Nodeで既存8コマンド、JSONL play-turn、外部AI Seed 1／7のGame Over・Artifact・Replay一致を検証する。公開Pages／Portable結果は確認前に成功済みと扱わない。既存v1.5.6以前の性能証跡は履歴の測定記録として保持し、v1.5.7の結果一致ゲートにはしない。SOG05は実測がないため、PC・モバイルviewportの確認結果と混同しない。

---

# 18. PoC完成条件

1. PC Chromeと390×844相当のスマートフォン縦向きで、51×51盤面、主要Action、3段階Bottom Sheet、対象別Panel、Unit編成Accordion、未選択Accordion、上部資源Accordionを利用できる。
2. 初期Regular、新規Recruit、5 Turn生存のRegular化、直接Kill 5体のVeteran化、Veteran 2 Attack ChargeとWait保持がCore、UI、Agent、Save、Replayで一致する。
3. 全Zombieの足止め・隣接攻撃、混雑時fallback、直前Hexへの即時帰還禁止、Gas Zombieの死亡爆発／連鎖、Hunterの服装Assetと既存性能がCore、UI、Agent、Save、Replayで一致する。
4. `fixed-51x51-v4`の外周2列Reserveと方向別22 Hex Spawn Zone、静的29施設とSeed固定Army Base 1基、Worker視界・人口敗北例外・早期報酬・都市限定州兵予約・編成電力・迎撃・専用軍需が決定的に機能する。
5. 固定Wave Turn 5 / 10 / 20 / 35 / 50、roster freeze、oldest-first Pending Spawn、Horde batch分散、Gasを含む6種Normal AI系Zombie、Base後に同じweighted tableとDirection別Capを共有するRejected Bonusが決定的に機能する。Human／AIは基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を確認できる。
6. Human Combat、Horde移動、Army Base迎撃のNoise、pendingの次Zombie Phase評価、Windの同EndTurn snapshot前Noise、最短Pulse再選択、Radius内陥落拠点即時再Spawnが決定的に機能する。
7. Final roster freeze後は自然到着とRejected Counter加算を終了し、Final Pending 0かつMap上のFinal roster所属Zombie 0で勝利する。非Final Zombieや感染は勝利ゲートにせず、各判定では敗北を優先する。
8. Temporary Housingの建設、City-like人口、通常City優先の受入、Supply切断、occupied／empty電力Tier、停電追加維持費、感染時消滅、撤去が機能する。Overcrowdingと住宅停電を通常維持費から独立計算し、確定済み建設・審査結果だけを含む次ターン予測が受理mutation後に更新される。
9. 初期／建設WindがFuelなしで15発電し、Supply外でも稼働とNoiseを継続する。Power PlantはWind不足の実割当電力5ごとにTurn-start Fuel 2を使い、Fuel 1で部分発電せず、HousingとBaseを含む優先順位がForecast／EndTurnで一致する。避難民は各到着10..20人である。
10. Core由来Crisis SummaryとEndTurn RiskをHuman UI／Agentで共有し、UIは段階表示、Agentは全件構造化を維持する。FoWはGas・Army Base・Wind・Horde EventでもHidden情報を漏らさない。
11. Save Format 16のautosave v16、セーブコード、JSON復元、Artifact 13.0.0、Session／Checkpoint 10.0.0がHousing、建設Wind、Frozen Roster／Pending Spawn、fallback履歴、Gas、Army Base、pending Noiseを再現する。v1.5.6以前の通常SaveとAIデータは状態不変で拒否し、新metadataを旧値で補わない。
12. AI Portableの8コマンド、Compact／`query`、Public Decision Log、State Delta、保存用lossless diff、chunk／圧縮／内容Hash参照、stream出力、hash chain、`branchBase`付きCheckpoint分岐、外部AI Seed 1／7 Game Over・Artifact・Replay一致をBundled Nodeだけで完遂する。
13. App `1.5.7`、Rules／State／Config `9.0.0`、Map `fixed-51x51-v4`、Save `16`、Agent／Observation／Bridge `14.0.0`、Artifact `13.0.0`、Session／Checkpoint `10.0.0`、Balanced `8.0.0`、Random `6.0.0`の境界が整合する。
14. Headless、Unit／UI／Replay／Sessionテストを通過し、100 Turn到達を`limit_reached`として別分類する。同Versionの決定性を検証し、旧v1.5.6以前との比較を結果一致ゲートにしない。
15. Waterを除く256×256透過PNG、10 Unit、Army Base、Temporary Housingを含むUI専用Registry、一括Preload、個別Fallback、LOD、Board Legendが機能し、Runtime PNG合計が3 MiB以下である。
16. GitHub Actionsでテスト・本番Build・GitHub Pages公開を確認し、Pages上のHuman UIと`window.NLTH`を実ブラウザで検証する。
17. PagesとAI Portable Package Workflowを検証する。公開結果が未確認の間は、実装・ローカル検証済みであっても公開成功済みと扱わない。

---


## 18.1 v1.5.3 検証状況と性能証跡

- ローカルのCore／UI／Save／Agent検証、型検査、本番Buildを実施する。PortableのSeed 1／7はローカルで成功を確認済みである。
- 2026-09-06、Commit `d5820b98b34deb3611825d9475897a34ea21d407` の[Pages検証・デプロイ](https://github.com/plastichyena/nowherelefttohide/actions/runs/34010590115)と[Linux／Windows AI Portable](https://github.com/plastichyena/nowherelefttohide/actions/runs/34010593801)が成功した。公開版でSeed 1／7のGame Over、公開Artifact取得、不正Action拒否後の継続、同Action列Replay一致を確認した。PC 1280×720・スマートフォン相当390×844で表示とターン進行を確認し、ブラウザーconsole errorは0件だった。
- 長時間のBalanced Seed 1～30、Session 1,000 Action、[Random／Balanced各100 Seed・512 MiB検証](https://github.com/plastichyena/nowherelefttohide/actions/runs/34010594878)はJob開始まで確認した。ユーザー指定により完了待ちは行わず、成功済みとは扱わない。
- 既存v1.5.2性能証跡と比較スクリプトは履歴の測定記録として保持するが、v1.5.3のRules／Map／Save変更に対する結果一致ゲートにはしない。
- `src/testing/v153-performance.ts`は`src/testing/fixtures/v153-performance-evidence.json`へPC 5サンプルを記録する。Gas 6体連鎖、Army Baseの距離0迎撃8発を含むEndTurn、通常Zombie 25体のidle判断を含むZombie Phase、基地編成予測を測定し、各中央値・p95と計測条件をJSONに保持する。旧版との比較や移動が密集する局面の測定を示すものではない。SOG05は実測がないため、PC・モバイルviewportの結果から実機性能を断定しない。

## 18.2 v1.5.4 検証状況とリリース実績

この節は実施済みの事実だけを記録する。実行中または結果未確認の項目は成功済みと扱わない。

- ローカルの型検査、本番Build、静的Smoke、検証Script 5件は成功した。長時間Balanced Batchを除くVitest回帰と、修正箇所の個別再検証を実施した。移動・Wave・住宅・電力予測・保存・公開API・UIの未解決テスト失敗はない。
- ローカルBrowser Bridgeの公開APIだけを使い、Seed 1はTurn 10、Seed 7はTurn 8でGame Overまで進行した。不正Actionの状態不変拒否、Artifact取得、同Action列Replayの完全一致を確認した。
- ローカルAI Portableは同じSeed 1／7について、バンドル済みSession CLIをローカルNodeで実行し、プロセス間継続、Game Over、Artifact取得、Replay一致を確認した。Runtime同梱配布物は対象CommitのWorkflowで別途検証する。
- PC 1280×720・モバイル相当390×844で住宅画像と詳細、電力・独立Penalty、建設Windの確定予測、Final基本52／確定67／出現済39／Pending28の表示、日英Help、Save復元を確認した。ブラウザconsole errorは0件だった。
- 対象CommitのGitHub PagesとAI Portable Package結果はGitHub Actionsで確認する。長時間のその他Jobは起動とJob開始までを確認対象とし、完了未確認のJobを成功済みと扱わない。

## 18.3 v1.5.5 検証状況と実装上の制約

- 型検査・本番Build成功。長時間Balancedを除く回帰658件成功後、計測テスト1件の不要なゲーム実行を初期状態生成へ修正し、関連89件の再検証が成功した。長時間Batchは別Workflowで確認する。
- Gas即時連鎖は実Core AttackとのHP・感染一致、Hidden Enemy変更時の公開予測不変、非致死時の爆発なしを確認した。人口移送は列挙されない合法整数7人を受理し、0・小数は状態不変で拒否する。建設の種類・合法・供給・座標絞込とRevision拒否を確認した。
- ZIPは拒否Decision、分岐履歴、別Build ID、破損、中止、50 MB超の有効コンテナを検証した。50 MB試験は公開追加ファイルを含むコンテナであり、長大な展開Observationの測定と混同しない。
- ブラウザ390×844で観戦の0.5/1/2/4倍、シーク、存在しないTurnの拒否、末尾停止、ログ保持とlocalStorage不変を確認した。3秒コメントの実操作込み待ち時間は6,327/3,260/1,744/988ms。物理スマートフォンは未計測。
- 道路の設定・全基地候補hash・3段階MP/経路長/Fuel/Hunter到達範囲・接触ターンの静的推定は `src/testing/fixtures/v155-roads.json`、図は同ディレクトリの `v155-roads-none/required/optional.svg`。必須142辺、任意込み147辺、閉路数0→1。全4基地候補が幹線へ接続する。接触ターンは無妨害の移動予算推定であり、戦闘結果や勝率を保証しない。
- 観戦はv1.5.5対応。ZIPのNDJSONは非圧縮格納を必要とし、配布CLIのZIPを用いる。ZIP64、分割、暗号化は非対応。論理Payload64 MiB、1行4 MiB、中央ディレクトリ32 MiB、100万Decision、Snapshot Cache16 MiBを上限とする。全体50 MB超だけでは拒否しない。ブラウザの作業メモリ不足は別の再生不能条件となる。
- 内部展開bytesと累積Observation読込bytesは再読込を含む計測値として区別する。1,000判断・物理512 MiB超の耐久検証はGitHubの専用Jobで、同じ観戦Readerの読込・シーク・中止も検証する。長時間Workflowは開始確認までとし、結果未確認を成功済みとは扱わない。
- 公開対象コードは `85d7e3b2a1e8c7d12c29de8d077117a49e9abf90`。GitHubの [Pages検証・デプロイ](https://github.com/plastichyena/nowherelefttohide/actions/runs/34238522394) が成功し、71 Test File・660 Test成功、11件Skipを確認した。
- [AI Portable](https://github.com/plastichyena/nowherelefttohide/actions/runs/34238541866) はLinux x64・Windows x64とも成功。Bundled NodeでSeed 1/7のSession終局、Artifact取得、Replay一致を確認した配布ZIPを保存した。
- 公開PagesのBuild ID一致、通常UIのEndTurn・autosave・復帰、公開BridgeのSeed 1（Turn 10）／7（Turn 8）の終局と再実行一致、Artifact各ページ一致、Hidden情報非公開を確認した。観戦は1280×720・390×844で表示し、50,131,022 bytesのZIPを操作込み867msで読込、通常autosave不変、復帰成功、pageerror 0を確認した。
- 通常終局ZIPはSeed 1が322,724 bytes／10判断、Seed 7が271,109 bytes／8判断。バンドルしたNode 22 Readerで初回読込3,292／3,053ms、末尾シーク3,331／2,683ms、RSS約195／201 MB。開発用Viteランナーの常駐量とは分けた参照値であり、長期戦・実機電話の保証ではない。
- 長時間 [Release Validation](https://github.com/plastichyena/nowherelefttohide/actions/runs/34238545597) のRandom/ Balanced各100 Seed、物理512 MiB、およびCIのBalanced 1～30・通常1,000判断Jobは開始を確認した。完了を待たない指定のため、結果未確認として扱う。公開後の証跡は `src/testing/fixtures/v155-release-validation.json`。
- 今回の指示により確定要件をDoc直下に残し、Doc/archive内の履歴資料は参照・編集していない。

## 18.4 v1.5.5 Validation修正と追補検証（2026-09-09）

- 18.3で開始だけを確認した[旧Release Validation](https://github.com/plastichyena/nowherelefttohide/actions/runs/34238545597)は、Random Seed 3のTurn 3・218手目EndTurnで人口台帳の不変条件違反、Balancedは6時間のJob上限で失敗した。感染連鎖で既に陥落・消滅した施設を再処理し、死者を二重計上して無関係な住宅を除去する実装不具合を修正した。陥落済み施設を処理対象から除外し、存在を確認した位置だけを取り除く。同じ失敗直前StateからEndTurnが受理され、Turn 4へ進むことも確認した。
- `5b6325d`の[CI／Pages](https://github.com/plastichyena/nowherelefttohide/actions/runs/34291663498)は73 Test File・672 Test成功、11件Skip、Balanced Seed 1～30、通常Session 1,000判断を含め成功した。修正前に失敗する実Action列を回帰fixture化し、修正後の関連テスト78件と証跡再利用ガード3件、型検査を確認した。
- 公開PagesのBuild ID `5b6325d6c829e2bbd754b46ec4e2f258514abd46`でSeed 3の218 Actionすべてが受理され、Turn 4、住宅維持、Bridge実行による通常autosave不変を確認した。通常UIのEndTurnとTurn 2 autosave、390×844の横はみ出しなし、Chrome 152でconsole error 0件を確認した。物理スマートフォンでの測定ではない。
- [AI Portable](https://github.com/plastichyena/nowherelefttohide/actions/runs/34300922082)は `95f1c1490444d9b7f1b5245a2d2622f638ae3d6e`でLinux x64・Windows x64の両方が成功した。Bundled Nodeによるコマンド検証、Seed 1/7の終局、Artifact取得、Replay一致を含む。
- Release検証をAgent別10 Seedずつの20 Jobへ分割し、元の100 Turn上限と全Replay検証を維持した。大きな旧形式JSON Replayは全体を1文字列に変換せず、ディスク上のObservation位置を索引化して既存Replay検証へ渡す。実際の782,270,373 bytes・536 Actionの記録でV8文字列上限エラーを再現し、修正後は全Replay一致、約148.5秒、RSS 205,107,200 bytesを測定した。ファイル全体の容量と、単一JSON値64 MiBの読込上限は区別する。
- [実行元Run](https://github.com/plastichyena/nowherelefttohide/actions/runs/34292039724)ではRandom／Balanced各Seed 1～100の全200ゲームが正常終局し、全Replayが一致した。技術的失敗0、上限到達0、勝利0である。Randomは最大Turn 8、Balancedは平均16.04・最大25、Final Horde到達0/100だった。施設停止、Checkpoint喪失、資源不足死、住宅利用を証跡へ集計した。このBatchは最終波の実戦動作を検証していない。
- 旧集約処理の「BalancedがFinal Horde出現後のTurn 50を越えなければ失敗」という追加条件を修正した。確定要件8章は到達・処理状況の記録を要求し、ゲーム内敗北は正常完了であるため、到達0を明示して技術的失敗と分ける。AI方針、難易度、ゲームルール、Runner上限は変更していない。
- 同実行元の耐久試験は2,000受理Action、Artifact Package実体790,116,083 bytes、公開ZIP実容量791,230,291 bytesで成功した。Package read／Replay一致、観戦Readerの読込・前後シーク・中止を確認した。ZIP Reader初回読込は641,367ms、RSS 613,687,296 bytes。LinuxのNode上で同じBrowser-safe Readerを使った耐久試験であり、ブラウザUIや実機モバイルのメモリ保証ではない。内部展開量・累積Observation読込量は別値としてJSONに保持する。
- [最終Validation](https://github.com/plastichyena/nowherelefttohide/actions/runs/34296947610)は成功した。ゲーム実行コード・依存関係・耐久試験コードが不変の実行元Commit `e4fc835960f7ae79e056cfb4e564d1f4827fc3a6`から、成功済み21 Jobの証跡を再利用した。元Runの同一リポジトリ・完了状態・Job成功、Report Build ID、全Seed・Replay・容量を再検証し、元Run IDとCommitを記録した。実行元Runの旧集約失敗表示は履歴として残るが、最終Validationで修正済み集約が成功している。
- 追補証跡は `src/testing/fixtures/v155-validation-followup.json`。9月8日の記録は当時の事実として保持する。今回もサブエージェントを使用せず、Doc/archiveは参照・変更していない。


## 18.5 v1.5.6 実装・検証（2026-09-09）

- 有刺鉄線、感染者0の恒久施設の駐留再確保、人口操作理由、全4支線Compact、施設変化・停止理由、公開壁プレビュー、保存／Session／観戦の新契約を反映した。
- ローカル通常ゲート: 76ファイル・725テスト成功、長時間用11件skip。追加の壁／Checkpoint回帰54テスト成功。型検査、本番Build、生成Browser Bridge、リリース検証ツール8テスト成功。Balanced 1..30・Seed198と長時間Sessionは独立したGitHub jobsで実施する。
- 実ブラウザ: PC 929×917とモバイル390×844、日英UI、内政での建設、費用5/5、Save Format15の再読込、壁上へのPolice移動（3Hex・7MP・Fuel1）、壁HP10とHuman HP25の同時選択、観戦ZIPの建設前後再生を確認。横方向overflowとJavaScript errorはなし。実機スマートフォンのRAM測定は行っていない。
- 同Seed比較: `src/testing/v156-balance-validation.ts`。結果は`src/testing/fixtures/v156-balance-results.json`。Seed1/7/17のEndTurnのみと、各Turnに合法壁1個を追加する条件の計6戦は技術エラーなく敗北まで完了。到達Turnは10/8/8、壁個数は10/8/8、各資源費用50/40/40。両条件とも可視破壊・Human肩代わり0。感染損失147/117/158、資源不足損失0、Unit損失0/0/1。施設接触Turnと毎Turnの発電所稼働は結果JSONに記録する。
- この比較は感染管理もHuman再配置も行わない限定的な異なるAction列の実験であり、壁の戦闘性能や勝率の推定ではない。突破・肩代わり・Charge・MP・Gas・再生例外は専用の決定的シナリオテストで検証した。HP10・費用5/5・MP5は変更していない。
- 公開・配布の完了条件は、このコードRevisionのPages deploy成功、公開Pagesの実ブラウザ動作、Linux/Windows AI PortableのBundled Nodeでの完走・Replay一致である。結果は同RevisionのGitHub Actionsとリリース作業の最終報告を参照する。長時間の200ゲーム、1,000 Action、512 MiB検証は起動確認までとし、未確認の結果を成功と扱わない。
- 今回はユーザーの指示によりサブエージェントを使用していない。ユーザーが先に行ったv1.5.5要件のarchive移動をコミットに含め、archive内の文書本文は変更していない。v1.5.6要件は比較用としてDoc直下に残す。

## 18.6 v1.5.6 Validation追補修正（2026-09-10）

- 前回Release Validation（Run 34346108127、Attempt 2）は失敗。レポート検証がApp 1.5.5を固定要求していたため、全20 shardがReplay検証前に停止した。アプリのAPP_VERSIONと共通化し、配布package.jsonとの一致と旧版拒否を回帰テストへ追加した。
- レポート内訳は199ゲーム正常終局、Random Seed 69のみ技術的失敗。Turn 2・47判断目に、視界を失った壁（21,37）の上へSimple Farmを建設しようとして不変条件違反となった。失敗直前Stateをfixture化し、視認必須・壁共存禁止・Hidden壁の非公開・拒否時の資源／RNG／State不変を検証した。既存Save Format 15を維持する。
- 大容量試験は非公開Checkpoint等を含むStore全体で停止判定しており、公開Artifact実容量434,491,566 bytesで512 MiB基準未達だった。公開履歴から実際に参照する圧縮chunkだけを重複排除して実測し、基準を超えるまで実Core Actionを継続する。最終Artifact本体の実容量チェックも保持する。ダミーpaddingや検証基準の緩和は行わない。
- ローカル通常ゲート78ファイル・728テスト成功、専用長時間テスト11件skip。型検査、本番Build、Browser Bridge smoke、検証ツール8件成功。小規模の大容量モードは3受理Action＋分岐1 Action、公開Package 4,176,373 bytesで出力／読込／Replay一致。512 MiBの結果を代用する値ではない。
- 元Commit e8a7a4871f9e410973e7bdd37304ae279a7216f5の通常CI（Run 34346049509）は全Job成功。1,000 Action、Balanced Seed 198、Seed 1～30を含む。今回の修正後は200ゲーム・全Replay・物理512 MiBを再実行し、結果を当該Actionsと追補検証記録へ残す。
- 修正Commit `b1e18e2a31278b6c90047e09cac1dbd6553aecc4`の[Release Validation](https://github.com/plastichyena/nowherelefttohide/actions/runs/34414098409)は全Job成功。Random／Balanced各Seed 1～100の200ゲームが正常終局し、全Replay一致、技術的失敗0、上限到達0。Seed 69もTurn 3の通常敗北でReplay一致した。全200戦は敗北で、Random平均3.45・最大10 Turn、Balanced平均15.89・最大26 Turn、Final Horde到達0。このBatchによる最終波の実戦検証や勝率保証は行っていない。
- 同Commitの[CI／Pages](https://github.com/plastichyena/nowherelefttohide/actions/runs/34414084286)も全Job成功。Balanced Seed 1～30・198と通常Session 1,000 Actionを含む。分岐後1,001判断、Package 4,663,920 bytes、ZIP 5,223,240 bytesで読込／Replay一致、観戦Readerのシーク／中止を確認した。
- 物理512 MiB試験は1,300受理Action、分岐後1,301判断、Package実体563,981,768 bytes、ZIP実容量564,706,776 bytesで成功。読込／Replay一致、観戦Readerの前後シーク／中止を確認した。Reader初回読込435,746ms、シーク310～617ms、RSS 515,383,296 bytes。Linux Node 22.23.2上の同じBrowser-safe Readerによる試験であり、実ブラウザの巨大ZIP操作・物理スマートフォンのRAM測定やメモリ改善の証明ではない。
- 公開PagesのBuild ID一致を実ブラウザで確認し、実際のSeed 69失敗直前Saveを読込、視界外の建設を拒否、EndTurnとTurn 3 autosave成功、JavaScript error 0件を確認した。ローカルでは日英UI、929×917と390×844で拒否理由と横はみ出しなしを確認した。
- [AI Portable](https://github.com/plastichyena/nowherelefttohide/actions/runs/34414095984)はLinux x64・Windows x64とも成功。Bundled NodeでSeed 1/7の正常終局、Artifact出力、Replay一致を確認した。CI後の自動Portable Run 34417914038も成功した。
- 追補証跡は `src/testing/fixtures/v156-validation-followup.json`。今回の依頼に従い長時間Jobも完了まで確認した。旧失敗Runの赤表示は履歴として残る。サブエージェントは使用せず、Doc/archiveは参照・変更していない。

## 18.7 v1.5.7 実装・検証（2026-09-12）

- Minimal Player Portable、重要変化・施設理由・Gas危険・資源runway、機械可読Query契約、戦略グラフ・経路Query、壁Asset・HP20・Horde Charge4・共通統計を実装した。MapとAgent戦略Versionは維持し、Rules9／Save16／API14／Artifact13／Session・Checkpoint10へ更新した。
- 通常回帰85ファイルを実行し、83ファイル762件が成功、5件が失敗、専用の日次1,000判断11件は環境変数未指定でskipした。新設壁テストのケース配置誤りを修正し、戦闘後Saveで新Event許可漏れによる失敗を再現して修正した。負荷時にtimeoutしたPNG試験と合わせて関連3ファイル31件を再実行し全成功。成功済みの無関係な回帰は反復していない。長時間Balanced Batch／Seed198はクラウド側へ分離する。
- 型検査、本番Build、Browser Bridge smoke、release report tool 8件が成功。既存のbundle sizeとdynamic importのBuild warningは残る。壁の背景識別の追補ではboard18件・型検査が成功した。
- 実ブラウザの表示fixtureは `src/testing/v157-browser-fixture.ts`。公開GameAction経由で建設し、道路・Plain・Forest・Mountain、Human同居、PC1280×900／mobile390×844、壁HP20・費用5/5・進入MP5の表示を確認する。画面測定はviewportの確認であり実機スマートフォン測定ではない。
- 公開PagesとLinux／Windows Portableの必須確認は完了。長時間Workflowは今回の依頼に従い開始だけを確認し、結果未確認と区別する。
- ユーザーが先に行ったv1.5.6要件／v1.5.7ドラフトの移動をコミットに含める。Doc/archiveの本文は参照・変更していない。今回の明示指示に従い、確定v1.5.7要件はDoc直下に残す。
- 公開ゲームCommit `53dda314328faeeda3ea44516176dbc94abd99cb` のGitHub通常ゲートは85ファイル・768テスト成功、日次専用11件skip。Pages deploy成功後、公開Build ID一致、Seed 1/7の終局（限定EndTurn policyでTurn10/8に通常敗北）、全公開Artifactページと同Action列再生一致、Hidden禁止field非公開を実ブラウザで確認した。通常UIの新規ゲーム、Turn2への進行、autosave v16、reload後の再開、PC1280×900/mobile390×844の横はみ出しなし、console error 0件も確認した。
- 配布工程のみの追補は `46140fc`（Linux launcher引用符・Windows正規化TEMP・計測時Build identity）と `1613bc5`（追加許可文書と同梱Node/fflate LICENSE本文）。ゲームsrc、Version、盤面AssetはPages Commitと同一。既存長時間CIを取消さないためpush時CIを省略し、Portableは各候補の明示dispatchで検証する。
- Windowsローカル候補のv1.5.6実Artifactとの直接比較では、ZIP107,137,535→33,335,530 bytes、展開302,766,249→84,332,647 bytes、7,044→10 files。これはライセンス本文追加前の測定候補で、最終Packageは必要な文書を含む13 filesとなる。代表Session群2,232,173 bytes、Artifact2,509,384 bytes、revision1のCompact47,234 bytes/Full Snapshot2,522,173 bytes。小規模Sessionでの計測であり、1,000判断・512 MiB・実機RAM改善の結果として扱わない。
- 同一Windowsホスト・Seed1・既定Config・合法EndTurn1回・revision1での代表応答前後比較: Compact32,542→47,234 bytes（+14,692）、Full Snapshot2,519,729→2,522,172 bytes（+2,443）。Nodeはv1.5.6同梱22.23.2／ローカル候補22.14.0で、Turn2の資源・人口は同一。新しい判断情報の追加でCompactは増加しており、応答bytes削減を達成したとは扱わない。Sessionのlossless payload、Checkpoint lineage、hash検証は維持し、本版では配布ファイルの除外を主な容量改善として採用する。

- 最終[AI Portable Run 34681924510](https://github.com/plastichyena/nowherelefttohide/actions/runs/34681924510)はCommit `1613bc56c01141358ce76e447ea12afcb78826bd`で両OSとも成功。同梱Node 22.23.2で全9コマンド、Seed1/7の正常終局（10/8判断・通常敗北）、Artifact取得、Replay一致を確認した。最終13ファイルのZIP／展開実容量はLinux 44,209,080／125,978,819 bytes、Windows 34,634,141／88,140,342 bytes。Windows最終ZIPは旧版107,137,535 bytesから72,503,394 bytes減少した。
- [最終Release Validation Run 34682006736](https://github.com/plastichyena/nowherelefttohide/actions/runs/34682006736)の200ゲーム・全Replay・物理512 MiB、および[通常CI Run 34681173166](https://github.com/plastichyena/nowherelefttohide/actions/runs/34681173166)の長時間Jobは起動を確認し、完了結果は未確認。配布修正前のPortable失敗Run 34681186690と、差し替え取消Run（Portable 34681562051、Validation 34681188070／34681646071）は履歴として残す。ローカル常駐サーバーは停止済みで、残りはGitHub上で実行される。
- 検証証跡は `src/testing/fixtures/v157-release-validation.json`。遅れて完了する旧CIが新しい配布工程で古いcheckoutを組み立てないよう、自動Portableを最新mainと同じSHAに限定した。明示dispatchの全検証は維持する。最終記録の変更はゲーム実行コードを変更しない。

## 18.8 v1.5.7 補給説明の追補修正（2026-09-12）

- App／Rules／API／Save／Artifact／Session等のVersionは据え置く。補給計算、合法性、Coreのゲーム状態、公開Observationの保存形式は変更しない。
- Session Compactの各検問所と `query --target=checkpoints` に、既存公開Supplyから導出する `supplyExplanation` を追加する。州都中心・支線Sector・初期半径・現在の支線半径・計算式と、revision付きconstruction Queryへの案内を含む。`providesSupply` はActive Roleを示し、追加補給域の有無を示さない。
- 受理された検問所建設・移設・Role変更は既存importantChangesのconsequencesに、支線半径の前後値と当該Decision全体の補給増減Hex／施設数を記録する。増減0も明示し、複数Postの通知に同じDecision全体の増減が出ても加算しない。履歴、Resume、再試行は既存の記録を使う。
- PLAY_WITH_AIに距離5の東検問所と距離6の陸軍基地の具体例、前進Relocateと後方Standbyの違い、construction Queryの取得手順を追加した。不合法候補の半径据え置き・増分0は、妨害条件解消後も拡張不能という意味ではないと明記した。残存していた旧Version、壁HP10、Horde Charge2表記を現行値へ修正した。
- Claude記録と同じSeed1・東(30,25)建設で説明不足をテスト失敗として再現後、修正して成功。距離6で陸軍基地が補給内、後方Standbyは増分0、合法移設で半径6→7を実Core Actionで確認。関連5ファイル38テスト（Supply、重要変化、Session、Query契約、play-turn）が成功し、型検査と本番Buildも成功。既存Build warningは継続。サブエージェント未使用、Doc/archiveは参照・変更していない。
