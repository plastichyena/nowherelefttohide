# Nowhere Left to Hide

## PoC 現行仕様

- ステータス: 現行正本
- 現行Version: v1.3.3
- 基準日: 2026-08-31
- 直近の反映済み変更要件: `Nowhere Left to Hide PoC v1.3.3 アップデート要件 確定版.md`

本書は現在の実装が従う唯一の正本である。実装、テスト、ヘルプ、保存形式が本書と矛盾する場合は本書を優先する。過去の要件定義・仕様書・反映済みアップデート文書は`Doc/archive/`へ保管し、現行判断には使用しない。

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

- 15×15固定ヘックスマップ
- 固定Terrain、重み付き移動、Urban／Forest防御
- Human Unit・管理施設を合成したVisionとFog of War
- PCおよびスマートフォン縦向き
- 警察・州兵の移動、攻撃、反撃、迎撃、待機、自然回復
- ゾンビAI、施設感染、鎮圧、陥落、復旧
- 所在地を持つ民間人口、都市、生産施設、5資源、過密
- 警察・州兵の追加編成
- 道路支線ごとの複数Checkpoint Post、Fallback、避難民、審査、潜伏感染
- Human Unitの通常Combatが周辺のNormal Zombieを誘引するCombat Noise
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
- Unit Test、不変条件試験、複数Seed自動完走試験
- GitHub Actionsによるテスト、ビルド、GitHub Pages公開

## 2.2 対象外

- ランダムマップ、Terrain自動生成、LOS／高低差／視界遮蔽、Waterを使う標準Map
- Replay UI、外部LLM Agent、`balanced`以外の組み込みStrategy
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

# 4. ゲーム概要

- 全言語共通タイトル: Nowhere Left to Hide
- 日本語UIでもタイトルは英語表記の`Nowhere Left to Hide`に統一する。
- プレイヤー: 州知事
- デフォルトFinal Horde発生Turn: 30（Config化）。ゲームルール上のTurn上限はない。
- Final Horde撃退、現在Supply内Zombie排除、同範囲の感染排除をすべて達成すると勝利する。
- Periodic HordeはFinal Horde発生Turn以後生成しない。

次のいずれかが成立した瞬間に敗北し、残りの状態遷移を停止する。

1. 州都が陥落する。
2. 所有中の州都・地方都市・生産施設にいる健全民間人口の合計が0になる。

ユニット人口、検問所内人口、感染者は2の敗北回避に数えない。

---

# 5. UI・操作

## 5.1 レイアウト

- スマートフォン縦向きを基準に、盤面を上部、選択情報と操作を下部へ配置する。
- マップはドラッグパンとピンチズームに対応し、PCではマウス操作にも対応する。
- 上部にターン、フェーズ、総人口、5資源、次回EndTurnの電力予測需要量／利用可能供給量を常時表示する。
- Horde方向と残りターンは独立した警告カードとして常時確認可能にする。
- ターン、Horde、致命的不足等を折りたたみ領域だけへ隠さない。

## 5.2 Bottom Sheet

選択情報・内政・行動領域は次の3状態へスナップする。

1. 折りたたみ: 対象名、HP、感染、稼働状態等のみ
2. 標準: 要約、収支、主要Action
3. 展開: 人口、駐留、感染推移、詳細Actionを内部スクロール

- ハンドルまたはヘッダーをドラッグ・タップして切り替える。
- 地図操作とパネルスクロールを競合させない。
- iPhone Safe Areaを考慮する。
- タッチ対象は原則44 CSS px以上とする。
- パネル状態はUI状態でありGameStateへ保存しない。

## 5.3 Unit Action Mode

- Player Unitを選択した時点では情報、Vision、HP、射程、補給状態だけを表示し、別Hexのタップから移動・攻撃へ暗黙移行しない。
- 選択Unitの近傍に`Move / Attack / Wait`のAction Menuを表示する。各Actionの有効状態はCoreが列挙するLegal Actionsだけから導出し、UI独自の合法性判定を持たない。
- Move Modeでは合法な移動先、Attack ModeではFoWを維持した合法な攻撃対象だけを強調する。対象選択後は対象Hex近傍へ左`×`／右`✓`の確認UIを表示し、既存`Move`／`Attack` Actionを実行する。
- WaitはAction Menuから即時実行して選択を解除する。Target確認中のCancelは同じAction Mode、Action Mode中のCancelはUnit Selected、Unit Selected中の空白タップまたは同Unit再タップは未選択へ1段ずつ戻す。
- Action Menuと確認UIは44 CSS px以上のタッチ対象とし、画面端では盤面内へ収め、パン・ズーム・リサイズへ追随する。これらの状態はController内だけのUI状態であり、GameState、Save、Replay、Agent APIへ含めない。
- Bottom Sheetの既存Move確認とWaitは移行期間の補助操作として残せるが、盤面近傍UIを主要操作とし、主要Unit ActionはBottom Sheetまで指を移動せず完結できる。

## 5.4 人口操作UI

- 生産施設への割り当てはスライダーと数値入力を併用し、双方向に即時同期する。
- 数値は整数へ正規化し、0から合法な最大値へクランプする。
- 数値入力へ`inputmode="numeric"`を設定する。
- 都市間移住は移動元、移動先、人数、実行後人口と過密予測を確認してから確定する。
- 新規確保・感染復旧した施設は次ターンから操作可能であることを無効理由とヘルプ／Tipsへ表示する。

## 5.5 ガイドとヘルプ

- 初回ガイドで移動、攻撃、人口配置、ターン終了を説明する。
- 日本語・英語の常設ヘルプを提供する。
- 人口は盤面上の所在地から消せないこと、施設撤収時の帰還、都市過密、編成拠点制限、v1.3.2以前のセーブ非互換を説明する。
- 道路別の次回到着、未管理時の素通りリスク、都市のソフトキャップ超過受入を表示する。
- 補給オーバーレイは常設切替を持ち、新設・移設、検問所選択、労働者配置で自動表示する。補給範囲、セクター境界、検問所半径、候補の将来範囲、建設を妨げるZombieを盤面上で識別できる。
- Farm、Civilian Factory、Military FactoryはBottom SheetからPower Supply ON/OFFを切り替え、現在配置とTurn-start Fuelに基づく次回EndTurnの予測給電、倍率、基本出力、予測出力、未給電理由、直前EndTurnの実績給電を区別して表示する。
- 都市はRequired Powerの予測給電と人口由来Civilian Goods出力を表示する。停電時も人口保持、移住、編成、所有、補給、感染、防衛が利用可能であることを停止表示と混同しない。
- 資源不足予測は警告するが、人口0敗北が確定しない限り無視してEndTurnできる。
- ユニットBottom Sheetは補給状態、次のプレイヤーターン開始時の回復区分・率・基礎量・成立条件、基本射程と実効射程、駐留による感染封じ込めと自動鎮圧見込みを表示する。
- 施設Bottom Sheetは上限、1人あたりと現在見込みの入出力、Power Mode、要求電力・発電量、予測／実績給電、停止理由、感染・陥落時の生産損失を表示する。検問所は現在／審査中方針、残り時間と3方針の交換関係を表示する。
- ヘルプは回復10%／20%／0%、駐留封じ込めと自動鎮圧、警察と州兵の民間被害差、州兵の軍需不足時射程、発電停止の波及、厳格方針の合格率50%を日本語・英語で説明する。
- 新規ゲームのHorde設定はPeriodic初回・増加・FinalのHorde Zombie／Normal Zombieを分けた6入力とし、標準値`2 / 0 / 1 / 1 / 7 / 5`を表示する。不正な合計0またはNormal ZombieだけのCompositionでは開始しない。
- Help／Board LegendはHorde Zombie HP 20とNormal Zombie HP 10、Targeting差、Mixed Horde Marker、Periodic初回／増加／Final Compositionを現在Configから日英で説明する。
- Checkpoint建設・移設・Active化中は全支線道路タイル／Postの合法／不合法をAction種別ごとに区別し、不合法候補の選択時にCore Reason Codeの日英文言をBottom Sheet内へ表示する。Stateまたは選択候補が変わった場合は古い理由を残さない。
- 支線パネルはActive／Standby／Dormant、Fallback可否、支線Policy、準備済みPost数を表示する。Active失陥時には州都側のStandby、次にDormantへ即時Fallbackし、前線とSupplyが後退することを説明する。
- Unit詳細、Help、Combat LogはPolice／National Guardとも公開Noise Class `medium`、NoiseがNormal Zombieだけへ作用すること、およびTarget優先順位を表示する。正確なNoise Radius、反応数、対象ID、ZombieのNoise TargetはProduction UIへ出さない。
- 開発BuildだけはCoreが提供する読み取り専用診断を使い、Noise Center、正確なRadius、範囲Hex、反応したNormal Zombie、内部Noise Targetをオーバーレイで確認できる。Production Build、Save、Replay、Agent API、Browser Bridgeには含めず、表示がState、RNG、Action列へ影響してはならない。

## 5.6 盤面Asset・Layer・Board Legend

