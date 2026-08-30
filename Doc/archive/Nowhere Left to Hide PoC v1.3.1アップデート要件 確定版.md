# Nowhere Left to Hide PoC v1.3.1 アップデート要件 確定版
## Board Visual Assets / Board Legend

- ステータス: 実装・検証完了・現行仕様反映済み
- 対象App / Release Version: `1.3.1`
- 基準日: 2026-08-30
- 反映先の正本: `Nowhere Left to Hide PoC 現行仕様.md`（v1.3.1）
- 実装開始時の安定版: `Nowhere Left to Hide PoC 現行仕様.md`（v1.3.0）
- 元ドラフト: `Nowhere_Left_to_Hide_v1.3.1_spec_draft.md`

本書はv1.3.1で追加する盤面用2D Asset、描画反映、Help内Board Legendの確定要件である。実装・テスト・動作確認が完了するまでは、`Nowhere Left to Hide PoC 現行仕様.md`を安定版の正本として維持する。完了後に本書を現行仕様へ反映し、Version、実装、テスト、Helpとの整合を確認する。

2026-08-30に実装、Unit／Integration Test、Production Build、Browser Bridge Smoke、固定Seed 1～10のv1.3.0正規化比較、390×844／1280×720の実ブラウザ確認、個別Asset失敗時のFallback確認を完了し、現行仕様へ反映した。

同日の追加視覚レビューにより、当初の3体Horde案を通常Zombieへ採用し、同画風で12体を密集させた新規AssetをHorde Zombieへ採用した。この承認結果を本書と現行仕様の最終基準とする。

---

# 1. 目的

現在の図形・文字中心の盤面へ、PoC / Playtest向けのIconicな2D Assetを導入する。大戦略の盤面として、スマートフォンの小さな表示でも地形、道路、市街地、施設、Unit、施設状態を短時間で識別できることを目的とする。

中心方針は次のとおりとする。

1. 完成品相当の豪華さより識別性を優先する。
2. Asset単体の美しさより、盤面へ並べたときの可読性を優先する。
3. Game Coreとゲームルールを変更せず、UIのAsset mappingと描画だけを拡張する。
4. 状態差分をFull Imageの増殖で管理せず、Base AssetとOverlayを合成する。
5. 画像が利用できない場合も、既存の図形・文字描画でPlayを継続できる。
6. Help内の説明と実際の盤面表示に同じAsset Registryを使用し、対応関係の齟齬を防ぐ。

---

# 2. 世界観とArt Direction

## 2.1 時代と状況

舞台は、Zombie災害による終末が始まった直後の、北米風の架空国家・架空州とする。Playerは、最後になってしまう可能性のある州政府として、社会基盤が崩壊する瀬戸際で行政を続けている。

- 通常の道路、都市、施設は、使用感はあるが概ね形と機能を保っている。
- 通常状態へ大規模な瓦礫、崩落、深い亀裂、長期放棄の表現を入れない。
- 深刻な荒廃は`ruined` Overlayでのみ明示する。
- 感染と危機感は、感染Overlay、Zombie、Horde、既存の警告表示で表現する。
- 実在のアメリカ合衆国、実在州、実在行政機関、実在企業を直接表現しない。
- 実在の国旗、紋章、Badge、Logo、州名、企業名を使用しない。

## 2.2 共通画風

- SimpleかつFlat寄りの2D Board Game / War Game表現とする。
- 俯瞰またはほぼ真上視点へ統一する。
- 軽い陰影は許容する。
- 強いGradient、発光、過剰なEffectを使わない。
- 現行UIの暗い青緑・土色系Paletteへ合わせる。
- 終末感は持たせるが、盤面全体を暗くしすぎない。
- Policeの青、National GuardのOlive、Zombieのくすんだ緑、Hordeの赤橙等、識別用Accentを持たせる。
- 画像内へ文字、数字、実在Logoを入れない。
- Zombieの血液・損傷は写実的または過度に描かない。追加視覚レビューで承認した通常Zombie／Horde ZombieのComic-paintedな傷・血痕は現行基準として許容するが、これ以上Graphicにせず、死体表現は入れない。
- 小サイズで潰れる細部より、外形、余白、太い輪郭、色面を優先する。
- 新しい常時Animation、点滅、発光、揺れを追加しない。

