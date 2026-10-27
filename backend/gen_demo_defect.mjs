#!/usr/bin/env node
/**
 * DeepScope 测试业务域「demo-defect」数据生成脚本
 * 主题：缺陷处置中的关联知识应用
 *
 * 用法：
 *     node gen_demo_defect.mjs                    # 默认 small（约 100 节点），固定种子
 *     node gen_demo_defect.mjs --scale medium     # 长尾数据 ×3
 *     node gen_demo_defect.mjs --scale large      # 长尾数据 ×50（性能压测用）
 *     node gen_demo_defect.mjs --seed 123         # 覆盖随机种子
 *
 * 产出：backend/demo-defect.db（nodes / edges / metadata 三张表，schema 与 demo-core.db 完全一致）
 *
 * 设计要点：
 *   1. 零依赖：使用 Node 22 内置 node:sqlite，无需 npm install。
 *   2. 重建式：每次运行前删除旧库（含 -wal/-shm），全量重写，幂等可重复。
 *   3. 两段式数据：1# 引风机缺陷主干全部手写（人工可逐条核对）；长尾记录由固定种子
 *      PRNG（mulberry32）程序化生成，保证同种子同结果。
 *   4. 后端零改动：server.py 的 _discover_domains() 扫描 backend/*.db，文件名即域名。
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── 配置 ────────────────────────────────────────────────

const DOMAIN = 'demo-defect';
const DB_PATH = fileURLToPath(new URL('./demo-defect.db', import.meta.url));
const TABLE_NODES = 'nodes';
const TABLE_EDGES = 'edges';

const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const SCALE = argOf('--scale', 'small');
const SEED = Number(argOf('--seed', '20261012')) || 20261012;
/** small 保持人工可核对；medium/large 仅把长尾同类记录批量复制，用于规模与性能验证 */
const SCALE_FACTOR = { small: 1, medium: 3, large: 50 }[SCALE];
if (!SCALE_FACTOR) {
  console.error(`[错误] 未知 --scale: ${SCALE}（可选 small | medium | large）`);
  process.exit(1);
}

/** 固定种子 PRNG（mulberry32）：保证脚本可重复运行得到相同结果 */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ── 类别定义（12 类节点主体） ───────────────────────────

/** 类别 → 展示色（前端 categoryColors.usePalette=true 时会按类别重新分配，此处供关闭调色板时使用） */
const CATEGORY_COLORS = {
  机组: '#0ea5e9',
  系统: '#14b8a6',
  区域: '#94a3b8',
  设备: '#2563eb',
  部件: '#06b6d4',
  缺陷单: '#dc2626',
  历史缺陷: '#f97316',
  检修工单: '#16a34a',
  经验案例: '#7c3aed',
  人员: '#f59e0b',
  班组: '#d946ef',
  专业: '#84cc16',
};

/** 关系映射：`源类别|目标类别` → [边 label, 边 category, 默认 weight] */
const RELATIONS = {
  '机组|系统': ['包含系统', '机组-系统', 1],
  '系统|设备': ['包含设备', '系统-设备', 1],
  '区域|设备': ['位于区域', '区域-设备', 1],
  '设备|部件': ['包含部件', '设备-部件', 1],
  '缺陷单|设备': ['涉及设备', '缺陷单-设备', 3],
  '缺陷单|部件': ['指向部件', '缺陷单-部件', 3],
  '缺陷单|人员': ['责任人', '缺陷单-人员', 2],
  '缺陷单|历史缺陷': ['相似缺陷', '缺陷单-历史缺陷', 2],
  '缺陷单|检修工单': ['关联工单', '缺陷单-检修工单', 2],
  '历史缺陷|设备': ['涉及设备', '历史缺陷-设备', 1],
  '历史缺陷|部件': ['指向部件', '历史缺陷-部件', 1],
  '检修工单|设备': ['检修对象', '检修工单-设备', 2],
  '检修工单|部件': ['检修对象', '检修工单-部件', 2],
  '检修工单|班组': ['执行班组', '检修工单-班组', 1],
  '检修工单|经验案例': ['沉淀案例', '检修工单-经验案例', 2],
  '经验案例|历史缺陷': ['源自缺陷', '经验案例-历史缺陷', 1],
  '经验案例|部件': ['适用部件', '经验案例-部件', 1],
  '经验案例|人员': ['编写人', '经验案例-人员', 1],
  '人员|班组': ['所属班组', '人员-班组', 1],
  '人员|专业': ['所属专业', '人员-专业', 1],
};

/** 节点级颜色板：用于生成 description 时限制「关联」段长度 */
const DESC_RELATION_LIMIT = 8;

// ── 数据容器 ────────────────────────────────────────────

const nodes = [];
const edges = [];

/**
 * 登记节点。
 * @param {string} id 形如 `设备/dev-0001`，前缀即类别
 * @param {string} label 显示名
 * @param {Record<string, string|number>} fm frontmatter 字段（按顺序渲染进 description 的基本信息段）
 * @param {{desc?: string, date?: string}} [extra] desc 为手写描述（覆盖自动生成）；date 为业务发生日期
 */
function addNode(id, label, fm, extra = {}) {
  nodes.push({
    id,
    label,
    category: id.split('/')[0],
    fm,
    desc: extra.desc || '',
    date: extra.date || '',
  });
}

/**
 * 登记边：label / category / weight 自动按两端类别查关系表，边色取目标类别色。
 * @param {string} source
 * @param {string} target
 * @param {number} [weight] 覆盖默认权重（用于「相似缺陷」相似度 1~5）
 */
function addEdge(source, target, weight) {
  const sc = source.split('/')[0];
  const tc = target.split('/')[0];
  const rel = RELATIONS[`${sc}|${tc}`];
  if (!rel) {
    throw new Error(`未定义的关系: ${sc} → ${tc}（${source} → ${target}）`);
  }
  const [label, category, defaultWeight] = rel;
  edges.push({
    source,
    target,
    label,
    category,
    weight: weight ?? defaultWeight,
    color: CATEGORY_COLORS[tc] || '#cbd5e1',
  });
}

