# 主题系统架构（莫奈取色与骄傲旗预设）

本文描述配色系统的完整链路：OKLCH 令牌生成、预设机制、CSS 变量分层、
骄傲旗渐变与毛玻璃参数化、自定义组件外观，以及已踩过的坑。实现：
`src/lib/theme/monet.ts`、`src/lib/theme/customTheme.ts`、
`src/index.css`（主题相关区块在文件尾部）、`vite.config.ts`。

## 双变量令牌（一切的基础）

每个色板令牌写入**两个** CSS 变量：

- `--c-x`：完整 `oklch()` 字符串 —— Canvas 画笔与 `color-mix()` 使用；
- `--c-x-rgb`：`"r g b"` 三元组 —— Tailwind 颜色经
  `rgb(var(--c-x-rgb) / <alpha-value>)` 消费，使 `bg-accent/35` 可用。

令牌清单（`SCALE`）：`surface / card / surface-hi / ink / ink-2 / accent /
on-accent / accent-soft / on-accent-soft / line`，另派生 `accent2`（次强调）
与 `on-accent2-soft` / `accent2-soft`。同时派生 shadcn/radix 的 HSL 语义变量
（`--background` 等，`rgbToHslTriplet` 换算）供基础组件使用。

生成入口 `buildTokens(hue, dark, accentHue, spec)`：

- 表面 / 文字 / 线条用**种子色相**着色；强调色系用 `accentHue`；
- 深浅两套明度/彩度参数在 `SCALE` 中，预设可用 `overrides` 逐令牌覆盖；
- **`darkHue`**（预设专用）：深色模式的表面色相可不同于浅色——
  例如非二元旗的浅色用黄相铺底、深色换紫黑（黄相在近黑会读作土棕）。
  次强调色相始终按浅色 hue 计算，保证图表曲线深浅两模式色相一致。

## 应用与切换（`applyTheme` / `presetSpec`）

`presetSpec(preset, userHue, prideFlag = 'transPride', userAccentHue = userHue,
userDarkHue = userHue)` → `{ hue, accentHue, spec }`；
`applyTheme(hue, dark, accentHue, spec, prideFlag)`：

1. 调 `buildTokens` 并把全部令牌写入 `document.documentElement.style`；
2. `colorScheme`、`<meta name="theme-color">` 同步；
3. **类切换**：`dark`（shadcn dark: 变体）+ 预设类（`theme-pride`），
   骄傲旗另写 `data-pride-flag="<flagId>"` 供 CSS 选渐变；
4. `dispatchEvent('app:themechange')` —— `chartPainters` / 语谱图 LUT
   据此失效调色板缓存（Canvas 不会自动感知 CSS 变量变化）。

调用点三处：`main.tsx`（首帧前；原生壳内壁纸取色成功后再次调用，见下节）、
`App.tsx`（订阅 hue / accentHue / darkHue / huePreset / prideFlag / theme /
customTheme / 系统深浅变化）、外观页 `applyPreset`（立即重放）。

## 莫奈取色首启默认 = 壁纸色（Material You，dynamic.ts）

原生壳（Android）内首次启动（无持久化设置时）经原生 `SystemBars` 插件读取
**系统壁纸主色**（API 27+），取其色相写入莫奈三滑条（hue / accentHue / darkHue）
并持久化——壁纸色不是独立预设，而是与三个色相滑条同轨的初始值；浏览器环境
恒返回 null 走常规兜底（山桃红）。实现：`lib/theme/dynamic.ts`，调用点
`main.tsx` 首帧前后各一次。

## 预设

`THEME_PRESETS: { monet: null, transPride, nonbinary, genderfluid }`，
`ThemePresetSpec { hue, accentHue, themeClass?, darkHue?, overrides? }`：

- **monet**：用户未自定义强调 / 深色色相时 spec 为 null，完全跟随主题色相滑条；
  **强调色相（accentHue）或深色色相（darkHue）与主题色相不同时**，`presetSpec`
  合成一个仅携带差异字段的 spec 下发（buildTokens 只消费 darkHue，overrides /
  themeClass 为空，其余令牌与单色行为一致）——双色调与独立深色铺底由此实现，
  `applyTheme` / `buildTokens` 签名不变。外观页拖动主题色相滑条时，尚未被独立
  调整过的 accentHue / darkHue 一并跟随（等于旧 hue 才跟随），拖过即分离；