---

# 3. Scope

## 3.1 追加・変更するもの

- `plain`、`forest`、`mountain`の基礎地形Asset
- `road`、`urban`の透過Overlay Asset
- `capital`、`city`を含む全施設種別のBase Asset
- CheckpointのBase Asset
- `police`、`nationalGuard`、`zombie`、`hordeZombie`のUnit Asset
- 所有、停止、感染、荒廃、Checkpoint Lifecycle、Horde、Final Hordeの状態Overlay
- Asset Preload、Asset Registry、描画Mapping、個別Fallback
- 低Zoom用LOD表示
- 同一Hex上の施設とUnitの併記
- Fog of War、既存の動的Overlayとの描画Layer調整
- Help内の`盤面アイコン / Board Legend`
- 上部Resource HUDの電力表記を`予測需要量 / 利用可能供給量`の順へ変更
- 日本語・英語の名称、状態説明、ルール説明
- Asset Manifest、Mapping Test、Fallback Test、LOD Test、画面確認

## 3.2 対象外

- `water` Asset
- 標準MapへのWater追加
- Terrain、Movement Cost、Defense、Vision、Fog of War等のゲームルール変更
- GameState、GameAction、Save、Replay、Agent Observation、Browser BridgeのSchema変更
- Header、Bottom Sheet、Button、Modal、Typography等の全面的な再Design
- Rich Art、3D Asset、Animation、Particle、Sound、Music
- Unitや施設状態ごとのFull Image量産
- 生成時の高解像度原画・中間画像のRepository保存
- Screenshot基準画像をCommitするPixel差分試験

既存UIへの色・余白・表示位置の軽微な調整は、Assetと既存情報の重なりを解消する範囲で許容する。画面構造、操作方法、Game Actionの経路は変更しない。

---

# 4. Versionと互換性境界

## 4.1 Version

- App / Release Versionだけを`1.3.0`から`1.3.1`へ更新する。
- Game Rules / GameState / Config Versionは`1.4.0`のまま維持する。
- Fixed Map IDは`fixed-15x15-v2`のまま維持する。
- Save Format Versionは`3`のまま維持する。
- Artifact Schema、Agent API、Observation API、Browser Bridge API、Balanced Agent、Random AgentのVersionを変更しない。

## 4.2 SaveとDeterminism

- v1.3.0のSaveをv1.3.1でそのままLoadできる。
- Asset Path、Asset読込成否、LOD、表示Marker、Help表示状態をGameStateへ保存しない。
- Asset描画からGameEngineやSeed付き乱数を呼び出さない。
- Asset読込成否が合法手、状態遷移、公開Observation、Replay、Agent判断へ影響してはならない。
- Build IDとApp Versionの差を除き、同じGame Rules Version、Config、Map、Seed、受理Action列から同じCore結果を得る。

---

# 5. Asset形式・配置・容量

## 5.1 保存場所

Runtime Assetは次へ配置する。

```text
public/assets/board/
  terrain/
  units/
  facilities/
  overlays/
  ASSET_MANIFEST.md
```

- `prototype`やVersion番号をPathへ含めない。
- URLはGitHub Pages、Portable Package、Vite Dev ServerのBase Pathで動作するよう解決する。
- Browser Cacheで旧Assetが残らないよう、App VersionまたはBuild由来のCache Bustingを行う。

## 5.2 画像形式

- Runtime画像は256×256 pxのPNGを基準とする。
- Unit、施設、状態Overlayは透過背景とする。
- 地形はPointy-top Hexへ収まる構図とし、Hex外へ不要な描画を出さない。
- RoadとUrbanは透過Overlayとする。
- Repositoryへ保存するのは最適化済みRuntime PNGだけとする。
- 512 px以上の原画、生成候補、切り出し前画像、中間加工画像をCommitしない。

## 5.3 容量上限

- v1.3.1で追加するRuntime画像の合計を3 MiB以下とする。
- 3 MiBを超える場合は、画像追加や解像度増加ではなく、減色、PNG最適化、共通Overlay化で調整する。
- 圧縮後も輪郭、透過境界、小サイズの識別性を目視確認する。

## 5.4 命名規則

File名は小文字Snake Caseとし、CoreのCamel Case TypeとはAsset Registryで対応付ける。