const pad = (n, w = 4) => String(n).padStart(w, '0');

// ── 主干数据：设备归属（机组 / 系统 / 区域） ────────────

const UNITS = [
  ['机组/unit-0001', '1# 机组', { 类型: '燃煤发电机组', 容量: '660MW', 状态: '运行', 投运: '2018-06-01' }],
  ['机组/unit-0002', '2# 机组', { 类型: '燃煤发电机组', 容量: '660MW', 状态: '运行', 投运: '2019-09-15' }],
];

const SYSTEMS = [
  ['系统/sys-0001', '烟风系统', { 所属机组: '1# 机组', 功能: '为锅炉提供燃烧用风并排出烟气', 介质: '烟气 / 空气' }],
  ['系统/sys-0002', '制粉系统', { 所属机组: '1# 机组', 功能: '磨制并输送煤粉', 介质: '原煤 / 煤粉' }],
  ['系统/sys-0003', '汽水系统', { 所属机组: '1# 机组', 功能: '给水升压送入锅炉', 介质: '除盐水' }],
  ['系统/sys-0004', '润滑油系统', { 所属机组: '1# 机组', 功能: '为转机轴承提供润滑与冷却', 介质: '32# 汽轮机油' }],
  ['系统/sys-0005', '除尘系统', { 所属机组: '1# 机组', 功能: '烟气净化与粉尘收集', 介质: '烟气 / 粉煤灰' }],
  ['系统/sys-0006', '电气系统', { 所属机组: '1# 机组', 功能: '厂用电与电机供电', 介质: '6kV / 380V' }],
];

const AREAS = [
  ['区域/area-0001', '引风机房', { 位置: '锅炉尾部 0m 层', 环境特征: '粉尘大、夏季环境温度高' }],
  ['区域/area-0002', '锅炉本体区', { 位置: '锅炉 8m~40m 层', 环境特征: '高温辐射' }],
  ['区域/area-0003', '汽机房', { 位置: '汽机房 0m 层', 环境特征: '振动源多' }],
  ['区域/area-0004', '除尘器区', { 位置: '锅炉尾部 12m 层', 环境特征: '粉尘大、振打噪声高' }],
];

// ── 主干数据：设备（12 台） ─────────────────────────────

const DEVICES = [
  ['设备/dev-0001', '1# 引风机', { 型号: 'AN-3200/1800', 类型: '离心式引风机', 所属系统: '烟风系统', 安装位置: '引风机房', 状态: '运行', 投运: '2018-06-01', 额定转速: '745 r/min' }],
  ['设备/dev-0002', '1# 引风机电机', { 型号: 'YKK630-8', 类型: '高压异步电机', 所属系统: '电气系统', 安装位置: '引风机房', 状态: '运行', 投运: '2018-06-01', 额定功率: '1800 kW' }],
  ['设备/dev-0003', '1# 送风机', { 型号: 'ASN-2500/1400', 类型: '动叶可调轴流风机', 所属系统: '烟风系统', 安装位置: '引风机房', 状态: '运行', 投运: '2018-06-01' }],
  ['设备/dev-0004', '1# 一次风机', { 型号: 'PAF-18.0-13.3-2', 类型: '离心式一次风机', 所属系统: '烟风系统', 安装位置: '引风机房', 状态: '运行', 投运: '2018-06-01' }],
  ['设备/dev-0005', '1# 空预器', { 型号: 'LAP-13400/2800', 类型: '三分仓回转式空气预热器', 所属系统: '烟风系统', 安装位置: '锅炉本体区', 状态: '运行', 投运: '2018-06-01' }],
  ['设备/dev-0006', '2# 引风机', { 型号: 'AN-3200/1800', 类型: '离心式引风机', 所属系统: '烟风系统', 安装位置: '引风机房', 状态: '运行', 投运: '2019-09-15' }],
  ['设备/dev-0007', '2# 送风机', { 型号: 'ASN-2500/1400', 类型: '动叶可调轴流风机', 所属系统: '烟风系统', 安装位置: '引风机房', 状态: '运行', 投运: '2019-09-15' }],
  ['设备/dev-0008', '1# 磨煤机', { 型号: 'ZGM113G', 类型: '中速辊式磨煤机', 所属系统: '制粉系统', 安装位置: '锅炉本体区', 状态: '运行', 投运: '2018-06-01' }],
  ['设备/dev-0009', '1# 给水泵', { 型号: 'FK6D32', 类型: '卧式多级离心泵', 所属系统: '汽水系统', 安装位置: '汽机房', 状态: '运行', 投运: '2018-06-01' }],
  ['设备/dev-0010', '1# 润滑油站', { 型号: 'XYZ-125G', 类型: '稀油站', 所属系统: '润滑油系统', 安装位置: '锅炉本体区', 状态: '运行', 投运: '2018-06-01' }],
  ['设备/dev-0011', '1# 电袋除尘器', { 型号: 'DBX-320', 类型: '电袋复合除尘器', 所属系统: '除尘系统', 安装位置: '除尘器区', 状态: '运行', 投运: '2018-06-01' }],
  ['设备/dev-0012', '2# 一次风机', { 型号: 'PAF-18.0-13.3-2', 类型: '离心式一次风机', 所属系统: '烟风系统', 安装位置: '引风机房', 状态: '运行', 投运: '2019-09-15' }],
];

// ── 主干数据：部件（16 个，含测点） ─────────────────────

