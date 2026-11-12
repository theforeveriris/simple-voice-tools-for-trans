/**
 * 云备份加密（AES-256-GCM + PBKDF2，全部走 WebCrypto）
 *
 * 覆盖范围：GitHub 私有库与 WebDAV 的云端上传内容（records JSON + 录音音频），
 * 以及可选的本地手动 ZIP / 自动备份（localEnabled 开关，同一口令）。
 *
 * 关键设计——确定性 IV（SIV 式构造）：
 *   GitHub 备份按文件推送，靠对比 git blob SHA 跳过未变化的文件。
 *   AES-GCM 若用随机 IV，同一明文每次密文都不同，SHA 永远对不上、
 *   每次推送都会全量重传。因此 IV 取 SHA-256(域串 ‖ salt ‖ 明文) 前 12 字节：
 *   同一明文 → 同一密文（跳过逻辑成立）；不同明文 → IV 碰撞概率 ~2^-96，
 *   且 IV 只在「同明文」时重复，不触发 GCM 的 nonce 重用灾难。
 *   （代价是密文相等性可被观察——但 SHA 跳过机制本身已泄露这一信息。）
 *
 * 口令安全：
 *   - 口令只存于内存（会话级），绝不入 IndexedDB / localStorage；
 *     派生缓存按键 `salt:iterations` 复用，同一会话内多次加解密只派生一次。
 *   - kv 中保存 salt / iterations / 校验块（加密的已知明文），用于：
 *     a) 换设备恢复时从文件头读 salt 自行派生（不依赖本机 kv）；
 *     b) 会话解锁时验证口令是否正确。
 *   - 加密文件格式（自带全部解密所需信息，跨设备可恢复）：
 *       magic "SVTENC1"(7B) ‖ salt(16B) ‖ iterations(4B BE) ‖ iv(12B) ‖ GCM 密文
 */

import { idbDeleteKV, idbGetKV, idbPutKV } from '@/lib/storage/idb';
import { notifyBackupChanged } from './bus';
import { t } from '@/i18n';

const KV_CONFIG = 'backup:crypto';

/** 文件头 magic（ASCII，7 字节） */
const MAGIC = 'SVTENC1';
const SALT_LEN = 16;
const IV_LEN = 12;
/** PBKDF2-HMAC-SHA256 迭代次数（OWASP 2023 建议 310k 量级；写入文件头便于日后上调） */
export const BACKUP_ENCRYPTION_ITERATIONS = 310_000;
/** 文件头里可接受的迭代次数上限（防伪造文件头逼迫 PBKDF2 长时间空转） */
const MAX_ITERATIONS = 5_000_000;
/** 会话解锁用的校验明文（加密后存 kv，解密成功即口令正确） */
const CHECK_PLAINTEXT = 'svt-crypto-check-v1';
/** 口令最短长度 */
export const MIN_PASSPHRASE_LEN = 6;

/** 加密配置（kv 持久化；不含口令） */
export interface BackupCryptoConfig {
  enabled: boolean;
  /** salt，base64 */
  saltB64: string;
  iterations: number;
  /** 校验块 IV，base64 */
  checkIvB64: string;
  /** 校验块密文，base64 */
  checkCtB64: string;
  createdAt: number;
  /** 同一口令也用于手动 ZIP 导出与本地自动备份（默认关闭，保持旧行为） */
  localEnabled?: boolean;
}

/** 云端操作被加密锁住时抛出：UI 捕获后弹口令对话框再重试 */
export class BackupLockedError extends Error {
  constructor() {
    super(t('crypto.errLocked'));
    this.name = 'BackupLockedError';
  }
}

/* ------------------------------ 编码工具 ------------------------------ */

function u8ToB64(u8: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < u8.length; i += 8192) {
    bin += String.fromCharCode(...u8.subarray(i, i + 8192));
  }
  return btoa(bin);
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/* ------------------------------ 密钥派生 ------------------------------ */

/** 派生缓存：同一 口令+salt+iterations 会话内只算一次 PBKDF2 */
const keyCache = new Map<string, CryptoKey>();