- Runtime盤面画像は`public/assets/board/`配下の256×256 px透過PNGとし、Plain／Forest／Mountain、Road／Urban、Police／National Guard／Zombie／Horde Zombie、Capital／City／Farm／Civilian Factory／Military Factory／Refinery／Power Plant／Checkpoint、施設・Checkpoint・Horde状態Overlayを収録する。WaterはPNGを持たず既存描画へFallbackする。
- 通常Zombieは承認済みの3体Group、Horde Zombieは同画風の12体密集Swarmとする。両AssetのComic-paintedな傷・血痕は許容するが、写実的またはこれ以上GraphicなGoreと死体表現は使用しない。
- TypeScriptのUI専用Asset RegistryをPathとCore Typeの唯一の対応表とし、Game Core、GameState、Save、Observation、ReplayへAsset Path、読込状態、LOD、表示Marker、Help開閉状態を含めない。BoardとBoard Legendは同じRegistryと状態Mappingを使用する。
- Runtime PNG合計は3 MiB以下とし、生成・後加工・出所・第三者Asset不使用・再生成方法を`public/assets/board/ASSET_MANIFEST.md`へ記録する。App VersionまたはBuild IDをURLへ付与してCache Bustingする。
- ゲーム盤面を表示する前にRegistryの全Assetを一括Preloadし、Loading進捗を表示する。Missing、Load、Decode、Texture登録の失敗はAsset単位で記録し、成功済みAssetを維持したまま失敗対象だけ既存図形・文字描画へFallbackする。読込成否は操作、GameState、RNG、Save、Observationへ影響させない。
- 描画順は`Terrain → Road → Urban → Facility Base → Facility State → Fog暗転 → Unit → 動的Overlay`とする。視界外でもTerrain、Road、Urban、施設、Checkpointを暗転して識別可能にし、Enemy Unitは描画しない。自軍Unitと選択・移動・攻撃・HP・感染・停止予測・Vision・Supply・Horde方向等の操作情報はFogより上に置く。
- Roadは単一透過Assetを隣接する道路Hexの方向へ回転・合成して連続させ、形状別PNGを持たない。施設とUnitが同じHexにある場合は施設を中央、Unitを右下へOffsetし、双方を識別可能にする。
- Camera Zoomが`0.75`未満ではPNGの細部を省いたLODへ切り替え、最小Zoom`0.55`でも陣営、通常Zombie／Horde／Final、主要施設状態を色とSilhouetteで区別する。LODは旧`P / G / Z / H / F`固定文字へ戻さず、閾値と表示状態をGameStateへ保存しない。
- Help内に折りたたみ可能な`盤面アイコン / Board Legend`を設け、Terrain、Road／Urban、4 Unit、Periodic／Final Horde、8施設、一般施設とCheckpointの複合状態、通常Zoom／LOD、動的Overlay、Config由来のRule値を日本語・英語で説明する。進行中は現在GameState Config、GameStateがない場合は標準Configを表示する。Player向けLegendには強制Fallback表示を含めない。
- 上部電力HUDは`requiredPowerDemand + industrialBoostDemand`を分子、`availableGenerationCapacity`を分母とする`予測需要量 / 利用可能供給量`で表示する。日本語Labelは`電力 需要/供給`、英語Labelは`Power Demand/Available`とし、TooltipとAccessible Nameで需要、供給、Core Forecastの不足量を名前付きで伝える。`electricity.shortage > 0`の場合だけ不足状態とし、`0/0`を安全に表示する。実消費量とは呼ばない。

---

# 6. GameState・GameAction・乱数

## 6.1 GameState

最低限、次を保存する。

- Game Version、使用Configの完全なコピー
- Seed、疑似乱数状態、ターン、Final Horde発生Turn、フェーズ
- マップID、基礎Terrain、タイル、道路／Urban Overlay、施設
- 道路支線ID、道路ヘックス、州都への接続、支線ごとの次回到着ターン、ターン内操作状態、`activeCheckpointId`、重複しない`standbyCheckpointIds`、支線所有の`currentPolicy`
- 施設の所有、確保順、操作可能ターン、稼働、陥落、感染
- 産業施設のPower Supply ON/OFFと直前EndTurnの実績給電
- 都市別住民、生産施設別労働者、ユニット人口
- ターン開始時の全所有都市の供給順位・受入順位と人口操作資格
- 5資源、電力Capacity、軍需供給状態
- ユニット、HP、位置、行動・攻撃権
- Checkpointの物理状態、支線、避難民、審査中、配置待ち合格者、感染者、審査中方針、残り時間。RoleはCheckpointへ重複保存せず、支線のActive／Standby参照から`active`／`standby`／`dormant`を導出する。
- Horde Warning、Final Spawn Group／状態、Zombie内部のHorde継承TargetとNoise Target記憶、直近イベント、累積統計、Victory進捗、勝敗

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
- RelocateCheckpoint
- ActivateCheckpoint
- ProduceUnit
- EndTurn
- StartNewGame
- LoadSnapshot

自動鎮圧等もGameEngine内部の決定的な処理とする。不正Actionは状態を変更せず、理由付きエラーを返す。人口移動Actionは移出と移入を原子的に完了させる。

## 6.3 Seed付き乱数

次はSeed付き乱数を使う。

- ゾンビAIの同順位
- Horde方向と同距離配置
- 避難民到着間隔・人数、感染判定、潜伏感染発生先
- Configで有効化した初期人口抽選
- ユニット完成時の同距離配置候補

同じVersion、Config、Map、Seed、Action列から同じ結果を得る。

## 6.4 Headless Interface

```ts
interface HeadlessGame {
  reset(seed: number, config: GameConfig): Readonly<GameState>;
  getState(): Readonly<GameState>;
  getLegalActions(): GameAction[];
  getCheckpointPositionCandidates(): CheckpointPositionCandidate[];
  step(action: GameAction): StepResult;
  isGameOver(): boolean;
  getResult(): GameResult | null;
}
```

- Game Over後の`step`は状態を変更せず拒否する。
- `getLegalActions()`は原子的Actionを返し、人口配置の全組合せを一括列挙しない。
- Random Test Agentは同一ターンのループを避けるAction上限を持ち、合法ならEndTurnへ進める。

## 6.5 Version境界

- App / Release Versionは`1.3.3`とする。
- Game Rules / GameState / Config Versionは`1.4.2`、Fixed Map IDは`fixed-15x15-v2`とする。
- Save Format Versionは`4`、Artifact Schemaは`1.4.2`とする。v1.3.2以前のSave／Replay／Artifactは変換しない。
- Agent API / Observation API / Browser Bridge APIは`1.4.2`、Balanced Agentは`3.1.0`、Random Agentは`1.2.0`とする。
- Agent、Observation、Browser Bridgeは個別のSemVerを持ち、Build IDはCIではGit commit SHA、ローカルではSHAとdirty状態または`local-unknown`を記録する。
- Build IDは乱数とゲーム結果へ影響させない。
- App Versionは表示ReleaseのMetadataであり、Game Rules、Save Format、Artifact Schemaが一致するデータをApp Version差だけで拒否しない。v1.3.2以前のGameStateはGame Rules Version不一致のため変換せず拒否する。

## 6.6 Agent ObservationとAgentGame

Agent向け正式入力はGameStateではなく、JSON互換の`AgentObservation`とする。API／Game Rules Version、Turn、Phase、静的マップ、公開中の資源・人口・施設・部隊・ゾンビ・Checkpoint、Horde、EndTurn Forecast、勝敗に加え、初期補給半径、道路支線と次回到着、Active／Standby／Dormant／Remnant／Ruined／AbandonedのRole、構造上のFallback可否、支線Policy、決定的な補給圏タイル、施設・都市・ユニットの補給状態、支線ごとのターン内操作済み状態、Core生成の全道路Checkpoint位置別候補を含む。