const PARTS = [
  ['部件/bearing-0001', '1# 引风机非驱动端轴承', { 所属设备: '1# 引风机', 类型: '双列调心滚子轴承', 型号: '22344CA/W33', 润滑方式: '锂基脂', 状态: '温度偏高' }],
  ['部件/bearing-0002', '1# 引风机驱动端轴承', { 所属设备: '1# 引风机', 类型: '双列调心滚子轴承', 型号: '22344CA/W33', 润滑方式: '锂基脂', 状态: '正常' }],
  ['部件/impeller-0001', '1# 引风机叶轮', { 所属设备: '1# 引风机', 类型: '后向式离心叶轮', 材质: '16Mn', 状态: '正常' }],
  ['部件/coupling-0001', '1# 引风机联轴器', { 所属设备: '1# 引风机', 类型: '膜片联轴器', 对中状态: '2026-04 复查合格' }],
  ['部件/pump-0001', '1# 引风机润滑油泵', { 所属设备: '1# 引风机', 类型: '齿轮泵', 流量: '25 L/min', 状态: '正常' }],
  ['部件/seal-0001', '1# 引风机轴端密封', { 所属设备: '1# 引风机', 类型: '迷宫密封 + 毛毡', 状态: '轻微渗油' }],
  ['部件/sensor-0001', '非驱动端轴承温度测点 TE-3105', { 所属设备: '1# 引风机', 类型: 'Pt100 热电阻', 量程: '0~150℃', 报警值: '75℃' }],
  ['部件/sensor-0002', '非驱动端轴承振动测点 VE-3106', { 所属设备: '1# 引风机', 类型: '速度传感器', 量程: '0~20 mm/s', 报警值: '4.6 mm/s' }],
  ['部件/bearing-0003', '1# 送风机非驱动端轴承', { 所属设备: '1# 送风机', 类型: '调心滚子轴承', 型号: '22234CA', 润滑方式: '锂基脂' }],
  ['部件/bearing-0004', '1# 一次风机驱动端轴承', { 所属设备: '1# 一次风机', 类型: '调心滚子轴承', 型号: '22328CA', 润滑方式: '锂基脂' }],
  ['部件/bearing-0005', '1# 空预器导向轴承', { 所属设备: '1# 空预器', 类型: '推力调心滚子轴承', 润滑方式: '稀油循环' }],
  ['部件/gearbox-0001', '1# 磨煤机减速机', { 所属设备: '1# 磨煤机', 类型: '行星齿轮减速机', 润滑方式: '稀油站强制润滑' }],
  ['部件/bearing-0006', '1# 给水泵推力轴承', { 所属设备: '1# 给水泵', 类型: '推力瓦', 润滑方式: '透平油' }],
  ['部件/tank-0001', '1# 润滑油站油箱', { 所属设备: '1# 润滑油站', 类型: '25m³ 油箱', 油品牌号: '32# 汽轮机油', 状态: '正常' }],
  ['部件/bearing-0007', '1# 引风机电机驱动端轴承', { 所属设备: '1# 引风机电机', 类型: '深沟球轴承', 型号: '6322/C3', 润滑方式: '锂基脂' }],
  ['部件/hammer-0001', '1# 电袋除尘器振打装置', { 所属设备: '1# 电袋除尘器', 类型: '电磁振打器', 状态: '正常' }],
];

// ── 主干数据：缺陷单（本域入口） ────────────────────────

const DEFECT_ID = '缺陷单/defect-0001';
const DEFECT_DESC = [
  '## 基本信息',
  '- **缺陷编号**: QX-2026-1012-001',
  '- **设备**: 1# 引风机',
  '- **部件**: 非驱动端轴承（温度测点 TE-3105）',
  '- **缺陷现象**: 轴承温度异常',
  '- **处理状态**: 待处理',
  '- **缺陷等级**: 一般缺陷',
  '- **发现时间**: 2026-10-12 08:20',
  '- **发现人**: 王明（点检员）',
  '- **责任人**: 李强（机械一班）',
  '',
  '## 缺陷描述与现场记录',
  '- 08:20 DCS 报警：非驱动端轴承温度 78℃，较昨日同期升高 11℃，呈缓慢上升趋势',
  '- 09:05 现场检查：轴承座外表温度约 72℃，油位正常，无渗漏，无可闻异音',
  '- 09:20 振动测点 VE-3106 振速 3.2mm/s，处于正常范围上限',
  '- 09:30 润滑油温 46℃、油压 0.18MPa，均在正常区间',
  '- 初步判断：润滑脂老化或冷却风道积灰可能性较大，轴承本体劣化待确认',
  '',
  '## 关联知识图谱',
  '- 01 缺陷对象关联：以本缺陷单为入口，关联所属设备、相关部件及业务记录，快速了解缺陷涉及的设备与历史情况',
  '- 02 历史经验参考：关联查看历史相似缺陷、检修记录及处置案例，为缺陷原因分析和处理提供知识参考',
  '- 03 跨模块业务跳转：通过关联图谱定位相关设备、工单和知识内容，支持跳转至对应业务页面查看详情',
].join('\n');

// ── 主干数据：人员 / 班组 / 专业 ───────────────────────

const PEOPLE = [
  ['人员/person-0001', '王明', '班组/team-0001', '专业/spec-0001', '点检员'],
  ['人员/person-0002', '李强', '班组/team-0001', '专业/spec-0001', '检修负责人'],
  ['人员/person-0003', '张伟', '班组/team-0001', '专业/spec-0001', '转机专业工程师'],
  ['人员/person-0004', '赵敏', '班组/team-0001', '专业/spec-0001', '点检员'],
  ['人员/person-0005', '陈刚', '班组/team-0004', '专业/spec-0003', '仪控检修工'],
  ['人员/person-0006', '刘洋', '班组/team-0003', '专业/spec-0002', '电气检修工'],
  ['人员/person-0007', '孙磊', '班组/team-0002', '专业/spec-0001', '机械检修工'],
  ['人员/person-0008', '周涛', '班组/team-0004', '专业/spec-0004', '热工工程师'],
];

