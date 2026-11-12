/**
 * IndexedDB 存储层（零依赖封装）
 * 三个对象仓库：
 *   records — 分析记录（不含音频），keyPath = id
 *   audio   — 录音音频 Blob，keyPath = id（与分析记录同 id 关联）
 *   kv      — 杂项键值（GitHub 备份 token 等敏感态，不进 localStorage）
 * 所有操作返回 Promise；打开失败时全局降级为「不可用」，由上层提示。
 */

const DB_NAME = 'svt';
const DB_VERSION = 3;

export const STORE_RECORDS = 'records';
export const STORE_AUDIO = 'audio';
export const STORE_TRASH = 'trash';
export const STORE_KV = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;
let unavailable = false;

function openDb(): Promise<IDBDatabase> {
  if (unavailable) return Promise.reject(new Error('IndexedDB unavailable'));
  if (!dbPromise) {
    let blocked = false;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unsupported'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_AUDIO)) {
          db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TRASH)) {
          db.createObjectStore(STORE_TRASH, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 别的标签页请求升级版本时主动让路：长期连接会一直阻塞升级
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      // 版本升级被其他标签页阻塞：瞬态而非终态，reject 本次调用但不锁死
      req.onblocked = () => {
        blocked = true;
        reject(new Error('IndexedDB blocked'));
      };
    });
    dbPromise.catch(() => {
      // blocked 解除后可重开，丢弃本次 promise 让后续调用重试；
      // 其余失败（不支持/打开失败）按永久不可用降级
      dbPromise = null;
      if (!blocked) unavailable = true;
    });
  }
  return dbPromise;
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let request: IDBRequest<T> | void;
    try {
      request = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(request ? (request as IDBRequest<T>).result : (undefined as T));
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

/* ------------------------------ 记录仓库 ------------------------------ */

export async function idbGetAllRecords<T>(): Promise<T[]> {
  return withStore<T[]>(STORE_RECORDS, 'readonly', (s) => s.getAll());
}

export async function idbGetRecord<T>(id: string): Promise<T | undefined> {
  return withStore<T | undefined>(STORE_RECORDS, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
}

export function idbPutRecord(record: unknown): Promise<void> {
  return withStore(STORE_RECORDS, 'readwrite', (s) => {
    s.put(record);
  });
}

export function idbPutRecords(records: unknown[]): Promise<void> {
  return withStore(STORE_RECORDS, 'readwrite', (s) => {
    for (const r of records) s.put(r);
  });
}

export function idbDeleteRecord(id: string): Promise<void> {
  return withStore(STORE_RECORDS, 'readwrite', (s) => s.delete(id));
}

export function idbClearRecords(): Promise<void> {
  return withStore(STORE_RECORDS, 'readwrite', (s) => s.clear());
}

/* ------------------------------ 音频仓库 ------------------------------ */

export async function idbGetAudio(id: string): Promise<Blob | null> {
  const val = await withStore<{ id: string; blob: Blob } | undefined>(
    STORE_AUDIO,
    'readonly',
    (s) => s.get(id),
  );
  return val?.blob ?? null;
}

export function idbPutAudio(id: string, blob: Blob): Promise<void> {
  return withStore(STORE_AUDIO, 'readwrite', (s) => {
    s.put({ id, blob });
  });
}

export function idbDeleteAudio(id: string): Promise<void> {
  return withStore(STORE_AUDIO, 'readwrite', (s) => s.delete(id));
}

export function idbClearAudio(): Promise<void> {
  return withStore(STORE_AUDIO, 'readwrite', (s) => s.clear());
}

/** 枚举全部音频条目（用于备份与存储用量统计；blob.size 不读取内容，开销小） */
export async function idbGetAllAudio<T>(): Promise<T[]> {
  return withStore<T[]>(STORE_AUDIO, 'readonly', (s) => s.getAll());
}

/* ------------------------------- 回收站仓库 ------------------------------- */

/** 回收站条目：记录本体 + 删除时间；音频仍留在 audio 仓库，恢复时无需重写 */
export interface TrashedRecord<T> {
  id: string;
  deletedAt: number;
  record: T;
}

export async function idbGetAllTrash<T>(): Promise<TrashedRecord<T>[]> {
  return withStore<TrashedRecord<T>[]>(STORE_TRASH, 'readonly', (s) => s.getAll());
}

export function idbPutTrash<T>(item: TrashedRecord<T>): Promise<void> {
  return withStore(STORE_TRASH, 'readwrite', (s) => {
    s.put(item);
  });
}

export function idbDeleteTrash(id: string): Promise<void> {
  return withStore(STORE_TRASH, 'readwrite', (s) => s.delete(id));
}

export function idbClearTrash(): Promise<void> {
  return withStore(STORE_TRASH, 'readwrite', (s) => s.clear());
}

function trashTx(stores: string[], run: (tx: IDBTransaction) => void): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    run(tx);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB trash transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB trash transaction aborted'));
  }));
}