- 人間ユニットは基本／実効射程と軍需不足理由、EndTurn時点の回復区分・率・基礎量・時点・生存／補給条件、感染封じ込め能力、自動鎮圧力・民間被害・対象を返す。予測は攻撃後10%、待機・移動後20%、補給外0%とCore判定に一致させる。
- 施設は所有・状態・補給・人口・上限に加え、1人あたり入出力、Power Mode、需要、Power Supply ON/OFF、予測要求・給電・理由、直前実績、基本／予測生産と倍率、停止理由、感染・陥落時に失う現在生産、封じ込め・鎮圧予測を返す。
- ForecastはFood／Military Goodsの開始備蓄、予測生産、維持必要量、終了備蓄、維持不足を返す。Civilian Goodsは市民維持とMilitary Factory入力を、Fuelは給電希望、実使用、Turn-start Fuel不足、当ターンRefinery生産を、電力は物理Capacity、Fuel制限Capacity、3段階の需要と実割当、未給電施設と理由を分離する。
- Checkpointは物理status、導出Role、3人口プール、感染、残り時間、補給提供、封じ込め・鎮圧予測を返す。Activeだけが到着・新規審査・Supply・Visionを提供する。方針の静的な率と時間は`getApiInfo()`へ置く。
- Checkpoint候補は`actionType`、`branchId`、必要時の`checkpointId`、`position`、`legal`、`reasonCode`を安定順で返す。候補、合法手、実Actionは同じCore Validationを使用し、Hidden Enemyの存在・位置・IDを候補差分から漏らさない。
- PRNG内部状態、将来乱数、出現前Horde規模、デバッグ専用値を含めない。
- Map Terrain、Road／Urban属性、実効移動コスト、防御補正、各Hexの`visibleToPlayer`を返す。Enemy配列は現在Visibleな`zombie`／`hordeZombie`だけを含める。
- HordeはWarning種別・方向・残りTurn・発生Turn・Final Horde状態、Victoryは3条件の真偽値を返す。Enemy内部Target、継承記憶、Noise Target、Spawn Group、Hidden位置・ID・個体数を返さない。
- `getApiInfo()`は公開Noise RuleとしてClass一覧、Police／National GuardのClass、Hex Distance、Terrain非減衰、Normal Zombieだけが対象であること、`visible_population > inherited_horde > noise > idle`を返す。正確なRadius、反応したHidden ZombieのID／数、Noise Targetは返さない。
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
}
```

## 6.7 組み込みAgentと統一Runner

- `random`と`balanced`は同じAgentGame、Runner、安全上限、Metrics、Artifact形式を使用する。
- Random Agentの選択乱数はGameEngineから独立したSeed付き乱数とする。
- Balanced Agent Versionは`3.1.0`とする。独自乱数を使わず、ObservationとLegal Actionsだけから、安定したActionキーで決定する。
- Visibleな通常Zombie／Horde Zombie、Terrain Movement Cost、Urban／Forest防御、Vision Coverage、Horde警告、Checkpoint Role／Fallback深度、公開Noise Class、Final Horde後の3条件を評価する。Supply内Zombie未排除かつVisible Enemyがいない場合はHidden脅威を前提に探索・巡回する。
- Balancedは即時敗北回避、施設接触拒否、感染鎮圧、Horde防衛、軍需備蓄、食料・民需品・燃料・電力、州都人口バッファ、過密、生産冗長性を含む施設確保、部隊編成と損傷、全支線のActive Checkpoint確立、状況に応じた後方Standby、支線方針、有益なActionがない場合のEndTurnを評価する。`checkpoint_supply_zombie_blocked`はCheckpoint戦略の放棄理由にせず、解消可能な阻害Zombieの除去またはSupply条件改善を再評価する。
- 所有中かつ健全民間人口がいる施設に対し、各Zombieが現在接触中か、次のZombie Turnに移動力内から接触可能かを公開Observationだけで予測する。州都、単一供給源、軍需工場、健全民間人口の多い施設を高脅威として扱う。
- National Guardは射程2と対Zombie確殺を利用する接触拒否火力として扱い、接触脅威への攻撃、安全な射撃位置、Horde方向側の所有施設防衛を優先する。Horde入口へ直接進出すること自体は目的にしない。
- Policeは感染鎮圧用として温存し、通常の前線移動・攻撃を抑制する。ただし州都への接触を他の手段で防げない場合は防衛へ参加できる。
- 複数Zombieが次の敵行動で到達できる位置への移動・攻撃を露出として減点し、低HP Unitの危険接近を抑制する。
- 未管理道路の流入リスク、Checkpointの新設・方針・Active化・前進・後退、Build／Relocateが同Hexに共存する場合の異なる効果、補給圏を考慮した施設価値・労働者・編成・回復、Checkpoint跡と荒廃地点の防衛・鎮圧・再前進を評価する。全支線を常に3重化するHard Ruleにはしない。
- 軍需品は現在のUnit人口から3ターン分の維持費と編成用バッファを評価し、供給停止前に軍需工場の確保・稼働を進める。National Guardが1隊だけで、軍需品・人口・生産基盤を維持できる場合は2隊目を編成する。
- Food／Civilian Goods／Military Goodsは当ターン生産後の最終収支、Fuelは翌ターンの発電備蓄として評価する。Required都市、産業ブースト、物理発電CapacityとFuel不足、Civilian Goodsの市民維持不足とMilitary Factory入力不足を区別し、労働者再配置とSetPowerSupplyを評価する。
- 州都の健全民間人口は平時15人、州都への接触脅威がある場合20人を目標バッファとする。これを下回る人口配置・編成を減点し、安全都市からの帰還を評価する。
- Farm、Civilian Factory、Refinery、Power Plant、Military Factoryの単一依存を検出し、黒字時でも代替施設の確保と適量稼働を評価する。労働者は最大投入ではなく、不足解消、冗長性、入力資源、州都人口を考慮した目標人数へ近づける。
- 同一ターン内で同じ施設の労働者数や検問所方針を繰り返し変更しないようAction Family単位の反復抑制を行う。接触脅威や感染が残っていても、対応可能なUnit Actionがなければ不要な内政Actionを挟まずEndTurnできる。
- 評価重みと閾値をデータとして分離し、Decisionごとに優先目標、選択Actionと点数、上位候補、理由コードを機械可読Traceとして残す。文章上の思考過程は保存しない。
- `effectiveRange`、軍需不足、負傷部隊の補給圏への後退、戦闘回復と休養回復の比較、駐留封じ込めと自動鎮圧、州兵の鎮圧時民間被害、電力・生産波及、人口・感染・防衛に応じた検問所方針を評価する。Traceは回復、後退、鎮圧、射程、電力、方針の理由コードを持つ。
- 非緊急のForest上Zombieへの非致死Attackを下げ、Urban Defenseを維持し、Plainへ誘導できるWait／Repositionを候補に残す。Capital、Active Checkpoint、重要Facility、民間人口への即時Threat、今TurnのOverrun、Final Horde収束はTerrain／Noise Penaltyより優先する。
- AttackのNoise Riskは、攻撃Unit自身のVision内にいるVisible Normal Zombie数と公開Classだけから近似する。内部RadiusやZombie Target Memoryを推測・使用しない。Urban Defense上ではNoiseを理由に過剰にAttackを避けない。
- Runnerは1ターン、1ゲーム、最大ターンの安全上限をGameConfigと別管理し、上限、例外、不変条件違反、不正Action、Agent停止を技術的失敗として扱う。ゲーム内敗北は正常完遂である。
- 既定では失敗Artifactを残して次のゲームを続け、`fail-fast`指定時だけ停止する。

## 6.8 Batch SimulationとBrowser Bridge

`npm run sim -- --agent=balanced --games=1000 --seed=1 --out=output/simulations/run-name`相当のCLIを提供する。Agent、Seed集合、完全Configまたは検証済みoverride、Runner上限、出力先、fail-fastを指定でき、Random／Balancedを同一Seed・標準Configで比較できる。

- 正本JSON、固定列UTF-8 CSV、成功・敗北を含むゲーム単位Replay Artifact、技術的失敗時のFailure Artifactを出力する。
- 既存出力を既定で上書きせず、明示指定時だけ許可する。
- Artifactは各Version、Build ID、Map、Seed、Config、Agent、受理Action列、不正試行、Result、Metrics、Balanced Traceを持つ。
- Failure Artifactは直前Observation、エラー、Decision番号と、ローカル／CIデバッグ用途の直前・直後GameStateを追加できる。
- ReplayはAction列を再実行し、最終Result、Action数、Observationの不一致理由を報告する。

ゲームページでは追加設定なしに`window.NLTH`を公開する。Bridgeは通常UIとは別のインメモリAgentGameを1つだけ保持し、ページ再読み込みで破棄する。自動保存、localStorage、セーブコード、通常UI状態、ネットワーク、ファイル、Batchへアクセスしない。AgentGameとBridgeの`getApiInfo()`は同じ生成元からVersion、Build ID、公開メソッド、Schema、推奨順序、Fair Play境界、回復・感染・射程・Checkpoint Role／方針・Noise・生産電力の静的ルールを返す。BridgeのProduction ArtifactはNoiseの公開ClassだけをConfigへ含め、正確なRadiusとHidden Noise Metricsを含めない。ローカル／CIの完全な検証Artifactだけは決定的Replay用の完全Configと内部検証Eventを保持できる。

公開メソッドは`getApiInfo`、`reset`、`getObservation`、`getLegalActions`、`step`、`isGameOver`、`getResult`、`getRunArtifact`だけとし、`getState`、`LoadSnapshot`、`StartNewGame`を公開しない。入力を境界で検証し、1回の`step`で1Actionだけを処理する。API説明ページ、最小プロンプト、Smoke手順、外部AI E2Eチェックリストを公開する。

---

# 7. 固定マップと初期状態

## 7.1 マップ

- 15×15固定ヘックス。道路、16施設、4方向のHorde侵入口、道路支線、初期Unit座標は従来どおり固定し、TerrainをSeed生成しない。
- 中央都市圏と東西南北へ延びる主要道路
- 基礎Terrainは`plain`、`forest`、`mountain`、`water`。Road、Facility、Capital、City、Checkpointは別Overlay／属性とし、Terrainと同じenumへ格納しない。
- 以下にないHexはPlainとし、標準MapにWaterは置かない。

Forest（49 Hex）:

```text
(3,4) (4,4) (4,5) (3,5) (4,6) (5,6) (5,4) (3,6)
(9,2) (10,2) (9,3) (10,3) (11,4) (9,4) (10,4) (12,4)
(2,9) (3,9) (3,10) (4,10) (4,11) (5,10) (5,11) (2,10)
(9,9) (10,9) (11,9) (9,10) (10,10) (11,10) (10,11) (11,11) (12,10)
(7,2) (12,7) (7,12) (2,7)
(5,2) (6,2) (6,3) (12,5) (13,5) (12,6)
(1,8) (2,8) (3,8) (6,12) (6,13) (5,12)
```

Mountain（32 Hex）:

```text
(1,1) (2,1) (1,2) (2,2) (3,2) (1,3) (2,3)
(12,1) (13,1) (11,2) (12,2) (13,2) (12,3) (13,3)
(1,11) (2,11) (1,12) (2,12) (3,12) (1,13) (2,13)
(12,11) (13,11) (11,12) (12,12) (13,12) (12,13) (13,13)
(7,1) (13,7) (7,13) (1,7)
```

- 進入先の実効Costを消費し、開始Hexは消費しない。Plain 1、Forest 2、Mountain 3、Waterは進入不能とする。
- RoadまたはUrban Hexは基礎Terrainに関係なくCost 1とする。Human、通常Zombie、Horde Zombieは同じ決定的な重み付き最短経路を使い、同Cost経路は安定座標順で決める。
- Urban Hex上のGround Unitは被通常Combat Damage×0.5、Forest上の通常／Horde Zombieは×0.5。Urbanを優先し、重複しない。RoadはForest防御を消さない。
- Urbanは全施設と、稼働・非稼働・跡・荒廃・放棄を含む全Checkpoint Hexで、所有・状態に依存しない。Terrain防御は通常攻撃、反撃、迎撃に適用し、感染・不足・鎮圧等には適用しない。
- Police／National GuardのVisionは5、通常／Horde Zombieは3。Visionは距離以内でTerrainに遮られない。Capitalは初期Supply Radius、所有・未陥落施設とActive CheckpointだけがVision 1を提供する。Standby、Dormant、Remnant、Ruined、AbandonedはVisionを提供しない。
- Player VisibilityはHuman Unit、Capital、Player所有施設、Active Checkpointの和集合とし、UIとAgent Observationは同じ純粋関数を使う。Terrain、Road、施設・Checkpoint位置と公開済み状態、自軍、Supply、Horde Warning、Final Horde状態、Victory進捗はVisibility外でも既知とする。
- Visibility外Enemyの位置・個体情報・Target・移動・正確なSpawn位置はUI、ログ、Observation、Legal Actions、StepResult、Bridge、公開Eventへ出さず、Last Known Positionも保持しない。
- 公開移動計画ではHidden EnemyのHexを空きとして扱う。実移動で占有Hexへ進入しようとした場合は直前Hexで止まり、移動済みにしてVisibilityを再計算する。Checkpoint新設・移設・Active化のPlayer Action阻害判定にはVisible Enemyだけを使う。ただしAutomatic Fallbackの候補除外はGame Truth上のZombie存在で判定し、その理由を公開しない。

施設は合計16。

- 州都1、地方都市4
- 農場3、民需工場2、軍需工場2、製油所2、発電所2

開始時所有は州都、農場1、民需工場1、製油所1、発電所1。残りは連絡途絶状態とする。

## 7.2 人口上限

- 州都: ソフトキャップ100
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

初期未配置人口は存在しない。警察1隊（人口5）と州兵1隊（人口10）を別に配置する。

初期ゾンビは4駒、位置は次のとおり。

- `(4, 4)`
- `(11, 3)`
- `(3, 11)`
- `(11, 10)`

最寄りの初期所有施設まで最低4ヘックスとし、移動力3の初回ゾンビターンでは施設へ到達できない。

## 7.4 連絡途絶施設

- デフォルト無人。警察または州兵が進入すると、ゾンビ駒がいなければ即時確保する。
- 荒廃感染施設は内部感染者を0にするまで復旧しない。
- 初期生存者・感染者は施設別固定値またはSeed付き範囲をConfigで指定できる。
- 新規確保・復旧した施設は次のプレイヤーターンから人口操作・編成に使用できる。

---

# 8. ユニット・戦闘

## 8.1 初期性能

| ユニット | HP | Attack | Move | Range | Vision | 人口 |
|---|---:|---:|---:|---:|---:|---:|
| 警察 | 25 | 5 | 5 | 1 | 5 | 5 |
| 州兵 | 50 | 10 | 5 | 2 | 5 | 10 |
| 通常Zombie | 10 | 5 | 3 | 1 | 3 | — |
| Horde Zombie | 20 | 5 | 3 | 1 | 3 | — |

すべてConfig化する。

## 8.2 行動

- 各人間ユニットはプレイヤーターン中に1回アクティベートできる。
- 移動のみ、攻撃のみ、移動後攻撃、移動後またはその場で待機を選べる。
- 攻撃後は移動できず、攻撃または待機で行動を確定する。
- 1タイルに存在できるユニット駒は敵味方を問わず1つ。施設はタイル属性である。

## 8.3 戦闘・迎撃

- 攻撃側が先にAttack分のダメージを与える。
- 生存した防御側が、射程内かつ攻撃権ありの場合だけ反撃する。
- 反撃と迎撃は攻撃権を消費する。
- 移動経路で初めて敵射程へ入った地点で迎撃し、その地点で移動を終了する。
- 生存していれば攻撃または待機できる。
- HPを0未満にせず、死亡ユニットを盤面と合法手から除外する。
- 防御側HexのTerrain防御を攻撃、反撃、迎撃へ適用し、軽減前後Damageと防御源をEvent／Metricsへ残す。

## 8.4 自然回復

警察・州兵は次のプレイヤーターン開始時、判定時に補給圏内で生存していれば1回だけ自然回復する。通常攻撃・反撃・迎撃・自動鎮圧を行った場合は最大HPの10%、移動のみ・待機・移動後待機・未行動の場合は20%、補給圏外は0%とする。標準端数処理は各ユニット個別の切り上げで、Configの`combatRate`、`restRate`、`rounding`に従う。HP上限を超えず、ゾンビは回復しない。移動済みでも休養回復を妨げず、補給判定は回復時点で再評価する。

## 8.5 追加編成

- 警察は操作可能な州都・地方都市で予約できる。
- 州兵は操作可能な州都だけで予約できる。
- 編成拠点は補給圏内でなければならない。予約後に補給圏を失っても支払い済みの編成は予定どおり完成する。
- 次の自ターン開始時に完成し、そのターンから行動可能とする。
- 完成拠点が埋まっていれば最寄り空きヘックスへ置き、同距離はSeed付き乱数で決める。
- 人口はターン開始時の供給順位で都市から徴用する。
- 最後の健全民間人口を使う編成は拒否する。
- 初期コストは警察が人口5・民需品10・軍需品10、州兵が人口10・民需品20・軍需品25。

---

# 9. 人口移動・都市

## 9.1 原則

すべての民間人口は州都、地方都市、生産施設、検問所、感染施設のいずれかに所在地を持つ。所在地のない「無職者」「未配置人口」は持たない。

## 9.2 ターン開始時スナップショット

ターン開始時に、所有中かつ陥落していない全都市で次を固定する。

- 供給順位: 人口降順、同数は`facilityId`昇順
- 受入順位: 人口昇順、同数は`facilityId`昇順

同時に、安全かつ前ターン以前に確保・復旧済みかを人口操作資格として固定する。感染都市も順位と資源不足時の損失順には含めるが、供給・受入・移住・編成ではスキップする。ターン途中に順位を再計算せず、途中で感染・陥落した候補は利用不能にする。途中で新規確保・復旧した都市は次ターンまで順位表・候補へ追加しない。

## 9.3 生産施設への配置・撤収

- 安全で操作可能な所有生産施設だけを変更できる。
- 追加人口は補給圏内の施設に限り、供給順位都市から順に差し引く。
- 撤収人口は受入順位都市をソフトキャップまで順に満たす。
- 全都市がソフトキャップ到達後は受入順位で1人ずつ巡回する。
- 供給不足または安全な帰還先なしの場合はAction全体を拒否する。
- 感染中の施設は追加・撤収とも禁止する。
- 補給圏外でも既存労働者の生産と減員・帰還は継続し、自動撤収、即時停止、人口損失は発生させない。

## 9.4 都市間移住

- 操作可能な安全都市間で、距離を無視して任意人数を原子的に移動できる。
- 移動元人口を超えない。
- 移動先のソフトキャップ超過を許可する。
- 感染中、新規確保直後、復旧直後の都市は使用できない。

## 9.5 無人施設

- 手動移動または資源不足で人口0になっても所有を維持し、無人・停止状態になる。
- 感染によって健常人口0になった場合だけ陥落する。

---

# 10. 資源・生産・過密

## 10.1 資源

- 食料、民需品、軍需品、燃料は備蓄する。
- 電力は備蓄せず、そのターンのCapacityとする。

生産初期値:

| 施設 | 労働者1人あたり入力 | 無給電出力 | 給電出力 |
|---|---|---|---|
| 農場 | なし | 食料5 | 食料10 |
| 民需工場 | なし | 民需品5 | 民需品10 |
| 都市 | なし | 0 | 民需品1（SoftCapまで） |
| 軍需工場 | 民需品1 | 軍需品2 | 軍需品4 |
| 製油所 | なし | 燃料5 | 同左 |
| 発電所 | 燃料1で電力5 | 電力Capacity 10 / worker | 同左 |

## 10.2 同ターン生産と備蓄原則

- EndTurn開始時の人口・Unit人口・過密からFood、Civilian Goods、Military Goodsの維持必要量を先に固定する。Food不足死亡で同ターンのCivilian Goods必要量を減らさない。
- 当ターン生産したFood、Civilian Goods、Military Goodsは同ターンの維持消費へ使用できる。
- 当ターン生産した資源は別工程の生産入力へ使用できない。当ターンRefinery生産Fuelは次ターンから発電へ、当ターン生産Civilian Goodsは次ターンからMilitary Factory入力へ使用できる。
- 同ターンCivilian Goods増産で市民維持用予約が減った場合は、余ったTurn-start Civilian GoodsをMilitary Factory入力へ回せる。Turn-start Civilian Goodsが0なら同ターン増産だけでMilitary Factoryを稼働できない。

## 10.3 電力利用区分

- `required`: CapitalとCity。健全民間人口1人以上なら施設単位で電力5を要求し、無給電では人口由来Civilian Goods生産だけが0になる。人口保持、避難民受入、移住、編成、所有、補給、感染、防衛は維持する。
- `boost`: Farm、Civilian Factory、Military Factory。労働者1人以上でPower SupplyがONなら電力5の割当候補となり、給電時は稼働労働者分の生産を2倍、無給電またはOFFでは基本生産を行う。電力不足だけで停止しない。
- `none`: Refinery、Power Plant、Checkpoint。電力供給の影響を受けない。
- 未確保、陥落、人口／労働者0の施設は需要を持たない。5未満の部分給電は行わない。
- Power Supply ON/OFFは所有中・安全・操作解禁済みのboost施設に対する`SetPowerSupply`でだけ変更し、既定、確保、復旧、旧Save移行時はONとする。Actionは資源・人口・Unit行動権も共通Player Action上限も消費せず、同一Player Phase中に何度でも変更でき、受理直後にForecastを更新する。

## 10.4 発電と3段階割当

- Power Plantの物理発電Capacityは全所有・非感染・非陥落発電所の`workers × 10`を州全体で合算する。
- 発電にはTurn-start Fuelだけを使い、`Fuel 1 → Electricity 5`とする。実際に施設へ割り当てた5電力ごとにFuel 1を消費し、余剰CapacityへFuelを消費しない。
- 利用可能電力は`min(物理発電Capacity, Turn-start Fuel × 5)`を5単位へ切り下げる。
- 第1段階はRequired都市、第2段階はPower Supply ONのFarm／Civilian Factory、第3段階はTurn-start Civilian Goods入力を1人分以上確保したPower Supply ONのMilitary Factoryへ割り当てる。
- 各段階内は確保時期が古い施設、同順位は`facilityId`昇順とする。未給電理由は物理Capacity不足、Turn-start Fuel不足、同段階の順位負け、Power Supply OFF、人口／労働者0または非対象、Military Factory入力なしを区別する。
- 複数発電所のCapacityと電力は州全体で共有し、送電線、地域別停電、蓄電、発電所ごとのFuel在庫は扱わない。

## 10.5 Civilian Goods予約と経済処理順

Civilian Goodsの市民維持をMilitary Factory入力より優先する。

```text
maintenanceReservation
= max(0, maintenanceRequired - projectedSameTurnCivilianProduction)

