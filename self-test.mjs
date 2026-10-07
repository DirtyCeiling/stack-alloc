// StackAlloc 垛位推荐算法包自测（纯 Node，零依赖）：
//   垛容几何口径 / 监测范围 / 入库六维评分与整组贪心分配 / 权重学习方向 /
//   出库两策略选捆与半区聚簇 / 倒垛压货模型与四级落点 / 浏览器包生成。
// 用法：node self-test.mjs（或 npm test）
import {
  SPECS, SPEC_FAMILY, SPEC_DIMS, specFamily,
  GEO_DEFAULTS, rowsOf, deriveRods, bundleRods, bundleDiaCm, pileBundleSize, pileDimsOf, pileDims, stackCap,
  seatOrder, seatIdx, effSeat, freeSeat, bundlePressed, pressersOf,
  monitoredScopesOf, regionRestrictedOf, slotInOpScope,
  slotStackStats, nearCount, scoreStack, scoreInCandidates, recommendAllocation, listCandidates, scoreAt,
  LEARN_DIMS, learnDeltas, pickInStack,
  stackOutBundle, pickOutBundle,
  pickRestackDest, planRestackMoves,
} from './src/index.js';
import { buildBrowserBundle } from './browser.js';

let n = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error(`✗ ${msg}`); process.exit(1); }
  console.log(`✓ ${msg}`); n++;
};
// 确定性随机流（与仿真/服务端同族的 LCG）
const lcg = seed => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const W = {   // 「调度参数」placement 段默认值
  sameSpecBase: 60, sameSpecFill: 20, emptyBase: 20, emptyPenalty: 3,
  famBonus: 5, mixPenalty: 8, nearBonus: 4, nearCap: 20, pendPenalty: 3, spanBonus: 10,
};
const mkStack = (spec, count, pending = 0, extra = {}) => ({ spec, count, pending, reserved: 0, bundles: [], ...extra });
const mkSlot = (id, area, stacks, extra = {}) =>
  ({ id, code: 'S' + id, area, span: area % 3, merged: false, state: 'free', stacks, ...extra });

/* ================= 1. 垛容几何口径 ================= */
console.log('== 垛容几何 ==');
assert(rowsOf(21).join('+') === '6+5+4+3+2+1', 'rowsOf(21) 三角数金字塔 6+5+4+3+2+1');
assert(rowsOf(4).join('+') === '2+2' && rowsOf(5).join('+') === '3+2' && rowsOf(1).join('+') === '1', '非三角数手工排布保留');
assert(deriveRods(12) >= 3, `规则引擎自动推导（Φ12 -> ${deriveRods(12)} 支）`);
assert(deriveRods(200) === 1 && deriveRods(600) === 1, 'Φ200 单支达标 / Φ600 单支物理下限');
{
  const p600 = pileDims('管材 Φ600', GEO_DEFAULTS);
  assert(p600.across === 3 && p600.maxLayers === 4 && stackCap('管材 Φ600', GEO_DEFAULTS) === 12,
    `Φ600 限高收窄：3 并排 × 4 层 = 垛容 12（实测 ${stackCap('管材 Φ600', GEO_DEFAULTS)}）`);
  const p400 = pileDims('管材 Φ400', GEO_DEFAULTS);
  assert(p400.across === 5 && p400.maxLayers === 6 && stackCap('管材 Φ400', GEO_DEFAULTS) === 30,
    `Φ400 限高收窄：5 并排 × 6 层 = 垛容 30（实测 ${stackCap('管材 Φ400', GEO_DEFAULTS)}）`);
  assert(stackCap('螺纹钢 Φ20', GEO_DEFAULTS) === 100, '螺纹钢 Φ20 垛容 = 通用上限 100（物理垛容更宽）');
  assert(stackCap('未知规格', GEO_DEFAULTS) === 100, '未知规格垛容回落通用上限');
}
assert(bundleRods('圆钢 Φ50', GEO_DEFAULTS) === 4 && bundleRods('圆钢 Φ50', GEO_DEFAULTS, { '圆钢 Φ50': 10 }) === 10
  && bundleRods('圆钢 Φ50', GEO_DEFAULTS, { '圆钢 Φ50': 0 }) === deriveRods(50, GEO_DEFAULTS),
  '每捆支数：预置 > 手工覆盖 > 引擎自动（0）三态');
