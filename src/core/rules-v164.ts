export const RULES_V164 = {
  ja: {
    checkpoints: '感染者0・同Hexに敵なし・復旧可能なHuman駐留で自動復旧。隣接敵は妨げません。野戦砲は復旧不可。Active不在ならActive、存在すれば空きに応じStandby／Dormantになります。',
    artillery: '野戦砲はArmy Baseで1ターン生産。人口5・民需100・軍需200・燃料100を予約時に支払い、Recruit/Packed、軍需100・燃料100で完成します。生涯2隊（予約・配置待ちを含む）。死亡しても枠は戻りません。確保・検問所復旧・鎮圧・感染封じ込めはできません。撃破時は兵士ゾンビ1隊になります。',
    modes: '野戦砲の梱包／展開切替は、そのターンに移動・攻撃・鎮圧・切替をしていない時だけ可能です。切替後は次Player Turnまで移動・攻撃・反撃・迎撃不可。切替費用は0、回復判定では行動として扱います。梱包時は移動10、射程1、攻撃7/9/9、軍需4。移動1MPにつき燃料10、燃料0では緊急移動1MPです。',
    bombardment: '展開時は移動0・射程10〜200・攻撃40/50/50、全熟練度Charge1。軍需50未満では砲撃不可。自動の反撃・迎撃はありません。現在可視の敵／空Hex／水面／施設を指定できます。RecruitとRegularの命中率は50%、外れは距離1〜2／1のHexから一様抽選。Veteranは100%。直撃100%、隣接50%を地形補正し、味方や内部人口にも被害が出ます。Previewは確率であり着弾の予言ではありません。',
    safety: 'AIは着弾・爆風・公開Gas連鎖による巻き込みを避けます。緊急砲撃は、次敵フェーズの拠点陥落危険、代替対処なし、防衛成功率上昇、次Player Turnまでの期待死者減少、全着弾候補で即時敗北なし、をすべて公開情報から評価できる場合だけ候補になります。人間は危険確認後に発射できます。',
    flavor: '兵器庫で眠っていた旧式の野戦砲。GPS誘導弾には対応しているが、専門的な訓練を受けた砲手が不在なため、多少の誤差は覚悟しなければならない。GPSは説明上の設定であり専用弾種・追加資源ではありません。',
    changes: '簡易農場・仮設住宅は民需50、両方とも建設数無制限。感染0の陥落検問所は同Hexの敵がいなくなり復旧可能な部隊が駐留すると自動復旧します。隣接敵は妨げません。Gasは全Waveで抽選され、同方向複数可。Wave内の通常Zombie枠はHorde Zombieになります。Gas死亡爆発はHuman30／Zombie15を地形補正します。',
    compatibility: 'v1.6.3以前のSave / Replay / Session / Checkpoint / Artifactは読込できません。旧データは保管したまま、新規v1.6.4ゲームを開始してください。',
  },
  en: {
    checkpoints: 'Automatic recovery requires zero infection, no enemy on the same Hex and a capable Human garrison. Adjacent enemies do not block recovery. Artillery cannot recover checkpoints. A recovered post becomes Active if none exists, otherwise Standby or Dormant according to available slots.',
    artillery: 'Field Artillery takes one turn at an Army Base: 5 population, 100 Civilian Goods, 200 Military Goods and 100 Fuel paid on reservation. It arrives Recruit/Packed with 100 ammunition and 100 Fuel. Lifetime limit 2 including reservations and pending placement; deaths do not restore slots. It cannot capture, recover checkpoints, suppress or contain infection. Destruction reanimates one Soldier Zombie.',
    modes: 'Pack/deploy only before moving, attacking, suppressing or changing mode that player turn. A change locks movement, attacks and reactions until next Player Turn, costs no resources and counts as activity for recovery. Packed: movement 10, range 1, attack 7/9/9, ammunition 4; 10 Fuel per movement point, or 1 emergency MP at zero Fuel.',
    bombardment: 'Deployed: movement 0, range 10–200, attack 40/50/50, one charge at every proficiency. Requires 50 ammunition. No automatic counterattack or interception. Aim at a currently visible enemy, empty Hex, water or site. Recruit/Regular hit 50%; misses uniformly scatter to Hexes at distance 1–2 / 1. Veteran hits 100%. Impact takes full and adjacent Hexes half damage, adjusted for terrain, including friendly units and internal populations. Preview probabilities do not reveal the actual impact.',
    safety: 'AI avoids possible impact, blast and public Gas-chain friendly casualties. Emergency fire requires an imminent next-enemy-phase site fall, no adequate alternative, higher defense success probability, fewer expected deaths by next Player Turn, and no possible immediate defeat across all impacts. All comparisons use public information. Human players can fire after confirming the danger.',
    flavor: 'An old field gun pulled from the arsenal. It supports GPS-guided rounds, but without trained gunners some inaccuracy is inevitable. GPS is flavor only, with no separate ammunition type or resource.',
    changes: 'Simple Farms and Temporary Housing cost 50 Civilian Goods with unlimited counts. Infection-free ruined checkpoints recover with a capable Human garrison and no enemy on the same Hex; adjacent enemies do not block recovery. Gas participates in every Wave without a per-direction cap. Normal Wave slots become Horde Zombies. Gas death explosions deal Human 30 / Zombie 15 before terrain.',
    compatibility: 'Saves, Replays, Sessions, Checkpoints and Artifacts from v1.6.3 or earlier are rejected. Keep old data and start a new v1.6.4 game.',
  },
} as const;
