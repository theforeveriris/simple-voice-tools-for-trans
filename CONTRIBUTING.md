# Contributing to Simple Voice Tool for Trans

Thanks for your interest in contributing! This document covers the basics. For architecture and deeper developer docs, see [documentation/DEVELOPMENT.md](documentation/DEVELOPMENT.md) (docs are written in Chinese).

English · 简体中文见下方摘要

## Project Overview

A voice measurement, analysis and training tracker built on the Web Audio API — React 19 + TypeScript + Vite, Capacitor 7 (Android) and Tauri 2 (Windows) shells, no backend, all data local.

## Getting Started

```bash
npm install      # install dependencies
npm run dev      # dev server
npm test         # vitest suite (DSP golden fixtures / export / backup / LLM / i18n integrity …)
npm run lint     # eslint
npm run build    # tsc -b && vite build
```

No microphone needed to explore: append `?demo=1` to any page URL, or use the "load demo data" buttons in history / analysis / settings.

> The build output goes to `docs/` (gitignored). Pushes to `main` are built and deployed to GitHub Pages automatically by GitHub Actions — never commit build output.

## How to Contribute

### Reporting bugs

Open a [GitHub Issue](https://github.com/theforeveriris/simple-voice-tools-for-trans/issues) and include:

- Platform (PWA / Android / Windows) and browser or OS version
- Steps to reproduce, expected vs. actual behavior
- Console errors if any (do **not** attach audio recordings or personal data)

### Suggesting features

Issues with a clear use case are welcome. This app intentionally keeps everything local and privacy-preserving — proposals that require a backend or sending user data off-device are unlikely to be accepted.

### Pull requests

1. Fork the repo and create a branch from `main`
2. Keep changes focused — one PR per feature/fix
3. Run `npm run lint` and `npm test` before pushing; CI must pass
4. Write clear commit messages (present tense, e.g. "add CPPS y-axis option to trend view")
5. If your change affects user-facing text, update all relevant i18n entries (en, zh-CN, zh-TW, ja, es, fr, bo, lzh) — there is an i18n integrity test that guards this

### Areas that especially welcome help

- Translations (including reviewing the machine-translated ja/es/fr entries)
- Documentation (especially English versions of the Chinese docs in `documentation/`)
- Algorithm improvements — pitch (YIN), formants (LPC), voice quality (Jitter/Shimmer/HNR/CPPS); cross-validation against Praat is supported via the export bridge
- Tests (vitest unit tests, Playwright e2e under `e2e/`)

## Code Style

- TypeScript strict; follow the existing ESLint config (`eslint.config.js`)
- State via Zustand; records & audio persist in IndexedDB
- Charts are hand-drawn Canvas 2D (no chart library) — follow the existing drawing modules
- UI copy goes through the i18n system, never hardcoded strings
- Documentation lives in `documentation/`; do not confuse it with `docs/` (build output)

## Privacy & Data

- Never commit test recordings, API keys, or user data
- AI/LLM-related code must keep the existing guarantees: only aggregate statistics leave the device, keys stay in local IndexedDB, and payloads remain inspectable in Settings → Data → Data destination

## License

By contributing, you agree that your contributions are licensed under the same license as the project ([LICENSE](LICENSE)).

---

## 简体中文摘要

- **环境**:`npm install` → `npm run dev`;测试 `npm test`,检查 `npm run lint`,构建 `npm run build`(输出到被 gitignore 的 `docs/`,请勿提交)
- **体验 Demo**:任意页面 URL 加 `?demo=1`,无需麦克风
- **Issue**:附上平台(PWA/Android/Windows)、复现步骤、控制台报错;请勿附带录音或个人数据
- **PR**:从 `main` 拉分支,一个 PR 一个主题;推送前跑通 lint 与测试;涉及界面文案需同步全部语言条目(有 i18n 完整性测试把关)
- **欢迎方向**:翻译校对、英文文档、算法改进(YIN/LPC/Jitter/Shimmer/HNR/CPPS,可用 Praat 互导验证)、单元与 e2e 测试
- **隐私红线**:不提交录音/API Key/用户数据;LLM 相关改动必须保持"只上传聚合统计、密钥只存本地、载荷可检查"
- 开发者文档(中文)见 [documentation/DEVELOPMENT.md](documentation/DEVELOPMENT.md)