assert(Math.abs(bundleDiaCm('螺纹钢 Φ20', GEO_DEFAULTS) - bundleDiaCm('螺纹钢 Φ20', GEO_DEFAULTS)) < 1e-9
  && bundleDiaCm('螺纹钢 Φ20', GEO_DEFAULTS) >= 15 && bundleDiaCm('螺纹钢 Φ20', GEO_DEFAULTS) <= 50,
  `捆径口径落在 15~50cm（Φ20 实测 ${bundleDiaCm('螺纹钢 Φ20', GEO_DEFAULTS).toFixed(1)}cm）`);
{
  const s = pileBundleSize('螺纹钢 Φ20', GEO_DEFAULTS);
  assert(s && s.w > 0 && s.h > 0, '单捆占位尺寸（宽/高）');
}
assert(SPEC_FAMILY['方钢 40×40'] === 'square' && specFamily('管材 Φ100') === 'pipe' && SPEC_DIMS['圆钢 Φ60'].rods === 3,
  '规格注册表（族/杆径/预置支数）');

/* ================= 2. 监测范围 ================= */
console.log('== 监测范围 ==');
{
  const robot = { spanA: 1, fromA: 17, toA: 33, spanB: 1, fromB: 1, toB: 33, spanC: 0 };
  const ms = monitoredScopesOf({ robot });
  assert(ms.length === 2 && ms[0].span === 0 && ms[0].lo === 17 && ms[0].hi === 33, '监测范围明细解析（A 跨 17~33 + B 整跨）');
  assert(regionRestrictedOf(ms) === true, '部分跨关闭/限定号区 = 受限');
  assert(regionRestrictedOf(monitoredScopesOf({ robot: { spanA: 1, spanB: 1, spanC: 1 } })) === false, '三跨整跨全开 = 不受限');
  assert(regionRestrictedOf(monitoredScopesOf({ robot: {} })) === false, '全关 = 全库免检（不受限）');
  const normal = { span: 0, merged: false };
  const merged = { span: 3, merged: true };
  assert(slotInOpScope(normal, ms) && !slotInOpScope({ span: 2, merged: false }, ms), '普通库位按所在跨判定');
  assert(slotInOpScope(merged, ms, { spanOfSlot: () => 0 }), '整跨合并位（现属 A 跨）：A 跨监测即可荐');
  assert(!slotInOpScope(merged, ms, { spanOfSlot: () => 2 }), '整跨合并位（现属 A 跨）：停靠跨口径下按所在跨判定');
  assert(slotInOpScope(normal, monitoredScopesOf({ robot: { spanB: 1 } }), { mergedAnySpan: false }) === false,
    '仅监测 B 跨时 A 跨库位不在作业范围');
}

