// 倒库（倒垛，压货翻移）落点推荐与整批倒垛规划。
// 物理约束：天车只能吊「座位列顶空」的捆——圆滚堆叠的钢材若只抽目标捆正上方一列，
// 同层旁捆会失去侧向支撑塌陷滚压过来。因此倒垛 = 把目标捆上方所有更高层的捆整层
// 整层地、自最高层向低层逐吊移走（pressersOf，每吊被倒捆列顶必空）；目标捆同层的
// 旁捆不承压、不挡吊，不动；倒货捆数 = 上方各层捆数总和。
//
// 落点四级优先级：本库位同规格垛 > 本库位空垛 > 同跨同规格垛 > 同跨空垛；
// 同级内按剩余容量降序取最大者；并优先「本天车半区内」落点——防止出现横跨双车
// 停靠位的超宽倒垛吊（两台天车都不可服务，会卡死装车）。
// 容量递增模拟 occupied：规划整批倒垛时把已选落点容量即时扣减，同一批倒垛捆尽量
// 集中码入同一目标垛，避免倒一次垛撒一层。
//
// 排除规则：不压回源垛（目标捆还在其中）；不压入有待扫码落料的垛（防扫码错位）；
// 被他任务锁定的库位不参与（源库位自身不受此限）；剩余容量 ≤ 0 出局。
import { stackCap, bundlePressed, pressersOf } from './geometry.js';

/**
 * 单个被倒捆（按其自身规格）选落点。
 * occupied: Map —— 'slotId:stackIdx' -> 本批已模拟码入捆数（容量递增模拟）；
 * sameHalf(slot) —— 落点是否与源库位同处一台天车可达半区；
 * spanOfSlot / lockedOf —— 跨与锁定判定（天车限本跨；本库位内倒垛不受跨内锁定限制）。
 * 返回 { slot, stackIdx }；无落点返回 null。
 */
export function pickRestackDest({
  slots, srcSlot, srcStackIdx, spec, geo, rules, specNameOf = k => k.spec,
  spanOfSlot, occupied = new Map(), sameHalf = () => true, lockedOf = s => s.state === 'locked',
}) {
  const cap = stackCap(spec, geo, rules);
  const remain = (s, i) => {   // 剩余容量：本批已模拟码入优先，否则 已码捆 + 组车预占
    const k = s.stacks[i];
    return cap - (occupied.get(s.id + ':' + i) ?? (k.count + (k.reserved || 0)));
  };
  const span = spanOfSlot(srcSlot);
  const L1 = [], L2 = [], L3 = [], L4 = [];   // 本位同规格 / 本位空垛 / 同跨同规格 / 同跨空垛
  for (const s of slots) {
    const sameSlot = s === srcSlot;
    if (!sameSlot && (lockedOf(s) || spanOfSlot(s) !== span)) continue;   // 天车限本跨；跳过被他任务锁定的库位
    s.stacks.forEach((k, i) => {
      if (sameSlot && i === srcStackIdx) return;              // 不得压回源垛（目标捆还在其中）
      if (k.pending > 0) return;                              // 不压入有待扫码落料的垛（避免扫码错位）
      const rm = remain(s, i);
      if (rm <= 0) return;
      const ks = specNameOf(k);
      if (k.count > 0 && ks === spec) (sameSlot ? L1 : L3).push([s, i, rm]);
      else if (k.count === 0) (sameSlot ? L2 : L4).push([s, i, rm]);
    });
  }
  for (const list of [L1, L2, L3, L4]) {
    if (!list.length) continue;
    list.sort((a, b) => b[2] - a[2]);       // 同级内剩余容量降序（稳定排序：同容量保持扫描序）
    // 同跨远端落点防超宽倒垛吊：优先本天车半区内落点
    const near = list.filter(([s]) => sameHalf(s));
    const from = near.length ? near : list;
    return { slot: from[0][0], stackIdx: from[0][1] };
  }
  return null;
}

/**
 * 出库前排产整批倒垛：目标捆未被压返回 []（直取，常态路径）；被压则返回逐吊搬移数组
 * [{ bundle, destSlot, destStackIdx }]（自最高层向低层逐吊，排在装车吊之前执行）；
 * 任一被倒捆无处可放返回 null——整体倒垛方案不成立（严禁降级吊装：越层吊被压捆
 * 必致账物错位；调用方应令任务进入等待态周期重试，或超时换捆重配）。
 * bundleSpecName(bundle) 给出被倒捆的规格名（倒货捆规格与目标捆一致——同垛单规格）。
 */
export function planRestackMoves({
  slots, slot, stackIdx, bundleId, geo, rules,
  specNameOf = k => k.spec, bundleSpecName, spanOfSlot, sameHalf, lockedOf,
}) {
  const k = slot.stacks[stackIdx];
  if (!k || k.bundles.length <= 1) return [];                 // 垛内仅一捆，直接吊取
  let tIdx = k.bundles.findIndex(b => b.id === bundleId);     // 目标捆 = 任务下发时指定捆
  if (tIdx < 0) tIdx = k.bundles.length - 1;                  // 兜底按最后落料捆
  const spec = specNameOf(k);
  if (!bundlePressed(k.bundles, spec, tIdx, geo, rules)) return [];   // 没被压，一捆都不用倒
  const buried = pressersOf(k.bundles, spec, tIdx, geo, rules).map(j => k.bundles[j]);   // 上方整层压货自最高层逐吊
  const simCap = new Map(), moves = [];
  for (const b of buried) {
    const d = pickRestackDest({
      slots, srcSlot: slot, srcStackIdx: stackIdx, spec: bundleSpecName(b),
      geo, rules, specNameOf, spanOfSlot, occupied: simCap, sameHalf, lockedOf,
    });
    if (!d) return null;                                      // 有一捆无处可放 -> 整体倒垛方案不成立
    const key = d.slot.id + ':' + d.stackIdx;
    simCap.set(key, (simCap.get(key) ?? d.slot.stacks[d.stackIdx].count) + 1);
    moves.push({ bundle: b, destSlot: d.slot, destStackIdx: d.stackIdx });
  }
  return moves;
}
