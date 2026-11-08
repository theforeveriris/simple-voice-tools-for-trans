/**
 * 应用公共类型定义
 */

/**
 * 页面类型
 * 底部导航栏的四个页面
 */
export type ViewType = 'test' | 'analysis' | 'history' | 'assistant' | 'settings';

/**
 * 底部导航样式
 * floating 悬浮胶囊（默认）；classic 贯穿底部的经典导航栏；
 * ai AI 工作台（全应用只保留 AI 页，设置入口在历史侧边栏底部）
 */
export type NavStyle = 'floating' | 'classic' | 'ai';

/**
 * 界面语言
 * zh-CN 为原始文案；zh-TW/en/ja/es/fr/lzh 为内置翻译
 * （en/ja/es/fr 为机器翻译）；
 * ai 为 AI 翻译语言（由大模型生成的词典，见 i18n/aiLocale.ts，默认语言为 en）
 */
export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'lzh' | 'es' | 'fr' | 'ai';

/**
 * 主题预设配色
 * monet：莫奈取色（跟随主题色相滑条）；
 * pride：骄傲旗主题（旗帜由 prideFlag 选择，氤氲渐变 + 毛玻璃，参数可调）；
 * image：自定义图片（背景层由图片接管，色板同莫奈逻辑）
 */
export type HuePreset = 'monet' | 'pride' | 'image' | 'cat';

/**
 * 骄傲旗主题的旗帜
 * transPride 跨性别（粉白蓝）；nonbinary 非二元（黄紫白黑）；genderfluid 性别流体（粉白紫黑蓝）
 */
export type PrideFlag = 'transPride' | 'nonbinary' | 'genderfluid';

/**
 * 主题模式
 * system 跟随系统深浅色偏好
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * 自定义背景图的焦点位置（cover 裁切锚点，映射到 object-position 百分比）
 */
export type BgImageFocus =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

/**
 * 语谱图伪彩色方案
 */
export type SpecColormap = 'magma' | 'gray' | 'accent';

/**
 * 训练建议生成方式
 * none 关闭；rules 本地规则引擎；lua 用户 Lua 脚本（脚本中心）；llm 调用大模型接口（见 lib/llm.ts）
 */
export type AdviceMode = 'none' | 'rules' | 'lua' | 'llm';

/**
 * 实时音高检测算法（实验性）
 * yin 经典基线；pyin 多阈值概率化，抗噪更强；mpm 麦克劳德法，对低频更敏感
 */
export type PitchAlgorithm = 'yin' | 'pyin' | 'mpm';

/**
 * 分析页图表卡显隐
 */
export interface AnalysisCards {
  pitch: boolean;
  formant: boolean;
  energy: boolean;
  spec: boolean;
  vrp: boolean;
  sibilance: boolean;
}

/**
 * 用户训练方向（声音性别化目标）
 * mtf 女性化（跨女等目标为女性化声音）；ftm 男性化；other 未指定 / 其他 / 双方向
 * 取代此前 AI 靠数据反推方向的逻辑，作为显式上下文传给训练建议 / 周报 / 提示词
 */
export type UserGoal = 'mtf' | 'ftm' | 'other';

/**
 * 年龄段：影响默认音区边界（实验性功能 → 自定义音区边界默认按此派生），
 * 以及大模型分析时的参考基频 / 共振峰范围口径
 */
export type AgeGroup = 'child' | 'adolescent' | 'adult' | 'senior';

/**
 * 测试模式
 * 短按录音圆球使用当前模式（默认朗读，记住上次选择），
 * 长按圆球弹出扇形选择器切换。
 */
export type TestMode = 'reading' | 'sustained' | 'glide';

/**
 * 音高区间类型
 * 用于曲线分段着色与统计
 */
export type PitchBand = 'low' | 'male' | 'transition' | 'female' | 'high';

/**
 * 录制数据序列
 * 均匀采样（约30Hz），null 表示该帧未检出（无声/哑音）
 */