- **骄傲旗三款**：`themeClass: 'theme-pride'` 共用一套渐变/毛玻璃 CSS，
  渐变按 `data-pride-flag` 区分，强调色与深浅铺底各自指定。

外观页的预设选择为**卡片网格**（`ThemeCard`：色板预览 + 名称 + 选中描边）：
莫奈卡用 OKLCH 渐变实时预览当前色相，骄傲旗卡渲染当前旗帜条纹，
图片背景卡显示当前背景图缩略图（未选图时占位图标），第四张「自定义」卡
进入组件外观子页（见下节）；解锁彩蛋后追加「粉团子」卡。旗帜三选一
同为条纹卡片。预设规格在 `lib/theme/monet.ts` 的 `THEME_PRESETS`
（`monet` / `transPride` / `nonbinary` / `genderfluid` 四项），
`constants` 里没有同名导出。

新增旗帜的完整步骤：

1. `types.HuePreset` / `PRIDE_FLAGS`（constants，含条纹色）加 id；
2. `THEME_PRESETS` 加 spec（hue / accentHue / themeClass: 'theme-pride' / overrides）；
3. `index.css` 加 `html.theme-pride[data-pride-flag='xxx'] body::before` 渐变
   （浅色 + `.dark` 微光两组）；
4. 外观页的旗帜选择为**条纹卡片三选一网格**（由 `PRIDE_FLAGS` 驱动，非下拉）；
   导入白名单 `STRING_ENUMS.prideFlag` 加 id；
5. i18n 七语言加旗帜名。

## 渐变背景与毛玻璃（index.css）

渐变挂在 `html.theme-pride body::before`（`position: fixed; inset: -12%;
z-index: -1`，多层 radial-gradient + `blur(48px)`，`pride-drift` 32s 缓慢漂移，
`prefers-reduced-motion` 与 `theme-pride-static` 类可关闭）。

**三个用户可调参数**（`applyPrideParams` 由 useStore 订阅写入 CSS 变量）：

| CSS 变量 | 设置项 | 作用 |
| --- | --- | --- |
| `--pride-glow` | 渐变浓度（20–160%） | 光斑层整体 opacity |
| `--pride-saturation` | 饱和度（30–200%） | 光斑层 saturate 滤镜 |
| `--pride-glass-blur` | 毛玻璃强度（0–28px） | 卡片 backdrop-blur 半径 |

毛玻璃分层：`.bg-card`（55% + blur）、`.bg-background`（弹层，72% + blur+4px）、
`.bg-surface-hi`（60% 无模糊，控制合成层数量）；`.app-root` 页面容器透明让出背景，
**其余全屏浮层**（`.bg-surface` 但非 `.app-root`）改为磨砂
（`rgb(var(--c-surface-rgb) / 0.78)` + `blur(var(--pride-glass-blur) + 6px) saturate(1.1)`，
保证浮层上的文字可读）。所有规则都在 `.theme-pride` 作用域下，莫奈主题零影响；
**自定义背景图开启时**（`html.bg-image`）同一组毛玻璃规则以并列选择器生效
（莫奈 + 背景图的组合也获得毛玻璃，否则不透明卡片会把图片完全盖住）。

## 自定义背景图片（bgImage.ts）

「图片背景」预设（`huePreset = 'image'`）与组件外观的页面「图片」背景
（`customTheme` 当前模式 `page.image = true`）共用：背景层
（`body::before`）被图片**整体接管**——pride 渐变、凌晨极光、莫奈纯色均被覆盖，
没有与渐变的混合模式；色板（表面 / 强调 / 深色三个色相滑条）沿用莫奈逻辑，
`presetSpec` 对 'image' 走与 monet 相同的用户色相分支。接管规则置于全部渐变规则
之后，选择器用 `html:root.bg-image` / `html:root.dark.bg-image` 把特异性提到与
旗帜 / 深色微光规则同档，靠源顺序取胜。