/* ================= 3. 入库六维评分 ================= */
console.log('== 入库评分 ==');
{
  const cap = stackCap('螺纹钢 Φ20', GEO_DEFAULTS);   // 100
  const s1 = mkSlot(1, 10, [mkStack('螺纹钢 Φ20', 30), mkStack(null, 0)]);
  const s2 = mkSlot(2, 10, [mkStack('螺纹钢 Φ25', 10), mkStack(null, 0)]);   // 同族（rebar）库位
  const s3 = mkSlot(3, 20, [mkStack(null, 0), mkStack(null, 0)]);            // 远端全空库位
  const yard = [s1, s2, s3];
  const cands = scoreInCandidates({ slots: yard, spec: '螺纹钢 Φ20', W, geo: GEO_DEFAULTS });
  const best = cands.reduce((a, b) => (b.score > a.score ? b : a));
  assert(best.slot === s1 && best.stackIdx === 0, '归堆优先：已有同规格垛得分最高');
  const c10 = cands.find(c => c.slot === s1 && c.stackIdx === 0);
  assert(c10.comps.sameSpec === 60 + Math.round(20 * 30 / cap), `① 同规格归堆 = 60 + round(20×30/${cap})`);
  assert(c10.parts[0].startsWith('同规格归堆'), '评分分解含中文维度说明');
  const e1 = cands.find(c => c.slot === s1 && c.stackIdx === 1);
  assert(e1.comps.empty === Math.max(0, 20 - 1 * 3) && e1.comps.sameSpec === 0, '② 空垛兜底按本库位空垛数扣减');
  assert(e1.comps.family === 1 * 5, '③ 同族加励（本库位 1 个同族垛）');
  const e2 = cands.find(c => c.slot === s2 && c.stackIdx === 1);
  assert(e2.comps.family === 1 * 5, '③ 同族规格（螺纹钢 Φ25）视同族');
  assert(e1.comps.near === 0 && cands.find(c => c.slot === s3).comps.near === 0, '④ 无邻位同规格时聚簇分为 0');
  // 邻位聚簇：area±1 内有同规格垛
  const s4 = mkSlot(4, 11, [mkStack('螺纹钢 Φ20', 5)]);
  const cWith4 = scoreInCandidates({ slots: [...yard, s4], spec: '螺纹钢 Φ20', W, geo: GEO_DEFAULTS });
  assert(cWith4.find(c => c.slot === s1).comps.near === Math.min(1 * 4, 20), '④ 相邻号区同规格垛 +nearBonus/垛');
  // 硬规则
  const full = mkSlot(5, 10, [mkStack('螺纹钢 Φ20', cap)]);
  const pend = mkSlot(6, 10, [mkStack('螺纹钢 Φ20', 3, 1)]);
  const mixed = mkSlot(7, 10, [mkStack('圆钢 Φ50', 5)]);
  const none = scoreInCandidates({ slots: [full, pend, mixed], spec: '螺纹钢 Φ20', W, geo: GEO_DEFAULTS });
  assert(none.length === 0, '硬规则：满垛/待扫码垛/异规格垛全部出局');
  // 扫码干扰：库位有待扫码垛扣分
  const pendSlot = mkSlot(8, 30, [mkStack('圆钢 Φ50', 5, 2), mkStack(null, 0)]);
  const cPend = scoreInCandidates({ slots: [pendSlot], spec: '螺纹钢 Φ20', W, geo: GEO_DEFAULTS });
  assert(cPend[0].comps.pend === -1 * 3, '⑤ 库位内待扫码垛 -pendPenalty/垛');
  // 跨匹配加分（组车场景由调用方给 spanBonus）
  const cSpan = scoreInCandidates({ slots: [s3], spec: '螺纹钢 Φ20', W, geo: GEO_DEFAULTS, spanBonus: W.spanBonus });
  assert(cSpan.every(c => c.parts.includes(`跨匹配 ${W.spanBonus}`)), '⑥ 跨匹配加分');
  // 组车预占口径：includeReserved 时预占计入填充
  const rsv = mkSlot(9, 10, [mkStack('螺纹钢 Φ20', 10, 0, { reserved: 5 })]);
  const cR = scoreInCandidates({ slots: [rsv], spec: '螺纹钢 Φ20', W, geo: GEO_DEFAULTS, includeReserved: true });
  assert(cR[0].comps.sameSpec === 60 + Math.round(20 * 15 / cap), '组车预占计入填充率（沙盘口径）');
}