export interface RecordSeries {
  /** 时间轴，单位秒，从录音开始计 */
  t: number[];
  /** 基频 Hz，null = 未检出 */
  f0: (number | null)[];
  /** 音量电平 dB（负值，-90 ~ 0） */
  rmsDb: number[];
  /** 第一共振峰 F1 Hz，null = 未检出 */
  f1: (number | null)[];
  /** 第二共振峰 F2 Hz，null = 未检出 */
  f2: (number | null)[];
}

/**
 * 录音统计信息
 * 由数据序列聚合计算得出
 */
export interface VoiceStats {
  /** 录音时长（秒） */
  durationSec: number;
  /** 序列采样率（Hz，每秒样本数） */
  sampleHz: number;
  /** 总帧数 */
  totalSamples: number;
  /** 有声帧数 */
  voicedSamples: number;
  /** 平均基频 Hz */
  avgF0: number;
  /** 基频中位数 Hz */
  medianF0: number;
  /** 最低基频 Hz */
  minF0: number;
  /** 最高基频 Hz */
  maxF0: number;
  /** 10% 分位基频 Hz（音域下沿） */
  p10F0: number;
  /** 90% 分位基频 Hz（音域上沿） */
  p90F0: number;
  /** 基频标准差 Hz */
  stdF0: number;
  /** 男声区间占比 % */
  malePct: number;
  /** 女声区间占比 % */
  femalePct: number;
  /** 过渡区间占比 % */
  transitionPct: number;
  /** 平均第一共振峰 Hz */
  avgF1: number | null;
  /** 平均第二共振峰 Hz */
  avgF2: number | null;
  /** F2−F1 同帧间距均值（Hz）：女性化共鸣的核心量化（间距越大元音空间越靠前），旧记录为 undefined */
  f2f1GapHz?: number | null;
  /** F2−F1 同帧间距中位数（Hz） */
  f2f1GapMedianHz?: number | null;
  /** 谱倾斜（dB/octave，负=高频衰减快、音色暗），需录音音频（离线管线计算），旧记录为 undefined */
  spectralTiltDbOct?: number | null;
  /** F1 波动范围 [min, max] */
  f1Range: [number, number] | null;
  /** F2 波动范围 [min, max] */
  f2Range: [number, number] | null;
  /** 平均响度 dB */
  avgDb: number;
  /** 峰值响度 dB */
  peakDb: number;
  /** 基频微扰 Jitter(local)，相邻周期长度波动率的帧间平均（%），需录音音频，无音频时为 null */
  jitterPct?: number | null;
  /** 振幅微扰 Shimmer(local)，相邻周期幅度波动率的帧间平均（%），需录音音频，无音频时为 null */
  shimmerPct?: number | null;
  /** 谐噪比 HNR 估计（dB），由 YIN 周期性置信度换算，需录音音频，无音频时为 null */
  hnrDb?: number | null;
  /** 平滑倒谱峰突出度 CPPS（dB），对连续语音稳健的嗓音质量指标，需录音音频，旧记录为 undefined */
  cppsDb?: number | null;
  /** H1−H2（dB）：第一/第二谐波幅度差，气声与声门开商口径，需录音音频，旧记录为 undefined */
  h1h2Db?: number | null;
  /** H2−H4（dB）：第二/第四谐波幅度差，频谱倾斜口径 */
  h2h4Db?: number | null;
  /** H1−A3（dB）：第一谐波与 F3 区最强谐波之差，气声经典指标 */
  h1a3Db?: number | null;
  /** 气声综合指数（0–1，越大越气声） */
  breathiness?: number | null;
  /** A1−P1（dB）：鼻化指标，越低鼻化越重，需录音音频，旧记录为 undefined */
  nasalityDb?: number | null;
  /** 训练靶标达成率：落在目标音高区间内的有声帧占比（%），未启用靶标时为 undefined */
  inTargetPct?: number | null;
}

/**
 * 语谱图量化数据
 * 录音时由 FFT 逐帧映射到对数频带并量化为 Uint8，行优先存储（每行 bands 个字节），
 * base64 序列化后随记录保存。
 */