productionInputAvailable
= max(0, startingStock - maintenanceReservation)
```

経済処理は、維持必要量固定、発電上限計算、Required給電、Farm／Civilian Factory給電、生産見込み、維持予約、Military Factory入力割当、Military Factory給電、実割当Fuel消費、生産、生産物追加、Food／Civilian Goods／Military Goods維持消費、不足被害の順とする。ForecastとEndTurnは同じ純粋計算経路を使う。

## 10.6 通常消費

- 食料: 都市住民＋生産施設労働者＋警察人口＋州兵人口と同数
- 民需品: 同上
- 軍需品: 警察人口＋州兵人口と同数
- 検問所の3健常者プールと感染者は消費しない。
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
- 軍需品が1でも不足すると全州兵の射程を1へ下げ、供給回復後の次回判定で2へ戻す。

---

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

- 警察または州兵が感染施設へ駐留すると内部感染の加算を停止する。
- 通常攻撃・反撃・迎撃で攻撃権を消費していなければターン終了時に自動鎮圧し、攻撃権を消費する。待機または移動だけなら攻撃権が残るため自動鎮圧できる。
- 警察はAttack相当を減らす。
- 州兵はAttack相当を減らす一方、`ceil(Attack × 0.5)`の民間人被害を出す。
- 即時`SuppressInfection`は公開Action、合法手、Human UI、Agent API、Bridgeから除去する。直接入力も状態とRNGを変えず拒否する。

## 11.3 陥落

- 感染処理で健常人口0になった場合だけ陥落する。
- 通常施設は荒廃感染施設、検問所は荒廃検問所となる。
- 陥落時感染者は現在値とCapacityの50%の大きい方を基準とする。
- 標準生産施設のCapacity 30では新規陥落時の感染者下限を15とする。
- 陥落時にゾンビ2体を生成し、隣接空き、距離2、距離3の順で最寄りへ置く。同距離はSeed付き乱数。
- 州都陥落時はイベント処理後に即敗北する。

## 11.4 復旧

警察または州兵の鎮圧で感染者0になると復旧する。通常施設の人口は0、検問所は所有と設定方針を維持する。人口操作・編成に使えるのは次のプレイヤーターンからとする。

---

# 12. Checkpoint Fallback Network・避難民

## 12.1 Road BranchとPost Role

- 固定マップは州都の共有交差点から外側へ延びる東西南北の4支線を持つ。各支線は独立した次回到着予定（間隔2～4ターン、1回5～10人）を持ち、到着後に同じ支線の次予定をSeed付きで抽選する。新設、移設、Role変更、荒廃、復旧で到着予定を再抽選しない。
- Checkpointの物理`status`は`operational`、`remnant`、`ruined`、`abandoned`を維持する。行政Roleの正本は`RoadBranchState.activeCheckpointId`と重複しない`standbyCheckpointIds`であり、`CheckpointState`へ可変Roleを保存しない。
- `operational`でActiveでもStandbyでもない同支線PostはDormantである。Observation、UI、EventはCore共通導出関数から`active`、`standby`、`dormant`、`remnant`、`ruined`、`abandoned`を表示する。
- 各支線はActive最大1、Active＋Standby最大3とする。Configは`checkpoint.maxPreparedPostsPerDirection = 3`である。Dormant、Remnant、Ruined、Abandonedは上限を消費しないが、物理地点として残り同じHexへの建設を妨げる。Standby専用維持費はない。上限到達時のStandby新設は`checkpoint_prepared_post_limit_reached`で拒否し、自動撤去・自動降格・`DecommissionCheckpoint`は導入しない。

## 12.2 Active・Standby・Dormantの機能

- Activeだけが新規Refugee Arrivalを受け、Screening Queueを開始し、支線Policyを適用し、Supply FrontとCheckpoint Visionを提供する。
- StandbyはoperationalでAutomatic Fallbackの第一候補だが、新規到着、Screening開始、Supply、Visionを提供しない。
- DormantはoperationalだがActive／Standby上限外のPostであり、新規到着、Screening、Supply、Visionを提供しない。FallbackではStandbyがない場合だけ第二候補であり、Playerは手動でActive化できる。
- 現在Activeに属する既存Screening QueueとRemnantは通常どおり処理を続ける。Standby／Dormantは新規Queueを開始しない。

## 12.3 道路自然流入、方針、配置、潜伏感染

- 到着時にActiveがあればそこへ`waiting`として受け入れ、Activeがなければ素通り方針で同じ避難民フェーズ中に合格、都市配置、潜伏感染を処理する。未管理道路に不可視のPostや人口プールを作らず、安全な受入都市がない回の避難民は州内へ入れず繰り越さない。
- ActiveとRemnantは`waiting`（審査待ち）、`screening`（審査中）、`approved`（配置待ち合格者）を持つ。審査枠は10人で、空きが生じた時点で最大10人を次Batchへ移す。超過分は切り捨て、延期、他道路への振替をしない。Policyは審査開始時に固定し、変更は次Batchから適用する。

| 方針 | 時間 | 合格率 | 感染発生率 | 発生人数率 |
|---|---:|---:|---:|---:|
| 素通り | 0 | 100% | 50% | 50% |
| 通常 | 2 | 75% | 25% | 25% |
| 厳格 | 5 | 50% | 0% | 0% |

- 合格人数は切り捨て、感染人数は切り上げる。安全な受入候補都市へ受入順位で自動配置し、各都市をSoftCapまで満たした後は順位順に巡回する。候補がなければ`approved`のままPostに留め、消費対象にしない。候補が生じた次のPlayer Turn Startに配置する。素通りでは安全な都市があればSoftCap超過後も同フェーズ中に全員を配置する。
- 審査完了時の潜伏感染はSeed付きで判定する。配置済みなら健常人口のいる所有施設からSeed付きで発生先を選ぶ。`approved`で待機する場合はCheckpoint内で即時発生し、`approved → screening → waiting`の順に感染者へ変換する。この逆順は潜伏感染発覚時だけに使う。
- Policyの正本は`RoadBranchState.currentPolicy`で、初期値は`normal`である。`SetCheckpointPolicy`は`checkpointId`でなく`branchId`を受け、Activeがある支線だけ変更できる。Active不在中も直前値を保持し、Build、Relocate、Activate、Fallback、Recoveryで`normal`へ戻さない。開始済みBatchは開始時Policyを保持する。

## 12.4 Supply Sector

- Checkpointに関係なく、州都からHex Distance 5以内を全方向の初期Supply圏とする。各Tileは最も近い幹線道路支線のSectorとし、2本以上が同距離ならすべての同距離Sectorに含める。
- 州都からActiveまでの距離を`R`とし、その支線SectorのSupply半径を`max(5, R)`とする。共有境界はいずれか1つの有効Sectorで満たせばSupply内である。Standby／Dormant／Remnant／Ruined／AbandonedはSupplyを提供しない。
- ActiveのBuild、Relocate、Activate、Automatic Fallback、Recoveryの直後にSupplyを再計算する。Fallback A→BではB基準へ即時後退し、A-B間の前方施設はOut of Supplyになり得るが、Bより州都側のSupplyを無条件に失わない。
- Supply圏外では生産施設の労働者増員、Police／National Guardの自然回復、都市での新規編成予約を禁止する。施設確保・復旧、既存生産、減員・帰還、移動・攻撃・待機・鎮圧、都市間移住、避難民受入は制限しない。

## 12.5 Build・Relocate・Activate

- `BuildCheckpoint`は対象支線の空き幹線道路Tileで民需品5を消費して即時完成し、支線ごとのCheckpoint操作1回と全体Action 1回を消費する。施設、既存Post、州都交差点には設置できず、味方Unitの駐留TileとHorde侵入口には設置できる。
- Activeがない支線へBuildしたPostはActiveになる。Activeがある支線では現Activeより州都側の空き道路TileだけにStandbyとして直接Buildできる。前者は候補Supply Sector、後者は建設先TileだけのVisible Zombieを阻害に使い、別TileのZombie、別Postの感染者、Hidden ZombieはStandby Buildを妨げない。
- `RelocateCheckpoint`はActiveだけを同支線の別道路Tileへ移設し、民需品5、支線操作1回、全体Action 1回を消費する。前線側・州都側のいずれへも移設できる。移設元Active自身の感染だけが移設を妨げ、別Postの感染は妨げない。新地点はActiveとなり、旧Activeに管理人口、感染者、またはZombieが残る場合はRemnant、それ以外は上限に空きがあればStandby、なければDormantになる。
- `ActivateCheckpoint`は同支線のStandbyまたはDormantをActiveへ切り替え、民需品を消費せず、支線操作1回と全体Action 1回を消費する。対象TileのVisible Zombieは利用を阻害する。前線側へSupplyを再拡大する場合だけ`checkpoint_supply_zombie_blocked`をVisible Zombieで判定する。旧ActiveはRemnant条件または上限に従ってStandby／Dormantへ原子的に遷移する。
- 同一後方HexにStandby追加のBuildと即時後退のRelocateが成立する場合、候補Query、Human UI、Agent Observation、`getLegalActions()`はAction種別ごとの両候補を返す。Activate候補も対象Postごとに返す。全候補Query、合法手、実Actionは同じCore Validationを使う。
- 受理されたBuild、Relocate、Activateを合算し、各支線で1ターン1回までとする。拒否ActionとPolicy変更は支線操作を消費しない。候補Reasonは`invalid_checkpoint_tile`、`invalid_checkpoint_branch`、`unknown_road_branch`、`checkpoint_prepared_post_limit_reached`、`checkpoint_standby_requires_rear_position`、`unknown_operational_checkpoint`、`checkpoint_not_activatable`、`checkpoint_same_position`、`checkpoint_wrong_branch`、`checkpoint_infection_blocked`、`checkpoint_branch_action_limit`、`checkpoint_abandoned_forward_block`、`checkpoint_supply_zombie_blocked`、`insufficient_civilian_goods`、`action_limit`、`wrong_phase`、`game_over`等の最初のCore Error Codeとする。不正ActionはState、資源、Action回数、PRNGを変更しない。

## 12.6 Automatic Fallback・Remnant・Recovery

- Activeが敵襲、感染、荒廃などで`operational`でなくなった直後、同支線で州都側にある候補を選ぶ。最初に失陥地点へ最も近い前方のStandby、なければ同条件のDormantをActiveへ昇格し、どちらもなければ`activeCheckpointId = null`とする。前線側のPostは自動昇格しない。
- Fallback候補はGame Truth上でそのHexにZombieがいるPostを除外する。Hidden Zombieの存在、候補除外理由、ID、位置はUI、Observation、公開Event、Reason Codeへ出さない。公開`fallbackAvailable`は州都側に物理statusとRole上の候補があるという構造上の可否であり、Hidden Zombieによる除外を反映しない。
- Fallbackは次のPlayer Turn Startまで遅延せず、失陥処理の直後にRole、Supply、Observationを更新する。次のRefugee Arrival／unmanaged判定、Supply Frontを使う経済・人口判定、後続Unit行動または自動Subphaseより前に解決する。UI通知は次Player Phaseにまとめてもよい。
- Fallback後の新規到着は新Activeへ入る。旧Activeの`waiting`、`screening`、`approved`、`infected`は移動させず、物理statusに従って処理を続ける。Fallbackは前方領土、Supply、Defense Line、Economic Capacityの喪失を無効化しない。
- Relocate／Activate後の旧Active Remnantは、4人口値（`waiting`、`screening`、`approved`、`infected`）がすべて0で、Hex上にZombieがいない時点で削除せずoperationalへ戻る。Active＋Standbyが3未満ならStandby、3ならDormantとなる。Zombieがいる間はRemnantのままとする。
- Ruined Postは感染者0かつHex上にZombieがいない時にoperationalへRecoveryする。支線にActiveがない場合だけRecovered PostをActiveにし、別Activeがあり上限に空きがあればStandby、なければDormantにする。Recoveryは既存Activeを奪わずSupplyを自動前進させない。前線側のReserveを再びFrontにするにはPlayerが明示的にActivateする。
- ZombieがPost Tile上でTurnを終えた場合は襲撃感染を行う。襲撃と内部感染は`waiting → screening → approved`の順に健常者を感染者へ変換し、3Pool合計0かつ感染者1人以上でOverrunする。空のActive TileへZombieが到達した場合も荒廃し、Active失陥なら即時Fallbackを試みる。感染したRuined／Abandoned地点は同距離・外側への再前進を阻害し、感染者0でAbandoned Postは除去できる。

---

# 13. ゾンビAI・Horde

## 13.1 ゾンビAI

Zombie陣営を`zombie`と`hordeZombie`へ分ける。Combat、感染、占有、不変条件は共通だが、TargetingとHorde／Final Horde帰属は分離する。Horde由来Normal Zombieも既存`zombie` Typeを使い、性能とAIを通常個体と共通化したまま`spawnGroupId`と`hordeKind`だけを持つ。初期配置等のNormal Zombieでは両属性を`null`にする。

- Zombie自身のVision内にあり経路を持つ、施設健常人口、検問所の健常3プール、Police／National Guard人口をPopulation Target候補とする。感染者だけ、人口0、死亡Unitは候補外とする。
- 候補は重み付き最短経路Cost、健常人口の多さ、Seed付き乱数の順で選ぶ。
- Zombie Phase開始時のSnapshotで全Horde Zombie、次に全通常ZombieのTargetを確定してから、Unit ID安定順で移動・戦闘を解決する。
- 通常Zombieは`Visible Population Target > 継承Horde Target > Noise Target > Idle`の順に行動Targetを決める。いずれもなければ移動しない。Horde ZombieはVisible Population、Capitalの順を維持し、Noiseを完全に無視する。
- 継承はHordeのSnapshot上のTarget Hex座標で、Hordeを見失っても保持する。Visible Populationを一時優先しても記憶を保持し、座標到達時に有効Targetがなければ解除する。
- 通常Zombieに継承TargetがなくVision内にHorde Zombieがいる場合だけ`hordeZombie -> zombie`へTargetを伝播する。継承した場合はNoise Targetを破棄する。通常Zombie間、通常からHordeへの伝播は禁止する。
- 複数Horde候補はHex Distance、同距離ならUnit ID昇順で選ぶ。
- Visible Populationを発見した通常ZombieはNoise Targetを破棄し、そのPopulationを見失っても旧Noise地点へ再開しない。Horde ZombieはVisible TargetをVision外まで記憶しない。CapitalはHordeだけが常時知るStrategic Anchorとする。
- Player Unitが参加する通常Combatの開始時、Human UnitがいるHexをCenterとしてNoise Pulseを1回発生させる。Player Attack、Zombie／Horde Attack、Interception、同Combat内のCounterattackが対象で、Counterattackによる二重Pulseは発生させない。Moveのみ、Wait、感染鎮圧、Resource Shortage、Infection Spread、Facility Overrun自体は発生させない。
- 内部RadiusはPolice 4、National Guard 5のHex Distanceで、Terrain、Road、Forest、Mountain、Urbanは遮蔽・減衰しない。Centerと同一Hexでなく、Radius内で、継承Target／Noise Target／Visible Population Targetを持たないNormal Zombieだけが最初のPulseをNoise Targetとして記憶する。複数Pulseは既存Noise Targetを上書きしない。
- Noise Target到達時は記憶をclearする。Zombie Phase開始時の全Horde、全Normal ZombieのTarget Snapshotを先に確定し、Snapshot作成後のCombat NoiseはそのPhaseのDecisionを遡及変更せず、次のSnapshotで有効にする。
- Publicな`noise_emitted` EventはCenter、source Unit ID／Type、Noise Classだけを持つ。正確なRadius、反応数、反応Zombie ID、Noise TargetはInternal Event／Verification Artifact／開発診断だけに残し、Production UI、Observation、公開Event、終了結果、Browser Bridge Artifactへ出さない。公開ClassはPolice／National Guardとも`medium`である。

## 13.2 Horde

- Horde CompositionはConfigの`periodicInitial`、`periodicIncrement`、`finalComposition`へUnit Type別に保持する。標準値はPeriodic初回`{hordeZombie: 2, zombie: 0}`、増加`{hordeZombie: 1, zombie: 1}`、Final`{hordeZombie: 7, zombie: 5}`とする。
- 各値は0以上の整数とし、Periodic初回・各生成回・Finalの合計は1体以上にする。Normal Zombieを1体以上含むCompositionにはHorde Zombieも1体以上必要とし、NormalだけのGroupを拒否する。
- Periodic HordeはTurn 5、10、15、20、25にHorde／Normalを`2/0、3/1、4/2、5/3、6/4`で生成する。従来の総数2、4、6、8、10を維持し、方向は東西南北からSeed付きで決め、予告入口を中心に決定的に配置する。
- Mixed Hordeの各Normal Zombieは、Spawn直後に同じSpawn GroupのHorde Zombieを少なくとも1体Vision内に捉える位置へSeed付きで決定的に配置する。Normal ZombieへCapital Targetを直接付与せず、最初のZombie Phaseで既存Target継承Ruleを適用する。
- `finalHordeTurn`の標準値は30、Final HordeはHorde Zombie 7体とNormal Zombie 5体の計12体とする。全12体へ同一のFinal `spawnGroupId`と`hordeKind: final`を付け、該当TurnのZombie Phase後に予告された1方向へ生成する。生成Turnは行動せず次Turnから行動する。
- Periodic Hordeは`finalHordeTurn`以後生成しない。方向、残りTurn、発生Turn、Periodic／Final種別、Final Hordeの`notStarted | active | defeated`は常時公開し、規模と正確なSpawn位置は非公開とする。
- ゲームルール上の最大Turnはない。Final Horde後も経済、避難民、感染、回復、編成、Supplyを通常処理し、VictoryまたはDefeatまで継続する。Runnerの標準Turn安全上限100は別の技術上限とする。

## 13.3 Victory

Final Horde生成後、次をすべて満たした瞬間に`stateSecured`で勝利する。

1. Unit Typeを問わずFinal Horde Spawn Groupの全12個体がSupply内外を問わず死亡している。
2. 現在のPlayer Supply Network内に通常／Horde Zombieがいない。
3. 現在のSupply内にある全Facility／Checkpoint状態の感染者合計が0である。所有、連絡途絶、陥落、荒廃、放棄、Remnantを問わない。

- 判定時点のSupply Networkを使い、範囲外の通常Zombie／感染地域は条件2・3から除外する。Final Horde個体だけは範囲外でも全滅が必要である。
- 各受理Action後と各自動サブフェーズ後にDefeat、続いてVictoryを判定し、Defeatを優先する。
- `finalHordeDefeated`、`suppliedAreaZombieClear`、`suppliedAreaInfectionClear`の真偽値を公開するが、Hidden個体数、ID、座標は公開しない。

---

# 14. ターン処理

```text
PLAYER TURN START
  自然回復
  攻撃権・行動権回復
  予約ユニット完成
  新規確保・復旧施設の操作解禁
  都市供給・受入順位スナップショット作成
  配置待ち合格者の自動配置
  敗北条件確認
        ↓
