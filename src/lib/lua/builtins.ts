/**
 * 内置 Lua 脚本（实验性「脚本中心」的示例与教程）
 * 脚本源码以 .lua 文件维护在仓库 lua-scripts/ 目录（Vite ?raw 导入），
 * 每条同时是可运行的默认行为和供用户改写的模板；新增内置脚本 =
 * 往 lua-scripts/<kind>/ 加文件 + 在此登记。接口约定见 lua-scripts/README.md。
 *
 * 默认启用策略：advice 保留「默认建议规则」开箱即用；card / export 保留各自的
 * 默认模板开启；新增的示例（含全部 flower）默认关闭，避免悄悄改变既有输出。
 */

import defaultAdvice from '../../../lua-scripts/advice/default.lua?raw';
import strictResonance from '../../../lua-scripts/advice/strict-resonance.lua?raw';
import voiceRest from '../../../lua-scripts/advice/voice-rest.lua?raw';
import sustainedSmooth from '../../../lua-scripts/advice/sustained-smooth.lua?raw';
import breathSupport from '../../../lua-scripts/advice/breath-support.lua?raw';
import vowelShape from '../../../lua-scripts/advice/vowel-shape.lua?raw';
import darkMinimalCard from '../../../lua-scripts/card/dark-minimal.lua?raw';
import lightMinimalCard from '../../../lua-scripts/card/light-minimal.lua?raw';
import auroraCard from '../../../lua-scripts/card/aurora-glow.lua?raw';
import praatBundle from '../../../lua-scripts/export/praat-bundle.lua?raw';
import csvFrames from '../../../lua-scripts/export/csv-frames.lua?raw';
import praatTextGrid from '../../../lua-scripts/export/praat-textgrid.lua?raw';
import bloomRadiant from '../../../lua-scripts/flower/bloom-radiant.lua?raw';
import bloomSoft from '../../../lua-scripts/flower/bloom-soft.lua?raw';
import type { ScriptKind } from './scripts';

/** 一条内置脚本的元信息（id / 名称 / 方向 / 说明 / 源码 / 默认启用态） */
export interface BuiltinScriptMeta {
  id: string;
  name: string;
  kind: ScriptKind;
  /** 一句话说明（脚本中心列表展示，中文） */
  description: string;
  code: string;
  /** 首次安装是否默认启用 */
  defaultEnabled: boolean;
}

export const BUILTIN_SCRIPTS: BuiltinScriptMeta[] = [
  /* ---------- advice：训练建议（可同时启用多个，运行时合并） ---------- */
  {
    id: 'builtin-advice-default',
    name: '默认建议规则',
    kind: 'advice',
    description: '靶标偏离、Jitter、基频波动、有效发声占比、共鸣间距的综合体检',
    code: defaultAdvice,
    defaultEnabled: true,
  },
  {
    id: 'builtin-advice-strict-resonance',
    name: '严格共鸣训练',
    kind: 'advice',
    description: '把 F2−F1 间距逐档拆开给反馈，适合共鸣定位的中后期',
    code: strictResonance,
    defaultEnabled: false,
  },
  {
    id: 'builtin-advice-voice-rest',
    name: '用声健康',
    kind: 'advice',
    description: 'Jitter / Shimmer / HNR 组合看嗓音疲劳，超阈值提示休息',
    code: voiceRest,
    defaultEnabled: false,
  },
  {
    id: 'builtin-advice-sustained-smooth',
    name: '长音稳定度',
    kind: 'advice',
    description: 'CV 基频波动与微扰指标，波动大就练慢速长音',
    code: sustainedSmooth,
    defaultEnabled: false,
  },
  {
    id: 'builtin-advice-breath-support',
    name: '呼吸支持',
    kind: 'advice',
    description: 'HNR / CPPS / Jitter 组合看气声与声带闭合，支持不足先练呼吸',
    code: breathSupport,
    defaultEnabled: false,
  },
  {
    id: 'builtin-advice-vowel-shape',
    name: '元音形态',
    kind: 'advice',
    description: 'F1 / F2 / 间距给元音共鸣定位练习建议',
    code: vowelShape,
    defaultEnabled: false,
  },

  /* ---------- card：分享卡模板（单一生效） ---------- */
  {
    id: 'builtin-card-dark-minimal',
    name: '暗色极简卡',
    kind: 'card',
    description: '深色渐变底 + 大字基频 + 内置音高曲线面板',
    code: darkMinimalCard,
    defaultEnabled: true,
  },
  {
    id: 'builtin-card-light-minimal',
    name: '浅色极简卡',
    kind: 'card',
    description: '浅底浅墨字，适合打印与日间分享',
    code: lightMinimalCard,
    defaultEnabled: false,
  },
  {
    id: 'builtin-card-aurora-glow',
    name: '极光渐变卡',
    kind: 'card',
    description: '暗紫渐变 + 大字基频 + 四格统计，视觉更张扬',
    code: auroraCard,
    defaultEnabled: false,
  },

  /* ---------- flower：声之花生成（单一生效） ---------- */
  {
    id: 'builtin-flower-bloom-radiant',
    name: '放射能量花',
    kind: 'flower',
    description: '用频带能量做花瓣长度，频谱指纹最直观',
    code: bloomRadiant,
    defaultEnabled: false,
  },
  {
    id: 'builtin-flower-bloom-soft',
    name: '柔和模版花',
    kind: 'flower',
    description: '无频谱数据也能用的 12 瓣正弦花，F1/F2 调花心',
    code: bloomSoft,
    defaultEnabled: false,
  },

  /* ---------- export：自定义格式导出桥（单一生效） ---------- */
  {
    id: 'builtin-export-praat-bundle',
    name: 'Praat 脚本打包',
    kind: 'export',
    description: '导出可被 Praat 直接执行的脚本：重建 pitch/formant 轨迹',
    code: praatBundle,
    defaultEnabled: true,
  },
  {
    id: 'builtin-export-csv-frames',
    name: 'CSV 帧序列',
    kind: 'export',
    description: '每帧一行 t/f0/rmsDb/f1/f2 的通用 CSV',
    code: csvFrames,
    defaultEnabled: false,
  },
  {
    id: 'builtin-export-praat-textgrid',
    name: 'Praat TextGrid',
    kind: 'export',
    description: '导出短文本 TextGrid（Pitch tier），Praat 直接可读',
    code: praatTextGrid,
    defaultEnabled: false,
  },
];
