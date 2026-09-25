# Nowhere Left to Hide

## PoC 現行仕様

- ステータス: 現行正本
- 現行Version: v1.6.5
- 基準日: 2026-09-23
- 実装照合日: 2026-09-24（本文・詳細節をv1.6.5実装と再照合）
- 直近の反映済み変更要件: `archive/Nowhere Left to Hide PoC v1.6.5 アップデート要件 確定版.md`

本書は現在の実装が従う唯一の正本である。実装、テスト、ヘルプ、保存形式が本書と矛盾する場合は本書を優先する。第1〜17章と18.13〜18.15のルール説明はv1.6.5の現行仕様として整合させる。18.1〜18.12は過去版の検証履歴であり、そこに記載された旧Version・件数・性能値を現行ルールへ適用しない。現行Version境界は18.15.16、v1.6.5の検証範囲と未確認事項は18.15.17〜18.15.19を参照する。過去の資料は現行判断には使用しない。

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

- 51×51固定ヘックスマップ、Seedで4隅から選ぶ固定形状の湾・橋、Oil Field／Army Base／Nuclear Power Plant／Air Base各1基を含む恒久施設28基、4方向の道路支線とHorde入口
- 固定Terrainと湾の選択、Groundの重み付き移動、橋、航空移動、Urban／Forest防御
- Human Unit・管理施設を合成したVisionとFog of War
- PCおよびスマートフォン縦向き
- Police・Soldier・Riot Police・Recon Team・Special Forces・Field Artillery・Multipurpose Helicopterの熟練度、Attack Charge、移動、戦闘、待機、補給・回復、砲兵モード、航空輸送・軍用ドローン
- Pack／Screamer／Gasを含む8種Normal AI系ZombieおよびHorde ZombieのAI、施設感染、鎮圧、陥落、復旧、Human Unit損失時のReanimation
- 所在地を持つ民間人口、都市、生産施設、5資源、過密
- 生産可能なHuman Unitの追加編成、基地・原発の確保報酬と期限付きObjective
- 道路支線ごとの複数Checkpoint Post、Fallback、避難民、審査、Queue維持費、Turn Away、潜伏感染
- Human Combat・砲撃・航空維持・Horde実移動・基地迎撃・Wind等がNormal AI系Zombieと陥落拠点へ作用するNoise Pulse
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
- transport-neutral AI Session Application、WebMCP固定9 Tool、通常UIと分離したLive AI Viewer
- タイトルから公開ZIPを開く、コメント付きの読み取り専用AI観戦
- Unit Test、不変条件試験、複数Seed自動完走試験
- GitHub Actionsによるテスト、ビルド、GitHub Pages公開

## 2.2 対象外

- 任意形状のランダムマップ、一般的なTerrain自動生成、高低差（固定湾候補のSeed選択は実装対象）
- 外部LLM自体の同梱、`balanced`以外の組み込みStrategy
- 外部AIモデル自体の内蔵、AI思考内容の意味解釈、After Action Report、Browser BridgeからのBatch実行
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
- Combat／Movement／Unit Lifecycleは限定的な内部効果処理へ分け、GameAction→GameEngine以外から状態変更しない。経済計画・公開Projection・移動QueryはEngineへ逆依存しない。砲兵・ヘリ・Packを含む16 Unit定義と列挙順をcatalogへ集約し、Gasの死亡キュー、Screamerの一度限りのScream、Army Baseの予約・専用軍需・迎撃・報酬など実際のルールだけをStateへ持つ。
- 経路探索は安定した優先度Queueと局所索引を使い、同コスト時の順序・経路・RNG・イベント順を維持する。Supplyの静的形状はMap IDだけで同一視せず、実際の形状を識別し上限付きで再利用する。
- 盤面は静的Layerと動的更新を分け、Image／Textを再利用する。連続パン・ズームはフレーム内でまとめ、LOD境界以外で全盤面Objectを作り直さない。既存画質・解像度・DPR・情報・LOD条件を維持する。

# 4. ゲーム概要

- 全言語共通タイトル: Nowhere Left to Hide
- 日本語UIでもタイトルは英語表記の`Nowhere Left to Hide`に統一する。
- プレイヤー: 州知事
- HordeはConfigの固定Wave Scheduleを使い、標準ではTurn 10 / 20 / 35 / 50 / 70に発生する。Final Horde Turnは最後の`final: true` Waveから導出し、標準値は70である。ゲームルール上のTurn上限はない。Runnerの100 Turn安全上限到達は`limit_reached`として記録し、ゲーム内敗北およびTechnical Failureとは区別する。
- Final roster freeze後、Final Pendingが0かつMap上のFinal所属Zombieが0で勝利する。非Final Zombieや感染は勝利条件に含めない。
- Final Wave以後に追加の周期Hordeは生成しない。

次のいずれかが成立した瞬間に敗北し、残りの状態遷移を停止する。

1. 州都が陥落する。
2. 所有中の州都・地方都市・Temporary Housing・生産施設およびArmy Base／Air Baseにいる健全民間人口の合計が0になる。

ユニット人口、搭乗部隊人口、検問所内人口、感染者、編成待ち人口は2の敗北回避に数えない。Player所有基地・原発の健常Workerは数えるが、都市住民・避難民・徴用可能人口にはしない。州都の健常人口が0でも、それだけでは州全体人口0による敗北とはしない。空の州都へのZombie侵入は即陥落となる。

---

# 5. UI・操作

## 5.1 レイアウト

- スマートフォン縦向きを基準に、盤面を上部、選択情報と操作を下部へ配置する。
- タイトル画面にはローカライズした`App Version`を常時明示する。表示値は実行中の`APP_VERSION`から導出し、固定文字列やBuild IDで代用しない。
- マップはドラッグパンとピンチズームに対応し、PCではマウス操作にも対応する。
- 上部にターン、フェーズ、総人口と、Food／Civilian Goods／Military Goods／Fuel／Electricityの単一展開Accordionを表示する。折りたたみ時は4備蓄と電力需要／供給を表示し、Core Forecast上の未充足がある資源だけ文字`!`と警告Styleを付ける。展開時は開始量、集約収支、終了見込み、未充足内訳だけを盤面上へ重ねて表示し、別資源Tap、再Tap、外側Tap、Escape、盤面操作で閉じる。
- 次WaveのTurn・方向数・Horde Zombie数・非Horde Slot数・混成可能Type・Finalフラグと、Warning開始後の全方向・残りTurnは独立した警告カードで確認可能にする。Spawn前の特殊Type抽選結果は公開しない。画面/APIの枠名は「変種Slot / variantSlot」とし、通常抽選のHorde変換を説明する。警告カードは初期状態を折りたたみとし、見出しとHorde進行状態を常時表示したまま詳細を開閉できる。Warning前にRandom方向は表示しない。
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
- Bottom Sheetは選択中の1対象を表示し、同一Hexの地上Unit・航空Unit・Facility・Checkpoint・Hexを区別して選択できる。地上／航空UnitはIDで識別し、搭乗部隊は航空機の情報内で表示する。Unit／Facility／Checkpoint Panelへ完全な地形詳細を重複させない。
- 未選択時だけCrisis、人口概要、Checkpoint支線、最新50件までの重要Event、建設概要をAccordion表示する。初期状態はCriticalがあるCrisisだけ展開し、各見出しは44 CSS px以上、Chevron、`aria-expanded`、日英Labelを持つ。Eventは最新10件から10件ずつ増やす。
- 対象名、主要状態、合法な主要Actionは固定Action領域へ置き、内部Scrollに依存させない。詳細Formは対象内Sectionとして1つだけ展開する。
- パネルとAccordion状態はUI状態でありGameStateへ保存せず、新規開始・Load時に初期化する。

## 5.3 Unit Action Mode

- Player Unitを選択した時点では情報、Vision、HP、射程、補給状態だけを表示し、別Hexのタップから移動・攻撃へ暗黙移行しない。
- 選択Unitの近傍に`Move / Attack / Wait`を表示する。砲兵の展開／収納と`AttackHex`、ヘリの離着陸・搭乗・降機、特殊部隊の軍用ドローンも該当Unitの合法Actionとして表示する。各Actionの有効状態はCoreのLegal Actionsから導出する。
- Move Modeでは合法な移動先、Attack ModeではFoWを維持した合法な攻撃対象だけを強調する。対象選択後は対象Hex近傍へ左`×`／右`✓`の確認UIを表示し、既存`Move`／`Attack` Actionを実行する。
- WaitはAction Menuから即時実行して選択を解除する。Target確認中のCancelは同じAction Mode、Action Mode中のCancelはUnit Selected、Unit Selected中の空白タップまたは同Unit再タップは未選択へ1段ずつ戻す。
- Waitは能動行動を終了するが残Attack Chargeを消費せず、自動鎮圧、Counterattack、Interceptionへ保持する。Veteranが1回攻撃後もChargeを残す場合は、移動不能と追加攻撃可能を分けて表示する。
- Action Menuと確認UIは44 CSS px以上のタッチ対象とし、画面端では盤面内へ収め、パン・ズーム・リサイズへ追随する。これらの状態はController内だけのUI状態であり、GameState、Save、Replay、Agent APIへ含めない。
- Bottom Sheetの既存Move確認とWaitは移行期間の補助操作として残せるが、盤面近傍UIを主要操作とし、主要Unit ActionはBottom Sheetまで指を移動せず完結できる。

## 5.3.1 Unit編成Accordion

- 編成可能な施設は、州都・地方都市・Army Base・Air Baseごとの生産可能Typeを共通Accordionで表示する。初期状態は閉じ、Chevron、日英見出し、`aria-expanded`、44 CSS px以上の操作域を持つ。開閉はUI状態だけとする。
- 開いた欄は対象施設で編成できる全Unitの名前、人口・Civilian Goods・Military Goods・必要なFuelのコスト、HP、Attack、Movement、Range、Visionを同じ書式で示す。性能とコストは現在のConfigと共通Queryから取得し、基礎値と完成時熟練度を混同しない。
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
- 人口は盤面上の所在地から消せないこと、施設撤収時の帰還、都市過密、Army Base Workerの都市住民・避難民・徴用対象外、編成拠点制限、v1.6.4以前の通常SaveおよびAI Replay／Artifact／Session／Checkpointの非互換を説明する。
- 道路別の次回到着（Final Wave Spawn後は新規到着停止）、未管理時の素通りリスク、都市のソフトキャップ超過受入を表示する。
- 補給オーバーレイは常設切替を持ち、新設・移設、検問所選択、労働者配置で自動表示する。補給範囲、セクター境界、検問所半径、候補の将来範囲、建設を妨げるZombieを盤面上で識別できる。
- Farm、Civilian Factory、Military Factory、Refinery、Civilian Drone BaseはBottom SheetからPower Supply ON/OFFを切り替え、現在配置とTurn-start Fuelに基づく次回EndTurnの予測要求・給電、基本出力、予測出力、停止理由、直前EndTurnの実績給電を区別して表示する。Army Baseは通常兵士予約を持つ正常稼働Turnだけ、Worker 0でも編成専用の電力10を要求する。Air Baseは正常稼働中、予約の有無によらず電力10を要求する。Required施設は未給電またはOFFなら対象生産・機能を停止する。
- 都市はRequired Powerの予測給電と人口由来Civilian Goods出力を表示する。停電時も人口保持、移住、編成、所有、補給、感染、防衛が利用可能であることを停止表示と混同しない。
- 資源不足予測は警告するが、人口0敗北が確定しない限り無視してEndTurnできる。
- ユニットBottom Sheetは名前横へ熟練度、Regularまでの生存Turn、Veteranまでの直接Kill、昇格待ち、Attack Chargeを常時Text表示する。補給状態、次のプレイヤーターン開始時の回復区分・率・基礎量・成立条件、携行軍需品の現在量／最大量、固定消費、補充・鎮圧後予測、距離別攻撃Cost、基本射程と実効射程、駐留による感染封じ込めと自動鎮圧見込みも表示する。Fuel 0時はEmergency Movementの上限、利用可否、Legal Moveごとの通常／Emergency区分と実効MPを表示する。
- 盤面上のHuman Unit文字情報はUnit名、HP、Attack Charge、補給内外だけとする。可視Zombieは直接選択でき、Type、HP、Attack、Movement、Rangeと公開Wave所属だけを専用Panelへ表示する。内部Target、Noise Target、非公開Spawn情報、Group IDは表示しない。
- 施設Bottom Sheetは上限、1人あたりと現在見込みの入出力、Power Mode、要求電力・発電量、予測／実績給電、停止理由、感染・陥落時の生産損失を表示する。検問所は現在／審査中方針、残り時間と4方針の交換関係を表示する。
- ヘルプは熟練度、Attack Charge、Riot Police／Recon、Riot／Gas／Screamer Zombie、Gasの死亡爆発と連鎖、回復5%／10%／0%、駐留封じ込めと残Charge回数の自動鎮圧、Unit別の民間被害差、携行軍需品、距離別Cost、既存Range 1 Unitの不足火力、Reconの全距離Cost 6、Fuel 0時Emergency Movement、電力5ごとの燃料2、Army Baseの視界・報酬・兵士予約・迎撃・専用軍需、Survivor早期確保、Checkpoint deny／waiting Risk、発電停止の波及、厳格方針の合格率100%・5ターン審査・潜伏感染率0%を日本語・英語で説明する。
- 新規ゲームUIは標準の固定Wave Scheduleを使用し、旧Periodic初回／増加／Finalの6入力を持たない。HelpはWarning Lead 2、Turn 10 / 20 / 35 / 50 / 70の全Wave、方向数、方向別のHorde数5 / 3 / 8 / 5 / 8、非Horde Slot数4 / 6 / 9 / 9 / 10、Final Waveを日英で説明する。拒絶した避難民が将来Hordeを強化し得ること、Final Horde確定後の拒絶はBonusを増やさないことを説明する。Wave開始後は基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を公開するが、Rejected Counter生値、拒絶人数の由来、正確なType内訳は表示しない。
- Helpは全16 Unitの基礎性能、Targeting差、固定Wave Schedule、特殊Slot Weight／Capを現在Configから日英で説明する。HunterはHP20・Attack15・Move15・Range1・Vision5・Charge1、GasはHP35・Attack5・Move3・Range1・Vision3・Charge1、ScreamerはHP15・Attack10・Move3・Range1・Vision2・Charge1、PackはHP50・Attack15・Move10・Range1・Vision3・Charge5とする。Board Legendは画像と短い見分け方を示す。
- 外周のHorde Spawn Reserveを常時OverlayとLegendで識別し、Player Unitの進入・通過・配置、CheckpointのBuild／Relocate／Activate、Constructible FacilityのBuildは禁止だが、Reserve内ZombieへのAttack、Counterattack、Interception、Damageは可能であることを説明する。
- 内政タブでは空の幹線道路Hexを選択でき、Coreの`BuildCheckpoint`候補が合法な選択地点だけに局所Buildボタンを表示する。不合法な場合は座標一覧を出さず、選択地点に対するCore Reason Codeの短い日英文言を1行表示する。Facilityまたは既存Checkpointがある道路Hexではそれぞれの選択を優先し、Checkpoint操作や不合法理由をFacility Sheetへ混在させない。
- Human UIはBuild候補座標一覧とBuild全候補盤面Markerを持たない。Relocateは既存Checkpoint選択からPlacement Modeへ進み、対象支線の合法／不合法MarkerとCore Reasonを維持する。Stateまたは選択候補が変わった場合は古い理由を残さない。
- EndTurn Forecastは未給電施設をID／理由で全件列挙せず件数だけを表示する。Required PowerのPlayer所有施設が次回EndTurn予測で未給電なら、視界外やPlayerによるOFFを含め盤面へ動的文字Marker`⚡×`を表示し、給電見込みへ戻った時点で消す。個別Facility Sheetは予測理由を区別して表示する。
- Checkpoint Bottom Sheet／Branch Panelは`waiting / screening / approved`のFood／Civilian Goods維持需要、初回／以降Build Cost、Relocate Cost、Turn Away入力と、Final Wave後の新規到着停止を表示する。拒絶の方向別Counterや増援数は表示しない。
- 支線パネルはActive／Standby／Dormant、Fallback可否、支線Policy、準備済みPost数を表示する。Active失陥時には州都側のStandby、次にDormantへ即時Fallbackし、前線とSupplyが後退することを説明する。
- Unit詳細、Help、Combat LogはPolice／Riot Police／Reconを公開Noise Class `medium`、Soldierを`large`、Army Base迎撃を`armyBase`、Screamerを`extraLarge`とする。Human Combat、Horde実移動、基地迎撃、Screamの共通NoiseはScreamer／Gasを含む8種Normal AI系Zombieと条件を満たす陥落拠点へ作用する。基地迎撃Radius 8は公開するが、ScreamerのRadius、反応数、対象ID、発生位置、ZombieのNoise TargetはProduction UIへ出さない。
- Coreが公開Stateだけから返す`Crisis Summary`はCritical／Warning／Advisoryの全件をHuman UIとAgentで共有する。Human UIは上部Stripと未選択Accordionへ段階表示する。EndTurnは合法性を変えず、Criticalがあるか未使用Attack Charge／自動鎮圧がある場合だけ短い確認を出す。
- HelpはGround LOS、Forest／Mountainの最初の遮蔽Hex、Aerial Vision、実感染者5人ごとの隣接Spawn、最大6体、即時占有、FIFO連鎖、Noise再Spawnを現在Configから日英で説明する。詳細ルールは11カテゴリのHelpへまとめ、Board Legendへ重複掲載しない。
- UIはCore Eventから最新50件の重要イベント履歴を再構築し、陥落拠点ID／Type／座標、感染者数、Requested／Actual Spawn、残存感染者、原因、連鎖起点を表示する。新規イベントはToast表示し、複数拠点Chainだけを集約する。Load直後に過去Toastを再表示しない。
- 開発BuildだけはCoreが提供する読み取り専用診断を使い、Noise Center、正確なRadius、範囲Hex、反応したNormal Zombie、内部Noise Targetをオーバーレイで確認できる。Production Build、Save、Replay、Agent API、Browser Bridgeには含めず、表示がState、RNG、Action列へ影響してはならない。

## 5.6 盤面Asset・Layer・Board Legend

- Runtime盤面画像は`public/assets/board/`配下の256×256 px透過PNGとする。Plain／Forest／Mountain／Water、橋・Road／Urban、全16 Unit Type（砲兵2モード・ヘリ2状態でUnit PNGは18枚）、原発・空軍基地を含む15 Facility TypeとCheckpoint、状態Overlay、独立obstaclesカテゴリのBarbed Wireを収録する。
- 通常Zombieは承認済みの3体Group、Horde Zombieは同画風の12体密集Swarmとする。両AssetのComic-paintedな傷・血痕は許容するが、写実的またはこれ以上GraphicなGoreと死体表現は使用しない。
- Policeはアメリカ風制服の5人Group、Soldierは武装した兵士の5人Group、Riot Policeは防護装備とShieldを持つ5人Group、Police Zombieは濃紺巡回制服の3人Group、Soldier Zombieは迷彩装備の5人Group、Riot Zombieは損傷した防護装備とShieldを持つ3人Group、Hunter ZombieとGas Zombieは各1体描きとする。Gas Zombieは背中のガス溜まりを持つが、常時damage領域を表さない。Army Baseは兵舎・格納庫・監視塔とフェンスで識別する。Temporary HousingはFEMA等の災害時緊急住宅を想起させるprefab／container housing群とし、軍事基地や恒久集合住宅に見せない。描画人数はTokenが表すゲーム上の人口・個体数ではない。Riot 2 Assetは`Art/reference/v1.5.0-unit-concepts/`の承認済み透過原画を使用し、Hunter Zombieは`units/unit_hunter_zombie.png`を使用する。`0.75`未満では人物数の細部に依存せず陣営色とSilhouetteで識別する。
- TypeScriptのUI専用Asset RegistryをPathとCore Typeの唯一の対応表とし、Game Core、GameState、Save、Observation、ReplayへAsset Path、読込状態、LOD、表示Marker、Help開閉状態を含めない。BoardとBoard Legendは同じRegistryと状態Mappingを使用する。
- Runtime PNG合計は3 MiB以下とし、生成・後加工・出所・第三者Asset不使用・再生成方法を`public/assets/board/ASSET_MANIFEST.md`へ記録する。Hunterの生成Promptと後加工記録は`Art/reference/v1.5.1-hunter-concept/README.md`へ記録する。App VersionまたはBuild IDをURLへ付与してCache Bustingする。
- ゲーム盤面を表示する前にRegistryの全Assetを一括Preloadし、Loading進捗を表示する。Missing、Load、Decode、Texture登録の失敗はAsset単位で記録し、成功済みAssetを維持したまま失敗対象だけ既存図形・文字描画へFallbackする。読込成否は操作、GameState、RNG、Save、Observationへ影響させない。
- 描画順は`Terrain → Road → Urban → Facility Base → Facility State → Fog暗転 → Obstacle → 地上Unit → 航空Unit → 動的Overlay`とする。視界外でもTerrain、Road、Urban、施設、Checkpointを暗転して識別可能にし、Enemy Unitは描画しない。自軍Unitと選択・移動・攻撃・HP・感染・停止予測・Vision・Supply・Horde方向等の操作情報はFogより上に置く。
- Roadは保存済みの明示接続辺だけを描画し、幹線／集散路／進入路を幅6／3.5／2で区別する。隣接するだけの道路を接続せず、形状別PNGを持たない。施設とUnitが同じHexにある場合は施設を中央、Unitを右下へOffsetし、双方を識別可能にする。
- Camera Zoomが`0.75`未満ではPNGの細部を省いたLODへ切り替え、最小Zoom`0.35`でも陣営、Police／Soldier／Riot Police、Normal／Horde／Police／Soldier／Riot／Hunter／Gas Zombie、Army Baseを含む主要施設状態を色とSilhouetteで区別する。LODは旧`P / G / Z / H / F`固定文字へ戻さず、閾値と表示状態をGameStateへ保存しない。
- Help内に折りたたみ可能な`盤面アイコン / Board Legend`を設け、Terrain、水域・橋、道路・Urban、全16 Unit Type、Scheduled／Final Horde、15 Facility TypeとCheckpoint、状態Overlay、通常Zoom／LODを画像と短い日英説明で示す。Boardと同じRegistryを使い、詳細ルールやConfig数値の長文を重複掲載しない。Player向けLegendには強制Fallback表示を含めない。
- 上部電力HUDは`requiredPowerDemand / availableGenerationCapacity`を`予測需要量 / 利用可能供給量`で表示する。日本語Labelは`電力 需要/供給`、英語Labelは`Power Demand/Available`とし、TooltipとAccessible Nameで需要、供給、Core Forecastの不足量を名前付きで伝える。`electricity.shortage > 0`の場合だけ不足状態とし、`0/0`を安全に表示する。実消費量とは呼ばない。

---

## 5.7. コメント付き観戦リプレイ

### 5.7.1 再生方式

- 公開Artifact内の記録済みObservation / Action / Event / decisionSummaryを再生する。
- 観戦でGameEngineによるAction列の再実行を必須条件にせず、記録済み盤面を読む。
- 検証用の決定的Replayと、プレイヤー向け観戦再生を区別する。
- 通常ゲームのState、autosave、進行中Sessionを変更しない。
- FoWはその時点でAIに公開された情報に従う。全知視点は追加しない。

### 5.7.2 基本操作

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

- v1.6.5の現行Version境界で作成した公開Artifactに対応する。
- v1.6.4以前のArtifactは観戦でも非対応とし、理由付きで拒否する。変換・移行しない。
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
- 施設の所有、恒久／建設物区分、Type、確保・建設順、操作可能ターン、Power Supply、`operational`／`building`／`disabled`／`recovering`等の状態、陥落、感染。Temporary Housingと建設Windも同じ施設Stateとして保存する。Army Baseは専用Military Goods、Zombie Phaseごとの迎撃残回数、報酬取得状態、通常兵士予約と`powerReady`を保存する。
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

人口衛生ストレス・飢餓累積と端数、感染伝播猶予、Checkpointごとの潜伏感染、湾・橋、確保Objective、Pack Pending、砲兵モード・生涯予約上限、ヘリ状態・搭乗関係・緊急着陸・軍用ドローンも保存する（18.13〜18.15）。

人口合計等の導出値は正データから再計算し、重複する可変の正データを持たない。
補給圏内タイル、施設の補給可否、セクターは正データから共通の純粋関数で決定的に導出する。

## 6.2 GameAction

最低限、次を提供する。

- Move
- Attack
- AttackHex
- ChangeUnitMode
- TakeOff
- Land
- BoardAircraft
- DisembarkAircraft
- LaunchMilitaryDrone
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
- Army Base／Air Base候補、初期特殊Zombie数・配置。Gas Chainの処理順は安定順であり、それ自体を乱数抽選しない。
- 湾・Oil Field・衛生・Pack・砲撃は各独立系列／決定関数を使用する。ヘリ緊急着陸の同距離候補選択もCoreだけが処理し、Query／Previewは消費しない。

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

- 現行の全Version値は18.15.16の一覧を正本とする。Appは1.6.5、Rules / State / Configは15.0.0、Mapは`fixed-51x51-v9`、Save Formatは22。
- v1.6.4以前の通常SaveおよびAIデータは移行せず、現在状態・旧データを変更せずにVersion mismatchとして拒否する。Map IDとSave Formatを独立に検証し、必須metadataを旧値で補わない。
- Build IDはCIではcommit SHA、ローカルではSHAとdirty状態またはlocal-unknown。乱数やゲーム結果には影響しない。Session / CheckpointはBuildを含む完全な境界を照合する。

## 6.6 Agent ObservationとAgentGame

Agent向け正式入力はGameStateではなく、JSON互換の`AgentObservation`とする。API／Game Rules Version、Turn、Phase、静的マップ、公開中の資源・人口・施設・部隊・ゾンビ・Checkpoint、Horde、Crisis Summary、EndTurn Risk、EndTurn Forecast、Strategic Forecast、勝敗に加え、初期補給半径、道路支線と次回到着、Active／Standby／Dormant／Remnant／Ruined／AbandonedのRole、構造上のFallback可否、支線Policy、決定的な補給圏タイル、施設・都市・ユニットの補給状態、支線ごとのターン内操作済み状態、Core生成の全Checkpoint／Constructible Facility位置別候補を含む。

- 人間ユニットは熟練度、昇格進捗／待ち、Attack Charge、基本／実効射程と携行軍需不足理由、`currentMilitaryGoods`／`maxMilitaryGoods`、固定消費、距離別Combat Cost、補充・鎮圧後予測、Legal Attack別の消費・残量・実効攻撃・Terrain軽減前後Damageを返す。軍需不足時の実効攻撃は各Unit Configの`militaryGoodsShortageAttackMultiplier`と標準端数処理から導出し、固定値をAPIへ重複定義しない。さらに`currentFuel`／`maxFuel`、Legal Move別Fuel Cost・移動後Fuel・`normal`／`emergency`・実効MP、Supply状態、EndTurn補給需要／予測量、回復区分・率・基礎量・成立条件、感染封じ込め能力、残Chargeに基づく自動鎮圧力・回数・民間被害・対象を返す。
- 施設は所有・恒久／建設物・状態・補給・人口・上限に加え、1人あたり入出力、`required | none | conditional`のPower Mode、required Power Capacity、切替対象だけのPower Supply ON/OFF、予測要求・給電・理由、直前実績、基本／予測生産、停止理由、感染・陥落時に失う現在生産、Vision、Zombie Target Value、封じ込め・鎮圧予測を返す。Temporary Housingは総在所人数、Hard Capacity、occupied／empty電力Tier、停電原因と追加維持費を返す。Windは初期／建設由来、発電、Noiseの状態を返す。Army BaseはWorker、専用軍需／40、迎撃残回数、報酬状態、予約の都市人口・支払い・電力待ち／没収理由と機能別の可否を返す。Civilian Drone Baseは合法な場合の`decommissionRefundCivilianGoods`も返す。旧boost Fieldは公開しない。
- ForecastはFoodの開始備蓄、予測生産、Checkpoint健常Queueを含む維持必要量、終了備蓄、維持不足を返す。Military Goodsは開始備蓄・生産、Unitの固定消費・補充、両基地専用軍需補充、自動鎮圧、未充足・終了備蓄を国家集計とUnit別に返す。Civilian Goodsは市民維持とMilitary Factory入力を分離する。FuelはWind・原発の無料発電とPower Plantの実使用（電力5ごとにFuel 2）、発電後Fuel、Unit補給需要／実績、合計不足、Refinery生産、終了備蓄を分離し、電力はphysical／Fuel-limited／available generation capacity、required demand／allocated、shortage、施設別停止理由を返す。Army Base予約なし・非正常時の要求は0とする。
- Checkpointは物理status、導出Role、3人口プール、感染、残り時間、screening batch capacity 20、推定Throughput、Queue Pressure、Queue Food／Civilian Goods維持需要、補給提供、封じ込め・鎮圧予測を返す。Road Branchはnullableな`nextArrivalTurn`と`turnsUntilArrival`、`arrivalsEnded`、今回のBuild／Relocate Cost、拒絶が将来Hordeを強化し得る定性的Riskを返す。Activeだけが到着・新規審査・Supply・Visionを提供する。方針の静的な率と時間は`getApiInfo()`へ置く。
- Checkpoint候補は`actionType`、`branchId`、必要時の`checkpointId`、`position`、`legal`、`reasonCode`、Projected Supply Effectを安定順で返す。Constructible候補は全Mapの安定座標順でType別合法性と最初のCore Reasonを返す。候補、合法手、実Actionは同じCore Validationを使用し、Hidden Enemyの存在・位置・IDを候補差分から漏らさない。
- PRNG内部状態、将来乱数、出現前の特殊Slot抽選結果、デバッグ専用値を含めない。
- Map Terrain、Road／Urban属性、実効移動コスト、防御補正、各Hexの`visibleToPlayer`と`playerOccupancyAllowed`、静的`hordeSpawnReserve`を返す。Enemy配列は現在Visibleな`zombie`／`hordeZombie`／`policeZombie`／`soldierZombie`／`riotZombie`／`hunterZombie`／`gasZombie`／`screamerZombie`／`packZombie`だけを含め、Scheduled／Final Wave所属Booleanを公開する。
- Hordeは次Wave index／Spawn Turn／残りTurn／方向数／方向別Horde数／非Horde Slot数／混成可能Type／Final flag、Warning種別・Warning後の全方向・Final Horde状態を返す。Wave開始後はDirection／Group／kind、基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を返す。Warning前の方向は空配列である。Enemy内部Target、Noise記憶、Hidden位置・ID・個体数、特殊抽選結果、Rejected Counter生値、拒絶人数の由来、正確なType内訳を返さない。
- `getApiInfo()`は熟練度、Attack Charge、Recon／Riot／Hunter／Gas／Screamerの基礎性能、Gas爆発とArmy Baseの静的規則、Survivorの定性境界、Checkpoint deny／waiting Risk、Crisis理由、特殊Slot Weight／Cap、公開Noise RuleとしてClass一覧、Human Unit別Class、Horde移動とArmy Base迎撃のRadius 8、Hex Distance、Terrain非減衰、8種Normal AI系Zombieが対象であること、`visible_population > inherited_horde > noise > idle`を返す。通常歩兵Combat／Screamerの内部Radius、反応したHidden ZombieのID／数、Noise Target、Hidden Pulse源位置は返さない。砲兵・航空中ヘリの静的Noise規則は18.14／18.15に従う。
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
- Balanced Agent Versionは`13.0.0`、Random Agent Versionは`8.0.0`とする。Balancedは独自乱数を使わず、ObservationとLegal Actionsだけから、安定したActionキーで決定する。
- VisibleなScreamer／Gasを含む8種Normal AI系ZombieとHorde Zombie、Terrain Movement Cost、Urban／Forest防御、Vision Coverage、Horde警告、Checkpoint Role／Fallback深度／deny／waiting Risk、Crisis、残Attack Charge、熟練度、Recon、公開Noise Class、Final PendingとMap上のFinal所属Zombieを評価する。非Final Zombieや感染が残っていてもFinal勝利条件を満たし得ることを前提に行動する。
- BalancedはGuaranteed Defeat回避をHard Priorityとし、施設接触拒否、施設／Checkpoint Queue感染の鎮圧、Horde防衛、軍需備蓄、食料・民需品・燃料・電力、州都人口バッファ、過密、生産冗長性を含む施設確保、部隊編成と損傷、全支線のActive Checkpoint確立、状況に応じた後方Standby、支線方針、有益なActionがない場合のEndTurnを評価する。州全体感染時はStrict方針を加点し、Normal／Pass Throughを減点する。
- Food単一障害点ではSimple Farm、Horde方向・Fog・給電余力ではCivilian Drone Base、CheckpointではProjected Supply Effect、前線ではQueue Pressureを評価する。Move距離、Unit Type別Fuel Cost、移動後Fuel、Supply内補給見込みを評価し、Horde緊急防衛を除いてSupply外で移動不能になる進出を減点する。Horde Spawn Reserveへ移動・配置するActionを生成せず、Reserve内のVisible Zombieへの合法Attackは評価する。`checkpoint_supply_zombie_blocked`はCheckpoint戦略の放棄理由にしない。
- Policeの15 MPは州内即応・感染／Checkpoint危機へ使い、Riot Policeは高HP・民間被害なし鎮圧・Blockadeへ、Veteranは追加Chargeの価値を残すよう評価する。Queue維持費、Simple Farmの個数上限なし、Build／Relocate Cost、Turn Awayの定性的Trade-offを評価する。Police／Soldier／Riot／Hunter／Gas ZombieはNormal AI系Enemyとして扱い、Warning前の特殊Typeを推測しない。Random Agentは新Actionを合法手から決定的に扱う。
- 所有中かつ健全民間人口がいる施設に対し、各Zombieが現在接触中か、次のZombie Turnに移動力内から接触可能かを公開Observationだけで予測する。州都、単一供給源、軍需工場、健全民間人口の多い施設を高脅威として扱う。
- Soldierは射程2と対Zombie確殺を利用する接触拒否火力として扱い、接触脅威への攻撃、安全な射撃位置、Horde方向側の所有施設防衛を優先する。Horde入口へ直接進出すること自体は目的にしない。
- Policeは感染鎮圧用として温存し、通常の前線移動・攻撃を抑制する。ただし州都への接触を他の手段で防げない場合は防衛へ参加できる。
- 複数Zombieが次の敵行動で到達できる位置への移動・攻撃を露出として減点し、低HP Unitの危険接近を抑制する。
- 未管理道路の流入リスク、Checkpointの新設・方針・Active化・前進・後退、Build／Relocateが同Hexに共存する場合の異なる効果、補給圏を考慮した施設価値・労働者・編成・回復、Checkpoint跡と荒廃地点の防衛・鎮圧・再前進を評価する。全支線を常に3重化するHard Ruleにはしない。
- 軍需品はUnit別携行量、固定消費、距離別Combat Cost、補充不足、鎮圧需要、Army Baseの専用軍需・迎撃、編成用バッファを評価し、供給停止前に軍需工場の確保・稼働を進める。Soldierが1隊だけで、軍需品・人口・生産基盤を維持できる場合は2隊目を編成する。
- Food／Civilian Goods／Military Goodsは当ターン生産後の最終収支、Fuelは翌ターンの発電備蓄として評価する。Required都市・施設、Housingのoccupied／empty Tierと停電追加維持費、WindとPower Plantのphysical generation capacity、Fuel不足、Civilian Goodsの市民維持不足とMilitary Factory入力不足を区別し、労働者再配置、建設、人口移送、SetPowerSupplyを評価する。複数方向Warningでは全戦力を一方向へ縮約せず、次Waveまでの5～15 Turnに電力、Fuel、Military Goods、人口、Unit、Checkpoint depthを再評価する。
- 州都の健全民間人口は平時15人、州都への接触脅威がある場合20人を目標バッファとする。これを下回る人口配置・編成を減点し、安全都市からの帰還を評価する。
- Farm、Civilian Factory、Refinery、Power Plant、Military Factoryの単一依存を検出し、黒字時でも代替施設の確保と適量稼働を評価する。労働者は最大投入ではなく、不足解消、冗長性、入力資源、州都人口を考慮した目標人数へ近づける。
- 同一ターン内で同じ施設の労働者数や検問所方針を繰り返し変更しないようAction Family単位の反復抑制を行う。接触脅威や感染が残っていても、対応可能なUnit Actionがなければ不要な内政Actionを挟まずEndTurnできる。
- 評価重みと閾値をデータとして分離し、Decisionごとに優先目標、選択Actionと点数、上位候補、理由コードを機械可読Traceとして残す。文章上の思考過程は保存しない。
- `effectiveRange`、携行軍需不足、距離別Combat Cost、Fuel 0時Emergency Movementによる補給圏帰還、負傷部隊の後退、戦闘回復と休養回復の比較、駐留封じ込めと自動鎮圧、兵士の鎮圧時民間被害、電力・生産波及、人口・感染・防衛に応じた検問所方針を評価する。Traceは回復、後退、鎮圧、射程、軍需、Emergency Movement、電力、方針の理由コードを持つ。
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
- SessionのCrisis／EndTurn Riskに含む各Alertの`sourceRevision`は、その応答を生成したSession Revisionと一致させる。status、query、historyの復元Snapshot、play-turnで同じ意味を使い、Core内部Event件数等をSession Revisionとして公開しない。

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
- 非致死攻撃でGas Zombieを弱らせた後は、確定結果の新Revisionで再度Previewし、致死時に初めて現れる`gasExplosion`を確認できる。確定Actionをまたいで旧Previewを再利用しない。
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
- Unit IDは連番を仮定できないopaqueな安定IDとし、Observation、Legal Action、実行結果が返した値をそのまま使う。新規編成UnitのIDを既存IDから予測しない。
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