例:

```text
terrain/terrain_plain.png
terrain/terrain_forest.png
terrain/terrain_mountain.png
overlays/terrain_road.png
overlays/terrain_urban.png
units/unit_police.png
units/unit_national_guard.png
units/unit_zombie.png
units/unit_horde_zombie.png
facilities/facility_capital.png
facilities/facility_city.png
facilities/facility_civilian_factory.png
overlays/state_infected.png
overlays/unit_horde.png
overlays/unit_final_horde.png
```

同じ意味のOverlayへ施設種別ごとの複製を作らない。

---

# 6. 必要Asset

## 6.1 基礎地形

次の3種を作成する。

| Type | Motif | 通常状態 |
|---|---|---|
| `plain` | 乾いた草地と土 | 使用感はあるが荒れ果てていない |
| `forest` | 樹冠のまとまり | 木立として即時識別できる |
| `mountain` | 岩肌と稜線 | 高地と進みにくさを感じる外形 |

- 各Typeは1種類とし、Variationは作らない。
- `water`は作成しない。
- Water値が標準外の検証状態で現れた場合は既存の図形描画へFallbackする。

## 6.2 Terrain Overlay

### Road

- 退色はしているが機能中の舗装路とする。
- 大規模な崩落、瓦礫、深い亀裂を入れない。
- 各Road Hexへ独立した同一Iconを置く方式にしない。
- 隣接するRoad HexをUIで導出し、単一Textureを回転・Clipして接続方向へ伸ばす。
- Road形状ごとのPNGを作らない。
- Map DataやRoad Ruleは変更しない。

### Urban

- まだ人の生活と行政が残る、市街地の地表・道路区画・建物基礎を薄く表現する。
- 新品ではないが、長期放棄や過剰劣化を感じさせない。
- 独立した建物Iconではなく、施設・Checkpointより下へ敷く地表Overlayとする。
- Urban防御の存在は分かるが、施設本体の識別を妨げない濃度とする。
- `isUrbanHex`等の現行Core判定を変更しない。

## 6.3 Unit

| Type | Motif | 識別方針 |
|---|---|---|
| `police` | 架空のPolice Badgeと拳銃 | 青系Accent、National Guardと異なる外形 |
| `nationalGuard` | 軍用HelmetとRifle | Olive系Accent、軍事Unitとして明確 |
| `zombie` | 3体のZombie Group | くすんだ緑、個体を数えられる明瞭な外形 |
| `hordeZombie` | 12体のZombie Swarm | 同画風で通常Zombieより大幅に密度と脅威が高い外形 |

- 通常描画では`P / G / Z / H / F`等の固定文字を表示しない。
- 固定文字と既存図形はAsset読込失敗時のFallbackとしてのみ残す。
- Horde Zombieへ共通の脅威Markerを重ねる。
- Final Hordeへ専用外周Markerを追加する。
- Final Horde専用Full Imageは作らない。
- Periodic HordeとFinal HordeのCore Type、`hordeKind`を変更しない。

## 6.4 施設Base Asset

次の8種を作成する。

| Type | Motif |
|---|---|
| `capital` | 州政府庁舎・Dome |
| `city` | 建物群・市街中心 |
| `farm` | 納屋・Silo・畑 |
| `civilianFactory` | 工場・Gear |
| `militaryFactory` | 工場・Rifle・弾薬箱 |
| `refinery` | 貯蔵Tank・配管 |
| `powerPlant` | 発電塔 |
| `checkpoint` | 道路Barrier・監視所 |

- 特定の実在施設を再現しない。
- 施設Baseへ所有、停止、感染、荒廃を焼き込まない。
- Baseは通常状態の、概ね形と機能を保った施設として描く。

## 6.5 状態Overlay

### 共通

- 感染: 赤橙系の警告形状
- 荒廃: 亀裂・欠損

感染と荒廃は一般施設とCheckpointで共通Assetを使用する。

### 一般施設

- 未確保: 灰色系の外枠
- 確保済み: 青緑系の外枠
- 停止中: 一時停止を表す二本線

### Checkpoint

- 稼働中
- 放棄
- 跡地（`remnant`）
- 荒廃は共通Overlayを使用する。

### Unit

- Horde脅威Marker
- Final Horde外周Marker