const TEAMS = [
  ['班组/team-0001', '机械一班', { 所属专业: '机械', 人数: '12', 负责范围: '锅炉辅机转机检修' }],
  ['班组/team-0002', '机械二班', { 所属专业: '机械', 人数: '10', 负责范围: '汽机与制粉系统检修' }],
  ['班组/team-0003', '电气班', { 所属专业: '电气', 人数: '8', 负责范围: '厂用电与电机检修' }],
  ['班组/team-0004', '仪控班', { 所属专业: '仪控', 人数: '9', 负责范围: '热工测点与控制系统' }],
];

const SPECS = [
  ['专业/spec-0001', '机械', { 专业类别: '转机 / 辅机', 负责范围: '轴承、叶轮、联轴器等机械部件' }],
  ['专业/spec-0002', '电气', { 专业类别: '一次 / 二次', 负责范围: '电机、开关、电缆' }],
  ['专业/spec-0003', '仪控', { 专业类别: '热工自动化', 负责范围: '测点、变送器、执行机构' }],
  ['专业/spec-0004', '热工', { 专业类别: '热力性能', 负责范围: '温度、压力、流量测点校验' }],
];

// ── 长尾数据：历史缺陷（相似缺陷，weight 表示相似度） ──
// [label, 设备 id, 部件 id | null, 相似度, 处置结论]

const HISTORY = [
  ['1# 引风机非驱动端轴承温度缓慢上升', '设备/dev-0001', '部件/bearing-0001', 5, '补加锂基脂并清理轴承座冷却风道，温度由 76℃ 回落至 62℃'],
  ['1# 引风机轴承温度高报警', '设备/dev-0001', '部件/bearing-0001', 5, '更换润滑脂并调整冷却风量，报警解除'],
  ['1# 引风机非驱动端轴承温度波动', '设备/dev-0001', '部件/bearing-0001', 4, '检查测温元件接线后波动消除，判断为接触电阻变化'],
  ['1# 引风机润滑油温偏高', '设备/dev-0001', '部件/tank-0001', 4, '清洗冷油器并补充新油，油温回落至 43℃'],
  ['1# 引风机轴承振动超标', '设备/dev-0001', '部件/sensor-0002', 3, '复查联轴器对中，振动由 5.1mm/s 降至 2.4mm/s'],
  ['1# 引风机轴承润滑不良', '设备/dev-0001', '部件/pump-0001', 3, '更换润滑油泵出口滤网，油压恢复至 0.22MPa'],
  ['1# 送风机轴承温度偏高', '设备/dev-0003', '部件/bearing-0003', 2, '补加润滑脂后温度下降 5℃'],
  ['2# 引风机轴承温度异常', '设备/dev-0006', '部件/bearing-0001', 4, '同类型缺陷，判定为润滑脂老化，换脂后恢复正常'],
  ['1# 一次风机轴承温度偏高', '设备/dev-0004', '部件/bearing-0004', 2, '清理冷却水管路结垢，温度恢复正常'],
  ['1# 空预器导向轴承温度高', '设备/dev-0005', '部件/bearing-0005', 2, '调整油位并更换滤芯，温度稳定在 58℃'],
  ['1# 磨煤机减速机温度高', '设备/dev-0008', '部件/gearbox-0001', 1, '更换齿轮油并清洗油站滤网'],
  ['1# 给水泵推力瓦温度高', '设备/dev-0009', '部件/bearing-0006', 1, '调整推力间隙，温度回落至报警值以下'],
  ['1# 引风机电机轴承温度偏高', '设备/dev-0002', '部件/bearing-0007', 3, '补充润滑脂并检查电机冷却风道'],
  ['1# 引风机润滑油压偏低', '设备/dev-0001', '部件/pump-0001', 3, '更换油泵机械密封，油压恢复正常'],
  ['2# 送风机轴承振动异常', '设备/dev-0007', '部件/bearing-0003', 1, '动平衡校正后振动达标'],
  ['1# 引风机轴承座渗油', '设备/dev-0001', '部件/seal-0001', 2, '更换轴端密封毛毡，渗油消除'],
  ['1# 引风机联轴器对中偏差', '设备/dev-0001', '部件/coupling-0001', 2, '重新对中，径向偏差由 0.12mm 调整至 0.04mm'],
  ['1# 引风机叶轮积灰不平衡', '设备/dev-0001', '部件/impeller-0001', 1, '离线清灰后振动下降 1.8mm/s'],
  ['2# 一次风机轴承温度波动', '设备/dev-0012', '部件/bearing-0004', 1, '检查接线并紧固，波动消除'],
  ['1# 空预器主轴承油温高', '设备/dev-0005', '部件/bearing-0005', 1, '增加冷却水量，油温下降 6℃'],
];

/** 缺陷单 → 相似历史缺陷的相似度档位（对应 weight，档位越高越相似；共 7 条，保证入口节点邻居数可控） */
const SIMILAR_WEIGHTS = {
  '历史缺陷/hdefect-0001': 5,
  '历史缺陷/hdefect-0002': 5,
  '历史缺陷/hdefect-0003': 4,
  '历史缺陷/hdefect-0004': 4,
  '历史缺陷/hdefect-0008': 4,
  '历史缺陷/hdefect-0005': 3,
  '历史缺陷/hdefect-0006': 3,
};

// ── 长尾数据：检修工单 ──────────────────────────────────
// [label, 设备 id, 部件 id | null, 班组 id, 经验案例 id | null, 完工日期, 结论]