/** 短字符串散列（FNV-1a）：缓存键中替代口令原文，避免口令留在内存键里 */
function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  // 缓存键必须包含口令：否则换口令后同 salt 会命中旧密钥，错误口令也能通过校验
  const cacheKey = `${hashStr(passphrase)}:${u8ToB64(salt)}:${iterations}`;
  const hit = keyCache.get(cacheKey);
  if (hit) return hit;
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  keyCache.set(cacheKey, key);
  return key;
}

async function aesGcmEncrypt(key: CryptoKey, iv: Uint8Array, plain: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource);
  return new Uint8Array(ct);
}

async function aesGcmDecrypt(key: CryptoKey, iv: Uint8Array, ct: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return new Uint8Array(pt);
}

/** 确定性 IV：SHA-256(域串 ‖ salt ‖ 明文) 前 12 字节（SIV 式；见文件头注释） */
async function deterministicIv(salt: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const domain = new TextEncoder().encode('svt-siv-v1');
  const digest = await crypto.subtle.digest('SHA-256', concatBytes(domain, salt, plain) as BufferSource);
  return new Uint8Array(digest).slice(0, IV_LEN);
}

/* ------------------------------ 配置存取 ------------------------------ */

export async function getBackupCryptoConfig(): Promise<BackupCryptoConfig | null> {
  return (await idbGetKV<BackupCryptoConfig>(KV_CONFIG)) ?? null;
}

/** 会话状态：口令只存在这里（内存），刷新页面即清除 */
let session: { passphrase: string; config: BackupCryptoConfig } | null = null;

/** 加密是否已开启（含锁定状态） */
export async function isBackupEncryptionEnabled(): Promise<boolean> {
  const cfg = await getBackupCryptoConfig();
  return cfg?.enabled === true;
}

/** 本地 ZIP / 自动备份是否也使用同一口令加密 */
export async function isLocalBackupEncryptionEnabled(): Promise<boolean> {
  const cfg = await getBackupCryptoConfig();
  return cfg?.enabled === true && cfg.localEnabled === true;
}

/** 切换本地备份加密（仅在云备份加密已开启时有意义） */
export async function setLocalBackupEncryptionEnabled(enabled: boolean): Promise<void> {
  const cfg = await getBackupCryptoConfig();
  if (!cfg?.enabled) return;
  const next = { ...cfg, localEnabled: enabled };
  await idbPutKV(KV_CONFIG, next);
  if (session) session = { ...session, config: next };
  notifyBackupChanged();
}

/** 当前会话是否已解锁（开启且口令在内存中） */
export function isBackupEncryptionUnlocked(): boolean {
  return session != null;
}

/**
 * 开启加密（或更换口令）：生成新 salt、派生密钥、写入校验块。
 * 更换口令时旧 salt 作废，云端文件需重新推送才会以新口令加密。
 */
export async function enableBackupEncryption(passphrase: string): Promise<void> {
  const trimmed = passphrase.trim();
  if (trimmed.length < MIN_PASSPHRASE_LEN) throw new Error(t('crypto.errTooShort'));
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const key = await deriveKey(trimmed, salt, BACKUP_ENCRYPTION_ITERATIONS);
  // 校验块：随机 IV 加密已知明文，供会话解锁时验证口令
  const checkIv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const checkCt = await aesGcmEncrypt(key, checkIv, new TextEncoder().encode(CHECK_PLAINTEXT));
  // 更换口令时保留「本地备份也加密」的选择，不强迫用户重新打开
  const prev = await getBackupCryptoConfig();
  const config: BackupCryptoConfig = {
    enabled: true,
    saltB64: u8ToB64(salt),
    iterations: BACKUP_ENCRYPTION_ITERATIONS,
    checkIvB64: u8ToB64(checkIv),
    checkCtB64: u8ToB64(checkCt),
    createdAt: Date.now(),
    ...(prev?.localEnabled ? { localEnabled: true } : {}),
  };
  await idbPutKV(KV_CONFIG, config);
  session = { passphrase: trimmed, config };
  notifyBackupChanged();
}

/** 关闭加密：删除本机配置与会话口令。云端已加密的文件保持原样（旧口令仍可解）。 */
export async function disableBackupEncryption(): Promise<void> {
  await idbDeleteKV(KV_CONFIG);
  session = null;
  notifyBackupChanged();
}

