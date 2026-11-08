import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  stored: null as unknown,
}));

vi.mock('@/lib/storage/idb', () => ({
  idbGetKV: async () => h.stored ?? undefined,
  idbPutKV: async (_key: string, value: unknown) => {
    h.stored = value;
  },
}));

async function fresh() {
  vi.resetModules();
  return import('./memory');
}

beforeEach(() => {
  h.stored = null;
});

describe('shouldAutoSaveMemory', () => {
  it('accepts cue words and statements', async () => {
    const { shouldAutoSaveMemory } = await fresh();
    expect(shouldAutoSaveMemory('记住我不喜欢少女音')).toBe(true);
    expect(shouldAutoSaveMemory('我习惯晚上十点练习')).toBe(true);
    expect(shouldAutoSaveMemory('早餐前适合练十分钟')).toBe(true);
  });

  it('skips greetings and pure questions', async () => {
    const { shouldAutoSaveMemory } = await fresh();
    expect(shouldAutoSaveMemory('你好')).toBe(false);
    expect(shouldAutoSaveMemory('VFP 参考分是什么意思？')).toBe(false);
    expect(shouldAutoSaveMemory('我该怎么练习？')).toBe(false);
    expect(shouldAutoSaveMemory('看看这条记录')).toBe(false);
  });
});

describe('saveMemory', () => {
  it('adds, then treats normalized punctuation as a duplicate', async () => {
    const { saveMemory, loadMemories } = await fresh();
    const first = await saveMemory({ text: '用户喜欢中性描述' });
    expect(first?.action).toBe('added');
    const second = await saveMemory({ text: '用户喜欢中性描述。' });
    expect(second?.action).toBe('duplicate');
    expect(await loadMemories()).toHaveLength(1);
  });

  it('updates a near-duplicate instead of adding another row', async () => {
    const { saveMemory, loadMemories } = await fresh();
    await saveMemory({ text: '用户希望早餐前做十分钟热身' });
    const res = await saveMemory({ text: '用户希望早餐前做十分钟热身运动' });
    expect(res?.action).toBe('updated');
    expect(await loadMemories()).toHaveLength(1);
    expect((await loadMemories())[0].text).toBe('用户希望早餐前做十分钟热身运动');
    expect(res?.beforeItem?.text).toBe('用户希望早餐前做十分钟热身');
  });

  it('replaces a conflicting memory and can undo it', async () => {
    const { saveMemory, loadMemories, undoMemoryWrite } = await fresh();
    const old = await saveMemory({ text: '用户喜欢少女音' });
    const res = await saveMemory({ text: '用户不喜欢少女音' });
    expect(res?.action).toBe('replaced');
    expect(res?.item.supersedes).toBe(old?.item.id);
    expect((await loadMemories()).map((m) => m.text)).toEqual(['用户不喜欢少女音']);

    await undoMemoryWrite({
      id: res!.item.id,
      text: res!.item.text,
      action: res!.action,
      beforeItem: res!.beforeItem,
    });
    expect((await loadMemories()).map((m) => m.text)).toEqual(['用户喜欢少女音']);
  });
});