状態は色だけに依存せず、色と形状を併用する。画像内に状態名、文字、数字を入れない。

---

# 7. 状態Mapping

## 7.1 一般施設

施設はドラフト上の`neutral / active / infected / ruined`という排他的4択へ単純化しない。現行Coreの複合状態を次のLayerへ変換する。

1. 施設種別からBase Assetを選ぶ。
2. `owner === 'player' && status === 'owned'`なら確保済みMarkerを表示する。
3. `owner === 'none' && status === 'unowned'`なら未確保Markerを表示する。
4. 現在の`operationalStatus === 'stopped'`なら停止中Markerを表示する。
5. `infected > 0`なら感染Markerと既存の感染者数表示を重ねる。
6. `status === 'ruined'`または`operationalStatus === 'ruined'`なら荒廃Markerを表示する。

- 「確保済みだが停止中」「未確保かつ感染中」「荒廃かつ感染あり」を表現できる。
- `infected > 0`を感染表示の正データとし、表示専用の感染状態を作らない。
- 荒廃中も感染者が残っていれば、荒廃と感染の両方を表示する。
- 予測と現在状態を同一Markerへまとめない。

## 7.2 停止と停止予測

- 停止中Markerは現在の実績状態を表す。
- 次回EndTurnの電力不足、入力不足、未給電等は、既存Forecastに基づく別の動的警告Overlayで表す。
- 現在停止と停止予測は色、形、Help説明を分ける。
- Forecast表示の判定は現行CoreのForecast関数を使用し、UI独自ルールを作らない。

## 7.3 Checkpoint

Checkpointへ一般施設の所有・停止状態を無理に適用しない。

1. Checkpoint Base Assetを表示する。
2. `status`が`operational / abandoned / remnant / ruined`のどれかに応じてLifecycle Markerを表示する。
3. `infected > 0`なら共通感染Markerと既存の感染者数表示を重ねる。
4. `ruined`には共通荒廃Overlayを使用する。

## 7.4 優先順位

- Base Assetは常に施設種別を表す。
- 荒廃、感染、所有・Lifecycle等、同時に成立する事実は可能な限り併記する。
- Markerが重なる場合は、危険度の高い荒廃・感染を最も読みやすい位置へ置く。
- 数値や詳細は画像へ焼き込まず、既存動的OverlayとBottom Sheetで表示する。

---

# 8. Asset Registryと読込

## 8.1 UI専用Registry

TypeScript上に単一のAsset Registryを設け、最低限次を対応付ける。

```text
TerrainType -> Base Texture
Road / Urban -> Overlay Texture
FacilityType -> Base Texture
Facility / Checkpoint State -> State Overlay
UnitType -> Unit Texture
Horde Kind -> Unit Overlay
```

- Core TypeをAsset Pathへ直接依存させない。
- BoardとHelp内Board Legendは同じRegistryを使用する。
- Mapping外のTypeを型またはTestで検出する。
- RegistryからGameStateを変更しない。

## 8.2 Preload

- ゲーム開始前にRuntime Assetを一括Preloadする。
- 読み込み中は簡潔なLoading表示を出す。
- 一部Assetが失敗しても全体を中断しない。
- 成功したAssetは通常描画、失敗した対象だけFallback描画へ切り替える。

## 8.3 Fallback

- 既存のPhaser Graphicsと固定文字描画をFallbackとして保持する。
- Missing、Decode Error、Texture登録失敗を対象ごとに検出する。
- Fallback発生時は警告を記録するが、Game進行を継続する。
- 1画像の失敗を理由に、成功済みの全AssetをFallbackへ戻さない。
- FallbackからGame Core、RNG、Saveへ副作用を起こさない。

---

# 9. 描画Layerと配置

## 9.1 Layer順

下から上へ次の順序とする。

1. 基礎地形
2. Road
3. Urban
4. 施設／Checkpoint Base
5. 施設／Checkpoint状態Marker
6. Fog of War暗転
7. Unit BaseとHorde Marker
8. HP、感染者数、選択、移動、経路、攻撃、Vision、Supply、Horde侵入方向等の動的Overlay

- Fog外のEnemy Unitは描画自体を行わない。
- 自軍Unitと操作情報はFog暗転より上へ置く。
- Assetよりゲーム状態の可読性を優先する。