PLAYER / DOMESTIC ACTION
  移動・迎撃・攻撃・待機・施設確保
  労働者配置・撤収・都市間移住
  Power Supply ON/OFF
  支線Policy・Checkpoint新設／移設／Active化・ユニット編成予約
        ↓
END TURN VALIDATION
  資源・電力・過密予測と警告
        ↓
ECONOMY
  EndTurn開始時の維持必要量＋過密追加消費を固定
  Turn-start Fuelと物理発電Capacityを決定
  Required都市 → Farm／Civilian Factory → 入力確保済みMilitary Factoryへ給電
  Civilian Goods維持予約・Military Factory入力配分
  実割当分のFuel消費
  生産物追加
  Food → Civilian Goods → Military Goods維持消費
  不足被害・軍需供給更新・敗北確認
        ↓
REFUGEES
  直前のActive失陥があればFallback済みのRole／Supplyを使用
  到着・審査・合格・自動配置または配置待ち
  潜伏感染・敗北確認
        ↓
INTERNAL INFECTION / SUPPRESSION
  鎮圧・内部感染・Checkpoint Active失陥時の即時Fallback・復旧・敗北確認
        ↓
ZOMBIE TURN / INFECTION
  Phase開始時Target Snapshot（Visible > Horde継承 > Noise > Idle）
  AI・移動・迎撃・戦闘・Combat Noise・施設／Checkpoint感染
  Active失陥時の即時Fallback・敗北確認
        ↓
  PERIODIC HORDE SPAWN（finalHordeTurnより前）
  FINAL HORDE SPAWN（finalHordeTurnのみ、次Turnから行動）
        ↓
  DEFEAT CHECK → 3-CONDITION VICTORY CHECK / NEXT TURN
