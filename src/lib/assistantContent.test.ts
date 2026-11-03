import { describe, it, expect } from 'vitest';
import { renderAssistantMessage } from './assistantContent';

describe('renderAssistantMessage', () => {
  it('纯文本走 Markdown', () => {
    expect(renderAssistantMessage('你好')).toEqual([{ type: 'md', content: '你好' }]);
  });

  it('拆出 genui 围栏并保留前后文本', () => {
    const parts = renderAssistantMessage('前\n```genui\n<div>hi</div>\n```\n后');
    expect(parts.map((p) => p.type)).toEqual(['md', 'genui', 'md']);
    expect(parts[1]).toEqual({ type: 'genui', content: '<div>hi</div>' });
    expect(parts[0].type === 'md' && parts[0].content).toContain('前');
    expect(parts[2].type === 'md' && parts[2].content).toContain('后');
  });

  it('围栏语言大小写不敏感', () => {
    const parts = renderAssistantMessage('```GenUI\n<b>x</b>\n```');
    expect(parts).toEqual([{ type: 'genui', content: '<b>x</b>' }]);
  });

  it('保留 record:// 图表引用', () => {
    const parts = renderAssistantMessage('看这张\n![F0](record://rec-1/pitch)\n完');
    expect(parts.some((p) => p.type === 'img' && p.recordId === 'rec-1' && p.kind === 'pitch')).toBe(true);
  });

  it('genui 内部的 record:// 不再拆成图表', () => {
    const parts = renderAssistantMessage('```genui\n<div>![x](record://rec-1/pitch)</div>\n```');
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('genui');
    if (parts[0].type === 'genui') expect(parts[0].content).toContain('record://rec-1/pitch');
  });

  it('流式输出中未闭合的围栏返回 pending', () => {
    const parts = renderAssistantMessage('说明\n```genui\n<div>半截');
    expect(parts.map((p) => p.type)).toEqual(['md', 'genui-pending']);
  });

  it('多个 genui 块按顺序拆开', () => {
    const parts = renderAssistantMessage('A\n```genui\n<b>1</b>\n```\nB\n```genui\n<i>2</i>\n```\nC');
    expect(parts.map((p) => p.type)).toEqual(['md', 'genui', 'md', 'genui', 'md']);
  });
});