## 9.2 同一Hex上の施設とUnit

- 施設・CheckpointはHex中央へ置く。
- Unitが同一Hexへ駐留している場合は右下へOffsetして併記する。
- 施設とUnitを中央で完全に重ねない。
- HP、感染者数、停止、予測警告を互いに重ならない位置へ調整する。
- Hex選択とBottom Sheetの対象選択規則は変更しない。

## 9.3 動的Overlay

次は画像へ組み込まず、既存または更新した動的描画として維持する。

- 選択枠
- 移動可能範囲
- 予定経路
- 攻撃対象
- Vision
- Fog of War
- SupplyとSector
- Checkpoint建設・移設Preview
- HP Bar
- 感染者数
- 停止予測
- Horde侵入方向
- 選択時のID、HP、人口等の詳細

## 9.4 上部HUDの電力表記

上部Resource HUDの電力は、Playerが一般的な`現在の使用・要求 / 利用可能な上限`として読める順序へ統一する。

```text
予測需要量 / 利用可能供給量
```

- 分子は、次回EndTurnにおける`requiredPowerDemand + industrialBoostDemand`とする。
- 分母は、Turn-start Fuel制限と5単位への切り下げを反映した`availableGenerationCapacity`とする。
- 表示例は`⚡ 15/20`とし、日本語の補助Labelは`電力 需要/供給`、英語は`Power Demand/Available`とする。
- 分子は実際に消費済み・割当済みの電力ではないため、仕様、Help、Tooltipで`消費量`とは呼ばない。
- 分母は物理発電Capacityそのものではなく、そのTurnに利用可能な供給量であることを明示する。
- `0/0`は需要も利用可能供給もない状態として表示し、0除算による割合表示へ変換しない。
- 不足警告の正データはCore Forecastの`electricity.shortage`とし、UI独自の不足判定を作らない。
- `electricity.shortage > 0`では警告色、0では通常色を使用する。色だけに依存せず、TooltipとAccessible Nameでも不足を伝える。
- TooltipはSlash表記だけを繰り返さず、予測需要、利用可能供給、Required割当、Industrial Boost割当、不足を名前付きで表示する。
- Accessible Nameは日本語・英語の現在Localeで、予測需要量、利用可能供給量、不足量を読み上げられる文にする。
- GameState、Forecast計算、電力割当順、Fuel消費、施設の給電Ruleは変更しない。

---

# 10. Fog of War

- Terrain、Road、Urban、都市、施設、Checkpointは現行仕様どおりFog外でも表示する。
- Fog外では暗色・低彩度Overlayを重ね、現在見えていないことを示す。
- Fog外でも地形種別、施設種別、公開済み状態を識別可能にする。
- Enemy Unitは現行仕様どおりFog外で完全に非表示とする。
- Last Known Positionを新設しない。
- 自軍UnitはFog暗転より上で通常表示する。
- UIとAgent Observationが使用するVisibility判定を変更しない。

---

# 11. ZoomとLOD

- 通常ZoomではPNG Assetを表示する。
- Camera Zoomが`0.75`未満では低Zoom用LOD表示へ切り替える。
- LOD閾値はUI定数として一元管理し、GameStateへ保存しない。
- LODでは細部を省き、種類ごとのSilhouette、外枠、状態、Horde脅威を強調する。
- LODで旧来の`P / G / Z / H / F`固定文字へ戻さない。
- 最小Zoom`0.55`でも、Unit陣営、通常Zombie／Horde／Final、主要施設状態を区別できる。
- Zoom切替でTextureのちらつき、入力Targetの変化、GameState変更を起こさない。

---

# 12. Help内Board Legend

## 12.1 導線

- 既存Help内に独立した`盤面アイコン / Board Legend` SectionまたはTabを追加する。
- 通常のPlayerがHelp Menuから到達できる。
- 開発専用URLだけにはしない。
- スマートフォン縦画面で内部Scrollでき、既存Helpを過度に長く見せない。

## 12.2 表示内容

Board Legendは、実際の盤面と同じAsset Registryと状態Mappingを使用して次を表示する。

