export const RULES_V169 = {
  ja: {
    ifv: 'IFV（歩兵戦闘車）は地上部隊です。HP200、ATK16（Regular/Veteran20）、射程・視界5、MP10、騒音10。攻撃回数は3、Veteran4。射撃と自動鎮圧は1回につき軍需品20を必要とし、不足時は実行できません。鎮圧力はATK、民間人被害はceil(ATK×0.5)。確保・検問所復旧・感染封じ込めも可能です。',
    movement: '移動は地形ごとのMPと進入1Hexにつき燃料10を消費します。残燃料1～9でも1Hex進んで燃料0で停止します。燃料0からの緊急移動はありません。最小MP経路上の全Zombieを轢過でき、損傷は敵ATK×残攻撃回数です。対象Gasの爆発込みでHPが0以下になる場合は進入前に停止します。別のGasの連鎖爆発は進入判定に含まず、車両と搭乗者を失う可能性があります。轢過は自分の弾薬・攻撃回数を消費せず、熟練度の撃破数に加算されません。移動中の通常迎撃は受けません。',
    transport: '歩兵1部隊を輸送できます。搭乗は歩兵の行動だけを消費し、同じターンには下車できません。下車した歩兵はそのターンに自主移動・攻撃・鎮圧できませんが、残りの攻撃回数で反撃・迎撃できます。搭乗人口の維持費は継続します。車両の燃料が0のときだけ、搭乗歩兵から上限100まで救援給油します。搭乗後の追加給油や下車時の返還はありません。',
    production: '陸軍基地だけで人口4・食料80・民需品50・軍需品170・燃料150を一括支払い、1ターンでRecruitを生産します。初期軍需120・燃料100。予約を含み全ゲームで1台まで、破壊後も枠は戻りません。死亡は車両4人と搭乗歩兵を一度だけ計上し、空車はSoldier Zombie、搭乗中は歩兵側だけが既存の種類へ再活性化します。',
    public: '未所有施設の感染人数は不明（非公開）です。既知の0人と区別してください。封じ込めは感染の除去ではありません。鎮圧は残攻撃回数・軍需品・生存に依存します。操作要約は予測と実績を分け、移動の合法性と実際の到達を別々に示します。',
    compatibility: 'v1.7.0以前のセーブ・Session・Checkpoint・公開Replayはv1.7.1では読み込めません。元データを保持し、新しいゲームを開始してください。',
  },
  en: {
    ifv: 'The IFV is a ground unit: HP200, ATK16 (Regular/Veteran20), range/vision5, MP10 and noise10. It has 3 attack charges, or 4 as Veteran. Firing and automatic suppression each require 20 military goods. Suppression power is ATK and civilian damage is ceil(ATK×0.5). It can capture, recover checkpoints and contain infection.',
    movement: 'Movement pays terrain MP and 10 fuel per entered hex. Remaining fuel1–9 permits one final hex before stopping at0; there is no zero-fuel emergency move. The minimum-MP route may overrun any Zombie. Damage is enemy ATK×remaining charges. If impact plus the target Gas explosion would leave HP0 or less, stop before entry. Other Gas chain explosions are excluded from that gate and may kill vehicle and cargo. Overruns consume no own ammunition or attack charges and earn no proficiency kills. Ordinary movement interception does not stop the IFV.',
    transport: 'Carry one infantry unit. Boarding consumes only infantry actions; disembark on a later turn. Disembarked infantry cannot voluntarily move, attack or suppress that turn, but remaining charges permit counterattacks and interception. Cargo upkeep continues. Only a carrier at fuel0 receives rescue fuel from boarding infantry, up to100. No later cargo transfer or disembarkation refund.',
    production: 'Army Base only: pay population4, food80, civilian goods50, military goods170 and fuel150 atomically for one-turn Recruit production. It starts with military goods120 and fuel100. The lifetime limit is one including reservations, with no restored slot after destruction. Death counts the four crew and cargo once. An empty IFV reanimates as a Soldier Zombie; with cargo, only the infantry lineage reanimates.',
    public: 'Unowned facility infection counts are unknown, distinct from a known zero. Containment does not mean infection clearance. Suppression depends on remaining charges, ammunition and survival. Action summaries distinguish predictions from results, and legal movement from actual arrival.',
    compatibility: 'Saves, Sessions, Checkpoints and public Replays from v1.7.0 or earlier cannot be loaded in v1.7.1. Keep the original data and start a new game.',
  },
} as const;