const WORKORDERS = [
  ['1# 引风机非驱动端轴承补充润滑脂', '设备/dev-0001', '部件/bearing-0001', '班组/team-0001', '经验案例/case-0006', '2026-04-18', '补加 2# 锂基脂 1.2kg，温度下降 6℃'],
  ['1# 引风机轴承温度高专项检查', '设备/dev-0001', '部件/bearing-0001', '班组/team-0001', '经验案例/case-0001', '2026-03-06', '清理轴承座冷却风道积灰，温度恢复正常'],
  ['1# 引风机润滑油站滤网更换', '设备/dev-0010', '部件/tank-0001', '班组/team-0001', '经验案例/case-0003', '2026-02-20', '更换双筒滤网，油压由 0.16MPa 升至 0.21MPa'],
  ['1# 引风机联轴器对中复查', '设备/dev-0001', '部件/coupling-0001', '班组/team-0001', '经验案例/case-0005', '2026-04-02', '径向偏差 0.04mm，符合验收标准'],
  ['1# 送风机轴承检查', '设备/dev-0003', '部件/bearing-0003', '班组/team-0001', '经验案例/case-0002', '2026-05-11', '轴承游隙正常，补充润滑脂'],
  ['2# 引风机轴承温度高处理', '设备/dev-0006', null, '班组/team-0002', '经验案例/case-0002', '2026-06-08', '换脂并调整冷却风量，温度恢复正常'],
  ['1# 一次风机轴承润滑', '设备/dev-0004', '部件/bearing-0004', '班组/team-0001', '经验案例/case-0006', '2026-06-25', '补加润滑脂，温度下降 4℃'],
  ['1# 空预器导向轴承油位检查', '设备/dev-0005', '部件/bearing-0005', '班组/team-0002', '经验案例/case-0008', '2026-07-03', '油位补至中线，温度稳定'],
  ['1# 引风机叶轮清灰', '设备/dev-0001', '部件/impeller-0001', '班组/team-0001', '经验案例/case-0011', '2026-07-19', '离线清灰 12kg，振动下降 1.8mm/s'],
  ['1# 引风机电机轴承检查', '设备/dev-0002', '部件/bearing-0007', '班组/team-0003', '经验案例/case-0004', '2026-08-05', '补充润滑脂并清理电机冷却风道'],
  ['1# 磨煤机减速机换油', '设备/dev-0008', '部件/gearbox-0001', '班组/team-0002', '经验案例/case-0009', '2026-08-21', '更换齿轮油 320L，油温下降 7℃'],
  ['1# 引风机轴承座密封更换', '设备/dev-0001', '部件/seal-0001', '班组/team-0001', '经验案例/case-0012', '2026-09-02', '更换轴端密封毛毡，渗油消除'],
  ['1# 给水泵推力瓦检查', '设备/dev-0009', '部件/bearing-0006', '班组/team-0002', '经验案例/case-0010', '2026-09-16', '推力瓦接触面良好，调整推力间隙'],
  ['2# 送风机轴承更换', '设备/dev-0007', null, '班组/team-0002', '经验案例/case-0004', '2026-09-28', '更换非驱动端轴承，振动达标'],
];

// ── 长尾数据：经验案例 ──────────────────────────────────
// [label, 历史缺陷 id | null, 部件 id | null, 编写人 id, 经验要点]

const CASES = [
  ['引风机轴承温度异常的诊断与处理', '历史缺陷/hdefect-0001', '部件/bearing-0001', '人员/person-0003', '按「测点 → 润滑 → 冷却 → 装配 → 负荷」顺序排查，可覆盖 90% 轴承温度异常'],
  ['转机轴承温度缓慢上升的原因排查方法', '历史缺陷/hdefect-0002', '部件/bearing-0001', '人员/person-0003', '缓慢上升多为润滑劣化或冷却失效；突升需优先怀疑测点与断油'],
  ['引风机润滑油系统常见故障处置', '历史缺陷/hdefect-0014', '部件/pump-0001', '人员/person-0002', '油压偏低依次查滤网、机械密封、溢流阀；油温高优先查冷油器'],
  ['轴承温度高与振动的关系分析', '历史缺陷/hdefect-0005', '部件/sensor-0002', '人员/person-0004', '温度高伴振动上升指向机械劣化；仅温度高多为润滑或冷却问题'],
  ['引风机联轴器对中不良的影响', '历史缺陷/hdefect-0017', '部件/coupling-0001', '人员/person-0002', '对中偏差 0.1mm 以上会引起轴承温度与振动同步上升，检修后必须复查'],
  ['风机轴承润滑脂选用与补加经验', '历史缺陷/hdefect-0006', '部件/bearing-0001', '人员/person-0002', '高速重载选 2# 锂基脂，补加量为轴承腔 1/3，过量同样导致温升'],
  ['轴承温度测点故障的识别', '历史缺陷/hdefect-0003', '部件/sensor-0001', '人员/person-0008', '温度跳变或与相邻测点偏差大于 5℃ 时先查接线与元件，避免误判为设备缺陷'],
  ['空预器导向轴承温度高处理经验', '历史缺陷/hdefect-0010', '部件/bearing-0005', '人员/person-0007', '优先查油位与油质，其次查冷却水路，最后考虑轴承磨损'],
  ['磨煤机减速机温度高处理案例', '历史缺陷/hdefect-0011', '部件/gearbox-0001', '人员/person-0007', '换油并清洗滤网后温度可恢复，油质劣化是主因'],
  ['给水泵推力瓦温度高分析与处置', '历史缺陷/hdefect-0012', '部件/bearing-0006', '人员/person-0007', '结合推力间隙与油压判断，间隙超标需立即停机处理'],
  ['风机叶轮积灰不平衡的振动特征', '历史缺陷/hdefect-0018', '部件/impeller-0001', '人员/person-0003', '1 倍频振动突出且随时间增长，多为积灰不平衡'],
  ['引风机轴承座渗油治理经验', '历史缺陷/hdefect-0016', '部件/seal-0001', '人员/person-0002', '迷宫密封 + 毛毡组合失效时优先更换毛毡并复核轴颈磨损'],
];

// ── 组装：节点与边 ──────────────────────────────────────