### 6.9.7 Compact・変更理由・壁情報

- 維持人口・維持費内訳・資源終値予測を保ち、利用可能都市人口を`availableCityPopulation`として総人口と分ける。
- Compactは全4支線のID・managed・Active Checkpoint IDまたはnull・方針・次回到着Turnまたはnull・到着終了・現在Queueを返す。支線別`latestPublicFlow`は直近4件の公開到着／審査を処理Turn付きで返す。未管理素通りと検問所受入は公開payloadで区別する。
- 確定Revision間の`facilityChanges`と`branchFlowChanges`をAction/EndTurnへ返す。状態から確認した変化と関連公開Eventを分ける。status/newは現在状態のみ。支線Queueの前後差を到着人数や累積値と混同しない。
- `productionStops`はPlayer所有施設の停止ID・理由・給電理由・予測出力を最大8件、総数と省略数、同Revisionのfacilities Query導線付きで返す。Worker不要のWindは0 Workerでも停止ではないため除外する。電源喪失、Fuel不足、容量／割当不足、感染、復旧待ち、人口不足を区別する。`facility_workers_zero`の`stoppedWorkers`は停止したWorker型施設のWorker Capacity（Simple Farmは10）を返す。大きな停止と失われた電源はwarningの`production_outage`。未計算の将来枯渇・不可避敗北を保証しない。
- Compactは公開Forecastから導出したFood／Civilian Goods別の人口維持余力と制約資源を`supportHeadroom`として返す。人口受入、Worker配置、編成前にFull Snapshotなしで確認できる。
- `population-transfers`はfromReason/toReason/actionBudgetReason、任意正整数のmin/maxを返す。`worker-assignments`はtargetReason/populationReason/actionBudgetReasonと都市別の健常人口・供給可能人口・不適格理由を返す。Turn開始Snapshotを途中で作り直さない。
- 現在可視の`barbedWire`と建設候補・不許可理由、静的`barbedWire`規則、HumanのMP5と実移動Hex由来Fuelを提供する。Mapの基礎移動値と動的壁による実効値を分け、Artifact復元時にも壁を反映する。
- 壁上Humanの`conditionalIncomingCombat`は視認済み敵ごとに攻撃値・壁Damage・残壁HP・Human貫通Damage・残HPを返す。敵が実際に移動／選択／攻撃するという予告ではない。攻撃時の条件付き反撃予測と既存Gas撃破プレビューも維持する。
- 公開建設数、視認済み破壊数、可視Damage、Human肩代わり量だけをMetrics化する。Hiddenな壁HP・破壊・敵IDはObservation、Event、Artifact、UIへ漏らさない。
- 日英Help／Legendと内政のHex選択に性能・配置図・禁止理由を示す。壁とHumanは同Hexタブで選び分け、見出しの壁HPとHuman HPを分ける。修理・撤去・返金・視界源は追加しない。
- Balancedは公開壁の突破コスト・Human被害軽減・合法建設を評価し、RandomはLegal Actionsを安定キーで扱う。全面戦略改修や勝率保証は行わない。

---

### 6.9.8 公開判断情報とQuery契約

- 公開判断の解釈をStore、CLI、Browser Transportから独立した純粋関数として共有する。Full Observationを差分専用にせず、公開情報への完全なアクセスを維持する。
- CompactのimportantChangesは、直近の受理EndTurn以降（そのEndTurnを含む）の施設喪失・停止・復旧、生産/電源喪失、人口・感染・補給・Unit・Checkpoint・新規視認の重要な変化を保持する。受理Decisionの公開前後差分とEventだけを根拠にし、通常消費を施設喪失と混同しない。
- 各項目は安定ID、severity、entityIds、reasonCodes、関連Event、二次影響を持ち、重大度・新しいDecision・安定IDの順に最大10件、内側配列も最大10件とする。total/omittedとrevision固定のhistory Query案内で省略を明示する。Step/play-turnは自身のDecision、Statusは最近の期間を返す。Restart/Resume後も復元し、Branchは分岐後のみ、Rejected Actionとidempotent再送では重複追加しない。
- Compact施設はoperationalStatus、capacity、population操作可否/理由/増減、production/recoveryの理由を短く公開する。詳細は既存施設Queryへ委ねる。
- combatHazardsは既存の合法Attack Previewにある致死Gas攻撃から、公開された味方Unit死亡・自拠点陥落の危険だけを最大5件抽出する。巻き添え配列は最大10件、件数と追加Query案内を持つ。Hidden状態、合法でない攻撃、仮想の未来探索を根拠にしない。
- api.queryContractは全targetのfilters、必須値、enum、既定値、pagination、response/error、実行可能例をJSON Schema 2020-12の対応部分集合で返す。入力Validatorも同じSchemaを使用する。未知key、不正型/null、不正enum/負数を理由付きinvalid_queryで拒否し、expectedRevision不一致はstale_revisionとする。
- strategic-map Queryは道路の次数2区間を圧縮し、施設・Checkpoint・分岐/端点・閉路の安定NodeとEdgeを公開する。未接続施設も明示し、collection=nodes/edgesを独立ページ化する。Map IDは固定Mapを維持する。
- route QueryはUnit指定時に現在位置・実移動/燃料/補給規則を使い、Unitなしのsource/destination指定は移動能力を持たない参考経路として区別する。到達不能理由、距離/必要MP、戦略Node列、補給遷移、任意Hex列を返す。長い配列はrangesで別々にページ化し、詳細列の省略と経路不存在を混同しない。通常一覧は既定100/最大500件、revision固定で取得する。

# 7. 固定マップと初期状態

## 7.1 マップ

- Map IDは`fixed-51x51-v9`、寸法は51×51、有効座標は`q=0..50`、`r=0..50`とする。Capitalは`(25,25)`、Horde EntranceはNorth `(25,0)`、East `(50,25)`、South `(25,50)`、West `(0,25)`とする。
- 外周2列、すなわち`q = 0 | 1 | 49 | 50`または`r = 0 | 1 | 49 | 50`の重複を除く392 Hexを、公開の静的Map Rule `hordeSpawnReserve`とする。各Tileは`playerOccupancyAllowed`を持ち、Reserveではfalse、その他ではtrueである。
- RoadはCapital Junctionを含む`q=25`の全Hexと`r=25`の全Hexから成り、North／East／South／Westの4支線はCapitalから各Entranceまで25 Hexとする。Entranceと恒久FacilityのRoad Hexも支線へ含めるが、Facility HexはCheckpoint候補外とする。
- 基礎Terrainは`plain`、`forest`、`mountain`、`water`。Road、Urban、橋、Facility、CheckpointはOverlay／属性として分離する。標準Mapは4隅からSeedで1つ選ぶ固定形状の湾と橋を持つ。任意形状のTerrain自動生成は行わない。
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

- Mountainを先、Forestを後に配置し、重複時はMountainを優先する。その後、幹線Roadと恒久Facilityの座標をPlainへ戻し、選択された固定湾・橋を反映する。全2601 Hexの地形内訳は湾の選択に依存する。接続道路自体はForest／Mountainを変更しない。
- 地上移動は進入先の実効Costを消費し、開始Hexは消費しない。Plain1、Forest2、Mountain3、橋なしWaterは進入不能。Road／Urbanと橋はCost1。ヘリの航空移動は各Hex1 MPで、地形・橋・地上占有を無視するがReserveへは進入できない。
- HumanとScreamer／Gasを含む8種Normal AI系Zombieは同じ決定的な重み付き最短経路を使い、同Cost経路は安定座標順で決める。
- Player UnitはReserveへ進入、通過、停止、初期・完成・復帰配置できない。CheckpointのBuild／Relocate／ActivateとConstructible FacilityのBuildもReserveを拒否する。候補、Pathfinding、Legal Actions、Save validation、不変条件は同じMap RuleとReason Codeを使い、拒否はState、Resource、Action回数、RNGを変更しない。ZombieのSpawn、移動、停止、およびReserve内ZombieへのAttack、Counterattack、Interception、Damageは許可する。
- Urban Hex上のGround Unitは被通常Combat Damage×0.5、Forest上のZombieは×0.5。Urbanを優先し、重複しない。RoadはForest防御を消さない。Terrain防御は通常攻撃・反撃・迎撃とGas／砲撃のUnit被害へ適用する。航空中ヘリは地形防御なしで、両爆風の対象外。感染変換へは適用しない。
- Ground VisionはPolice／Soldier／Riot Police／Special Forces／Field Artilleryが5、Reconが10。Multipurpose Helicopterは着陸中も航空中も遮蔽を無視するVision10。Normal／Horde／Gas／Pack Zombieは3、Screamerは2、Police／Soldier／Riot／Hunter Zombieは5。CapitalはGround Vision5、所有・未陥落施設とActive Checkpointは原則Ground Vision1。Army Base／Air BaseはWorker0で1、Worker1..10で5とし、感染・停止・復旧・Supply外・停電でも未陥落なら維持する。Standby／Dormant／Remnant／Ruined／Abandonedと搭乗中Unitは独自Visionを提供しない。
- Ground LOS、Visibility、Hidden Enemyの公開・実行時停止の境界、Aerial Visionの遮蔽無視は共通の純粋Queryを維持する。Visibility外Enemyの位置・個体情報・Target・移動・正確なSpawn位置は公開せず、Last Known Positionも保持しない。

各ゲームの恒久Facilityは、次の固定24施設と、Seedで選ぶOil Field・Army Base・Nuclear Power Plant・Air Base各1施設の計28施設とする。原発・湾は18.13.9〜18.13.10、空軍基地の候補は18.15.6を参照する。

| ID | Type | 座標 | 初期状態 |
|---|---|---:|---|
| `capital` | Capital | `(25,25)` | owned |
| `city-1` | City | `(25,21)` | owned・人口0 |
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
| `military-factory-1` | Military Factory | `(21,25)` | owned・労働者0 |
| `military-factory-2` | Military Factory | `(22,10)` | disconnected |
| `military-factory-3` | Military Factory | `(28,40)` | disconnected |
| `oilfield-north` | Oil Field候補 | `(26,13)` | Seed選択時だけdisconnected |
| `oilfield-east` | Oil Field候補 | `(37,24)` | Seed選択時だけdisconnected |
| `oilfield-south` | Oil Field候補 | `(24,37)` | Seed選択時だけdisconnected |
| `oilfield-west` | Oil Field候補 | `(13,26)` | Seed選択時だけdisconnected |
| `refinery-1` | Refinery | `(25,23)` | owned |
| `power-plant-1` | Power Plant | `(25,27)` | owned |
| `wind-power-plant-1` | Wind Power Plant | `(26,24)` | owned |

- Type別内訳はCapital 1、City 8、Farm 5、Civilian Factory 4、Military Factory 3、Oil Field 1、Refinery 1、Power Plant 1、Wind Power Plant 1、Army Base 1、Nuclear Power Plant 1、Air Base 1である。初期所有はCapital、City 1、Farm 1、Civilian Factory 1、Military Factory 1、Refinery 1、Power Plant 1、Wind Power Plant 1の8基とする。City 1とMilitary Factory 1は健康人口・感染者0、初回報酬取得済み・早期Survivor救出対象外であり、開始時に確保報酬を加算しない。
- Oil FieldはNorth／East／South／West候補から独立Seed付き等確率で1基だけ選ぶ。選択候補と対応する幹線接続Hexの間だけ1 Hexのaccess spurを持ち、未選択3候補にはFacilityもspurも生成しない。このspurは道路支線数を増やさず、Supply、Checkpoint適格性、防御を変更しない。
- 新規ゲームでは中立の`army-base-1`を固定候補からSeed付きでちょうど1基置く。候補はCapitalからDistance 6以上、初期Supply外、施設・初期Human Unit・Reserveと非重複であり、選択位置は初期metadataへ保存する。Oil Field／Army BaseともSave／Loadで再抽選せず、実Stateは原発・空軍基地を含め計28施設である。
- 全恒久FacilityはUrban Overlayを持ち、Road座標上ではRoad Overlayも維持する。実際に存在する全恒久Facility座標の基礎TerrainはPlainとする。4支線、Sector、Supply、Map Query、UI、Observation、Save、Replay、Testは同じ固定Map定義を使う。

## 7.2 人口上限

- 州都: ソフトキャップ100
- Temporary Housing: 健康住民 `workers` と感染者 `infected` の合計Hard Cap 10
- 地方都市: ソフトキャップ50
- 通常生産施設: Worker上限30。Oil Field／原発／Civilian Drone Baseは5、Army Base／Air Base／Simple Farmは10、Windは0。各TypeのConfig値を使う。

Capitalと通常Cityはソフトキャップを超過できる。Temporary Housingは超過できない。各値はConfig化する。

## 7.3 初期人口・部隊

初期Player所有の民間人口110人（中立施設のSurvivorは別枠）:

- 州都51
- 農場1に23
- 民需工場1に23
- 製油所1に10
- 発電所1に3

Wind Power PlantはWorker 0固定である。初期未配置人口は存在しない。初期Human Unitは全7隊・Regularで、Police 4隊（各人口5）を`(24,25)`、`(25,24)`、`(25,26)`、`(24,26)`、Riot Police 1隊を`(24,24)`、Recon Team 1隊を`(26,26)`、Soldier 1隊を`(26,25)`へ置く。合計部隊人口45、総人口155とする。

- 初期資源はFood 330、Civilian Goods 355、Military Goods 175、State Fuel 192とする。
- 全初期Human Unitは通常Configの最大HP・最大Fuel・最大Military Goodsで開始し、State備蓄から差し引かない。
- 初期Normal ZombieはGame Seedで決定する40体とする。CapitalからHex Distance 8以上、全初期ZombieはArmy Base／Air Baseを各Zombie自身のGround LOSで視認できず、Facility・初期Human Unit・Reserve・既存初期Zombieと非重複、Zombie進入可能Terrainを満たす。さらに4本の主要Road Branch本線外、次に本線非隣接を優先し、候補不足時だけ段階的に緩和する。候補不足は決定的にConfigを拒否する。
- 初期Hunter Zombieは通常Zombie 40体を確定した後、`initialHunterCount { min, max }`（標準4固定）を等確率で抽選し、Capitalから地形・移動コストを含めない最短Hex Distance `initialHunterMinDistance`（標準20）以上、Army Base／Air Baseを自身のGround LOSで視認できない通行可能かつ未占有の候補へ重複なく配置する。候補不足は初期化をCommitせず診断可能なエラーとする。初期Hunterの`spawnGroupId`と`hordeKind`は`null`である。
- 初期Gas ZombieはNormal 40体とHunterを確定した後、`initialGasCount { min, max }`（標準4固定）を等確率で抽選し、CapitalからHex Distance 9以上、Army Base／Air Baseを自身のGround LOSで視認できず、Map内、Zombie通行可能、施設・初期Human Unit・Reserve・既存初期Zombieと非重複の候補へ置換なしで配置する。`spawnGroupId`と`hordeKind`は`null`である。初期Screamerは2体とし、Normalの配置資格、Army Base／Air Baseを自身のGround LOSで視認できず、他の全初期配置との非重複を満たす候補からSeed付きで選ぶ。標準初期Zombie総数は50体である。
- 同じVersion、Map、Config、SeedはArmy Base、初期Normal Zombie、Hunter、Gas、Screamerの数、座標、PRNG消費順、Unit ID順を再現する。通常Zombie、Hunter、Gas、ScreamerはいずれもHorde由来ではなく、所属情報は`null`である。

## 7.4 連絡途絶施設

- 原発を除く初期中立恒久Facilityは施設ID別の独立抽選による1..10人を収容上限でclampしたSurvivorを持つ。原発は初期人口0。確保可能な地上Human Unitが進入しZombie駒がいなければ確保し、Player Turn10中まで残存Survivorを健康人口として救出する。砲兵・ヘリ・搭乗中Unitは確保できない。
- 荒廃感染施設は内部感染者を0にするまで復旧しない。
- 10回目EndTurnまで未確保なら、Refugee処理後・通常感染処理前に残存Survivorを全員感染者へ変換する。未確保中の正確な人数、期限、抽選範囲は公開しない。
- 新規確保・復旧した施設は次のプレイヤーターンから人口操作・編成に使用できる。

---

## 7.5 固定マップの施設間接続道路

### 7.5.1 対象

既存の東西南北幹線を骨格に、地区連絡道と施設進入路・任意の周回路を決定的に生成する。現在の基本道路入力は固定24施設＋選択Oil Field1基＋選択湾の原発1基の26施設。後から選ばれたArmy BaseとAir Baseへ進入路を接続し、最終28施設を道路網へ含める。

### 7.5.2 ゲーム効果

- 地上の進入先Road Hexは1 MP。道路接続方向に沿う移動だけを割り引く方式ではない。
- Road OverlayはForest／Mountainの基礎地形・防御・LOSを変えず、Urban防御を付与しない。既設橋はWater上の地上通行を許す。橋のない水域・ReserveのPlayer進入禁止は解除しない。
- Supply、幹線支線、Checkpoint資格、避難民・Wave入口は幹線定義を使い、接続道路を新たな支線にしない。
- Supply等を満たす接続道路上Plainへの施設建設は可能。幹線上の禁止とは区別する。
- Playerの道路建設・破壊・修復Actionはない。後から建てた施設へ自動敷設せず、所有変更・陥落・撤去で初期道路を再生成しない。

### 7.5.3 入出力と階層

`trunk`は幹線、`collector`は地区道、`access`は進入路。分類は描画・生成用でMP差はない。純粋な生成器は地形、境界、禁止域、施設、既設経路、Layout Seed、Styleを受け、区分・ID・連続Hex列を持つRoadSegment群、generatorVersion、settingsId、inputHashを返す。現在の人口・所有・Unit・感染・Supply・描画へ依存しない。

### 7.5.4 地区

Capital／Cityごとに地区中心を作る。6 Hex以内の到達可能な最寄り都市へ施設を割り当て、残りは全メンバー間距離6以下の施設群へまとめる。非都市群の中心は全メンバーから到達可能な非施設Hexのうち合計距離最小、同点は座標順。重要度はCapital4・City3・複数施設群2・単独施設1。

### 7.5.5 必須接続

未接続の各地区から接続済み道路網へ実経路を求め、生成Cost・新設辺数・曲がり数・座標・IDの安定順で1地区ずつ接続する。次に各施設の進入路を接続する。Oil Fieldだけは選択方角の幹線へ固定1 Hex spurを持つ。近傍4地区だけを先に絞る旧計画は現行アルゴリズムでは使用しない。必須経路を生成できなければエラーとし、未接続施設を残して開始しない。

### 7.5.6 生成用経路評価

ゲーム内MPとは別のCostを使う。Plain10・Forest25・Mountain80、既設辺共用3、方向転換60度3／120度6、選択軸外2、既設道路との並走8。状態はHex＋進入方向で決定的に探索し、即時逆行と非都市施設の新設通過路化を禁止する。禁止域・橋なしWater・Reserveへの新設を認めない。橋は既設経路として利用する。美観優遇経路が優遇なし経路の1.5倍を超える場合は後者を使う。

### 7.5.7 任意道路

必須接続完了後、地区中心間の道路距離を改善する経路を評価する。追加前距離が追加後の1.5倍以上、短縮3辺以上、距離上限`max(6, floor(min(width,height)/4))`（標準12 Hex）。効果×両端重要度／新設辺数で順位付けし、短い閉路・次数5以上を作る候補を除く。予算は必須接続後の新設辺数の30%を切り捨て、既設幹線・橋を除きOil Field spurを含む。後付けの両基地進入路は予算対象外。価値のない道路で予算を消化しない。

### 7.5.8 現行パラメータ

現行実装の設定は`src/core/roads.ts`の`ROAD_STYLE`。地区半径6、任意道路率0.30、地形・方向Costは7.5.6。生成器Versionは`connector-roads-v1`、Layout Seedは0。以前の方式検討にあった近傍候補4・接続点合流半径2を、現行の保存済み設定として扱わない。

### 7.5.9 Seedと生成タイミング

湾・Oil Fieldを選んだ地形・施設入力から基本道路を生成し、Army Base、Air Baseの順に進入路を加える。道路生成自体はGameplay RNGを消費しない。同一入力から同一道路になるが、Game Seedで湾・Oil Field・基地の配置が変われば道路も変わり得る。New Game時に確定し、Turn・Query・Load・Replay seekで再生成しない。

### 7.5.10 保存・描画

RoadSegmentの隣接Hex列を正本とし、無向辺・六方向接続を導出する。隣接するだけの別道路を接続せず、同じ辺はtrunk／collector／accessの優先で描画する。線幅は6／3.5／2。Save／Session／Artifactは確定配置と生成情報を保持し、Load時の最新生成器で置換しない。Version境界は18.15.16。

### 7.5.11 Core境界

幹線資格と移動道路判定を分ける。Unit移動・地形防御・LOS・Supply・Checkpoint・施設建設・公開Map・保存検証が各責務に合う同じCore Queryを使う。道路生成CostをUnit経路探索へ混ぜない。キャッシュはMap IDだけでなく入力内容を識別する。

### 7.5.12 失敗時

美観優遇を外した経路も検討し、必須接続不能は対象・位置と遮断理由を付けて初期化を拒否する。水域・禁止域を変更して救済せず、既存Saveを維持する。任意接続が不成立なだけなら不採用とし、失敗にしない。任意形状のランダムマップは提供しない。

### 7.5.13 検証

施設の幹線到達、経路連続性・境界・禁止域、橋の通過、双方向接続、重複辺、同一入力の決定性、RNG非消費、保存Round Trip、UI／Agentの実効MPを確認する。道路Overlayだけの違いでSupply・幹線資格・防御・LOSを変えない。道路による移動時間・接触時期の変化は許容し、旧版とのゲーム結果一致を要求しない。

---

# 8. ユニット・戦闘

## 8.1 基礎性能

| ユニット | HP | Recruit Attack | Move | Range | Vision | 人口 |
|---|---:|---:|---:|---:|---:|---:|
| Police | 25 | 6 | 15 | 1 | 5 | 5 |
| Soldier | 50 | 12 | 10 | 2 | 5 | 10 |
| Riot Police | 75 | 9 | 10 | 1 | 5 | 10 |
| Recon Team | 25 | 9 | 10 | 6 | 10 | 5 |
| Special Forces | 50 | 12 | 10 | 2 | 5 | 5 |
| Field Artillery（収納／展開） | 25 | 7 / 40 | 10 / 0 | 1 / 10..200 | 5 | 5 |
| Multipurpose Helicopter（着陸／航空） | 100 | 13 | 0 / 50 | 2 | 10 | 2 |
| 通常Zombie | 15 | 5 | 3 | 1 | 3 | — |
| Horde Zombie | 40 | 5 | 3 | 1 | 3 | — |
| Police Zombie | 10 | 5 | 3 | 1 | 5 | — |
| Soldier Zombie | 20 | 10 | 5 | 1 | 5 | — |
| Riot Zombie | 60 | 5 | 3 | 1 | 5 | — |
| Hunter Zombie | 20 | 15 | 15 | 1 | 5 | — |
| Gas Zombie | 35 | 5 | 3 | 1 | 3 | — |
| Screamer Zombie | 15 | 10 | 3 | 1 | 2 | — |
| Pack Zombie | 50 | 15 | 10 | 1 | 3 | — |

すべてConfig化する。HumanのRegular／Veteran AttackはRecruit Attackへ`ceil(recruitAttack × 1.25)`を適用する。Police8、Soldier15、Riot Police12、Recon12、Special Forces15、収納砲兵9／展開砲兵50、ヘリ17となる。Enemyの最大ChargeはHorde4、Pack5、その他1。Waveの通常Zombie抽選は確定RosterでHorde Zombieへ変換するためCharge4となり、それ以外の特殊Typeは元のChargeを維持する。

Humanの携行上限と固定軍需消費は次のとおり。初期部隊は満載で開始し、国家備蓄を追加消費しない。

| Type | maxFuel | maxMilitaryGoods | 固定Military Goods / Turn |
| --- | ---: | ---: | ---: |
| Police / Riot Police | 24 | 10 | 0 |
| Soldier / Recon / Special Forces | 44 | 40 | 1 |
| Field Artillery | 100 | 100 | 1 |
| Multipurpose Helicopter | 500 | 40 | 1 |

## 8.2 熟練度とAttack Charge

- Human Unitは`recruit / regular / veteran`の熟練度を持つ。初期Police／SoldierはRegular、新規完成UnitはConfigの`productionProficiencyByType`に従い標準Recruitとなる。
- Recruitとして完成・配置されたPlayer Turnを0とし、以後5回のPlayer Turn Startを生存して迎えると、回復・補給・Action開始前にRegularへ昇格する。Recruit時代のKillは持ち越さない。
- Regular昇格後、通常攻撃、Counterattack、Interceptionの直接Combat DamageでZombie Unitを5体撃破すると`veteranPromotionPending`になり、次Player Turn StartにVeteranへ昇格する。施設内感染者の鎮圧や二次効果はKill Creditへ含めない。
- 通常Humanの最大Attack ChargeはRecruit／Regular1、Veteran2。Special Forcesは3／4、Field Artilleryは全熟練度1。通常Attack、Counterattack、Interception、自動鎮圧は対象UnitのChargeを共有する。5体目撃破のTurn中にChargeを追加しない。航空機の搭乗中Unitは行動できず、自動鎮圧にも参加しない。
- Player Turn Startに生存Human UnitのChargeを熟練度上限へ補充する。Waitは残Chargeを保持し、移動後にChargeが残ればAttack可能、1回Attack後は移動不能だがVeteranは残Chargeで再Attackできる。

## 8.3 行動

- Humanはプレイヤーターン中、Typeと状態に応じた移動・攻撃・専用Actionを行う。追加Combatの回数は現在のAttack Chargeで決まり、Special Forcesの複数攻撃も含む。
- 移動のみ、攻撃のみ、移動後攻撃、移動後またはその場で待機を選べる。
- 攻撃後は移動できず、攻撃または待機で行動を確定する。
- 1 Hexにつき地上Unit1隊、航空Unit1隊を許可する。搭乗中Unitは独立占有しない。施設はタイル属性であり、同一Hexの地上Unitと航空Unitは選択・対象IDを区別する。

## 8.4 移動Fuel

- 地上の通常MPはPolice15、Soldier／Riot Police／Recon／Special Forces／収納砲兵10。進入Terrain Costの累積で経路合法性を判定する。
- 歩兵Fuelは実際に進入したHex数dを使う。d=0は0。Police／Riot Police／Special Forcesは`2 × (d <= 5 ? 1 : 1 + d - 5)`、Soldier／Reconは`2 × (d <= 5 ? 1 : 1 + 2 × (d - 5))`。
- 収納砲兵は実消費MP×10 Fuel。展開中は移動不可。ヘリは着陸中に地上移動できず、航空中は1 Hex=1 MP、最大50 MP、1 MPあたりFuel5。航空移動中のFuel枯渇は18.15.10の緊急着陸へ接続する。
- 地上Move開始時に予定経路のFuelを保有しないActionは拒否する。Hidden Enemyで途中停止した場合は実移動分から再計算する。
- Attack、Wait、Counterattack、Interception、自動鎮圧はFuelを消費しない。死亡Unitの残Fuelは国家備蓄へ戻さない。航空中ヘリのEndTurn固定Fuel消費は1。
- Fuel0の地上歩兵だけはEmergency Movementを利用でき、Police3 MP、Soldier／Riot Police／Recon／Special Forces2 MP。収納砲兵は1 MP。Fuel消費なしで通常の地形Costを累積し、Fuelが1以上ならEmergency候補を出さない。ヘリにこの地上Emergency Movementは適用しない。

## 8.5 戦闘・迎撃

- 攻撃側が先にAttack分のダメージを与える。
- 生存した防御側が、射程内かつAttack Chargeありの場合だけ反撃する。
- 通常攻撃、反撃、迎撃は実行UnitのAttack Chargeを1消費する。
- 移動経路で初めて敵射程へ入った地点で迎撃し、その地点で移動を終了する。
- 生存していれば攻撃または待機できる。
- HPを0未満にせず、死亡ユニットを盤面と合法手から除外する。
- 防御側HexのTerrain防御を攻撃、反撃、迎撃へ適用し、軽減前後Damageと防御源をEvent／Metricsへ残す。
- Humanの通常攻撃・反撃・迎撃は直前に距離別の携行Military Goodsを確認・消費する。Police／Riot Police／Soldier／Special Forcesの距離1は2、収納砲兵の距離1は4。不足時は残量を消費して`max(1, ceil(attack × 0.2))`へ弱体化する。Soldier／Special Forcesの距離2は4、Reconは全距離1..6で6、展開砲兵は距離10..200へ50、ヘリは距離0..1で2・距離2で4を全量必要とし、不足時の弱体攻撃はない。着陸ヘリは能動Attack不可だが反撃・迎撃可能。死亡Unitの残軍需は国家備蓄へ戻さない。砲撃・航空対象の詳細は18.14／18.15に従う。

## 8.6 自然回復

Human Unitは次Player Turn Start、補給圏内で生存し回復資格を持つ場合に1回だけ自然回復する。通常攻撃・反撃・迎撃・自動鎮圧を行った場合は最大HPの5%、移動のみ・待機・移動後待機・未行動なら10%、補給圏外は0%。航空中ヘリと搭乗中Unitは回復しない。各Unit個別に切り上げ、HP上限を超えない。移動だけでは休養回復を妨げず、判定時点の補給・状態を使う。Zombieは回復しない。

## 8.7 追加編成

- Police／Riot Policeは州都・地方都市、Soldierは州都・Army Base・Air Base、Recon／Field ArtilleryはArmy Base、Multipurpose HelicopterはAir Baseで予約できる。Special Forcesは確保報酬専用で生産できない。拠点は安全で操作可能でなければならない。
- 編成拠点は予約時に補給圏内でなければならない。予約後の補給切断だけでは取り消さない。基地の給電・感染・稼働条件と配置先が未充足なら支払い済み予約を保持して待つ。
- 条件が揃えば次の自ターン開始時に完成し、そのターンからType・状態に応じた行動が可能となる。
- 完成拠点が埋まっていれば最寄り空きヘックスへ置き、同距離はSeed付き乱数で決める。
- 人口はターン開始時の供給順位で都市から徴用する。
- 最後の健全民間人口を使う編成は拒否する。
- 編成コストはPoliceが人口5・民需品10・軍需品10、Soldierが人口10・民需品20・軍需品25、Riot Policeが人口10・民需品25・軍需品25、Reconが人口5・民需品20・軍需品25。砲兵は人口5・民需品100・軍需品200・Fuel100、ヘリは人口2・民需品100・軍需品140・Fuel500。砲兵の生涯上限2、ヘリの生涯上限1は予約を含む。
- 通常歩兵の完成Unitは`currentFuel = 0`で生成し、直後にState Fuelから同時完成UnitのID昇順1 Fuel単位Round Robinで有償補給する。不足時は部分補給とし、そのPlayer Turnから保有Fuelで支払えるMoveを実行できる。
- 砲兵・ヘリは予約時にFuelを支払い、完成時に最大Fuelで生成する。砲兵は収納、ヘリは着陸状態。基地予約の給電待ち・陥落没収は18.14／18.15に従う。
- 完成UnitはConfig指定熟練度（標準Recruit）で、編成Cost以外に国家備蓄を消費せず、`currentMilitaryGoods = maxMilitaryGoods`の満載で生成する。

## 8.8 全Zombieの足止め・隣接攻撃

- Zombieは、自身が攻撃できる生存Player Unitへ初めて隣接したHexで移動を終える。開始時から隣接なら移動0。地上部隊のCharge・携行軍需・迎撃可否には依存しない。搭乗中Unitは対象外。航空中ヘリによる足止め・攻撃対象化はHunter／Packだけに適用し、同一Hexも航空攻撃の対象になる。
- 先に移動Human Unitの既存迎撃とZombie反撃、次に可能なArmy Base迎撃を処理する。直接効果と連鎖後もZombieが生存し、攻撃Chargeと条件を満たせば隣接Player Unitへ通常攻撃する。複数候補は人数最大、同数はUnit ID安定順を正規化したSeed付き抽選で決める。攻撃後は再移動しない。
- Army Base自体は足止め源ではない。実迎撃が距離1..2で発生した場合だけそのZombieを止める。迎撃、反撃、死亡、Gas連鎖で候補が変わるたびに生存・射程・合法性を再評価する。

## 8.9 Gas Zombie

- Gas ZombieはNormal AIで、`visible population > inherited Horde target > noise target > idle`の優先順に行動する。標準初期配置はGas4・通常40・Hunter4・Screamer2の計50体。Gasは全Waveの抽選対象である。
- 非Horde Slotの重みは全Wave共通で通常40／Police10／Soldier10／Riot5／Hunter15／Gas15／Screamer5。通常抽選をRoster確定時にHordeへ変換する。Riotだけ1方向・1 Wave最大1体、Hunter／Gasの上限はない。Rejected Bonusも同じ表を使い、Riot上限をBaseと共有する。Packは通常抽選表へ含めない。
- Gasは死亡原因を問わず1回だけ死亡Hexの隣接6 Hexへ爆発する。中心と距離2以上は対象外。地上Humanへ30、Zombieへ15の基礎Damageを与え、UrbanのGround UnitまたはForestのZombieは半減する。航空中ヘリと搭乗中Unitは対象外。Facility／Checkpointの健常者へ`min(30, healthyPopulation)`の感染変換を与え、City住民・Worker・Checkpointの`waiting → screening → approved`を対象にする。
- 各爆発は対象Snapshotを確定して直接効果を全て適用してから、Unit死亡、Reanimation、拠点陥落・Spawn・即時占有を処理する。死亡GasはUnit ID安定順、爆発キューはFIFOで連鎖させ、同じ爆発で新生した個体をその対象へ加えない。巻き添え撃破はHuman Unitの熟練度Kill Creditへ加えない。

## 8.10 Army Base

- Army BaseはWorker上限10、初期Survivor1..10、感染者0、専用Military Goods40／40の恒久施設。確保後のWorkerは維持費・感染・Zombie人口目標・人口敗北判定に含むが、都市住民・避難民受入・都市間移住先・編成の徴用元ではない。資源生産・Supply Sourceではない。
- Player所有・未陥落のArmy BaseはWorker0でVision1、Worker1..10でVision5。中立・陥落中はPlayer Visionなし。Turn10中までの早期確保報酬は1ゲーム1回のRegular Soldierで、通常確保では健常Survivorの生存を必要とする。人口・資源・電力を消費せずFuel44・軍需40で配置し、配置先がなければ保留する。陥落で報酬権は失効する。
- Army BaseではSoldier／Recon／Field Artilleryを編成できる。安全・操作可能・Supply内で予約し、人口は都市供給順位から徴用、費用は国家備蓄から支払う。専用軍需は編成費に使わない。完成熟練度はRecruit。個別費用とFuelは8.7に従う。
- Army Baseは正常稼働中で予約があるTurnだけWorker0でも電力10を要求する。予約前Forecastへ需要を含め、不足は警告しても予約を拒否しない。未給電では需要を残して電力待ちとし、感染・disabled・recovering中は需要0で予約と支払いを保持する。陥落時は予約を没収し人口・資源を返さない。砲兵の未完成予約は生涯予約枠を解放する。給電順位は10.4に従う。
- 各Zombie Phase開始時、迎撃可能なArmy Baseの健常Worker／Survivor数を迎撃回数にする。未確保でも健常Survivorが残る基地は迎撃できる。距離0..2へAttack10、1射ごとに回数1・専用軍需2を消費しNoise Radius8。距離1..2は1射でZombieを止め、距離0は撃破・弾切れ・残回数0・機能停止まで連射する。Supply・電力は不要でZombieの反撃を発生させない。Air Baseも同じ専用軍需・迎撃を使う。
- Unitへの通常軍需補充を全て終えた後、Player所有・正常稼働・Supply内の基地だけを、国家Military Goods残量から専用軍需40まで補充する。部分補充を許し、Supply外・感染・disabled・recovering・陥落中は補充しない。専用軍需と報酬状態は陥落・復旧を通じて保持する。

