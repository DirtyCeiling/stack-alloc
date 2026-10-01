// 垛容几何与垛内码放物理模型：捆径核算、垛容上限、座位网格、压货判定。
// 全部纯函数：库房几何参数 geo 与捆制规则 rules 由调用方传入，包内不持有任何配置状态。
//
// geo（库房参数段，缺省字段回落 GEO_DEFAULTS）：
//   { rackH 料架限高m, pileW 垛内铺宽m, railTop 垫梁顶标高m, packShim 层间垫木厚mm,
//     packGap 捆间通风缝mm, diaKw/diaKh 捆截面宽/高向富余系数,
//     bundlesPerStack 每垛捆数通用上限, minDiaCm/maxDiaCm 捆径上下限cm,
//     stacksPerSlot 每库位垛数, fillRatio 库容装载比例% }
// rules（捆制规则覆盖）：{ 规格名: 每捆支数 } 或 Map——>0 手工覆盖 / 0 引擎自动推导 / 缺失用预置值。
import { SPEC_DIMS } from './specs.js';

/** 库房几何参数默认值（与历史常量一致；调用方通常传入当前生效参数） */
export const GEO_DEFAULTS = {
  stacksPerSlot: 10,
  rackH: 3.0, pileW: 2.7, railTop: 0.41, packShim: 15, packGap: 30,
  diaKw: 1.08, diaKh: 1.06, bundlesPerStack: 100, minDiaCm: 15, maxDiaCm: 50,
  fillRatio: 22,
};

const G = geo => (geo ? { ...GEO_DEFAULTS, ...geo } : GEO_DEFAULTS);
const ruleOf = (rules, name) =>
  rules == null ? undefined : (rules instanceof Map ? rules.get(name) : rules[name]);

/* 捆内支数排布：仅保留非三角数的手工排布（4=2+2 平铺、5=3+2）；三角数 k(k+1)/2
 * （1,3,6,10,15,21…）由 rowsOf() 通用生成金字塔 [k..1]。 */
const ROD_ROWS = { 1: [1], 4: [2, 2], 5: [3, 2] };

/** 捆内支数 -> 自下而上每层支数：三角数生成金字塔；非三角数在金字塔顶补余数 */
export function rowsOf(rods) {
  if (ROD_ROWS[rods]) return ROD_ROWS[rods];
  const k = Math.floor((Math.sqrt(8 * rods + 1) - 1) / 2);
  const rows = Array.from({ length: k }, (_, i) => k - i);
  const rem = rods - k * (k + 1) / 2;
  if (rem > 0) rows.unshift(rem);
  return rows;
}

/** 捆径核算（cm）：矩形截面取对角线；rows = 自下而上每层支数 */
export function bundleDiaOfRows(rows, diaMm, geo) {
  const g = G(geo);
  const dia = diaMm / 1000;
  const w = Math.max(...rows) * dia * g.diaKw;
  const h = rows.length * dia * g.diaKh + g.packShim / 1000;
  return Math.sqrt(w * w + h * h) * 100;
}

/** 捆制规则引擎：给定杆径(mm)，按三角数支数推导使捆径落入 [minDiaCm, maxDiaCm] 的
 *  最小支数；单支即达标 -> 1（单支吊运）；单支仍超上限（如 Φ600）也返回 1——
 *  单支是物理下限，由调用方警示。 */
export function deriveRods(diaMm, geo) {
  const g = G(geo);
  let lastBelow = null;
  for (let k = 1; k <= 40; k++) {
    const n = k * (k + 1) / 2;
    const d = k === 1 ? diaMm / 10 : bundleDiaOfRows(rowsOf(n), diaMm, g);
    if (d > g.maxDiaCm) return lastBelow ? lastBelow.n : 1;
    if (d >= g.minDiaCm) return n;
    lastBelow = { n };
  }
  return lastBelow ? lastBelow.n : 1;
}

/** 每捆支数：rules 覆盖（>0=手工覆盖 / 0=引擎自动）> 预置值；未知规格返回 0 */
export function bundleRods(specName, geo, rules) {
  const d = SPEC_DIMS[specName];
  if (!d) return 0;
  const rule = ruleOf(rules, specName);
  if (rule != null) return rule > 0 ? rule : deriveRods(d.dia, geo);
  return d.rods;
}

/** 捆径（一捆合起来的外接圆直径，cm）：单支吊运即管径本身；未知规格返回 null */
export function bundleDiaCm(specName, geo, rules) {
  const d = SPEC_DIMS[specName];
  if (!d) return null;
  const rods = bundleRods(specName, geo, rules);
  if (!rods) return null;
  return rods === 1 ? d.dia / 10 : bundleDiaOfRows(rowsOf(rods), d.dia, geo);
}

/** 单捆占位尺寸（米）：{ w 宽向, h 高向 }（按当前捆内支数排布） */
export function pileBundleSize(specName, geo, rules) {
  const d = SPEC_DIMS[specName];
  if (!d) return null;
  const g = G(geo);
  const rows = rowsOf(bundleRods(specName, g, rules));
  const dia = d.dia / 1000;
  return {
    w: Math.max(...rows) * dia * g.diaKw,
    h: rows.length * dia * g.diaKh + g.packShim / 1000,
  };
}

