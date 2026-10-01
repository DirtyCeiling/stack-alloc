// 入库（卸货落位 / 垛位分配）推荐：六维加权评分选最优垛。
// 核心原则：相同/相似货物归堆放一起，不随机荐垛。
//   ① 同规格归堆 sameSpecBase 起步，按垛内填充率加励（sameSpecFill）：优先码入
//      已有同规格垛，先填满旧垛、把空垛留给新规格；
//   ② 空垛兜底 emptyBase 起步：无同规格垛才用空垛；本库位空垛越多扣分越多（emptyPenalty/垛）；
//   ③ 库位同质性：库位内同族（同形状）垛 +famBonus/垛，异族垛 -mixPenalty/垛；
//   ④ 邻位聚簇：同号区相邻库位（area±1）内同规格垛 +nearBonus/垛（上限 nearCap）；
//   ⑤ 扫码干扰：库位内待扫码垛 -pendPenalty/垛（不打扰机器狗核验队列）；待扫码垛本身不作落点；
//   ⑥ 跨匹配 +spanBonus：仅组车场景由调用方传入（进厂确认页荐垛时不启用，传 0）。
// 硬规则：同垛不混异规格；满垛（含组车预占）/待扫码垛不作落点。
//   （库位锁定 / 监测范围 / 跨过滤由调用方在候选集上先行过滤——三者与具体场景相关：
//     服务端按库位 state、沙盘按任务锁；scope.js 提供监测范围判定。）
//
// 数据约定（调用方把自有库存结构适配成如下视图）：
//   库位 slot：{ id, code, area, state, merged?, stacks: [stackView, ...] }
//   垛 stack：{ count 已码捆数, pending 待扫码捆数, reserved 组车预占捆数, ... }
//   垛规格名由 specNameOf(stack) 取出（默认 k => k.spec；沙盘侧 spec 为对象，传 k => k.spec?.name）。
// 填充数 fill = count + reserved（includeReserved=true 时；进厂确认页口径不含预占，传 false）。
import { SPEC_FAMILY } from './specs.js';
import { stackCap } from './geometry.js';

/** 库位级统计：空垛/同族/异族/待扫码垛数（供评分②③⑤） */
export function slotStackStats(slot, spec, specNameOf) {
  const fam = SPEC_FAMILY[spec];
  let emptyN = 0, famN = 0, mixN = 0, pendN = 0;
  for (const k of slot.stacks) {
    if (k.pending > 0) pendN++;
    if (k.count === 0 && k.pending === 0) { emptyN++; continue; }
    const ks = specNameOf(k);
    if (ks === spec || (ks && SPEC_FAMILY[ks] === fam)) famN++;
    else if (ks) mixN++;
  }
  return { emptyN, famN, mixN, pendN };
}

/** 邻位聚簇数：同号区相邻库位（area±1）内同规格在库垛数（供评分④） */
export function nearCount(slot, nearSlots, spec, specNameOf) {
  let nearN = 0;
  for (const o of nearSlots) {
    if (o === slot || Math.abs(o.area - slot.area) > 1) continue;
    for (const k of o.stacks) if (specNameOf(k) === spec && k.count > 0) nearN++;
  }
  return nearN;
}

/**
 * 单个候选（库位,垛）的评分与分维得分；不合法落点返回 null。
 * comps 各维度独立记录，供人工调整后的权重学习对比。
 * stats/nearN 可由调用方预算（批量评分时避免重复统计）；缺省现算。
 */