---

# 9. 人口移動・都市

## 9.1 原則

すべての民間人口は州都、地方都市、Temporary Housing、生産施設、Army Base／Air Base、検問所、感染施設のいずれかに所在地を持つ。所在地のない「無職者」「未配置人口」は持たない。Army Base／Air Base Workerは専用の施設人口で、都市住民・避難民・移住先・通常編成の供給人口と混同しない。

## 9.2 ターン開始時スナップショット

ターン開始時に、所有中かつ陥落していない州都・地方都市・Temporary Housingについて、供給・受入の安定順と人口操作資格を固定する。

- 供給順位は健常人口降順、同数は`facilityId`昇順とする。Supply外Temporary Housingは人口供給、移住、編成の候補から除く。
- 自動受入は通常CityのSoft Cap空き、Temporary HousingのSoft Cap空きの順で使う。Housingの空きと混雑率には`workers + infected`、通常Cityには既存の在所人数を使う。
- 全候補が定員へ達した後は、超過可能なCapital／通常Cityだけから在所人数／Soft Capが最小の候補を選び、同率はSnapshotの安定順とする。HousingのHard Capは超えない。

同時に、安全かつ前ターン以前に確保・復旧済みかを人口操作資格として固定する。感染都市も順位と資源不足時の損失順には含めるが、供給・受入・移住・編成ではスキップする。ターン途中に順位を再計算せず、途中で感染・陥落した候補は利用不能にする。途中で新規確保・復旧した都市は次ターンまで順位表・候補へ追加しない。

## 9.3 生産施設への配置・撤収

- 安全で操作可能な所有生産施設だけを変更できる。
- 追加人口は補給圏内の施設に限り、供給順位都市から順に差し引く。
- 撤収人口は受入順位都市をソフトキャップまで順に満たす。
- 通常都市の空き、次に仮設住宅の空きを使う。全候補がSoft Cap到達後は総在所人数／Soft Capが最小の候補へ1人ずつ配分し、同率は既存安定順とする。
- 供給不足または安全な帰還先なしの場合はAction全体を拒否する。
- 感染中の施設は追加・撤収とも禁止する。
- 通常の生産施設は補給圏外でも既存労働者の生産と減員・帰還を継続し、自動撤収・人口損失は発生させない。原発の発電はSupply内を必要とし、Housingの人口・給電は10.13の専用条件に従う。
- Army Baseの増員は安全・操作可能・Supply内でのみ都市供給順位から行い、撤収は既存の帰還条件を使う。Supply外であることだけを撤収禁止理由にしない。

## 9.4 都市間移住

- 操作可能な安全都市間で、距離を無視して任意人数を原子的に移動できる。
- 移動元人口を超えず、Playerの人口移送・配置・編成で州都の健常人口を1未満にしない。感染・餓死・砲撃等の損失に対する保護ではない。
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

標準Configの生産・電力値:

| 施設 | Power Mode | Demand | 無給電／OFF | 給電時または通常出力 |
|---|---|---:|---|---|
| 州都・都市 | required | 20 | 民需品0 | SoftCapまで民需品1 / worker |
| 農場 | required | 10 | 食料0 | 食料10 / worker |
| 民需工場 | required | 30 | 民需品0 | 民需品10 / worker |
| 軍需工場 | required | 40 | 軍需品0 | 民需品2を入力して軍需品1 / operating worker |
| 製油所 | required | 20 | 燃料0 | 燃料5 / worker |
| Civilian Drone Base | required | 10 | Vision0 | 航空Vision workers×3 |
| Army Base | conditional | 10 | 予約を保持して電力待ち | 正常稼働中の予約完成に給電が必要 |
| Air Base | required | 10 | 予約を保持して電力待ち | 正常稼働中は予約なしでも需要10 |
| Simple Farm | none | 0 | — | 食料5 / worker |
| Power Plant | none | 0 | — | 燃料2で電力5（物理Capacity15 / worker） |
| Wind Power Plant | none | 0 | — | Electricity15固定 |
| Nuclear Power Plant | none | 0 | — | Supply内でElectricity500 / worker、上限5人、Fuel不要 |
| Oil Field | none | 0 | — | 通常生産なし。確保Allowanceを100 / worker / TurnでFuelへ変換 |
| Temporary Housing | required | 10 | 健常住民がいれば追加維持費 | 資源生産なし |

## 10.2 同ターン生産と備蓄原則

- EndTurn開始時の人口・Unit・Checkpoint健常Queue・過密からFood、Civilian Goods、Unit別Military Goods固定消費を先に固定する。Checkpointの`waiting + screening + approved`を維持人口へ加え、`infected`は除く。Food不足死亡で同ターンのCivilian Goods必要量を減らさない。
- 当ターン生産したFood、Civilian Goods、Military Goodsは同ターンの維持消費へ使用できる。
- 当ターン生産した資源は別工程の生産入力へ使用できない。当ターンRefinery生産Fuelは次ターンから発電へ、当ターン生産Civilian Goodsは次ターンからMilitary Factory入力へ使用できる。
- 同ターンCivilian Goods増産で市民維持用予約が減った場合は、余ったTurn-start Civilian GoodsをMilitary Factory入力へ回せる。Turn-start Civilian Goodsが0なら同ターン増産だけでMilitary Factoryを稼働できない。

## 10.3 電力利用区分

- Required需要はCapital／City20、Farm10、Civilian Factory30、Military Factory40、Refinery20、Civilian Drone Base10、Housing10、Air Base10。Army Baseは正常稼働中の予約だけ10。各施設の必要量を一括給電し、部分給電しない。
- Capital／Cityは健常住民がいるとき自動要求し、停電時は民需品出力だけ停止する。Housingは完成・未陥落なら健常住民0でも要求し、健常住民の有無によって順位を分ける。HousingのSupply切断時はGrid給電なし。
- SetPowerSupplyは既存Farm／Civilian Factory／Military Factory／Refinery／Droneだけ。Housingにtoggleを追加しない。既存の無料・同Turn内繰り返し可能なAction条件を維持する。
- Simple Farm、Power Plant、Wind、原発、Oil Field、CheckpointはPower Mode none。Army Baseの予約条件とSupply喪失後の継続は8.10に従う。

## 10.4 発電、優先順位別割当、Unit補給

- 稼働中Windの固定Electricity15と、Supply内で正常稼働する原発のworkers×500をFuel不要の電力として先に供給する。Power Plantの物理発電Capacityは全所有・非感染・非陥落発電所の`workers × 15`を州全体で合算する。
- Wind・原発で足りない実割当5 ElectricityごとにTurn-start State Fuel 2を消費する。利用可能電力は`operationalWindCapacity + operationalNuclearCapacity + min(powerPlantPhysicalCapacity, floor(turnStartFuel / 2) × 5)`で、余剰CapacityへFuelを消費しない。Fuel 1で部分発電はしない。
- 電力はCapital／City、occupied Housing、Farm／Civilian Factory、入力確保済みMilitary Factory、Refinery、Drone、Army Base予約／Air Base、empty Housingの順で割り当てる。occupiedはworkers > 0であり、infectedだけのHousingはemptyとする。
- 各段階内は確保時期が古い施設、同順位は`facilityId`昇順とする。未給電理由は物理Capacity不足、Turn-start Fuel不足、同段階の順位負け、Power Supply OFF、人口／労働者0または非対象、Military Factory入力なしを区別する。
- Player Phase途中のSupply拡張では当該Turnの既存電力割当を再実行しない。新規Supply内になったRequired施設は次の経済処理まで`power_unavailable`／`not_applicable`を表示し得るため、次Player Turn開始後のForecastで再評価する。
- 複数発電所のCapacityと電力は州全体で共有し、送電線、地域別停電、蓄電、発電所ごとのFuel在庫は扱わない。
- 発電Fuel消費後、施設生産前に残るState Fuelから、判定時点で生存かつSupply内で補給資格のあるHuman Unit（航空中・搭乗中を除く）を補給する。`maxFuel - currentFuel`を需要とし、Unit ID昇順の1 Fuel単位Round Robinで満タンUnitを飛ばして配分する。Supply外Unitは補給しない。
- 当TurnのRefinery生産Fuelは発電にもUnit補給にも使わず、Ending Stockへ加えて次Turnから利用する。ForecastとEndTurnは同じ純粋計算経路を使う。

## 10.5 Civilian Goods予約と経済処理順

Civilian Goodsの市民維持をMilitary Factory入力より優先する。

```text
maintenanceReservation
= max(0, maintenanceRequired - projectedSameTurnCivilianProduction)

productionInputAvailable
= max(0, startingStock - maintenanceReservation)
```

経済処理は、維持需要固定、Wind・原発の無料電力、Power需要・発電Capacity、優先給電、発電Fuel消費、残FuelでのUnit補給、施設生産、生産物追加、Food／Civilian Goods維持消費、Unit携行軍需の固定消費・補充、基地専用軍需補充、自動鎮圧、更新済み衛生ストレス・飢餓累積に基づく死亡処理へ進む。生活環境感染は避難民処理後の感染フェーズで判定する。Civilian Goodsの市民維持予約はMilitary Factory入力より優先する。人口衛生のSnapshot・更新・適用順は18.13.5.8に従い、ForecastとEndTurnは同じ純粋計算経路を使う。

## 10.6 通常消費

- Food／Civilian Goodsは所有施設の健常住民・労働者、全Human Unit人口（航空中・搭乗中を含む）、Checkpointのwaiting／screening／approved健常人口の合計と同数。感染者は対象外。
- Military GoodsはUnit人口比例ではない。全Human UnitをID順に処理し、8.1の固定消費を携行量の範囲で差し引く。Supply外・航空中・搭乗中でも固定消費は行う。その後、Supply内かつ補給資格を持つUnitだけ国家備蓄から最大量まで1単位Round Robinで補充する。
- Unit補充後に、Player所有・正常稼働・Supply内のArmy Base／Air Baseの専用軍需を最大40まで補充する。
- Checkpoint人口は通常維持費に含めるが、都市の過密人数へ加えない。都市ごとの過密追加費と住宅停電追加費は独立加算する。
- Civilian Goodsの工場入力不足は減産理由。維持不足は衛生ストレスへ作用するが、直接死亡へ変換しない。不足死亡はRejected Counterへ加算しない。

## 10.7 過密

Capital／通常Cityごとに計算し、州全体の通常維持費へ倍率を掛けない。Nは健常住民と感染者の合計、CはSoft Cap、Eは超過人口。

```text
都市民需品生産 = min(健常住民, C)（給電・稼働条件を満たす場合）
E = max(0, N - C)
追加Food = ceil(E × 0.5)
追加Civilian Goods = ceil(E × (1 + E / C))
```

- 都市別に切り上げて合計する。Temporary Housingは合計Hard Cap10のため自身の過密なし。
- 軍需品・Fuel・電力へ過密費を課さない。住宅停電費は10.13.7の別計算。
- EndTurn開始時の同一SnapshotをUI予測・実消費に使う。詳細は18.13.6。

## 10.8 不足被害

- Food不足率dから飢餓累積Aを更新する。上限7、充足Turnは0.5回復する。死亡率は`min(0.1, d × max(0, A - 2) × 0.02)`。不足1につき1人死亡する旧処理は使わない。
- 全国の対象健常民間人口と端数持越しから死亡人数を求め、所在Poolへ比例配分する。Checkpoint優先・都市供給順位順の旧損失処理は使わない。端数・対象・同順位の規則は18.13.5。
- Food／Civilian Goods維持不足はそれぞれ衛生ストレスへ蓄積し、施設内新規感染・Checkpoint Riskへ作用する。Civilian Goods不足による直接死亡はない。
- 個別施設が餓死で0人になっても、それだけでは感染陥落しない。所有施設の健全民間人口合計0は敗北となる。
- Military Goods不足は民間人口損失を起こさない。Unitごとの携行量・距離から実効射程と攻撃力を導出する。

## 10.9 Wind Power Plant

### 10.9.1 Player-built Wind

- Wind Power を Constructible に追加する。
- 建設費: Civilian Goods 150
- Generation: 15 固定
- Worker: 0
- 建設条件は Temporary Housing と同じく Plain + Supply + 既存 Constructible 禁止条件。
- 建設 Turn は building で発電・Noiseなし。次 Player Turn Start から Operational。
- Player-built Wind の Build Limit は `2 * roadBranches.length`。現Mapでは8。
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
- Simple Farm: Civilian Goods50、個数上限なし、Worker0..10、Food5/worker、電力不要。Supply喪失・disabled／recovering・感染時消滅の規則は維持する。
- Civilian Drone Base: Civilian Goods 50、最大ceil(roadBranches.length/2)基、Worker0..5、給電10でVision workers×3。空・非感染・非building・Zombie非占有ならSupply外でも撤去可、1 Action、返却25。
- Temporary Housingは10.13、Windは10.9に従う。Wind撤去不可、Simple Farm撤去不可。
- 各上限は建設中・operational・disabled・recovering等の現存建設物を数え、初期Windを建設Wind上限へ含めない。

## 10.11 Strategic Forecast

- CoreはFood、Civilian Goods、Military Goods、Fuel、Electricityごとに、現在不足、寄与Facility、最大寄与Facility、最大寄与量、その1施設を仮想喪失した場合の不足量とSingle Point of Failureを純粋計算する。
- 現在の公開状態のままEndTurnしたとき、確定的な飢餓死亡で所有施設の健全民間人口0になる場合はGuaranteed Defeatを返す。Civilian Goods不足を直接死亡へ換算しない。Zombie行動、潜伏・衛生感染の乱数、避難民乱数、将来Horde接触を確定結果へ含めない。
- CheckpointのBuild／Relocate／Activate候補は現在・予測支線半径、新規Supply／Supply喪失Hex数とFacility ID、Facility差分、新規Constructible建設可能Hex数を同じCore Validationから返す。Visible Zombieだけを阻害へ使う。
- Checkpoint Queue Pressureは`waiting + screening + approved`を人数、screening capacity 20を容量とし、0は`none`、1..20は`low`、21..40は`medium`、41以上は`high`とする。将来到着・潜伏感染の乱数は公開しない。
- Forecastと候補QueryはState、Resource、Action回数、PRNGを変更せず、UI、Observation、Balanced Agentが同じ結果を使う。


### 資源持続見込み

Strategic Forecastの各資源runwayは現在備蓄、現在生産、最大寄与施設の生産、同施設喪失時生産、需要内訳、netBurn、最初に不足する相対Turnを公開する。現状継続と単一最大寄与施設喪失の仮定を分け、static_current_conditionsを明示する。Food等の生産/維持順序、民需品の生産入力予約、Fuelの当Turn生産先取り禁止、Army Base軍需補充要求を既存EndTurn処理と揃える。Military Goodsの国家runwayはSupply内Unitと補充対象Army Baseだけを需要へ含め、Supply外Unitの不足は`military_goods_supply_disconnected`で分離する。Civilian GoodsのMilitary Factory入力不足だけを市民維持不足としてcriticalにしない。使い切って不足しなかったTurnを不足Turnと数えない。Electricityは非貯蔵、減耗なし、入力依存で推定不能の場合はnullと理由を返す。これは将来の敵行動や複数施設連鎖の保証ではない。resource_runway_riskは次EndTurn不足をcritical、2～3Turnをwarningにし、同じ資源のGuaranteed Defeatと重複させない。

## 10.12 AI向けProduction Capacity

- `strategicForecast.productionCapacity`をAI Observation、Session Compact要約と詳細Queryへ公開し、人間HUDには新しい余力表示を追加しない。現在生産は実処理と同じ経済計画から取得する。
- Session Compactは資源ごとに`projectedEndTurnOutput`、`ratedUpperBoundAtCurrentCityPopulation`、`ratedGapUpperBound`、`utilizationRatio`、`blockingReasonCounts`を、対象Turn、人口基準、上限の同時達成可否、理由の重複、再配置最大量が未計算であること、利用可能人口・残Actionの前提とともに返す。電力は利用可能量、需要、実割当、未割当利用可能量、貯蔵不可、Fuel基準を要約する。設備別内訳、中間段階値、都市Soft Cap詳細は`query forecast`で取得する。
- 食料・民需品・軍需品・燃料について、実行予測生産、所有完成設備の定格上限、現都市健全人口（Soft Capまで）による生産、現配置労働者の定格、現計画の電力反映前生産、定格差分、稼働率を分離する。都市Soft Capまでの人口不足も施設詳細へ公開する。定格0の稼働率はnullと`no_rated_capacity`を返す。
- 設備上限は感染・停止・復旧中の所有完成施設も含み、未確保・建設中・破壊済みを除く。労働者不足、感染、復旧、電力、入力資源不足等の理由は重複可能として公開する。理由数や資源別上限は加算して同時達成可能量と解釈しない。
- 電力は定格、現労働者能力、現計画の物理能力、実供給可能量、需要、割当、未割当を分離する。貯蔵不可、発電Fuelはターン開始備蓄に基づくことを明示する。再配置後の実現可能余力は探索せず`feasibleHeadroom: not_computed`とし、現在の配置可能都市人口・残Action・前提を併記する。

## 10.13 Temporary Housing

### 10.13.1 基本

- 新 Constructible Facility `temporaryHousing` を追加する。
- 建設費: Civilian Goods 50
- 電力需要: 10
- Hard Capacity: 10（健康住民＋感染者）
- 建設上限: なし
- Resource output: なし。正常稼働・Supply・給電・感染状態にかかわらず、Temporary Housing自体はFood／Civilian Goodsを生産せず、健常住民は通常維持費を完全に負担する。
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
- その後 Temporary Housing の Hard Capacity 空きを使用する。
- Temporary Housing の受入余力判定では `workers + infected` を使う。
- 通常CityがSoft Capacityへ達した後も受入を継続できるが、HousingのHard Capacityは超過しない。
- 超過分はeligibleなCapital／通常Cityだけへ、受入混雑率が最も低い順で配分する。同率時は既存stable order。通常Cityが使えずHousingの余力も不足する場合、approvedはQueueに留まる。
- Capital／通常CityのOvercrowding Penaltyは健常住民と感染者の合計から計算する。Housing自身は合計Hard Capを守り、過密費を発生させない。
- 感染者が多い Housing を自動受入先として優先しない。

### 10.13.5 Population transfer

- 手動人口移送は健常住民 `workers` のみ。
- 感染者の施設間移送機能は追加しない。
- Temporary Housingへの手動移送は `workers + infected + people <= 10` の場合だけ合法。超過は `population_capacity_exceeded` で状態不変の拒否。
- 満員Housingを受入候補から外す。Worker帰還・自動受入・候補Query・Forecastも同じ残容量を使い、帰還先不足時は移動元を減らさず操作全体を拒否する。

### 10.13.6 Supply disconnect

- 建設には Supply が必要だが、建設後に Supply Network から切断されても Facility・既存住民・Hard Capacity は維持する。
- Supply 外では次を停止する。
  - 新規 Refugee 自動受入
  - Supply population pool 参加
  - 他 City との population transfer 元 / 先
  - Recruitment 用 population contribution
- Supply 復旧後に再参加する。
- Supply 外でも Vision 1、Hard Cap、healthy civilian defeat count、Zombie Target eligibility は維持する。

### 10.13.7 Power allocation / outage penalty

Power allocation priority は次のとおり。

1. Capital / normal City
2. occupied Temporary Housing
3. 既存 production / normal-demand tiers（Farm / Civilian Factory -> Military Factory -> Refinery -> Drone -> Army Base reservation / Air Base の現行順）
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
- 住宅停電費は通常maintenance、都市過密費は都市別の超過人数を基礎に計算し、相互に複利計算しない。

### 10.13.8 Turn snapshot

- EndTurn 中の Power Allocation は EndTurn 開始時 snapshot で固定する。
- EndTurn 途中の Refugee reception により empty -> occupied へ変化しても、その EndTurn 中は Power tier を再配分しない。
- 次 Player Turn から occupied tier として扱う。

### 10.13.9 Overcrowding

- 健康住民と感染者の合計Hard Capは10。Housing自身から過密・`overcrowding_forecast`は発生しない。
- Capital／通常CityのSoft Capと過密Penalty、Housingのoccupied outage penaltyは維持する。

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

Temporary Housingは資源を生産しない。健常住民1人につきFood 1、Civilian Goods 1の通常維持費を完全に負担し、給電順位、過密、occupied停電／Supply切断による追加維持費は別計算で維持する。

公開統計は `housingBuilt`、`housingResidentTurns`（健常住民の累積人ターン）、`housingCivilianGoodsProduced`、`housingOutageFacilityTurns`（棟ターン）。Metricsの `housingResidentsFinal` は終局時点の健常住民数であり、累積値と区別する。

## 10.14 次ターン過密・住宅停電予測

### 10.14.1 目的

Human / AI の両方へ、次 Turn に確定的に発生する Overcrowding と Temporary Housing outage penalty を事前通知する。

### 10.14.2 予測対象

- 未来 RNG は予測・推測しない。
- deterministic な人口移動・既に結果が確定した Screening outcome 等だけを予測に含める。
- 建設中 Temporary Housing が次 Player Turn Start に確実に Operational 化する場合、その +10 Hard Capacity を予測へ含める。
- 建設中 Wind が次 Player Turn Start に確実に Operational 化する場合、その +15 Generation を予測へ含める。
- 建設中 Housing の +10 Power Demand 等、確定済み build completion を含めて次 Turn Power Allocation を再計算する。

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

- Overcrowding例: Soft Cap100に108人ならFood +4 / Civilian Goods +9
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
- 地上移動はEmergency Movementでも進入MP5を必要とする。歩兵Fuelは実移動Hex数、収納砲兵は消費MP×10を使う。航空中ヘリは有刺鉄線を無視して1 MPで通過する。
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

## 10.16 初回確保報酬・Oil Field・Refinery Allowance

- 中立恒久施設の初回確保時だけ、施設状態の`firstCaptureRewardClaimed`を台帳として即時報酬を付与する。CityはFood 100＋Civilian Goods 100＋Fuel 100、Civilian FactoryはCivilian Goods 100、Military FactoryはMilitary Goods 100、Army Base／Air BaseはFood 100＋Military Goods 100、FarmはFood 100＋Fuel 100を与える。Army BaseをTurn 10までに確保した場合は既存のSoldier 1部隊報酬も累積する。Oil Field、原発、Simple Farm、Wind Power Plant、Drone Base、Refinery、Power Plant、Checkpointはこの資源報酬の対象外で、Supply外確保、再確保、復旧、再建、Save／Loadによって重複しない。
- 全国共有の累積Refinery Allowanceは2,000から始まり、稼働中Oil Fieldの健全Worker 1人につき同じEndTurnに100を恒久加算する。Oil FieldはWorker上限5、Power Mode none、入出力資源なし、Fuel消費なしであり、住宅・編成元・Supply Source・Zombie Target Valueにはしない。
- Refineryは全国共有Allowanceを1消費してFuel 1を生産し、施設ID安定順で割り当てる。Oil Fieldの同Turn creditは直後のRefineryが利用できるが、そのTurn前段の発電Fuelへ遡及しない。Allowanceが0ならRefineryは電力を要求せず生産しない。確保、陥落、復旧、Save／LoadでAllowanceをリセットしない。
- Temporary Housingは通常人口維持費を相殺しない。健全民間人1人につきFood 1、Civilian Goods 1の通常維持費を完全に負担し、既存の過密Penaltyと停電Penaltyは別計算で加算する。
- Player建設Wind Power Plantの上限は道路支線数の2倍、標準Mapでは8基とする。初期配置Windはこの建設上限に数えない。
- Crisis SummaryはSupply内Unitの国家Military Goods不足とSupply外Unitの補給切断を別reasonとして扱い、Supply外需要を国家不足根拠へ含めない。確保済みworker型生産施設のWorker 0、Allowance切れRefinery、creditを増やせないOil Fieldも別reasonで公開する。WindはWorker 0警告対象外とする。
- `resourceShortageLossesTotal`は全経済フェーズ累積、`finalEconomyResourceShortageLosses`は直近経済フェーズ分、`enemyKillsTotal`は全Zombie Type撃破合計とする。通常終了画面、Agent結果、Artifact、Save／Replayで共有する。

# 11. 感染・陥落・復旧

## 11.1 通常施設

ゾンビが施設タイル上でゾンビターンを終了した場合:

```text
newInfected = min(zombieAttack, healthyPopulation)
healthyPopulation -= newInfected
infected += newInfected
```

封じ込めがない施設では、猶予中を除く伝播可能感染者が残る場合に次を行う。衛生由来等の新規感染猶予は18.13.5.7に従う。

```text
spread = min(伝播可能感染者数, healthyPopulation)
healthyPopulation -= spread
infected += spread
```

## 11.2 鎮圧

- 封じ込め資格のある地上Human Unitが駐留すると既存感染の伝播を止める。砲兵・ヘリ・搭乗中Unitは封じ込め・自動鎮圧不可。衛生環境由来の新規感染抽選は既存感染の伝播と区別する（18.13.5）。
- EndTurn時、残Attack Charge数だけUnit ID順に自動鎮圧を判定する。通常攻撃・反撃・迎撃に使ったChargeは鎮圧へ使えず、Waitまたは移動だけなら残Chargeを使える。通常Veteranは最大2回、Special Forcesは残Chargeに応じ最大3回／Veteran4回鎮圧する。
- Police／Riot Policeは熟練度込みAttack相当を減らし、民間人被害0とする。Soldier／Recon／Special Forcesは同じくAttack相当を減らす一方、各回`ceil(Attack × 0.5)`の民間人被害を出す。
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

恒久施設の感染者が0・ruinedで、確保・復旧資格を持つ生存地上Humanが同Hexに駐留し、Enemyが同HexにいなければPlayer所有・人口0で再確保する。進入完了時に加え、既に駐留している場合も自動鎮圧と内部感染処理の再評価で判定する。感染者0の再確保にCharge・軍需品は不要。残感染者には通常鎮圧を必要とする。人口操作・編成は次Player Turnからとし、電力・人口などの生産再開条件は別に評価する。建設施設は消滅後に復旧せず、Wind・Army Baseの専用停止／予約／報酬規則と終局判定を維持する。検問所は既存の所有・方針・Role規則を維持する。公開recoveryは同じCore条件から生成する。

## 11.5 Army Base／Air Baseの感染・停止・復旧

- 基地Hexへ到達し、基地迎撃後も生存したZombieは`min(zombie.attack, healthyWorkers)`をWorkerから感染者へ変換する。隣接Gas爆発の感染も同じWorker Poolへ直接適用し、Worker Capacityを超える架空の人口は作らない。
- 健常Workerが0になれば通常の感染者5人ごとのNormal Zombie SpawnとFIFO占有を使って陥落する。基地は恒久施設として残り、専用軍需と報酬取得状態を保持し、未完成の基地編成予約は没収する。砲兵・ヘリの未完成予約は生涯予約枠を解放する。
- 健常Worker・感染者とも0の基地をZombieが占有すれば`disabled`にする。感染者を生成せず、陥落ではないので予約は保留する。Zombie排除、感染者0、Human Unitの再確保を経て`recovering`となり、次Player TurnからWorker 0の`operational`へ戻る。
- 感染、disabled、recovering、陥落中は基地迎撃と専用軍需補充を止める。Player所有・未陥落のVision、早期確保報酬、予約の保存条件は各機能の規則を維持する。

---

# 12. Checkpoint Fallback Network・避難民

## 12.1 Road BranchとPost Role

- 固定マップは州都の共有交差点から外側へ延びる東西南北の4支線を持つ。各支線は独立した次回到着予定（間隔2～4ターン、1回10～20人）を持ち、到着後に同じ支線の次予定をSeed付きで抽選する。到着人数は端点と奇数を含む整数を直接抽選し、旧値の倍化で得ない。新設、移設、Role変更、荒廃、復旧で到着予定を再抽選しない。Final roster freeze後は自然到着を終了し、`nextArrivalTurn`は`null`となり、次予定を抽選しない。
- Checkpointの物理`status`は`operational`、`remnant`、`ruined`、`abandoned`を維持する。行政Roleの正本は`RoadBranchState.activeCheckpointId`と重複しない`standbyCheckpointIds`であり、`CheckpointState`へ可変Roleを保存しない。
- `operational`でActiveでもStandbyでもない同支線PostはDormantである。Observation、UI、EventはCore共通導出関数から`active`、`standby`、`dormant`、`remnant`、`ruined`、`abandoned`を表示する。
- 各支線はActive最大1、Active＋Standby最大5とする。Configは`checkpoint.maxPreparedPostsPerDirection = 5`である。Dormant、Remnant、Ruined、Abandonedは上限を消費しないが、物理地点として残り同じHexへの建設を妨げる。Standby専用維持費はない。上限到達時のStandby新設は`checkpoint_prepared_post_limit_reached`で拒否し、自動撤去・自動降格・`DecommissionCheckpoint`は導入しない。


- 初期CheckpointはNorth `checkpoint-1 (25,20)`、East `checkpoint-2 (30,25)`、South `checkpoint-3 (25,30)`、West `checkpoint-4 (20,25)`の4基。各支線のActiveとしてoperational、Normal、全Queue／感染者0で開始する。初期Supply半径は5のままで、後続IDは5からとする。初回到着から通常の到着間隔・人数を適用し、序盤の免除は設けない。

## 12.2 Active・Standby・Dormantの機能

- Activeだけが新規Refugee Arrivalを受け、Screening Queueを開始し、支線Policyを適用し、Supply FrontとCheckpoint Visionを提供する。
- StandbyはoperationalでAutomatic Fallbackの第一候補だが、新規到着、Screening開始、Supply、Visionを提供しない。
- DormantはoperationalだがActive／Standby上限外のPostであり、新規到着、Screening、Supply、Visionを提供しない。FallbackではStandbyがない場合だけ第二候補であり、Playerは手動でActive化できる。
- 現在Activeに属する既存Screening QueueとRemnantは通常どおり処理を続ける。Standby／Dormantは新規Queueを開始しない。

## 12.3 道路自然流入、方針、配置、潜伏感染

- Final roster freeze前、Activeがあればwaitingへ受け入れ、Activeがなければ素通りとして同じ避難民フェーズで配置・潜伏感染を処理する。未管理道路に不可視の人口プールは作らず、安全な受入都市がない回は州内へ入れず繰り越さない。Final freeze後は新規到着を止め、既存Queueの処理を続ける。
- Active／Remnantはwaiting・screening・approvedを持つ。通常審査のBatch Capacityは20。超過waitingは切り捨てず次Batchを待つ。開始時Policyを固定し、方針変更は次Batchへ適用する。

| 方針 | 審査Turn | 合格率 | 受入者1人ごとの潜伏感染率 |
|---|---:|---:|---|
| 素通り | 0 | 100% | 基礎25%、混雑・衛生補正後最大60% |
| 通常 | 2 | 100% | 5% |
| 厳格 | 5 | 100% | 0% |
| 拒否（deny） | 0 | 0% | 新規受入なし |

- 配置先は通常CityのSoft Cap空き、Housingの合計Hard Cap10までの空き、通常Cityの最小混雑率の順。安全な配置先がなければapprovedとして待機・維持し、次Player Turn Startに再試行する。HousingのHard Capは超えない。
- 潜伏感染は実際の受入先ごとの受入人数nと確率pで`Binomial(n,p)`を抽選し、その受入者だけを感染者へ変換する。別施設の既存住民へ無関係な感染を転送しない。配置待ちは当該approved Batch内で判定・保持する。waiting感染は過密と衛生ストレスによる別の1人ごとの抽選で、screening／approvedをwaiting人数へ含めない（18.13.4）。
- Policyの正本は支線の`currentPolicy`、初期値normal。`SetCheckpointPolicy`はbranchIdを受け、Activeがある支線だけ変更可能。Role変更・復旧で初期化しない。deny以前に始まった審査・approvedはgrandfatheredとして保持する。

## 12.4 Supply Sector

- Checkpointに関係なく、州都からHex Distance 5以内を全方向の初期Supply圏とする。各Tileは最も近い幹線道路支線のSectorとし、2本以上が同距離ならすべての同距離Sectorに含める。
- 州都からActiveまでの距離を`R`とし、その支線SectorのSupply半径を`max(5, R)`とする。共有境界はいずれか1つの有効Sectorで満たせばSupply内である。Standby／Dormant／Remnant／Ruined／AbandonedはSupplyを提供しない。
- ActiveのBuild、Relocate、Activate、Automatic Fallback、Recoveryの直後にSupplyを再計算する。Fallback A→BではB基準へ即時後退し、A-B間の前方施設はOut of Supplyになり得るが、Bより州都側のSupplyを無条件に失わない。
- Supply圏外では労働者増員、Unit補給・自然回復、新規編成予約を禁止する。確保・復旧、通常施設の既存生産、減員・帰還、Unit行動はSupply切断だけでは禁止しない。原発発電、Housingの人口・給電、軍用ドローンは専用のSupply条件に従う。航空中・搭乗中の補給・回復禁止はSupply内でも適用する。

## 12.5 Build・Relocate・Activate

- `BuildCheckpoint`は対象支線の空き幹線道路Tileで即時完成し、支線ごとのCheckpoint操作1回と全体Action 1回を消費する。すべてのBuildは民需品25を消費する。初回割引はない。初期配置の4基はBuildではなく、資源・Action・建設統計を消費しない。施設、既存Post、州都交差点、Player Unit駐留Tile、Horde Entranceを含むSpawn Reserveには設置できない。Facilityは恒久／Constructible、所有者、状態を問わずCheckpointと同一Hexを使用できない。
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
- Ruined Postは感染者0、同Hexに復旧資格を持つ生存地上Humanが駐留し、同HexにZombieがいない場合にoperationalへRecoveryする。隣接Zombieだけでは復旧を阻害しない。砲兵・ヘリ・搭乗中Unitでは復旧できない。支線にActiveがない場合だけRecovered PostをActiveにし、別Activeがあり上限に空きがあればStandby、なければDormantにする。Recoveryは既存Activeを奪わずSupplyを自動前進させない。前線側のReserveを再びFrontにするにはPlayerが明示的にActivateする。
- ZombieがPost Tile上でTurnを終えた場合は襲撃感染を行う。襲撃と内部感染は`waiting → screening → approved`の順に健常者を感染者へ変換し、3Pool合計0かつ感染者1人以上でOverrunする。空のActive TileへZombieが到達した場合も荒廃し、Active失陥なら即時Fallbackを試みる。感染したRuined／Abandoned地点は同距離・外側への再前進を阻害し、感染者0でAbandoned Postは除去できる。

## 12.7 Turn AwayとRejected Counter

- TurnAwayはactive/remnantのwaitingのみ、1以上の整数、1 Player Action。screening／approved／infectedは対象外、資源・PRNGを消費しない。

### 12.7.1 Counter

- Turn Awayとdenyによる拒否をDirection別Rejected Counterへ加算する。通常／厳格審査は合格率100%のため新たな不合格者を生成しない。保存上のCounter構造と旧Field名は維持する。
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
- Riotの最大1体だけをBase／BonusでDirection単位に共有し、Baseが先に上限を消費する。Hunter／Gasの上限はない。通常Zombie抽選はRoster確定時にHordeへ変換する。
- 複数 Direction 同時 Wave では現行の固定 Direction order を維持し、各 Direction について `Base draw -> Bonus draw -> roster freeze` を完了する。
- 公開はWave開始後の基礎人数・Bonus込み確定人数・出現済み・Pending、Direction／Group／kind。Rejected Counter生値、拒絶人数の由来、正確なType内訳、Hidden位置は非公開。

# 13. ゾンビAI・Horde

## 13.1 ゾンビAI

Zombie陣営は`zombie`、`hordeZombie`、`policeZombie`、`soldierZombie`、`riotZombie`、`hunterZombie`、`gasZombie`、`screamerZombie`、`packZombie`の9種からなる。Combat、感染、占有、不変条件は共通で、Horde／Final Horde帰属はWaveのHorde Zombieと非Horde Slot由来の全特殊Typeへ持たせる。初期配置、Human Unit死亡、Noise再Spawn由来個体は`spawnGroupId`と`hordeKind`を`null`にする。