- 3基礎地形
- RoadとUrban
- 4 Unit Type
- Periodic HordeとFinal HordeのMarker
- 8施設Type
- 一般施設の未確保、確保済み、停止中、感染、荒廃
- Checkpointの稼働、放棄、跡地、荒廃、感染
- 通常Zoom Assetと低Zoom LODの対応
- 選択、移動可能範囲、経路、攻撃対象、HP、感染者数
- 現在停止と停止予測
- 上部HUDの電力`需要 / 供給`表示と不足警告
- Vision、Fog of War、Supply、Horde侵入方向

## 12.3 ルール説明

名称だけでなく、最低限次を日本語・英語で説明する。

- TerrainのMovement CostとDefense効果
- RoadとUrbanが基礎TerrainではなくOverlayであること
- Police、National Guard、Zombie、Horde Zombieの役割
- Periodic HordeとFinal Hordeの違い
- 施設Typeの用途
- 一般施設とCheckpointの状態Markerの意味
- 上部HUDの電力は、次回EndTurnの`予測需要量 / 利用可能供給量`であり、実消費量ではないこと
- Fog暗転とEnemy非表示の違い
- 主要な動的Overlayの意味

ゲーム進行中は現在のGameState内Configから数値を取得する。GameStateがない場合は標準Configを使用する。どちらのConfigを表示中か、Legend内へ短く明示する。

Fallbackの強制表示はPlayer向けLegendへ含めず、自動Testまたは開発用切替で確認する。

---

# 13. Asset生成・後加工・Manifest

## 13.1 生成手順

1. 現行盤面とUI Paletteを確認する。
2. 共通PromptとPaletteを定める。
3. 代表3点としてPlain、Police、Capitalを試作する。
4. 390×844と1280×720の実盤面へ仮配置し、画風、明度、輪郭、Sizeを確認する。
5. 代表3点の方向性確定後、残りAssetを同じ方針で生成する。
6. 透過、Crop、色調、輪郭、Size、PNG圧縮を調整する。
7. Board Legendと全状態組合せで確認する。
8. 不採用候補と中間画像をRepositoryへ残さない。

## 13.2 後加工

次の機械的後加工を許容する。

- 背景透過
- CropとCenter調整
- 色調と明度の統一
- 輪郭補強
- 小サイズ向けのDetail削減
- PNG減色・圧縮
- 透過EdgeのCleanup

後加工によって文字、実在Logo、過剰なDetailを追加しない。

## 13.3 Asset Manifest

`ASSET_MANIFEST.md`へ最低限次を記録する。

- File一覧と用途
- 対応するCore Type / UI State
- 共通Art DirectionとPrompt
- 生成日
- 使用した生成手段・Model情報（記録可能な範囲）
- 後加工内容
- 元解像度とRuntime解像度
- 圧縮方法
- 出所・ライセンス・第三者Asset不使用の確認
- 再生成・差し替え時の注意

---

# 14. 必須Test

## 14.1 AssetとRegistry

- 全Registry Pathに実Fileが存在する。
- 全PNGがDecode可能で、256×256 pxである。
- Unit、施設、状態Overlayの透過が有効である。
- Runtime PNG合計が3 MiB以下である。
- `water` PNGが必須Registryへ含まれない。
- 全Terrain、Facility、Unit、Checkpoint StateがMappingされる。
- BoardとBoard Legendが同じRegistryを使用する。
- 未知TypeまたはMissing Mappingを検出する。

## 14.2 状態Mapping

- 未確保、確保済み、停止中、感染、荒廃を個別に表示する。
- 確保済み＋停止、未確保＋感染、荒廃＋感染を併記する。
- 現在停止と停止予測を異なる表示にする。
- Checkpointの`operational / abandoned / remnant / ruined`を区別する。
- Checkpoint感染をLifecycleと併記する。
- Horde ZombieとFinal Horde Markerを区別する。
- 数値やIDをBase Assetへ焼き込まない。

## 14.3 PreloadとFallback

- 全Asset成功時は通常Asset描画を使う。
- 個別Missing、Decode Error、Texture登録失敗で対象だけFallbackする。
- Fallback時も盤面操作とGame進行を継続できる。
- Fallback時にGameState、RNG、Save、Observationを変更しない。
- 通常時に旧固定文字を重ねて表示しない。

## 14.4 Fog、Layer、LOD