```

各サブフェーズ内の順序は決定的にする。即時敗北成立後は残り処理を行わない。

---

# 15. 保存・復元

- 各確定Actionまたはターン終了時にローカル自動保存する。
- セーブコードはVersion、Config、Map ID、Seed、完全なGameState、チェックサムを含む。
- 同内容をJSONファイルで入出力できる。
- Version不一致、破損、不正Config、不変条件違反を検出し、現在状態へ適用しない。
- ロード後は保存時Configを使う。
- v1.3.3はGame Rules / GameState / Config `1.4.2`、Fixed Map `fixed-15x15-v2`、Save Format `4`を使う。
- v1.3.2以前の自動保存、セーブコード、JSON Save、Replay、Artifactを一律で変換しない。Version不一致は現在Stateを変更せず、日本語・英語の理由付きで拒否する。旧データを自動変換、削除、上書きしない。新規ゲームはSave Format 4の新Saveキー／Version境界を使う。
- Save 4は複数PostのBranch参照、支線Policy、Zombie Noise Target、Noise Config、v1.3.3統計を完全に検証する。不正Config、不変条件違反、破損も現在Stateへ適用しない。
- v1.3.3 ArtifactはTerrain Map、Vision Config、Zombie Type、Unit Type別Horde Composition、Horde Spawn Group、Horde／Noise Target決定・伝播、Noise Pulse、Final Horde、Victoryを決定的に再現可能にする。Player-facing ReplayにはFoWを適用し、Browser BridgeのArtifactへ内部情報を含めない。Browser Bridge ArtifactのConfigはNoise Classだけを含み、内部RadiusとHidden Noise Metricsを除く。ローカル／CI Runnerの検証用完全Artifactだけが`verificationEvents`、完全Config、Internal Event列を保持し、Replay時に一致確認する。

---

# 16. Event・統計

移動、戦闘、施設確保、人口配置・移住・徴用、資源生産・消費・不足、道路別避難民到着・未管理素通り、感染、鎮圧、陥落、復旧、ユニット自然回復、Checkpoint新設・移設・Role変更・Active化・Fallback・Remnant化・消滅・荒廃・後退・放棄、補給範囲拡張・縮小・補給理由の拒否、Horde、Game Overを理由付きEventとして保持する。自然回復EventはUnit ID／Type、回復前後HP、基礎量、実回復量、区分、率、補給状態を持つ。ユニット撃破Eventは撃破直前位置と補給状態を持つ。Terrain防御の軽減前後Damage、Enemy発見／喪失、Zombie Idle、Horde Target継承／解除、Noise Target付与・到達・上書き、Periodic／Final Spawn Group、Final Horde進捗、Victory条件変化をInternal Eventへ追加し、公開EventはFoW境界を通す。

`noise_emitted`の公開PayloadはCombat Center、source Unit ID／Type、Noise Classだけを持つ。InternalなNoise Target／到達／上書きEventはHidden EnemyのIDや状態を含み得るため、Production UI、Agent Observation、Browser Bridge、公開終了結果へ出さない。

終了統計:

- 勝敗、生存ターン
- 最終・最大人口
- 最終・最大確保施設数
- 民間人損失、ユニット損失
- 感染・資源不足による損失
- Horde迎撃数、主な敗北原因

人口を変えるEventは移動元、移動先、人数、理由を追跡可能にする。

Agentゲーム単位Metricsは、各Version、Build ID、Map、Seed、Config、Agent、勝敗、Game Over理由、最終Turn、Decision／受理／不正Action数、Action／優先目標別件数に加え、次を記録する。

- 初期・最終・最大人口、民間人損失、感染・資源不足損失、受入避難民、最大過密
- 道路別・合計の到着、未管理素通り、方針別審査、受入、州外退去
- Checkpoint新設、Standby／Dormant作成、移設、Active化、Fallback（支線別、Standby由来、Dormant由来、未管理到着防止）、Active失陥、後退、荒廃、復旧、放棄、消滅、未管理道路ターン
- 補給圏内施設数、最大補給半径、補給喪失、補給理由の拒否Action
- 確保・喪失・最終所有施設数
- Unit Type別の初期・完成・損失・最終生存隊数と生存率、補給圏外損失、Type／回復区分別の実回復HP・回数、10%／20%選択回数
- 単一／全生産施設の最大労働者数、26～30人施設Turn、発電所停止Turn、電力不足Turn
- 給電産業施設Turn、停電都市Turn、Refinery／Power Plant追加確保数
- Active Checkpointの方針別branch-turn比率と、方針別の実審査人数比率
- Zombie撃破、Horde迎撃
- Final Horde生成／撃破／全滅、通常／Horde Zombie撃破、最大Visible Zombie、Final Horde後Turn数、Supply内Zombie／感染Clear Turn、Victory Turn
- Periodic Horde Zombie生成数、Periodic Normal Zombie生成数、Final Horde Zombie生成数、Final Normal Zombie生成数。`finalHordeSpawned`と`finalHordeKilled`はFinal Groupの両Unit Typeを合算する。
- Terrain別進入、Urban／Forest防御適用回数と防止Damage、通常Zombie Idle、Horde Target継承／解除、Noise Pulse総数、Police／National Guard Pulse数
- 完全な検証Metricsには`normalZombiesNoiseTargeted`、`noiseTargetsReached`、`noiseTargetsOverriddenByHorde`、`noiseTargetsOverriddenByVisiblePopulation`も含める。これらのHidden Enemy状態を推測し得る値はActive Game Observation、Production終了結果、公開Event、Browser Bridge Artifactから除く。
- 最終食料、民需品、軍需品、燃料

Agent別集約は実行・完遂・技術的失敗・勝敗・勝率、主要値の平均・中央値・最小・最大・p10・p90、Game Over理由、Action／優先目標件数、同一Seed差分を持つ。

---

# 17. 自動テストと不変条件

## 17.1 必須ルールテスト

- 移動、経路迎撃、攻撃、反撃、10%／20%／0%自然回復、回復Eventと予測一致
- 施設確保、操作解禁ターン、感染、鎮圧、陥落、復旧
- 人口供給・受入順位、配置、撤収、都市間移住、編成
- ソフトキャップ、都市生産上限、過密追加消費
- 5資源、同ターン維持利用と生産入力への連鎖禁止、3段階給電、発電Fuel、産業ブースト、都市停電、不足被害
- SetPowerSupplyの合法条件、行動上限非消費、同一Phase中の反復、即時Forecast更新、不正時State／RNG不変
- Civilian Goods維持予約とMilitary Factory入力不足、Fuel希望／実使用／不足、物理Capacity不足の分離、ForecastとEndTurn実績一致
- Active／Remnant Checkpointの3プール、支線Policy、合格、配置、2種類の感染順、陥落
- 4支線の独立到着、未管理素通り、不可視プール不在、到着予定維持
- 初期半径5、同距離共有Sector、Activeによる拡張・Fallbackによる即時縮小、補給制約、候補別Visible Zombie阻害
- CheckpointのActive／Standby／Dormant、支線Policy、直接Standby Build、Relocate、Activate、支線別操作回数、Remnant、空Activeの荒廃、Automatic Fallback、Recovery、Abandoned、消滅
- FallbackのStandby優先、Dormant第二候補、州都側限定、Game TruthのZombie候補除外、Hidden除外情報非漏洩、Refugee Arrival／Supply更新より前の解決
- Checkpoint全道路／Post候補の安定順、候補Reasonと実Action一致、Build／Relocate／Activateの同Hex共存、複数理由の優先順、失敗時State／資源／Action回数／PRNG不変
- ゾンビAI、初期配置、Horde予告・増加・Final Hordeとの分離
- Horde Zombie HP 20／Normal Zombie HP 10、Plainで州兵2撃、Forestで4撃、Unit Type別Compositionの検証・Clone・Save・Help一致
- 標準Periodicの`2/0、3/1、4/2、5/3、6/4`、Finalの`7/5`、Mixed所属、同Group HordeのVision内配置、Final Group全12体の全滅判定、4生成Metrics
- 固定Terrain数・座標・Overlay、重み付き移動、Road／Urban Cost、Water不可、同Cost決定性
- Urban／Forest防御の攻撃・反撃・迎撃と非Combat Damage非適用
- Unit／施設Vision和集合、境界距離、Visibility更新、UI／Observation／Legal Actions／EventのFoW、Hidden移動停止とCheckpoint公平性
- Checkpoint候補のHuman UI合法／不合法表示、日英Inline Reason、State更新時の理由消去、Observation／Bridge／Artifact一致、Hidden Enemy非漏洩
- 通常Zombie Idle／Horde継承／Noise記憶／解除、HordeのCapital指向、Target伝播方向、`Visible > Horde継承 > Noise > Idle`、複数Horde決定性、Snapshot順序
- Police Radius 4／National Guard Radius 5のNoise境界、Terrain非減衰、通常Combat 1回1Pulse、移動後Attack／Zombie Attack／InterceptionのCenter、Counterattack二重Pulseなし、Horde免疫、複数Pulseで最初のNoise保持、到達・Horde／Visible上書き、Phase Snapshot後Noiseの次Phase適用
- Production UI／Agent API／公開Event／終了結果／Browser Bridge ArtifactがNoise Classだけを公開し、正確Radius、反応Hidden ZombieのID／数、Noise Target、Hidden Noise Metricsを漏らさないこと。Development Buildの読み取り専用診断だけが正確なCenter／Radius／範囲／反応／Targetを確認できること。
- Periodic／Final Hordeの規模・Timing・次Turn行動、Turn 31以降継続、3 Victory条件、Supply縮小、Defeat優先
- 勝利・即時敗北、Save Format 4保存・復元、v1.3.2以前のSave／Replay／Artifact拒否
- UI数値入力とスライダー同期
- 全Asset Registry Pathの実File、PNG Decode、256×256 px、透過、3 MiB上限、Water非収録、Type／状態Mapping、BoardとLegendのRegistry同一性
- 一般施設とCheckpointの複合状態、現在停止と停止予測、Periodic／Final Horde Marker、Road接続方向、施設・Unit Offset
- 全Asset成功と個別Missing／Decode／Texture登録失敗のFallback、成功Assetの維持、Loading完了、Fallback中の操作継続とState／RNG不変
- Fog外の既知情報暗転とEnemy非表示、Layer順、Zoom`0.75`境界と最小`0.55`のLOD、日英Board Legend、現在／標準Config、電力HUDの需要／供給・Tooltip・Accessible Name・`0/0`
- v1.3.3の同一Config、Map、Seed、Action列についてUnit Type別Composition、Unit ID、配置、Horde／Noise Target、Combat Noise、Checkpoint候補・Fallback、最終Result、主要MetricsのReplay一致を確認する。

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
```