export interface RecordSpec {
  /** 频带数（每行字节数） */
  bands: number;
  /** 行 × 频带的量化振幅（0-255），base64 */
  data: string;
}

/**
 * 录音环境元数据（自动标注，无需用户输入）
 * 录音开始阶段自动采集：用于日后按环境切片对比（安静 vs 吵闹、晨间 vs 晚间、
 * 换麦克风后的数据漂移）。全部可选——旧记录无此字段。
 */
export interface RecordEnv {
  /** 开场环境底噪估计（dBFS，录音最初静音帧的近似最小电平） */
  noiseFloorDb?: number;
  /** 麦克风标签（getUserMedia track label；设备指纹随浏览器/系统而异，仅作参考） */
  micLabel?: string;
  /** 录音本地小时（0-23，昼夜节律切片用；createdAt 已有绝对时间，此字段只是免换算） */
  hourOfDay?: number;
  /** 导入音频的自动增益归一量（dB，仅导入路径写入；>0 = 分析前已整体提升电平，不改原文件） */
  inputGainDb?: number;
}

/**
 * 一条完整的测试/分析记录
 */
export interface AnalysisRecord {
  id: string;
  /** 创建时间（epoch 毫秒） */
  createdAt: number;
  /** 录音时长（秒） */
  durationSec: number;
  /** 序列采样率 */
  sampleHz: number;
  series: RecordSeries;
  stats: VoiceStats;
  /** 录音时使用的测试模式（旧记录无此字段） */
  mode?: TestMode;
  /** 用户备注（如「晨起嗓音」） */
  note?: string;
  /** 语谱图量化数据（可选，旧记录/无音频记录可能缺失） */
  spec?: RecordSpec;
  /** 录音环境元数据（自动采集，旧记录无此字段） */
  env?: RecordEnv;
  /** 用当前算法参数重算的时间（epoch 毫秒）；从未重算的记录无此字段 */
  reanalyzedAt?: number;
  /** 重算时的算法参数指纹（algoParamsFingerprint）；与当前指纹不一致 = 参数已变、可重算 */
  paramsFp?: string;
}

/**
 * 算法参数（实验性）：音高检测 / 共振峰提取 / 发声门限的 DSP 细节参数
 * 设置 → 实验性功能 → 算法参数 可调，经 algoParams 单例同步到实时与离线管线
 */
export interface AlgoParams {
  /** YIN 判定阈值（CMND 谷低于该值视为周期）：越高越宽容噪声、越易倍频错误 */
  yinThreshold: number;
  /** 音高搜索下限（Hz） */
  pitchMinHz: number;
  /** 音高搜索上限（Hz），至少比下限高 100 Hz */
  pitchMaxHz: number;
  /** LPC 预加重系数（0 = 关闭）：提升高频，抵消声道辐射特性 */
  preEmphasis: number;
  /** LPC 阶数（0 = 自动 2 + fs/1000）：更高解析出更多共振峰，也更易分裂 */
  lpcOrder: number;
  /** F1 候选搜索下限（Hz） */
  f1MinHz: number;
  /** F2 候选搜索上限（Hz） */
  f2MaxHz: number;
  /** 发声能量门限（dBFS）：低于该值的帧不做音高检测 */
  voicedGateDb: number;
  /** 活跃帧能量门限（dBFS）：响度统计 / 嗓音质量 / CPPS 的静音帧判据 */
  activeGateDb: number;
  /** 嗓音质量：YIN 周期性置信度门槛，低于此帧不参与 J/S/HNR 统计 */
  vqMinProb: number;
  /** 嗓音质量：参与 Jitter/Shimmer 统计的最少周期数 */
  vqMinPeriods: number;
  /** CPPS：倒谱峰搜索的基频上限（Hz） */
  cppsF0Max: number;
  /** CPPS：帧级 CPP 的时间平滑窗（帧数） */
  cppsSmoothFrames: number;
}

/**
 * 应用设置
 */