- Zombie自身のVision内にあり経路を持つ、施設健常人口、検問所の健常3プール、Human Unit人口をPopulation Target候補とする。感染者だけ、人口0、死亡Unit、搭乗中Unitは候補外とする。航空中ヘリはHunter／Packだけが目標・攻撃対象にできる。
- 候補は重み付き最短経路Cost、健常人口の多さ、Seed付き乱数の順で選ぶ。
- Zombie Phase開始時のSnapshotで全Horde Zombie、次にNormal AI系Zombieを確定してから、Unit ID安定順で移動・戦闘を解決する。
- `zombie`、`policeZombie`、`soldierZombie`、`riotZombie`、`hunterZombie`、`gasZombie`、`screamerZombie`、`packZombie`は`Visible Population Target > wave_capital／継承Horde Target > Noise Target > Idle`の順に行動Targetを決める。いずれもなければ移動しない。Horde ZombieはVisible Population、Capitalの順を維持し、Noise Targetを持たない。
- 継承はHordeのSnapshot上のTarget Hex座標で、Hordeを見失っても保持する。Visible Populationを一時優先しても記憶を保持し、座標到達時に有効Targetがなければ解除する。
- Normal AI系Zombieに継承TargetがなくVision内にHorde Zombieがいる場合だけ`hordeZombie -> zombie | policeZombie | soldierZombie | riotZombie | hunterZombie | gasZombie | screamerZombie | packZombie`へTargetを伝播する。継承した場合はNoise Targetを破棄する。Normal AI系Zombie間、通常からHordeへの伝播は禁止する。
- 複数Horde候補はHex Distance、同距離ならUnit ID昇順で選ぶ。
- Visible Populationを発見したNormal AI系ZombieはNoise Targetを破棄し、そのPopulationを見失っても旧Noise地点へ再開しない。Horde ZombieはVisible TargetをVision外まで記憶しない。Scheduled Wave由来Normal／特殊Zombieも独立したwave_capital Anchorを保持する。
- Player Unitが参加する通常Combatの開始時、Human UnitがいるHexをCenterとしてNoise Pulseを1回発生させる。Player Attack、Zombie／Horde Attack、Interception、同Combat内のCounterattackが対象で、Counterattackによる二重Pulseは発生させない。Moveのみ、Wait、感染鎮圧、Resource Shortage、Infection Spread、Facility Overrun自体は発生させない。RadiusはPolice 4、Soldier 8、Riot Police 5である。
- Horde Zombieが実際に1 Hex以上移動したとき、移動終了HexをCenterとして毎回Radius 8のHorde Movement Noise Pulseを発生させる。停止、移動0、Spawn直後は発生させない。Horde自身はこのPulseに反応しない。
- PulseはTerrain等で減衰せず`pendingNoisePulses`へ積み、次Zombie Phase開始時にまとめて評価する。Windだけは同EndTurnのTarget Snapshot直前に発生させ、そのSnapshotに反映する。Normal AI系Zombieは全pending PulseのうちHex Distanceが最短のCenterを選び、同距離は安定順へ正規化後にSeed付きRNGで選ぶ。現在Noise Targetと同距離なら現在Targetを保持する。Visible Population／Horde継承は常に優先する。
- 各Pulse直後、範囲内にある感染者5人以上の陥落済み恒久FacilityとRuined／Remnant CheckpointをID昇順（同一IDはFacility優先）で11.3と同じ隣接Spawnへ即時反応させる。成功1体につき感染者5人を減らし、残れば後のPulseで再試行できる。生成Unitには即時占有とFIFO連鎖を適用する。
- 公開Noise EventはNoise Classと公開可能な発生元Typeを基本とし、自軍のsource Unit IDなど公開済み情報を保持できる。非可視のEnemy ID・位置、反応個体／数、内部Targetを公開しない。静的なNoise Ruleの公開値と、実際のPulse内部情報を区別する。

## 13.2 特殊ZombieとReanimation

- Police ZombieはHP 10／Move 3、Soldier ZombieはHP 20／Move 5、Riot ZombieはHP 60／Move 3、Hunter ZombieはHP 20／Attack 15／Move 15、Gas ZombieはHP 35／Attack 5／Move 3／Vision 3とし、全てRange 1、最大Attack Charge 1のNormal AI系である。Wave Slot由来ならScheduled／Final Horde個体として扱い、Supply内Zombie clearへ含める。HunterのMove 15もTerrain重み付き移動力であり、地形を無視しない。
- Police Unit死亡時はPolice Zombie、SoldierはSoldier Zombie、Riot PoliceはRiot Zombie、Recon／砲兵はSoldier Zombie、Special ForcesはPack Zombieを生成する。ヘリ自身はReanimationしない。輸送部隊の死亡と配置先・水域例外は18.15.11.5に従う。Hunter ZombieとGas ZombieはHuman Unit死亡時のReanimationでは生成しない。生成Zombieは死亡Unitの熟練度、Charge、Fuel、Military Goods、HP、Targetを継承せず、残Fuel／軍需品をState備蓄へ返却しない。
- 生成直後は同じPhaseに通常Move、Attack、Targetingをせず、死亡HexがFacility／Checkpointなら即時占有・感染を1回解決する。陥落した場合は通常の感染者SpawnとUnit ID順FIFO連鎖を解決し、次回Zombie PhaseからNormal AI系として行動する。

## 13.3 Horde

標準Scheduleは次のとおり。Hは固定Horde数、Sは非Horde抽選Slot数で、抽選結果の通常ZombieをHordeへ変換するため最終Type内訳とは異なる。

| Turn | 方向数 | H / 方向 | S / 方向 | 基礎総数 |
| --- | ---: | ---: | ---: | ---: |
| 10 | 1 | 5 | 4 | 9 |
| 20 | 2 | 3 | 6 | 18 |
| 35 | 1 | 8 | 9 | 17 |
| 50 | 3 | 5 | 9 | 42 |
| 70（Final） | 4 | 8 | 10 | 72 |

- 基礎Schedule合計はH66・抽選Slot92・158体。Finalの基礎72体に、別枠のPack1体とRejected Bonusを加えてRosterを確定する。
- Warning Lead2。North／East／South／Westの安定順を使い、4方向以外のWarning方向だけSeed付きで抽選する。
- Base抽選の後にBonusを同じ表で抽選する。Horde Charge4、Pack5、その他Enemy1。SpawnしたTurnには通常行動せず、次Zombie Phaseから行動する。

### 13.3.1 Horde Spawn Reserve

- 51x51 Map の外周 2 rows / columns を Horde Spawn Reserve とする。
- Reserve は Player Unit の進入・建設を禁止する。
- 2列 Reserve 全体を Scheduled Horde 専用にはしない。Initial Zombie、facility fall、Noise Respawn 等は各既存 Spawn rule を維持し、合法なら Reserve 上へ Spawn し得る。
- このReserveとDirection Spawn Zoneを含むMap IDは`fixed-51x51-v9`とする。

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
- `committedWaveUnitCount`: Rejected BonusとFinal別枠Packを含む確定roster総数
- `spawnedSoFar`
- `pendingCount`
- direction
- group ID / kind（公開上必要な識別子）

例: Final基礎72 + 別枠Pack1 + Rejected Bonus15なら、`baseWaveUnitCount=72`, `committedWaveUnitCount=88`。正確な特殊Type内訳は非公開。

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
  軍用ドローン失効・再アニメーションPending・Air Base／原発Objectiveの期限と保留配置
  次Wave Warning開始時に全方向を抽選・公開（4方向Waveは抽選なし）
  Army Base早期確保報酬の保留配置
  熟練度昇格判定・Veteran昇格待ち確定
  支線操作回数の初期化、新規確保・復旧・建設施設の操作解禁、Recovery完了
  自然回復
  Type・状態に従うHumanの行動権回復、全UnitのAttack Charge補充（Horde4・Pack5を含む）
  条件を満たす予約ユニット完成・通常歩兵の有償commissioning Fuel補給・携行軍需満載
  都市供給・受入順位スナップショット作成
  配置待ち合格者の自動配置
  敗北条件確認
        ↓
PLAYER / DOMESTIC ACTION
  移動・迎撃・攻撃・待機・施設確保、砲兵Mode変更・砲撃、離着陸・搭乗・降機・軍用ドローン
  労働者配置・撤収・都市間移住
  Power Supply ON/OFF
  支線Policy・Checkpoint新設／移設／Active化・Turn Away
  Constructible Facility建設／Drone Base撤去・ユニット編成予約
        ↓
END TURN VALIDATION
  資源・電力・過密予測と警告
        ↓
AIRBORNE END TURN
  航空中ヘリのNoise15 → 固定Fuel1消費 → 枯渇時の緊急着陸
        ↓
ECONOMY
  EndTurn開始時の通常維持需要、都市別超過人数からの過密費、通常維持費からの住宅停電費を独立計算
  Turn-start Fuel、Wind・原発供給、物理発電Capacityを決定
  Capital／City → occupied Housing → Farm／Civilian Factory → 入力確保済みMilitary Factory
    → Refinery → Civilian Drone Base → Army Base編成予約／Air Base → empty Housingへ給電
  Civilian Goods維持予約・Military Factory入力配分と不足予測 → 衛生ストレス・飢餓累積更新
  Wind・原発不足分の実割当だけ発電Fuel消費
  残FuelからSupply内Human UnitをID順Round Robin補給
  生産物追加（Refinery Fuelは次Turnから利用）
  Food → Civilian Goods維持消費
  Unit ID順の携行Military Goods固定消費 → 国家備蓄からRound Robin補充 → Army Base専用軍需補充
  携行軍需を使う自動鎮圧
  更新済みの衛生ストレス・飢餓累積に基づく飢餓死亡 → 敗北確認
        ↓
REFUGEES
  直前のActive失陥があればFallback済みのRole／Supplyを使用
  Final Wave Spawn後は新規到着なし。既存Queueは審査・合格・自動配置または配置待ちを継続
  潜伏感染・敗北確認
        ↓
SURVIVOR EXPIRY
  Turn10 EndTurnの未確保Survivor感染化（Objective期限とPackの実配置は次Player Turn Start）
        ↓
INTERNAL INFECTION
  生活環境由来の新規感染・猶予付与
  猶予中を除く鎮圧後の残存感染による内部感染・Checkpoint Active失陥時の即時Fallback・復旧・敗北確認
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
  次Player Turn Start冒頭でDrone期限、再アニメーションPending、基地／原発Objectiveを処理（18.15）
```

各サブフェーズ内の順序は決定的にする。即時敗北成立後は残り処理を行わない。

## 14.1 AI Portable Session

- AI Portableは長時間の外部AIプレイをプロセス境界で継続するSession層を提供し、`new`、`status`、`step`、`preview`、`preview-batch`、`save-checkpoint`、`list-checkpoints`、`load-checkpoint`、`artifact`、`query`、`play-turn`の11コマンドをJSON CLIとして公開する。単発コマンドは復旧・非対話環境用に維持し、通常の外部AIプレイは配布版Bundled Nodeの`play-turn`を推奨する。`query`と`preview`は読み取り専用とする。
- `play-turn`は1ターン1プロセスのJSON Lines対話を正式経路とし、読み取りQuery、純粋な1 Action Preview、1 Action、明示的closeを受ける。各Actionに現在RevisionとSession内で一意なrequestIdを必須とし、1～500 Unicode code pointの短い公開理由は任意とする。自動戦略を実行せず、明示的EndTurn成功／Game Overで終了する。EOF、idle timeout、closeは暗黙のEndTurnを行わない。
- 有限計画は開始Revisionと最大64件のAction列を受け、各手を検証・保存して公開結果を返す。不合法、新しい可視敵、移動中断、想定外の損害、危機の発生・悪化等で残りを止める。Crisis比較は公開reason・対象ID・Severity・型付き事実の悪化方向で行い、文言変更だけでは停止しない。EndTurn成功とGame Overは状況変化より優先して終了する。
- requestId再送は永続化済み記録から元のDecision／Revision／応答を返し、Actionを二重適用しない。同じIDで異なる内容は拒否する。照合は排他内で行い、commit後・応答前の中断も再送で回復する。
- 対話中は検証済みRuntime・現在State・公開Projectionを再利用する。Queryでも毎回復元せず、次の操作前に現在commitを確認する。別プロセスの旧`step`がcommitした場合は古いRevisionの後続操作を拒否し、再読込を要求する。複数の書き込み`play-turn`はSession単位で排他する。全履歴Observationや二重の初期ObservationをRuntimeに保持しない。
- 入力1行1 MiB、有限計画8 MiB／64 Actions、対話256要求、idle timeoutを上限とし、stdoutはJSONL応答のみ、診断はstderrとする。stdout backpressureを待ち、入力と応答を無制限に蓄積しない。上限、停止条件、Input Schema、Linux／Windows launcher、開発用経路は`query api`の`sessionPlayTurn`と各応答capabilityで公開する。
- `new`、`status`、`step`、`load-checkpoint`の標準応答はCompactな構造化公開Snapshot要約とし、Version、Session ID、現在`revision`、Turn／Phase、勝敗、公開資源・人口、所有施設／Checkpoint、全部隊、現在可視の敵、Crisis Summary、EndTurn Risk、Forecast要約、公開Horde予告、Actionの受理／拒否、理由、公開Event、`stateDelta`、作成Checkpoint、利用可能Action種別を含める。固定Map全文、全候補、詳細コスト、前後Observation全文、過去Decision全文を重複させない。
- `step`は既存`GameAction`と任意の1～500 Unicode code pointの`decisionSummary`を受け取り、1回につき1 ActionをGameEngineへ渡す。`new`は`preferred-comment-locale=ja|en`を受け、省略時は`en`とする。任意の`expectedRevision`を受け付け、不一致はDecision採番・Action適用前に`stale_revision`として状態不変で拒否する。入力形式不正はDecision番号を付けず、合法性拒否は番号、Error、Action、公開前後状態への参照、公開Eventを持つDecisionとして記録する。
- `preview`はraw `GameAction`と必須の`expectedRevision`を受け、Coreのaction previewを返す。単発CLIと`play-turn`の双方でState、RNG、Revision、Decision番号、Event、requestId台帳を変更しない。Action後は旧Previewを再利用せず、返却Revisionで再取得する。
- `query`はAPI情報／Map、Unit、Facility／Checkpoint／Branch、建設候補、全Legal Actions、Forecast、Decision履歴、完全な公開Snapshotを対象指定とPaginationで返す。標準Pageは100件、最大500件とし、応答には対象、`revision`、返却件数、続きの有無、次Cursorを含める。CursorはSession IDとRevisionへ結び付け、状態変更後は`stale_revision`で拒否する。`query`はGameState、RNG、Decision番号、正規Action列を変更しない。
- `query`で固定Map、全候補、詳細コスト、過去Decisionへ明示的にアクセスできる。`history`の既定応答はAction、Event、stateDelta、importantChanges、公開Hashを含むCompact Decision記録とし、重複する前後Observation全文は`includeSnapshots: true`でだけ復元する。全Pageの結合は安定順の完全な公開一覧と一致し、Compact化によって従来の公開情報、合法手、不合法理由、Projected Supply、移動コストを失わない。大きなFull SnapshotはPageまたはファイル出力とし、省略は明示する。
- 受理Decision応答の`stateDelta`は前後の公開Observationから導出した変化の要約とする。保存用には追加・変更・削除、配列順、Visibility、候補、合法手を完全復元できるlossless diffを別に保持する。新規感染／荒廃Site、新規発見／公開Eventで喪失確認できたEnemy、Human Unit HP／補給、Checkpoint Role、公開施設の所有・状態・人口・停止理由、支線Queueの変化を公開Deltaへ含め、視界外へ移動したEnemyを喪失と断定しない。
- Active SessionはPrivate State、Public State、Public Decision Logを分離する。Private Stateだけが完全GameStateとRNGを保持し、公開CLI出力、Trace、Checkpoint metadata、ArtifactへHidden Enemy、内部Target、RNG state、完全な非公開Configを含めない。
- 初期および直前の完全Snapshotから50 Decision経過ごとに完全公開Snapshotを置き、その間は保存用の完全lossless diffと小さなDecision記録を積む。固定Map参照、圧縮、Content-Addressed Store（CAS）による内容Hash重複排除、chunk分割を併用し、Traceの1行にObservation／合法手全文を戻さない。履歴全体の復元済みObservation配列を通常経路で保持しない。
- 各Decisionは前Decision hashを含むcanonical JSONのSHA-256でchain化する。参照先Payload、Snapshot、commit、Version、Build ID、Map、公開Configの不一致・破損を状態不変で拒否し、Active破損時に暗黙の巻き戻しをしない。大きなTrace、Snapshot、Artifactはstreamと上限付き作業バッファで処理し、全履歴を単一文字列化または一括JSON化しない。
- `corruptionRejections`は保存済みSession／Payload／Artifactの構造・整合性破損だけを数える。通常の`invalid_query`、`invalid_cursor`、`invalid_page_size`、不正Action入力等は破損として加算しない。
- 更新は新しいimmutable generationへPrivate／Public StateとDecisionを書き、最後にActive commitを確定する。Session単位の排他lockを使い、同時更新は状態不変で拒否し、同一hostで終了済みPIDのlockだけをstaleとして回収する。
- 既定で5完了Turnごと、手動要求時、Game Over時にCheckpointを作る。Checkpoint／Session Schemaは`16.0.0`で、immutableな`branchBase`を必須とする。Rootはnull、子は`rootSessionId`、`parentSessionId`、`parentCheckpointId`、`baseDecision`、`baseTraceHeadHash`、`basePublicSnapshotHash`、`ancestorManifestHash`を持つ。`load-checkpoint`は新Session IDへ分岐し、親Sessionと親Checkpointを変更しない。
- RootのDecision chainはDecision 0／ZERO_HASHから始め、子のlocal chainは`baseDecision + 1`と`baseTraceHeadHash`から始める。RootのStore Manifestは共有Payload Poolと祖先履歴範囲を定義し、子へ祖先の展開済みObservation／Decision全文を複製しない。完全Artifactは分岐点までの祖先履歴と子の履歴を必要なPayload各1回で梱包する。
- `.git`を含まないPortable PackageでもWorkflowから注入したfull commit SHAをBuild IDとGit Commitとして固定し、別Buildまたはv1.6.4以前のSession／Checkpointを拒否する。Portable PackageはLinux／Windows x64のBundled Nodeだけで全11コマンドとJSONL `play-turn`内PreviewのSmokeを行い、公開Observation／Legal Actionsだけを使う外部AI Seed 1／7 Game Over・Artifact・Replay一致を確認する。

---

### Player Portable配布

Linux/Windows x64のPlayer ZIPにはBundled Node、bundle化Session CLI、launcher、プレイ文書、Version情報、必要なライセンスのみを含める。src、開発用node_modules、fixture、build toolは配布しない。Checkout側でtypecheck/test/buildを実行後、展開Packageの同梱Nodeだけで全command・Seed 1/7終局・Artifact/Replay一致を検証する。ZIP bytes、展開bytes/ファイル数、Session disk-usage、Compact/Full JSON bytesの測定条件と実測を証跡へ残す。既存Store schema 1、Replay Package schema 1、完全な公開Queryと再開整合性は維持する。


### Action／Query／継続判断

- `step`、`preview`、interactive／finite `play-turn`、AiSessionは同じ厳密なGameAction入力検証を使う。未知Type、余分なfield、欠落field、型不正を`invalid_action_input`で拒否し、Core・Decision・revision・RNGを変更しない。形式上正しい不合法Actionは従来どおり`accepted: false`のDecisionとして記録する。CLIの`ok: true`はcommand処理成功でありAction受理とは独立する。
- construction filterは`facilityType: checkpoint`と`actionType: BuildConstructibleFacility`を受理し、API schema・help・CLI・AiSessionで同一集合を返す。
- 各DecisionのimportantChangesおよびCompact Summaryの`facilityChanges`は、所有生産施設・Capital／City／Housingの意図しない健康人口減少を稼働状態が変わらなくても記録する。前後健康人口／感染者／資源別生産量と差分、算出不能理由、確認できたEvent種別を持つ。意図的なWorker配置・人口移送・編成への徴集だけの減少を除き、因果を推測しない。
- finite planのexpectationsは`allowedNewCrisisReasonCodes`と`allowedWorsenedCrisisReasonCodes`を独立に受け付け、該当Reasonだけ停止条件から除外する。未知Reasonは入力エラー。省略・空配列は安全側の停止を維持し、別ReasonのCrisis、新規敵、未予期の損害、喪失を無効化しない。Play Turn Protocolは`1.2.0`。
- Enemy隣接でMoveを失う場合があり、Attack後Moveは不可、Move後AttackもInterceptionによるCharge消費に従う。感染拠点の人口操作・感染CapitalへのTransfer制約をHelpへ明記する。編成予約は拠点ごとに未完了1件、異なる拠点は独立、Army Base無償報酬は枠を消費せず、予約Actionは共通Action予算1を消費する。
- 安全人口の固定値はない。runway、Guaranteed Defeat、生産余力、Queueを判断基準とする。BalancedはCapitalでPolice／Riotによる無損害鎮圧を優先し、接近中の敵に対して重要拠点の守備を維持し、runwayが短い生産施設のWorkerを補充し、危険な受入はNormal／Deny／Turn Awayで抑える。Housing容量超過は計画しない。
- `npm run session`は入力ファイル群の変更を検出したときだけbundleを再生成し、ビルド済みCLIをNodeで起動する。`session:dev`だけvite-nodeを使用する。通常起動にruntime TS変換はなく、Portableと同じSession CLI moduleを正本とする。cold build、help／new／status／query、同revision read-only 10回のmedian／p95、再buildなし、Portableとの契約一致をRelease証跡へ記録する。

## 14.2 Browser-native AI SessionとLive AI Viewer

- transport-neutralなAI Session Application層はDOM、Vite、Phaser、CLI transportへ依存しない。WebMCPは`nlth_get_context`、`nlth_observe`、`nlth_query`、`nlth_legal_actions`、`nlth_preview_action`、`nlth_preview_actions`、`nlth_act`、`nlth_get_request_result`、`nlth_get_result`の9 Toolを提供する。各SessionはEngine・revision・Decision chain・requestId台帳を独立に持ち、actは現在revisionと一意なrequestIdを必須とする。同一内容の再送は同じ結果、内容違いは状態不変で拒否する。Export／EndはViewerの操作として提供する。
- `preview_action`は実Engine、RNG、revision、Decision番号、Event、Session履歴を変更せず、合法性、即時差分、次EndTurn前後、人口維持余力、完成Turn、最初の経済効果Turn、定常差分、不確定要因を返す。コメントは省略／null／空白をnullへ正規化し、非空文字列は1～500 Unicode code pointの原文を保存する。localeはSession既定を持ち、各Decisionで`ja | en`を上書きできる。
- ブラウザAdapterはトップレベルの`document.modelContext.registerTool`が存在する場合だけ同じ9 Toolをimperativeに一度登録し、`window`や`navigator`配下の独自API、DOM fallback、宣言的Tool定義を作らない。Tool未対応ブラウザでも通常ゲームとLive Viewerは動作し、登録失敗をゲーム本体の障害にしない。
- Live AI Viewerはタイトルの固定入口から開始し、通常Human UI／autosaveとEngineを共有しない。PCでは右Panel、mobileではBoard中心＋下部／全画面Panelを使い、Canvas backing storeはDPR 2以下かつ約4.2M pixels以下とする。常時Board、Session／Turn／Phase／接続、Pause／Resume／End／Export、言語切替、最新100件か2 MiB以下の判断Log、全コメント原文を表示する。
- AI操作は`act`応答commit後に0.5秒の表示保持を完了してから次を許可し、各Tool実行には5秒watchdogを設ける。Pause中は新規Actionを拒否して描画状態を保ち、Resumeで継続する。Endは明示終了し、Artifact exportは同一canonical session bytesからArtifact Schema `19.0.0`の決定的ZIPを作る。UI文字列は`textContent`またはescape済みHTMLだけで描画し、コメントからHTMLを実行しない。

# 15. 保存・復元

- 人間側は新規ゲームの確定初期状態、正常に完了して次の自ターン開始までcommitしたEndTurn、確定した勝利・敗北を自動保存する。移動・攻撃・待機・内政Action途中や拒否されたEndTurnでは自動保存しない。
- 手動保存で任意の確定状態を保存する。自動保存と同じローカル1枠を使い、最後に成功した保存を「続きから」で復元する。セーブコードとJSON出力は別途保管に使用する。
- 保存中・完了・失敗、最後に成功した保存Turn、未保存の変更を表示する。保存失敗時も直前の成功情報を維持する。未保存で終了した場合は直前の成功状態へ戻る。処理中の保存は確定後に可能とし、ブラウザ終了時の保存成功には依存しない。AI Sessionは各Decision保存を維持する。
- セーブコードはVersion、Config、Map ID、Seed、完全なGameState、チェックサムを含む。
- 同内容をJSONファイルで入出力できる。
- Version不一致、破損、不正Config、不変条件違反を検出し、現在状態へ適用しない。
- ロード後は保存時Configを使う。
- v1.6.5はGame Rules / GameState / Config `15.0.0`、Fixed Map `fixed-51x51-v9`、Save Format `22`を使う。その他のVersionは18.15.16に従う。
- v1.6.4以前の自動保存、セーブコード、JSON Save、AI Replay、Artifact、Session、Checkpointは変換・移行しない。Version不一致は現在Stateを変えず日英の理由付きで拒否する。旧autosave keyは読み取り確認だけを行い上書き・削除せず、新規ゲームは`nowhere-left-to-hide:auto-save:v22`を使う。
- Save22は6.1の全Stateを検証する。28恒久施設、湾・橋、Survivor、Refinery Allowance、報酬台帳、人口衛生・飢餓・感染猶予、Objective／Pack Pending、基地軍需・予約・生涯生産数、砲兵モード、航空状態・搭乗関係・軍用ドローン、Checkpoint、Wave Roster／Pending、Noise、RNG、Event、Statisticsを保持する。Forecast／Crisis／Supply／Visibility／Preview等の導出値は再計算する。新metadataを旧値で黙って補わない。
- Artifact Schema `19.0.0`は固定Map情報をゲーム単位で1回だけ保存し、Turn Observation Traceでは`mapId`から参照する。Public Decision Log、受理Action列、不正試行、公開Observation／Event、Metrics、Seed、公開Config、Version、Build ID、Session lineageを欠落させず、保存用lossless diffから各Decisionの前後情報を完全に読み出せるようにする。Artifactはstreamでファイル／Packageへ書き、標準出力には小さなManifestだけを返す。Player-facing Artifact／ReplayはWaveの公開人数とPending、公開Scream／Survivor救出／Checkpoint Risk等を保持するが、Rejected Counter、未確保Survivor正値、拒絶人数の由来、正確なBonus Type内訳、Hidden Noise情報を残さない。
- Player-facing ReplayにはFoWを適用し、Browser BridgeのArtifactへ内部情報を含めない。Browser Bridge ArtifactのConfigは公開情報だけを含む。ローカル／CI Runnerの完全な検証Artifactだけが`verificationEvents`、完全Config、Internal Event列を保持し、Replay時に一致確認する。Live Observation、`query`のFull Snapshot、Browser Bridgeは完全な公開情報へ明示的にアクセスでき、公開情報を参照差分だけに制限しない。

---

# 16. Event・統計

移動、戦闘、Charge消費、Kill Credit、昇格待ち／昇格、Gas爆発・連鎖、Army Base報酬・予約完了／没収・迎撃、施設・人口・資源・Checkpoint・Horde・Noise・Crisis／EndTurn Risk監査・Game Overを理由付きEvent／Statisticsとして保持する。`horde_warning`は基礎総数、Horde数、非Horde Slot数、可能Typeだけを公開し、抽選結果とRejected Bonusを出さない。roster freeze時に`horde_wave_started`を1回発行し、基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を公開する。各実Spawnでは`horde_spawn_batch`に当該batch人数、累積出現済み人数、Pending人数を記録し、視界境界を守る。Internal EventだけがType別Frozen RosterとRejected詳細を持つ。

`noise_emitted`のAgent公開Payloadは`sourceUnitId / sourceUnitType / q / r / noiseClass`のうち存在し公開可能な値に限定し、Enemy IDと座標にはFoWを適用する。反応個体／数、内部Target、実Pulseのradiusは公開Payloadへ出さない。砲兵や航空Noiseの静的ルール説明とは区別する。拠点・Gas Eventも公開Projectionを通し、未確保Survivorの正確な人数、Hidden EnemyのID・配置Hex・Target・被害を漏らさない。

終了統計:

- 勝敗、生存ターン
- 最終・最大人口
- 最終・最大確保施設数
- 民間人損失、ユニット損失
- 感染損失、資源不足損失の全経済フェーズ累積、直近経済フェーズ分
- 全Zombie Typeの敵撃破総数
- Horde迎撃数、主な敗北原因
- Gas爆発・連鎖数、Army Base迎撃・報酬・予約没収数

人口を変えるEventは移動元、移動先、人数、理由を追跡可能にする。

Agentゲーム単位Metricsは、各Version、Build ID、Map、Seed、Config、Agent、勝敗、Game Over理由、最終Turn、Decision／受理／不正Action数、Action／優先目標別件数に加え、次を記録する。

- 初期・最終・最大人口、民間人損失、感染・資源不足損失、Army Base報酬の累積増員、受入避難民、最大過密
- 道路別・合計の到着、未管理素通り、方針別審査、受入、州外退去
- Checkpoint新設、Standby／Dormant作成、移設、Active化、Fallback（支線別、Standby由来、Dormant由来、未管理到着防止）、Active失陥、後退、荒廃、復旧、放棄、消滅、未管理道路ターン
- 補給圏内施設数、最大補給半径、補給喪失、補給理由の拒否Action
- 確保・喪失・最終所有施設数
- Unit Type別の初期・完成・損失・最終生存隊数と生存率、補給圏外損失、Type／回復区分別の実回復HP・回数、5%／10%選択回数
- 単一／全生産施設の最大労働者数、26～30人施設Turn、発電所停止Turn、電力不足Turn
- Facility Type別Power requested / supplied / unavailable Turn、Power Supply OFF Turn、給電停止によるResource別生産損失、Refinery停電Turnと次Turn Fuel不足、Simple Farm生産量とFood不足回避Turn、停電都市Turn、Refinery／Power Plant追加確保数
- Active Checkpointの方針別branch-turn比率と、方針別Batch開始人数・完了人数・平均Queue、Capacity利用率、推定Throughput、Queue Pressure Turn
- Zombie撃破、Horde迎撃
- Wave別開始Turn／Spawn Turn、選択Direction、基礎人数／Bonus込み確定人数、方向別batch／累積Spawn／Pending／撃破数、Wave別撃破数、最終個体撃破Turn、Final Horde生成／撃破／全滅、通常／Horde Zombie撃破、最大Visible Zombie、Final Horde後Turn数、Supply内Zombie／感染Clear Turn、Victory Turn
- 初期Normal／Hunter／Gas／Screamer数、Scheduled／FinalのHorde数、非Horde Slot数、特殊Type別生成／撃破。標準初期はNormal 40体、Hunter 4体、Gas 4体、Screamer 2体、基礎Wave ScheduleはH66 / Slot92 / Total158、Final基礎はH32 / Slot40 / Total72である。通常抽選をHordeへ変換するため、H／Slotは最終Type数ではない。Final別枠Pack1体とRejected Bonusは基礎人数の外で確定Rosterへ加算する。Rejected Bonusは完全検証Metricsだけで区別し、Final集計はGroup内の全Typeを合算する。
- Army BaseのSeed位置・所有・Survivor／Worker・専用軍需・予約電力・未確保を含む迎撃・報酬、初期Normal Zombie数40、初期Hunter数4とDistance 20以上、初期Gas数4とDistance 9以上、全初期ZombieのArmy Base離隔、Human Unit Type別移動・Fuel・Combat Military Goods、Reconの完成／損失／Kill／鎮圧、Drone Vision、Checkpoint deny／grandfathered Queue／waiting Risk、全特殊Zombieの生成・撃破・最終生存数、Human Unit Type別Reanimation、Scream、Gas爆発・連鎖、Survivor救出／感染、Oil Field方角／credit、Refinery Allowance、Wind建設費、fallen-site再Spawn内訳、Final後に防止されたArrival、Drone Base撤去・返却を記録する。active game中の公開Metricsから未確保Survivor人数を逆算できないようにする。
- Terrain別進入、Urban／Forest防御、通常Zombie Idle、Horde Target継承／解除、Noise Pulse総数、Human Unit Type別Pulse数、Horde Movement Pulse数、Noise反応陥落拠点数、再Spawn、未生成感染者、Noise起点連鎖と発生Unit Type別内訳
- Unit Type別Recruit編成数、Regular／Veteran昇格、直接Kill Credit、Attack Charge使用／未使用、Riot生産／損失／Reanimation、特殊Horde Type別生成／撃破
- Ground Visionの遮蔽前Potential／遮蔽後Visible／Blocked Hex、Blocked最大・Turn平均、Civilian Drone Base建設数と最大Vision Radius、Aerial VisionがGround遮蔽範囲で新たに発見したEnemy数。Aerial Enemy発見数はVerification／Batch専用とする。
- Site Kind／Type別の初回感染、感染陥落、Zombie占有破壊、陥落時実感染者数、Requested／Actual Spawn、陥落／Noise由来Normal Zombie、最大6体Spawn、未生成感染者、即時感染、連鎖陥落数・最大長・起点、感染者からZombieへの変換人口、Constructible残存感染者死亡、Turn 5以前の拠点損失
- Map幅／高さ、Human Unit Type別移動Hex数・最大移動距離・6 Hex以上の長距離移動
- Unit Type別Fuel消費・補給・commissioning Fuel、Supply外終了Turn、Fuel不足で移動不能となったUnit、Power／UnitへのState Fuel支出、Fuel不足Turn
- Unit Type別の携行Military Goods固定消費、通常攻撃／反撃／迎撃／自動鎮圧消費、補充量、未充足補充量、撃破時喪失量、軍需0弱体攻撃回数、Soldierの距離1／距離2攻撃回数と消費量、Army Base専用軍需補充／不足／迎撃消費、国家軍需補充不足Turn
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

- 移動、経路迎撃、攻撃、反撃、5%／10%／0%自然回復、回復Eventと予測一致
- 初期Regular、新規Recruit、Config別完成熟練度、5 Turn生存昇格、直接Kill 5体の昇格待ちと次Turn Veteran化、Kill重複防止
- Type別Charge（通常Human1/2、Special Forces3/4、砲兵1、Horde4、Pack5）、共通消費、Wait保持、攻撃後移動禁止、航空・搭乗・Mode変更の行動制限
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
- Wave Config validation、Turn10／20／35／50／70、方向別Horde5/3/8/5/8・Slot4/6/9/9/10、全Wave Weight40/10/10/5/15/15/5、Riot上限1・Hunter／Gas上限なし、通常抽選のHorde変換、Final別枠Pack、Warning非漏洩、固定方角順、4方向Waveの方向RNG非消費を試験する。
- Warning開始、Wave roster freeze直前・直後、Pending分割Spawn中のSave Round Trip、Session Resume、Checkpoint分岐、Replayで方向、Wave進行、Group ID、Frozen Roster、特殊Type、RNGが一致することを試験する。Base抽選後のRejected Bonus weighted抽選、Direction単位の共有Cap、Final 4 Groupの基礎72体、全基礎H66 / Slot92 / Total158 Metricsを試験する。
- 固定Terrain数・座標・Overlay、重み付き移動、Road／Urban Cost、Water不可、同Cost決定性
- Urban／Forest防御の攻撃・反撃・迎撃・Gas／砲撃への適用、航空中の例外、感染変換の非軽減
- Ground Unit／Capital／通常Facility／CheckpointのVision和集合、`hexLine()`のForest／Mountain遮蔽、Blocking Hex自身の可視、複数遮蔽物、盤端、Aerial Vision非遮蔽、Visibility更新、UI Overlay／Observation／Legal Actions／EventのFoW、Hidden移動停止とCheckpoint公平性
- Checkpointの対象Hex未可視／対象だけ可視で途中道路未可視／全経路可視、可視Zombie妨害とHidden Zombie非妨害、Facility占有、Active＋Standby 5基と6基目拒否をBuild／Relocateで試験する。
- Checkpoint候補、`getLegalActions()`、Human UI局所Build、実Actionの合法性とReason一致、拒否時State／資源／Action回数／PRNG不変、Observation／Bridge／Artifact一致、Hidden Enemy非漏洩
- Human UIの空道路選択とFacility／Checkpoint選択優先、Build候補座標一覧／全候補Marker不在、Relocate Marker維持、EndTurn未給電件数、Player所有Required施設の視界外／OFFを含む`⚡×`と給電回復時消去、日英表示
- 通常／Hunter／Gas Zombie Idle／Horde継承／Noise記憶／解除、HordeのCapital指向、Target伝播方向、`Visible > wave_capital／Horde継承 > Noise > Idle`、複数Horde決定性、Snapshot順序
- Police 4／Soldier 8／Riot Police 5とHorde移動8のNoise境界、Terrain非減衰、通常Combat 1回1Pulse、Horde実移動ごと1Pulse、Counterattack二重Pulseなし、pendingの次Zombie Phase評価、複数Pulse最短再選択、同距離RNG、現在同距離保持、Horde／Visible優先
- 実感染者0～4／5／30以上、最大6体、隣接空き不足、Distance 2不使用、Checkpoint共通化、Constructible消滅、Wind除外、生成Unitの同Phase行動禁止と即時占有、Unit ID順FIFO連鎖、州都連鎖敗北を試験する。
- Combat Noiseによる陥落拠点のID安定順再Spawn、未生成感染者保持、後続Pulse再試行、即時感染／連鎖、Hidden Spawn個体情報の非公開、最新50件の重要イベント履歴とToast集約を試験する。
- Production UI／Agent／公開Event／ArtifactがNoiseの公開Classと公開契約で許可した静的情報だけを使い、反応Hidden EnemyのID・数・Targetを漏らさないこと。診断用の内部Pulse情報はDevelopmentだけで確認できること。
- Scheduled Waveの規模・Timing・22 Hex Direction Zone、roster freeze、oldest-first Pending、batch分散、Spawn次Turn行動、特殊Type provenance、Turn 50後の継続、Final Pending 0かつMap上Final所属Zombie 0のVictory、非Final Zombie／感染の非ゲート化、Defeat優先、Runner 100 Turn到達の`limit_reached`分類
- 勝利・即時敗北、v1.6.5 Save Format 22の保存・復元、v1.6.4以前の通常SaveおよびAI Replay／Artifact／Session／Checkpointの状態不変な拒否
- UI数値入力とスライダー同期
- 51×51固定Map `fixed-51x51-v9`、Reserve392 Hex、方向別22 Hex Zone、固定24施設＋Oil Field・Army Base・原発・Air Base各1基、固定湾候補・橋、選択Oil Field spur、初期Human7隊、Zombie40＋Hunter4＋Gas4＋Screamer2の決定配置・非重複・Capital距離・両基地への実LOS除外、Terrain生成順、4支線距離25を試験する。
- Police Movement Budget 15／Soldier・Riot Police・Recon 10、Police／Riot Fuel 24・Soldier／Recon 44、通常移動Fuel 2倍、Fuel不足拒否、Hidden Enemy途中停止、発電後Round Robin補給、新Unit有償補給、死亡時Fuel喪失
- Police・Riot Police 10／Soldier・Recon 40の携行軍需、固定消費、補充、距離別Combat Cost、既存Range 1 Unitの軍需0／1弱体、Soldier距離2・Recon不足拒否、残Charge鎮圧／封じ込め、死亡時喪失
- Fuel 0でだけ使えるPolice 3 MP／Soldier・Riot Police 2 MPのEmergency Movement、Terrain実効Cost、Hidden Enemy途中停止、補給圏帰還、Fuel非消費
- 初期／建設WindのFuel不要発電15、Vision、Supply外継続、Radius 8 Noise、Target Value 0、道路支線数×2の建設上限、Disable／Recoveryと、Constructible Facilityの候補、費用、上限、建設Turn、Power、Supply喪失、感染／消滅／Recovery、Housing／Drone Base撤去・返却・上限解放・Simple Farm拒否
- Simple Farmの個数上限なしのPowerなしFood 5 / worker、Required Farm／Civilian Factory／Military Factory／Refinery／Drone Baseの未給電停止と給電出力、Drone Vision 0 / 3 / 6 / 9 / 12 / 15、都市未給電時のCivilian Goods停止、HousingのCity-like人口・受入順・Supply切断・occupied／empty電力Tier・独立outage penalty・EndTurn snapshot、確定建設／審査結果だけを含む次ターン予測、mutation後cache更新、Strategic Forecast、Checkpoint Queue維持需要、Queue Pressure、Query純粋性とHidden情報非漏洩
- 建設中／disabled／recoveringのFacilityへ`AssignWorkers`をLegal Actionsとして列挙せず、直接Actionも状態不変で拒否すること
- Temporary Housingを含む全Asset Registry Pathの実File、PNG Decode、256×256 px、透過、3 MiB上限、Water・橋PNG収録、Type／状態Mapping、BoardとLegendのRegistry同一性
- 一般施設とCheckpointの複合状態、現在停止と停止予測、Scheduled／Final Horde Marker、Road接続方向、施設・Unit Offset
- 全Asset成功と個別Missing／Decode／Texture登録失敗のFallback、成功Assetの維持、Loading完了、Fallback中の操作継続とState／RNG不変
- Fog外の既知情報暗転とEnemy非表示、Layer順、Zoom`0.75`境界と最小`0.35`のLOD、全16 Unit TypeのAsset／Legend／Fallback、Army Baseの表示、日英Board Legend、現在／標準Config、電力HUD
- v1.6.5の同一Config、Map、Seed、Action列について熟練度／Charge、Riot、Hunter、Gas、Army Base、特殊Wave、Frozen Roster／Pending Spawn、fallback履歴、Wind Noise、Housing、pending Noise、感染／Reanimation（Hunter／Gasなし）、Checkpoint、Result、主要MetricsのReplay一致を確認する。
- Queue健常3PoolのFood／Civilian Goods維持費・不足順、全Build 25のCheckpoint費用と初期配置4基の無償初期化、Relocate 25、Turn Awayのwaiting限定・Action消費、deny／Turn Away CounterとNormal／Strictの拒否0、`ceil(total / 5)`、参加Directionだけのreset、Final後のCounter非加算を試験する。
- Production UI、Agent、Bridge、公開Event、Player-facing Artifact／Replay／終了結果が基礎人数、Bonus込み確定人数、出現済み人数、Pending人数を公開しつつ、Rejected Counter生値、拒絶人数の由来、正確なType内訳、Rejected詳細Metricsを漏らさないことを試験する。
- Police／Soldier／Riot／Hunter／Gas／Screamer Zombieの性能、Normal AI、Wave／非Wave provenance、Human Unit死亡からの生成、Screamの一度限り・公開境界、Gas爆発FIFO連鎖、同Phase行動禁止、即時感染、Victory対象を試験する。
- Core由来Crisis全Category／Severity／reason、Human UIの段階表示とAccordion、上部資源Accordion、対象別Panel、Zombie選択、局所建設、EndTurn Risk短縮表示を日英・390×844・1280×720で試験する。
- Sessionの連続実行、Compact応答、`query`の全対象・Pagination・Cursor／Revision、Active復帰、Checkpoint分岐、`branchBase`／Store Manifest、State Deltaと保存用lossless diff、chunk／圧縮／内容Hash共有、stream読み書き、Observation、Legal Actions、公開Event、RNG結果、Decision hash、Artifact、Replay一致、Version／Build拒否、FoW非漏洩を試験する。
- 1,000件以上の受理Decision、512 MiB超の大容量履歴、破損注入、同時更新、古いRevision、stale lock、子分岐を対象に、履歴全体の単一文字列化・全Observation配列化なしで復帰、追加step、Checkpoint、分岐、`query`、Artifact export／read／Replayが完了することを試験する。Runner 100 Turn到達は`limit_reached`としてTechnical FailureおよびGame Overと別集計する。
- 51×51・21部隊規模の公開FixtureでCompact、全詳細Page、Full Snapshotの情報同値性を確認し、通常応答のUTF-8 bytesを旧方式の25%以下、Session総保存量（Trace、Private／Public generation、Checkpoint、共有PayloadのRoot内実体を各1回計上）を旧方式の50%以下とする。履歴長を増やしたときのPeak RSSと通常応答サイズが展開済み履歴総量へ比例しないこと、各コマンドのp50／p95時間と読み込み量を記録する。
- 全Zombieの開始時隣接・最初の隣接地点での足止め、Human迎撃／反撃→基地迎撃→隣接攻撃の順、Charge 0、同人数Target、基地距離0／1／2の迎撃を試験する。
- Gasの初期4、距離9境界、全Waveの抽選、隣接6 Hex・中心／距離2除外、Terrain半減、拠点感染、Snapshot、Gas連鎖FIFO、二次Kill Credit除外を試験する。
- Army BaseのSeed位置、未確保Survivor迎撃、Worker 0/1視界、人口敗北例外、Turn 10報酬と不可逆失効、都市限定徴用、予約の電力10／供給外継続／感染保留／陥落没収、Base最後順位、専用軍需補充、迎撃NoiseとFoWを試験する。
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
MaxAttackCharges == UnitType / Proficiency / Mode rules
Human通常1/2、Special Forces3/4、Field Artillery1、Horde4、Pack5、その他Enemy1
```