加えて:

- 所在地のない民間人口が存在しない。
- 人口移動・編成の前後で人口保存則を満たす。
- 1タイル1駒。
- 死亡・行動済みユニットは再行動不可。
- Game Over後に状態遷移しない。
- 生産施設上限を超えない。
- 感染施設へ人口を追加・撤収しない。
- 新規確保・復旧施設を同じターンに人口操作しない。
- 同一Version、Config、Map、Seed、Action列で結果が一致する。
- 各支線のActiveは最大1、`activeCheckpointId`と`standbyCheckpointIds`は重複せず、Standbyは同支線のoperational Postだけを参照する。Active＋StandbyはConfig上限以下であり、Remnant／Ruined／AbandonedはActive／Standbyにならない。
- Activeだけが新規Arrival、Supply、Visionを提供し、Role変更、Fallback、Supply再計算、Event生成はGameEngine内で原子的かつ決定的に行う。`noiseTarget`はNormal Zombieだけが持ち、Horde Zombieは持たない。
- 補給圏とセクターは同じ純粋関数から導出し、Human UI、Headless、Agent、Browser Bridgeで判定を分岐させない。

## 17.3 Random Test Agent

- UIなしでHeadless Interfaceだけを使う。
- 各Action後と各ターン後に不変条件を検査する。
- CIで異なるSeedを最低100ゲーム実行する。
- ローカルではConfig指定で1,000ゲーム以上実行可能にする。
- 失敗時にVersion、Config、Map、Seed、Action列、エラー、直前GameStateを保存する。

