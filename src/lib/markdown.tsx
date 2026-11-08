/**
 * 轻量 Markdown 渲染（AI 助手气泡 + 应用内文档共用）
 * 支持子集：**粗体** / *斜体* / `行内代码`、有序与无序列表（含一层缩进子项）、
 * 表格、引用（>）、标题（#…####）、分隔线（---）、围栏代码块（```lang）。
 * 输出 React 元素（无 dangerouslySetInnerHTML，文本一律经 React 转义——
 * 模型输出 / 文档内容不可信也安全）。
 * 不追求完整 CommonMark：未知语法按原文输出。
 * 两种排版尺度：chat（气泡内紧凑）/ doc（全屏文档页，标题与正文更大）。
 */

import type { ReactNode } from 'react';

/** 排版尺度：chat = 聊天气泡；doc = 全屏文档查看器 */
export type MdScale = 'chat' | 'doc';

/** 行内解析：粗体 / 斜体 / 行内代码 */
export function parseInline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  // 单遍扫描：`code` 优先（内部不再解析标记），随后 **bold**、*italic*
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}i${i++}`;
    if (token.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-surface-hi px-1 py-0.5 font-mono text-[0.92em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(<strong key={key} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Line {
  kind: 'h' | 'ul' | 'ol' | 'quote' | 'table' | 'hr' | 'p' | 'code';
  /** 标题级别（kind=h）；缩进层级（列表） */
  level?: number;
  text: string;
  /** 列表项（含缩进层级）；kind=ul/ol 时用 */
  items?: { level: number; text: string }[];
  /** 代码块语言标注（kind=code） */
  lang?: string;
}

/** 逐行分块（列表/表格/代码聚多行；其余逐行） */
function chunk(lines: string[]): Line[] {
  const out: Line[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    // 围栏代码块：```lang … ```（未闭合则吃到文末）
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾围栏（或越界）
      out.push({ kind: 'code', text: buf.join('\n'), lang });
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      out.push({ kind: 'h', level: line.match(/^#+/)![0].length, text: line.replace(/^#+\s+/, '') });
      i++;
      continue;
    }
    if (/^(---+|\*\*\*+)\s*$/.test(line)) {
      out.push({ kind: 'hr', text: '' });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trimStart())) {
        buf.push(lines[i].trimStart().replace(/^>\s?/, ''));
        i++;
      }
      out.push({ kind: 'quote', text: buf.join('\n') });
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      // 表格：表头 + 分隔行 + 若干数据行
      const rows: string[][] = [];
      const parseRow = (l: string) =>
        l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      rows.push(parseRow(lines[i]));
      i += 2; // 跳过分隔行
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      // 行数组串行化为制表符分隔文本，渲染端再拆
      out.push({ kind: 'table', text: rows.map((r) => r.join('\t')).join('\n') });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: { level: number; text: string }[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const indent = lines[i].match(/^\s*/)![0].replace(/\t/g, '  ').length;
        items.push({ level: indent >= 2 ? 1 : 0, text: lines[i].trim().replace(/^[-*+]\s+/, '') });
        i++;
      }
      out.push({ kind: 'ul', text: '', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: { level: number; text: string }[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const indent = lines[i].match(/^\s*/)![0].replace(/\t/g, '  ').length;
        items.push({ level: indent >= 2 ? 1 : 0, text: lines[i].trim().replace(/^\d+[.)]\s+/, '') });
        i++;
      }
      out.push({ kind: 'ol', text: '', items });
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    out.push({ kind: 'p', text: line });
    i++;
  }
  return out;
}

/** 标题字号（按尺度）：doc 用于全屏文档页，chat 用于聊天气泡 */
const HEAD_SIZE: Record<MdScale, (level: number) => string> = {
  chat: (level) => (level === 1 ? 'text-[15px]' : level === 2 ? 'text-[14px]' : 'text-[13px]'),
  doc: (level) => (level === 1 ? 'text-xl' : level === 2 ? 'text-base' : 'text-sm'),
};

/** 标题上边距（doc 段落更松散） */
const HEAD_MARGIN: Record<MdScale, (level: number) => string> = {
  chat: () => 'mt-3.5 mb-1.5 first:mt-0',
  doc: (level) => (level === 1 ? 'mt-0' : level === 2 ? 'mt-6' : 'mt-4'),
};

/** 正文段落（chat 给足行高，避免长回答挤成一团） */
const BODY: Record<MdScale, string> = {
  chat: 'text-[13px] leading-[1.75]',
  doc: 'text-[13px] leading-relaxed',
};

const PARAGRAPH: Record<MdScale, string> = {
  chat: 'my-2 first:mt-0 last:mb-0 leading-[1.75]',
  doc: 'my-3 text-[13px] first:mt-0 last:mb-0 leading-relaxed',
};

/** Markdown → React 元素（块级结构 + 行内标记） */
export function renderMarkdown(text: string, scale: MdScale = 'chat'): ReactNode[] {
  const blocks = chunk(text.split('\n'));
  return blocks.map((b, bi) => {
    const key = `b${bi}`;
    switch (b.kind) {
      case 'h': {
        const level = b.level ?? 2;
        const cls = `${HEAD_MARGIN[scale](level)} font-semibold ${HEAD_SIZE[scale](level)}`;
        // 文档尺度的一级标题带下边框（页眉感）
        return (
          <p key={key} className={scale === 'doc' && level === 1 ? `${cls} border-b border-black/10 pb-2` : cls}>
            {parseInline(b.text, key)}
          </p>
        );
      }
      case 'hr':
        return <div key={key} className={scale === 'chat' ? 'my-3 border-t border-black/10' : 'my-4 border-t border-black/10'} />;
      case 'code':
        return (
          <pre
            key={key}
            className={`${scale === 'chat' ? 'my-2.5' : 'my-3'} overflow-x-auto rounded-xl bg-surface-hi px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink`}
          >
            <code>{b.text}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={key} className={`my-2.5 border-l-2 border-accent/50 pl-2.5 py-0.5 text-ink-2 ${BODY[scale]}`}>
            {b.text.split('\n').map((l, li) => (
              <p key={li} className="my-0">{parseInline(l, `${key}-${li}`)}</p>
            ))}
          </blockquote>
        );
      case 'ul':
        return (
          <ul key={key} className={`my-2 ml-1 list-disc space-y-1 pl-3.5 first:mt-0 last:mb-0 ${BODY[scale]}`}>
            {(b.items ?? []).map((it, li) => (
              <li key={li} className={it.level > 0 ? 'ml-4 list-[circle] text-ink-2' : undefined}>
                {parseInline(it.text, `${key}-${li}`)}
              </li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={key} className={`my-2 ml-1 list-decimal space-y-1 pl-4 first:mt-0 last:mb-0 ${BODY[scale]}`}>
            {(b.items ?? []).map((it, li) => (
              <li key={li} className={it.level > 0 ? 'ml-4 text-ink-2' : undefined}>
                {parseInline(it.text, `${key}-${li}`)}
              </li>
            ))}
          </ol>
        );
      case 'table': {
        const rows = b.text.split('\n').map((r) => r.split('\t'));
        const [head, ...body] = rows;
        return (
          <div key={key} className="-mx-0.5 my-2.5 overflow-x-auto first:mt-0 last:mb-0">
            <table className={`w-full border-collapse ${scale === 'doc' ? 'text-[12.5px]' : 'text-[12px]'}`}>
              <thead>
                <tr>
                  {head.map((c, ci) => (
                    <th key={ci} className="border-b border-black/15 px-2 py-1.5 text-left font-semibold">{parseInline(c, `${key}h${ci}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} className="border-b border-black/[0.06] px-2 py-1.5 align-top">{parseInline(c, `${key}-${ri}-${ci}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return <p key={key} className={PARAGRAPH[scale]}>{parseInline(b.text, key)}</p>;
    }
  });
}
