/**
 * 完整备份（ZIP，含录音音频）
 * 结构：
 *   records.json        与「导出 JSON」完全相同的格式（records 数组）
 *   audio/{id}.{ext}    录音音频（扩展名由 blob.type 映射）
 * 恢复时按 id 去重合并记录，音频仅挂载到已存在的记录上。
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { idbGetKV, idbPutAudio } from '@/lib/storage/idb';
import { BG_IMAGE_KV, saveBgImage } from '@/lib/theme/bgImage';
import { useHistoryStore } from '@/store/useHistoryStore';
import { audioMimeOf, downloadBlob } from '@/lib/file';
import { isEncryptedBackup } from '@/lib/backup/crypto';
import { t } from '@/i18n';
import { APP_ID } from '@/lib/appId';
import type { AnalysisRecord } from '@/types';

const JSON_NAME = 'records.json';
/** 背景图片在 ZIP 内的目录前缀（单文件 bg-image/bg-image.{ext}） */
const BG_IMAGE_DIR = 'bg-image/';

/** 备份/导出 JSON 的当前格式版本 */
export const BACKUP_FORMAT_VERSION = 2;

export interface RecordsPayload {
  app: string;
  version: number;
  exportedAt: string;
  records: AnalysisRecord[];
}

/** 组装备份/导出 JSON（手动导出、ZIP 备份、GitHub 备份共用，版本号单一来源） */
export function buildRecordsPayload(records: AnalysisRecord[]): RecordsPayload {
  return {
    app: APP_ID,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    records,
  };
}

/**
 * 解析并校验备份/导出 JSON 中的记录数组。
 * 接受当前版本（2）与历史版本（1、裸数组）；显式拒绝更新的版本，
 * 避免旧应用在格式变更后静默错读新备份。
 * @throws JSON 非法、缺少 records 数组或版本过新时抛出带本地化文案的 Error
 */
export function parseRecordsPayload(json: string): { records: AnalysisRecord[]; version: number | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(t('backup.errJsonParse'));
  }
  // 最早期的导出是裸 records 数组，继续接受
  if (Array.isArray(parsed)) return { records: parsed as AnalysisRecord[], version: null };
  const obj = parsed as { version?: unknown; records?: unknown } | null;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.records)) {
    throw new Error(t('backup.errBadPayload'));
  }
  const version = typeof obj.version === 'number' ? obj.version : null;
  if (version != null && version > BACKUP_FORMAT_VERSION) {
    throw new Error(t('backup.errVersionTooNew', { version }));
  }
  return { records: obj.records as AnalysisRecord[], version };
}

/** 音频 Blob 类型 → 备份文件扩展名 */
export function extFor(blob: Blob): string {
  const t = blob.type || '';
  if (t.includes('webm')) return '.webm';
  if (t.includes('mp4')) return '.m4a';
  if (t.includes('ogg')) return '.ogg';
  if (t.includes('wav')) return '.wav';
  if (t.includes('webp')) return '.webp';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('png')) return '.png';
  return '.bin';
}

