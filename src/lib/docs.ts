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
  /** 开发者文档分组（仅 DEV_DOCS 使用） */
  group?: DocGroup;
}

/** 开发者文档分组：关于页按此顺序拆成独立卡片块展示 */
export type DocGroup = 'start' | 'architecture' | 'parameters' | 'algorithms' | 'guides' | 'format';

export interface DocSection {
  key: string;
  titleKey: DictKey;
  groups: DocGroup[];
}

export const DEV_DOC_SECTIONS: DocSection[] = [
  { key: 'dev', titleKey: 'settings.docSectionDev', groups: ['start', 'architecture', 'parameters'] },
  { key: 'algorithms', titleKey: 'settings.docSectionAlgorithms', groups: ['algorithms'] },
  { key: 'guides', titleKey: 'settings.docSectionGuides', groups: ['guides', 'format'] },
];

/** 面向使用者的文档 */
export const USER_DOCS: DocEntry[] = [
  { file: 'PARAMETERS-GUIDE.md', titleKey: 'settings.docGuideTitle', descKey: 'settings.docGuideDesc' },
  { file: 'REFERENCES.md', titleKey: 'settings.docRefsTitle', descKey: 'settings.docRefsDesc' },
];

/** 开发者文档（算法与架构） */
export const DEV_DOCS: DocEntry[] = [
  { file: 'DEVELOPMENT.md', titleKey: 'settings.docDevTitle', descKey: 'settings.docDevDesc', group: 'start' },
  { file: 'ARCHITECTURE-I18N.md', titleKey: 'settings.docI18nTitle', descKey: 'settings.docI18nDesc', group: 'architecture' },
  { file: 'ARCHITECTURE-THEME.md', titleKey: 'settings.docThemeTitle', descKey: 'settings.docThemeDesc', group: 'architecture' },
  { file: 'ARCHITECTURE-STATE.md', titleKey: 'settings.docStateTitle', descKey: 'settings.docStateDesc', group: 'architecture' },
  { file: 'ARCHITECTURE-SETTINGS.md', titleKey: 'settings.docSettingsTitle', descKey: 'settings.docSettingsDesc', group: 'architecture' },
  { file: 'ARCHITECTURE-AI-ASSISTANT.md', titleKey: 'settings.docAiArchTitle', descKey: 'settings.docAiArchDesc', group: 'architecture' },
  { file: 'PARAMETERS-AI-ASSISTANT.md', titleKey: 'settings.docAiParamsTitle', descKey: 'settings.docAiParamsDesc', group: 'parameters' },
  { file: 'ALGORITHM-YIN.md', titleKey: 'settings.docYinTitle', descKey: 'settings.docYinDesc', group: 'algorithms' },
  { file: 'ALGORITHM-FORMANT-LPC.md', titleKey: 'settings.docLpcTitle', descKey: 'settings.docLpcDesc', group: 'algorithms' },
  { file: 'ALGORITHM-VOICE-EXPRESSION.md', titleKey: 'settings.docVfpTitle', descKey: 'settings.docVfpDesc', group: 'algorithms' },
  { file: 'ALGORITHM-VOWEL.md', titleKey: 'settings.docVowelTitle', descKey: 'settings.docVowelDesc', group: 'algorithms' },
  { file: 'ALGORITHM-ENERGY.md', titleKey: 'settings.docEnergyTitle', descKey: 'settings.docEnergyDesc', group: 'algorithms' },
  { file: 'ALGORITHM-CPPS.md', titleKey: 'settings.docCppsTitle', descKey: 'settings.docCppsDesc', group: 'algorithms' },
  { file: 'GUIDE-PWA.md', titleKey: 'settings.docPwaTitle', descKey: 'settings.docPwaDesc', group: 'guides' },
  { file: 'GUIDE-CAPACITOR.md', titleKey: 'settings.docCapacitorTitle', descKey: 'settings.docCapacitorDesc', group: 'guides' },
  { file: 'GUIDE-DESKTOP.md', titleKey: 'settings.docDesktopTitle', descKey: 'settings.docDesktopDesc', group: 'guides' },
  { file: 'RECORDS-FORMAT.md', titleKey: 'settings.docRecordsTitle', descKey: 'settings.docRecordsDesc', group: 'format' },
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
