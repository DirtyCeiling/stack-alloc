// 规格注册表：棒材/管材规格的物理属性（杆径 mm、预置每捆支数）与形状族。
// 规格族（family/shape）：同族视为"相似货物"，入库评分③库位同质性按族加励/惩罚。
// 本表是入库/出库/倒库三类推荐共用的规格口径；展示元数据（颜色/吨位/钢种/长度）
// 归各消费端自己维护，本包只承载与推荐算法相关的物理量。
export const SPECS = [
  { name: '螺纹钢 Φ20', dia: 20, rods: 21, family: 'rebar' },
  { name: '螺纹钢 Φ25', dia: 25, rods: 15, family: 'rebar' },
  { name: '圆钢 Φ50',  dia: 50, rods: 4,  family: 'round' },
  { name: '圆钢 Φ60',  dia: 60, rods: 3,  family: 'round' },
  { name: '方钢 40×40', dia: 40, rods: 5, family: 'square' },
  // 管材（无缝钢管，Φ50~Φ600；小口径成捆，Φ200 起单支吊运不打带）
  { name: '管材 Φ50',  dia: 50,  rods: 6, family: 'pipe' },
  { name: '管材 Φ100', dia: 100, rods: 6, family: 'pipe' },
  { name: '管材 Φ200', dia: 200, rods: 1, family: 'pipe' },
  { name: '管材 Φ400', dia: 400, rods: 1, family: 'pipe' },
  { name: '管材 Φ600', dia: 600, rods: 1, family: 'pipe' },
];

/** 规格名 -> 规格族（形状）：rebar / round / square / pipe */
export const SPEC_FAMILY = Object.fromEntries(SPECS.map(s => [s.name, s.family]));

/** 规格名 -> { dia 杆径mm, rods 预置每捆支数 }（预置值可被 rules 覆盖） */
export const SPEC_DIMS = Object.fromEntries(SPECS.map(s => [s.name, { dia: s.dia, rods: s.rods }]));

/** 规格族查询；未知规格返回 null */
export function specFamily(specName) {
  return SPEC_FAMILY[specName] || null;
}