function buildGraph() {
  // 1) 设备归属：机组 / 系统 / 区域
  for (const [id, label, fm] of UNITS) addNode(id, label, fm);
  for (const [id, label, fm] of SYSTEMS) addNode(id, label, fm);
  for (const [id, label, fm] of AREAS) addNode(id, label, fm);

  // 2) 设备 / 部件
  for (const [id, label, fm] of DEVICES) addNode(id, label, fm);
  for (const [id, label, fm] of PARTS) addNode(id, label, fm);

  // 3) 缺陷单入口
  addNode(DEFECT_ID, '1# 引风机轴承温度异常', { 处理状态: '待处理' }, {
    desc: DEFECT_DESC,
    date: '2026-10-12',
  });

  // 4) 人员 / 班组 / 专业
  for (const [id, label, fm] of TEAMS) addNode(id, label, fm);
  for (const [id, label, fm] of SPECS) addNode(id, label, fm);
  for (const [id, label, teamId, specId, role] of PEOPLE) {
    addNode(id, label, { 岗位: role, 所属班组: labelOf(teamId), 所属专业: labelOf(specId) });
  }

  // 5) 长尾：历史缺陷 / 检修工单 / 经验案例（按 --scale 复制扩展）
  const ctx = { historyIds: [], workorderIds: [], caseIds: [] };
  for (let batch = 0; batch < SCALE_FACTOR; batch++) {
    buildHistoryBatch(HISTORY, batch, ctx);
    buildWorkorderBatch(WORKORDERS, batch, ctx);
    buildCaseBatch(CASES, batch, ctx);
  }

  // 6) 边：设备归属
  addEdge('机组/unit-0001', '系统/sys-0001');
  addEdge('机组/unit-0001', '系统/sys-0002');
  addEdge('机组/unit-0001', '系统/sys-0003');
  addEdge('机组/unit-0001', '系统/sys-0004');
  addEdge('机组/unit-0001', '系统/sys-0005');
  addEdge('机组/unit-0001', '系统/sys-0006');
  addEdge('机组/unit-0002', '系统/sys-0001');
  addEdge('机组/unit-0002', '系统/sys-0002');

  // 7) 边：系统 → 设备
  const SYSTEM_OF_DEVICE = {
    '设备/dev-0001': '系统/sys-0001', '设备/dev-0002': '系统/sys-0006', '设备/dev-0003': '系统/sys-0001',
    '设备/dev-0004': '系统/sys-0001', '设备/dev-0005': '系统/sys-0001', '设备/dev-0006': '系统/sys-0001',
    '设备/dev-0007': '系统/sys-0001', '设备/dev-0008': '系统/sys-0002', '设备/dev-0009': '系统/sys-0003',
    '设备/dev-0010': '系统/sys-0004', '设备/dev-0011': '系统/sys-0005', '设备/dev-0012': '系统/sys-0001',
  };
  for (const dev of Object.keys(SYSTEM_OF_DEVICE)) addEdge(SYSTEM_OF_DEVICE[dev], dev);

  // 8) 边：区域 → 设备
  const AREA_OF_DEVICE = {
    '设备/dev-0001': '区域/area-0001', '设备/dev-0002': '区域/area-0001', '设备/dev-0003': '区域/area-0001',
    '设备/dev-0004': '区域/area-0001', '设备/dev-0005': '区域/area-0002', '设备/dev-0006': '区域/area-0001',
    '设备/dev-0007': '区域/area-0001', '设备/dev-0008': '区域/area-0002', '设备/dev-0009': '区域/area-0003',
    '设备/dev-0010': '区域/area-0002', '设备/dev-0011': '区域/area-0004', '设备/dev-0012': '区域/area-0001',
  };
  for (const dev of Object.keys(AREA_OF_DEVICE)) addEdge(AREA_OF_DEVICE[dev], dev);

  // 9) 边：设备 → 部件
  const DEVICE_OF_PART = {
    '部件/bearing-0001': '设备/dev-0001', '部件/bearing-0002': '设备/dev-0001', '部件/impeller-0001': '设备/dev-0001',
    '部件/coupling-0001': '设备/dev-0001', '部件/pump-0001': '设备/dev-0001', '部件/seal-0001': '设备/dev-0001',
    '部件/sensor-0001': '设备/dev-0001', '部件/sensor-0002': '设备/dev-0001', '部件/bearing-0003': '设备/dev-0003',
    '部件/bearing-0004': '设备/dev-0004', '部件/bearing-0005': '设备/dev-0005', '部件/gearbox-0001': '设备/dev-0008',
    '部件/bearing-0006': '设备/dev-0009', '部件/tank-0001': '设备/dev-0010', '部件/bearing-0007': '设备/dev-0002',
    '部件/hammer-0001': '设备/dev-0011',
  };
  for (const part of Object.keys(DEVICE_OF_PART)) addEdge(DEVICE_OF_PART[part], part);

  // 10) 边：缺陷单 → 设备 / 部件 / 责任人
  addEdge(DEFECT_ID, '设备/dev-0001');
  addEdge(DEFECT_ID, '部件/bearing-0001');
  addEdge(DEFECT_ID, '人员/person-0002');

  // 11) 边：人员 → 班组 / 专业
  for (const [id, , teamId, specId] of PEOPLE) {
    addEdge(id, teamId);
    addEdge(id, specId);
  }

  return ctx;
}

/** 历史缺陷批次：batch 0 为手写数据，batch > 0 复用模板并挂到随机设备上 */
function buildHistoryBatch(rows, batch, ctx) {
  rows.forEach(([label, devId, partId, similar, conclusion], i) => {
    const id = `历史缺陷/hdefect-${pad(i + 1 + batch * rows.length)}`;
    const device = batch === 0 ? devId : pick(DEVICES)[0];
    const part = batch === 0 ? partId : null;
    const date = `2026-${pad(1 + ((i + batch) % 9), 2)}-${pad(1 + ((i * 3) % 27), 2)}`;
    addNode(id, batch === 0 ? label : `${label}（${batch + 1} 期）`, {
      所属设备: labelOf(device),
      缺陷现象: label,
      缺陷等级: similar >= 4 ? '一般缺陷' : '轻微缺陷',
      发生日期: date,
      处置结论: conclusion,
    }, { date });

    const defectWeight = SIMILAR_WEIGHTS[id];
    if (defectWeight) addEdge(DEFECT_ID, id, defectWeight);

    addEdge(id, device);
    if (part) addEdge(id, part);
    ctx.historyIds.push(id);
  });
}