## 17.4 Agent／Batch／Bridge

- ObservationがJSON互換、非共有、決定的で、取得時にStateを変更せず、非公開情報を含まないことを試験する。
- 回復・鎮圧・実効射程・部分稼働生産・電力予測がCoreの合法手と実処理に一致し、`getApiInfo()`がAgentGameとBridgeで同じ静的契約を返すことを試験する。
- Legal Actionsがすべて受理され、一覧外ActionでStateとRNGが変わらず、AgentStepResultにGameStateを含まないことを試験する。
- Balancedの即時敗北、施設接触拒否、National Guardの実効射程、Police温存、戦闘／休養回復、補給圏への後退、自動鎮圧、民間被害、同ターン最終収支、Fuel備蓄、Required Power、産業ブースト、Military Factory入力、州都人口、感染、Horde、過密、冗長化、拡張、編成、道路流入、補給、支線Policy・Checkpoint新設／Standby／Activate／Relocate／Fallback防衛・後退、EndTurnの固定Scenarioを意図ベースで試験する。
- Balancedが`checkpoint_supply_zombie_blocked`でもCheckpoint Goalを放棄せず、Non-urgent Forest Hordeへの非致死Attackを抑え、Urbanから不要に離れず、Plainへ誘えるWaitを残し、公開`medium` ClassとUnit Vision内のVisible Normal ZombieだけでNoise Riskを評価し、即時Capital ThreatではTerrain／Noise Penaltyより防衛を優先することを試験する。
- 標準Configの固定Seed 1～100でRandomとBalancedが技術的失敗なく完遂する。特定の勝率や生存ターンは合否条件にしない。
- Random／Balancedの同一Seed比較、決定性、JSON／CSV／ゲーム単位Artifact、失敗継続、fail-fast、Replay一致を試験する。
- Production Buildに`window.NLTH`とAPI説明が含まれ、公開メソッド限定、通常UI／保存分離、入力拒否時の状態保持をSmoke Testする。
- 公開Pagesではブラウザ操作可能な外部Agentを使い、API発見、不正Action訂正、Game Over、Result／Artifact取得とReplayを手動E2E確認する。勝利は合格条件にしない。
- リリース前に標準ConfigのBalancedを固定Seed 1～300で完遂し、直前安定版基準と主要Metricsを比較して重大なバランス異常がないことを確認する。Pages成功後に独立したPortable Package Workflowを成功させ、Commit SHA・App・Node Version入りZIPをBundled NodeだけでSmoke Testする。

---

# 18. PoC完成条件

1. PC ChromeでFinal Horde後の勝利または敗北までTurn上限なくプレイできる。
2. iPhone Safari・Android Chrome相当の縦向きで主要操作と3状態パネルを利用できる。
3. 15×15盤面のパン・ズーム、戦闘、ゾンビAI、施設確保・感染・復旧が機能する。
4. 所在地を持つ人口の配置・撤収・都市間移住・編成が機能し、人口保存則を満たす。
5. 都市ソフトキャップ、生産上限、過密追加消費と予測が機能する。
6. 5資源、3段階給電、産業ブースト、都市停電、Military Factory部分入力、不足被害が機能する。
7. 道路別自然流入、Active／Remnant Checkpointの3プール、支線Policy、配置待ち、潜伏感染が機能する。
8. Unit Type別に増加するMixed Periodic Horde、7/5のFinal Horde、方向予告、Turn 31以降と3条件Victoryが機能する。
9. 日本語・英語Help、Board Legend、Checkpoint Role／FallbackとNoise Class、候補のInline Reason、終了統計を表示する。
10. Save Format 4の自動保存、セーブコード、JSON保存・復元と、v1.3.2以前の状態不変な拒否が機能する。
11. Headless、主要Unit Test、不変条件試験、最低100ゲームのRandom Testが成功する。
12. 許諾的ライセンスだけを使用し、GitHub Actionsでテスト・ビルド・Pages公開が可能である。
13. AgentObservationとAgentGameが非公開GameStateを渡さず、合法手とstepだけで進行できる。
14. Balanced v3.1が公開情報だけを使って決定的に動作し、Checkpoint Network／Fallback、Terrain、公開Noise Class、Vision、FoW、Horde、Victoryと既存経済・感染・補給Scenarioを扱い、RandomとともにSeed 1～100の技術的失敗なし完遂を満たす。
15. 統一RunnerとBatch CLIが同一Seed比較、Metrics、JSON／CSV、Replay／Failure Artifactを生成し再生できる。
16. Production Buildで通常UI・保存と分離した`window.NLTH`とAPI説明を利用できる。
17. App `1.3.3`、Game Rules / GameState / Config `1.4.2`、Map `fixed-15x15-v2`、Save Format `4`、Agent / Observation / Browser Bridge / Artifact Schema `1.4.2`のVersion境界が整合し、v1.3.2以前のSave／Replay／Artifactを状態変更なしで拒否する。
18. 補給オーバーレイ、新設・移設・Active化の全道路／Post候補、Role／Fallback、合法／不合法表示、Inline Reason、将来範囲、Visible阻害ZombieをHuman UIで確認できる。
19. 生産施設上限30、10%／20%自然回復、感染封じ込めと自動鎮圧がHuman UIとAgent Observationで同じCore予測を表示する。
20. Balanced Seed 1～300、Portable Package Smoke、外部AIによるGame Over・Artifact・Replay E2Eを完遂する。
21. Farm／Civilian Factory／Military FactoryはFuel直接入力なしで無給電×1・給電×2、都市は無給電時に人口由来Civilian Goodsだけ0となり、Power Plantは10 Electricity / workerと実割当`Fuel 1 → Electricity 5`で動く。
22. 当ターン生産Food／Civilian Goods／Military Goodsを維持へ使用し、別工程入力へ連鎖させず、Civilian Goods維持予約と各Forecast内訳が実EndTurn結果へ一致する。
23. 固定Terrain、重み付きPathfinding、Urban／Forest防御、Vision／FoWがHuman UI、Core、Agent、Replayで同じ判定を使う。
24. Hidden Enemyの位置・ID・Target・Spawn座標、Noise Target、正確Noise Radius、Noise反応ID／数が公開経路から漏れず、公開移動候補、Checkpoint候補／Reason、Fallback可否、Production Artifactから推測できない。
25. Final GroupのNormal Zombieを含む全12体全滅、現在Supply内Zombie 0、現在Supply内感染者0の進捗を公開し、条件成立時に即時勝利する。
26. Waterを除く256×256 px盤面PNG、UI専用Asset Registry、一括Preload、個別Fallback、Road接続、Fog Layer、施設・Unit Offset、Zoom`0.75`未満のLODが機能し、Runtime PNG合計が3 MiB以下である。
27. Help内Board Legendが盤面と同じRegistryを使い、日英でAsset、複合状態、LOD、動的Overlay、Mixed Horde Marker、現在または標準ConfigのCompositionとRule値を説明する。
28. 上部電力HUDが次回EndTurnの`予測需要量 / 利用可能供給量`を表示し、Core Forecastだけで不足を判定してTooltipとAccessible Nameへ同じ意味を伝える。
29. 390×844と1280×720でMixed Horde、Checkpoint Role／Fallback／Activate候補理由、公開Noise Class／Log、6 Composition入力、通常Zoom、`0.75`未満、最小`0.55`、個別Asset失敗を実ブラウザ確認する。
30. Unit選択、明示的Move／Attack Mode、対象近傍Confirm／Cancel、Unit近傍WaitがMobileで完結し、キャンセル階層、画面端配置、Desktop操作、Core／Replay／Agent API境界を維持する。
31. 4つのUnit Type別Spawn Metrics、Final Horde全体Metrics、Checkpoint Role／Fallback／Noise Metrics、Core Checkpoint候補がSave後の再導出、Observation、Bridge、Artifact、Replay、CSVで一貫する。Hidden Noise Metricsは完全な検証Artifact／CSVだけに含める。
32. Active失陥直後に州都側のStandby、次にDormantへ自動Fallbackし、Arrivalより前にSupplyが再計算される。Standby不在時もDormantが第二線として機能し、前線側のPostは自動昇格しない。
33. Human Unitが参加する通常Combatは1回だけNoise Pulseを出し、Normal Zombieだけが決定的に反応する。Production経路は両Human Unitを`medium`と公開し、開発Buildだけが正確なNoise診断を表示する。
