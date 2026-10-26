import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 安卓壳配置（documentation/GUIDE-CAPACITOR.md）
 * webDir 指向 Vite 构建产物（npm run build 先行，再 npx cap sync android）。
 */
const config: CapacitorConfig = {
  appId: 'com.theforeveriris.simplevoicetool',
  appName: 'Simple Voice Tool for Trans',
  webDir: 'docs',
  android: {
    // Android 15 强制 edge-to-edge：内容自动避开状态栏/手势条，Web 端 CSS 无需改动
    adjustMarginsForEdgeToEdge: 'auto',
  },
};

export default config;