/** 杆径+支数级别的码放几何：{ across 每层并排数, maxLayers 限高可堆层数, geo 物理垛容 } */
export function pileDimsOf(diaMm, rods, geo) {
  const g = G(geo);
  const rows = rowsOf(rods), dia = diaMm / 1000;
  const across = Math.max(2, Math.floor(g.pileW / (Math.max(...rows) * dia * g.diaKw + g.packGap / 1000)));
  const maxLayers = Math.floor(g.rackH / (rows.length * dia * g.diaKh + g.packShim / 1000));
  return { across, maxLayers, geo: across * maxLayers };
}

/** 规格码放几何：{ across, maxLayers, geo }；未知规格返回 null */
export function pileDims(specName, geo, rules) {
  const d = SPEC_DIMS[specName];
  if (!d) return null;
  return pileDimsOf(d.dia, bundleRods(specName, geo, rules), geo);
}

/** 垛容量（捆）：min(每垛通用上限, 每层并排 × 限高层数)。
 *  入库推荐、人工调整校验、实际落位三处必须用同一口径，否则分配单会超出物理垛容。 */
export function stackCap(specName, geo, rules) {
  const g = G(geo);
  const p = pileDims(specName, g, rules);
  return p ? Math.min(g.bundlesPerStack, p.geo) : g.bundlesPerStack;
}

/* ---------------- 垛内座位网格（压货判定/落位回填的物理口径） ----------------
 * 垛内码放：捆沿 X 横放，一层多捆并排（捆间留通风缝），层间垫木，底层坐料架垫梁。
 * 座位网格固定：层内居中先放、向两侧展开（seatOrder），自下而上逐层占位；捆落定后不挪位。
 * 压货物理口径：只有「同座位列正上方」的捆才压住目标捆——同层旁边的捆不挡吊（留有缝隙），
 * 底层边座位的捆只要其座位列上方空着也可直接吊走；吊走后垛内留洞，入库落位优先回填
 * 最低层空座位（freeSeat），无洞时与「铺满一层再上一层」形状一致。
 * 捆视图：{ pos?: { layer, seat } }——有 pos 以 pos 为准，缺失按垛内序号兜底推算。 */

const SEAT_ORDER_CACHE = new Map();

/** 层内座位顺序（居中先放、左右交替向两侧展开）：任意并排数通用 */
export function seatOrder(n) {
  if (!SEAT_ORDER_CACHE.has(n)) {
    const c = (n - 1) / 2;
    SEAT_ORDER_CACHE.set(n, Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b));
  }
  return SEAT_ORDER_CACHE.get(n);
}

/** 垛内序号（0 = 垛底最早捆）-> { layer 层号, seat 层内座位号 }（无 pos 兜底推算） */
export function seatIdx(specName, idx, geo, rules) {
  const across = pileDims(specName, geo, rules).across;
  return { layer: Math.floor(idx / across), seat: seatOrder(across)[idx % across] };
}

/** 捆 i 的有效座位：pos 为准，缺失时按序号兜底（保持压货判定不炸） */
export function effSeat(bundles, specName, i, geo, rules) {
  const b = bundles[i];
  return (b && b.pos) || seatIdx(specName, i, geo, rules);
}

/** 下一个可落座位：最低层优先、层内居中先放，洞位（低层空位）先回填；满垛返回 null */
export function freeSeat(bundles, specName, geo, rules) {
  const p = pileDims(specName, geo, rules);
  const across = p.across, order = seatOrder(across), maxL = p.maxLayers;
  const occ = new Set();
  bundles.forEach((b, i) => { const s = effSeat(bundles, specName, i, geo, rules); occ.add(s.layer * 1000 + s.seat); });
  for (let L = 0; L < maxL; L++)
    for (const seat of order)
      if (!occ.has(L * 1000 + seat) && (L === 0 || occ.has((L - 1) * 1000 + seat))) return { layer: L, seat };
  return null;
}

/** 该捆是否被压：其座位列正上方（同座位、更高层）有捆；同层旁捆不算压 */
export function bundlePressed(bundles, specName, i, geo, rules) {
  const s = effSeat(bundles, specName, i, geo, rules);
  return bundles.some((b, j) => {
    if (j === i) return false;
    const t = effSeat(bundles, specName, j, geo, rules);
    return t.seat === s.seat && t.layer > s.layer;
  });
}

/** 须先倒走的压货捆序号（自上而下逐吊序）：目标捆上方所有更高层的全部捆。
 *  钢材捆圆滚堆叠不稳定——只抽走正上方一列，同层旁捆失撑会塌陷滚过来，
 *  故上方每个更高层都整层倒走（目标捆同层的旁捆不承压、不挡吊，不动）。 */
export function pressersOf(bundles, specName, i, geo, rules) {
  const s = effSeat(bundles, specName, i, geo, rules), out = [];
  bundles.forEach((b, j) => {
    if (j === i) return;
    const t = effSeat(bundles, specName, j, geo, rules);
    if (t.layer > s.layer) out.push(j);
  });
  return out.sort((a, b) => {              // 自最高层往下倒：保证每吊被吊捆其座位列上方已空
    const d = effSeat(bundles, specName, b, geo, rules).layer - effSeat(bundles, specName, a, geo, rules).layer;
    return d || effSeat(bundles, specName, a, geo, rules).seat - effSeat(bundles, specName, b, geo, rules).seat;
  });
}
