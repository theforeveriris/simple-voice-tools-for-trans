import { describe, it, expect } from 'vitest';
import { renderMarkdown, parseInline } from './markdown';
import { renderAssistantContent } from './assistantChartRoute';
// renderMarkdown 返回 React 元素——这里验证结构，用 react-dom/server 的 renderToStaticMarkup
// 做文本级断言（vitest 环境无 DOM，用静态渲染）
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';

const html = (nodes: React.ReactNode[]) => renderToStaticMarkup(createElement(Fragment, null, nodes));

describe('parseInline', () => {
  it('粗体 / 斜体 / 行内代码', () => {
    expect(html(parseInline('a **b** c'))).toContain('<strong');
    expect(html(parseInline('a **b** c'))).toContain('</strong>');
    expect(html(parseInline('a *b* c'))).toContain('<em>b</em>');
    expect(html(parseInline('a `b` c'))).toContain('<code');
  });

  it('无标记文本原样输出（HTML 特殊字符由 React 转义）', () => {
    expect(html(parseInline('<script>'))).toBe('&lt;script&gt;');
  });
});

describe('renderMarkdown', () => {
  it('无序列表', () => {
    const h = html(renderMarkdown('- a\n- b'));
    expect(h).toContain('<ul');
    expect(h).toContain('<li>a</li>');
    expect(h).toContain('<li>b</li>');
  });

  it('有序列表', () => {
    const h = html(renderMarkdown('1. x\n2. y'));
    expect(h).toContain('<ol');
    expect(h).toContain('<li>x</li>');
  });

  it('表格（表头 + 数据行）', () => {
    const h = html(renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |'));
    expect(h).toContain('<th');
    expect(h).toContain('<td');
    expect(h).toContain('A');
    expect(h).toContain('2');
  });

  it('引用与标题', () => {
    const h = html(renderMarkdown('> quote\n## Head'));
    expect(h).toContain('<blockquote');
    expect(h).toContain('Head');
  });

  it('普通段落不加列表结构', () => {
    const h = html(renderMarkdown('plain text'));
    expect(h).not.toContain('<ul');
    expect(h).toContain('plain text');
  });

  it('围栏代码块：内容原样输出为 <pre><code>，不做行内解析', () => {
    const h = html(renderMarkdown('```bash\nnpm run build -- --watch\n```'));
    expect(h).toContain('<pre');
    expect(h).toContain('<code>');
    expect(h).toContain('npm run build -- --watch');
    // 代码块内的 ** 不解析为粗体
    const h2 = html(renderMarkdown('```\n**not bold**\n```'));
    expect(h2).not.toContain('<strong');
    expect(h2).toContain('**not bold**');
  });

  it('围栏代码块未闭合时吃到文末（不丢内容）', () => {
    const h = html(renderMarkdown('```\nline1\nline2'));
    expect(h).toContain('line1');
    expect(h).toContain('line2');
  });

  it('多段代码块与段落混排', () => {
    const h = html(renderMarkdown('说明\n\n```\ncode1\n```\n\n```\ncode2\n```'));
    expect(h).toContain('说明');
    expect(h).toContain('code1');
    expect(h).toContain('code2');
    expect((h.match(/<pre/g) ?? []).length).toBe(2);
  });

  it('缩进列表项保留层级（子项带缩进类）', () => {
    const h = html(renderMarkdown('- 顶层\n  - 子项'));
    expect(h).toContain('顶层');
    expect(h).toContain('子项');
    expect(h).toContain('ml-4');
  });

  it('doc 尺度：一级标题更大且带下边框，正文显式字号', () => {
    const chat = html(renderMarkdown('# 标题'));
    const doc = html(renderMarkdown('# 标题', 'doc'));
    expect(chat).not.toContain('border-b');
    expect(doc).toContain('border-b');
    expect(doc).toContain('text-xl');
    expect(html(renderMarkdown('正文', 'doc'))).toContain('text-[13px]');
  });
});

describe('renderAssistantContent', () => {
  it('record:// 引用切分为图片部分', () => {
    const parts = renderAssistantContent('看这张 ![第一次测试](record://abc-123/pitch) 说明趋势。');
    expect(parts).toHaveLength(3);
    expect(parts[1].type).toBe('img');
    if (parts[1].type === 'img') {
      expect(parts[1].recordId).toBe('abc-123');
      expect(parts[1].kind).toBe('pitch');
      expect(parts[1].alt).toBe('第一次测试');
    }
  });

  it('未知 kind 仍切分（kind undefined，渲染端显示占位）', () => {
    const parts = renderAssistantContent('前缀 ![](record://abc/unknown)');
    expect(parts[1].type).toBe('img');
    if (parts[1].type === 'img') {
      expect(parts[1].recordId).toBe('abc');
      expect(parts[1].kind).toBeUndefined();
    }
  });

  it('无引用时整体为 markdown', () => {
    const parts = renderAssistantContent('plain');
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('md');
  });
});