/** 检修工单批次 */
function buildWorkorderBatch(rows, batch, ctx) {
  rows.forEach(([label, devId, partId, teamId, caseId, doneDate, conclusion], i) => {
    const id = `检修工单/wo-${pad(i + 1 + batch * rows.length)}`;
    const device = batch === 0 ? devId : pick(DEVICES)[0];
    const part = batch === 0 ? partId : null;
    addNode(id, batch === 0 ? label : `${label}（${batch + 1} 期）`, {
      工单编号: `WO-2026-${pad(i + 1 + batch * rows.length, 5)}`,
      检修对象: labelOf(device),
      执行班组: labelOf(teamId),
      完工日期: doneDate,
      工单状态: '已闭环',
      检修结论: conclusion,
    }, { date: doneDate });

    addEdge(id, device);
    if (part) addEdge(id, part);
    addEdge(id, teamId);
    if (caseId) addEdge(id, caseId);

    // 主缺陷单关联两张与其直接相关的工单
    if (batch === 0 && (id === '检修工单/wo-0002' || id === '检修工单/wo-0001')) {
      addEdge(DEFECT_ID, id);
    }
    ctx.workorderIds.push(id);
  });
}

/** 经验案例批次 */
function buildCaseBatch(rows, batch, ctx) {
  rows.forEach(([label, hdefectId, partId, personId, summary], i) => {
    const id = `经验案例/case-${pad(i + 1 + batch * rows.length)}`;
    const part = batch === 0 ? partId : pick(PARTS)[0];
    const author = batch === 0 ? personId : pick(PEOPLE)[0];
    addNode(id, batch === 0 ? label : `${label}（${batch + 1} 期）`, {
      案例类型: '设备缺陷处置经验',
      适用对象: labelOf(part),
      编写人: labelOf(author),
      编写日期: `2026-${pad(2 + ((i + batch) % 8), 2)}-15`,
      经验要点: summary,
    }, { date: `2026-${pad(2 + ((i + batch) % 8), 2)}-15` });

    if (hdefectId) addEdge(id, hdefectId);
    addEdge(id, part);
    addEdge(id, author);
    ctx.caseIds.push(id);
  });
}

const nodeIndex = new Map();
function labelOf(id) {
  const hit = nodeIndex.get(id);
  if (hit) return hit;
  const found = nodes.find((n) => n.id === id);
  return found ? found.label : id;
}

// ── 后处理：度数 / rank / size / description ────────────

function decorate() {
  for (const n of nodes) nodeIndex.set(n.id, n.label);

  const degree = new Map();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

  // rank：同一 category 内按度数降序（度数大 → rank 小 → 优先被 BFS 展开）
  const byCategory = new Map();
  for (const n of nodes) {
    if (!byCategory.has(n.category)) byCategory.set(n.category, []);
    byCategory.get(n.category).push(n.id);
  }
  const rankMap = new Map();
  for (const [, ids] of byCategory) {
    ids.sort((a, b) => (degree.get(b) - degree.get(a)) || a.localeCompare(b, 'zh-Hans-CN'));
    ids.forEach((id, i) => rankMap.set(id, i + 1));
  }

  // 关联索引：节点 → [{label, name}]，用于自动生成 description 的「关联」段
  const adjacency = new Map();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    adjacency.get(e.source)?.push({ label: e.label, name: labelOf(e.target) });
    adjacency.get(e.target)?.push({ label: e.label, name: labelOf(e.source) });
  }

  for (const n of nodes) {
    n.degree = degree.get(n.id) || 0;
    n.size = 20 + Math.min(n.degree * 2, 30);
    n.rank = rankMap.get(n.id) || 0;
    n.color = CATEGORY_COLORS[n.category] || '#94a3b8';
    n.description = n.desc || buildDescription(n, adjacency.get(n.id) || []);
  }
}

/** 自动生成 description：## 基本信息（frontmatter）+ ## 关联（由实际边推导） */
function buildDescription(node, neighbors) {
  const out = ['## 基本信息'];
  for (const [k, v] of Object.entries(node.fm || {})) out.push(`- **${k}**: ${v}`);
  if (neighbors.length) {
    const grouped = new Map();
    for (const { label, name } of neighbors) {
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(name);
    }
    out.push('');
    out.push('## 关联');
    let shown = 0;
    for (const [label, names] of grouped) {
      if (shown >= DESC_RELATION_LIMIT) break;
      const list = names.slice(0, 4).join('、');
      out.push(`- **${label}**: ${list}${names.length > 4 ? ` 等 ${names.length} 项` : ''}`);
      shown++;
    }
    if (grouped.size > shown) out.push(`- **其他关联**: 另有 ${grouped.size - shown} 类关系，可在图谱中展开查看`);
  }
  if (node.date) {
    out.push('');
    out.push('## 时间');
    out.push(`- **业务日期**: ${node.date}`);
  }
  return out.join('\n');
}

// ── 写库 ────────────────────────────────────────────────

const DDL_NODES = `CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('entity', 'virtual', 'tag')),
        mtime INTEGER,
        frontmatter TEXT,
        date_created TEXT,
        date_modified TEXT,
        date_published TEXT
      , size INTEGER NOT NULL DEFAULT 20, category TEXT NOT NULL DEFAULT '默认', color TEXT NOT NULL DEFAULT '#94a3b8', label TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '', rank INTEGER NOT NULL DEFAULT 0, description TEXT DEFAULT '')`;