/** 退出会话（清除内存中的口令；配置与云端数据不变） */
export function lockBackupEncryption(): void {
  session = null;
  notifyBackupChanged();
}

/**
 * 会话解锁：用校验块验证口令；成功后口令留在内存供本会话加解密使用。
 * @returns 口令正确与否
 */
export async function unlockBackupEncryption(passphrase: string): Promise<boolean> {
  const cfg = await getBackupCryptoConfig();
  if (!cfg?.enabled) return false;
  // 与开启加密时的 trim 口径一致：否则口令含首尾空格时派生密钥不同，永远解不开
  const trimmed = passphrase.trim();
  try {
    const key = await deriveKey(trimmed, b64ToU8(cfg.saltB64), cfg.iterations);
    const pt = await aesGcmDecrypt(key, b64ToU8(cfg.checkIvB64), b64ToU8(cfg.checkCtB64));
    if (new TextDecoder().decode(pt) !== CHECK_PLAINTEXT) return false;
  } catch {
    return false;
  }
  session = { passphrase: trimmed, config: cfg };
  notifyBackupChanged();
  return true;
}

/* ------------------------------ 加解密 ------------------------------ */

function assertUnlocked(): { passphrase: string; config: BackupCryptoConfig } {
  if (!session) throw new BackupLockedError();
  return session;
}

/**
 * 加密一段字节（云备份上传前调用）。要求已开启且会话已解锁，否则抛 BackupLockedError。
 * 输出：magic ‖ salt ‖ iterations ‖ iv ‖ 密文；同明文同 salt → 同输出（幂等）。
 */
export async function encryptForBackup(plain: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const { passphrase, config } = assertUnlocked();
  const salt = b64ToU8(config.saltB64);
  const key = await deriveKey(passphrase, salt, config.iterations);
  const iv = await deterministicIv(salt, plain);
  const ct = await aesGcmEncrypt(key, iv, plain);
  const iterBytes = new Uint8Array(4);
  new DataView(iterBytes.buffer).setUint32(0, config.iterations, false);
  return concatBytes(new TextEncoder().encode(MAGIC), salt, iterBytes, iv, ct);
}

/** 是否为加密信封（按 magic 判断；空/短数据返回 false） */
export function isEncryptedBackup(data: Uint8Array): boolean {
  if (data.length < MAGIC.length + SALT_LEN + 4 + IV_LEN + 16) return false;
  return new TextDecoder().decode(data.slice(0, MAGIC.length)) === MAGIC;
}

/**
 * 解密加密信封。
 * - 会话已解锁：用**会话口令** + 文件头中的 salt 派生密钥（因此换口令后，
 *   用旧口令加密的云端文件在重启后无法解密——需在换口令后重新推送一次）；
 * - 未解锁：抛 BackupLockedError（UI 弹口令框后重试）；
 * - 密文被篡改 / 口令错误：抛本地化的解密失败错误。
 */
export async function decryptBackupEnvelope(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (!isEncryptedBackup(data)) throw new Error(t('crypto.errNotEncrypted'));
  const salt = data.slice(MAGIC.length, MAGIC.length + SALT_LEN);
  const iterations = new DataView(data.buffer, data.byteOffset).getUint32(MAGIC.length + SALT_LEN, false);
  // 迭代次数来自文件头（可被伪造）：上限兜底，避免恶意文件让 PBKDF2 跑到天荒地老
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > MAX_ITERATIONS) {
    throw new Error(t('crypto.errPassphrase'));
  }
  const iv = data.slice(MAGIC.length + SALT_LEN + 4, MAGIC.length + SALT_LEN + 4 + IV_LEN);
  const ct = data.slice(MAGIC.length + SALT_LEN + 4 + IV_LEN);
  if (!session) throw new BackupLockedError();
  try {
    const key = await deriveKey(session.passphrase, salt, iterations);
    return await aesGcmDecrypt(key, iv, ct);
  } catch (err) {
    if (err instanceof BackupLockedError) throw err;
    throw new Error(t('crypto.errPassphrase'));
  }
}