export interface AppSettings {
  /* ---------- 用户画像（训练方向 / 年龄段） ----------
   * 用于推导默认音区边界（ageGroup）、默认训练靶标（userGoal），
   * 并显式传给大模型分析标准以取代原先「靠数据反推方向」的口径。 */
  /** 训练方向（声音性别化目标）：mtf / ftm / other */
  userGoal: UserGoal;
  /** 年龄段：child / adolescent / adult / senior，影响默认音区边界与提示词 */
  ageGroup: AgeGroup;
  /** 莫奈主题种子色相（0-360） */
  hue: number;
  /** 莫奈主题强调色相（0-360）：按钮 / 选中态 / 图表主曲线；与 hue 相同 = 单色（默认），不同 = 双色调 */
  accentHue: number;
  /** 莫奈主题深色模式表面色相（0-360）：与 hue 相同 = 跟随（默认），不同 = 深浅两套铺底 */
  darkHue: number;
  /** 主题深浅模式，system 跟随系统 */
  theme: ThemeMode;
  /** 界面语言 */
  language: Locale;
  /** 预设配色：monet 莫奈取色（默认，跟随主题色相），pride 骄傲旗（旗帜见 prideFlag），cat 彩蛋「粉团子」 */
  huePreset: HuePreset;
  /** 彩蛋「喵喵练声」首次通关后解锁「粉团子」主题（解锁后预设配色出现第四张卡） */
  catThemeUnlocked: boolean;
  /* ---------- 骄傲旗主题（huePreset = pride 时生效） ---------- */
  /** 骄傲旗旗帜 */
  prideFlag: PrideFlag;
  /** 渐变浓度：渐变光斑层的不透明度倍率（0.4–1.2，1 = 标准） */
  prideGlow: number;
  /** 渐变饱和度：光斑层的 saturate 滤镜倍率（0.6–1.6，1.12 = 标准） */
  prideSaturation: number;
  /** 毛玻璃强度：卡片背景模糊半径 px（0 = 关闭，标准 18） */
  prideGlassBlur: number;
  /** 背景流动动画：渐变光斑缓慢漂移 */
  prideDrift: boolean;
  /* ---------- 氛围彩蛋 ---------- */
  /** 声音染色：麦克风活跃时界面色相随实时音高在蓝→粉弧上流动 */
  voiceTint: boolean;
  /** 音量呼吸：pride 渐变浓度随麦克风响度起伏（仅 pride 渐变主题下可见） */
  volumeBreath: boolean;
  /* ---------- 自定义背景图片（huePreset = image 时生效） ---------- */
  /** 背景图焦点位置（cover 裁切锚点，object-position）：九宫方向键 */
  bgImageFocus: BgImageFocus;
  /** 背景图模糊半径 px（0 = 清晰原图） */
  bgImageBlur: number;
  /** 背景图压暗比例（0–0.6）：浅色下直接生效，深色模式自动加深 1.5 倍 */
  bgImageDim: number;
  /** 背景图饱和度倍率（saturate 滤镜） */
  bgImageSaturation: number;
  /** 背景图存在感（0–1 不透明度）：音量呼吸彩蛋的乘数作用点 */
  bgImageOpacity: number;
  /** 背景图缓慢漂移动画（复用 pride-drift，遵循 prefers-reduced-motion） */
  bgImageDrift: boolean;
  /** 是否显示图表网格辅助线 */
  showGrid: boolean;
  /** 底部导航样式：悬浮胶囊 / 贯穿底部的经典导航栏 */
  navStyle: NavStyle;
  /** 单次录音最长时长（秒），0 = 不限制 */
  maxDurationSec: number;
  /** 录音结束后是否自动进入分析页 */
  autoEnterAnalysis: boolean;
  /** 麦克风设备 ID，空串 = 系统默认 */
  micDeviceId: string;
  /** SPL 校准偏移（dB）：真实声压级 = 录音电平(dBFS) + 该偏移；undefined = 未校准（只显示 dBFS） */
  splOffsetDb?: number;
  /** 是否保存录音音频（用于回放与嗓音质量分析），存于 IndexedDB */
  audioSave: boolean;
  /** 当前测试模式（短按圆球所用，长按可切换） */
  testMode: TestMode;
  /** 四个图表是否共用同一时间轴区间（关闭后可独立缩放，统计跟随音高曲线） */
  syncChartRange: boolean;
  /** 移动端历史卡片底部的整行迷你基频曲线（桌面端内联曲线不受影响） */
  mobileSpark: boolean;
  /* ---------- 配置子页面扩展 ---------- */
  /** 回放倍速（0.5 / 0.75 / 1 / 1.5） */
  playbackRate: number;
  /** 长音模式：发声后持续静音达到该秒数自动结束 */
  silenceStopSec: number;
  /** 音高轴下限（Hz），影响图表纵轴与迷你曲线 */
  pitchAxisMin: number;
  /** 音高轴上限（Hz） */
  pitchAxisMax: number;
  /** 测试页实时图表滚动窗口（秒） */
  liveWindowSec: number;
  /** 实时音高曲线的显示平滑级别（0 = 关闭，1–3 递增；仅影响图表观感，不改记录与统计） */
  pitchSmoothing: number;
  /** 语谱图伪彩色方案 */
  specColormap: SpecColormap;
  /** 录音码率（kbps，MediaRecorder audioBitsPerSecond） */
  audioBitrateKbps: number;
  /** 麦克风增益与降噪（默认关闭以采集原始音质） */
  micEnhance: boolean;
  /** 录音开始/结束震动反馈（移动端） */
  haptics: boolean;
  /** 录音落库后自动回放刚录的音频 */
  autoReplay: boolean;
  /** 分析页图表卡显隐 */
  analysisCards: AnalysisCards;
  /** 启动时默认进入的页签 */
  startTab: ViewType;
  /** 原生壳启动页（PWA 同款观感，默认开启；设置 → 配置 可关） */
  splashScreen: boolean;
  /** 用声日记热力图周起始日：1 = 周一（默认），0 = 周日 */
  diaryWeekStart: 0 | 1;
  /** GitHub 云备份：用户自己的 OAuth App / GitHub App Client ID（仅存本地） */
  githubClientId?: string;
  /** GitHub 云备份：目标私有仓库名 */
  githubRepo?: string;
  /** 训练靶标：是否启用目标音高区间（测试页叠加目标带 + 达成率统计） */
  targetEnabled: boolean;
  /** 训练靶标：目标区间下限（Hz） */
  targetF0Min: number;
  /** 训练靶标：目标区间上限（Hz） */
  targetF0Max: number;
  /** 共振峰目标区：是否启用（元音散点叠加目标矩形 + 命中率） */
  formantTargetEnabled: boolean;
  /** 共振峰目标区：目标 F1 中心（Hz） */
  formantTargetF1: number;
  /** 共振峰目标区：目标 F2 中心（Hz） */
  formantTargetF2: number;
  /** 共振峰目标区：容差半径（Hz），目标区为 (F1±r, F2±r) 矩形 */
  formantTargetRadius: number;
  /** 基线记录 id：分析页自动对比新记录与基线的 Δ 指标 */
  baselineRecordId?: string;
  /* ---------- 实验性功能（设置 → 实验性功能 子页面） ---------- */
  /** 自定义音区边界（Hz，自低到高四个分界点），undefined = 默认 85/165/180/255 */
  bandBounds?: [number, number, number, number];
  /** 实时音高检测算法（实验性）：影响实时曲线与录音分析所用的音高检测器 */
  pitchAlgorithm: PitchAlgorithm;
  /** 音高算法对比卡（实验性）：分析页用 pYIN / MPM 重算录音并与当前算法对比 */
  pitchCompareEnabled: boolean;
  /* ---------- 算法参数（实验性 → 算法参数，AlgoParams 的持久化展开） ---------- */
  /** YIN 判定阈值 */
  algoYinThreshold: number;
  /** 音高搜索下限（Hz） */
  algoPitchMinHz: number;
  /** 音高搜索上限（Hz） */
  algoPitchMaxHz: number;
  /** LPC 预加重系数 */
  algoPreEmphasis: number;
  /** F1 候选搜索下限（Hz） */
  algoF1MinHz: number;
  /** F2 候选搜索上限（Hz） */
  algoF2MaxHz: number;
  /** 发声能量门限（dBFS） */
  algoVoicedGateDb: number;
  /** 活跃帧能量门限（dBFS）：响度统计 / 嗓音质量 / CPPS 共用 */
  algoActiveGateDb: number;
  /** LPC 阶数（0 = 自动） */
  algoLpcOrder: number;
  /** 嗓音质量：周期性置信度门槛 */
  algoVqMinProb: number;
  /** 嗓音质量：最少周期数 */
  algoVqMinPeriods: number;
  /** CPPS：倒谱峰搜索基频上限（Hz） */
  algoCppsF0Max: number;
  /** CPPS：时间平滑帧数 */
  algoCppsSmoothFrames: number;
  /** 分析页是否显示语谱图卡片 */
  showSpectrogram: boolean;
  /** 实验性：把界面里所有「AI」显示为「SI」（纯显示层替换，提示词与日志不变） */
  siRenameEnabled: boolean;
  /** 花园视图：每行花数（2–5，移动端与桌面端一致） */
  gardenColumns: number;
  /** 花园视图：是否按月分节（关闭 = 纯平铺行） */
  gardenMonthSections: boolean;
  /** 是否在历史页显示花园视图（默认关闭） */
  showGarden: boolean;
  /** 测试页是否追加第四张实时频谱图（额外 Canvas，耗电/掉帧风险自负） */
  liveSpectrum: boolean;
  /** 训练建议生成方式：无 / 规则判断 / 基于大模型判断 */
  adviceMode: AdviceMode;
  /** 对比页（两条记录对比）是否也显示训练建议 */
  adviceOnCompare: boolean;
  /** 大模型配置：OpenAI 兼容接口 Base URL（如 https://api.example.com/v1） */
  llmBaseUrl?: string;
  /** 大模型配置：API Key（仅存本地 IndexedDB kv 仓库，不随数据导出） */
  llmApiKey?: string;
  /** 大模型配置：模型 ID（如 gpt-4o-mini / deepseek-chat） */
  llmModelId?: string;
  /** 大模型配置：补充规则（逐条追加到内置分析标准之后，冲突时以规则为准） */
  llmExtraRules?: string[];
  /** 大模型配置：整体覆写内置提示词（设置后不再使用内置分析标准） */
  llmPromptOverride?: string;
  /** 大模型配置：当前应用的配置档案 id（档案与 Key 存 IDB kv，见 lib/llmProfiles.ts） */
  llmActiveProfileId?: string;
  /** 大模型配置：用量费用估算——每百万 tokens 输入单价（0/未填 = 不折算；货币单位自定） */
  llmPriceIn?: number;
  /** 大模型配置：用量费用估算——每百万 tokens 输出单价 */
  llmPriceOut?: number;
  /** 练习提醒：每日本地通知开关（应用在后台运行时生效；当天已有记录不打扰） */
  practiceReminderEnabled: boolean;
  /** 练习提醒：提醒时间（HH:mm，24 小时制） */
  practiceReminderTime: string;
  /** 长期记忆：自动保存开关（关闭后仍可用消息下方的手动「记住」） */
  memoryAutoSave: 'auto' | 'off';
  /** AI 写操作权限：关闭 / 每次确认 */
  assistantWrites: 'off' | 'confirm';
  /* ---------- AI 翻译语言（语言子页面） ---------- */
  /** 允许 AI 翻译：用实验性功能的大模型把界面翻译成其他语言 */
  aiTranslateEnabled: boolean;
  /** AI 翻译：目标语言显示名（如 Deutsch），生成过词典的语言；language = 'ai' 时生效 */
  aiLanguage?: string;
  /** AI 翻译：术语表原文（每行「中文 = 译文」），生成 / 补全时注入提示词 */
  aiGlossary?: string;
}