export function scoreStack({
  slot, stack, spec, W, geo, rules,
  includeReserved = false, spanBonus = 0,
  specNameOf = k => k.spec, stats = null, nearN = null, nearSlots = null,
}) {
  const cap = stackCap(spec, geo, rules);                    // 物理垛容
  const fill = stack.count + (includeReserved ? (stack.reserved || 0) : 0);
  if (fill >= cap || stack.pending > 0) return null;         // 满垛/待扫码垛不作落点
  const ks = specNameOf(stack);
  if (fill > 0 && ks !== spec) return null;                  // 硬规则：同垛不混异规格（含他车预占垛）
  const agg = stats || slotStackStats(slot, spec, specNameOf);
  const nn = nearN != null ? nearN : nearCount(slot, nearSlots || [slot], spec, specNameOf);
  const comps = { sameSpec: 0, empty: 0, family: 0, near: 0, pend: 0 };
  const parts = [];
  if (ks === spec && fill > 0) {                             // ① 同规格归堆（按填充率加励）
    comps.sameSpec = W.sameSpecBase + Math.round(W.sameSpecFill * fill / cap);
    parts.push(`同规格归堆 ${comps.sameSpec}（${fill}/${cap}）`);
  } else {                                                   // ② 空垛兜底（空垛多则惜用）
    comps.empty = Math.max(0, W.emptyBase - agg.emptyN * W.emptyPenalty);
    parts.push(`空垛兜底 ${comps.empty}`);
  }
  comps.family = agg.famN * W.famBonus - agg.mixN * W.mixPenalty;   // ③ 库位同质性
  if (agg.famN) parts.push(`库位同族 ${agg.famN * W.famBonus}`);
  if (agg.mixN) parts.push(`库位异族 -${agg.mixN * W.mixPenalty}`);
  comps.near = Math.min(nn * W.nearBonus, W.nearCap);               // ④ 邻位聚簇
  if (comps.near) parts.push(`邻位聚簇 ${comps.near}`);
  comps.pend = -agg.pendN * W.pendPenalty;                          // ⑤ 扫码干扰
  if (agg.pendN) parts.push(`扫码干扰 -${agg.pendN * W.pendPenalty}`);
  if (spanBonus) parts.push(`跨匹配 ${spanBonus}`);                 // ⑥ 跨匹配（组车场景）
  const score = comps.sameSpec + comps.empty + comps.family + comps.near + comps.pend + spanBonus;
  return { score, parts, comps };
}

/**
 * 全库候选（库位,垛）评分。
 * slots = 候选库位（调用方已按 锁定/监测范围/跨 过滤）；nearSlots = 邻位聚簇统计用全量库位
 * （默认 = slots——注意：若要与非候选库位形成连片聚簇口径一致，应传全库）。
 * 返回 [{ slot, stack, stackIdx, score, parts, comps, free }]（未排序）。
 */
export function scoreInCandidates({
  slots, nearSlots = null, spec, W, geo, rules,
  includeReserved = false, spanBonus = 0, specNameOf = k => k.spec,
}) {
  const near = nearSlots || slots;
  const cands = [];
  for (const slot of slots) {
    const stats = slotStackStats(slot, spec, specNameOf);
    const nn = nearCount(slot, near, spec, specNameOf);
    slot.stacks.forEach((k, stackIdx) => {
      const r = scoreStack({ slot, stack: k, spec, W, geo, rules, includeReserved, spanBonus, specNameOf, stats, nearN: nn });
      if (!r) return;
      const free = stackCap(spec, geo, rules) - k.count - (includeReserved ? (k.reserved || 0) : 0);
      if (free <= 0) return;
      cands.push({ slot, stack: k, stackIdx, score: r.score, parts: r.parts, comps: r.comps, free });
    });
  }
  return cands;
}

/**
 * 整组贪心装垛（进厂车一组配载 spec × bundles 捆的垛位分配）：
 * 评分排序取最优垛装入 min(剩余捆数, 该垛剩余容量)，剩余再装次优垛
 * （同车同规格集中码放、垛满自动拆多组）；全库无合法落点返回缺口 shortfall（库满）。
 * 返回 { allocations: [{ slot, stack, stackIdx, bundles, score, parts }], shortfall }。
 */
export function recommendAllocation({
  slots, nearSlots = null, spec, bundles, W, geo, rules,
  includeReserved = false, specNameOf = k => k.spec,
}) {
  const out = [];
  const claimed = new Map();   // 本轮已占用量 slotId:stackIdx -> 捆数
  let left = bundles;
  while (left > 0) {
    const cands = [];
    for (const c of scoreInCandidates({ slots, nearSlots, spec, W, geo, rules, includeReserved, specNameOf })) {
      const free = c.free - (claimed.get(c.slot.id + ':' + c.stackIdx) || 0);
      if (free > 0) cands.push({ ...c, free });
    }
    if (!cands.length) break;                       // 全库无合法落点（库满）
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];
    const take = Math.min(left, best.free);
    const key = best.slot.id + ':' + best.stackIdx;
    claimed.set(key, (claimed.get(key) || 0) + take);
    out.push({ slot: best.slot, stack: best.stack, stackIdx: best.stackIdx, bundles: take, score: best.score, parts: best.parts });
    left -= take;
  }
  return { allocations: out, shortfall: left };
}

