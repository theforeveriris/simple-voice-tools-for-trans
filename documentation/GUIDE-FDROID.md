# F-Droid 收录与维护指南

收录申请已于 2026-11-17 合并（[MR !57818](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/57818)，维护者
linsui）。应用包名 `com.theforeveriris.simplevoicetool`，当前版本 0.11.3 /
versionCode 1103。

本文记录收录全过程踩到的坑与长期维护要点。构建侧的改造（Gradle 自举 web
构建等）见 [GUIDE-CAPACITOR.md](./GUIDE-CAPACITOR.md) 的 F-Droid 小节。

## 收录模型

F-Droid 主仓库 = [fdroiddata](https://gitlab.com/fdroid/fdroiddata) 里的一份
metadata YAML + **从源码构建**。收录流程：

1. 向 fdroiddata 提交 `metadata/<applicationId>.yml`（MR，需维护者人工 review）
2. 维护者触发 CI：9 个检查 job（见下文）
3. 合并后，F-Droid 构建服务器按周期构建并进入主仓库索引
4. 之后靠 metadata 的 `AutoUpdateMode` / `UpdateCheckMode` **自动**跟进新版本，
   不再需要 MR

关键机制——**可复现构建 + Binaries**：metadata 里 `Binaries:` 指向 GitHub
Release 的官方签名 APK，`AllowedAPKSigningKeys` 声明签名密钥指纹。F-Droid
构建出的未签名 APK 与 Binaries 的 APK 逐字节比对，一致则**用开发者的签名**
发布——用户因此在 F-Droid 与 GitHub 两个渠道间可无缝覆盖升级。

## 仓库内与本主题相关的文件

| 文件 | 职责 |
|---|---|
| `fdroid/F-Droid-Metadata.yml` | 提交到 fdroiddata 时改名 `metadata/<applicationId>.yml` |
| `android/settings.gradle` | settings 求值期自举 `npm ci`（node_modules 缺失时） |
| `android/app/build.gradle` | `buildWebAssets` → `capCopy` → `pruneWebAssets` 任务链 + `resolveSourceDateEpoch` |
| `android/capacitor-cordova-android-plugins/` | `cap sync` 生成的模块，源文件入库（F-Droid 不跑 cap sync） |
| `scripts/prune-android-assets.mjs` | 裁剪 web-only 资源（由 `pruneWebAssets` 调用） |
| `vite.config.ts` | `SOURCE_DATE_EPOCH` 消费 + `version.json` 输出 versionCode |

## metadata 字段规范与陷阱

### 必填字段

`Categories`、`License`、`Builds`、`AutoUpdateMode`、`UpdateCheckMode`、
`CurrentVersion`、`CurrentVersionCode`——缺一即挂 schema 校验。

### 字段名拼写

**`WebSite`（大写 S）**，不是 `Website`。fdroid lint 只报
`Unrecognised app field`，报错不会告诉你正确拼写。

### `RepoType: git` 必需

没有它 `fdroid build` 直接抛 `Invalid vcs type`。

### `commit` 必须是完整 40 位 hash

tag、短 hash 都不行。

### `gradle:` 的 `yes` 不加引号

CI 的 schema 校验（check-jsonschema）按 YAML 1.2 语义解析，裸 `yes` 是字符
串，通过；本地用 PyYAML（YAML 1.1）验证会把 `yes` 读成布尔值 `true`，造成
**假阳性**——以为要加引号，加了反而挂 rewritemeta。验证请用 CI 同款工具：

```bash
pip install check-jsonschema
python -m check_jsonschema --schemafile schemas/metadata.json metadata/<appid>.yml
```

### `subdir` 的语义

「**build 目录会在哪里生成**」，不是「源码在哪」。Gradle 会从该目录向上查找
`settings.gradle`，所以多模块项目填**模块目录**即可：

```yaml
subdir: android/app    # APK 落在 android/app/build/outputs/apk/release
```

这正好是 fdroidserver 默认查找路径 `<subdir>/build/outputs/apk/release`，
因此 **`output` 字段不需要写**。

### `AllowedAPKSigningKeys` 格式

小写 64 位 hex、**无冒号**。`keytool -printcert` 输出的是冒号分隔大写，要转换：

```bash
keytool -printcert -jarfile app.apk | grep SHA256
# 48:79:17:C6:... → 487917c6...
```

### `Binaries` 用 `%v` 占位

```yaml
Binaries:
  https://github.com/<owner>/<repo>/releases/download/v%v/<name>-v%v-release.apk
```

`%v` = versionName。配合自动更新，新版本的 URL 自动跟随，不用手动改。

## rewritemeta：逐字节一致

CI 的 rewritemeta job = `fdroid rewritemeta <appid>` + `git diff --exit-code`，
即 metadata 必须与 fdroidserver 的输出**逐字节一致**。要点：

- **注释全部被剥掉**——别指望注释能留在文件里
- 字段顺序由 fdroidserver 的 `yaml_app_field_order` 决定；
  `AutoUpdateMode` / `UpdateCheckMode` / `CurrentVersion*` 排在 `Builds` **之后**，
  `Binaries` 紧跟 `Repo`
- `Categories` 按字母序重排
- 单元素脚本字段会被折叠成标量：`init:` 列表 → `init: cmd`
- **行宽陷阱**：ruamel 的折行对行长敏感，且本地 pip 装的 fdroidserver 与 CI 的
  （fdroidserver master）行为不同——实测 87 字符的 `IssueTracker` 行本地折行、
  CI 不折。**不要自己猜格式**
- `AutoName` 会被 CI 侧自动补上（从上游仓库读应用名）

### 正确姿势

CI 失败时，失败 job 会把修正后的文件上传到 `tmp/` artifact：

```
GET /projects/<id>/jobs/<job_id>/artifacts   # 解压取 tmp/<appid>.yml
```

**直接提交 CI 产出的文件**，不要自己改。或者本地装 fdroidserver 预校验
（注意 CI 用的是 fdroidserver master，本地 pip 版本可能落后）：

```bash
pip install fdroidserver
python -m fdroidserver rewritemeta <appid>
```

## 可复现构建

### 三条铁律（每条都真实失败过一次）

1. **web 产物必须在 Gradle 内构建**。`vite.config.ts` 会把构建时间戳写进
   产物；如果在 Gradle 之外（如 CI 里）预构建，时间戳就是墙钟时间，
   F-Droid 构建出的产物与你上传的 APK 必然不同。
2. **时间戳必须取自 git 提交时间**，不是墙钟。`build.gradle` 的
   `resolveSourceDateEpoch` 优先读 `SOURCE_DATE_EPOCH` 环境变量，缺失时用
   `git log -1 --format=%ct`——同一提交在任何机器上都得到相同值。
3. **裁剪（prune）必须在构建内**。CI 裁剪、F-Droid 不裁剪 → 文件集不同 →
   比对失败。`pruneWebAssets` 任务在 Gradle 内跑
   `scripts/prune-android-assets.mjs`。

### 验证方法

同一提交、两次完全干净的构建（删 `docs/`、`assets/public/`、`build/`），
比对未签名 APK 的 SHA-256：

```bash
# 两次都应输出相同 hash（0.11.3 实测 3,097,454B 签名版 / 本地未签名一致）
./gradlew assembleRelease --no-daemon
```

### 残余风险

GitHub CI（Node 22）与 F-Droid 构建机（Debian trixie 的 Node 20.19）Node
版本不同。目前 vite 产物一致（bundle 内容只差内嵌时间戳，已统一）；若未来
升级构建工具导致两边产物分叉，在 metadata 的 `sudo` 里把 Node 固定到与 CI
相同的版本。

## check apk：签名块审计

`check apk` job 会扫 Binaries 指向的 APK 的**签名块**。AGP 默认往里写一个
`DependencyInfoBlock`（块 ID `0x504B4453`）——内容经 Google 公钥加密、任何人
无法审计，F-Droid 拒绝收录。关闭：

```groovy
android {
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}
```

注意：该块**只在签名后存在**，本地未签名的构建产物验证不了，必须用发布
APK 检查。合法的签名块 ID（0.11.3 实测）：

```
0x7109871A  APK Signature Scheme v2
0x42726577  Verity padding
```

签名块解析器（node，直接可跑）：

```js
const b = fs.readFileSync(apk);
// 找 EOCD → CD offset → 检查 CD 前是否为 "APK Sig Block 42" → 逐对读块 ID
```

## 自动更新机制与发版流程

### 为什么用 HTTP 而不是 Tags

`UpdateCheckMode: Tags` 依赖静态解析 `build.gradle` 里的 `versionCode` 字面量，
而本项目的 versionCode 是 Gradle 从 package.json **计算**出来的
（`major*10000 + minor*100 + patch`），实测 `fdroid checkupdates` 报
`Couldn't find any version information`。

解法：`vite.config.ts` 把同一公式算出的 versionCode 写进 `docs/version.json`
（部署到 GitHub Pages），metadata 用 HTTP 模式读它：

```yaml
UpdateCheckMode: HTTP
UpdateCheckData:
  https://theforeveriris.github.io/simple-voice-tools-for-trans/version.json|"versionCode":\s*(\d+)|.|"version":\s*"([^"]+)"
AutoUpdateMode: Version v%v
```

### 发版流程（无需 MR）

```bash
# 1. bump package.json 的 version（versionCode 与 version.json 自动跟随）
# 2. 提交并打 tag（tag 格式必须是 vX.Y.Z，AutoUpdateMode 靠它定位 commit）
git tag v0.12.0 && git push origin v0.12.0
# 3. 完成
```

F-Droid 侧自动发生：

1. GitHub Actions 出签名 APK 并挂到 Release（`Binaries` 的 `%v` 自动对应）
2. Deploy 工作流更新 Pages 上的 `version.json`
3. `checkupdates` bot 检测到新 versionCode，**自动提交** metadata 的 Builds 条目
4. 构建服务器构建 → 与 Binaries 比对 → 用你的签名发布

通常 1～2 天后 F-Droid 客户端可收到更新。

### 什么时候才需要 MR

- 下架应用
- 改 metadata 本身（分类、许可证、描述类字段）
- 自动更新链路坏了（见下文排查）

## CI 触发的坑

**fork 分支推送不会触发上游 MR pipeline**——只会触发 fork 自己的流水线，
而它是 **0 个 job、立即失败**（fdroiddata 的 CI 配置只为上游项目上下文创建
job）。这是环境性失败，可忽略；真正的检查需要维护者手动触发。

给维护者留言时直接报 commit hash，例如：

> Could you re-trigger the pipeline for `312b066f`?

## 本地验证工具箱

```bash
pip install fdroidserver check-jsonschema

# metadata 所在目录需为 git 仓库（checkupdates 会跑 git status）
# layout: metadata/<appid>.yml + 空 config.yml
python -m fdroidserver rewritemeta <appid>          # 格式
python -m check_jsonschema --schemafile schemas/metadata.json metadata/<appid>.yml
python -m fdroidserver checkupdates <appid>         # 会克隆上游仓库，较慢
```

其他实用命令：

```bash
# 验证发布 APK 的签名证书（无需 keystore 密码）
keytool -printcert -jarfile app.apk

# 下载 CI 失败 job 的产物（rewritemeta 修正后的文件在 tmp/ 下）
gh api /projects/<id>/jobs/<job_id>/artifacts > artifact.zip

# CI 的 schema 定义
https://gitlab.com/fdroid/fdroiddata/-/raw/master/schemas/metadata.json
```

## 历史案例：0.11.0 → 0.11.3

| 版本 | 修复 |
|---|---|
| 0.11.1 | 返回手势退出应用（补 `@capacitor/app` 监听）；R8；可复现构建基础 |
| 0.11.2 | web 产物统一进 Gradle 构建（修 builtAt 墙钟时间与文件集差异） |
| 0.11.3 | 移除签名块的 DependencyInfoBlock |

每轮都是 CI 失败日志直接指向根因，本地复现验证后才发版——**没有靠猜**。
这套「CI 失败 → 读 trace → 本地复现 → 修复 → 发版」的循环平均一轮 30 分钟。

## 排查速查表

| 失败 job | 常见原因 | 处理 |
|---|---|---|
| schema validation | 缺必填字段；`yes` 加了引号 | 按 `schemas/metadata.json` 补齐；`yes` 不加引号 |
| fdroid lint | 字段名拼写（`WebSite`）；缺 `RepoType` | 见上文 |
| fdroid rewritemeta | 格式与 canonical 不一致 | 用 CI tmp/ artifact 提交 |
| checkupdates | 自动更新链路断（version.json 缺 versionCode、tag 未打） | 检查 Pages 部署与 tag |
| fdroid build（构建失败） | node_modules 二进制被扫描（缺 prune/误加 init）；依赖缺失 | 看 trace 里的 scanner 段 |
| fdroid build（比对失败） | 产物不可复现 | 检查是否在 Gradle 外预构建 web、prune 是否在构建内 |
| check apk | DependencyInfoBlock / 非自由类 | `dependenciesInfo` 关闭；扫描 dex 找来源 |