加えて:

- 所在地のない民間人口が存在しない。
- 人口移動・編成の前後で人口保存則を満たす。
- 各Hexに地上Unit1隊と航空Unit1隊まで。搭乗部隊は独立占有せず、航空機との参照は相互整合する。
- 死亡Unitは再行動不可。攻撃後は移動不可だが、Veteranは残Chargeがあれば追加Attackできる。
- Game Over後に状態遷移しない。
- Human UnitとHorde ZombieのChargeはPlayer Turn Startに各Typeの最大値へ補充し、Zombie Phase開始時の追加補充は行わない。Packは最大Charge5、Hordeは4、その他Zombieは1である。
- 生産施設上限を超えない。
- 感染施設へ人口を追加・撤収しない。
- 新規確保・復旧施設を同じターンに人口操作しない。
- 同一Version、Config、Map、Seed、Action列で結果が一致する。
- 各支線のActiveは最大1、`activeCheckpointId`と`standbyCheckpointIds`は重複せず、Standbyは同支線のoperational Postだけを参照する。Active＋StandbyはConfig上限以下であり、Remnant／Ruined／AbandonedはActive／Standbyにならない。
- Activeだけが新規Arrival、Supply、Visionを提供し、Role変更、Fallback、Supply再計算、Event生成はGameEngine内で原子的かつ決定的に行う。
- `noiseTarget`と継承Horde Targetは`zombie`、`policeZombie`、`soldierZombie`、`riotZombie`、`hunterZombie`、`gasZombie`、`screamerZombie`、`packZombie`だけが持ち、`hordeZombie`は持たない。Screamerの`hasScreamed`は一度trueになれば戻らない。
- 補給圏とセクターは同じ純粋関数から導出し、Human UI、Headless、Agent、Browser Bridgeで判定を分岐させない。
- Zombieの携行Military Goodsは常に0とし、Emergency Movement利用可否は保存せずConfigと`currentFuel`から導出する。
- Player Unit、Player所有Facility、Constructible Facility、CheckpointはHorde Spawn Reserveを占有しない。`hordeSpawnReserve`とTileの`playerOccupancyAllowed`は固定Mapと一致する。
- Horde Stateの次Wave、Warning方向、開始済みWave、Frozen Roster、方向別Group ID、特殊Type provenance、Pending、Final Group ID、Final状態はConfigの固定Wave Scheduleと整合し、Warning前は方向・特殊抽選結果を保持・公開しない。
- pending Noise Pulseは次Zombie Phaseだけで評価し、処理後に残さない。公開State／Eventはsource位置、反応個体、内部Targetを含めない。
- Mapは51×51、Reserve392 Hex、Direction Zone各22 Hex、恒久施設28基、初期Zombie50体。全初期ZombieはArmy Base／Air Baseを自身のGround LOSで視認できない。基地Worker上限10・専用軍需40、原発Worker上限5、報酬は一度限り、予約・powerReady・生涯生産数は整合する。Allowanceは非負で`remaining = initial + oilCreditsEarned - fuelRefined`。衛生ストレス0..1、飢餓累積0..7、感染猶予はinfected内数、各確率は規定上限内。Rejected Counterは非負で参加方向のfreeze時にresetし、Final freeze後は加算・新規到着なし。

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
- v1.6.5はルール・Map・Save契約を更新するため旧Versionとの結果一致を合否にしない。同一v1.6.5 Config、Map、Seed、Action列のRandom／BalancedでTechnical Failure／Replay／Session不一致を0とする。100 Turn到達は`limit_reached`として記録し、ゲーム内敗北およびTechnical Failureと別集計する。
- Random／Balancedの同一Seed比較、決定性、JSON／CSV／通常モードのゲーム単位Artifact、`--summary-only`のコンパクト出力、失敗継続、fail-fast、Replay一致を試験する。
- Production Buildに`window.NLTH`とAPI説明が含まれ、公開メソッド限定、通常UI／保存分離、入力拒否時の状態保持をSmoke Testする。
- 公開Pagesでは公開Observation／Legal Actionsだけを読むブラウザ操作可能な外部Agentを使い、API発見、不正Action訂正、Seed 1と7のGame Over、Result／Artifact取得とReplayを手動E2E確認する。PagesのWorkflow成功を必須とし、個別ゲームの勝利は合格条件にしない。
- v1.6.5 Release Validationは現行Version、旧データ拒否、人口衛生、Wave、砲兵、航空・輸送・Objective、公開Query／Preview、Session／Replay決定性を検証する。Linux／Windows PortableはBundled Nodeで全11コマンドとJSONL Preview、外部AI Seed1／7の終局・Artifact・Replay一致を確認する。Pages／Portable／200ゲーム／512 MiBは結果確認前に成功済みと扱わない。長時間Workflowを起動確認で止める場合は未確認として記録する。過去版の性能証跡は現行結果一致ゲートにしない。

---

# 18. PoC完成条件と検証記録

1. PC・390×844相当のスマートフォン縦画面で盤面、主要Action、Bottom Sheet、航空／地上選択、内政、11カテゴリHelpとBoard Legendを利用できる。
2. 全16 Unit Typeの能力・熟練度・Charge、砲兵モード・砲撃、航空移動・離着陸・輸送・緊急着陸・軍用ドローンがCore／UI／Agent／Save／Replayで一致する。
3. `fixed-51x51-v9`の51×51 Map、28恒久施設、湾・橋、Reserve・Spawn Zone、確保報酬とTurn10 Objectiveが決定的に機能する。
4. Turn10／20／35／50／70の現行Wave、通常抽選のHorde変換、Final別枠Pack、Rejected Bonus、Pending、Final勝利・敗北優先が一致する。
5. 局所過密費、飢餓累積・比例死亡、衛生ストレス・感染猶予、現行審査方針、基地・原発を含む電力と補給のForecastが実処理と一致する。
6. 公開Query／Preview／Batch Preview・Crisis・Context Handoffが純粋で、FoW・内部乱数・Hidden情報の境界を守る。
7. 18.15.16のVersion一覧に従いSave22／autosave v22、Artifact19、Session／Checkpoint16を復元し、v1.6.4以前のデータを非破壊で拒否する。
8. Portable全11コマンド、9 WebMCP Tool、Live Viewer、公開ZIP観戦、Session再開・分岐、同Version Replayが機能する。
9. Water・橋、16 Unit Type、15 Facility TypeとCheckpointの256×256透過PNG、個別Fallback、LOD、UI専用Registryを検証し、Runtime PNG合計3 MiB以下を守る。
10. 変更範囲に必要な第17章・各詳細節のテストを実施し、未実行・失敗・保留と成功を区別する。GitHub Actions／Pages／Portableの成功は実結果確認後だけ記録する。ユーザー指定で長時間Workflowの確認を起動までに留めた場合は、完了結果未確認とする。