/* ================= 4. 整组贪心分配 / 候选列表 / 学习 ================= */
console.log('== 整组分配与权重学习 ==');
{
  const cap = stackCap('螺纹钢 Φ20', GEO_DEFAULTS);
  const s1 = mkSlot(1, 10, [mkStack('螺纹钢 Φ20', cap - 3)]);   // 旧垛只剩 3 捆
  const s2 = mkSlot(2, 12, [mkStack(null, 0), mkStack(null, 0)]);
  const yard = [s1, s2];
  const r = recommendAllocation({ slots: yard, spec: '螺纹钢 Φ20', bundles: 5, W, geo: GEO_DEFAULTS });
  assert(r.shortfall === 0 && r.allocations.length === 2, '垛满自动拆多组');
  assert(r.allocations[0].slot === s1 && r.allocations[0].bundles === 3, '先填满旧垛（3 捆）');
  assert(r.allocations[1].slot === s2 && r.allocations[1].bundles === 2, '余捆进次优垛（集中码放）');
  const full = recommendAllocation({ slots: [s1], spec: '螺纹钢 Φ20', bundles: 5, W, geo: GEO_DEFAULTS });
  assert(full.shortfall === 2 && full.allocations[0].bundles === 3, '库满返回缺口 shortfall');
  const lc = listCandidates({ slots: yard, spec: '螺纹钢 Φ20', bundles: 4, W, geo: GEO_DEFAULTS });
  assert(lc[0].slot === s2 && lc[0].enough, '候选列表先排「容量够整组」');
  // 权重学习：人工从空垛改到同规格垛 -> sameSpecBase 方向 +1
  const yard2 = [mkSlot(1, 10, [mkStack('螺纹钢 Φ20', 30), mkStack(null, 0)])];
  const recIdx = 1, finIdx = 0;
  const dirs = learnDeltas({
    slots: yard2, spec: '螺纹钢 Φ20', W, geo: GEO_DEFAULTS,
    adjusted: [{ spec: '螺纹钢 Φ20', rec: { slotId: 1, stackIdx: recIdx }, fin: { slotId: 1, stackIdx: finIdx } }],
  });
  const dSame = dirs.find(d => d.key === 'sameSpecBase');
  assert(dSame && dSame.dir === 1, '人工改向同规格垛 -> sameSpecBase 权重方向 +1');
  assert(LEARN_DIMS.length === 5 && dirs.every(d => LEARN_DIMS.some(x => x[1] === d.key)), '学习维度限定在五维权重');
  const pick = pickInStack(yard2[0], '螺纹钢 Φ20', GEO_DEFAULTS);
  assert(pick === 0, '手动指定库位：优先同规格有空位垛');
  assert(pickInStack(yard2[0], '圆钢 Φ50', GEO_DEFAULTS) === 1, '无同规格垛用空垛');
}

