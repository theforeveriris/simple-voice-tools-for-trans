import { describe, it, expect, vi, beforeEach } from 'vitest';

// 内存版 kv 仓库模拟 IndexedDB（单测环境无 indexedDB）
const kvStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/storage/idb', () => ({
  idbGetKV: async (key: string) => kvStore.get(key),
  idbPutKV: async (key: string, value: unknown) => {
    kvStore.set(key, structuredClone(value));
  },
  idbDeleteKV: async (key: string) => {
    kvStore.delete(key);
  },
}));

import {
  enableBackupEncryption,
  disableBackupEncryption,
  unlockBackupEncryption,
  lockBackupEncryption,
  encryptForBackup,
  decryptBackupEnvelope,
  decryptWithPassphrase,
  isEncryptedBackup,
  isBackupEncryptionUnlocked,
  isLocalBackupEncryptionEnabled,
  setLocalBackupEncryptionEnabled,
  getBackupCryptoConfig,
  BackupLockedError,
  BACKUP_ENCRYPTION_ITERATIONS,
} from './crypto';

const PASS_1 = 'correct-horse';
const PASS_2 = 'battery-staple';
const PLAIN = new TextEncoder().encode('voice-audio-bytes-0123456789');

describe('backup crypto', () => {
  beforeEach(async () => {
    kvStore.clear();
    lockBackupEncryption();
    await disableBackupEncryption();
  });

  it('开启后加密 → 解密还原原文', async () => {
    await enableBackupEncryption(PASS_1);
    const env = await encryptForBackup(PLAIN);
    expect(isEncryptedBackup(env)).toBe(true);
    expect(await decryptBackupEnvelope(env)).toEqual(PLAIN);
  });

  it('显式口令可在会话锁定时解密，错误口令失败', async () => {
    await enableBackupEncryption(PASS_1);
    const env = await encryptForBackup(PLAIN);
    lockBackupEncryption();
    expect(await decryptWithPassphrase(env, PASS_1)).toEqual(PLAIN);
    await expect(decryptWithPassphrase(env, PASS_2)).rejects.toThrow();
  });

  it('本地备份加密开关独立保存，更换口令后保留', async () => {
    await enableBackupEncryption(PASS_1);
    expect(await isLocalBackupEncryptionEnabled()).toBe(false);
    await setLocalBackupEncryptionEnabled(true);
    expect(await isLocalBackupEncryptionEnabled()).toBe(true);
    await enableBackupEncryption(PASS_2);
    expect(await isLocalBackupEncryptionEnabled()).toBe(true);
  });

  it('同明文密文稳定（确定性 IV，跳过未变化文件的前提）；不同明文密文不同', async () => {
    await enableBackupEncryption(PASS_1);
    const a1 = await encryptForBackup(PLAIN);
    const a2 = await encryptForBackup(PLAIN);
    expect([...a1]).toEqual([...a2]);
    const b = await encryptForBackup(new TextEncoder().encode('different content'));
    expect([...b]).not.toEqual([...a1]);
  });

  it('明文 / 截断数据不被误判为加密信封', () => {
    expect(isEncryptedBackup(new TextEncoder().encode('PK\x03\x04 plain zip bytes here'))).toBe(false);
    expect(isEncryptedBackup(new Uint8Array(10))).toBe(false);
  });

  it('未开启加密时加密抛 BackupLockedError', async () => {
    await expect(encryptForBackup(PLAIN)).rejects.toBeInstanceOf(BackupLockedError);
  });

  it('会话锁定后解密抛 BackupLockedError；解锁错误口令失败、正确口令成功', async () => {
    await enableBackupEncryption(PASS_1);
    const env = await encryptForBackup(PLAIN);
    lockBackupEncryption();
    expect(isBackupEncryptionUnlocked()).toBe(false);
    await expect(decryptBackupEnvelope(env)).rejects.toBeInstanceOf(BackupLockedError);
    await expect(unlockBackupEncryption('wrong-passphrase')).resolves.toBe(false);
    await expect(unlockBackupEncryption(PASS_1)).resolves.toBe(true);
    expect(await decryptBackupEnvelope(env)).toEqual(PLAIN);
  });

  it('更换口令后（重新派生），旧信封用新口令解密失败（非 Locked）', async () => {
    await enableBackupEncryption(PASS_1);
    const env = await encryptForBackup(PLAIN);
    await enableBackupEncryption(PASS_2);
    await expect(decryptBackupEnvelope(env)).rejects.toSatisfy((e: unknown) => !(e instanceof BackupLockedError));
  });

  it('kv 配置含 salt/iterations/校验块，不含口令明文', async () => {
    await enableBackupEncryption(PASS_1);
    const cfg = await getBackupCryptoConfig();
    expect(cfg?.enabled).toBe(true);
    expect(cfg?.iterations).toBe(BACKUP_ENCRYPTION_ITERATIONS);
    expect(cfg?.saltB64.length).toBeGreaterThan(0);
    expect(cfg?.checkCtB64.length).toBeGreaterThan(0);
    expect(JSON.stringify(cfg)).not.toContain(PASS_1);
  });

  it('过短口令被拒绝', async () => {
    await expect(enableBackupEncryption('abc')).rejects.toBeInstanceOf(Error);
  });

  it('关闭加密后配置清除、会话失效', async () => {
    await enableBackupEncryption(PASS_1);
    await disableBackupEncryption();
    const { getBackupCryptoConfig: cfg } = await import('./crypto');
    expect(await cfg()).toBeNull();
    await expect(encryptForBackup(PLAIN)).rejects.toBeInstanceOf(BackupLockedError);
  });
});
