/**
 * 应用内文档注册表
 * documentation/*.md 以 Vite 的 import.meta.glob(?raw) 懒加载：每份文档单独成 chunk，
 * 只有打开时才下载（节约首屏体积）；离线可用（打包进 app，原生壳与 PWA 一致）。
 * 使用说明 guide.md 与隐私政策 privacy-policy.md 位于 public/，随站点发布并进
 * Service Worker 预缓存，按 fetch 读取。
 */

import type { DictKey } from '@/i18n';

export interface DocEntry {
  /** documentation/ 下的文件名 */
  file: string;
  titleKey: DictKey;
  descKey: DictKey;
  /** 来源：repo（documentation/ 源文件）| public（public/ 站点文件） */
  source?: 'repo' | 'public';
}

/** 面向使用者的文档 */
export const USER_DOCS: DocEntry[] = [
  { file: 'PARAMETERS-GUIDE.md', titleKey: 'settings.docGuideTitle', descKey: 'settings.docGuideDesc' },
  { file: 'REFERENCES.md', titleKey: 'settings.docRefsTitle', descKey: 'settings.docRefsDesc' },
];

/** 开发者文档（算法与架构） */
export const DEV_DOCS: DocEntry[] = [
  { file: 'DEVELOPMENT.md', titleKey: 'settings.docDevTitle', descKey: 'settings.docDevDesc' },
  { file: 'ARCHITECTURE-I18N.md', titleKey: 'settings.docI18nTitle', descKey: 'settings.docI18nDesc' },
  { file: 'ARCHITECTURE-THEME.md', titleKey: 'settings.docThemeTitle', descKey: 'settings.docThemeDesc' },
  { file: 'ARCHITECTURE-STATE.md', titleKey: 'settings.docStateTitle', descKey: 'settings.docStateDesc' },
  { file: 'ARCHITECTURE-SETTINGS.md', titleKey: 'settings.docSettingsTitle', descKey: 'settings.docSettingsDesc' },
  { file: 'RECORDS-FORMAT.md', titleKey: 'settings.docRecordsTitle', descKey: 'settings.docRecordsDesc' },
  { file: 'GUIDE-PWA.md', titleKey: 'settings.docPwaTitle', descKey: 'settings.docPwaDesc' },
  { file: 'GUIDE-CAPACITOR.md', titleKey: 'settings.docCapacitorTitle', descKey: 'settings.docCapacitorDesc' },
  { file: 'GUIDE-DESKTOP.md', titleKey: 'settings.docDesktopTitle', descKey: 'settings.docDesktopDesc' },
  { file: 'ALGORITHM-YIN.md', titleKey: 'settings.docYinTitle', descKey: 'settings.docYinDesc' },
  { file: 'ALGORITHM-FORMANT-LPC.md', titleKey: 'settings.docLpcTitle', descKey: 'settings.docLpcDesc' },
  { file: 'ALGORITHM-ENERGY.md', titleKey: 'settings.docEnergyTitle', descKey: 'settings.docEnergyDesc' },
  { file: 'ALGORITHM-CPPS.md', titleKey: 'settings.docCppsTitle', descKey: 'settings.docCppsDesc' },
];

/** 站点文档（public/ 下，fetch 读取；离线由 SW 预缓存保证） */
export const PUBLIC_DOCS = {
  guide: { file: 'guide.md', titleKey: 'settings.guideTitle' as DictKey },
  privacy: { file: 'privacy-policy.md', titleKey: 'settings.privacyPolicy' as DictKey },
};

/** 懒加载器表：键为 documentation/ 下的相对路径 */
const RAW = import.meta.glob('../../documentation/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/** 读取 documentation/ 下的文档全文 */
export function loadDoc(file: string): Promise<string> {
  const loader = RAW[`../../documentation/${file}`];
  if (!loader) return Promise.reject(new Error(`documentation not bundled: ${file}`));
  return loader();
}

/** 读取 public/ 下的站点文档（guide / privacy policy） */
export async function loadPublicDoc(file: string): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}${file}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** 文档在 GitHub 仓库中的地址（应用内查看之外的「看源文件」入口） */
export function docGithubUrl(file: string): string {
  return `https://github.com/theforeveriris/simple-voice-tools-for-trans/blob/main/documentation/${file}`;
}