/** 候选落点列表（人工调整下拉框用）：先「容量够整组」后「综合分」降序，含评分分解 */
export function listCandidates({
  slots, nearSlots = null, spec, bundles, W, geo, rules,
  includeReserved = false, specNameOf = k => k.spec, limit = 20,
}) {
  const cands = scoreInCandidates({ slots, nearSlots, spec, W, geo, rules, includeReserved, specNameOf })
    .map(c => ({ ...c, enough: c.free >= bundles }));
  cands.sort((a, b) => (b.enough - a.enough) || (b.score - a.score));
  return cands.slice(0, limit);
}

/** 在指定落点上复算评分（学习对比用）；库位锁定或落点已不合法返回 null */
export function scoreAt({
  slots, nearSlots = null, spec, slotId, stackIdx, W, geo, rules,
  includeReserved = false, specNameOf = k => k.spec,
}) {
  const slot = slots.find(s => s.id === slotId);
  const stack = slot && slot.stacks[stackIdx];
  if (!slot || !stack || slot.state === 'locked') return null;
  return scoreStack({ slot, stack, spec, W, geo, rules, includeReserved, specNameOf, nearSlots: nearSlots || slots });
}

/* 学习维度 -> 对应权重 key：人工选择在该维度更优 => 权重向该方向微调 */
export const LEARN_DIMS = [
  ['sameSpec', 'sameSpecBase'],   // 同规格归堆 vs 空垛兜底的取向
  ['empty',    'emptyBase'],
  ['family',   'famBonus'],       // 库位同质/异族
  ['near',     'nearBonus'],      // 邻位聚簇
  ['pend',     'pendPenalty'],    // 扫码干扰规避
];

/**
 * 权重自学习（感知机式微调的方向投票）：在当前权重下对比推荐落点与人工落点的
 * 分维差异，人工选择在某维度更优 => 该维度方向 +1，更劣 => -1（多组投票取净方向）。
 * adjusted: [{ spec, rec: { slotId, stackIdx }, fin: { slotId, stackIdx } }]
 * 返回 [{ key, dir }]；步长与上下限夹取由调用方按参数 schema 执行。
 */
export function learnDeltas({
  slots, nearSlots = null, adjusted, W, geo, rules,
  includeReserved = false, specNameOf = k => k.spec,
}) {
  if (!adjusted || !adjusted.length) return [];
  const acc = {};                                    // key -> 方向票数
  for (const l of adjusted) {
    const rec = scoreAt({ slots, nearSlots, spec: l.spec, slotId: l.rec.slotId, stackIdx: l.rec.stackIdx, W, geo, rules, includeReserved, specNameOf });
    const fin = scoreAt({ slots, nearSlots, spec: l.spec, slotId: l.fin.slotId, stackIdx: l.fin.stackIdx, W, geo, rules, includeReserved, specNameOf });
    if (!rec || !fin) continue;                      // 推荐落点已被占用等场景：跳过本次学习
    for (const [dim, key] of LEARN_DIMS) {
      const d = fin.comps[dim] - rec.comps[dim];
      if (d !== 0) acc[key] = (acc[key] || 0) + Math.sign(d);
    }
  }
  return Object.entries(acc)
    .filter(([, dir]) => dir !== 0)
    .map(([key, dir]) => ({ key, dir }));
}

/** 库位内指定规格的入库目标垛：优先同规格有空位垛，否则空垛（-1 = 已满；手动指定库位场景） */
export function pickInStack(slot, spec, geo, rules, { specNameOf = k => k.spec } = {}) {
  let same = -1, empty = -1;
  const cap = stackCap(spec, geo, rules);
  slot.stacks.forEach((k, i) => {
    if (same < 0 && specNameOf(k) === spec && k.count < cap) same = i;
    if (empty < 0 && k.count === 0) empty = i;
  });
  return same >= 0 ? same : empty;
}
