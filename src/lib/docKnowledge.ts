/**
 * 内置文档知识库（AI 助手的检索语料，实验性）
 * 语料来源：documentation/ 下的核心文档——
 *   - PARAMETERS-GUIDE.md（参数说明书：每个指标的含义/参考区间/训练意义——回答
 *     「我的 CPPS 3.2dB 正常吗」这类问题的主力语料）
 *   - REFERENCES.md（参考文献：参考区间的出处）
 *   - ALGORITHM-YIN / FORMANT-LPC / VOICE-EXPRESSION / VOWEL / ENERGY / CPPS（算法原理）
 * 文档经 docs.loadDoc（import.meta.glob 懒加载）读取：每份文档单独成 chunk，
 * 只在首次检索时才下载，不占首屏体积（此前用静态 ?raw 导入，把 6 份文档
 * 强塞进首屏包，与 docs.ts 的懒加载意图相悖）。
 * 检索：把文档按「## 标题」切块，查询时按关键词命中度（词频 × 标题权重）打分，
 * 取前 N 块注入助手系统提示。纯本地零网络，无嵌入模型依赖。
 */

import { loadDoc } from './docs';

export interface DocChunk {
  /** 所属文档标题 */
  doc: string;
  /** 块标题（## 行；文档开头块为文档名） */
  title: string;
  content: string;
}

/** 块大小上限（字符）：超长块在段落边界截断（文档本身按标题组织，通常不会超） */
const MAX_CHUNK_CHARS = 2600;

const SOURCES: { doc: string; file: string }[] = [
  { doc: '参数说明书', file: 'PARAMETERS-GUIDE.md' },
  { doc: '参考文献', file: 'REFERENCES.md' },
  { doc: 'YIN 算法', file: 'ALGORITHM-YIN.md' },
  { doc: 'LPC 共振峰算法', file: 'ALGORITHM-FORMANT-LPC.md' },
  { doc: '声音性别表达评分', file: 'ALGORITHM-VOICE-EXPRESSION.md' },
  { doc: '元音与共鸣', file: 'ALGORITHM-VOWEL.md' },
  { doc: '能量分析', file: 'ALGORITHM-ENERGY.md' },
  { doc: 'CPPS 算法', file: 'ALGORITHM-CPPS.md' },
];

/** 段落边界附近截断（回退到最近的空行） */
function clampChunk(s: string): string {
  if (s.length <= MAX_CHUNK_CHARS) return s;
  const cut = s.lastIndexOf('\n\n', MAX_CHUNK_CHARS);
  return cut > MAX_CHUNK_CHARS / 2 ? s.slice(0, cut) : s.slice(0, MAX_CHUNK_CHARS);
}

/** 去掉 Markdown 表格分隔行与链接目标，降低噪声 */
function cleanLine(line: string): string {
  return line
    .replace(/\]\([^)]+\)/g, ']') // 链接 → 仅留文字
    .trimEnd();
}

/** 把一份 Markdown 按 ## 标题切块（### 归入所属 ##） */
function splitDoc(doc: string, md: string): DocChunk[] {
  const chunks: DocChunk[] = [];
  let curTitle = doc;
  let curLines: string[] = [];
  const flush = () => {
    const body = curLines.map(cleanLine).join('\n').trim();
    if (body) chunks.push({ doc, title: curTitle, content: clampChunk(body) });
  };
  for (const raw of md.split('\n')) {
    const m = raw.match(/^##\s+(.+)/);
    if (m) {
      flush();
      curTitle = m[1].trim();
      curLines = [];
    } else {
      curLines.push(raw);
    }
  }
  flush();
  return chunks;
}

/** 惰性构建的语料缓存（首次检索时按需加载文档 chunk；失败可重试） */
let chunksPromise: Promise<DocChunk[]> | null = null;

/**
 * 惰性加载并切分全部语料（每份文档单独 chunk，只在首次检索时下载）。
 * 返回同一 Promise，重复调用不重复加载。
 */
export function loadChunks(): Promise<DocChunk[]> {
  if (!chunksPromise) {
    chunksPromise = Promise.all(
      SOURCES.map(async ({ doc, file }) => splitDoc(doc, await loadDoc(file))),
    )
      .then((parts) => parts.flat())
      .catch((err) => {
        chunksPromise = null;
        throw err;
      });
  }
  return chunksPromise;
}

/* ------------------------------ 检索 ------------------------------ */

/** 提取查询词：中文按 2-gram + 原词，英文/数字按小写词元 */
export function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 2 && /[\u4e00-\u9fff]/.test(raw)) {
      // 中文词拆 2-gram（「共振峰」→ 共振/振峰/共振峰）
      terms.add(raw);
      for (let i = 0; i + 2 <= raw.length; i++) terms.add(raw.slice(i, i + 2));
    } else if (raw.length >= 2) {
      terms.add(raw);
    }
  }
  return [...terms];
}

function chunkScore(chunk: DocChunk, terms: string[]): number {
  const titleLower = (chunk.doc + ' ' + chunk.title).toLowerCase();
  const bodyLower = chunk.content.toLowerCase();
  let score = 0;
  for (const t of terms) {
    // 标题命中权重高
    if (titleLower.includes(t)) score += 5;
    // 正文命中按次数（封顶 5 次，防长块刷分）
    let hits = 0;
    let idx = bodyLower.indexOf(t);
    while (idx !== -1 && hits < 5) {
      hits++;
      idx = bodyLower.indexOf(t, idx + t.length);
    }
    score += hits * 2;
  }
  return score;
}

/** 检索结果的元信息（供「本轮上下文」面板展示） */
export interface RetrievedDocsMeta {
  text: string;
  docs: { title: string; chars: number }[];
}

/**
 * 检索与查询最相关的文档块（0–4 块，总分 > 0 才返回）。
 * 返回格式化好的系统提示注入段（含来源标注）与命中标题，供 UI 展示。
 * 文档按需加载：加载失败时返回空结果，静默跳过注入。
 */
export async function retrieveDocsDetailed(query: string, maxChunks = 4): Promise<RetrievedDocsMeta> {
  const terms = queryTerms(query);
  if (terms.length === 0) return { text: '', docs: [] };
  let chunks: DocChunk[];
  try {
    chunks = await loadChunks();
  } catch {
    return { text: '', docs: [] };
  }
  const scored = chunks
    .map((c) => ({ c, s: chunkScore(c, terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, maxChunks);
  if (scored.length === 0) return { text: '', docs: [] };
  const sections = scored
    .map(({ c }) => `### ${c.doc}｜${c.title}\n${c.content}`)
    .join('\n\n');
  return {
    text: `\n\n## 应用内置文档摘录（与问题相关时引用；这是本应用的官方文档，可信度高于你的先验知识；无关时忽略）\n${sections}`,
    docs: scored.map(({ c }) => ({ title: c.title, chars: c.content.length })),
  };
}

/** 只要注入文本（旧接口，等价于 retrieveDocsDetailed().text） */
export async function retrieveDocs(query: string, maxChunks = 4): Promise<string> {
  return (await retrieveDocsDetailed(query, maxChunks)).text;
}

/** 知识库是否可用（文档加载失败时返回 false，注入端静默跳过） */
export async function docsAvailable(): Promise<boolean> {
  try {
    return (await loadChunks()).length > 0;
  } catch {
    return false;
  }
}
