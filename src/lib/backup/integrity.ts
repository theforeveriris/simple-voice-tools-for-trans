/**
 * 备份完整性检查（ZIP / 加密 .svtz）
 *
 * 回答的问题不是「有没有备份」，而是「这份备份能不能恢复」：
 *   - 加密包能否用当前会话口令解开；
 *   - ZIP 结构是否存在 records.json，JSON 能否解析、版本是否支持；
 *   - 记录字段是否完整、id 是否重复；
 *   - 音频条目数量 / 体积，是否有孤儿音频或空文件。
 *
 * 只读文件，不写资料库；最近一次结果写入 kv 供设置页展示。
 * 恢复演练复用解析出的 records，由 UI 走 RestorePreviewDialog（不落库）。
 */

import { unzipSync, strFromU8, type Unzipped } from 'fflate';
import {
  decryptBackupEnvelope, decryptWithPassphrase, isEncryptedBackup, BackupLockedError,
} from './crypto';
import { parseRecordsPayload } from '@/lib/export/backup';
import { idbGetKV, idbPutKV } from '@/lib/storage/idb';
import { t } from '@/i18n';
import type { AnalysisRecord } from '@/types';

const LAST_KEY = 'backup:lastVerify';
const JSON_NAME = 'records.json';
const AUDIO_DIR = 'audio/';

export interface BackupVerifyResult {
  at: number;
  ok: boolean;
  encrypted: boolean;
  records: number;
  audio: number;
  audioBytes: number;
  hasBgImage: boolean;
  version: number | null;
  /** 已本地化的问题 / 警告文案；ok=false 时至少一条 */
  issues: string[];
}

export interface BackupInspection {
  result: BackupVerifyResult;
  /** 解析出的记录（恢复演练用；不写入 IndexedDB） */
  records: AnalysisRecord[];
  hasBgImage: boolean;
}

function hasRecordShape(record: AnalysisRecord): boolean {
  return Boolean(
    record &&
    typeof record === 'object' &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.durationSec === 'number' &&
    typeof record.sampleHz === 'number' &&
    record.series &&
    Array.isArray(record.series.t) &&
    Array.isArray(record.series.f0) &&
    Array.isArray(record.series.rmsDb) &&
    record.stats &&
    typeof record.stats === 'object' &&
    typeof record.stats.durationSec === 'number' &&
    typeof record.stats.sampleHz === 'number',
  );
}

/**
 * 检查字节内容；加密包可用显式口令或已解锁的会话口令解密。
 * 两者都没有时抛 BackupLockedError，交给 UI 弹口令框后重试。
 */
export async function inspectBackupBytes(
  bytes: Uint8Array,
  passphrase?: string,
): Promise<BackupInspection> {
  const at = Date.now();
  const issues: string[] = [];
  let ok = true;
  const fail = (message: string) => {
    ok = false;
    issues.push(message);
  };

  let plain = bytes;
  let encrypted = false;
  let files: Unzipped;
  try {
    if (isEncryptedBackup(bytes)) {
      encrypted = true;
      plain = passphrase
        ? await decryptWithPassphrase(bytes, passphrase)
        : await decryptBackupEnvelope(bytes);
    }
    files = unzipSync(plain);
  } catch (err) {
    if (err instanceof BackupLockedError) throw err;
    // 会话口令与文件口令不一致时也交给 UI 输入文件自身口令，而不是直接判为损坏
    if (encrypted && !passphrase && err instanceof Error && err.message === t('crypto.errPassphrase')) {
      throw new BackupLockedError();
    }
    fail(encrypted ? t('backup.verifyDecryptFail') : t('backup.verifyNotZip'));
    const result: BackupVerifyResult = {
      at, ok: false, encrypted, records: 0, audio: 0, audioBytes: 0,
      hasBgImage: false, version: null, issues,
    };
    await idbPutKV(LAST_KEY, result).catch(() => undefined);
    return { result, records: [], hasBgImage: false };
  }

  const jsonEntry = files[JSON_NAME] ?? files[`data/${JSON_NAME}`];
  if (!jsonEntry) {
    fail(t('backup.verifyNoJson'));
    const result: BackupVerifyResult = {
      at, ok: false, encrypted, records: 0, audio: 0, audioBytes: 0,
      hasBgImage: false, version: null, issues,
    };
    await idbPutKV(LAST_KEY, result).catch(() => undefined);
    return { result, records: [], hasBgImage: false };
  }

  let records: AnalysisRecord[] = [];
  let version: number | null = null;
  try {
    const parsed = parseRecordsPayload(strFromU8(jsonEntry));
    records = parsed.records;
    version = parsed.version;
  } catch (err) {
    fail(err instanceof Error ? err.message : t('backup.verifyNoJson'));
  }

  if (records.length === 0) fail(t('backup.verifyNoRecords'));
  const valid = records.filter(hasRecordShape);
  if (valid.length !== records.length) {
    fail(t('backup.verifyBadRecords', { n: records.length - valid.length }));
  }
  const ids = new Set<string>();
  let duplicates = 0;
  for (const record of valid) {
    if (ids.has(record.id)) duplicates++;
    else ids.add(record.id);
  }
  if (duplicates > 0) issues.push(t('backup.verifyDupIds', { n: duplicates }));

  let audio = 0;
  let audioBytes = 0;
  let orphans = 0;
  let empty = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(AUDIO_DIR) || name.endsWith('/')) continue;
    audio++;
    audioBytes += data.length;
    if (data.length === 0) empty++;
    const id = name.slice(AUDIO_DIR.length).replace(/\.[^.]+$/, '');
    if (ids.size > 0 && !ids.has(id)) orphans++;
  }
  if (empty > 0) issues.push(t('backup.verifyEmptyAudio', { n: empty }));
  if (orphans > 0) issues.push(t('backup.verifyOrphanAudio', { n: orphans }));

  const hasBgImage = Object.entries(files).some(
    ([name]) => name.startsWith('bg-image/') && !name.endsWith('/'),
  );

  const result: BackupVerifyResult = {
    at, ok, encrypted, records: records.length, audio, audioBytes, hasBgImage, version, issues,
  };
  await idbPutKV(LAST_KEY, result).catch(() => undefined);
  return { result, records, hasBgImage };
}

/** 从用户选择的文件做检查（含保存「上次验证」状态） */
export async function inspectBackupFile(
  file: File,
  passphrase?: string,
): Promise<BackupInspection> {
  return inspectBackupBytes(new Uint8Array(await file.arrayBuffer()), passphrase);
}

export async function getLastBackupVerify(): Promise<BackupVerifyResult | null> {
  return (await idbGetKV<BackupVerifyResult>(LAST_KEY)) ?? null;
}