/** 背景图片扩展名 → MIME（恢复时重建 Blob 用） */
function imageMimeOf(name: string): string {
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

export interface FullBackupZip {
  blob: Blob;
  /** 打包的记录条数 */
  records: number;
  /** 打包的音频条数 */
  audio: number;
  /** 建议的文件名（按天命名，自动备份同日覆盖） */
  filename: string;
  /** 内容指纹（记录 + 音频清单，不含每次打包都变的导出时间戳）：据此跳过无变化上传 */
  sha256: string;
}

/**
 * 打包完整备份为 Blob（不触发下载，供手动导出与本地自动备份共用）
 * 记录取自 IndexedDB 全量（界面列表有 200 条截断，直接读内存会漏掉更早的记录）
 * @returns 无记录时返回 null
 */
export async function buildFullBackupZip(): Promise<FullBackupZip | null> {
  const store = useHistoryStore.getState();
  const records = await store.getAllRecords();
  if (records.length === 0) return null;

  const payload = buildRecordsPayload(records);
  // 音频已是压缩编码（Opus/AAC），只对 JSON 做压缩，音频用 store 直存省 CPU
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [JSON_NAME]: [strToU8(JSON.stringify(payload)), { level: 6 }],
  };
  // 内容指纹的音频清单：用「id / 字节数 / 类型」概括，不重复哈希全部音频
  const audioInv: string[] = [];
  let audio = 0;
  for (const rec of records) {
    const blob = await store.getAudio(rec.id);
    if (!blob) continue;
    files[`audio/${rec.id}${extFor(blob)}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    audioInv.push(`${rec.id}:${blob.size}:${blob.type}`);
    audio++;
  }
  // 自定义背景图（数百 KB 级，直存）
  const bg = await idbGetKV<Blob>(BG_IMAGE_KV);
  let bgInv = '';
  if (bg) {
    files[`${BG_IMAGE_DIR}bg-image${extFor(bg)}`] = [new Uint8Array(await bg.arrayBuffer()), { level: 0 }];
    bgInv = `${bg.size}:${bg.type}`;
  }
  const zipped = zipSync(files);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    blob: new Blob([zipped], { type: 'application/zip' }),
    records: records.length,
    audio,
    filename: `voice-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.zip`,
    /**
     * 内容指纹：只覆盖内容本身（记录 + 音频清单 + 背景图清单）。
     * 不能拿 zipSync 产物算——负载里的 exportedAt 每次打包都变，
     * 字节级哈希永不相等，「内容未变化则跳过上传」就永远不成立。
     */
    sha256: await sha256Hex(strToU8(JSON.stringify({ records, audio: audioInv, bg: bgInv }))),
  };
}

/** 字节 → SHA-256 hex（WebCrypto；不可用时返回空串，调用方跳过指纹比较） */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  if (!crypto?.subtle) return '';
  const buf = new Uint8Array(data.length);
  buf.set(data);
  const digest = await crypto.subtle.digest('SHA-256', buf.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 打包并下载完整备份
 * @returns 导出的记录条数与音频条数
 */
export async function exportFullBackup(): Promise<{ records: number; audio: number }> {
  const built = await buildFullBackupZip();
  if (!built) return { records: 0, audio: 0 };
  downloadBlob(built.filename, built.blob);
  return { records: built.records, audio: built.audio };
}

export interface BackupImportResult {
  /** 新合并入的记录条数（不含已存在的） */
  records: number;
  /** 挂载的音频条数 */
  audio: number;
}

/**
 * 解析 ZIP 备份的结构（不落库）：恢复预览用。
 * @throws 与 importFullBackup 同口径（非 zip / 无 records.json / 版本过新）
 */
export async function parseFullBackupZip(file: File): Promise<{ records: AnalysisRecord[]; hasBgImage: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isEncryptedBackup(bytes)) throw new Error(t('backup.errEncryptedZip'));
  const files = unzipSync(bytes);
  const jsonEntry = files[JSON_NAME] ?? files[`data/${JSON_NAME}`];
  if (!jsonEntry) throw new Error(t('backup.errNoJson'));
  const { records } = parseRecordsPayload(strFromU8(jsonEntry));
  const hasBgImage = Object.entries(files).some(([name]) => name.startsWith(BG_IMAGE_DIR) && !name.endsWith('/'));
  return { records, hasBgImage };
}

/**
 * 从 ZIP 备份恢复（记录按 id 去重合并，音频挂载到已存在的记录上）
 * @throws ZIP 损坏或缺少 records.json 时抛错；加密的云端备份包给出「走云恢复」指引
 */
export async function importFullBackup(file: File): Promise<BackupImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // 云端加密包（SVTENC1 信封）不是 zip：本地手动恢复没有口令输入流程，指引用户走云恢复
  if (isEncryptedBackup(bytes)) throw new Error(t('backup.errEncryptedZip'));
  const files = unzipSync(bytes);
  const jsonEntry = files[JSON_NAME] ?? files[`data/${JSON_NAME}`];
  if (!jsonEntry) throw new Error(t('backup.errNoJson'));

  // 显式校验格式与版本（v1/v2 可读，更新版本拒绝并提示先升级应用）
  const { records: incoming } = parseRecordsPayload(strFromU8(jsonEntry));

  const store = useHistoryStore.getState();
  const added = await store.importRecords(incoming);

  // 音频：文件名（去扩展名）即记录 id，只挂载到本地存在的记录。
  // validIds 取全量（IDB + 内存）：importRecords 全部入库，内存 records 有
  // MAX_HISTORY 截断，按内存窗口判断会静默漏掉窗口外记录的音频
  const validIds = new Set((await store.getAllRecords()).map((r) => r.id));
  let audio = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith('audio/') || name.endsWith('/')) continue;
    const base = name.slice('audio/'.length);
    const dot = base.lastIndexOf('.');
    const id = dot > 0 ? base.slice(0, dot) : base;
    if (!validIds.has(id)) continue;
    await idbPutAudio(id, new Blob([data], { type: audioMimeOf(name) }));
    audio++;
  }
  // 自定义背景图（可选条目，旧备份没有；恢复后立即生效）
  const bgEntry = Object.entries(files).find(([name]) => name.startsWith(BG_IMAGE_DIR) && !name.endsWith('/'));
  if (bgEntry) {
    await saveBgImage(new Blob([bgEntry[1]], { type: imageMimeOf(bgEntry[0]) }));
  }
  return { records: added, audio };
}
