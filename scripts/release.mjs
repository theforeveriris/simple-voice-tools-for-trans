/**
 * 发布脚本：一条命令完成版本号更新 + 变更日志收集 + git tag。
 *
 * 用法：
 *   node scripts/release.mjs 0.10.0            # 显式指定版本号
 *   node scripts/release.mjs minor             # 自动 bump minor（0.9.3 → 0.10.0）
 *   node scripts/release.mjs patch             # 自动 bump patch（0.9.3 → 0.9.4）
 *
 * 步骤：
 *   1. 校验工作区干净、在 main 分支；
 *   2. 同步版本号：package.json / package-lock.json / src-tauri/tauri.conf.json
 *      （Android 的 versionName/versionCode 由 build.gradle 从 package.json 派生，
 *      Cargo.toml 未跟随应用版本——三处即全部）；
 *   3. 汇总自上个 tag 以来的提交，生成 fastlane changelog 草稿
 *      （en-US + zh-CN，仅输出待你编辑，不自动定稿）；
 *   4. 创建提交 `release: v{version}` 与 tag `v{version}`（不推送，最后一步自行 git push --tags）。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const APP_NAME = 'simple-voice-tools-for-trans';
const CHANGELOG_DIR = 'fastlane/metadata/android';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function bump(version, kind) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
  return null;
}

// ---------- 参数 ----------
const arg = process.argv[2];
if (!arg) fail('用法：node scripts/release.mjs <x.y.z | major | minor | patch>');

// ---------- 前置校验 ----------
const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') fail(`当前分支 ${branch}，请在 main 上发布`);
const status = sh('git status --porcelain');
if (status) fail('工作区不干净，先提交或暂存：\n' + status);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const from = pkg.version;
const to = /^\d+\.\d+\.\d+$/.test(arg) ? arg : bump(from, arg);
if (!to) fail(`无法从 ${from} 推导目标版本（参数：${arg}）`);
if (to === from) fail(`目标版本与当前相同（${from}）`);

// 上个 tag（不存在时取全部历史）
let lastTag = '';
try { lastTag = sh('git describe --tags --abbrev=0'); } catch { /* 首个发布 */ }
const logRange = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const commits = sh(`git log ${logRange} --format=%s`).split('\n').filter(Boolean);

// ---------- 1. 版本号同步 ----------
const setJsonVersion = (file, version) => {
  const text = readFileSync(file, 'utf8');
  // 只替换首个 "version" 字段（package.json 顶层 / tauri.conf.json 顶层）；
  // package-lock.json 替换前两处（根 version + packages."" version）
  const isLock = file.includes('package-lock');
  const re = /"version":\s*"[^"]+"/;
  let count = isLock ? 2 : 1;
  const out = text.replace(re, () => (count-- > 0 ? `"version": "${version}"` : '"version": "' + version + '"'));
  writeFileSync(file, out, 'utf8');
};
setJsonVersion('package.json', to);
setJsonVersion('package-lock.json', to);
setJsonVersion('src-tauri/tauri.conf.json', to);
console.log(`✓ 版本号：${from} → ${to}（package.json / package-lock.json / tauri.conf.json）`);

// ---------- 2. fastlane changelog 草稿 ----------
// versionCode 口径与 build.gradle 一致：major*10000 + minor*100 + patch
const [maj, min, pat] = to.split('.').map(Number);
const versionCode = maj * 10000 + min * 100 + pat;
const draftEn = commits.map((c) => `- ${c}`).join('\n');
const draftZh = commits.map((c) => `- ${c}`).join('\n');
for (const [locale, body] of [['en-US', draftEn], ['zh-CN', draftZh]]) {
  const dir = `${CHANGELOG_DIR}/${locale}/changelogs`;
  const file = `${dir}/${versionCode}.txt`;
  if (existsSync(file)) fail(`${file} 已存在（版本号冲突？）`);
  writeFileSync(file, `DRAFT - edit before tagging:\n${body}\n`, 'utf8');
}
console.log(`✓ changelog 草稿：${CHANGELOG_DIR}/{en-US,zh-CN}/changelogs/${versionCode}.txt（编辑后再提交）`);

// ---------- 3. 提交 + tag ----------
sh('git add package.json package-lock.json src-tauri/tauri.conf.json');
sh(`git commit -m "release: v${to}"`);
sh(`git tag "v${to}"`);
console.log(`✓ 提交与 tag v${to} 已创建（未推送）`);
console.log('');
console.log('接下来：');
console.log(`  1. 编辑 ${CHANGELOG_DIR}/{en-US,zh-CN}/changelogs/${versionCode}.txt（去掉 DRAFT 行、写成面向用户的文案）并提交；`);
console.log('  2. git push && git push --tags   # 推送后 CI 出三端产物（见 .github/workflows）；');
console.log('  3. 确认产物无误后把 changelog 定稿随 release 发布。');