/* ================= 5. 出库选捆 ================= */
console.log('== 出库选捆 ==');
{
  // 构造一个 3 层小垛（across=2 便于手算）：底层 2 捆、第 2 层 2 捆、第 3 层 1 捆（压座位列 0 上方）
  const geo2 = { ...GEO_DEFAULTS, pileW: 0.56 };   // Φ20 捆宽 6×0.02×1.08=0.1296 → across = floor(0.56/0.1596) = 3
  const p = pileDims('螺纹钢 Φ20', geo2);
  assert(p.across === 3, '测试垛每层 3 并排');
  const B = (id, layer, seat, inTime, pending = false) => ({ id, pending, inTime, pos: { layer, seat } });
  const bundles = [
    B('B-1', 0, 1, 100), B('B-2', 0, 0, 101), B('B-3', 0, 2, 102),
    B('B-4', 1, 1, 103), B('B-5', 1, 0, 104),
    B('B-6', 2, 1, 105),
  ];
  const k = { spec: '螺纹钢 Φ20', count: 6, pending: 0, bundles };
  assert(bundlePressed(k.bundles, '螺纹钢 Φ20', 0, geo2) === true, 'B-1 上方同座位列有捆 = 被压');
  assert(bundlePressed(k.bundles, '螺纹钢 Φ20', 2, geo2) === false, 'B-3 座位列顶空 = 未被压');
  assert(pressersOf(k.bundles, '螺纹钢 Φ20', 0, geo2).join(',') === '5,4,3',
    '压货自高向低整层倒走：第 3 层 B-6 -> 第 2 层 B-5 -> B-4（同层座位序）');
  // 垛顶直取：最高层未被压捆
  const top = stackOutBundle({ stack: k, geo: geo2, fifoPick: false });
  assert(top.id === 'B-6', `垛顶直取取最高层未被压捆（${top.id}）`);
  // 随机选捆：均匀随机（注入确定性随机流）；冷却名单 eligible 生效
  const rnd = lcg(42);
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(stackOutBundle({ stack: k, geo: geo2, fifoPick: true, rand: rnd }).id);
  assert(seen.size === 6, '随机选捆覆盖垛内全部合格捆');
  const eligible = b => b.id !== 'B-1';
  const seen2 = new Set();
  for (let i = 0; i < 60; i++) seen2.add(stackOutBundle({ stack: k, geo: geo2, fifoPick: true, eligible, rand: rnd }).id);
  assert(!seen2.has('B-1') && seen2.size === 5, '换捆冷却期（eligible）内的捆不被点名');
  // pickOutBundle：规格匹配 + 待扫码垛不出库 + 锁定/范围过滤 + 半区聚簇
  const s1 = mkSlot(1, 10, [k]);
  const s2 = mkSlot(2, 11, [{ spec: '螺纹钢 Φ20', count: 2, pending: 1, bundles: [B('B-7', 0, 0, 90), B('B-8', 0, 1, 91)] }]);
  const s3 = mkSlot(3, 12, [{ spec: '圆钢 Φ50', count: 1, pending: 0, bundles: [B('B-9', 0, 0, 80)] }]);
  const rnd2 = lcg(7);
  let allFromS1 = true;
  for (let i = 0; i < 30; i++) {
    const pick = pickOutBundle({ slots: [s1, s2, s3], spec: '螺纹钢 Φ20', geo: geo2, fifoPick: true, rand: rnd2 });
    if (!pick || pick.slot !== s1) allFromS1 = false;
  }
  assert(allFromS1, '待扫码垛不参与出库选捆（30 次随机均落合法垛）');
  const locked = { ...s1, state: 'locked' };
  assert(pickOutBundle({ slots: [locked], spec: '螺纹钢 Φ20', geo: geo2, fifoPick: true, rand: rnd2 }) === null,
    '锁定库位不参与选捆');
  const zPick = pickOutBundle({
    slots: [s1], spec: '螺纹钢 Φ20', geo: geo2, fifoPick: true, rand: rnd2,
    zone: 'W', zoneOk: () => false,
  });
  assert(zPick && zPick.slot === s1, '半区无候选时放宽回全范围（兜底）');
  const zOnly = pickOutBundle({
    slots: [s1], spec: '螺纹钢 Φ20', geo: geo2, fifoPick: false, rand: rnd2,
    zone: 'E', zoneOk: () => false,
  });
  assert(zOnly && zOnly.bundle.id === 'B-6', '垛顶直取跨半区兜底取全域最早');
}