/** 记录 → 回收站（同一事务，避免只删了记录却没写回收站） */
export function idbMoveRecordToTrash<T>(item: TrashedRecord<T>): Promise<void> {
  return trashTx([STORE_RECORDS, STORE_TRASH], (tx) => {
    tx.objectStore(STORE_TRASH).put(item);
    tx.objectStore(STORE_RECORDS).delete(item.id);
  });
}

/** 回收站 → 记录（整批同一事务） */
export function idbRestoreTrashBatch<T>(items: TrashedRecord<T>[]): Promise<void> {
  return trashTx([STORE_RECORDS, STORE_TRASH], (tx) => {
    const records = tx.objectStore(STORE_RECORDS);
    const trash = tx.objectStore(STORE_TRASH);
    for (const item of items) {
      records.put(item.record);
      trash.delete(item.id);
    }
  });
}

/**
 * 永久删除回收站条目并释放音频（同一事务）。
 * 先确认回收站条目仍存在、且没有同 id 的活记录：另一标签页可能已经恢复/清空，
 * 不能拿过期的 id 误删刚恢复的音频。
 */
export function idbPurgeTrash(ids: string[]): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TRASH, STORE_RECORDS, STORE_AUDIO], 'readwrite');
    const trash = tx.objectStore(STORE_TRASH);
    const records = tx.objectStore(STORE_RECORDS);
    const audio = tx.objectStore(STORE_AUDIO);
    for (const id of ids) {
      const trashGet = trash.get(id);
      trashGet.onsuccess = () => {
        if (!trashGet.result) return;
        const recordGet = records.get(id);
        recordGet.onsuccess = () => {
          // 记录仍存活：只清理过期的回收站条目，保留音频
          if (recordGet.result) {
            trash.delete(id);
            return;
          }
          trash.delete(id);
          audio.delete(id);
        };
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB trash transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB trash transaction aborted'));
  }));
}

/* ------------------------------- 键值仓库 ------------------------------- */

/** 清空全部记录、音频与 kv（应用锁「清除所有数据」用） */
export async function idbClearAll(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_RECORDS, STORE_AUDIO, STORE_TRASH, STORE_KV], 'readwrite');
    tx.objectStore(STORE_RECORDS).clear();
    tx.objectStore(STORE_AUDIO).clear();
    tx.objectStore(STORE_TRASH).clear();
    tx.objectStore(STORE_KV).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB clear aborted'));
  });
}

export async function idbGetKV<T>(key: string): Promise<T | undefined> {
  return withStore<T | undefined>(STORE_KV, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function idbPutKV(key: string, value: unknown): Promise<void> {
  return withStore(STORE_KV, 'readwrite', (s) => {
    s.put(value, key);
  });
}

export function idbDeleteKV(key: string): Promise<void> {
  return withStore(STORE_KV, 'readwrite', (s) => {
    s.delete(key);
  });
}

/** 删除 kv 中指定前缀的全部键（录音草稿清理用） */
export async function idbDeleteKVByPrefix(prefix: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readwrite');
    const store = tx.objectStore(STORE_KV);
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const cursor = store.openKeyCursor(range);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      store.delete(current.primaryKey);
      current.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete prefix failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete prefix aborted'));
  });
}