- Fog外のTerrain、Road、Urban、施設が暗転しつつ識別できる。
- Fog外Enemyを描画しない。
- 自軍と操作OverlayがFog暗転より上にある。
- 施設と駐留Unitを同時に識別できる。
- HP、感染、停止、Forecast、選択、Vision、SupplyがAssetに隠れない。
- Zoom`0.75`境界で通常AssetとLODが切り替わる。
- 最小Zoom`0.55`でUnit陣営、Zombie種別、主要状態を識別できる。
- LOD切替が入力判定とGameStateへ影響しない。

## 14.5 HelpとLocalization

- HelpからBoard Legendへ到達できる。
- 日本語・英語切替に追従する。
- Asset、通常Zoom、LOD、状態、動的Overlayの対応を掲載する。
- 進行中は現在Config、Stateなしでは標準Configの数値を表示する。
- Helpの説明がCoreのMovement、Defense、Vision、Horde、状態Ruleと一致する。
- 上部HUDの電力が`requiredPowerDemand + industrialBoostDemand`を分子、`availableGenerationCapacity`を分母として表示する。
- 日本語では`需要/供給`、英語では`Demand/Available`の順序を明示する。
- TooltipとAccessible Nameが予測需要、利用可能供給、不足を名前付きで伝える。
- `electricity.shortage > 0`のときだけ不足警告状態となり、`0/0`を安全に表示できる。

## 14.6 Rule非変更とDeterminism

- v1.3.0 Save Format 3をLoadできる。
- 固定Seed 1～10について、同じConfig、Map、受理Action列でv1.3.0と正規化したCore結果を比較する。
- 受理Action列、公開Event列、勝敗、終了Turn、PRNG最終状態、主要Metricsを一致させる。
- Balanced Agentを比較する場合、Observationと選択Action列も一致させる。
- App Version、Build ID等、表示Updateで意図的に変わるMetadataだけ比較対象から除外する。
- 既存Unit Test、Integration Test、Production Build、Browser Bridge Smoke、Portable Package Smokeを成功させる。

---

# 15. 視覚的受け入れ確認

## 15.1 基準Viewport

- Mobile Portrait: 390×844
- PC: 1280×720

両方でDefault Zoom、Zoom`0.75`前後、最小Zoom`0.55`を確認する。

## 15.2 確認項目

- Plain、Forest、Mountainを即時に区別できる。
- Roadが隣接Hexへ連続し、Road Networkとして読める。
- Urbanが施設を邪魔せず、Urban Hexとして分かる。
- 8施設Typeを固定文字なしで概ね判別できる。
- Police、National Guard、Zombie、Horde Zombieを小サイズで区別できる。
- Final HordeをPeriodic Hordeと区別できる。
- 施設・Checkpointの複合状態を色と形で判別できる。
- Fog外の既知情報と、非表示Enemyの違いが明確である。
- 施設上の駐留Unitを同時に読める。
- Pan、Pinch Zoom、Mouse Zoom後にTexture位置がHexからずれない。
- 選択、移動、攻撃、Vision、Supply、HP、感染者数、ForecastがAssetと干渉しない。
- Help内Board Legendと実盤面の見た目・説明が一致する。
- 上部HUDの電力を`需要 / 供給`の順で誤解なく読め、不足時は色以外でも状態を確認できる。
- Asset読込失敗時もFallbackでPlayできる。
- Loading表示から盤面へ遷移する際に不自然なAssetの後差し替えがない。

Screenshotは検証時に生成して目視確認するが、Pixel差分用の基準画像をRepositoryへCommitしない。

---

# 16. 実装順序

## Phase 1: Registryと代表Asset

- UI専用Asset Registry
- Base PathとCache Busting
- Plain、Police、Capitalの代表Asset
- Preload、Loading、個別Fallback
- 代表Viewportへの仮配置とArt Direction確認

## Phase 2: 地形とOverlay

- Plain、Forest、Mountain
- Road接続方向導出と連続描画
- Urban下地
- Fog暗転とLayer順
- Water Fallback維持

## Phase 3: 施設と状態

- 8施設Base
- 一般施設の所有、停止、感染、荒廃
- Checkpoint Lifecycle、感染、荒廃
- 現在停止と停止予測の分離
- 施設と駐留UnitのOffset

## Phase 4: UnitとLOD