- **参数全部走 CSS 变量**（`applyBgImage` 由 useStore 订阅 `syncModuleSettings`
  调用）：`--bg-image-url`（objectURL）/ `--bg-image-pos`（九宫 → object-position）/
  `--bg-image-blur` / `--bg-image-sat` / `--bg-image-dim` / `--bg-image-alpha`；
  深浅差异只在压暗加深——深色规则内 `brightness(calc(1 - dim * 1.5))`，JS 不感知深浅；
  透明度 = `alpha × --pride-breath`，**音量呼吸彩蛋零改动生效**（呼吸的激活条件是
  `huePreset === 'pride' || huePreset === 'image'`）；漂移复用 `pride-drift`
  （`bg-image-static` 单独关）。
- **存储管线**：`processImageFile` 经 `createImageBitmap` 降采样长边 ≤2048px、
  优先编码 WebP q0.8（不支持时回退 JPEG），数百 KB 级 Blob 存 IndexedDB kv
  （键 `bg-image`）；`loadBgImage` 启动异步预加载（main.tsx），就绪后经 opacity
  过渡淡入，首帧不等待。
- **备份**：ZIP 完整备份（手动 / 本地自动 / WebDAV 共用 `buildFullBackupZip`）
  打包 `bg-image/bg-image.{ext}` 条目，`importFullBackup` 恢复后立即生效；
  设置导出 JSON 只带参数不带图；GitHub 云备份暂不含背景图。
- **毛玻璃强度**共用 `prideGlassBlur` 设置；参数 UI 抽成 `BgImageControls`，
  在「图片背景」预设与组件外观的页面「图片」背景两种入口下复用同一份参数；
  后者用 compact 模式内联选图，焦点/模糊/压暗等折叠进「图片参数」。

## 自定义组件外观（customTheme.ts）

第四张预设卡「自定义」（`huePreset = 'custom'`）进入 `CustomThemePage` 子页，
在现有莫奈色板之上按**组件部位**覆盖样式；未修改的属性继续继承当前主题。

- **部位与挂接**：页面背景 `.app-root`、卡片 `.card-surface`、
  顶栏 / 底栏 `[data-theme-part="topbar"|"bottombar"]`、
  主按钮 `button.bg-accent`、文本输入 `input:not([type])…` / `textarea`、
  弹层 `[data-slot="dialog-content"]` 等。新增组件时优先加
  `data-theme-part`，不要为配色改组件自身的样式类。
- **外观页**：custom 预设下隐藏「主题色 / 强调色相 / 深色色相」三条基础
  色相滑条（颜色由组件外观接管），保留深浅模式、预设卡与声音染色；
  需要调基础色板时先切回莫奈 / 图片预设。
- **数据模型**：`CustomTheme { version: 1, light, dark }`，
  每个部位 `CustomPartStyle { bg, gradient, image, text, border, borderWidth,
  radius, blur, opacity }`；存 `AppSettings.customTheme`，随设置导出与
  `.svt-theme` 主题包往返，导入经 `normalizeCustomTheme` 白名单清洗
  （仅 hex 颜色、数值夹取范围）。
- **应用**：`applyCustomTheme` 生成 `<style id="svt-custom-theme">`，
  规则形如 `html:not(.dark) [data-theme-part="topbar"] { … !important }`；
  非 custom 预设或空主题时移除节点。首帧由 `main.tsx` 在 `applyTheme` 后同步应用。
- **对比度兜底**：只改背景未设文字色时，按 WCAG 亮度自动推导 `--c-ink` /
  `--c-ink-2`（亮底近黑、暗底近白）；卡片 / 弹层的 `--c-surface-hi` 与
  `--c-line` 也向背景混合，避免嵌套胶囊出现深底深字。主按钮额外推导
  `--c-on-accent`。显式文字色始终优先。
- **图片背景**：仅页面部位可选「图片」，复用 `bgImage` 的同一张图和参数
  （IndexedDB 单份存储）。`applyBgImage` 在 `huePreset='image'` 或
  custom 当前深浅模式的 `page.image` 为 true 时挂 `html.bg-image`；
  `app-root` 让出底色，由 `body::before` 铺图。
- **恢复**：单部位恢复删除该部位键；「全部恢复」清空 `customTheme`。
  自定义页有覆盖时在顶栏显示「全部恢复」图标（不悬浮在内容上遮挡滑条），
  避免把卡片改成低对比度后找不到出口。

