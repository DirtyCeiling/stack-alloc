// 出库（订单配捆 / 捆级选捆）推荐：在全库（监测范围内）该规格的在库捆中选目标捆。
// 候选门槛（必须全部满足）：
//   捆已扫码入账（待扫码落料不可出库）；捆不在换捆冷却期（eligible 由调用方判定）；
//   所在垛无待扫码落料（垛级门槛）；所在库位未被任务锁定、在监测范围内、规格匹配。
// 两种策略（调度参数 fifoPick，实时切换）：
//   随机选捆（fifoPick=true，默认）：全库合格候选捆中均匀随机点名——点到未被压捆直接吊走，
//     点到被压捆先倒上方整层压货再装车（模拟「先进先出的真实代价」：倒库率成为可仿真成本）；
//   垛顶直取（fifoPick=false）：每垛取最高层未被压捆（层同取最新落料），跨垛取入账最早者；
//     全垛都被压时兜底取垛内最早入账捆——常态恒免倒垛（理想化对照组）。
// 半区聚簇（一车一天车的可达性约束）：订单首捆点名后，后续配捆只在同一台天车可达半区
// （zone）内点，使车次吊点连同停靠通道不横跨东西两侧；半区无候选时放宽回全范围。
import { bundlePressed, effSeat } from './geometry.js';

/**
 * 垛内选目标捆。
 * 随机模式：垛内合格候选捆均匀随机（被压即倒上方整层压货）；
 * 垛顶直取：最高层未被压捆（层同取最新落料），全垛被压兜底最早入账捆。
 */
export function stackOutBundle({
  stack, geo, rules, specNameOf = k => k.spec,
  fifoPick = true, eligible = () => true, rand = Math.random,
}) {
  if (fifoPick) {
    const pool = stack.bundles.filter(eligible);
    return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
  }
  const spec = specNameOf(stack);
  let topNew = null, topL = -1, fallback = null;
  stack.bundles.forEach((b, i) => {
    if (b.pending) return;
    if (!fallback || b.inTime < fallback.inTime) fallback = b;
    if (bundlePressed(stack.bundles, spec, i, geo, rules)) return;
    const L = effSeat(stack.bundles, spec, i, geo, rules).layer;
    if (L > topL || (L === topL && topNew && b.inTime > topNew.inTime)) { topNew = b; topL = L; }   // 最高层，层同取最新落料
  });
  return topNew || fallback;
}

/**
 * 订单配捆：全库（调用方给定候选库位集）该规格已扫码捆中按策略选目标捆。
 * 返回 { slot, stackIdx, bundle }；无可用捆返回 null。
 *
 * lockedOf(slot)      库位锁定判定（默认 state === 'locked'）
 * inScope(slot)       监测范围判定（调用方按 scope.js 预置；默认全库）
 * spanOfSlot/spanHint 跨钉住（默认不做——订单配捆不做跨钉住，避免需求锁死在库存不足的跨上）
 * zone/zoneOk         半区聚簇：zone = 锁定的天车半区（'W'/'E'/null），zoneOk(slot) 判定可达性；
 *                     半区候选优先，半区枯竭回退全域。
 */
export function pickOutBundle({
  slots, spec = null, geo, rules, specNameOf = k => k.spec,
  fifoPick = true, eligible = () => true, rand = Math.random,
  lockedOf = s => s.state === 'locked', inScope = () => true,
  spanOfSlot = null, spanHint = null,
  zone = null, zoneOk = () => true,
}) {
  const cand = [], candZone = [];                   // 随机模式候选池：全域 / 聚簇半区（均匀随机，不偏向未被压捆）
  let topPick = null, topZone = null;               // 垛顶直取模式：各垛最高层未被压捆中挑入账最早者（全域 / 半区）
  for (const s of slots) {
    if (lockedOf(s)) continue;                      // 一吊锁一库位：被锁库位不参与选捆
    if (!inScope(s)) continue;                      // 未监测跨库存不参与出库
    if (spanHint != null && spanOfSlot && spanOfSlot(s) !== spanHint) continue;
    const z = zoneOk(s);
    s.stacks.forEach((k, i) => {
      if (k.count <= 0 || k.pending > 0) return;    // 垛级门槛：有待扫码落料的垛不出库
      const ks = specNameOf(k);
      if (spec && ks !== spec) return;
      if (fifoPick) {
        for (const b of k.bundles) if (eligible(b)) {
          const c = { slot: s, stackIdx: i, bundle: b };
          cand.push(c);
          if (z) candZone.push(c);
        }
      } else {
        const b = stackOutBundle({ stack: k, geo, rules, specNameOf, fifoPick, eligible, rand });
        if (b) {
          if (!topPick || b.inTime < topPick.bundle.inTime) topPick = { slot: s, stackIdx: i, bundle: b };
          if (z && (!topZone || b.inTime < topZone.bundle.inTime)) topZone = { slot: s, stackIdx: i, bundle: b };
        }
      }
    });
  }
  if (!fifoPick) return topZone || topPick;
  const pool = candZone.length ? candZone : cand;   // 半区优先，半区枯竭回退全域
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}