以下の18.1〜18.12は、各見出しの版・日付における実装／検証履歴を原文のまま保持する。旧Versionや旧数値は現行ルールの根拠ではなく、過去の合格結果もv1.6.5の合格を意味しない。現行の詳細規則は18.13〜18.15、現行版の検証状況は18.15.17以降を参照する。

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
- Commit `857a92596c662a3b9589796d543231d93fe0ee51`の[通常CI／Pages](https://github.com/plastichyena/nowherelefttohide/actions/runs/34691169010)は通常85ファイル770テストとdeployが成功（日次専用11件skip）。公開配信JSのBuild ID一致を確認した。UI変更はなく、この追補での対話的ブラウザ操作の再検証は行っていない。
- 同Commitの[AI Portable](https://github.com/plastichyena/nowherelefttohide/actions/runs/34691178518)はLinux／Windowsとも成功。同梱Nodeで全9コマンド、Seed1/7の通常終局、Artifact取得、Replay一致を確認。長時間Jobは開始確認までとし、前回Release Validationを取消していない。証跡は `src/testing/fixtures/v157-supply-followup.json`。

## 18.9 v1.6.0 実装・検証（2026-09-13）

- 施設初回確保報酬、4 Oil Fieldとaccess spur、全国共有Refinery Allowance、Temporary Housing通常維持費、Wind建設上限8、危機理由の分離、損失／撃破統計をCoreに実装した。状態変更はGameAction→GameEngineの境界を維持し、Forecast、Crisis、Action Previewは純粋Queryとして共有する。
- transport-neutral AI Session Application、WebMCP固定8 Tool Adapter、Live AI Viewer、ブラウザ内Artifact builderを追加した。通常Human UI／autosaveとSessionを分離し、requestId idempotency、revision、コメント／locale、Pause／Resume／End、watchdog、表示保持、bounded log、XSS防止を共通契約で扱う。
- App `1.6.0`、Rules／State／Config `10.0.0`、Map `fixed-51x51-v5`、Save `17`、Agent／Observation／Bridge `15.0.0`、Artifact `14.0.0`、Session／Checkpoint `11.0.0`、Balanced `9.0.0`へ更新した。v1.5.7以前は移行せず状態不変で拒否し、Randomは`6.0.0`を維持する。
- Core受入試験は報酬の一度限り適用、Oil FieldとAllowanceの同Turn順序、Allowance枯渇時のRefinery無給電、Wind 8基／9基目拒否、全Zombie撃破集計、累積／直近不足損失、Supply内外の軍需警告分離、Worker 0対象、pure Query／previewを実Actionと不変条件で検証する。Browser／Session試験は固定8 Tool、未対応環境、Session独立性、再送、停止状態、表示上限、canonical Artifactを検証する。
- 公開PagesとLinux／Windows AI Portable Packageは対象CommitのGitHub Actionsで結果を確認する。その他の長時間Release Validationはユーザー指定により起動確認までとし、未確認結果を成功済みとして扱わない。Doc/archiveの本文は参照・変更せず、ユーザーが先に行った文書移動だけをコミットへ含める。
- 最終公開対象はCommit `8bb7d0ffea163c048d8b367c8c221c2af2217094`。主要実装Commit `c80af5c6ed0d273bc06e08fa43e7f5ffbc211223`に、公開実機で検出したLive AI SessionのBuild ID配線修正を追加した。ローカル通常ゲートは91ファイル・818テスト成功、日次専用11件skip、型検査、本番Build、検証Script 8件、Browser Bridge production smoke、外部AI Seed 1／7の正常終局とReplay一致が成功した。Build ID修正後はBrowser／WebMCP関連23テストと本番Buildを再実行して成功した。
- 最終Commitの[通常CI／Pages](https://github.com/plastichyena/nowherelefttohide/actions/runs/34750192127)は通常検証とdeployが成功した。公開URLでApp `1.6.0`、Build ID `8bb7d0ffea163c048d8b367c8c221c2af2217094`、通常Turn 1、autosave、コンソールエラー0件を確認した。Codex built-in browserでは固定8 WebMCP Toolをdiscoveryし、開始前拒否、明示開始、context、observe、legal actions、preview、act、request result、game resultを実行した。previewはState不変の合法結果、actはrequestId付きでrevision 0→1、requested locale `ja`、Decision comment、公開State Delta、同一Build IDを返した。
- 最終Commitの[AI Portable](https://github.com/plastichyena/nowherelefttohide/actions/runs/34750201373)はLinux x64・Windows x64とも成功した。同梱Nodeで全コマンド、Seed 1／7の正常終局、Artifact取得、Replay一致を含む。長時間[Release Validation](https://github.com/plastichyena/nowherelefttohide/actions/runs/34749686774)は主要実装Commitでdispatchと各shard開始までを確認した。本項では最終結果を確認しておらず、成功済みとは扱わない。最終追補はBrowser Live SessionへのBuild identity引き渡しだけで、Core、Agent runner、Session CLI、長時間検証ロジックは変更していない。

## 18.10 v1.6.0 外部AIプレイ追補修正（2026-09-14）

- Claude Opus 5によるSeed 1・Turn 66・485 Decisionの公開Sessionプレイ報告を確認し、指摘された9項目を現行v1.6.0のまま修正した。`PLAY_WITH_AI.md`をv1.6.0へ更新し、Session作成時の`preferredCommentLocale`、単発／JSONL `play-turn`の純粋`preview`、全10コマンド、Compactの`supportHeadroom`を追加した。攻撃後移動、迎撃反撃のCharge、Gas致死Previewの再取得、Supply拡張直後の電力表示、Simple Farm上限・容量、人口供給順、opaque Unit ID、Soldier鎮圧損失も説明した。
- 国家Military Goods runwayはSupply内Unitと補充対象Army Baseだけを需要へ含め、Supply外Unitの不足を専用警告へ分離した。Civilian GoodsはMilitary Factory入力不足だけで維持不足のcriticalを出さない。Session Alertの`sourceRevision`は全応答でSession Revisionに統一し、Worker不要のWindを`productionStops`から除外、Simple Farmの`stoppedWorkers`を10、Wind上限を`2 * roadBranchCount`として機械可読APIと一致させた。
- `history` Queryは既定でCompact Decision記録を返し、重複する前後Observation／Legal Actionsの再構築を`includeSnapshots: true`へ分離した。報告SessionのDecision 150～195を既定条件で再計測し、従来164秒超から約10.6秒へ短縮した。完全Snapshotが必要な明示Queryでは従来どおりlossless復元とhash検証を維持する。
- 報告時の`corruptionRejections: 1`は、保存データ破損ではなくdestinationの形が不正なroute Queryを汎用`invalid`判定で破損へ誤分類した記録だった。入力・合法性エラーを除外し、保存構造・payload・hash・再構築の破損だけを同Metricsへ数える。不正route Queryで0を維持し、実際の破損では1になる回帰を確認した。
- ローカル通常回帰は91ファイル・825テスト成功、日次専用11件skip。型検査、本番Build、Browser Bridge production smoke、release report tool 8件、Balanced Seed 198が成功した。外部公開APIのSeed 1／7は10／8判断で通常敗北まで完走し、ArtifactとReplayが一致した。Windows最小Portableは13ファイルで、同梱Nodeから全10コマンド、単発／対話Preview、locale保持、Seed 1／7終局、Artifact、Replay一致まで成功した。
- 対象Commitは`0997ee74f7c0cdf0c046067f110d1fbee89cee63`。[通常CI／Pages Run 34793168538](https://github.com/plastichyena/nowherelefttohide/actions/runs/34793168538)は型検査、91ファイル・825テスト、Balanced Seed 1～30・198、Build、Browser Bridge smoke、Pages deployが成功した。独立した1,000 Action Jobは長時間枠として実行開始を確認し、本項では完了結果を成功済みと扱わない。公開URLのBuild ID一致、通常UIの新規ゲーム、Turn 2、autosave、reload後の継続、390×844で横overflowなし、console error 0件をPlaywrightで確認した。公開BridgeはApp `1.6.0`、Rules `10.0.0`、API `15.0.0`、Wind／Simple Farm上限、Simple Farm Capacity 10、`supportHeadroom`、EndTurn成功を返した。
- [AI Portable Run 34793175429](https://github.com/plastichyena/nowherelefttohide/actions/runs/34793175429)はLinux x64・Windows x64とも成功した。各Bundled Nodeで全10コマンド、単発／JSONL Preview、locale保持、Seed 1／7終局、Artifact、Replay一致、ZIP／証跡uploadまで確認した。長時間[Release Validation Run 34793175278](https://github.com/plastichyena/nowherelefttohide/actions/runs/34793175278)は512 MiBと複数Seed shardのdispatch・Job開始を確認し、完了は待たず成功済みと扱わない。サブエージェントは使用せず、`Doc/archive/`は現行判断に使用せず変更していない。

## 18.11 v1.6.1 実装・検証（2026-09-15）

本項はv1.6.1で変更した規則の正本であり、それ以前の節に残るv1.6.0以前の競合値より優先する。

- App `1.6.1`、Rules／State／Config `11.0.0`、Map `fixed-51x51-v6`、Save `18`、Agent／Observation／Bridge `16.0.0`、Artifact `15.0.0`、Session／Checkpoint `12.0.0`、Balanced `10.0.0`へ更新した。Random `6.0.0`、Play Turn Protocol `1.0.0`、Session Artifact Package `1.0.0`は維持する。v1.6.0以前のSave、Session、Checkpoint、Replay、Artifactは移行せず、対象を変更せずVersion mismatchで拒否する。
- Human UnitへRecon Teamを追加する。標準値はPopulation 5、HP 25、Recruit Attack 9、Regular／Veteran Attack 12、Movement 10、Vision 10、Range 6、Fuel 44、carried Military Goods 40、公開Noise Class `medium`、内部Noise Radius 6、EndTurn維持Military Goods 1、攻撃Cost 6、自動鎮圧Cost 1、鎮圧時民間被害50%である。CapitalとArmy Baseで編成でき、死亡時はSoldier Zombie 1 UnitへReanimationする。Board Legendは広い視界、長射程、比較的静かな攻撃を説明するが、正確なNoise Radiusは公開しない。
- Police／Riot PoliceのFuel上限は24、Soldier／Reconは44。通常移動Fuel Costは従来算式の2倍とし、Fuel 0のEmergency Movementは維持する。Police／Riot Policeのcarried Military Goods上限は10、Soldier／Reconは40。Police／Riot Police／SoldierのRange 1攻撃Costは2、Soldier Range 2は4、ReconはRange 1..6の全距離で6とする。既存3 UnitのRange 1は所持量0または1でも所持分を全消費し、標準20%、最低1の不足火力で実行できる。Reconは6未満なら攻撃不可である。Supply内自然回復はCombat等を行ったTurnが最大HP 5%、休息Turnが10%、Supply外は0%、Unit別切り上げとする。
- Screamer Zombieを追加する。標準値はHP 15、Attack 10、Movement 3、Vision 2、Range 1、最大Charge 1、Normal AIで、Human Reanimationや初期配置からは生成しない。通常個体はVisible Populationまたはinherited Horde Targetを初取得したとき1回だけ、Horde由来個体はMapへ実配置した直後1回だけScreamする。Screamは自身を中心とする内部Radius 30の`extraLarge` Noise Pulseで、fallen-site再Spawnは即時、他Zombieの反応は次回Zombie Phaseからとし、発生元自身は自分のPulseを取得しない。Production公開面は位置、発生元、正確なRadiusを隠し、Human UIは同一Phase内で集約した「悍ましい叫び声が響き渡った」／`A horrifying scream echoed across the area.`を表示する。Board Legendは視力が低く、人間を発見すると非常に大きな叫び声を上げることを説明する。
- Horde特殊Slot Weightは最後の2 Waveより前がNormal 65、Police 10、Soldier 10、Riot 5、Hunter 5、Screamer 5、最後の2 WaveがNormal 60、Police 10、Soldier 10、Riot 5、Hunter 5、Gas 5、Screamer 5。Screamerに方向別Capを設けず、Base rosterとRejected Refugee Bonusの両方へ同じ表を使う。
- 初期Normal Zombieは50。Capitalから8 Hex以上離し、主要Road Branch本線外、さらに本線非隣接を候補優先順とする。候補不足時だけ段階的に緩和するが、全初期Normal／Hunter／GasはArmy Baseから各UnitのVisionより遠く配置する。初期Hunter 1..4、Gas 1..2、Screamer 0と、Hunter／Gas固有のCapital距離を維持する。
- 標準WaveはTurn 10／20／35／50／70、方向数1／2／1／3／4、方向ごとのHorde数5／3／8／5／8、非Horde Slot数3／5／7／7／8。Warning Lead 2、Rejected Refugee Bonus、Pending、roster freeze、Final所属と勝利条件は維持する。固定Horde数だけ従来値の1.5倍を切り上げ、全ScheduleのBase Horde 66、Slot 73、Base Total 139、Final Base 64とする。
- v1.6.0のNorth `(26,13)`、East `(37,24)`、South `(24,37)`、West `(13,26)`の4候補から、Game Seed、Map ID、候補を使う独立決定抽選でOil Fieldを1基だけ選ぶ。選択候補のFacilityと1-Hex access spurだけを生成し、未選択候補へFacility、spur、Survivor、Worker、報酬、Vision、Oil creditを作らない。配置選択はGameplay RNGを消費せず、Save／Artifactは実位置を保持してLoadで再抽選しない。全国共有Refinery Allowanceの初期値は2000で、`remaining = initial + oilCreditsEarned - fuelRefined`を維持する。Player-built Wind Power Plantの標準建設費はCivilian Goods 150、Generation 15、建設上限`2 * roadBranches.length`、初期Windを上限外とする規則は維持する。
- ゲーム開始時、中立である全恒久Facilityへ、`Game Seed + Map ID + Facility ID`の独立決定値で1..10を等確率抽選し、健康人口上限でclampしたSurvivorを配置する。Gameplay RNGは消費せず、同じFacility IDの値は施設列挙順や別Facilityの追加に影響されない。Player Turn 10中までの確保では残存者を健康人口として引き継ぎ、救出Eventで初めて人数を公開する。10回目EndTurnのRefugee処理後、通常感染処理前まで未確保なら残存健康Survivorを感染者へ全員変換し、同じEndTurnの感染・陥落処理へ接続する。確保前の正確な人数、期限、残りTurn、抽選範囲、公開人口差分による逆算は禁止し、可視Facilityでは早期確保報酬の可能性または失効だけを定性的に公開する。未確保SurvivorはZombieから可視なら既存Visible Population Targetになる。
- 未確保Army BaseもSurvivor対象とし、健康Survivorが残り、感染者0かつ`disabled / ruined`でない間、各Zombie Phaseに健康Survivor数と同回数の迎撃を行う。Attack 10、Range 2、1射Military Goods 2、Noise Radius 8、距離0連射等はPlayer所有時と同じで、専用Military Goods 40から消費し未確保中は補充しない。視界外の迎撃は非公開、視界内は定型EventとSurvivor残存可能性だけを公開する。無償Soldier報酬はPlayer Turn 10中まで、確保時に健康Survivorが1人以上あり、未確保中に一度も`disabled / ruined`へ移行していない場合だけ成立する。期限、陥落、全滅による失効は不可逆である。
- Checkpoint Policyへ`deny`を追加する。切替時に既存waitingへ切替直前Policyをgrandfathered Policyとして固定し、既存screening／approvedも維持する。切替後の新規Arrivalだけを同Refugee Phaseで全員Turn Awayし、Final roster freeze前だけ既存Rejected Counterへ加算する。`SetCheckpointPolicy`は1 Actionを消費し、自動拒絶は追加Actionを消費しない。
- Checkpointの健康なwaitingをWとし、Turn末に`min(100, max(0, W - 100))%`を翌Turn用としてCheckpoint IDへ予約する。次のRefugee処理で予約を先に1回解決し、成立時は1..5人の等確率抽選を現在waitingでclampして感染へ移す。対象消滅またはwaiting 0でも0人として予約を消費する。その後、既存screening、通常／grandfathered waitingのscreening開始、新規Arrival、deny自動拒絶、翌Turn用予約の順で処理する。移設、Role、Policy変更では予約を取り消さない。予約Risk %は公開するが未成立の感染人数は公開しない。
- 感染陥落FacilityがNoise Pulseを受けて感染人口から再Spawnする場合、生成UnitごとにNormal 70%、Gas 10%、Hunter 10%、Screamer 10%で決定抽選する。Police、Riot、Soldier、Hordeは除外し、Screamerは`hasScreamed=false`で生成する。初回陥落Spawn、Human Reanimation、Scheduled Horde rosterはこの表へ置き換えない。
- Human UIはAI Play Watch入口をタイトル／メインメニュー限定とし、ゲーム中の盤面やBottom Sheetへ固定表示しない。Constructible Facility候補はUnit編成と同系統のAccordionで費用、所要Turn、Worker、電力、入出力、固有性能、上限、残枠、選択HexのCore合法性理由をConfig／Queryから表示する。Refinery詳細はInitial Allowance、Oil Credits Earned、Fuel Refined、Remaining Allowanceを全国共有ledgerとして表示する。Recon／Screamer、4 Policy、grandfathered Queue、waiting Risk、Survivor定性情報、未確保Army Base迎撃Event、新Wave、回復、Fuel／Military Goods、Oil Field 1基、Allowance 2000、Wind費用150をHelp、Agent、Replay、Live Viewerへ公開境界を守って反映する。
- ReconとScreamerの正規盤面Assetはそれぞれ`public/assets/board/units/unit_recon_team.png`、`public/assets/board/units/unit_screamer_zombie.png`の透過256×256 PNGとし、Asset Registry、Board、Legend、Replay、Live Viewerで同じTypeへ解決する。Runtime PNG合計3 MiB以下、個別Fallback、低Zoom LOD、GameState／RNG非干渉を維持する。
- Core受入試験はv1.6.1のVersion境界、Oil Field独立選択、Survivor決定性・非公開・期限、Checkpoint deny・grandfathered Queue・waiting Risk、Screamer Scream、Recon Combat、Army Base迎撃・報酬、Wave、回復、Fuel／Military Goods、fallen-site抽選、Save round tripと旧Version拒否を実Actionと不変条件で検証する。公開・配布の完了結果は本項へ同Revisionのローカル検証、GitHub Actions、Pages実ブラウザ、Linux／Windows AI Portable、Release Validationの実績として追記し、開始だけを成功として扱わない。
- ローカル通常ゲートは長時間専用2ファイルを除く199 suitesで832テスト成功、失敗0、環境変数指定時だけ動く11テストはskip。v1.6.1 Core受入8件、追加のUI／Asset／Browser境界72件、型検査、本番Build、Release再利用ガード3件、production Browser Bridge smoke、外部AI Seed 1の終局・Artifact・Replay一致が成功した。Windows最小Portableは13ファイルで、同梱Nodeと`run-session.cmd`から全10コマンド、Seed 1／7の通常敗北までの終局、Artifact、Replay一致を確認した。
- ローカル本番Buildの実ブラウザは390×844で横overflowなし、console error 0、タイトルだけのAI Play／Watch入口、Human Game中の同入口非表示、Turn 10／20／35／50／70表示、Construction AccordionのWind費用150、Recon／Screamer Board Legend、EndTurnによるTurn 2 autosave、reload後の継続を確認した。これはPC上のChrome viewport検証であり、実機スマートフォンのRAM測定ではない。

## 18.12 v1.6.2 実装と検証記録

- 確定アップデート要件のINIT-CP-01..02、MAP-01、INIT-FAC-01、CP-COST-01、INIT-POP-01、INIT-UNIT-01、INIT-RES-01、INIT-Z-01..02、HOUSE-01、REF-01、OBS-01、API-01..04、DOC-01、AGENT-01、PERF-01..02、CI-01..02、COMPAT-01を実装。初期条件・容量・費用・公開差分・入力境界・Version境界は本文へ反映した。
- DOC-01の編成枠は2026-09-19の依頼者回答に従い、拠点ごとに予約1件、Army Base無償報酬は枠不使用という既存Coreを維持した。
- ローカルの型検査、production build、Browser Bridge smokeが成功。通常回帰で検出した6件の旧初期条件依存fixtureを修正し、該当範囲85件が成功。Play-turn 20件、施設人員損失、初期条件／Housing／Checkpoint／Strict、Agent判断、入力拒否／Query契約を確認した。日次専用の11件と長時間専用2ファイルは通常ローカル回帰対象外であり、GitHubの専用Jobに委ねる。
- Windows Portableは同梱Nodeで全10コマンド、 malformed Previewの状態不変拒否、Seed 1（14 Decision）／7（13 Decision）の正常終局、Artifact出力、Replay一致が成功。Checkoutとの同一操作契約比較も成功。cold build約0.18秒、warm status 10回のmedian約3.13秒／p95約3.32秒、warm再buildなし（ローカルNode 22.14.0、Windows）。GitHub-hosted Linux／Windowsではworkflowが性能・Package寸法・Session保存量の証跡を別途生成する。
- Playwrightの実ブラウザでv1.6.2新規ゲーム、Turn 2、自動保存v19、reload後の継続、390×844の横overflowなしを確認した。GitHub Pages公開版とLinux／Windows Portable workflowの結果確認は配信対象Commitに対して実施する。
- 長時間GitHub workflowは依頼者指定により起動確認までとし、結果監視・完了保証は行わない。
- Doc/archiveは履歴として参照・変更せず、反映済みの確定要件は今回の依頼条件によりDoc直下に保持する。

- 追加検証: 実際のPolice編成でCapital 51→46が損失として誤報される失敗を再現し、公開`population_conscripted.sources`に基づく除外で同じテストが成功。施設差分／Session／Replayの関連11件と型検査が成功。

### 2026-09-20 長時間検証の修正

- Commit `569c058`の通常CIはSession 1,000 Action検証のみがFull Snapshot不一致で失敗した。Core内部のAlert `sourceRevision`とSession応答Revisionの相違を1 Actionで再現し、現行仕様のSession応答契約に従って期待値を応答Revisionへ写して全項目比較するよう検証側を修正した。誤ったRevision、資源、合法Action集合は引き続き不一致として拒否する。
- 同CommitのRelease Validationは200ゲーム・Replay集約が成功し、物理512 MiB検証が6時間上限で停止した。自動Checkpoint確認で毎Action前後に過去の全Checkpoint payloadを検証し直す処理を、決定的IDで現在必要なCheckpointだけ検証する処理へ変更した。明示的な一覧・読込の検証、現在のCheckpoint破損拒否、過去Checkpointからの分岐は維持する。Action件数、物理512 MiB基準、圧縮設定、Job時間上限は変更しない。
- 修正前にSnapshot比較と過去Checkpointの再読込を回帰テストで失敗として確認し、修正後は新規3件・既存関連43件と型検査が成功した。日次専用11件は環境変数未指定のためskip。修正後のGitHub Actionsは依頼者指定に従って再実行のみとし、結果を監視せず、完了済みとは扱わない。
- Windows／Node 22.14.0の小規模通し検証では通常6 Action＋分岐1 Action、大容量モード30 EndTurn＋分岐1 Actionが完了し、Full Snapshot、同一状態の長短履歴比較、Artifact出力／読込／Replay一致を確認した。大容量モードの公開Artifact実容量は19,896,196 bytesであり、512 MiB全体の結果の代用にはしない。Portable用CLIのbundleも成功した。


## 18.13 人口衛生・水域・原発・特殊部隊の現行詳細

本節は人口衛生・水域・原発・特殊部隊の詳細規則をv1.6.5時点へ統合したもの。旧版の差分を本文より優先させるのではなく、第1〜17章と同じ現行ルールを説明する。末尾の18.13.17だけはv1.6.3当時の検証記録である。

### 18.13.1 実装境界

GameAction → GameEngineと公開Projectionの境界を維持する。共通Unit catalogはHuman7種・Enemy9種の16種。Versionと旧データ非破壊拒否は18.15.16に従う。

### 18.13.2 Context Handoffの具体的上限

施設24、Player Unit24、可視敵24、重要変化20、直近の重複しないacceptedコメント5、Checkpoint8、各コメント500 Unicode code points。原因と重大度で危機を集約し、重大な危機の存在を上限で落とさない。全canonical historyと分岐前履歴を保持し、詳細QueryをRevisionへ固定する。

### 18.13.3 Capital最低1名

- `TransferPopulation`、`AssignWorkers`等のSupply population withdrawal、`ProduceUnit`の人口予約・徴兵、その他Player起因の人口再配置でCapitalを0人にしてはならない。
- 共通withdraw可能数はCapitalについて `max(0, workers - 1)` とする。他の合法Supply Cityから必要人口を確保できる場合は成立させる。既存のwithdraw順序は、この保護分を除いて維持する。
- 保護すると必要人口が足りない場合は `capital_minimum_resident_required` で拒否し、資源・人口・RNG・予約を変化させない。
- 感染、飢餓、敵対Event等の非自発的損失では最後の1人も失われる。Capital健康人口0は合法なStateであり、陥落・敗北は既存条件で判定する。
- 説明: 「州都の行政・避難機能を維持するため、健康な住民を最低1人残す必要があります。」
- 人口操作Previewに `capitalResidents.before / after`、`capitalMinimum = 1`、`capitalResidentDelta`、拒否reason、食料・民需品・衛生リスクの変化を表示する。
- Capital=1はAdvisory、0は既存のCapital exposureと組み合わせCritical。保護が敵や飢餓への無敵化ではないことを明記する。

### 18.13.4 審査・待機列・潜伏感染

#### 18.13.4.1 審査方針

| Policy | Screening Turns | 審査による受入率 | 審査由来の1人あたり潜伏感染 |
| --- | ---: | ---: | --- |
| Pass Through | 0 | 100% | 基礎25%、18.13.4.2の補正あり |
| Normal | 2 | 100% | 5%固定 |
| Strict | 5 | 100% | 0%固定 |
| Deny | 0 | 0% | 審査を実施しない |

`workerRate`は順に1 / 1 / 1 / 0。審査定員は既定20人。方針は審査開始時に固定し、方針変更を進行中Batchへ遡及しない。

審査はある程度清潔な環境で感染を確認し、疑わしい人へ適切な医療を行い、受入可能な健康状態に整える工程。Normalは観察期間が短く一部が残り、Strictは5 Turnの観察・隔離・医療等によって審査由来潜伏感染を0にする。医療は時間と既存Civilian Goodsの抽象表現に含め、独立Resourceや治療Actionを追加しない。

100%受入は「審査不合格による人口除去なし」を意味する。飢餓・待機中感染・Zombie直接感染等の損失まで防ぐ保証ではない。Normal / Strictの審査拒否Counterは増加させず、明示的なTurn Away / Denyによる拒絶だけを既存の将来Horde加算へ渡す。Final roster freeze後のCounter規則は維持する。

#### 18.13.4.2 Pass Throughの補正

Normalの5%、Strictの0%には混雑・衛生ストレスの補正をかけない。Pass Throughだけ、審査・医療を省略するため次を使う。

```text
Q = clamp(waiting / screeningCapacity - 1, 0, 1)
F = 更新後のpublicHealthStress.food
C = 更新後のpublicHealthStress.civilianGoods
p_pass = clamp(0.25 * (1 + 0.50*Q + 0.75*F + 1.00*C), 0, 0.60)
```

waitingは該当するrelease処理の直前の健康な待機者数。screening / approvedを過密人数へ含めない。未管理支線の素通りは架空のQueueを作らずQ=0とし、F/Cの補正は適用する。Player Turn Startで既に合格した人を配置するだけの場合、潜伏感染を再抽選しない。

#### 18.13.4.3 発症先・人数

- 各受入先へ実際に配置した人数nについて `Binomial(n, p)` をSeed付きで1回判定し、その受入先の健康人口から同数を感染者へ変換する。
- 複数都市に分けて受け入れた場合は、各都市の実際の受入人数を使う。無関係な所有施設を発症先として抽選する既存方式は廃止する。
- 受入先がなくapprovedとなった分は、当該Checkpoint内で判定する。そのBatchのapproved人数の範囲だけを感染者へ変換し、別Batchやscreening / waitingへ不足分を波及させない。
- 一度判定済みのapprovedを後に都市配置しても再抽選しない。感染者自体を健康な合格者として都市へ送らない。
- 発症後は18.13.5.7の猶予を付ける。Strictから受け入れた人も、受入後の生活環境による内部感染は既存住民と同条件で受ける。

#### 18.13.4.4 待機列の衛生悪化

感染対象・過密人数は **waitingのみ**。審査中・受入先待ちは清潔な管理環境にあり、この衛生悪化判定の対象外とする。Zombieの直接感染や感染者からの既存の感染拡大に対する免疫を与える規則ではない。

```text
rawQ = max(0, waiting / screeningCapacity - 1)
p_wait = clamp(0.01 * rawQ * (1 + 0.50*F + 1.00*C), 0, 0.12)
newWaitingInfected ~ Binomial(waiting, p_wait)
```

F/Cは当EndTurn更新後の値。各Checkpointについて通常の到着・審査・配置処理を終えて残ったwaitingを対象に1回判定する。移設等で残ったRemnantのwaitingも対象とし、同じ人口へ同Turnに二重適用しない。Deny時の既存Queue等は現行の人口保持規則に従う。

衛生ストレス0なら、waiting20人以下は0%、40人1%、60人2%、100人4% / Turn。補正後の上限は12%。既存の固定waitingRiskThreshold=100の段差・旧感染予約との二重判定を廃止する。

感染が判明した人はCheckpoint infectedへ移し、審査で健康人口へ戻さない。審査で対応できる潜伏感染とは区別する。新規感染には18.13.5.7の感染拡大猶予を付ける。

### 18.13.5 衛生ストレス・食料不足・内部感染

#### 18.13.5.1 感染の三層

- **直接Zombie由来**: 接触・攻撃・Gas爆発、既存Unitの再アニメーション、陥落時Spawn等は既存処理を維持する。新規Special Forcesの再アニメーションは18.13.11〜18.13.12。物資や衛生ストレスで直接感染量を減らさない。
- **検問所由来**: 18.13.4の待機列感染と審査由来潜伏感染。
- **生活環境由来**: Food / Civilian Goods不足、Permanent City過密、Temporary Housing停電による新規内部感染。Exposure meterは追加しない。

#### 18.13.5.2 不足率

```text
foodDeficit = maintenanceRequiredFood > 0
  ? clamp(foodMaintenanceShortage / maintenanceRequiredFood, 0, 1) : 0
cgDeficit = maintenanceRequiredCG > 0
  ? clamp(civilianGoodsMaintenanceShortage / maintenanceRequiredCG, 0, 1) : 0
```

不足量はそのTurnの備蓄と実際に利用できる生産を維持需要へ充当した後の未充足分。過密・Housing outageの追加維持費を含む。Military Factory入力不足はcgDeficitへ含めない。維持予約と生産・入力配分は現行のForecast共通処理を利用する。

感染者は従来どおり食料・民需品の通常維持消費・飢餓死亡の対象外。Unit人口は飢餓対象外。過密の占有人数と追加費用は18.13.6の別計算であり、感染者に通常維持費を新設するものではない。

#### 18.13.5.3 衛生ストレス

GameStateに `publicHealthStress.food / civilianGoods` を保持し、初期値0、範囲0..1とする。

```text
S_next = clamp(0.75 * S_current + 0.40 * deficitRatio, 0, 1)
```

不足計算後に同じEndTurn内で更新し、そのTurnの各確率へ反映する。生産0で即座に1へ跳ね上げる例外は設けない。供給が足りれば毎Turn25%ずつ減衰する。食料の飢餓用蓄積とは別の値である。

#### 18.13.5.4 食料不足蓄積と飢餓

GameStateに食料不足蓄積Aを保持し、初期値0、下限0、上限7とする。

```text
A_next = foodDeficit > 0
  ? min(7, A_current + foodDeficit)
  : max(0, A_current - 0.5)

starvationRate = foodDeficit > 0
  ? min(0.10, foodDeficit * max(0, A_next - 2) * 0.02)
  : 0
```

- 更新後Aが2を超えた不足Turnから死亡率が正になる。A=0から不足率一定なら100%不足は3Turn目、50%は5Turn目、25%は9Turn目。端数繰越のため、実人数の最初の死亡は人口によって後になる。
- 全量供給できたTurnは直接死亡を止め、Aを0.5減らす。最大14Turnの十分な供給で0に戻る。一部でも不足なら回復させず不足率を加える。
- 生産が1以上あっても例外にしない。必要100・供給1なら不足率99%として蓄積する。
- Civilian Goods不足による直接死亡は廃止する。民需品不足は衛生悪化・感染を通じて被害を生む。
- 食料生産0でも直ちに従来の不足人数死亡へ戻さない。

#### 18.13.5.5 飢餓死亡人数・配分

対象はPlayer所有施設の健康な住民・労働者、および維持対象のCheckpoint waiting / screening / approved。感染者、Unit、未受入の州外人口は含めない。その経済フェーズで維持対象になった人口にだけ適用し、後の避難民フェーズで到着する人へ過去の食料不足を遡及しない。

細部は次の決定的な共通規則で実装する。

1. 飢餓適用直前の対象健康人口合計をNとする。鎮圧等で既に失われた人口は含めない。
2. 国家単位の端数carryを初期0で保持する。死亡率が正なら `raw = N * starvationRate + carry`、`loss = min(N, floor(raw))`、`carry = raw - floor(raw)` とする。
3. lossを各対象Poolの健康人口比で配分する。比例配分の整数部分を先に割り当て、残数は剰余降順、同値は安定した対象ID・Pool順で割り当てる。実人口を超えず、合計lossと一致させる。
4. 死亡率0のTurnは死亡なし、carryを保持する。対象人口N=0ならcarry=0。carryは0以上1未満でSave / Replay対象。施設ごとの切り上げや人口分割・移住による全国端数消失を認めない。
5. 死亡は原因 `starvation` の死亡人口・既存不足損失統計へ一度だけ計上し、感染者やZombieへ変換しない。Capital最後の1人も免除しない。敗北は既存条件どおり判定する。

#### 18.13.5.6 生活環境由来の新規感染

健康人口のあるPlayer所有Facilityごとに計算する。都市・生産施設・Army Base・原発・Housing等を含み、施設の生産停止中・Supply外という理由だけで感染を免除しない。

```text
O_i = Permanent Capital / CityのovercrowdingPressure (0..1)、他は0
H_i = 入居中Temporary Housingがoutageなら1、他は0
P_i = clamp(0.45*F + 0.65*C + 0.35*O_i + 0.25*H_i, 0, 1)
p_internal_i = 0.03 * P_i^2
newInternalInfected_i ~ Binomial(healthyWorkers_i, p_internal_i)
```

- F/Cは更新後の衛生ストレス。最大1人3% / Turn、P=0なら発生しない。
- 物資不足がなくても、過密だけ・Housing停電だけで発生する。
- 駐留部隊がいても新規感染判定を行う。駐留による既存の感染拡大封じ込めと、自動鎮圧は維持する。
- UnitとCheckpointの3健康Poolにはこの施設用抽選を重ねない。
- 同Turnに都市へ受け入れた健康人口も対象。審査由来感染に変換済みの人数を再抽選しない。
- 変換は健康人口から既存infectedへの移動とし、人口を生成しない。新規感染には18.13.5.7の猶予を付ける。

参考: ストレス0・都市人口が定員の2倍なら0.3675%、ストレス0・Housing停電なら0.1875%、CGストレス1のみなら1.2675%、Food/CGとも1なら3%。これは疫学値ではなく初期ゲーム係数である。

#### 18.13.5.7 新規感染の猶予・既存感染との共存

対象は生活環境由来、待機列由来、Normal / Pass Through潜伏感染。Turn Tに発生した対象感染者は、Turn Tの感染拡大人数の算定から除外し、Turn T+1のEndTurnから含める。

- 健康人口から感染者への変換、感染による施設機能への影響、健康人口0による陥落・敗北判定は即時。生産済みの資源を遡って取り消す意味ではない。
- 陥落条件を満たした場合は、感染者由来Spawn・連鎖を含む既存の陥落処理を猶予で止めない。
- 対象感染者数と感染拡大可能になるTurnを保存し、既存infected合計の内数として管理する。既に感染拡大可能な感染者まで猶予を延長しない。
- 鎮圧・陥落Spawn等で感染者を減らした場合は合計と猶予内数を整合させる。内数の消費順は感染の古い順、同Turn内は安定順とし、感染拡大対象の復活や二重計上を起こさない。
- Zombie接触・攻撃・Gas爆発による直接感染は猶予を追加せず、既存の処理時点・感染量を維持する。
- 猶予終了時も駐留があれば、既存の感染拡大封じ込めを適用する。猶予は直接感染や新たな生活環境由来感染を防ぐ免疫ではない。

#### 18.13.5.8 EndTurnへの統合順序

既存の大枠を維持し、次の順序をCore・Forecastで一致させる。

1. 経済開始時の維持需要・局所過密・Housing outageを確定。電力・生産・資源配分と不足量を計算する。
2. 衛生ストレスと食料不足蓄積を更新する。
3. 既存の携行軍需消費・補充・自動鎮圧を行い、残存健康人口へ飢餓損失を適用。既存の終局条件を確認する。
4. 避難民到着・審査・受入先への配置・潜伏感染、残waitingの待機列感染を更新後ストレスで処理する。
5. 施設ごとの生活環境由来感染を判定し、既存の内部感染拡大を猶予対象人数を除いて処理する。各感染変換で陥落・Fallback・敗北を既存どおり評価する。
6. 通常Zombie Phase、直接感染、Scheduled Wave / Pending Spawn、最終勝敗判定を既存順序で処理する。

同じフェーズ内はID等の安定順。終局確定時の打切りは現行規則に従う。PreviewはRNGを進めず、確定的な飢餓損失と確率による感染を区別する。先行する確率的変化で後続結果が変わる場合、条件付き予測として示し、確定結果と偽らない。

### 18.13.6 過密の局所維持費

Permanent Capital / Cityごとに次を計算し、全国追加消費は施設ごとの合計とする。

```text
N = healthy workers + infected
C = workerCapacity (>0)
E = max(0, N - C)
R = E / C
extraFood_i = ceil(E * foodPerPerson * 0.50)
extraCivilianGoods_i = ceil(E * civilianGoodsPerPerson * (1 + R))
overcrowdingPressure_i = clamp(R, 0, 1)
```

全国の通常維持費へ都市の超過率合計を乗じる方式は廃止する。Food追加は比較的小さく、CG追加は超過率に応じて非線形に増える。感染者を含む占有による混雑負担と、健康人口だけの通常維持費は別項目で表示する。

Temporary Housingは健康人口＋感染者のHard Cap10を維持し、この過密式の対象外。停電追加維持費は既存の独立計算を維持する。生産施設もHard workerCapacityを維持し過密式の対象外。Forecastに施設別occupancy / capacity / excess / extraFood / extraCivilianGoods / healthPressureを返す。

### 18.13.7 Refinery Allowance事前警告

既存の `refinery_allowance_exhausted` を維持し、稼働・給電等を反映した次EndTurn Forecastから次を導出する。

```text
netBurn = max(0, projectedAllowanceUse - projectedAllowanceGain)
estimatedTurnsRemaining = netBurn > 0
  ? floor(currentRemainingAllowance / netBurn) : null
```

- 次EndTurnに正のnetBurnで残量0へ到達するならCritical。
- 上記以外でestimatedTurnsRemainingが3以下ならWarning、4以上ならなし。
- netBurn=0ならrunway警告なし。既に枯渇している停止理由は別のexhausted警告で伝える。
- `refinery_allowance_runway_risk` として残量、予測使用量、Oil Field増分、netBurn、残りTurn目安、稼働Refinery/Oil Field workersを公開する。
- 現在条件を維持した場合の目安であり、未来の稼働・確保・喪失を保証しない。Strategic Forecastも同じ値を使用する。

### 18.13.8 Agent Context Handoff

#### 18.13.8.1 責任範囲・生成条件

ゲームは引継ぎ用の構造化公開データを生成・提供する。外部AIの会話履歴そのものを削除・強制圧縮しない。Callerには引継ぎ後に古いtool全文を再読せず、必要な詳細だけhistory等から取得するよう案内する。

- completed Turn数が5の倍数となった時点で自動生成する。
- 前回の永続化済みContext Checkpointからcanonical Decisionが128件増えた時点でも必ず自動生成する。Turn途中も対象。正式Decision番号が付く拒否は含み、Query / PreviewやrequestId再送は数えない。
- `query --target=context-handoff` で手動生成できる。
- `status` / 新しい`play-turn`開始時はその時点の最新Revisionの公開状態から再構成する。保存済みCheckpointの古い現在状態をそのまま返さない。
- 読取要求や手動生成は自動生成のDecision基点をリセットしない。5Turnと128件が同時なら1つの自動Checkpointに両理由を付ける。

#### 18.13.8.2 構造

| 項目 | 内容 |
| --- | --- |
| durableConstraints | preferredCommentLocale、Fair Play、公開境界、Session ID / revision / branch lineage、Game / API versions |
| authoritativeState | 最新の公開Turn/phase、資源・人口、Capital、衛生・飢餓、施設・部隊・可視敵の概要、Horde予告、危機、Supply、Allowance |
| recentImportantChanges | 直近の自動Context Checkpoint以降の重要な公開変化。上限付き |
| agentIntent | 最新accepted EndTurnのdecisionSummaryと、重複を除く直近の非空accepted decisionSummary最大5件 |
| historyHint | Revision-pinnedな詳細Query / historyへの導線、省略数、続きの取得方法 |

現在状態は毎回Coreの公開Projectionから生成し、前回の要約を再要約しない。コメントは公開意図であり事実源ではない。private chain-of-thoughtを要求・保存しない。parent branchの分岐後historyを混入させない。

#### 18.13.8.3 情報量と公開境界

- 施設・部隊・可視敵・重要変化の配列に明示的上限を設け、合計数・返却数・省略数と詳細Queryを返す。上限をschemaで公開し、履歴長に比例して増やさない。
- 差し迫った敗北条件、重大な警告の種類・重大度・対象件数は必須。対象が多い場合は原因別に集約し、危機の存在を省略しない。個別対象の続きはQueryから取得する。
- preferredCommentLocaleとFair Play等の制約は切り捨てない。Human向けコメントとdecisionSummaryをSession全体で指定言語に維持するようHelpへ明記する。
- Hidden Enemy、RNG state、非公開のFinal Pack割当等は含めない。公開Handoffを「Core truth」と呼ぶ場合も非公開State全体を返す意味ではない。

#### 18.13.8.4 純粋性・保存

State / RNG / Session Revision / Decision番号 / canonical hash chain / Artifactは生成操作で変化させない。HandoffはSessionの派生public payloadとして保存・再生成可能とし、canonical Decision Log、Replay、全history、lineage、checkpoint hashesを削除・改変しない。read-only要求によるキャッシュはcanonical commitと分離する。

### 18.13.9 水面・橋・湾

#### 18.13.9.1 移動・建設

- `terrain.movementCost.water = null`。全Current UnitのmovementDomainはgroundとし、水面のみのHexへ進入不可。
- WaterにRoad overlayがあるHexはBridge、Ground移動cost1。道路判定をbase terrain nullより先に適用する。
- Player Move、Zombie pathfinding、route / reachable / AI path cost、spawn legality、Preview、Strategic Mapは共通passability helperを使用する。raw terrain nullを直接見てBridgeを拒否する残存コードをなくす。
- WaterもBridgeも施設・Checkpoint・有刺鉄線等の建設不可。移動可能判定をそのまま建設可能判定に流用しない。
- 橋はMap生成時に配置され、Playerによる新設・破壊・撤去等の干渉は対象外。Road overlayを水面の上へ描画する。
- 移動境界はUnit movement domainを受け取れる形にするが、air Unit本体や飛行ルールを追加しない。

#### 18.13.9.2 水域と原発の距離条件

固定51×51 Mapのtop-left / top-right / bottom-left / bottom-rightから、独立したMap-layout RNGで均等に1方向を選ぶ。固定の不規則な連結水域template1種類を反転・回転して適用する。

- 水域はMap端につながる小規模な湾。マップの大部分を占めない。多少歪でも原発の距離・供給条件を優先する。「内側6〜10 Hex」を固定の制約にしない。
- 原発は初期Supply外とし、かなりのSupply延伸が必要だが、Map端の進入禁止ゾーン直前まで延ばす必要がない位置を選定する。
- 既存の確保・Checkpoint等の合法操作で原発をSupply内へ維持でき、4方向で到達距離とSupply維持負担が概ね等しくなる配置にする。
- Capital、中央幹線交差部、4方向中央Horde Entrance、既存恒久FacilityをWaterで上書きしない。Forest / MountainよりWaterをbaseとして優先する。
- 原発までのLand / Bridge経路を確保する。道路生成によって水域全体が通行可能になる配置にしない。
- Map IDを更新し、Water0という旧validationを廃止。template確定後の期待Water数・連結性・4方向の配置制約を検証する。

水域は54 Hex。基準templateはr=0..16、幅[5,5,4,5,4,4,3,4,3,3,3,2,3,2,2,1,1]、中心q=11+floor(6*r/16)。各行は中心からfloor(width/2)だけ左へ寄せた連続Hexとする。右上はq→58-q、下側は(q,r)→(50-q,50-r)で変換する。Bridgeは基準r=12、q=13..17の道路接続を同じ変換で配置する。

| 湾 | 検証Seed | 原発(q,r) | Capitalから距離 / 地上cost | Supply前線例 | Reserve余裕 | 実確保Turn |
| --- | ---: | --- | --- | --- | ---: | ---: |
| 左上 | 6 | 17,17 | 16 / 16 | north 25,9 | 8 | 2 |
| 右上 | 1 | 41,17 | 16 / 16 | east 41,25 | 8 | 3 |
| 右下 | 3 | 33,33 | 16 / 16 | east 41,25 | 8 | 2 |
| 左下 | 4 | 9,33 | 16 / 16 | west 9,25 | 8 | 2 |

`scripts/v163-map-evidence.ts`は標準Configで実際の合法Moveによる確保を検証し、初期敵のみ0の別シナリオで合法RelocateCheckpointによる供給到達を検証する。地上経路と操作列は同スクリプトのJSON出力に記録する。既存恒久施設とReserveを維持する。

### 18.13.10 原子力発電所

#### 18.13.10.1 配置・発電

Typeは `nuclearPowerPlant`、1ゲーム1基、Neutralで開始する。選択された湾のWaterに隣接するLand Hexに置き、Spawn Reserveへ置かない。既存施設間・secondary road生成対象へ含め、専用直線道路を追加しない。

初期workers=0 / infected=0、Neutral survivor抽選対象外。workerCapacity=5、500 electricity / worker（最大2500）、Fuel / input Resource消費0、requiresPower=false。

発電はPlayer所有、感染なし、通常稼働、workers>0、**Supply内**の全条件を必要とする。感染・復旧・新規確保等の操作可能時点は既存施設規則に従う。Supply外では発電0とし、停止原因と失う発電量をForecast・警告へ反映する。

Fuel不要の発電Capacityとして既存Power allocationへ統合し、Fuelを消費するPower Plantは無料供給を差し引いた不足分だけを補う。送電経路や電線という新システムは追加しない。原発に新たなSupply源機能や特別な放射能・メルトダウン事故は追加しない。

#### 18.13.10.2 期限内報酬

- Turn10のPlayer行動終了までに一度でも初回確保すると、Regular Special Forces1隊を獲得する。
- Supply外の確保でも報酬を得る。以後原発を失っても報酬権は維持し、再確保で重複付与しない。
- HP50、Fuel44、MG40、Regular attack charges3、通常の移動・行動権を満タンで付与。国家備蓄から支払わず、そのPlayer Turnから移動・攻撃可能。
- Population5は外部援軍として実際のUnit配置時にcumulativeReinforcementsへ一度だけ加算する。配置待ちは人口を二重に生成しない。
- 原発Hexが空きかつ合法なら優先し、それ以外は最寄りの合法Ground Hexへ配置。同距離は既存の決定的な配置順を使う。BridgeはGroundとして許容し、水面は不可。
- 候補がなければ報酬をpendingとして保持し、以後のPlayer Turn Startに再試行する。期限後でも期限内獲得のpendingを失効させない。配置待ち・獲得済み・失効を保存し、再送・Loadで重複生成しない。

#### 18.13.10.3 未確保時

Turn11のPlayer Turn Startで一度も確保していなければ報酬をexpiredへ確定し、原発位置へPack Zombie1隊を生成する。占有されていれば最寄り合法Ground Hexへ決定的にfallbackする。全候補が塞がっている場合も生成権を1件保持し、次のPlayer Turn Startで再試行し、消失・重複させない。

Turn11開始時に生成された個体は、Playerの行動機会を挟み、Turn11終了のZombie Phaseから行動する。後日pending配置された場合も、そのPlayer Turn終了のZombie Phaseからとする。Turn11以降の確保では特殊部隊を付与しない。

期限内確保後の喪失ではこのペナルティを発生させない。Hiddenでの実出現は通知せず、Visibleになった時に通常の敵情報として公開する。内部pending状態からHidden位置を推測できる公開Fieldを作らない。

#### 18.13.10.4 説明・警告

ゲーム開始時から期限と報酬・未達成結果を説明する。プレイヤー向け背景例:

> 原子力発電所は州の電力供給を支える重要施設だ。最後の通信では、精鋭部隊が守備に就いていた。現在、彼らの生死は不明。高い身体能力を持つ者が感染した場合、極めて危険な存在になるおそれがある。

背景に加えて「Turn10までの初回確保で特殊部隊合流」「未確保ならTurn11にPack Zombie出現」を明示する。期限情報は常時参照可能にし、残り5Turn以内はWarning、最終のTurn10はCriticalとして通知する。既に獲得権確定なら期限警告を解除する。期限切れ通知と、Hidden個体の実出現通知を区別する。

### 18.13.11 特殊部隊

Typeは `specialForces`。生産不可、`recruitmentFacilityTypes = []`。Player入手経路は原発またはAir Baseの期限内確保報酬。原発はSurvivor条件なし、Air Baseは健常Survivor生存かつ未確保陥落なしを必要とする。既存Human Unit共通の移動・戦闘・補給・回復・熟練度を適用する。

| Stat | Value |
| --- | ---: |
| HP | 50 |
| Regular / Veteran Attack | 15 |
| Movement / Range / Vision | 10 / 2 / 5 |
| Population | 5 |
| Regular / Veteran Attack Charges | 3 / 4 |
| Max Fuel / Max MG | 44 / 40 |
| Fixed MG upkeep / Turn | 1 |
| Range1 / Range2 MG cost | 2 / 4 |
| Suppression MG cost | 1 |
| Emergency movement | 2 |
| MG shortage multiplier | 0.2 |
| Suppression civilian damage rate | 0.5 |
| Noise class / radius | medium / 4 |
| Movement domain | ground |
| Reanimation | packZombie |

- 既存式に合わせrecruitAttack=12、Regular倍率1.25で15とする。Recruitで生成する経路は設けない。
- 通常攻撃・反撃・迎撃・自動鎮圧で同じChargesを消費する。攻撃後移動禁止等も既存どおり。通常HumanはRegular1 / Veteran2、砲兵は全熟練度1。
- 直接Zombie kill5体でVeteran昇格待ちとし、次Player Turn Startで昇格・4Charges補充。同Turn中に追加Chargeを付けない。
- Range1はMG2未満でも残量を全消費し、`max(1, ceil(attack * 0.2))` で攻撃可。Attack15なら3。Range2はMG4未満なら不成立で消費なし。通常攻撃・反撃・迎撃で一致させる。
- destroyed時に18.13.12のPack1隊へ再アニメーションする。輸送中の死亡は18.15.11.5の水域・配置待ち例外を適用する。死亡Unitの残燃料・軍需は返還せず、PackへHP・熟練度・装備残量を継承しない。
- 説明: 「過酷な訓練を耐え抜いた戦闘のエキスパート。敵に対して静かに苛烈な攻撃を加えることができる。」死亡時の脅威も明示する。

### 18.13.12 Pack Zombie

Typeは `packZombie`。HP50、Attack15、Movement10、Range1、Vision3、Attack Charges5、ground。既存Normal Zombieのpathfinding / target selectionを利用し、新Target AIは作らない。Wave由来の場合だけ既存wave anchor等を適用する。

#### 18.13.12.1 戦闘

- 既存の複数回攻撃権と同じ扱いで同一部隊へも攻撃できる。攻撃・反撃・迎撃の既存の消費、死亡・中断条件に従う。Player Turn Startの共通補充でTypeごとの最大値5へ戻し、Zombie Phase開始時に二重補充しない。
- 防御軽減なしなら15×5で最大75 damage。平地でRiot Policeを1Turnで倒し得る脅威として説明する。反撃・迎撃・地形・既消費Charge等によって実際の結果は変わるため、常に75を与える保証とはしない。
- 説明: 「高い知能による連携と高い身体機能で人間を追い詰める。」Visible時のUnit詳細に最大5回攻撃を明示する。

#### 18.13.12.2 発生経路・行動開始

| 発生経路 | 配置・最初の行動 |
| --- | --- |
| Special Forces死亡 | Unit削除後の死亡Hexに1隊。Player行動中なら次のZombie Phase、Zombie Phase中なら翌TurnのZombie Phaseから |
| 原発の未確保 | 18.13.10.3。Player Turn Start生成後、そのTurn終了のZombie Phaseから |
| Air Baseの期限失敗・未確保陥落 | 18.15.5。生成権をPendingとして保存し、配置完了後の行動開始規則を適用 |
| Final Horde | 通常WaveのPending Spawn規則に統合し、出現したWave処理中は行動せず次Zombie Phaseから |

再アニメーション自体は同じAction内に発生させるが、新しい個体の移動・通常攻撃をそのAction中に追加しない。Gas連鎖等の既存の原子的処理と人口・死亡統計を維持し、1 Special Forces→1 Packを専用reasonで計上する。

Periodic weighted roster、specialZombieWeights、Noise / generic random spawn、Rejected refugee bonus slotには含めない。

#### 18.13.12.3 Final Hordeと公開情報

- 既存Final base compositionの置換ではなく **Pack1隊を追加** する。独立Seeded RNGで4方向から1方向を選ぶ。
- Frozen roster / Pending / committedWaveUnitCount / statistics / Artifact / Final勝利判定へ追加1隊を含める。配置不能でも既存Waveと同様にPendingとして残す。
- Final警告はPackの参加・数・方向を明示しない。例: 「この地域で最後の砦となったと思われる州都へ、各地の感染者が集結している。あらゆる脅威が押し寄せる最後の襲撃に備えよ。」
- ほぼ全バリエーションが含まれることを示唆する表現であり、Pack以外の全Typeを確定で追加する変更ではない。
- AgentのHorde warning、Context Handoff、公開EventにもPack専用の確定予告Fieldを出さない。Type自体の一般説明や原発・Air Baseの明示的Objectiveルールは公開可。出現後も個別情報は通常のFoWに従う。

### 18.13.13 UI・警告・Forecast・Agent公開

#### 18.13.13.1 感染の説明は必須

Humanのヘルプ・方針説明・施設/Checkpoint詳細、Agent Help/APIに次を日英で説明する。

- Food / CG不足、過密、Housing outage、waitingの人数、Pass Through / Normalから感染が発生し得ること。
- Normal5%固定、Strict0%、Pass Through補正あり。Strictの安全は審査由来に限り、受入後の生活環境・直接感染を防がないこと。
- waitingだけが待機列環境の感染対象。screening / approvedも飢餓対象であり、既存の直接感染・感染拡大の対象になり得ること。
- 新規の間接感染には翌Turn終了まで感染拡大猶予があるが、人口変換・機能停止・健康人口0の陥落/敗北は即時であること。
- 駐留は既存感染拡大を封じ込めるが、生活環境の新規感染を防がないこと。

#### 18.13.13.2 現在値と次EndTurn

- 食料不足率、蓄積before/after、閾値2、上限7、死亡率、整数損失・端数、供給回復時の挙動を表示する。
- 衛生ストレスbefore/afterと原因、施設・waiting・審査ごとの対象人数、1人あたり確率、期待人数を示す。期待人数を確定損失や最大人数と混同しない。
- 施設別の過密・停電・物資由来内訳、猶予中感染者数・感染拡大開始Turn、既存感染拡大/鎮圧見込みを分ける。
- 予測時点のRevisionと条件を明示し、同じ表示原因から改善手段（供給回復、人口分散、復電、waiting削減、審査方針）へつなぐ。Hidden情報を原因として追加しない。
- 発生Eventに場所、人数、原因区分、確率と公開の原因内訳を残す。直接感染と衛生由来を同じ曖昧な通知へまとめない。

#### 18.13.13.3 警告の既定条件

| 条件 | 必須表示 |
| --- | --- |
| 次EndTurnのFood/CG維持不足あり | Warning。不足率と衛生悪化、Foodは飢餓蓄積も表示 |
| 不足解消後もストレスまたは蓄積が残る | Advisoryとして残留リスクと回復を表示 |
| 飢餓死亡率>0 | Critical。端数で当Turn死亡0でも次回以降の危険を明記 |
| 生活環境またはwaiting感染確率>0 | 原因・確率をWarningとして表示。原因別集約可 |
| Normal / Pass Throughを使用 | 方針に潜伏感染確率を常設。基礎リスクを説明し、Pass補正による悪化はWarning |
| 新規感染発生 | 発生通知と猶予、施設停止・陥落等の結果を表示 |
| 少人口施設に感染リスクあり | 初回感染でも健康人口0・陥落/敗北になり得る注意を添える |
| 原発Supply切断・喪失で電力不足が予測される | 電力不足と失う原発出力、停止原因を警告 |

Criticalな既存敗北条件は維持する。確率的な危険だけで既存のEndTurn拒否条件を拡張しない。Toastを毎回連打せず、初回・悪化・解消を通知し、同じ状態中も詳細と警告一覧から参照可能にする。

reason codesは `capital_resident_minimum`、`public_health_food_stress`、`public_health_civilian_goods_stress`、`food_starvation_risk`、`internal_infection_risk`、`checkpoint_health_risk`、`refinery_allowance_runway_risk`、`nuclear_early_capture_window` 等としてschemaへ定義する。文言ではなく型付き事実・Severityでfinite-planの危機悪化判定を行う。

#### 18.13.13.4 Compact・Preview

CompactではCapital、衛生ストレス・食料蓄積、次EndTurn不足/飢餓、内部感染高リスク施設最大5件と総数/省略数、Checkpoint方針・waiting risk、Allowance、原発報酬状態を優先する。Visible Packは完全statsを公開する。Water / Bridgeの意味はMap/APIから取得可能にする。

人口操作PreviewはCapital保護に加え、維持費・過密・衛生リスクの変化を返す。EndTurn Previewは飢餓と各感染源を別欄で示し、RNGは進めない。有限計画とHandoffも同じ公開危機を使う。

### 18.13.14 State・Schema・Version

追加対象はSave、Observation、Agent API、Bridge、Session、Checkpoint、Replay、Artifact、Viewer、Config validation。

- water / derived bridge、movementDomain、nuclearPowerPlant / specialForces / packZombie。
- Type別Attack Charges、原発初回確保/報酬pending/配置済み/失効・failure生成管理。
- publicHealthStress、食料不足蓄積、全国飢餓端数、原因別損失統計。
- 間接感染の猶予人数・感染拡大可能Turn。infected合計と二重計上しない。
- 新しい確率・不足・警告・Handoff Query targetとpayload。

Version値は18.15.16へ一本化する。v1.6.4以前のSave／Replay／Session／Checkpoint／Artifactは互換変換せず、理由付きで非破壊拒否する。Human最大2・非Horde最大1という旧不変条件は使わず、Typeと熟練度ごとのChargeを検証する。

### 18.13.15 決定性・公開情報・人口保存

- Bay方向、原発failure fallbackのtie-breakが乱数を必要とする場合、Final Pack方向、審査潜伏感染、waiting感染、生活環境感染には独立domain separationを用いる。
- 新しいRNG呼出しだけで無関係な既存のHorde方向・survivor等の乱数列をずらさない。Map変更で候補集合が変わる配置まで旧版一致を保証するものではない。
- BinomialはSeed付きの決定的な実装と安定対象順で処理する。Preview・Query・Handoffは乱数を消費しない。
- 同Seed / Config / Action列でState / Replay / Artifactが一致する。Save復帰・Session branchでも蓄積、端数、猶予、pending報酬、発生済みフラグを完全に保存する。
- 健康→感染→死亡/Spawn変換、援軍5人、飢餓死亡は人口保存則へ一度だけ反映する。
- 非公開のPack割当・位置・RNGを公開予測、通知、Handoff、Production Artifactへ混入させない。内部検証用Replayと公開Artifactの既存境界を維持する。


### 18.13.16 アセットと表示

承認済みの水面・橋・原発・特殊部隊・Packの制作原本、プロンプト、hashを`Art/reference/v1.6.3-concepts/`へ保存し、`scripts/build-v163-assets.py`で256px透過PNGを生成する。Human Board、凡例、AI Replay ViewerのAsset Registryを統一し、Bridge接続・Water・FoW・低ZoomのFallbackを維持する。日本語/英語の衛生・飢餓・感染猶予、資源警告、原発期限と特殊部隊/Packの説明を表示する。AI Viewerは公開Artifactだけを読み、衛生の現在値と次EndTurn予測を表示する。

### 18.13.17 v1.6.3当時の検証記録（履歴）

- 型検査・本番Build・production Browser Bridge smoke・公開API終局smoke、配布/再利用ツールのテストを実施。全体回帰919件では905件成功、3件失敗、日次専用11件skip。失敗は特殊部隊の戦闘直後Save、Pack撃破統計、Capital全員移送の合法手列挙で、いずれも修正前の失敗と修正後の対象テスト成功を確認した。追加の審査受入先・approved再配置3件、Bridge12件も成功。配信対象CommitにはGitHubの全体回帰ゲートを適用する。
- 実Sessionの128 canonical Decisions、自動Handoffと読取純粋性、実AiSessionの72 completed Turns、配列上限・危機集約を検証。Session/Artifactのcanonical historyは維持し、古い会話全量の再読を不要にする公開Handoffを返す。
- Windows最小Portableは同梱Node 22.14.0で全10コマンド、Seed1(14 Decisions)/7(13 Decisions)の正常終局、Artifact作成、Replay一致を確認した。最終配布はGitHubのLinux/Windows両Package jobで同じsmokeとPackage寸法・起動時間を検証し、両方の成功を完了条件とする。
- Built-in Balancedの標準Seed1/7はTurn17/27の通常敗北、accepted322/505、invalid0、technicalFailure0、limitReached0。公開Bridgeのみを使用する外部LLM主導プレイ（定型の合法攻撃選択を補助）もSeed1/7でTurn28/27の通常敗北まで到達した。Seed1はTurn3に原発確保・特殊部隊合流、Strictの審査感染0、waiting感染13、内部感染18、飢餓死亡11。Seed7はNormal由来20、waiting0、内部感染8、飢餓0、原発期限切れ。勝利を合格条件にせず、過密の予防・食料供給の回復・軍事防衛の負担を確認し、確定数値は変更しない。
- Seed1の初回プレイにはCallerの不正field1件とBridgeのDeny enum漏れによる拒否4件が記録された。後者は公開合法手をそのまま実行する再現テストで修正し、前者は正常な入力境界拒否として保持する。Seed7は拒否0。記録を書き換えず、accepted Action列を最終Coreで再実行し、両Seedの終局と全公開統計の一致を確認した。
- 4方向の標準初期条件で原発確保経路を確認した。Supplyの地理/視界/建設/費用の成立性は初期敵だけを0にした別シナリオで合法Move/RelocateCheckpointを通し、全4方向で原発Supply到達を確認した。これは標準敵配置下の前線生存を保証する試験ではない。
- Chromeの390×844と1440×1000でHuman画面、日英警告、Turn進行・autosave/reload、新5種Asset、公開ZIPのAI Replay Viewer読込・Turn seekと衛生表示を確認。実機スマートフォンの計測ではない。GitHub Pagesは公開対象Commitへ配信後、実ブラウザでVersion・Bridge・新規ゲームを確認する。
- その他の長時間GitHub workflow（Balanced1..30、Seed198、Session1000、200 games/large Session）は依頼者指定により起動確認まで。監視・完了扱いは行わない。


現行仕様へ反映済みのv1.6.3確定要件は、2026-09-21の依頼に従い`Doc/archive/`へ移動した。アーカイブ文書は履歴資料とし、現行判断には本書を使用する。

## 18.14 簡易施設・検問所復旧・砲兵の現行詳細

### 18.14.1 適用範囲

確定要件に従い、建設費、陥落検問所復旧、Wave/Gas、兵士表示、野戦砲、公開Viewerと既存API問題を実装した。未変更の仕様は本書の既存節に従う。状態変更はGameAction → GameEngineで行い、CoreはPhaser/UIから分離する。

砲撃には独立したSeed付き乱数状態 `artilleryRngState` を使用する。Query/Previewは乱数を消費せず、砲撃の追加で無関係な既存乱数列を進めない。自然発生しにくい操作は公開Actionで構築したシナリオで検証する。

### 18.14.2 簡易施設

| 項目 | 現行値 |
| --- | --- |
| Temporary Housing / 仮設住宅建設費 | 民需品50 |
| Simple Farm / 簡易農場建設費 | 民需品50 |
| Simple Farm建設数 | 上限なし |
| Temporary Housing建設数 | 引き続き上限なし |

建設数以外の地形・占有・費用等の合法性は維持する。Civilian Drone Base等が使用する `constructibleFacility.limitPerTypeDivisor` は残す。

### 18.14.3 陥落検問所の復旧

Ruined Checkpointは、感染者0、同じHexに敵Unitなし、復旧能力のあるHuman Unitが駐留、の条件を満たすと自動復旧する。隣接する敵は妨げない。進入時だけでなく、駐留中に感染者・敵がいなくなった場合にも判定し、入り直しを要求しない。野戦砲・ヘリ・搭乗中Unitは復旧能力を持たない。

感染者が残る場合は復旧しない。既存の鎮圧による感染者0の復旧処理と共通化する。砲撃で感染者0になっただけでは復旧しないが、同時に有資格の味方が駐留するなど必要条件が成立すれば復旧する。連鎖効果を含むActionの解決後の状態で判定し、途中状態で重複復旧させない。

| Branch状態 | 復旧後Role |
| --- | --- |
| Activeなし | Active |
| Activeあり・Standby空きあり | Standby |
| Activeあり・Standby空きなし | Dormant |

`overrunProcessed=false`、`checkpoint_recovered` Event、Supplyの再計算を既存規則へ接続する。新しいRecoverCheckpoint Actionは設けない。公開Query/UIに復旧条件と未成立理由を示し、非公開の敵情報は理由として漏らさない。

### 18.14.4 WebMCP LiveとReplayの共通描画

`AgentObservation / SessionPublicDocument → PublicBoardFrame → PublicBoardRenderer` を基本とし、LiveとReplayで同じ描画処理を使用する。コピー実装は作らず、Liveへprivate GameStateを渡さない。

共通対象はHex座標、地形、道路・橋、FoW、施設・検問所・有刺鉄線、Human/Zombie、Unit状態別アセット、pan/zoom/fit、欠損アセットのfallback。通常ゲームも状態別Asset Resolverを共有する。

盤面のUnit・施設・検問所を選択して公開範囲内の状態・物資・停止理由等を表示できる。更新後も視点・ズーム・選択を維持し、自動追従しない。全体表示は明示的なfit操作で行う。対象が消滅・非公開になれば選択を解除し、古い詳細を残さない。Hidden Zombieや未公開の内部人口、騒音反応を表示しない。

### 18.14.5 Horde / Gas Zombie / 表示名称

#### 18.14.5.1 Wave構成

Gas Zombieは第1 WaveからFinalまで特殊抽選対象とし、最後の2 Wave限定と同一方向1体制限を撤廃する。頻度は既存 `specialZombieWeights.gasZombie` で制御する。

Horde WaveのRoster確定時に `zombie` の結果をすべて `hordeZombie` へ正規化する。基本枠、特殊抽選の通常結果、難民拒否・追い返しによる `ceil(rejectedTotal / 5)` の追加枠、将来のWave内生成にも適用する。他の特殊Typeは維持する。単なる表示変更ではなく実Type・AI挙動・TargetingもHordeとして扱い、`spawnGroupId` / `hordeKind`、Pending、Final勝利判定を維持する。

初期配置、施設・検問所陥落、Noise Respawn、再アニメーション等の非Wave生成は変更しない。Packの既存の参加条件・予告境界も維持する。

公開名は `variantSlotCountPerDirection` / `possibleVariantTypes`、追加枠は `extraWaveSlots` を基本として実態に合わせ統一する。旧 `nonHordeSlotCountPerDirection` / `possibleNonHordeTypes` / `extraNormalZombies` の互換Aliasを残さない。Schema・Event・統計・説明・利用ツールを同時更新する。

#### 18.14.5.2 Gas死亡爆発

HumanへのBase Damage30、ZombieへのBase Damage15。対象別Base Damage決定後に既存の地形補正・端数処理を適用する。施設・検問所への感染値とGas連鎖は維持する。Combat / deathExplosion PreviewとReplayも一致させる。

#### 18.14.5.3 Soldier表示名

旧表示名を **Soldier / 兵士** に統一する。UI、Agent説明、Help、Replay、実装後の現行仕様を対象とする。内部ID `nationalGuard` と既存Asset filenameは変更しない。履歴資料の書き換えは不要。

### 18.14.6 野戦砲の生産・基本能力

内部Typeは `fieldArtillery`、Army Baseのみで1ターン生産。新兵（Recruit）・Packedで完成する。

| 項目 | 値 |
| --- | ---: |
| HP / 人口 / 視界 | 25 / 5 / 5 |
| 携行軍需品上限 / 燃料上限 | 100 / 100 |
| 生産人口 / 民需品 / 軍需品 / 燃料 | 5 / 100 / 200 / 100 |
| 完成時軍需品 / 燃料 | 100 / 100 |
| 毎ターン軍需品固定消費 | 1 |
| 1ゲームの生産上限 | 2隊 |

軍需品200は全国備蓄から支払い、Army Baseの迎撃専用軍需品を使わない。生産軍需品200に初期搭載100を含め、燃料100も発注時に確保・消費する。完成時に両資源を全国備蓄から再徴収しない。人口供出、電力、補給等の未変更の生産条件は既存兵士に従う。

上限は生存数ではなく生涯生産数であり、死亡しても戻らない。予約中・配置待ちも枠を占める。配置不能時は支払い済み資源・人口・枠を保持して既存規則で再試行する。基地陥落等による生産没収は完成済み数へ加えず予約枠を解除する。没収時の人口・資源処理は既存規則に従い、独自返金は追加しない。完成・配置の再試行やLoadで二重計上しない。

`productionLimitPerGame` はHuman共通機構とし、野戦砲2、既存Unit無制限とする。

#### 18.14.6.1 能力制限・移動・維持

- Packed / Deployedとも、感染鎮圧、自動鎮圧、感染封じ込め、施設確保、検問所復旧は不可。費用を巨大化する疑似禁止ではなくCapabilityで表し、公開候補から除外する。
- 梱包中は既存Ground Unitの地形コスト・通行条件に従う。水面不可、橋可。移動ポイント消費1につき燃料10。移動後の射程1攻撃は可、攻撃後移動は不可。
- 両状態とも既存条件で補給・自然回復を受ける。切り替えは行動として回復判定に含め、無行動回復を認めない。追加の回復待機ターンは設けない。
- 死因・Modeを問わず撃破時に **Soldier Zombieを1隊** 生成する。人口損失と再アニメーションは既存Lifecycleへ接続し、砲・車両能力、熟練度、残資源を継承しない。生成個体の行動開始は既存再アニメーション規則に従う。

#### 18.14.6.2 状態別能力

| 項目 | Packed | Deployed |
| --- | --- | --- |
| 移動力 | 10 | 0 |
| Recruit攻撃力 | 7 | 40 |
| Regular / Veteran攻撃力 | 9 / 9 | 50 / 50 |
| 射程 | 1 | 10〜200（両端含む） |
| 1回の軍需品 | 4 | 50 |
| 軍需品不足 | 既存近接攻撃と同じ残量全消費・低威力 | 50未満なら攻撃不可・消費なし |
| Attack Charges | 全熟練度1 | 全熟練度1 |
| 反撃・迎撃 | 既存Unitと同じ | 一切行わない |
| 燃料枯渇時MP | 1 | 0。緊急移動も禁止 |
| Noise Radius | 発射元6 | 発射元40と実着弾点40 |

展開中はプレイヤーまたはAIの明示的な攻撃Actionでのみ発射する。自動の反撃・迎撃へ砲撃を流用しない。砲撃1回は命中結果にかかわらずCharge1・軍需品50を消費する。

#### 18.14.6.3 Mode変更

`ChangeUnitMode { unitId, mode: "packed" | "deployed" }` を追加する。野戦砲のみ、当Player Turnに移動・攻撃・鎮圧・Mode変更をしていない場合に実行可能。同一Modeへの変更で行動を再獲得できない。

Mode表示・有効Statは即時更新するが、次Player Turn Startまで移動・攻撃・反撃・迎撃をすべて禁止する。燃料・軍需品消費は0で、残量0でも変更可能。橋、施設、検問所を含む停車可能なすべての地形で変更できる。展開から移動するには、梱包へ切り替えて次のPlayer Turnを待つ。

#### 18.14.6.4 熟練度

既存のRecruit → Regular → Veteranの昇格条件・反映時点に従う。VeteranでもChargeは1。砲撃の直撃・隣接爆風で直接倒した各Zombie Unitを撃破数へ加え、3隊なら3撃破とする。施設・検問所内部の感染者、味方死亡、Gas連鎖等の間接撃破は加算しない。内部感染者への砲撃は鎮圧Action・鎮圧実績・鎮圧熟練度として扱わない。

### 18.14.7 砲撃の照準・着弾・被害

#### 18.14.7.1 照準

現在視認できる敵Unitに加え、**現在可視のHexを直接指定可能**。敵のいない地面・水面・施設・検問所も狙える。過去に発見しただけの現在不可視Hexは指定不可。射程は発射元から指定HexへのHex Distanceで判定する。射線判定は不要で、途中の壁・施設等に遮られない。

#### 18.14.7.2 命中と着弾ずれ

| 熟練度 | 指定Hexへの命中 | 外れた場合 |
| --- | ---: | --- |
| Recruit | 50% | 指定Hexから距離1〜2 |
| Regular | 50% | 指定Hexから距離1 |
| Veteran | 100% | ずれなし |

ずれ先は中心を除く範囲内のマップ内Hexから一様抽選する。距離ごとの半々抽選ではない。水面・砲から距離10未満／200超も候補に含める。施設内部感染者狙いも同じ命中率。攻撃前のPreviewでは乱数を引かず、実着弾点を先出ししない。

#### 18.14.7.3 Unitへの被害

実着弾Hexへ攻撃力100%、隣接6Hexへ50%。Recruit40 / 20、Regular・Veteran50 / 25をBaseとし、各対象へ既存の地形補正・端数処理を適用する。爆風は壁・施設で遮られない。マップ外は対象なし。

地上Human／Zombieは同じ処理で、別の野戦砲や着陸ヘリも対象。航空中ヘリと搭乗中Unitは独立した爆風被害対象から除く。Hiddenの敵も被害を受けるが可視化せず、位置・Type・個別被害を公開しない。味方死亡は通常のUnit Loss / Population Deathとする。

#### 18.14.7.4 施設・検問所内部人口

すべての施設の健康な住民・労働者・感染者が対象。都市・州都・住宅・未確保施設の生存者も含む。検問所はwaiting / screening / approved / infectedを対象とする。Unitとして同じHexにいる者はUnit Damageを別に受け、内部人口へ二重計上しない。

そのHexへのBase Damageを地形補正・既存端数処理した値をDとし、残存内部人口から1人ずつ一様に選んで除去する。1 Damage = 1人。最大D人で人口0なら終了する。健康／感染・Queue段階の抽選確率はその時点の人数比に比例し、除去済みの人を再抽選しない。集計値とQueue・感染猶予内訳を一貫して減らす。

健康人口は該当住民／worker／Queueを減らし、人口保存則・`cumulativeDeaths`・`civilianLosses`等へ一度だけ反映する。感染者は感染者死亡へ計上し、Zombie Unit Killとしない。未確保人口を含め既存人口区分の統計整合を維持する。

被害後は既存の施設停止・陥落・検問所陥落・敗北判定へ接続する。州都の健康人口0だけを新しい敗北条件にせず、州都陥落または所有施設の健全民間人口合計0で敗北する。建造物HPは設けない。感染者0だけでは確保・復旧しない（18.14.3）。

#### 18.14.7.5 解決順序・連鎖

砲撃開始時の対象を安定順で確定し、範囲全体の直接被害・内部人口抽選と死亡処理を終えてからGas死亡爆発等の連鎖を処理する。途中で生まれた再アニメーション個体や陥落由来個体を元の砲撃対象へ追加しない。後続のGas爆発に巻き込まれるかは既存Lifecycle規則に従う。

同一被害の二重適用、死亡個体の再処理、人口・撃破数の二重計上を防ぐ。復旧・最終勝敗等は連鎖を含む整合した状態で評価し、EventとReplayの順序を固定する。

#### 18.14.7.6 騒音

Packedは既存の攻撃騒音として発射元半径6。Deployedは1回の砲撃に対し発射元半径40と実着弾地点半径40を持つ。既存Noiseの対象・優先順位・再出現資格は維持する。

両範囲の重複で同じZombieの反応や同じ陥落拠点のNoise Respawn抽選を二重実行しない。両方が届くZombieの騒音Targetは、距離にかかわらず **発射元を優先**。片方ならその音源。これは騒音同士の選択であり、可視人口等の既存の上位Target優先を変更しない。Hiddenの反応先・対象ID・再出現情報は公開しない。

### 18.14.8 組み込みAIの砲撃判断

#### 18.14.8.1 原則

着弾可能地点とその爆風の和集合を危険範囲とする。最大半径はRecruit3、Regular2、Veteran1。味方Unit、健康な施設人口、未確保施設の生存者、健康な検問所人口を巻き込む候補を通常は選ばない。公開情報から分かるGas連鎖の被害も判断へ含める。

公開情報で内部感染者を確認できれば、敵Unitのいない施設・検問所へのHex指定砲撃も可能。非公開の感染者数・敵・乱数を用いない。健康人口を否定できない未確保拠点を「安全」と断定しない。

#### 18.14.8.2 緊急例外の必要条件

以下をすべて満たす場合に限り巻き込みの危険がある砲撃を選べる。

1. 次の敵フェーズで、プレイヤー所有の施設またはプレイヤー側検問所が陥落する危険がある。州都以外も対象。数ターン先の危険だけでは不可。
2. 他の味方の行動権・移動／射程・軍需品・威力を考慮しても、脅威を止める代替の対処が成立しない。単に別Unitが攻撃可能という理由だけで例外を拒否しない。
3. 砲撃しない場合より対象拠点の防衛成功率が高い。
4. 砲撃・連鎖・その後の敵攻撃を合わせ、次Player Turn開始までの予想死亡人数が砲撃しない場合より少ない。味方部隊の人口、自国住民、検問所避難民、未確保生存者を同じ1人として数える。
5. 公開情報から評価できる全着弾候補・内部人口被害・連鎖について、その砲撃による即時敗北の可能性がない。成功期待値が高くてもこの禁止を覆せない。

評価は公開情報だけによる予測で、Hiddenの脅威に対する安全保証ではない。確定結果と推定を区別し、条件を評価できない候補は例外として許可しない。比較は同じ公開Revision・予測範囲で行い、命中／ずれ確率と内部人口抽選を考慮する。実行RNGを消費・先読みしない。具体的な評価器の実装方式は実装工程で選ぶが、成功率の上昇・期待死亡数の減少という両条件を、施設の重要度だけで置き換えてはならない。

これはAIの運用規則でありCoreの攻撃合法性へ追加しない。外部AIにも原則・例外条件と危険Previewを説明するが、外部AIが従うことをEngineで保証しない。展開中の自動迎撃は追加せず、AIも明示Actionで発射する。

### 18.14.9 UI・公開API・Replay

- Unit詳細・Help・日英説明に、状態、切り替え後の行動禁止期間、射程、軍需品不足、Charge1、Capability、生涯生産数・予約数・残枠を表示する。
- 砲撃Previewは狙ったHex、命中率、各着弾候補と確率、爆風可能範囲、軍需品消費、地形補正、巻き込みUnit・内部人口の危険、公開情報から分かる連鎖を表示する。確率・期待値・確定値を区別する。
- `friendlyFirePossible`、`friendlyUnitIdsAtRisk`、`possibleImpactHexes`、`possibleBlastHexes`に加え、施設・検問所人口の危険を型付き情報で公開する。非公開人口の正確な数を作り出さない。
- 人間プレイヤーが味方・健康人口を巻き込む可能性のある砲撃を選ぶと実行前確認を表示する。即時敗北の可能性が公開情報で分かれば明示する。確認後は人間の判断で発射できる。確認中にRevisionが変われば再Previewする。
- 完全な内部Replayに指定対象、命中抽選、ずれ有無、実着弾点、直接被害・人口抽選結果・連鎖を再現可能に記録する。公開Event / Artifact / Viewerは既存Projectionで秘匿し、Hiddenの個別被害や騒音反応を漏らさない。砲撃を理由に視界を拡張しない。
- packed / deployed / scatter / productionLimitPerGame / productionFuel / Capability / friendlyFire / facilityPopulationDamage等をConfig化する。Unit Modeと生涯生産・予約を保存し、Mode・熟練度に合う有効Statを生成・変更・昇格・Load時に一貫させる。全面Derived Stat化は必須としない。

### 18.14.10 公開APIの既存問題修正

- `query --target=route` はFactionの共通Human判定を使用し、Player Recon Teamの公開経路照会を受け付ける。
- `RelocateCheckpoint` は `checkpointId + position` からBranchを一意に推論する。`branchId` はoptionalで、省略と一致値を受け付け、不一致値を理由付きで拒否する。Schema、公開候補、Preview、実行を一致させる。

### 18.14.11 Versionと互換性

現行のVersion値は18.15.16に従う。砲兵Mode、Action、独立RNG、生産累計を含む新Schemaでpayloadを検証する。v1.6.4以前のSave／Replay／Session／Checkpoint／Artifactは非互換として理由付きで拒否する。自動保存はv22領域を使い、旧領域・現在状態を変更しない。

### 18.14.12 アセット・公開表示の実装

- 承認済み `Art/reference/v1.6.4-concepts/` 原本2種から `scripts/build-v164-assets.py` で256px透過PNGを生成する。ゲーム用は `public/assets/board/units/unit_field_artillery_packed.png` と `unit_field_artillery_deployed.png`。原本・採用記録は維持する。
- Packedはトラックと牽引砲、Deployedは砲と砲手。Normal / Live / ReplayでMode別Asset Resolverを共用し、欠損時の図形Fallbackを維持する。
- Live/Replayは同一 `PublicBoardRenderer` を使用する。LiveのObservationからMapを分離した共通Frameを生成し、Artifactの可視Hex一覧と同じ境界で表示する。詳細、凡例、状態、能力、資源、生産枠は日英対応する。
- 人間向け砲撃Previewは照準・着弾候補・爆風範囲、命中確率、地形補正、Unit/内部人口/Gas連鎖の危険を表示する。軍需品表は射程10〜200の共通消費50としてまとめ、191行を並べない。
- 部隊説明: 「兵器庫で眠っていた旧式の野戦砲。GPS誘導弾には対応しているが、専門的な訓練を受けた砲手が不在なため、多少の誤差は覚悟しなければならない。」GPS誘導弾はフレーバーであり、弾種切り替えや追加資源・補正はない。

### 18.14.13 AI評価の実装範囲

組み込みAIは公開PreviewとObservationだけを使用する。通常は味方・健康人口・未確保人口の巻き込みを避ける。緊急時は公開の地形移動費、敵の到達・攻撃、他部隊の移動先・射程・Charge・弾薬・威力を評価し、他部隊による有効な防衛手順がある場合は危険な砲撃を許可しない。代替手順の探索上限は20,000状態、脅威6隊で、未確定なら拒否する。

感染への変換と死亡を区別する。公開 `siteFallRules` の生成人数・生成上限から、建設施設の陥落で確実に死亡する人数の下限を求め、砲撃後の死亡人数上限より大きい場合だけ死亡条件を満たすと判定する。恒久施設・検問所の人口が感染に変わることだけを死亡として加算しない。評価値は `expectedDeathsBeforeLowerBound` / `expectedDeathsAfterUpperBound` として区別し、人口被害抽選・各着弾確率を重み付けする。

Gas連鎖、味方死亡による再アニメーション、不明人口、複雑な感染進行、競合する対象、混雑、未評価の人口移送・別の展開砲・基地迎撃による対処、味方Unitへの非致死被害と後続戦闘の組合せなど、必要条件を公開情報だけで評価できない場合は緊急例外を許可しない。これらは限定された次敵フェーズの予測であり、Hiddenの脅威を含む完全な安全保証ではない。Coreの砲撃合法性にはこのAI制約を追加しない。

### 18.14.14 v1.6.4当時のローカル検証記録（履歴）

- 横断的な全体回帰を1回実行した。107ファイル・947件中、910件成功、26件失敗、日次専用11件skip。失敗を放置せず、旧Version/Wave/Gas/費用の期待値を確定要件へ更新し、不具合を修正して該当範囲を再実行した。初回実行そのものを全成功とは扱わない。
- 対象再検証は18ファイルで189件成功・6件失敗。その6件を修正し、4ファイル65件と公開Game APIを含む7ファイル101件が成功した。後続のUI/AI/アセット5ファイル47件、公開Frame/Live2ファイル6件、旧v20保存保全の対象1件、Metrics対象1件、配布・再利用スクリプト8件も成功した。重複実行分を合算したテスト総数は示さない。
- 新規検証は射程境界9/10/200/201、軍需49/50、Packed燃料、Modeロック、熟練度別着弾候補、Preview純粋性、Hidden被害秘匿、人口・Queue・感染猶予、死亡/連鎖/騒音重複、復旧Role、Wave/Gas、生涯生産枠、公開API、AI例外条件を含む。既存問題の修正前失敗と修正後成功を確認した。都市の感染を死亡と誤認するAI評価も再現テストで修正前失敗を確認し、死亡下限・上限の比較へ修正した。最終AI修正後は公開Observation/Live/Viewer/既存Balancedを含む5ファイル41件が成功した。さらに基地迎撃・味方被害後の戦闘が未評価なのに許可される境界2例で修正前失敗を確認し、未評価時の拒否を追加し、AI砲撃方針11件が成功した。
- 型検査、本番Build、production Browser Bridge smokeを実施。既存の大型bundle警告は残るがBuildエラーではない。
- 公開Session APIだけでArmy Base確保→砲生産→移動→展開→砲撃を9判断で構築し、Action Replay一致を確認した。専用Configの検証シナリオであり、標準難度の戦績とは区別する。再現用 `scripts/v164-local-acceptance.ts` を保持する。
- 標準Seed1のBalancedはTurn22の通常敗北で終了、383 accepted / 383 decisions、invalid0、technicalFailure0、limitReached0。公開外部APIのSeed1は14判断・Turn14の通常敗北まで進み、Replayが一致した。勝利を合格条件にしていない。
- 実ブラウザの1440×1000と390×844で通常画面、砲撃危険確認、日英Viewer、両Modeのアセット/詳細、Live更新時の視点・選択保持、Replayのターン移動・消滅時選択解除・fitを確認した。モバイル幅の横あふれなし。実機スマートフォンの検証ではない。
- WebMCPはローカルChromiumにネイティブAPIがないため、登録API shimで8ツール登録と公開Action/Revision/Live更新の接続を確認した。ネイティブWebMCP対応ブラウザでの検証済みとは扱わない。
- 日次1000 Session用11件は環境フラグ未指定で条件付きskip。長時間のBalanced seeds1..30/198の2ファイルはローカル全体回帰から除外しGitHubの専用jobへ委ねた。全200ゲーム、大規模Session、Windows/Linux配布物、GitHub Pagesの動作結果は今回未確認。
- 今回の依頼ではプッシュ後のGitHub Actions起動確認までで一区切りとし、結果の監視・成功確認は行わない。起動確認はジョブ成功を意味しない。確定要件は本節へ反映済みだが、依頼者の `Doc/archive/` 変更禁止に従い今回はDoc直下に保持する。


## 18.15 v1.6.5 航空・輸送・公開候補Query

本節はv1.6.5の航空・輸送・公開候補Query等の詳細規則であり、第1〜17章および18.13〜18.14と同じ現行仕様を説明する。本節内の「第N章」は18.15.Nを指す。

### 18.15.2 AI向けQuery / Preview

#### 18.15.2.1 共通原則

`legal-actions` は引き続き合法Actionだけを返す。新しい候補Queryは合法・違法候補と理由を返す。未公開施設や不可視敵を列挙せず、通常Observationと同じ公開Projectionを使う。外部入力Schema不正、Revision不一致、Coreのゲーム上の不成立を区別する。

実際のActionが不成立なら、Session層で一律 `action_not_legal` に置き換えず、公開可能な具体的Core reasonCodeを返す。秘匿情報を理由文・候補数・ID・順序から漏らさない。複数の不成立理由があっても、主要reasonCodeの選択順は単独Preview・候補Query・実Actionで一致させる。

#### 18.15.2.2 production-candidates

施設とUnit種別ごとに生産可否・費用・配置見込み・生涯枠を取得できるQueryを追加する。対象施設・Unit種別を指定する場合、不適切な組合せも `unit_not_producible_here` 等で説明する。既知の未所有施設を照会しても内部の非公開人口を公開しない。

必須情報: `facilityId`, `unitType`, `legal`, `reasonCode`, `reason`, `populationCost`, `civilianGoodsCost`, `militaryGoodsCost`, `fuelCost`, `productionTurns`, `productionSlotOccupied`, `readyTurn`, `projectedPlacementHex`, `placementReasonCode`, `lifetimeProducedCount`, `lifetimeProductionLimit`。予約数・配置待ち・残枠も区別する。

代表的reasonCodeは `production_slot_occupied`, `production_destination_blocked`, `insufficient_population`, `insufficient_civilian_goods`, `insufficient_military_goods`, `insufficient_fuel`, `facility_not_owned`, `facility_not_operational`, `unit_not_producible_here`, `lifetime_production_limit_reached`。

生産予約そのものの合法性と完成時の配置見込みは分ける。現時点の配置候補は将来の空きを保証しない。既存規則で配置待ち可能な予約を、Queryだけが独自に違法としない。将来の敵移動・乱数を予測した確定配置を返さない。

#### 18.15.2.3 住民移動Preview

AssignWorkers等の減員に伴う全移動先を `populationMovements: { fromFacilityId, toFacilityId, people, reason }[]` と `facilityResidentDeltas: { facilityId, before, after, delta }[]` で返す。CapitalだけでなくCity・Temporary Housing等をすべて含める。Capitalの既存集計を維持してもよい。同一Revisionで乱数を伴わない再配置のPreviewと実適用を完全一致させる。

#### 18.15.2.4 enemiesと検問所Blocker

`units` はPlayer Unit用のまま維持し、現在可視のEnemy専用 `enemies` Queryを追加する。`id`, `type`, `position`, `hp`, `attack`, `range`, `movement`, `vision`, `attackChargesRemaining`, `maxAttackCharges`, `canMove`, `canAttack`, `isScheduledWaveMember`, `isFinalWaveMember`, `canTargetAir` を返す。

`checkpoint_supply_zombie_blocked` の候補には `blockingEnemyIds` を追加する。実際に当該候補を妨害する現在可視の敵IDだけを全件返す。空配列は不可視の妨害者がいないことを保証しない。不可視IDや不可視の人数は返さない。

#### 18.15.2.5 Batch Preview

Session API / WebMCPで複数Actionを1回の要求でPreviewする。全件を同じ `baseRevision` の現在Stateから**独立に**評価し、入力順と各結果の対応を維持する。前の結果を次へ適用するSequence Simulationではない。個別Actionのゲーム上の不成立もその項目の結果として返す。

State、Live RNG、Action/Event Sequence、Revisionを一切変更しない。処理中に異なるRevisionを混ぜない。要求全体のRevision不一致は既存の競合処理に従って拒否する。サイズ制限やページングを設ける場合は公開Schema/API説明へ明記し、黙って候補を切り捨てない。

#### 18.15.2.6 attack-candidates

`unitId` 指定時は当該Player Unit、省略時は全Player Unitを対象に、攻撃候補をまとめて返す。候補の合法性は同じCore Validationを使用する。行動不能・搭乗中・着陸中のヘリについても、攻撃できない理由を取得可能にする。

必須情報: `attackerId`, `targetId` または `targetHex`, `distance`, `legal`, `reasonCode`, `projectedAttack`, `militaryGoodsCost`, `projectedMilitaryGoodsRemaining`, `attackChargesRemaining`, `counterattackPossible`, `interceptionRelevant`, `friendlyFirePossible`、該当する砲撃Preview情報。

敵Unit候補は現在可視の敵のみ。野戦砲の現在可視Hexへの照準も扱い、空地・施設・検問所を敵Unitの不在だけで候補から失わない。候補取得範囲・フィルタ・全件取得方法を公開契約で定義する。Previewと同様に予測範囲と非公開情報による限界を示す。

### 18.15.3 経済・電力

#### 18.15.3.1 Temporary Housing

仮設住宅は人口収容・過密回避・避難民の受け皿とし、民需品生産は人数・状態を問わず常に0。固定生産、resident/worker比例生産、ForecastのResident Rated Output、Production Capacityへの寄与も0に統一する。

現行仕様にも資源非生産の記述があるため、既に0の経路は回帰保証とし、残存するCity系共通ロジックや表示だけに生産があれば修正する。人口維持費、収容上限、停電・補給切断の追加維持費を廃止しない。

#### 18.15.3.2 要求電力

標準Configの要求電力は次の表を使う。発電量は10.1、給電条件と優先順位は10.3〜10.4に従う。

| 施設 | v1.6.5要求電力 |
| --- | ---: |
| 州都 / 都市 | 各20 |
| 農場 / 仮設住宅 | 各10 |
| 民需工場 | 30 |
| 軍需工場 | 40 |
| 製油所 | 20 |
| 民間ドローン基地 / 陸軍基地 / 空軍基地 | 各10 |
| 簡易農場 / 発電所 / 風力発電所 / 原発 / 油田 | 各0 |

軍事基地の予約生産に対する給電条件も共通処理へ反映する。空軍基地は軍用ドローン発進時にも給電状態を確認できること。生産予約がないためドローンへ給電不能になる設計にしない。Config Validation、Forecast、Public Config、Helpを一致させる。

#### 18.15.3.3 軍需工場

稼働worker1人・1ターンあたり **民需品2消費 → 軍需品1生産**。入力不足・電力不足の配分順は既存経済規則を使う。兵士、偵察隊、特殊部隊、野戦砲、ヘリ、両軍事基地の専用軍需、攻撃・補給・固定維持費を含めて固定Seedで収支を確認する。勝利のために確定数値を無断調整しない。

### 18.15.4 Horde・Zombie AI

#### 18.15.4.1 抽選と方向別総数

| 抽選Type | Weight |
| --- | ---: |
| Normal Zombie | 40 |
| Police Zombie | 10 |
| Soldier Zombie | 10 |
| Riot Zombie | 5 |
| Hunter Zombie | 15 |
| Gas Zombie | 15 |
| Screamer Zombie | 5 |
| 合計 | 100 |

Gasは第1Waveから対象で方向別上限なし。**Hunterの方向別個体数上限も撤廃**し、同方向に複数出現可能にする。Riot等の未変更の上限は維持し、上限到達後は残候補で再正規化する。よって15というWeightは、全Slotで常に15%となる保証ではない。

| Turn | 方向数（現行維持） | 1方向の基本総数 | 固定Horde | Variant抽選枠 |
| --- | ---: | ---: | ---: | ---: |
| 10 | 1 | 9 | 5 | 4 |
| 20 | 2 | 9 | 3 | 6 |
| 35 | 1 | 17 | 8 | 9 |
| 50 | 3 | 14 | 5 | 9 |
| 70 | 4 | 18 | 8 | 10 |

旧基本数×1.1を切り上げ、増加分をVariant枠へ追加する。難民拒否追加枠は別枠で既存どおり加算し、同じWeightと上限規則を使う。Wave内のNormal抽選結果はHordeへ正規化する。非Wave生成、FinalのPack参加条件・予告境界・勝利条件は変更しない。

#### 18.15.4.2 航空への対応

Hunter / Packだけを `canTargetAir = true` とし、他Zombieはfalse。攻撃、反撃、迎撃、可視人口Target、移動先Targetで共通Capabilityを使用する。対空可能なRange1 Unitは飛行中の敵とのHex距離0～1を攻撃距離とする。

対空不可のZombieは飛行中のヘリ本体や搭乗歩兵を追跡・攻撃対象にしない。一方、**飛行騒音の発生地点には向かう**。音源地点への移動と、航空Unit本体への追跡を区別する。上空にヘリがいても地上Hexへの移動は可能。

着陸中のヘリはすべてのZombieの通常対象。既存の可視人口優先、Horde継承、Noise Target、Capital Anchor、混雑時Fallbackの優先関係は維持する。

### 18.15.5 原発・空軍基地の期限付きObjective

#### 18.15.5.1 原発

報酬期限は**Turn10のPlayer行動終了まで**とする。期限内の初回確保でRegular Special Forces1隊。生存者は追加せず、生存者数を報酬条件にしない。Supply外の確保も有効。期限以外の報酬条件は現行規則を維持する。

未確保ならTurn11 Player Turn Startに報酬失効・Pack1隊の生成権を確定する。期限内確保後の喪失ではペナルティを発生させない。ドラフトにあった原発への新たな期限前陥落ペナルティは導入しない。

#### 18.15.5.2 空軍基地の基本仕様

内部Facility Typeは `airBase`。固定Mapに中立施設として1基のみ。通常建設では追加できない。陸軍基地と同じworkerCapacity10、感染・陥落・復旧・確保・生存者の共通規則を使う。要求電力10。

専用軍需最大40、迎撃ATK10・Range2・1射軍需2・Noise8など、未変更の防衛値と迎撃回数・補充条件は陸軍基地に準拠する。中立時も健康な生存者・施設状態・専用軍需に応じて既存と同じ防衛を行う。生産・ドローン・迎撃・補給の利用可否は別々に表示する。

生産可能なUnitは **Soldier（内部ID `nationalGuard`）と多目的ヘリコプターのみ**。Field Artillery、Police、Riot Police、Recon Team、Special Forces等は生産不可。兵士の既存生産費・人口・所要時間等は維持する。

初回確保時は食料100・軍需品100を一度だけ付与する。生存者数・早期報酬とは別の台帳で管理し、再確保やLoadで重複しない。陸軍基地の無償兵士報酬は追加しない。

#### 18.15.5.3 空軍基地の早期確保報酬・失敗

Turn10のPlayer行動終了までに初回確保し、健康な生存者1人以上、未確保中の陥落歴なしを満たせばRegular Special Forces1隊。報酬部隊の能力・初期物資・人口5の外部援軍計上・即時行動可能・配置規則は現行原発報酬と共通にする。

未確保ならTurn11 Player Turn StartにPack1隊の生成権を確定する。期限前でも未確保中の陥落でPack1隊の生成権が発生する。期限前陥落と期限切れを重複計上しない。

期限内に初回確保すれば、健康な生存者不足で特殊部隊を獲得できなくても期限切れPackは回避する。ただし確保前の陥落による生成済みPack・出現予約は消さない。期限内確保後の陥落で新たなペナルティPackは発生しない。通常の陥落由来Zombie生成とは別に、このObjective由来を1件として管理する。

#### 18.15.5.4 共通の配置・通知・保存

報酬・失敗は施設ごとに一度だけ。原発と空軍基地を両方達成すれば特殊部隊は合計2隊を得られる。空軍基地の生存者条件を原発へ誤適用しない。

施設Hexが合法で空きなら優先し、塞がっていれば最寄り合法Ground Hexへ既存の安定順で配置する。全候補が塞がっていればpendingを保存して以後のPlayer Turn Startに再試行する。期限内に獲得済みの報酬権は期限後も失効しない。外部援軍人口は実配置時に一度だけ計上する。

Packの行動開始は現行Lifecycleを継承し、敵フェーズ中に生成した個体をそのフェーズの新たな行動対象へ追加しない。Player Turn Start配置ならそのターン終了の敵フェーズから行動する。

期限・報酬・未達成結果を常時参照可能にし、残り5ターン以内はWarning、Turn10はCritical。期限切れの通知と不可視位置での実生成通知を分ける。HiddenのPack位置やpending候補は公開しない。

`rewardDeadlineTurn`, `rewardState`, `failureSpawnState`, `rewardUnitType`, `failureUnitType` と施設ごとの条件をConfig/Stateへ集約する。

### 18.15.6 空軍基地のMap配置

複数の明示的候補からSeeded RNGで1地点を選ぶ。陸軍基地・他施設・Horde Spawn Reserveと重複不可、Groundから到達可能、Road Access生成可能、Initial Zombieの視界外であること。

全候補について、初期の地上部隊が地形・経路上はTurn10 Player行動終了までに到達可能とする。検証では通常の移動MP・地形コスト・初期燃料とその移動制約を使い、初期部隊からの到達経路を確認する。後から生産したヘリを到達保証に使用しない。敵の妨害や確保戦闘の成功、原発との同時確保は保証しない。

両軍事基地の位置を先に確定してから初期Zombie候補を作る。各Zombieの実Visionを用いて両基地の視認を除外し、州都安全距離・初期Human/施設占有・地形制約も維持する。配置・道路・ZombieのRNG順を固定し、Seed検証関数へAir Baseを追加する。Fixed Map ID、Schema、Validationを更新する。

### 18.15.7 軍用ドローン

Actionは `LaunchMilitaryDrone`。発進元の空軍基地をPlayerが所有し、通常稼働・感染等による機能停止なし、給電あり、Supply接続あり、Activeな軍用Drone Visionなし、必要な国家燃料を支払えることを必要とする。

Targetはマップ内の任意Hexで、距離・既探索条件を設けない。燃料費は **hexDistance(空軍基地, Target)×5** を国家備蓄から即時消費する。基地と同Hexなら0。基地専用プールやヘリの燃料から引かない。

Target中心のHex距離10以内にTemporary Visionを設け、地形遮蔽を無視して通常Player Visibilityへ統合する。範囲内のTile・施設・敵は通常の可視情報として公開するが、未公開Wave編成や可視化だけでは開示されない内部情報は公開しない。Droneは盤面上の戦闘Unitではなく、占有・攻撃・迎撃の対象にしない。

発進ターンを含む5 Player Turn。T20発進ならT20～T24と対応する敵フェーズ中に有効、T25 Player Turn Startで失効し再発進可能になる。有効中の重ね掛け・位置変更は不可。発進後は基地が陥落しても期限まで維持する。給電・Supplyの発進条件は発進時の条件であり、飛行中の毎ターン維持条件ではない。

Previewは `target`, `distance`, `fuelCost`, `currentFuel`, `resultingFuel`, `visionRadius`, `activeThroughTurn`, `legal`, `reasonCode`。公開状態は `active`, `sourceFacilityId`, `center`, `radius`, `startedTurn`, `expiresBeforeTurn`, `relaunchAvailable` を含める。

### 18.15.8 多目的ヘリコプターの生産・能力

内部Unit Typeは `multipurposeHelicopter`。空軍基地でのみ生産する。

| 項目 | 値 |
| --- | ---: |
| 生産人口 | 2 |
| 生産民需品 | 100 |
| 生産軍需品 | 140（初期搭載40を含む） |
| 生産燃料 | 500（初期搭載500を含む） |
| 生産時間 | 1ターン |
| 生涯生産上限 | 1機 |
| 初期状態 / 熟練度 | landed / Recruit |
| HP | 100 |
| Recruit ATK | 13 |
| Regular / Veteran ATK | 17 / 17（共通1.25倍・切上げ） |
| Recruit / Regular / Veteran攻撃権 | 1 / 1 / 2（共通規則） |
| 射程 | 2 |
| 視界 | 10 |
| 軍需品プール / 燃料プール | 40 / 500 |
| 飛行中MP / 着陸中MP | 50 / 0 |
| 飛行移動費 | 1MP/Hex、燃料5/MP |
| 飛行状態でのTurn終了燃料 | 1 |
| 固定軍需品維持費 | 1/ターン、両状態共通 |
| 攻撃軍需品・距離0～1 / 距離2 | 2 / 4 |
| 攻撃騒音 / 飛行Turn終了騒音 | 半径8 / 半径15 |
| 歩兵搭載量 | 最大1 Unit（人数制限ではない） |

発注時に費用を支払い、完成時に燃料500・軍需品40を再徴収せず搭載する。人口供出・生産予約・電力・配置待ちは既存の軍事基地生産規則を使う。地上の合法配置先が塞がれば支払い・人口・枠を保持して配置待ち。実際に配備されたときに生涯生産数へ一度だけ加算する。

予約・配置待ちも生涯枠を占め、配備後の死亡では戻らない。配備前の基地陥落等による没収は既存共通機構どおり予約枠を解除し、完成済み数へ加えない。独自の返金は追加しない。二重計上を防ぎ、上限reasonCodeは `lifetime_production_limit_reached`。

通常Humanの昇格条件・反映時点・攻撃権共有へ参加する。施設確保・施設復旧・検問所復旧・感染鎮圧・自動鎮圧・封じ込めは両状態とも不可。費用を巨大化して疑似禁止するのではなくCapabilityで表す。

### 18.15.9 飛行・占有・戦闘・補給

#### 18.15.9.1 状態と行動順

`flightState = landed | airborne` を砲のpacked/deployedと分離し、`TakeOff`, `Land` を追加する。

| 状況 | 許可 / 制限 |
| --- | --- |
| 着陸状態から開始 | 搭乗→離陸→移動→攻撃を許可。順序ごとの通常条件は必要 |
| 同Turnに離陸した | 通常着陸不可。緊急着陸だけ例外 |
| 飛行状態から開始 | 移動→着陸→降機を許可（そのTurnに搭乗した歩兵は降機不可） |
| 飛行中に攻撃 | その後の移動不可。その場での着陸は、同Turn離陸でなければ可能 |
| 同Turnに着陸した | 通常・緊急を問わず再離陸不可 |
| 燃料0で着陸中 | 離陸不可。搭乗時燃料移送等で正の燃料を得れば他条件に従う |

離着陸自体の追加燃料費や攻撃権消費は設けない。離陸で攻撃済み制限・移動消費・攻撃権がリセットされない。`tookOffTurn` に加え、そのTurnの着陸履歴等を保存し、Save/LoadやActionの順序で制約を迂回できないようにする。通常のWait等の既存行動制限も維持する。

#### 18.15.9.2 地上・空中占有

`MovementDomain = ground | air`。搭乗中Unitを占有から除外し、Ground Layerは原則1 Unit、飛行中のヘリはGround Unit・Zombieと同Hexに存在可能。着陸ヘリはGround Layerを占有し、味方・敵Ground UnitのいるHexへ着陸不可。

飛行移動は地形を問わず1Hex=1MP。Forest/Mountain/Water・地上占有を越え、施設上空に滞在できる。Map外への移動不可。着陸先は既存Player Groundの地形・占有制約に従い、水面不可、橋はGroundとして判定する。

`isAirborne`, `isInfantry`, `canTargetAir`, `occupiesGroundLayer`, `canOccupyGroundHex`, `canOccupyAirHex` 等を共通化する。単一Unit取得を全Layerへ流用しない。航空機複数同時存在のルール拡張は今回の対象外だが、地上Unitとの選択・描画・Target IDを取り違えない。

#### 18.15.9.3 攻撃・防御・視界

飛行中は距離0～2へ自発的攻撃・反撃・迎撃が可能。着陸中は自発的攻撃不可、反撃・迎撃のみ可能。必要軍需品未満なら、どの攻撃形態も不成立・消費なし。近距離不足時の低威力攻撃はヘリに適用しない。

対空不可Zombieは飛行ヘリへ反撃・迎撃できない。Hunter / Packは同Hexを含め通常の攻撃権等の条件で対空攻撃できる。

飛行中は地形防御補正なし、野戦砲の直撃・隣接爆風とGas死亡爆発のUnit被害対象外。着陸中は通常の地上補正・両範囲被害を受ける。搭乗歩兵を独立した範囲被害対象へ数えない。ヘリ破壊時の搭乗歩兵死亡は第11章で処理する。

飛行中の視界10は地形遮蔽を無視し、着陸中は視界10の通常Ground視界規則に従う。離着陸後はVisibilityを即時再計算する。地上施設の内部状態公開等のFoW境界は変えない。

#### 18.15.9.4 補給・回復・騒音

ヘリの燃料・軍需補給は **着陸中かつSupply内**で、既存補給処理のタイミング・国家在庫・配分規則に従う。着陸Actionだけで即時満タンにはしない。飛行中はSupply上空でも補給不可。

自然回復は着陸中だけ可能とし、その他の補給条件・通常回復と無行動回復の区別等は現行規則を使う。離着陸を行動として記録し、無行動を偽装しない。固定軍需維持費1は既存と同様に自Unitプールから可能量を消費し、0のとき負数にしない。

攻撃・反撃・迎撃は既存の戦闘騒音発生規則で半径8。Player Turn終了時、飛行中なら移動・攻撃の有無を問わず現在Hex中心の半径15の騒音を出す。着陸中にはこの終了時騒音を出さない。通常Zombieの騒音反応とFallen Site Noise Respawnに接続し、不可視の反応を公開しない。

### 18.15.10 燃料枯渇・緊急着陸

#### 18.15.10.1 発生契機

飛行移動の各Hexで燃料を消費し、0になったHexで残りの経路を中断して直ちに緊急着陸を解決する。残燃料1～4でも1Hexの移動を許可し、全残燃料を消費して移動先で解決する。燃料0からの追加移動・離陸は不可。

Player Turn終了時は **飛行騒音→燃料1消費→0なら緊急着陸**。通常の敵行動を始める前に解決する。移動で既に着陸・死亡した機体へ終了時燃料を二重消費しない。強制着陸は同Turn離陸後でも許可するが、そのTurnの再離陸は禁止。

#### 18.15.10.2 着陸先の決定

1. 現在Hexが合法な空きGround着陸先なら、その場へ強制着陸する。
2. 現在Hexが味方・敵で占有済み、水面、その他Ground着陸不能なら、隣接6Hexのマップ内・Ground着陸可能・Ground占有なしの候補を列挙する。
3. 候補があれば安定座標順の集合からGameplay Seeded RNGで一様に1Hexを選び、そこへ強制着陸する。これは0燃料で通常移動するActionではなく、緊急着陸の配置解決であり追加燃料を要求しない。
4. 候補がなければヘリを破壊し、搭乗歩兵も死亡する。元Hexにいる地上の味方は無傷。
5. 候補なしで元HexにZombieがいる場合は、そのZombieも撃破する。生存HPに応じた通常射撃ではなくドラフトの衝突結果を維持する。

安全な強制着陸だけでは追加HP損失を設けない。衝突で死亡するZombieのGas爆発等は既存死亡Lifecycleへ接続し、ヘリ・搭乗歩兵・敵の死亡統計を各1回だけ計上する。非攻撃Actionの衝突死を通常射撃の撃破として経験値へ重複加算しない。

Previewは緊急着陸リスク、`possibleEmergencyLandingHexes`, `noSafeLandingPossible` 等を公開範囲で示す。不可視Ground占有による結果は確定安全と断言せず、未知の可能性を示す。RNGの実選択先や不可視敵の存在を漏らさない。実行乱数の候補選択・結果は内部Replayで再現する。

### 18.15.11 歩兵輸送・燃料移送・死亡

#### 18.15.11.1 共通輸送状態

`infantry` CapabilityをPolice / Riot Police / nationalGuard / Recon Team / Special Forcesへ付与する。野戦砲・ヘリは対象外。ヘリは人数によらず最大1 Unitを搭載する。

Unit Identity・熟練度・HP・物資・統計上の所属は維持し、搭乗歩兵を独立したMap Occupancyから除外する。独立Vision、独立Supply判定、Target化、Move/Attack/Suppress等の行動、反撃・迎撃・封じ込めを停止する。人口・通常維持費・固定軍需維持費は継続し、補給・自然回復は停止する。ヘリ自身の死亡人口2と搭乗歩兵人口を二重計上しない。

#### 18.15.11.2 BoardAircraft

Playerの着陸中ヘリ、空きCargo Slot、隣接1HexのPlayer歩兵を指定する。歩兵は未行動または移動のみを行った状態で搭乗可能。攻撃・鎮圧等の後、降機後など既存の行動済み状態では不可。移動力を使い切って隣接した場合も「移動後の搭乗」として扱う。

歩兵の残りの行動を消費し、独立操作不能にする。ヘリの移動力や攻撃権は搭乗だけでは消費しない。ヘリ自身が通常の離陸条件を満たせば **Board→TakeOff→Move** が可能。

#### 18.15.11.3 搭乗時の燃料移送

歩兵搭載可能な輸送Unitすべてへ共通の処理とし、今回のヘリに適用する。**搭乗直前の輸送先燃料が0の場合のみ**、歩兵の燃料を輸送先容量まで移す。

移送量 = `min(歩兵の現在燃料, 輸送先の最大燃料)`。歩兵から同量を減らし、輸送先へ加える。余りは歩兵が保持する。輸送先燃料が正なら移送0。燃料0の歩兵も、他条件を満たせば搭乗可能で移送量は0。

国家備蓄・Supplyを使う通常補給とは別の、搭乗Action内の燃料保存的な移送とする。Supply外でも成立する。既に搭乗中の歩兵から自動・任意に再移送するActionは追加しない。降機時の自動返却も設けない。

燃料を得たヘリは通常の離陸条件を満たせば同Turnに離陸可能。ただし同Turnに通常着陸・緊急着陸したヘリは次Turnまで不可。失敗した搭乗Actionで燃料だけが動くことを禁止する。

#### 18.15.11.4 DisembarkAircraft

着陸中でCargoを持つヘリから、隣接1Hexの合法なGround配置先を指定する。**搭乗したTurn中は降機不可**。降機先がなければ状態を変えず拒否する。

reasonCodeは少なくとも `aircraft_not_landed`, `aircraft_has_no_cargo`, `disembark_destination_out_of_bounds`, `disembark_destination_occupied`, `disembark_destination_enemy_occupied`, `disembark_destination_impassable`, `disembark_destination_player_occupancy_forbidden`。同Turn搭乗、非隣接等の不成立も具体的に区別する。

降機歩兵はそのTurnの移動・自発的攻撃・鎮圧等不可、次Player Turn Startから通常行動へ戻る。ただし**直後の敵フェーズの反撃・迎撃は可能**。残軍需・共有攻撃権など通常条件は必要で、乗降によって攻撃権を新規付与・増殖させない。搭乗中も既存のターン更新における残量補充規則と整合し、独立した攻撃は許可しない。

#### 18.15.11.5 ヘリ破壊と再アニメーション

ヘリ本体は死因を問わず再アニメーションしない。乗員人口2の死亡は計上するが、ヘリ由来のSoldier Zombie等を追加しない。

Cargoがあれば同時に死亡し、Unit Catalogの既存対応を使う。

| 搭乗歩兵 | 再アニメーション先 |
| --- | --- |
| Police | Police Zombie |
| Riot Police | Riot Zombie |
| Soldier / Recon Team | Soldier Zombie |
| Special Forces | Pack Zombie |

**橋ではない水面での破壊は、搭乗歩兵が死亡してもZombieを出現させない。** 水上での撃墜・安全な緊急着陸先がなく墜落した場合を同じ扱いにする。水上から隣接Groundへ緊急着陸して生存した場合は死亡処理を行わない。

地上の死亡Hexが合法で空きならそこで生成し、占有されていれば最寄り合法Ground Hexへ既存の安定順で配置する。空きがなければ再アニメーションの出現権をpendingで保持し、後続Player Turn Startに再試行する。pending時点で元歩兵の死亡を計上済みとし、実出現で再計上しない。Save/Load・Replayでも出現権を失わず、重複生成しない。不可視のpendingを公開しない。

生じる個体の行動開始・施設感染・Gas連鎖等は既存Lifecycleを使う。死亡中の搭乗参照を確実に解除し、死体・pending・新Zombieが同じ人口を同時所有しない。

### 18.15.12 組み込みAI

Balanced等の運用AIに、空軍基地確保、Drone偵察、ヘリ生産・離着陸・戦闘・補給・歩兵輸送・燃料救援の判断を追加する。単に合法Action一覧へ追加するだけでは完了としない。Random Agentも追加Actionを共通合法手として扱う。

公開情報だけで、燃料と着陸先、Hunter/Pack、歩兵の役割、施設確保期限、軍需経済、搭乗・降機の行動制限を評価する。航空機自体を確保・鎮圧役として評価せず、必要な歩兵を運ぶ。見えていない安全着陸先・敵・未来のRNGを既知として扱わない。

Droneは偵察範囲・燃料費・有効期間・既存視界の重複を評価し、Active中に再発進を試みない。組み込みAIで実際の輸送と偵察が成立する再現可能なシナリオを設ける。生涯1機や補給不能で技術的ループ・無効Action連発を起こさない。確定バランス下の勝利だけを合格条件にはしない。

### 18.15.13 公開状態・Preview・UI

ヘリObservationには `flightState`, `movementDomain`, `currentFuel`, `maxFuel`, `currentMilitaryGoods`, `maxMilitaryGoods`, `cargoUnitId`, `cargoUnitType`, `canTakeOff`, `canLand`, `canBoard`, `canDisembark`, `canRefuel`, `canResupplyMilitaryGoods` と不成立理由・生涯枠を公開する。Cargo側は `transportedByUnitId` と残物資を公開する。搭乗歩兵を別の地上座標に残っているように表示しない。

| Action / Query | 追加Preview・表示 |
| --- | --- |
| TakeOff | legal/reasonCode、結果Flight State/MP、同Turn通常着陸不可、燃料 |
| Land | 合法性、地上占有、結果状態、補給・回復資格、同Turn再離陸不可 |
| Move | 地形非依存コスト、燃料、経路途中の燃料枯渇位置と強制中断リスク |
| BoardAircraft | 搭乗者、結果Cargo、行動消費、燃料移送量と両者の前後残量、同Turn降機不可 |
| DisembarkAircraft | 隣接先と不成立理由、降機者の行動禁止と反撃・迎撃可能の区別 |
| LaunchMilitaryDrone | 第7章の費用・期間・視界・給電/供給条件 |
| ProduceUnit | 第2章の費用・予約・配置見込み・生涯枠 |
| EndTurn | 飛行燃料1、終了時騒音、緊急着陸リスク、Cargo維持、次TurnのDrone失効 |

着陸先・砲撃着弾等の未確定乱数は確定値で出さず、読取処理はLive RNGを進めない。Flying/Ground同Hexの双方を選択でき、Unit IDで操作対象を明確にする。モバイル縦画面でも搭乗者選択・降機先・Drone照準・騒音/視界・燃料不足を確認できる。通常画面と外部AIだけの機能差を作らない。

Helpは勝敗、経済と人口、電力、施設、人間Unit、Zombie、補給、視界と騒音、Horde、建設、AI/Fair Playへ整理する。ルール説明はHelp、盤面の見た目はBoard Legendに置く。野戦砲Packed/Deployed、空軍基地、ヘリLanded/Airborne、Drone視界をLegendで説明する。同じ長文を両方へ重複掲載しない。日本語/英語を整合させる。

### 18.15.14 アセット制作

次の3枚は2026-09-23に採用承認され、ゲーム用素材へ加工・組込み済み。原本と制作記録は本節末尾、Runtime素材と共通Resolverは18.15.16に示す。

| Asset ID | 要件 |
| --- | --- |
| `facility_air_base` | 陸軍基地と識別可能。滑走路を必ず視認でき、小さい盤面表示でも航空基地と分かる |
| `unit_multipurpose_helicopter_landed` | ブラックホークをモチーフにした独自の中型軍用ヘリ。地面へ接地し、脚と地上姿勢が明瞭。主ローター完全停止・静止した羽根 |
| `unit_multipurpose_helicopter_airborne` | 同じ機体の飛行姿勢。主ローター回転・適度なブラーで飛行中と一目で区別 |

既存Assetの画風・視点・方向・盤面表示サイズ・透過PNG規約を確認して合わせる。実在機の厳密な複製や不要な文字・ロゴを追加しない。原本・実際のプロンプト・採用状態を `Art/reference/v1.6.5-concepts/` に記録する。採用状態は制作記録と一致させる。

描画用Registry/ResolverをNormal Game、Replay、WebMCP Live Viewerで共有し、Flight Stateから対応画像を選ぶ。Cargo表示やDrone Vision範囲は共通Rendererで扱う。小縮尺・FoW・低ZoomのFallbackを維持する。

生成候補は `facility_air_base_candidate_v1.png`、`unit_multipurpose_helicopter_landed_candidate_v1.png`、`unit_multipurpose_helicopter_airborne_candidate_v2.png`。いずれも上記保存ディレクトリ内にあり、2026-09-23に3枚とも採用承認済み。制作記録は同ディレクトリの `README.md` / `prompts.json` を参照する。

### 18.15.15 Config・State・Version・Replay

少なくともFacility airBase、期限付きObjective、Human multipurposeHelicopter、Movement Domain、対空・歩兵・輸送Capability、Flight State、同Turn離着陸/搭乗履歴、双方向Cargo参照、生涯生産/予約数、Temporary Vision、再アニメーションpendingを保存・検証する。Unitを別ObjectにコピーしてIDを失わず、輸送中と地上配置の両方に数えない。

Configへ生産費・生涯上限・飛行移動/燃料・終了燃料・状態別攻撃制限・輸送・騒音・Objective期限・Drone費用/半径/期間を置く。将来の輸送Unitでも搭乗時燃料移送を共有できるようにする。

Map生成、Wave抽選、緊急着陸選択、既存Zombie AI tie-break等のGameplay RNGはCoreだけが消費する。安定列挙順を定め、同Seed/Config/Action列、Save復帰、Checkpoint分岐、Replayで状態Digestが一致すること。

内部ReplayはObjective、Drone発進/失効、離着陸、移動/燃料、緊急着陸、搭乗/降機、燃料移送、Cargo死亡/再アニメーションpending、終了時騒音を再現する。公開Artifact/Event/Viewerは既存の秘匿Projectionを通し、Hiddenの反応・死亡・出現待ち先を漏らさない。

APP_VERSIONは1.6.5。Rules／Map／Save／Action／Agent／Observation／Bridge／Artifact／Checkpoint／Session等の現行Versionと外枠維持の理由は18.15.16に示す。

v1.6.4以前のSave / Replay / Session / Checkpoint / Artifactは互換変換しない。理由付きで拒否し、新規v1.6.5ゲームを案内する。旧データは削除・上書きしない。`nationalGuard`の内部ID維持とは別の互換方針である。


### 18.15.16 確定Version・公開応答・描画

| 項目 | v1.6.5 |
| --- | --- |
| App / Release | 1.6.5 |
| Rules / State / Config | 15.0.0 |
| Fixed Map | fixed-51x51-v9 |
| Save Format | 22 |
| Agent / Observation / Browser Bridge | 20.0.0 |
| Artifact | 19.0.0 |
| Checkpoint / Session | 16.0.0 |
| Action Schema | 3.0.0 |
| Query / AiSession | 1.2.0 |
| Balanced / Random | 13.0.0 / 8.0.0 |
| Play-turn | 1.2.0（外側の要求・応答手順は変更なし） |
| Session Store / Artifact ZIP | 1.0.0（格納外枠は変更なし） |

外枠を維持するProtocolも内包する新Action/State Schemaで互換性を検査する。旧データは互換変換しない。自動保存はv22領域を使用し、v21以前の領域を削除・上書きしない。

Batch Previewは1～100件。CLI `preview-batch --session=ID --revision=N --input=actions.json` はAction配列、WebMCP `nlth_preview_actions` / AiSession `previewActions` は `generation` / `baseRevision` / `actions` を受ける。全件独立評価で、要求全体のRevisionが異なれば競合拒否。WebMCPは合計9ツール。

SessionのCompact応答とContext Handoffにも飛行状態、輸送関係、残物資、航空の可否・理由、生涯生産枠、軍用ドローン、両施設Objectiveを残す。詳細候補はRevision付きQueryで取得する。Normalは同一Hexの地上・空中をID別タブで選択し、Live/Replayは同位置の繰返し選択で切り替える。公開Viewerは施設→地上→空中の順で描画し、搭乗歩兵を独立描画しない。Gasの公開被害一覧も実ダメージと同じ地上対象に限定する。

採用済み3原本は `Art/reference/v1.6.5-concepts/`、加工は `scripts/build-v165-assets.py`、256px透過PNGは `public/assets/board/`。同一Resolverで着陸・飛行画像を選ぶ。▲・▣・DとDrone境界、低Zoomの図形Fallbackを維持する。Helpは11分類、凡例は短い視覚説明に分離する。

### 18.15.17 ローカル検証・今回の完了範囲

- 横断的な全体回帰を1回開始し、113ファイル・988件の終了報告を取得した。その時点の結果は902成功・75失敗・日次専用11 skip。旧Version・電力・生産比・Waveの期待値を確定要件に合わせ、独立シナリオを新初期配置から隔離し、実装不具合を修正した。初回を全成功とは扱わない。
- 失敗した全ファイルの該当テストを再実行し、最終結果で解消を確認した。Help/旧Save境界に合わせて名称を変えた2テストも現名称で成功。全体回帰内の旧差分Balanced1～30だけは長時間継続のため停止し、最新コミットのGitHub専用jobへ委ねる。全体回帰そのものの正常終了は記録しない。Seed198はローカルで成功した。
- 最終の航空Core・AI・UI・アセット・公開Viewerは10ファイル126件成功、Session/Bridge/WebMCP/Liveは4ファイル40件成功。最新コードの標準Config Balanced Seed1は終局まで進み、全Action受理・技術的失敗なし。型検査・本番Build・配布検証スクリプト8件・production Bridge smokeが成功。Buildには従来の大きなbundle警告が残る。重複テストの合算を総数として示さない。
- 公開Actionだけで空軍基地確保→生産→Drone→搭乗→離陸→地上重複飛行→着陸→降機の12判断を構築し、Save復帰とSession Artifact Replay一致を確認。Compact/Context Handoffの飛行・Cargo・Drone維持も確認した。再現用は `scripts/v165-local-acceptance.ts`。専用Configのシナリオを標準難度の戦績と混同しない。
- 実際のBalanced判断で生産、Drone、歩兵輸送、空中戦、着陸補給、燃料救援を検証。AIが地上駐留の待機評価を航空へ誤適用した問題と、Gas公開被害に飛行機体/Cargoを含めた問題は修正前の失敗→修正後成功を確認。保存のヘリ予約Type検証漏れも修正。既存の正常な経路は回帰保証として扱う。
- ローカルChromeのPC幅（929/1280px）と390×844で、日英Help/凡例、採用画像、搭乗燃料の前後、離陸、同Turn降機禁止、Drone照準・費用・期限、地上/空中選択、Cargo表示を確認。ReplayのZIP読込、Turn移動、拡大、重複機体選択、飛行/搭乗詳細を確認。地上に隠れた飛行ヘリは画面で再現し、描画順修正後に視認確認。記録したブラウザconsole errorは0。実機iPhone/Androidの検証ではない。
- WebMCPはローカルChromeにネイティブAPIがないため登録APIアダプターを使用。実Session/Coreで9ツール登録、合法/違法/重複ActionのBatch独立性・Revision不変、実Action後のLive更新を確認した。ネイティブ対応ブラウザで検証済みとは扱わない。
- 日次専用11件は環境フラグ未指定で条件付きskip。GitHubの全200ゲーム、大規模Session、Linux/Windows配布物、Pagesの完了結果は未確認。依頼に従い今回のpush後はworkflowの起動確認だけを行い、監視しない。起動は成功・公開完了を意味しない。
- 確定要件は本節へ反映済み。依頼者の `Doc/archive/` 変更禁止に従い本要件をDoc直下へ保持し、作業開始時からあった文書移動は引継ぎコミットに保存した。archiveの内容を実装根拠として読んでいない。


### 18.15.18 v1.6.5 Release Validation失敗の調査・修正（2026-09-24）

- 対象は [Run 35860218832](https://github.com/plastichyena/nowherelefttohide/actions/runs/35860218832)、Commit `0eb3a1901940ebea571708e231c3a7694d8b9261`。Random／Balanced各Seed1～100の全20 shardと200ゲーム・Replay集計は成功した。Balancedの最大到達Turnは33、Final Horde到達は0であり、Final Hordeの実戦網羅を意味しない。
- 失敗は物理512 MiB Session検証の `EndTurn is not a legal Core action at decision 27`。同じSeed1511と検証用Configでローカル再現し、期限超過によるPack Zombieが原発・空軍基地から合計2体出現し、Turn26の州都陥落で終局していたことを確認した。中立生存者を0にする既存の検証設定だけでは、v1.6.5の独立した期限処理を防げていなかった。
- 長時間保存検証用Configに限り、両施設の期限を既存のFinal Waveと同じTurn1,000,000へ延期した。標準ゲームの期限・敗北処理は変更しない。51×51・21部隊、実GameEngine Action、Snapshot／分岐／Replay一致、1,000判断以上・実容量512 MiB以上・ZIP読込／seek／cancelという検証条件は維持する。
- 回帰テストは30 EndTurnと保存復帰後の1 EndTurn、敵不在・Pack出現0を検証する。修正前は26手目のゲーム終了で失敗し、修正後は成功した。拡張した実Coreテストは約23秒かかるため、当該テストだけ上限を20秒から60秒に変更した。関連5ファイルの30件は各ファイルの最終実行で成功、型検査と証跡再利用ガード3件も成功した。
- 同じ大容量検証ScriptをWindows／Node22.14.0、`--decisions=30 --large-mib=1` で通し、30 EndTurn＋分岐1 Action、Full Snapshot、同一現在状態の長短履歴比較、Artifact読込／Replay一致を確認した。実Artifact容量は20,499,759 bytes、Compact応答比は約4.28%。これは512 MiB全量・1,000判断の代用ではない。
- Workflowへ `session_only` を追加した。既定値falseでは従来の全検証、trueでは物理512 MiB SessionとZIP Viewerのみを実行し、Run名にもSession-onlyと表示する。成功済み200ゲームは再実行せず、部分実行を新しい全体検証成功として扱わない。新Runは起動確認までとし、512 MiB全量の成功判定は後日の結果確認に残す。
- 追補証跡は `src/testing/fixtures/v165-validation-followup.json`。前節の初回ローカル検証記録は当時の事実として保持する。


### 18.15.19 現行仕様の本文再照合（2026-09-24）

- v1.6.5のConfig、Core、公開API・Session、UI Asset Registryと本文・詳細節を再照合した。回復・携行物資、電力・生産・建設費、審査・衛生・飢餓・局所過密、Wave、施設数・道路・湾、基地Objective、砲兵／航空の例外、Versionを同期した。
- Version一覧は18.15.16へ一本化し、旧差分の優先順位で本文矛盾を解決する記述を解消した。18.1〜18.12の履歴本文は変更せず、旧値・旧検証結果を現行ルールから区別した。18.13.17／18.14.14も過去版の検証記録として保持した。
- ドキュメントのUnit能力表・Wave表・Version値を実Configと照合し、実GameEngineのSeed1／7で恒久施設28・初期所有8・Human7隊・Enemy50体・Reserve392 Hexを確認した。全16 Unit Type、15 Facility Type、Unit PNG18枚、WebMCP9 Tool、および衛生・Fuel・収納砲兵の不足時攻撃を実関数で照合した。
- 変更は本書のみ。ゲームコードの変更がないため全体回帰・Buildは再実行していない。Git差分と文書構造を検査し、過去Workflowの結果監視や成功判定の更新は行っていない。`Doc/archive/`は参照・変更していない。