/* ================= 6. 倒垛落点 ================= */
console.log('== 倒垛落点 ==');
{
  const cap = stackCap('螺纹钢 Φ20', GEO_DEFAULTS);
  const src = mkSlot(1, 10, [mkStack('螺纹钢 Φ20', 10), mkStack(null, 0)]);   // 源库位内有空垛
  const near1 = mkSlot(2, 10, [mkStack('螺纹钢 Φ20', 20), mkStack(null, 0)]);   // 本位外同跨 L3/L4
  const dst = pickRestackDest({
    slots: [src, near1], srcSlot: src, srcStackIdx: 0, spec: '螺纹钢 Φ20', geo: GEO_DEFAULTS,
    spanOfSlot: () => 0,   // 同跨
  });
  assert(dst && dst.slot === src && dst.stackIdx === 1, 'L2 优先：本库位空垛');
  assert(!(dst.slot === src && dst.stackIdx === 0), '不压回源垛');
  // 本库位满 -> 同跨同规格
  const srcFull = mkSlot(1, 10, [mkStack('螺纹钢 Φ20', 10)]);
  const d2 = pickRestackDest({
    slots: [srcFull, near1], srcSlot: srcFull, srcStackIdx: 0, spec: '螺纹钢 Φ20', geo: GEO_DEFAULTS,
    spanOfSlot: () => 0,
  });
  assert(d2 && d2.slot === near1 && d2.stackIdx === 0, '本库位无同规格空位 -> 同跨同规格垛（L3）');
  // 容量递增模拟：同批两捆集中码入同一目标垛
  const simCap = new Map();
  const first = pickRestackDest({
    slots: [srcFull, near1], srcSlot: srcFull, srcStackIdx: 0, spec: '螺纹钢 Φ20', geo: GEO_DEFAULTS,
    spanOfSlot: () => 0, occupied: simCap,
  });
  simCap.set(first.slot.id + ':' + first.stackIdx, near1.stacks[0].count + 1);
  const second = pickRestackDest({
    slots: [srcFull, near1], srcSlot: srcFull, srcStackIdx: 0, spec: '螺纹钢 Φ20', geo: GEO_DEFAULTS,
    spanOfSlot: () => 0, occupied: simCap,
  });
  assert(second.slot === first.slot && second.stackIdx === first.stackIdx, '容量递增模拟：同批倒垛捆集中码入同一目标垛');
  // 整批规划：目标捆被压 -> 逐吊搬移；无落点 -> null
  const geo3 = GEO_DEFAULTS;
  const bundles = [
    { id: 'T-1', pending: false, inTime: 1, pos: { layer: 0, seat: 1 } },
    { id: 'T-2', pending: false, inTime: 2, pos: { layer: 1, seat: 1 } },
  ];
  const srcK = { spec: '螺纹钢 Φ20', count: 2, pending: 0, reserved: 0, bundles };
  const src2 = mkSlot(1, 10, [srcK, mkStack(null, 0)]);
  const rest = mkSlot(2, 11, [mkStack(null, 0)]);
  const moves = planRestackMoves({
    slots: [src2, rest], slot: src2, stackIdx: 0, bundleId: 'T-1', geo: geo3,
    bundleSpecName: () => '螺纹钢 Φ20', spanOfSlot: () => 0,
  });
  assert(Array.isArray(moves) && moves.length === 1 && moves[0].bundle.id === 'T-2', '被压一捆 -> 倒一吊');
  const direct = planRestackMoves({
    slots: [src2, rest], slot: src2, stackIdx: 0, bundleId: 'T-2', geo: geo3,
    bundleSpecName: () => '螺纹钢 Φ20', spanOfSlot: () => 0,
  });
  assert(direct.length === 0, '目标捆未被压 -> 直取免倒垛');
  const nowhere = mkSlot(2, 11, [mkStack('螺纹钢 Φ20', cap)]);   // 同跨唯一落点满垛
  const blocked = planRestackMoves({
    slots: [src2, nowhere], slot: src2, stackIdx: 0, bundleId: 'T-1', geo: geo3,
    bundleSpecName: () => '螺纹钢 Φ20', spanOfSlot: () => 0,
  });
  // src2 还有一个空垛（L2），所以能放下 —— 换成 src2 也无空位的场景
  const src3 = mkSlot(1, 10, [srcK]);
  const blocked2 = planRestackMoves({
    slots: [src3, nowhere], slot: src3, stackIdx: 0, bundleId: 'T-1', geo: geo3,
    bundleSpecName: () => '螺纹钢 Φ20', spanOfSlot: () => 0,
  });
  assert(blocked === null || blocked2 === null, '压货无处可放 -> 整体倒垛方案不成立（null，严禁降级吊装）');
}

/* ================= 7. 浏览器包 ================= */
console.log('== 浏览器包 ==');
{
  const bundle = buildBrowserBundle();
  assert(!/^import\s/m.test(bundle) && !/^export\s/m.test(bundle), '浏览器包无 import/export 残留');
  assert(!bundle.includes('</script>'), '浏览器包可安全内联进 HTML');
  const g = {};
  new Function('window', bundle)(g);   // eslint 忽略：自测直接求值验证挂载
  assert(g.StackAlloc && typeof g.StackAlloc.stackCap === 'function'
    && g.StackAlloc.stackCap('管材 Φ600', g.StackAlloc.GEO_DEFAULTS) === 12,
    '浏览器包挂载 window.StackAlloc 且功能可用（Φ600 垛容 12）');
  assert(typeof g.StackAlloc.recommendAllocation === 'function'
    && typeof g.StackAlloc.pickOutBundle === 'function'
    && typeof g.StackAlloc.planRestackMoves === 'function', '三类推荐函数全部导出');
}

console.log(`\nStackAlloc 自测通过（${n} 项断言）`);