## 氛围彩蛋（ambient.ts）

三个环境效果共享一个 20Hz 心跳（`startAmbientLoop`，App.tsx 模块级启动一次），
每 tick 读取 `recorder` 实时数据——录音（`isRecording()`）或监听练习
（`isMonitoring()`）时麦克风视为活跃，其余时刻不产生任何样式写入：

- **声音染色**（设置 → 外观 → 主题，`voiceTint`）：种子色相与强调色相同时
  替换为「染色值」——实时音高（80–400 Hz 对数映射）在蓝 255° → 粉 335° 弧上
  的位置经 EMA 平滑所得；明度 / 彩度规格沿用当前预设（`presetSpec().spec`），
  pride 渐变背景不受影响（走 CSS）。复用 `applyTheme` 写入，Canvas 图表随
  `app:themechange` 一同流动。性能设计：仅当色相变化越过 1.5°（最短弧）才
  重写令牌，平稳发声时几乎零样式开销；静音段保持色相（取最近 0.5s 内最后
  有声帧）；麦克风停止或开关关闭时恢复基准主题（同一 tick 内一次性）。
- **音量呼吸**（设置 → 外观 → 骄傲旗参数，`volumeBreath`）：按最新帧
  rmsDb（-50 → -10 dBFS 归一）快起慢落平滑后写 `--pride-breath`（1–1.5 倍率），
  CSS 中与 `--pride-glow` 相乘决定渐变层透明度（背景图主题下则乘在图片透明度上，
  另有 150ms transition 兜底平滑）；pride 渐变与自定义背景图两种主题下可见，
  退出活跃态时一次性复位为 1。
- **凌晨极光**：`watchAuroraHours` 在本地时间 3:00–4:59 给 `<html>` 加
  `aurora` 类（启动先判一次避免闪旗面 + 每分钟复查跨边界），index.css 中
  极光规则置于旗帜规则之后（同特异性靠源顺序取胜，深色单独一组），
  覆盖三旗渐变为极光配色。无设置项、无提示，只在深夜撞见。

## ⚠️ 已踩过的坑：backdrop-filter 与 fixed 包含块

**任何**带 `backdrop-filter`（或 transform / filter / perspective）的元素会成为
其后代 `position: fixed` 元素的包含块。`body` 在 base 层被
`@apply bg-background`，pride 的弹层毛玻璃规则曾因此误命中 body，导致：

- 底栏（fixed bottom-5）被定位到整个文档底部——长页面里"消失"；
- `body::before` 渐变层改为相对 body 定位，`inset: -12%` 撑出横向滚动。

规则现为 `.bg-background:not(body)`；`html/body` 另有 `overflow-x: clip` 兜底。
**教训**：给全局类名加 filter/backdrop-filter/transform 前，先确认它不会命中
`body` 或任何 fixed 元素的祖先。页面内 in-tree 的 fixed 元素（多选操作条等）
若未来出现定位异常，优先排查祖先链上的包含块触发者。

## 画布联动

Canvas 不感知 CSS 变量。`chartPalette()`（chartPainters）在读取时缓存调色板，
`app:themechange` 事件触发重建；语谱图 LUT（accentRamp）同理。新增主题相关
的 Canvas 颜色时，务必走 `chartPalette()` 而非直接 `getComputedStyle`。

**分享卡 PNG 的取色是唯一例外**：`lib/export/shareCard.ts` 的 `themed` 样式在
绘制时逐个 `getComputedStyle` 读取当前 `--c-*` 令牌（一次性读入绘制调色板，
非缓存），因此分享图实时跟随当前主题——包括声音染色驱动的色相流动。
另有 dark / light / aurora 三种固定风格（accent 仍取当前主题强调色）；样式在
`ShareCardSheet` 浮层选择并实时预览，每种样式的报告卡都带指向本仓库的二维码
（`uqr` 编码，模块色取当前样式 ink 色，深色样式输出反相码）。

## 首帧无闪烁

`main.tsx` 在 React 渲染前从 localStorage 读持久化设置（含旧版结构迁移）
计算 `presetSpec` 并 `applyTheme`；`index.css` 的 `:root` 保留一套 hue=15
的静态回退值兜底解析失败。
