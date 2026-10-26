/**
 * 应用标识（导出/备份/分享文件里的 "app" 字段值）
 *
 * 项目改名：simple-voice-tools → simple-voice-tools-for-trans。
 * 旧标识仍在流通（历史导出文件、已分享的模板/主题/词典包），
 * 因此读取端一律「兼容旧名」，写入端一律写新名。
 */

/** 当前应用标识（新写入一律用它） */
export const APP_ID = 'simple-voice-tools-for-trans';

/** 历史应用标识（只读兼容，不再写出） */
export const LEGACY_APP_IDS = ['simple-voice-tools'] as const;

/** 是否为本应用的合法 app 标识（新名 + 历史旧名） */
export function isKnownAppId(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value === APP_ID || (LEGACY_APP_IDS as readonly string[]).includes(value);
}