- 4 Unit Asset
- Horde、Final Horde Marker
- 通常時の固定文字除去
- Zoom`0.75`未満のLOD
- 最小Zoom確認

## Phase 5: Board Legend

- Help内独立Section / Tab
- 同一Registryを使う一覧
- 通常AssetとLOD対応
- 状態、動的Overlay、Rule説明
- 現在Config / 標準Config切替
- 日本語・英語
- 上部HUD電力の`需要 / 供給`表示、Tooltip、Accessible Name

## Phase 6: 統合確認

- Asset、Mapping、Fallback、LOD、Help Test
- 390×844、1280×720の目視確認
- v1.3.0 Save互換
- 固定Seed 1～10のCore一致
- 全既存TestとProduction Build
- Asset Manifestと容量確認
- 本書の現行仕様への反映

---

# 17. 成果物

- 3基礎地形PNG
- Road、Urban Overlay PNG
- 4 Unit PNG
- 8施設Base PNG
- 共通・施設・Checkpoint・Horde状態Overlay PNG
- `public/assets/board/ASSET_MANIFEST.md`
- UI専用Asset Registry
- Preload、Loading、個別Fallback
- Road接続描画、Fog Layer、駐留Offset、LOD
- Help内`盤面アイコン / Board Legend`
- `予測需要量 / 利用可能供給量`へ統一した上部HUD電力表示
- 日本語・英語説明
- Asset、Mapping、Fallback、LOD、Help、互換性Test
- Mobile / PC視覚確認結果
- 固定Seed 1～10のCore非変更確認結果

---

# 18. 完了条件

次をすべて満たした時点でv1.3.1実装完了とする。

1. App / Release Versionが`1.3.1`である。
2. Game Rules、GameState、Config、Save、Agent API等のVersionを変更していない。
3. v1.3.0 Saveを安全にLoadできる。
4. Waterを除く確定Assetが256×256 PNGで配置され、合計3 MiB以下である。
5. 通常状態が「終末直後で社会基盤がまだ概ね生きている」Art Directionと一致する。
6. Plain、Forest、Mountain、Road、Urbanを盤面で区別できる。
7. Roadが隣接方向へ連続して見える。
8. 8施設Typeを固定文字なしで概ね判別できる。
9. Police、National Guard、Zombie、Horde Zombieを固定文字なしで区別できる。
10. Periodic HordeとFinal HordeをMarkerで区別できる。
11. 一般施設とCheckpointの複合状態を色と形で表示できる。
12. 現在停止と停止予測を区別できる。
13. Fog、HP、感染、選択、移動、攻撃、Vision、Supply等がAssetと干渉しない。
14. 施設と駐留Unitを同一Hexで同時に識別できる。
15. Zoom`0.75`未満でLODへ切り替わり、最小Zoom`0.55`でも主要情報を識別できる。
16. Assetを一括Preloadし、失敗対象だけ既存描画へFallbackできる。
17. Help内Board Legendが実盤面と同じRegistryを使用し、日本語・英語で状態とRuleを説明する。
18. 上部HUDの電力が`予測需要量 / 利用可能供給量`の順で表示され、Tooltip、Help、Accessible Nameも同じ意味を伝える。
19. Asset Manifestが生成・加工・出所・再生成情報を保持する。
20. 固定Seed 1～10でv1.3.0と正規化Core結果が一致する。
21. 必須Test、既存Test、Production Build、Smoke Testが成功する。
22. 390×844と1280×720で視覚的受け入れ確認を完了する。
23. 実装・Test・動作確認後、本書を現行仕様へ反映し、文書と実装を整合させる。

---

# 19. 設計意図

v1.3.1はGame Ruleを増やすUpdateではない。既に存在する地形、施設、Unit、Fog of War、Horde、感染、Supplyの情報を、Playerが盤面からより速く読み取れるようにするUpdateである。

目標とする体験は次のとおりとする。

> 終末が始まった直後、まだ形を保つ州を、最後になるかもしれない行政府が辛うじて動かしている。その状況を、文字の羅列ではなく盤面の地形、施設、駒、状態から理解できる。

Assetは将来差し替え可能なPrototype品質とする一方、状態Mapping、Fallback、LOD、Help Legend、Core非変更の境界は一時的な実装にせず、今後の見た目拡張に再利用できる構造とする。