const DDL_EDGES = `CREATE TABLE edges (
        edge_id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('link', 'tag')), weight REAL NOT NULL DEFAULT 1.0, category TEXT NOT NULL DEFAULT '默认', color TEXT NOT NULL DEFAULT '#cbd5e1', label TEXT NOT NULL DEFAULT '关联', domain TEXT NOT NULL DEFAULT '',
        UNIQUE(source, target, type)
      )`;

function resetDatabase() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (existsSync(p)) rmSync(p, { force: true });
  }
}

function writeDatabase() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');

  db.exec(DDL_NODES);
  db.exec(DDL_EDGES);
  db.exec('CREATE TABLE metadata (\n          key TEXT PRIMARY KEY,\n          value TEXT\n        )');

  const insertNode = db.prepare(
    `INSERT INTO ${TABLE_NODES} (id, type, mtime, frontmatter, date_created, date_modified, date_published, size, category, color, label, domain, rank, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertEdge = db.prepare(
    `INSERT INTO ${TABLE_EDGES} (source, target, type, weight, category, color, label, domain)
     VALUES (?, ?, 'link', ?, ?, ?, ?, ?)`
  );

  const today = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const n of nodes) {
      const created = n.date ? `${n.date}T08:00:00.000Z` : '2026-01-05T08:00:00.000Z';
      insertNode.run(
        n.id,
        'entity',
        Date.parse(created) || Date.parse(today),
        JSON.stringify({ title: n.label, ...Object.fromEntries(Object.entries(n.fm || {})) }),
        created,
        created,
        created,
        n.size,
        n.category,
        n.color,
        n.label,
        DOMAIN,
        n.rank,
        n.description
      );
    }
    for (const e of edges) {
      insertEdge.run(e.source, e.target, e.weight, e.category, e.color, e.label, DOMAIN);
    }
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('source', 'gen_demo_defect.mjs');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const journalRow = db.prepare('PRAGMA journal_mode').get();
  const journal = journalRow ? String(Object.values(journalRow)[0]) : 'unknown';
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  return journal;
}

// ── 自检 ────────────────────────────────────────────────

function selfCheck() {
  const problems = [];
  const idSet = new Set();
  for (const n of nodes) {
    if (idSet.has(n.id)) problems.push(`重复节点 id: ${n.id}`);
    idSet.add(n.id);
  }

  const edgeKeys = new Set();
  for (const e of edges) {
    const key = `${e.source}|${e.target}|link`;
    if (edgeKeys.has(key)) problems.push(`重复边: ${e.source} → ${e.target}`);
    edgeKeys.add(key);
    if (!idSet.has(e.source)) problems.push(`边引用了不存在的源节点: ${e.source}`);
    if (!idSet.has(e.target)) problems.push(`边引用了不存在的目标节点: ${e.target}`);
  }

  const degree = new Map();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.source, degree.get(e.source) + 1);
    degree.set(e.target, degree.get(e.target) + 1);
  }
  const isolated = nodes.filter((n) => degree.get(n.id) === 0);

  // 从入口节点做 BFS，检查可达性
  const adjacency = new Map();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    adjacency.get(e.source).push(e.target);
    adjacency.get(e.target).push(e.source);
  }
  const seen = new Set([DEFECT_ID]);
  const queue = [DEFECT_ID];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adjacency.get(cur) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const unreachable = nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);

  const catCount = new Map();
  for (const n of nodes) catCount.set(n.category, (catCount.get(n.category) || 0) + 1);

  const maxDegree = [...degree.entries()].sort((a, b) => b[1] - a[1])[0];
  const noDesc = nodes.filter((n) => !n.description).length;

  return { problems, isolated, unreachable, catCount, maxDegree, noDesc, degree };
}

// ── 主流程 ──────────────────────────────────────────────

function main() {
  const t0 = Date.now();
  resetDatabase();
  buildGraph();
  decorate();
  const journal = writeDatabase();
  const check = selfCheck();

  const t1 = Date.now();
  console.log('── demo-defect 生成完成 ────────────────────────');
  console.log(`理论产物: ${DB_PATH}`);
  console.log(`规模参数: --scale ${SCALE}（长尾 ×${SCALE_FACTOR}），--seed ${SEED}`);
  console.log(`节点: ${nodes.length} 条，边: ${edges.length} 条，耗时 ${t1 - t0}ms`);
  console.log(`journal_mode: ${journal}`);
  console.log('类别分布:');
  for (const [cat, n] of [...check.catCount.entries()].sort((a, b) => b[1] - a[1])) {
    const catNodes = nodes.filter((x) => x.category === cat);
    const maxD = Math.max(...catNodes.map((x) => check.degree.get(x.id)));
    console.log(`  ${cat.padEnd(6, '　')} ${String(n).padStart(4)} 个节点   最大关联数 ${maxD}`);
  }
  console.log(`入口节点: ${DEFECT_ID}（关联 ${check.degree.get(DEFECT_ID)} 个直接邻居）`);
  console.log(`description 覆盖率: ${nodes.length - check.noDesc}/${nodes.length}`);
  console.log(`最大关联数节点: ${check.maxDegree[0]}（${check.maxDegree[1]} 条边）`);

  if (check.isolated.length) {
    console.log(`孤立节点（无任何边，共 ${check.isolated.length}）:`);
    for (const n of check.isolated.slice(0, 10)) console.log(`  - ${n.id}`);
  } else {
    console.log('孤立节点: 无');
  }

  if (check.unreachable.length) {
    console.log(`从入口不可达节点（共 ${check.unreachable.length}）:`);
    for (const id of check.unreachable.slice(0, 10)) console.log(`  - ${id}`);
  } else {
    console.log('从入口可达: 全部节点可达');
  }

  if (check.problems.length) {
    console.log(`数据问题 ${check.problems.length} 处:`);
    for (const p of check.problems.slice(0, 10)) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('数据问题: 无');
  }
}

main();
