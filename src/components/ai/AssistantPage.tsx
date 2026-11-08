/**
 * AI 助手（大模型子页面入口的独立全屏页）
 * - 顶栏：左上退出 + 右上历史侧边栏开关
 * - 消息流：AI 气泡带头像（左）/ 用户气泡（右）；点按气泡在其下方浮出
 *   复制 / 重做 / 分支（重做 = 截断到该消息之前重新生成；分支 = 以该消息为
 *   结尾复制出一个新对话）
 * - 思考过程：推理模型（reasoning_content / thinking 块）的思考流式展示，
 *   完成后保存到消息里、点气泡内的「思考过程」可展开回看
 * - 底部输入栏：随内容自动增高（上限后内部滚动），生成中变为停止按钮
 * - 输入框为空且无光标时，右侧按钮切换为语音输入：按一下录音、再按一下
 *   结束；录音落历史记录，并把记录 id 交给助手分析后再自动发送
 * - 右侧抽屉：新建对话 + 搜索 + 历史列表（点按切换、重命名、导出 Markdown、
 *   两步删除）
 * 生成中关闭页面不中断请求（跑完照常写入对话，避免丢回复）；中途点停止会保留
 * 已生成部分并标注「已中断」，切换/新建/删除对话时同样收尾当前流。
 * 对话存 IndexedDB（llm:chats，封顶 30 条）；生成走活动档案（协议/流式/上下文
 * 均由档案决定），系统提示附用户画像、训练靶标、历史聚合、基线 Δ 与最近记录
 * 明细，按上下文预算裁剪。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  ArrowUp, Ban, Brain, ChevronDown, Copy, Download, GitBranch, Loader2, MoreHorizontal, PanelRight,
  Pencil, Plus, RotateCcw, Sparkles, Square, Trash2, AudioLines, ArrowLeft, Settings2, Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { isAbortError, languageName, llmChatStreamMessages, llmToolCall, type LlmConfig, type LlmToolSpec } from '@/lib/llm';
import { runAssistantTools } from '@/lib/assistantAgent';
import { ASSISTANT_DATA_TOOLS, runAssistantDataTool } from '@/lib/assistantTools';
import { ASSISTANT_ACTION_TOOLS, runAssistantActionTool, type AssistantAction } from '@/lib/assistantActions';
import { useActiveLlmConfig, DEFAULT_CONTEXT_TOKENS } from '@/lib/llmProfiles';
import { downloadBlob } from '@/lib/file';
import {
  addMessage, createChat, deleteChat, getChat, patchMessageContext, renameChat, saveAssistantDraft, setChatMemoryOff, setMessages,
  setPinnedRecords, useChats, type ChatContextMeta, type ChatConversation, type ChatMessage,
} from '@/lib/llmChats';
import { renderMarkdown } from '@/lib/markdown';
import { retrieveDocsDetailed } from '@/lib/docKnowledge';
import { buildMemoryPrompt, extractMemoryCandidates, loadMemories, memoryPromptBlock, memorySearchBlock, saveMemory, searchMemories, shouldAutoSaveMemory, undoMemoryWrite, MEMORY_KINDS, MEMORY_TEXT_MAX, type MemoryKind, type MemoryWrite } from '@/lib/memory';
import { SAVE_MEMORY_TOOL, MEMORY_WRITER_SYSTEM, MEMORY_MANUAL_SYSTEM, buildMemoryWriterInput, parseMemorySaveCall } from '@/lib/memoryTools';
import { buildAssistantContext, buildAssistantProfile, formatRecordLine } from '@/lib/assistantContext';
import {
  buildCommandCompletions, parseAssistantCommand, parseTestMode,
  recordsWithinLastDays, resolveRecordSelectors, reviewRangeDays,
  type CommandCompletion, type ParsedCommand,
} from '@/lib/assistantCommands';
import { RecordImage } from '@/lib/assistantCharts';
import { renderAssistantMessage } from '@/lib/assistantContent';
import { GenUiBlock } from '@/lib/assistantGenui';
import { ContextPanel } from '@/components/ai/ContextPanel';
import { MemorySavedChip } from '@/components/ai/MemorySavedChip';
import { ActionCard } from '@/components/ai/ActionCard';
import { QuickPrompts } from '@/components/ai/QuickPrompts';
import { Textarea } from '@/components/ui';
import { useStore } from '@/store/useStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { recorder } from '@/lib/audio/recorder';
import { maybeAutoBackup } from '@/lib/backup/local';
import { estimateTokens } from '@/lib/llmUsage';
import type { AnalysisRecord, TestMode } from '@/types';
import { cn } from '@/lib/utils';

/** Token 粗估：CJK 1 字 ≈ 1 token，其余 4 字符 ≈ 1 token（与用量统计同一口径） */
const estTokens = estimateTokens;

/** 记忆类型 → 词典键（气泡「记住」对话框共用设置页的分类） */
const MEMORY_KIND_KEYS = {
  fact: 'settings.memoryKindFact',
  preference: 'settings.memoryKindPreference',
  requirement: 'settings.memoryKindRequirement',
  caution: 'settings.memoryKindCaution',
} as const;

/** 用户可读的错误分类：401/403=密钥、429=限流、超时、网络、5xx=服务端不可用 */
type ErrorKind = 'auth' | 'rate' | 'timeout' | 'network' | 'server' | 'unknown';
interface AssistantError {
  kind: ErrorKind;
  detail: string;
  /** 本次请求实际使用的模型与主机（便于和别的客户端对比） */
  model?: string;
  host?: string;
}

function classifyError(err: unknown): AssistantError {
  const detail = err instanceof Error ? err.message : String(err);
  const s = detail.toLowerCase();
  const kind: ErrorKind = /http (401|403)\b/.test(s)
    || s.includes('invalid api key') || s.includes('unauthorized')
    || s.includes('authentication') || s.includes('api-key')
    ? 'auth'
    : /http 429\b/.test(s) || s.includes('rate limit') || s.includes('quota')
      || s.includes('insufficient_quota')
      ? 'rate'
      : s.includes('timeout') || /http (408|504)\b/.test(s)
        ? 'timeout'
        : s.includes('failed to fetch') || s.includes('networkerror')
          || s.includes('network error') || s.includes('econnrefused')
          || s.includes('load failed')
          ? 'network'
          // 5xx / 上游排队：服务端暂时不可用（503 queue is full 之类），重试即可
          : /http 5\d\d\b/.test(s) || s.includes('serviceunavailable')
            || s.includes('service unavailable') || s.includes('overloaded')
            || s.includes('queue is full') || s.includes('bad gateway')
            ? 'server'
            : 'unknown';
  return { kind, detail: detail.slice(0, 240) };
}

/** 触屏（粗指针）：Enter 保留换行，避免手机上误发 */
function coarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

/** 导出单条对话为 Markdown */
function chatToMarkdown(c: ChatConversation): string {
  const lines: string[] = [`# ${c.title || t('assistant.title')}`, ''];
  for (const m of c.messages) {
    if (m.draft) continue;
    lines.push(m.role === 'user' ? `## ${t('assistant.you')}` : `## ${t('assistant.title')}`, '');
    if (m.interrupted) lines.push(`> ${t('assistant.interrupted')}`, '');
    if (m.think) lines.push('<details><summary>' + t('assistant.think') + '</summary>', '', m.think, '', '</details>', '');
    lines.push(m.content, '');
  }
  return lines.join('\n');
}

/**
 * 读取全量历史记录并组装助手上下文：用户画像、聚合、基线 Δ 与最近明细。
 * 等待 hydrate 完成，避免应用刚启动时把空历史发给模型。
 */
/** 全量历史记录（IDB + 内存中刚写入的记录），供助手上下文与命令共用 */
async function loadAllRecords(): Promise<AnalysisRecord[]> {
  const store = useHistoryStore.getState();
  if (!store.ready) await store.hydrate();
  const stored = await store.getAllRecords();
  const byId = new Map(stored.map((r) => [r.id, r]));
  for (const r of useHistoryStore.getState().records) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 助手视觉规范：record:// 原生图表与 genui 组件的选择、语法与设计约束。
 * 这段会进入每次请求的系统提示词，保持结构化、可执行，避免模型输出
 * 数据编造、与主题冲突的配色或需要横向滚动的固定宽度组件。
 */
const ASSISTANT_VISUAL_GUIDE = [
  '【引用记录图表】',
  '- 语法严格为 ![一句说明](record://<记录id>/<kind>)；kind 只能是 pitch（音高）/ formant（F1/F2）/ energy（能量）/ vowel（元音散点）。',
  '- 记录 id 必须来自下方历史清单的「id」字段或【本轮工具查询结果】；没有可用记录时如实说明并请用户提供 id，绝不编造。',
  '- 图表是证据，不是装饰：放在相关结论之后；每条回复最多 2 张，同一记录最多 2 种图；不要每段都配图，也不要用文字重复图里已能看出的所有数字。',
  '- 说明文字要写「看什么」（如「句中段稳定在 150–170 Hz」），不要只写「图表」「F0 图」。',
  '- 不要用 genui 重画已有原生图表；不要把 record:// 放进 genui 或代码块。',
  '【genui 交互组件】',
  '- 只在原生图表 + Markdown 不够时使用：滑块、开关、对比切换、计算器、可点选面板；普通解释不要用 genui。',
  '- 用 ```genui 围栏包一个 HTML 片段；不要 doctype/html/head/body；不要外链资源、网络请求或表单提交；每条回复最多 2 个，单个 ≤ 48KB；可写内联 <style>/<script>（沙箱运行，不能访问应用数据）。',
  '- 外层卡片、背景、圆角、阴影由站点提供：根节点直接写内容，不要再包卡片/背景/阴影。',
  '- 颜色只用 CSS 变量：文字 --c-ink / --c-ink-2，主色 --c-accent，浅底 --c-accent-soft，卡片 --c-card，次级底 --c-surface-hi，分隔线 --c-line；透明度用 rgb(var(--c-xxx-rgb) / 0.1)。不要写死黑白/亮色，不要渐变或多套强调色，不要外链图片/字体/图标。',
  '- 版式：宽度 100%，不要固定宽度或横向滚动；内边距 12–14px，元素间距 8–12px，圆角 12–16px；正文 13px/1.6，标题 14px/600，辅助 11px，数字 tabular-nums；标题最多两级。',
  '- 尺寸自适应：高度由内容决定，不要写固定 height / min-height:100vh，也不要给内部容器 overflow:auto|scroll——组件内不允许出现任何滚动条；内容多就拆成分区或折叠，文字/表格用换行与收缩，绝不横向溢出。',
  '- 优先用站点类：.svt-title / .svt-muted / .svt-grid / .svt-metric / .svt-badge / .svt-row / .svt-row-between / .svt-bar；需要内部分区时才用 .svt-card。',
  '- 典型结构：.svt-row-between（标题 + 徽标）→ .svt-grid > .svt-metric（2–4 个指标）→ 控件 → .svt-muted（当前值/说明）；不要堆满整屏，信息密度留白。',
  '- 交互：按钮/输入继承主题色；触控区 ≥ 40px；状态不能只靠颜色，配文字或图标；动画 120–180ms，遵循 prefers-reduced-motion，不做无限动画。',
  '- 可访问性：语义标签、aria-label、可见 focus；布局适配 320–640px 任意宽度，越窄越紧凑（指标从 4 列自然降到 2 列），高度随内容自然增长，不要 100vh。',
  '- 数据必须来自历史记录，或明确标注「示例」；不要编造用户数据。',
  '【选择】单条记录的音高/共振峰/能量/元音优先用 record://；多记录对比、趋势、可调参数用 genui；纯文字能讲清就不用图表。',
].join('\n');

/**
 * 查询规划器提示：只决定是否调用只读工具，不负责最终回答。
 * 用户画像也放在这里，后续计划类工具需要知道训练方向与靶标。
 */
function toolPlannerSystem(settings: Parameters<typeof buildAssistantProfile>[0]): string {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return [
    '你是 AI 助手的查询规划器。只判断回答当前问题是否需要读取应用内的记录、文档或计划，并调用相应工具。',
    `今天是 ${date}。`,
    buildAssistantProfile(settings),
    '规则：需要用户的具体录音数据或官方文档时先查询；不要凭空编造记录 id、日期或指标；不要回答用户的问题，也不要解释。',
    '如果问题只是寒暄、常识或不需要应用数据，不要调用任何工具。',
  ].join('\n');
}

/** 助手系统提示词：定位与边界 + 历史记录使用规则 + 内置文档摘录 + 长期记忆，按界面语言回答 */
function systemPrompt(profile: string, history: string, docs = '', extra = '', memory = ''): string {
  return [
    '你是 Simple Voice Tool for Trans 内置的 AI 助手——一个严肃的嗓音测量、分析与训练追踪工具。',
    '不要使用 emoji 或颜文字；用文字、Markdown、图表和交互组件表达。',
    '回答简洁、务实、有依据；涉及嗓音训练时给出可操作的练习建议；',
    '不做医学诊断，遇到疑似嗓音疾病（持续嘶哑、疼痛等）时建议就医或咨询言语治疗师。',
    '记录里的底噪、麦克风、录音小时是自动采集的环境元数据：可用于解释数据可比性与可信度，缺失时不要假设，也不要据此做医学判断。',
    '回复支持 Markdown：可用 **粗体**、*斜体*、`行内代码`、有序/无序列表、表格（| 列 | 列 |）、> 引用与 ## 小标题，让长回答结构清晰；除 genui 组件外不要输出代码块。',
    ASSISTANT_VISUAL_GUIDE,
    profile,
    memory,
    '如果用户要求你记住某事，或用户陈述了值得长期保留的偏好、要求或注意事项，用一句自包含的话复述要点；也可以请对方点消息下方的「记住」手动确认。系统会在回答后自动判断是否保存长期记忆；你没有直接写入记忆的工具，不要声称你已经记住。',
    history
      ? '下方附有用户的历史测试记录：回答趋势、进步与训练计划类问题时引用它们；记录里没有的指标如实说明，不要编造。'
      : '',
    history,
    docs,
    extra,
    `使用「${languageName()}」回答。`,
  ].filter(Boolean).join('\n');
}

/** 记忆检索路由器：只决定是否需要长期记忆，并给出检索词 */
const MEMORY_ROUTER_SYSTEM = [
  '你是 AI 助手的记忆检索路由器。只判断：回答用户当前这句话，是否需要用户的长期记忆（个人事实、偏好、要求、注意事项）。',
  '需要：调用 search_memory，query 用 2–8 个关键词或用户原话中的关键短语。',
  '不需要：不要调用任何工具，只回复 NO。',
  '不要回答用户的问题，不要解释。',
].join('\n');

const MEMORY_SEARCH_TOOL: LlmToolSpec = {
  name: 'search_memory',
  description: '按关键词检索用户的长期记忆（个人事实、偏好、要求、注意事项）。当回答依赖用户过去说过的个人信息时调用。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '2–8 个关键词，或用户原话中的关键短语' },
    },
    required: ['query'],
  },
};

/**
 * 按需记忆：置顶记忆固定注入；非置顶记忆由模型通过 search_memory 工具按需检索。
 * 服务商不支持 tools / 请求失败时回退旧的「按问题关键词自动注入」，保证仍有上下文。
 */
async function resolveMemoryContext(
  cfg: LlmConfig,
  history: ChatMessage[],
  lastUser: ChatMessage | undefined,
): Promise<{ text: string; count: number; query?: string }> {
  const list = await loadMemories();
  const pinned = list.filter((m) => m.pinned);
  let text = memoryPromptBlock(pinned);
  let count = pinned.length;
  let query: string | undefined;
  if (!lastUser || !list.some((m) => !m.pinned)) return { text, count };

  const recent = history
    .slice(-4)
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content.slice(0, 400)}`)
    .join('\n');
  try {
    const calls = await llmToolCall(
      cfg,
      MEMORY_ROUTER_SYSTEM,
      `最近对话：\n${recent}\n\n当前问题：${lastUser.content}`,
      [MEMORY_SEARCH_TOOL],
      { feature: 'assistant', maxTokens: 200, temperature: 0 },
    );
    const call = calls.find((c) => c.name === 'search_memory');
    if (!call) return { text, count };
    const q = typeof call.arguments.query === 'string' ? call.arguments.query.trim() : '';
    query = (q || lastUser.content).slice(0, 120);
    const found = await searchMemories(query);
    if (found.length > 0) {
      text = [text, memorySearchBlock(found, query)].filter(Boolean).join('\n\n');
      count += found.length;
    }
    return { text, count, query };
  } catch {
    // 没有工具能力（或预检失败）：退回本轮按问题自动筛选，避免记忆直接失效
    const fallback = await buildMemoryPrompt(lastUser.content);
    return { text: fallback.text, count: fallback.count };
  }
}


/** 气泡操作按钮（模块级：定义在组件体内会让整条消息流每次渲染重挂载） */
function ActionBtn({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-full bg-card px-2.5 py-1.5 text-[10px] font-medium text-ink-2 shadow-[0_1px_6px_rgba(28,25,45,0.08)] transition-transform active:scale-90"
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

/** 思考过程块（可内嵌「本次注入」面板：上下文信息并入思考展开区） */
function ThinkBlock({
  text,
  live,
  children,
}: {
  text: string;
  live?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2 rounded-xl bg-black/[0.04] px-2.5 py-2 text-left">
      {text ? (
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2">
          {text}
        </p>
      ) : live ? (
        <p className="text-[11px] italic leading-relaxed text-ink-2">{t('assistant.thinking')}</p>
      ) : null}
      {children}
    </div>
  );
}

/** 消息正文：record:// 图表 / genui 组件独立成块，其余 Markdown（解析结果随文本缓存） */
const MessageBody = memo(function MessageBody({ text }: { text: string }) {
  const parts = useMemo(() => renderAssistantMessage(text), [text]);
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'img' && p.kind && p.recordId) {
          return <RecordImage key={i} recordId={p.recordId} kind={p.kind} alt={p.alt ?? ''} />;
        }
        if (p.type === 'genui') {
          return <GenUiBlock key={i} html={p.content} />;
        }
        if (p.type === 'genui-pending') {
          return (
            <span key={i} className="my-2 flex items-center gap-1.5 rounded-2xl bg-card px-3 py-2 text-[11px] text-ink-2">
              <Loader2 size={11} className="animate-spin" />
              {t('assistant.genuiPending')}
            </span>
          );
        }
        return (
          <span key={i} className="block [&>p]:my-1 [&>ul]:my-1.5 [&>ol]:my-1.5 [&_blockquote]:my-2 [&_table]:my-2">
            {renderMarkdown(p.content)}
          </span>
        );
      })}
    </>
  );
});

/** 消息气泡（模块级 + memo：流式时只有正在生成的那一条重渲染） */
const Bubble = memo(function Bubble({
  m,
  idx,
  chatId,
  streaming = false,
  liveThink = '',
  active,
  thinkOpen,
  onAction,
  onToggleThink,
  onCopy,
  onRedo,
  onBranch,
  onMemory,
}: {
  m: ChatMessage;
  idx: number;
  chatId?: string;
  streaming?: boolean;
  liveThink?: string;
  /** 操作行是否展开（非流式） */
  active: boolean;
  /** 思考块是否展开（非流式） */
  thinkOpen: boolean;
  onAction: (idx: number | null) => void;
  onToggleThink: (idx: number) => void;
  onCopy: (idx: number) => void;
  onRedo: (idx: number) => void;
  onBranch: (idx: number) => void;
  onMemory: (idx: number) => void;
}) {
  useI18n();
  const mine = m.role === 'user';
  const think = streaming ? liveThink : m.think ?? '';
  const ctx = m.context;
  const hasContext = !!ctx && (
    (ctx.recordIds?.length ?? 0) > 0
    || (ctx.pinnedIds?.length ?? 0) > 0
    || (ctx.docs?.length ?? 0) > 0
    || (ctx.memories ?? 0) > 0
    || !!ctx.memoryQuery
    || (ctx.toolCalls?.length ?? 0) > 0
  );
  const hasMeta = !streaming && (!!m.think || hasContext);
  const onBodyClick = () => onAction(streaming ? null : active ? null : idx);
  const body = (
    <>
      {!mine && streaming && think && <ThinkBlock text={think} live />}
      {!mine && !streaming && thinkOpen && (!!m.think || !!m.context) && (
        <ThinkBlock text={m.think ?? ''}>
          {m.context && (
            <div className={cn(m.think && 'mt-2 border-t border-line/60 pt-2')}>
              <ContextPanel meta={m.context} />
            </div>
          )}
        </ThinkBlock>
      )}
      {mine
        ? (m.content || (streaming ? (liveThink ? '' : '…') : ''))
        : (m.content
          ? <MessageBody text={m.content} />
          : (streaming ? (liveThink ? '' : '…') : ''))}
      {!mine && !streaming && (m.context?.memoryWrites?.length ?? 0) > 0 && (
        <MemorySavedChip
          chatId={chatId}
          messageIndex={idx}
          writes={m.context?.memoryWrites ?? []}
        />
      )}
      {!mine && !streaming && (m.context?.pendingAction || m.context?.appliedAction) && (
        <ActionCard
          chatId={chatId}
          messageIndex={idx}
          action={m.context?.pendingAction}
          applied={m.context?.appliedAction}
        />
      )}
      {hasMeta && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleThink(idx);
          }}
          aria-expanded={thinkOpen}
          className="mt-2 inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-ink-2 transition-colors hover:bg-surface-hi/60 hover:text-ink"
        >
          <Brain size={10} />
          {m.think ? t('assistant.think') : t('assistant.ctx.title')}
          <ChevronDown size={10} className={cn('transition-transform', thinkOpen && 'rotate-180')} />
        </button>
      )}
      {!mine && m.interrupted && (
        <p className="mt-1 text-[10px] text-ink-2/70">{t('assistant.interrupted')}</p>
      )}
    </>
  );
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      {!mine && (
        <span className="mb-1 flex items-center gap-1.5">
          <span className="grid size-6 place-items-center rounded-full bg-accent/15 text-accent">
            <Sparkles size={13} />
          </span>
          <span className="text-[10px] font-medium text-ink-2">{t('assistant.title')}</span>
        </span>
      )}
      {mine ? (
        <button
          onClick={onBodyClick}
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent/15 px-3.5 py-2.5 text-left text-[13px] leading-relaxed text-ink shadow-[0_2px_10px_rgba(28,25,45,0.05)]"
        >
          {body}
        </button>
      ) : (
        <div
          onClick={onBodyClick}
          className="w-full text-left text-[13px] leading-relaxed text-ink"
        >
          {body}
        </div>
      )}
      {active && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="mt-1.5 flex items-center gap-1.5"
        >
          <ActionBtn icon={Copy} label={t('assistant.copy')} onClick={() => onCopy(idx)} />
          {!mine && !streaming && (
            <ActionBtn icon={Brain} label={t('assistant.memorySave')} onClick={() => onMemory(idx)} />
          )}
          {!streaming && <ActionBtn icon={RotateCcw} label={t('assistant.redo')} onClick={() => onRedo(idx)} />}
          {!streaming && <ActionBtn icon={GitBranch} label={t('assistant.branch')} onClick={() => onBranch(idx)} />}
        </motion.div>
      )}
    </div>
  );
});

export function AssistantPage() {
  useI18n();
  const settings = useStore((s) => s.settings);
  const aiWorkspace = settings.navStyle === 'ai';
  const classicNav = settings.navStyle === 'classic';
  const activeProfileId = useStore((s) => s.settings.llmActiveProfileId);
  const setTab = useStore((s) => s.setTab);
  const lastTab = useStore((s) => s.lastTab);
  const setCurrentAnalysis = useStore((s) => s.setCurrentAnalysis);
  const cfg = useActiveLlmConfig(activeProfileId);
  const chats = useChats();
  /** null = 尚未开始对话（发送第一条时创建） */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** 新建对话时是否默认关闭自动记忆（发送第一条消息时写入对话） */
  const [draftMemoryOff, setDraftMemoryOff] = useState(false);
  const [input, setInput] = useState('');
  /** null = 空闲；否则为流式累积文本 */
  const [streamText, setStreamText] = useState<string | null>(null);
  /** 工具查询中的状态提示（null = 没有在执行工具） */
  const [toolNote, setToolNote] = useState<string | null>(null);
  /** 流式思考累积文本（推理模型） */
  const [streamThink, setStreamThink] = useState('');
  /** 展开思考过程的持久化消息下标 */
  const [thinkIdx, setThinkIdx] = useState<number | null>(null);
  const [error, setError] = useState<AssistantError | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 点按气泡浮出操作行的消息下标 */
  const [actionIdx, setActionIdx] = useState<number | null>(null);
  /** 「记住」对话框：待确认的长期记忆草稿（loading = AI 正在提炼候选） */
  const [memoryDraft, setMemoryDraft] = useState<{
    text: string;
    kind: MemoryKind;
    pinned: boolean;
    loading: boolean;
    /** 来源消息，保存后写入对应气泡的「已记住」chip */
    chatId?: string;
    messageIndex?: number;
    quote?: string;
  } | null>(null);
  /** 侧边栏两步删除的待确认对话 id */
  const [delId, setDelId] = useState<string | null>(null);
  /** 侧边栏：搜索词 / 展开操作菜单的对话 id / 重命名中的对话 id */
  const [chatQuery, setChatQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  /** 「记住」候选请求序号：关闭/重新打开后，忽略上一次迟到的 AI 结果 */
  const memoryDraftReq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** 输入框是否有光标：无光标且为空时，右侧按钮切换为语音输入 */
  const [inputFocused, setInputFocused] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'starting' | 'recording' | 'processing'>('idle');
  const [voiceSec, setVoiceSec] = useState(0);
  const voiceActiveRef = useRef(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const historyRecords = useHistoryStore((s) => s.records);

  const conv = activeId ? chats?.find((c) => c.id === activeId) ?? null : null;
  /** 末尾的流式草稿由「正在生成」气泡显示，列表里隐藏以免重复 */
  const messages = useMemo(() => {
    const all = conv?.messages ?? [];
    return all.length && all[all.length - 1].draft ? all.slice(0, -1) : all;
  }, [conv]);
  const busy = streamText !== null || toolNote !== null;
  const pinnedIds = conv?.pinnedRecordIds ?? [];

  /** 侧边栏搜索：匹配标题或任意一条用户消息 */
  const visibleChats = useMemo(() => {
    const list = chats ?? [];
    const q = chatQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.title.toLowerCase().includes(q)
      || c.messages.some((m) => m.role === 'user' && m.content.toLowerCase().includes(q)));
  }, [chats, chatQuery]);

  /**
   * 气泡回调经 ref 转发：Bubble 用 memo 后只在内容变化时重渲染，
   * 但回调闭包始终指向本次渲染的最新状态（避免 busy 等状态陈旧）。
   */
  const actionsRef = useRef<{
    copy: (idx: number) => void;
    redo: (idx: number) => void;
    branch: (idx: number) => void;
    memory: (idx: number) => void;
  }>({ copy: () => {}, redo: () => {}, branch: () => {}, memory: () => {} });
  const onCopy = useCallback((idx: number) => actionsRef.current.copy(idx), []);
  const onRedo = useCallback((idx: number) => actionsRef.current.redo(idx), []);
  const onBranch = useCallback((idx: number) => actionsRef.current.branch(idx), []);
  const onMemory = useCallback((idx: number) => actionsRef.current.memory(idx), []);
  const onToggleThink = useCallback((idx: number) => {
    setThinkIdx((cur) => (cur === idx ? null : idx));
  }, []);

  // 自动滚底：仅当用户本来就贴近底部时跟随（上翻历史时不打扰）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamText, streamThink]);

  // 输入栏随内容增高：上限约 35% 视口高（约 240px 封顶），
  // 超过后内部滚动但隐藏滚动条——手机与桌面都不出现可见滚动条。
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      const cap = Math.max(96, Math.min(240, Math.round(window.innerHeight * 0.35)));
      el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [input]);

  // 语音输入计时（录音仍是全局音频管线，但这里不进入分析页）
  useEffect(() => {
    if (voiceState !== 'recording') return;
    const id = window.setInterval(() => setVoiceSec(Math.floor(recorder.getLive().elapsedSec)), 250);
    return () => window.clearInterval(id);
  }, [voiceState]);

  // 离开页面时若还在录音：收尾并落库，避免音频上下文悬挂
  useEffect(() => () => {
    if (!voiceActiveRef.current) return;
    voiceActiveRef.current = false;
    const raw = recorder.stop();
    if (!raw) return;
    void recorder.finishRecord(raw)
      .then(({ record, audio }) => useHistoryStore.getState().addRecord(record, audio ?? undefined))
      .catch(() => undefined);
  }, []);

  // 手机软键盘：visual viewport 会向上平移（offsetTop > 0），
  // 固定外壳如果仍贴在布局视口 top:0，顶栏就会被推出可视区域。
  // 始终跟随 offsetTop，只改 top，底栏让位仍交给 CSS。
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const el = shellRef.current;
      if (!el) return;
      const offset = Math.max(0, vv.offsetTop);
      el.style.top = offset > 0 ? `${offset}px` : '';
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  /**
   * 回答完成后让 AI 自己判断这轮是否值得存入长期记忆；有则智能入库。
   * - 自动保存关闭 / 临时会话 / 纯寒暄与提问：不调用写作模型
   * - 写入结果显示在消息下方的「已记住」chip，toast 与 chip 都可撤销
   */
  const autoSaveMemories = async (
    chatId: string,
    messageIndex: number,
    userText: string,
    assistantText: string,
  ) => {
    if (!cfg || !assistantText.trim()) return;
    const settings = useStore.getState().settings;
    if (settings.memoryAutoSave === 'off') return;
    if (getChat(chatId)?.memoryOff) return;
    if (!shouldAutoSaveMemory(userText)) return;
    try {
      const calls = await llmToolCall(
        cfg,
        MEMORY_WRITER_SYSTEM,
        buildMemoryWriterInput(userText, assistantText),
        [SAVE_MEMORY_TOOL],
        { feature: 'assistant', maxTokens: 300, temperature: 0.2 },
      );
      const saves = calls
        .map(parseMemorySaveCall)
        .filter((x): x is NonNullable<typeof x> => !!x)
        .slice(0, 3);
      const writes: MemoryWrite[] = [];
      for (const s of saves) {
        const res = await saveMemory({
          ...s,
          source: { chatId, messageIndex, quote: userText.slice(0, 240) },
        });
        if (res && res.action !== 'duplicate') {
          writes.push({
            id: res.item.id,
            text: res.item.text,
            action: res.action,
            beforeItem: res.beforeItem,
          });
        }
      }
      if (writes.length === 0) return;
      const prev = getChat(chatId)?.messages[messageIndex]?.context?.memoryWrites ?? [];
      const undo = () => {
        for (const write of writes) void undoMemoryWrite(write);
        patchMessageContext(chatId, messageIndex, { memoryWrites: prev });
      };
      patchMessageContext(chatId, messageIndex, { memoryWrites: [...prev, ...writes] });
      toast.success(t('assistant.memoryAutoSaved', { n: writes.length }), {
        action: { label: t('common.undo'), onClick: undo },
      });
    } catch {
      /* 工具不支持 / 网络失败：不打断回答 */
    }
  };

  const generate = async (convId: string, history: ChatMessage[], extraContext = '') => {
    if (!cfg || history.length === 0) return;
    // 上下文预算：历史记录摘要 + 系统提示 + 对话 + 回复余量都要装进窗口。
    // 历史记录预算自适应：对话越短分给记录摘要越多（旧实现固定 40%，
    // 明明装得下的旧记录也被裁掉，导致 AI 读不到全部历史）
    const context = cfg.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
    const replyReserve = Math.ceil(context * 0.25);
    const convTokens = history.reduce((n, x) => n + estTokens(x.content), 0);
    const extraTokens = estTokens(extraContext);
    const histBudget = Math.max(
      0,
      Math.min(
        Math.floor(context * 0.6),
        context - convTokens - replyReserve - extraTokens - 512,
      ),
    );
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    // 数据工具：先让模型决定是否查记录 / 文档，再组装最终上下文。
    // 工具可用时不再逐条注入最近记录，只保留画像、聚合与基线，省 token。
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const records = await loadAllRecords();
    let toolRun: {
      supported: boolean;
      contextText: string;
      traces: { name: string; summary: string; ok: boolean; ms: number }[];
      recordIds: string[];
      docs: { title: string; chars: number }[];
      pendingAction?: AssistantAction;
    } = { supported: false, contextText: '', traces: [], recordIds: [], docs: [] };
    if (lastUser) {
      setToolNote(t('assistant.toolSearching'));
      try {
        toolRun = await runAssistantTools({
          cfg,
          system: toolPlannerSystem(settings),
          history,
          userText: lastUser.content,
          tools: [...ASSISTANT_DATA_TOOLS, ...ASSISTANT_ACTION_TOOLS],
          execute: async (name, args) => (
            await runAssistantDataTool(name, args, { records, settings })
            ?? runAssistantActionTool(name, args, { records, settings })
          ),
          signal: controller.signal,
        });
      } finally {
        setToolNote(null);
      }
    }
    const hist = buildAssistantContext(
      records,
      settings,
      histBudget,
      getChat(convId)?.pinnedRecordIds ?? [],
      { includeDetails: !toolRun.supported },
    );
    // 内置文档检索：工具没有主动查文档时，再用最近一条用户消息做一次预检索
    const docHitPromise: Promise<{ text: string; docs: { title: string; chars: number }[] }> = lastUser && toolRun.docs.length === 0
      ? retrieveDocsDetailed(lastUser.content)
      : Promise.resolve({ text: '', docs: [] });
    // 长期记忆：置顶固定注入；其余由模型按需调用 search_memory，按需注入
    const memoryHit = await resolveMemoryContext(cfg, history, lastUser);
    const docHit = await docHitPromise;
    const extraAll = [extraContext, toolRun.contextText].filter(Boolean).join('\n\n');
    const sys = systemPrompt(hist.profile, hist.history, docHit.text, extraAll, memoryHit.text);
    // 本轮真正注入的上下文：消息落库后，气泡下方的「本轮上下文」面板据此展示
    const seenDocs = new Set<string>();
    const docs = [...docHit.docs, ...toolRun.docs].filter((d) => {
      if (seenDocs.has(d.title)) return false;
      seenDocs.add(d.title);
      return true;
    });
    const contextMeta: ChatContextMeta = {
      recordIds: [...new Set([...hist.meta.detailIds, ...toolRun.recordIds])],
      pinnedIds: hist.meta.pinnedIds,
      totalRecords: hist.meta.totalRecords,
      docs,
      memories: memoryHit.count,
      memoryQuery: memoryHit.query,
      ...(toolRun.traces.length > 0 ? { toolCalls: toolRun.traces } : {}),
      ...(toolRun.pendingAction ? { pendingAction: toolRun.pendingAction } : {}),
    };
    const reserve = estTokens(sys) + replyReserve;
    let turns = history;
    const maxTok = Math.max(1024, context - reserve);
    const totalOf = (ts: ChatMessage[]) => ts.reduce((n, x) => n + estTokens(x.content), 0);
    // 从最旧开始裁剪；保证 user 开头（Anthropic 要求 user/assistant 交替且以 user 起始）
    while (turns.length > 1 && totalOf(turns) > maxTok) turns = turns.slice(1);
    if (turns[0]?.role !== 'user') turns = turns.slice(1);
    if (turns.length === 0) {
      if (abortRef.current === controller) abortRef.current = null;
      return;
    }

    setStreamText('');
    setStreamThink('');
    stickRef.current = true;
    let thinkAcc = '';
    let textAcc = '';
    // 流式草稿节流落库（1.5s 或 200 字符）：切页 / 杀进程 / 崩溃也能留下已生成部分
    let lastDraftAt = 0;
    let savedLen = 0;
    const persistDraft = () => {
      if (!textAcc && !thinkAcc) return;
      const now = Date.now();
      if (now - lastDraftAt < 1500 && textAcc.length - savedLen < 200) return;
      lastDraftAt = now;
      savedLen = textAcc.length;
      saveAssistantDraft(convId, {
        content: textAcc,
        think: thinkAcc,
        draft: true,
        context: contextMeta,
      });
    };
    try {
      const reply = await llmChatStreamMessages(cfg, turns, {
        feature: 'assistant',
        signal: controller.signal,
        system: sys,
        onDelta: (acc) => {
          textAcc = acc;
          setStreamText(acc);
          persistDraft();
        },
        onThink: (acc) => {
          thinkAcc = acc;
          setStreamThink(acc);
          persistDraft();
        },
      });
      saveAssistantDraft(convId, {
        content: reply,
        think: thinkAcc,
        draft: false,
        context: contextMeta,
      });
      // AI 自动判断并保存长期记忆（后台；失败不影响回答）
      const assistantIndex = (getChat(convId)?.messages.length ?? 1) - 1;
      if (lastUser) void autoSaveMemories(convId, assistantIndex, lastUser.content, reply);
    } catch (err: unknown) {
      // 中止或报错：保留已经输出的部分，标注「已中断」，不白丢这段内容
      if (textAcc || thinkAcc) {
        saveAssistantDraft(convId, {
          content: textAcc,
          think: thinkAcc,
          draft: false,
          interrupted: true,
          context: contextMeta,
        });
      }
      if (!isAbortError(err)) {
        const info = classifyError(err);
        let host = '';
        try {
          host = new URL(cfg.baseUrl).host;
        } catch {
          host = cfg.baseUrl;
        }
        setError({ ...info, model: cfg.modelId, host });
      }
    } finally {
      setStreamText(null);
      setStreamThink('');
      // 切换对话时可能已经开始了新的生成：只清自己这个 controller
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  /** 发送一条文本消息（文本输入、语音和命令共用） */
  const sendMessage = (raw: string, extraContext = '') => {
    const text = raw.trim();
    if (!text || busy || !cfg) return;
    setInput('');
    let convId = activeId;
    if (!convId) {
      convId = createChat('', [], { memoryOff: draftMemoryOff });
      setActiveId(convId);
      setDraftMemoryOff(false);
    }
    addMessage(convId, { role: 'user', content: text });
    void generate(
      convId,
      getChat(convId)?.messages ?? [{ role: 'user', content: text }],
      extraContext,
    );
  };

  /** 语音输入：本地录音 → 保存历史 → 把分析结果通过记录 id 交给助手 */
  const startVoice = async (mode: TestMode = 'reading') => {
    if (voiceState !== 'idle') return;
    const st = useStore.getState();
    if (st.isRecording) return;
    setVoiceState('starting');
    setVoiceSec(0);
    taRef.current?.blur();
    const s = st.settings;
    try {
      await recorder.start({
        deviceId: s.micDeviceId || undefined,
        silenceStopSec: 0,
        targetRange: s.targetEnabled ? [s.targetF0Min, s.targetF0Max] : null,
        mode,
        saveAudio: s.audioSave,
        micEnhance: s.micEnhance,
        audioBitrateKbps: s.audioBitrateKbps,
      });
      voiceActiveRef.current = true;
      setVoiceState('recording');
      if (s.haptics) navigator.vibrate?.(30);
    } catch (err) {
      console.error('语音输入启动失败:', err);
      setVoiceState('idle');
      toast.error(t('toast.micError'));
    }
  };

  const stopVoice = async () => {
    if (voiceState !== 'recording') return;
    setVoiceState('processing');
    voiceActiveRef.current = false;
    const st = useStore.getState();
    try {
      const raw = recorder.stop();
      if (!raw) {
        toast.error(t('toast.tooShort'));
        setVoiceState('idle');
        return;
      }
      if (st.settings.haptics) navigator.vibrate?.(20);
      const { record, audio } = await recorder.finishRecord(raw);
      useHistoryStore.getState().addRecord(record, audio ?? undefined);
      void maybeAutoBackup('record');
      setVoiceState('idle');
      setVoiceSec(0);
      sendMessage(t('assistant.voicePrompt', {
        id: record.id,
        duration: Math.round(record.stats.durationSec),
      }));
    } catch (err) {
      console.error('语音输入收尾失败:', err);
      setVoiceState('idle');
      toast.error(t('toast.micError'));
    }
  };

  /** 命令执行：本地动作、会话上下文或提示请求都在这里分派 */
  const executeCommand = async (cmd: ParsedCommand) => {
    if (cmd.id === 'unknown') {
      toast.error(t('assistant.cmd.unknown'));
      return;
    }
    if (busy && cmd.id !== 'stop' && cmd.id !== 'help') {
      toast.info(t('assistant.cmd.busy'));
      return;
    }
    setCommandDismissed(true);
    const currentChat = () => {
      if (activeId && getChat(activeId)) return activeId;
      const id = createChat('');
      setActiveId(id);
      return id;
    };
    const records = async () => loadAllRecords();
    const pinnedOf = (id: string) => getChat(id)?.pinnedRecordIds ?? [];

    switch (cmd.id) {
      case 'help':
        setInput('/');
        setCommandIndex(0);
        setCommandDismissed(false);
        requestAnimationFrame(() => taRef.current?.focus());
        return;

      case 'new':
        newChat();
        setInput('');
        return;

      case 'record': {
        const mode = parseTestMode(cmd.args[0]);
        if (!mode) {
          toast.error(t('assistant.cmd.badArgs'));
          return;
        }
        setInput('');
        await startVoice(mode);
        return;
      }

      case 'stop':
        if (voiceState === 'recording') await stopVoice();
        else if (busy) abortRef.current?.abort();
        setInput('');
        return;

      case 'attach': {
        const selectors = cmd.args.length ? cmd.args : ['latest'];
        const matched = resolveRecordSelectors(
          selectors,
          await records(),
          settings.baselineRecordId,
        );
        if (!matched.length) {
          toast.error(t('assistant.cmd.noRecords'));
          return;
        }
        const id = currentChat();
        setPinnedRecords(id, [...pinnedOf(id), ...matched.map((r) => r.id)]);
        setInput('');
        toast.success(t('assistant.cmd.attached', { n: matched.length }));
        return;
      }

      case 'detach': {
        if (!activeId) {
          setInput('');
          return;
        }
        const current = pinnedOf(activeId);
        if (!cmd.args.length || cmd.args[0].toLowerCase() === 'all') {
          setPinnedRecords(activeId, []);
        } else {
          const matched = resolveRecordSelectors(
            cmd.args,
            await records(),
            settings.baselineRecordId,
          );
          const drop = new Set(matched.map((r) => r.id));
          setPinnedRecords(activeId, current.filter((rid) => !drop.has(rid)));
        }
        setInput('');
        toast.success(t('assistant.cmd.detached'));
        return;
      }

      case 'compare': {
        const selectors = cmd.args.length >= 2 ? cmd.args : ['last:2'];
        const matched = resolveRecordSelectors(
          selectors,
          await records(),
          settings.baselineRecordId,
        );
        if (matched.length < 2) {
          toast.error(t('assistant.cmd.needTwo'));
          return;
        }
        const pair = matched.slice(-2);
        const extra = [
          '## 命令附加上下文（/compare）',
          ...pair.map((r) => formatRecordLine(r)),
        ].join('\n');
        setInput('');
        sendMessage(t('assistant.cmd.compareAsk', {
          a: pair[0].id,
          b: pair[1].id,
        }), extra);
        return;
      }

      case 'review': {
        const range = reviewRangeDays(cmd.args[0]);
        const all = await records();
        const filtered = recordsWithinLastDays(all, range.days);
        if (!filtered.length) {
          toast.error(t('assistant.cmd.noRecords'));
          return;
        }
        const rangeKey = range.key === 'today'
          ? 'assistant.cmd.rangeToday'
          : range.key === 'month'
            ? 'assistant.cmd.rangeMonth'
            : range.key === 'all'
              ? 'assistant.cmd.rangeAll'
              : 'assistant.cmd.rangeWeek';
        // /review all 可能覆盖大量记录：明细只装预算内的最近部分，
        // 其余由上方聚合与周趋势承担，避免系统提示超出模型上下文窗口。
        const contextTokens = cfg?.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
        const detailBudget = Math.max(300, Math.min(2400, Math.floor(contextTokens * 0.25)));
        const lines: string[] = [];
        let used = 0;
        for (let i = filtered.length - 1; i >= 0; i -= 1) {
          const line = formatRecordLine(filtered[i]);
          const cost = estimateTokens(line) + 2;
          if (used + cost > detailBudget) break;
          used += cost;
          lines.unshift(line);
        }
        const omitted = filtered.length - lines.length;
        const extra = [
          `## 命令范围（/review）`,
          `范围：${t(rangeKey)}，记录 ${filtered.length} 条`,
          omitted > 0
            ? `以下为最近 ${lines.length} 条明细，其余 ${omitted} 条请依据上方聚合与周趋势回答：`
            : `以下为该范围内全部记录的单行明细（时间从旧到新）：`,
          ...lines,
        ].join('\n');
        setInput('');
        sendMessage(t('assistant.cmd.reviewAsk', { range: t(rangeKey) }), extra);
        return;
      }

      case 'open': {
        const page = (cmd.args[0] ?? '').toLowerCase();
        if (page === 'analysis') {
          const selector = cmd.args[1] ?? 'latest';
          const matched = resolveRecordSelectors(
            [selector],
            await records(),
            settings.baselineRecordId,
          );
          const rec = matched[matched.length - 1];
          if (!rec) {
            toast.error(t('assistant.cmd.noRecords'));
            return;
          }
          setCurrentAnalysis(rec);
          setTab('analysis');
          setInput('');
          return;
        }
        if (page === 'records' || page === 'history') {
          setTab('history');
          setInput('');
          return;
        }
        if (page === 'settings') {
          setTab('settings');
          setInput('');
          return;
        }
        toast.error(t('assistant.cmd.badArgs'));
        return;
      }

      default:
        toast.error(t('assistant.cmd.unknown'));
    }
  };

  /** 应用补全：命令项补全命令名，参数项补全参数并继续等待下一个参数 */
  const applyCompletion = (item: CommandCompletion) => {
    if (item.kind === 'command' && !item.insert.endsWith(' ')) {
      const parsed = parseAssistantCommand(item.insert);
      if (parsed) {
        void executeCommand(parsed);
        return;
      }
    }
    setInput(item.insert);
    setCommandIndex(0);
    setCommandDismissed(false);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const send = () => {
    const parsed = parseAssistantCommand(input);
    if (parsed) {
      void executeCommand(parsed);
      return;
    }
    sendMessage(input);
  };

  /** 重做：截断到该消息之前重新生成（用户消息会原样重发） */
  const redo = (idx: number) => {
    if (!conv || busy) return;
    const kept = conv.messages.slice(0, idx);
    const target = conv.messages[idx];
    setActionIdx(null);
    setThinkIdx(null);
    if (target.role === 'user') {
      setMessages(conv.id, kept);
      addMessage(conv.id, { role: 'user', content: target.content });
      void generate(conv.id, [...kept, { role: 'user', content: target.content }]);
    } else {
      setMessages(conv.id, kept);
      void generate(conv.id, kept);
    }
  };

  /** 分支：以该消息为结尾复制出一个新对话并切换过去 */
  const branch = (idx: number) => {
    if (!conv || busy) return;
    const id = createChat(
      conv.title ? `${conv.title} · ${t('assistant.branch')}` : t('assistant.title'),
      conv.messages.slice(0, idx + 1),
      { memoryOff: conv.memoryOff },
    );
    setActiveId(id);
    setActionIdx(null);
    setThinkIdx(null);
    setSidebarOpen(false);
    toast.success(t('assistant.branchDone'));
  };

  const copy = async (idx: number) => {
    const text = conv?.messages[idx]?.content;
    setActionIdx(null);
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('assistant.copied'));
    } catch {
      /* 剪贴板不可用（权限/非安全上下文）时静默 */
    }
  };

  /** 关闭「记住」弹窗，并让仍在路上的 AI 候选作废 */
  const closeMemoryDraft = useCallback(() => {
    memoryDraftReq.current += 1;
    setMemoryDraft(null);
  }, []);

  /** 把助手回复存为长期记忆：先让 AI 提炼一条候选，再打开可编辑确认框 */
  const remember = (idx: number) => {
    const target = conv?.messages[idx];
    setActionIdx(null);
    setThinkIdx(null);
    if (!target || target.role !== 'assistant') return;
    const priorUser = [...(conv?.messages ?? [])]
      .slice(0, idx)
      .reverse()
      .find((m) => m.role === 'user')?.content ?? '';
    // 工具不可用时的本地兜底：用户自己消息里带线索词的那句；没有就留空让用户手写
    const fallback = extractMemoryCandidates([priorUser], 1)[0]?.text ?? '';
    const req = ++memoryDraftReq.current;
    setMemoryDraft({
      text: fallback,
      kind: 'fact',
      pinned: false,
      loading: true,
      chatId: conv?.id,
      messageIndex: idx,
      quote: priorUser.slice(0, 240),
    });
    if (!cfg) {
      setMemoryDraft((d) => (d ? { ...d, loading: false } : d));
      return;
    }
    void llmToolCall(
      cfg,
      MEMORY_MANUAL_SYSTEM,
      buildMemoryWriterInput(priorUser, target.content),
      [SAVE_MEMORY_TOOL],
      { feature: 'assistant', maxTokens: 240, temperature: 0.2 },
    )
      .then((calls) => {
        if (memoryDraftReq.current !== req) return;
        const save = calls
          .map(parseMemorySaveCall)
          .find((x): x is NonNullable<typeof x> => !!x);
        setMemoryDraft((d) => (d
          ? {
            ...d,
            text: save?.text ?? d.text,
            kind: save?.kind ?? d.kind,
            pinned: save?.pinned ?? d.pinned,
            loading: false,
          }
          : d));
      })
      .catch(() => {
        // 提炼失败保留本地兜底文本，用户仍可编辑保存
        if (memoryDraftReq.current !== req) return;
        setMemoryDraft((d) => (d ? { ...d, loading: false } : d));
      });
  };

  /** 确认保存记忆草稿；重复/空文本给出提示并保留对话框 */
  const saveMemoryDraft = () => {
    if (!memoryDraft) return;
    const text = memoryDraft.text.trim();
    if (!text) return;
    const draft = memoryDraft;
    void saveMemory({
      text,
      kind: draft.kind,
      pinned: draft.pinned,
      ...(draft.chatId && draft.messageIndex != null
        ? { source: { chatId: draft.chatId, messageIndex: draft.messageIndex, quote: draft.quote ?? '' } }
        : {}),
    }).then((res) => {
      if (!res || res.action === 'duplicate') {
        toast.error(t('settings.memoryDuplicate'));
        return;
      }
      const write: MemoryWrite = {
        id: res.item.id,
        text: res.item.text,
        action: res.action,
        beforeItem: res.beforeItem,
      };
      if (draft.chatId && draft.messageIndex != null) {
        const prev = getChat(draft.chatId)?.messages[draft.messageIndex]?.context?.memoryWrites ?? [];
        patchMessageContext(draft.chatId, draft.messageIndex, { memoryWrites: [...prev, write] });
      }
      toast.success(t('settings.memoryAdded'), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            void undoMemoryWrite(write);
            if (draft.chatId && draft.messageIndex != null) {
              const prev = getChat(draft.chatId)?.messages[draft.messageIndex]?.context?.memoryWrites ?? [];
              patchMessageContext(draft.chatId, draft.messageIndex, {
                memoryWrites: prev.filter((w) => w.id !== write.id),
              });
            }
          },
        },
      });
      closeMemoryDraft();
    });
  };

  const resetConversationView = () => {
    setError(null);
    setActionIdx(null);
    setThinkIdx(null);
  };

  /** 切换/新建/删除对话前先收尾当前流：中止并保留已生成部分 */
  const stopStream = () => {
    abortRef.current?.abort();
  };

  const newChat = (memoryOff = false) => {
    stopStream();
    setActiveId(null);
    setDraftMemoryOff(memoryOff);
    setSidebarOpen(false);
    setMenuId(null);
    setRenamingId(null);
    resetConversationView();
  };

  const openChat = (id: string) => {
    if (id !== activeId) stopStream();
    setActiveId(id);
    setSidebarOpen(false);
    setMenuId(null);
    setRenamingId(null);
    resetConversationView();
  };

  const onDeleteChat = (id: string) => {
    if (delId !== id) {
      setDelId(id);
      return;
    }
    if (activeId === id) stopStream();
    deleteChat(id);
    if (activeId === id) setActiveId(null);
    setDelId(null);
    setMenuId(null);
  };

  const startRename = (c: ChatConversation) => {
    setRenamingId(c.id);
    setRenameDraft(c.title);
    setMenuId(null);
    setDelId(null);
  };

  const commitRename = (id: string) => {
    renameChat(id, renameDraft);
    setRenamingId(null);
    setRenameDraft('');
  };

  const exportChat = (c: ChatConversation) => {
    const md = chatToMarkdown(c);
    const safe = (c.title || t('assistant.title')).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
    const day = new Date(c.updatedAt);
    const stamp = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
    downloadBlob(`${safe || 'chat'}-${stamp}.md`, new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    setMenuId(null);
    toast.success(t('assistant.exported'));
  };

  // 气泡回调保持稳定引用（Bubble 已 memo），始终调用最新实现
  useEffect(() => {
    actionsRef.current = { copy, redo, branch, memory: remember };
  });

  // 「记住」弹窗：Esc 关闭（自绘层在 AI 页 z-60 之上，Radix 默认 z-50 会被盖住）
  useEffect(() => {
    if (!memoryDraft) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') closeMemoryDraft();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [memoryDraft, closeMemoryDraft]);

  const retry = () => {
    if (!conv || busy) return;
    const all = conv.messages;
    // 重新生成最后一条回答：丢掉中断留下的半截内容，避免把它当历史再喂给模型
    const last = all[all.length - 1];
    const base = last?.role === 'assistant' ? all.slice(0, -1) : all;
    if (base.length === 0) return;
    if (base.length !== all.length) setMessages(conv.id, base);
    setError(null);
    void generate(conv.id, base);
  };

  const iconBtn =
    'grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90';
  const menuBtn =
    'flex items-center gap-1 rounded-full bg-surface-hi/70 px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:text-ink';

  /** 输入栏右侧按钮：有文字/光标 → 发送；空且失焦 → 语音；录音中 → 停止 */
  const voiceTime = `${Math.floor(voiceSec / 60)}:${String(voiceSec % 60).padStart(2, '0')}`;
  const voiceMode = !busy && !input.trim() && !inputFocused && voiceState === 'idle';
  const voicePending = voiceState === 'starting' || voiceState === 'processing';
  const commandItems = !busy && !commandDismissed
    ? buildCommandCompletions(input, historyRecords, t)
    : [];
  const commandListId = 'assistant-command-list';
  const activeCommandId = commandItems.length ? `assistant-command-${commandIndex}` : undefined;
  const composerDisabled = busy
    ? false
    : voicePending
      ? true
      : voiceState === 'recording' || voiceMode
        ? false
        : !input.trim();
  const composerLabel = busy
    ? t('assistant.stop')
    : voiceState === 'recording'
      ? t('assistant.voiceStop')
      : voiceMode
        ? t('assistant.voiceStart')
        : t('assistant.send');
  const onComposerAction = () => {
    if (busy) {
      abortRef.current?.abort();
    } else if (voiceState === 'recording') {
      void stopVoice();
    } else if (voicePending) {
      return;
    } else if (voiceMode) {
      void startVoice();
    } else {
      send();
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (commandItems.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandIndex((i) => (i + 1) % commandItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandIndex((i) => (i - 1 + commandItems.length) % commandItems.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        applyCompletion(commandItems[commandIndex] ?? commandItems[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCommandDismissed(true);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        applyCompletion(commandItems[commandIndex] ?? commandItems[0]);
        return;
      }
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (input.startsWith('/')) {
      if (input.trim() === '/') {
        e.preventDefault();
        return;
      }
      const parsed = parseAssistantCommand(input);
      if (parsed && parsed.id !== 'unknown') {
        e.preventDefault();
        void executeCommand(parsed);
      }
      return;
    }
    // 桌面端（精确指针）Enter 发送、Shift+Enter 换行；触屏保留换行，避免误发
    if (busy || voicePending || coarsePointer()) return;
    if (!input.trim()) return;
    e.preventDefault();
    send();
  };

  const memoryOffNow = activeId ? !!conv?.memoryOff : draftMemoryOff;
  const toggleMemoryOff = () => {
    if (activeId) setChatMemoryOff(activeId, !memoryOffNow);
    else setDraftMemoryOff((v) => !v);
  };

  const topBar = (
    <div className="flex min-h-14 shrink-0 items-center gap-2 bg-surface px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
      {aiWorkspace ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
          <Sparkles size={17} />
        </span>
      ) : (
        <button
          onClick={() => setTab(lastTab === 'assistant' ? 'test' : lastTab)}
          aria-label={t('common.back')}
          className={iconBtn}
        >
          <ArrowLeft size={18} />
        </button>
      )}
      <p className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{t('assistant.title')}</p>
      <button
        onClick={toggleMemoryOff}
        aria-label={t(memoryOffNow ? 'assistant.memoryOff' : 'assistant.memoryOn')}
        title={t(memoryOffNow ? 'assistant.memoryOffHint' : 'assistant.memoryOnHint')}
        className={cn(iconBtn, memoryOffNow && 'text-accent')}
      >
        {memoryOffNow ? <Ban size={17} /> : <Brain size={17} />}
      </button>
      <button onClick={() => newChat()} aria-label={t('assistant.newChat')} className={iconBtn}>
        <Plus size={17} />
      </button>
      <button
        onClick={() => { setSidebarOpen(true); setDelId(null); }}
        aria-label={t('assistant.history')}
        className={iconBtn}
      >
        <PanelRight size={17} />
      </button>
    </div>
  );

  const shellClass = cn(
    'fixed inset-x-0 top-0 z-[60] flex flex-col overflow-hidden bg-surface',
    // 经典底栏包含 AI 页签：助手页让出底栏高度，保留导航；
    // 悬浮胶囊 / AI 工作台没有可见页签，助手页占满全屏。
    classicNav ? 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))]' : 'bottom-0',
  );

  /** 右侧历史抽屉（未配置大模型时也要可用：顶栏的历史按钮在两个分支都在） */
  const sidebarDrawer = sidebarOpen ? (
    <div className="absolute inset-0 z-20">
      <div className="absolute inset-0 bg-black/20" onClick={() => setSidebarOpen(false)} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
        className="absolute inset-y-0 right-0 flex w-72 flex-col bg-surface shadow-[-8px_0_30px_rgba(28,25,45,0.12)]"
      >
        <button
          onClick={() => newChat()}
          className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-2xl bg-accent/15 py-2.5 text-sm font-medium text-accent transition-transform active:scale-[0.98]"
        >
          <Plus size={15} />
          {t('assistant.newChat')}
        </button>
        <button
          onClick={() => newChat(true)}
          className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-2xl bg-surface-hi/60 py-2 text-[12px] font-medium text-ink-2 transition-transform active:scale-[0.98]"
        >
          <Ban size={14} />
          {t('assistant.newChatNoMemory')}
        </button>
        <div className="mx-3 mt-2">
          <input
            value={chatQuery}
            onChange={(e) => setChatQuery(e.target.value)}
            placeholder={t('assistant.searchChats')}
            aria-label={t('assistant.searchChats')}
            className="w-full rounded-xl bg-surface-hi/60 px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-2/60"
          />
        </div>
        <p className="px-4 pb-1 pt-3 text-[11px] font-medium text-ink-2">{t('assistant.history')}</p>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {visibleChats.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-2/70">
              {(chats ?? []).length === 0 ? t('assistant.historyEmpty') : t('assistant.noSearchResult')}
            </p>
          ) : (
            visibleChats.map((c) => (
              <div
                key={c.id}
                className={cn('rounded-xl', c.id === activeId && 'bg-accent/10')}
              >
                <div className="flex items-center gap-1 px-1.5">
                  {renamingId === c.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename(c.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setRenamingId(null);
                        }
                      }}
                      aria-label={t('assistant.renameChat')}
                      placeholder={t('assistant.renamePlaceholder')}
                      className="my-1.5 min-w-0 flex-1 rounded-lg bg-surface-hi px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-2/60"
                    />
                  ) : (
                    <button
                      onClick={() => openChat(c.id)}
                      className="min-w-0 flex-1 py-2.5 text-left"
                    >
                      <span className="block truncate text-[13px] text-ink">
                        {c.title || t('assistant.newChat')}
                      </span>
                      <span className="block text-[10px] text-ink-2">
                        {new Date(c.updatedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMenuId(menuId === c.id ? null : c.id);
                      setDelId(null);
                    }}
                    aria-label={t('assistant.more')}
                    aria-expanded={menuId === c.id}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:text-ink"
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
                {menuId === c.id && (
                  <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
                    <button onClick={() => startRename(c)} className={menuBtn}>
                      <Pencil size={11} />
                      {t('assistant.renameChat')}
                    </button>
                    <button onClick={() => exportChat(c)} className={menuBtn}>
                      <Download size={11} />
                      {t('assistant.exportChat')}
                    </button>
                    <button
                      onClick={() => onDeleteChat(c.id)}
                      className={cn(menuBtn, delId === c.id && 'bg-red-500/10 text-red-500')}
                    >
                      <Trash2 size={11} />
                      {t('assistant.deleteChat')}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        {aiWorkspace && (
          <div className="border-t border-line/60 p-3">
            <button
              onClick={() => {
                setSidebarOpen(false);
                setTab('settings');
              }}
              className="flex w-full items-center gap-2 rounded-2xl bg-surface-hi/60 px-3 py-2.5 text-sm font-medium text-ink transition-transform active:scale-[0.98]"
            >
              <Settings2 size={15} className="text-accent" />
              {t('nav.settings')}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  ) : null;

  if (!cfg) {
    return (
      <div ref={shellRef} className={shellClass}>
        {topBar}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-xs flex-col items-center gap-3 text-center">
            <p className="text-sm leading-relaxed text-ink-2">{t('assistant.needConfig')}</p>
            <button
              onClick={() => setTab('settings')}
              className="flex items-center gap-1.5 rounded-2xl bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-transform active:scale-[0.98]"
            >
              <Settings2 size={15} />
              {t('assistant.goSettings')}
            </button>
          </div>
        </div>
        {sidebarDrawer}
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {topBar}

      {/* 消息流 */}
      <div ref={scrollRef} onScroll={() => {
        const el = scrollRef.current;
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !busy ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-accent/15 text-accent">
              <Sparkles size={26} />
            </span>
            <p className="max-w-[17rem] text-[13px] leading-relaxed text-ink-2">{t('assistant.greeting')}</p>
            <QuickPrompts
              onPick={(text) => {
                setInput(text);
                requestAnimationFrame(() => taRef.current?.focus());
              }}
            />
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-3 pb-2">
            {messages.map((m, i) => (
              <Bubble
                key={`${i}-${m.role}`}
                m={m}
                idx={i}
                chatId={conv?.id}
                active={actionIdx === i}
                thinkOpen={thinkIdx === i}
                onAction={setActionIdx}
                onToggleThink={onToggleThink}
                onCopy={onCopy}
                onRedo={onRedo}
                onBranch={onBranch}
                onMemory={onMemory}
              />
            ))}
            {toolNote && (
              <div className="mx-auto flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[11px] text-ink-2 shadow-sm">
                <Loader2 size={11} className="animate-spin text-accent" />
                {toolNote}
              </div>
            )}
            {streamText !== null && (
              <Bubble
                m={{ role: 'assistant', content: streamText }}
                idx={-1}
                streaming
                liveThink={streamThink}
                active={false}
                thinkOpen={false}
                onAction={setActionIdx}
                onToggleThink={() => undefined}
                onCopy={() => undefined}
                onRedo={() => undefined}
                onBranch={() => undefined}
                onMemory={() => undefined}
              />
            )}
            {error && (
              <div className="mx-auto flex max-w-md flex-col items-center gap-1.5 rounded-2xl bg-card px-3 py-2.5 text-center">
                <p className="text-[12px] font-medium leading-relaxed text-red-500">
                  {error.kind === 'unknown' ? error.detail : t(`assistant.err.${error.kind}`)}
                </p>
                {error.kind !== 'unknown' && (
                  <p className="text-[10px] leading-relaxed text-ink-2/80">{error.detail}</p>
                )}
                {(error.model || error.host) && (
                  <p className="select-all text-[9px] leading-relaxed text-ink-2/60">
                    {[error.model, error.host].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="mt-0.5 flex items-center gap-3">
                  {error.kind === 'auth' && (
                    <button onClick={() => setTab('settings')} className="text-[11px] font-medium text-accent">
                      {t('assistant.errSettings')}
                    </button>
                  )}
                  <button onClick={retry} className="text-[11px] font-medium text-accent">
                    {t('assistant.retry')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入栏 */}
      <div className="shrink-0 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
        <div className="relative mx-auto max-w-2xl">
          {pinnedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
              <span className="text-[10px] text-ink-2">
                {t('assistant.cmd.attached', { n: pinnedIds.length })}
              </span>
              {pinnedIds.map((id) => {
                const rec = historyRecords.find((r) => r.id === id);
                const label = rec
                  ? `${new Date(rec.createdAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' })} · ${Math.round(rec.stats.avgF0)}Hz`
                  : id.slice(0, 8);
                return (
                  <button
                    key={id}
                    onClick={() => conv && setPinnedRecords(conv.id, pinnedIds.filter((x) => x !== id))}
                    className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent"
                    title={t('assistant.cmd.detach')}
                  >
                    {label} ×
                  </button>
                );
              })}
            </div>
          )}
          {commandItems.length > 0 && (
            <div
              id={commandListId}
              role="listbox"
              aria-label={t('assistant.cmd.help')}
              className="no-scrollbar absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-2xl bg-card p-1.5 shadow-[0_12px_32px_-12px_rgba(28,25,45,0.28)]"
            >
              {commandItems.map((c, i) => (
                <button
                  key={c.key}
                  id={`assistant-command-${i}`}
                  role="option"
                  aria-selected={i === commandIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setCommandIndex(i)}
                  onClick={() => applyCompletion(c)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors',
                    i === commandIndex ? 'bg-accent/10' : 'hover:bg-surface-hi/60',
                  )}
                >
                  <span className={cn(
                    'shrink-0 font-mono text-[11px]',
                    c.kind === 'command' ? 'text-accent' : 'text-ink-2',
                  )}>
                    {c.label}
                  </span>
                  <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-2">
                    {c.detail}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 rounded-2xl bg-card px-3.5 py-2.5 shadow-[0_2px_10px_rgba(28,25,45,0.06)]">
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setCommandIndex(0);
                  if (e.target.value.startsWith('/')) setCommandDismissed(false);
                }}
                onFocus={() => {
                  setInputFocused(true);
                  if (input.startsWith('/')) setCommandDismissed(false);
                }}
                onBlur={() => {
                  setInputFocused(false);
                  setCommandDismissed(true);
                }}
                onKeyDown={onComposerKeyDown}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={commandItems.length > 0}
                aria-controls={commandListId}
                aria-activedescendant={activeCommandId}
                placeholder={voiceState === 'recording'
                  ? t('assistant.voiceRecording', { time: voiceTime })
                  : t('assistant.ph')}
                className="no-scrollbar w-full resize-none bg-transparent text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-2/60"
              />
            </div>
            <button
              onClick={onComposerAction}
              disabled={composerDisabled}
              aria-label={composerLabel}
              title={composerLabel}
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-full text-white transition-transform active:scale-90',
                'bg-accent disabled:opacity-40',
                busy && 'bg-ink text-surface',
                voiceState === 'recording' && 'ring-4 ring-accent/20',
              )}
            >
              {busy || voiceState === 'recording' ? (
                <Square size={14} />
              ) : voicePending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : voiceMode ? (
                <AudioLines size={17} />
              ) : (
                <ArrowUp size={17} />
              )}
            </button>
          </div>
        </div>
      </div>

      {sidebarDrawer}

      {/* 把助手回复存为长期记忆：确认 / 编辑 / 分类 / 置顶
          自绘层而不是 Radix Dialog：AI 页本身 fixed z-[60]，Radix 默认 z-50 会被整页盖住 */}
      {memoryDraft != null && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('assistant.memoryTitle')}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeMemoryDraft}
          />
          <div className="relative w-full max-w-lg rounded-3xl bg-card p-5 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]">
            <h2 className="text-base font-semibold text-ink">{t('assistant.memoryTitle')}</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{t('assistant.memoryHint')}</p>
            {memoryDraft.loading ? (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-2">
                <Loader2 size={11} className="animate-spin" />
                {t('assistant.memoryGenerating')}
              </p>
            ) : memoryDraft.text.trim() ? (
              <p className="mt-1 text-[11px] text-ink-2">{t('assistant.memoryGenerated')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-ink-2">{t('assistant.memoryNoCandidate')}</p>
            )}
            <Textarea
              value={memoryDraft.text}
              onChange={(e) => setMemoryDraft((d) => (d ? { ...d, text: e.target.value } : d))}
              rows={4}
              maxLength={MEMORY_TEXT_MAX}
              disabled={memoryDraft.loading}
              placeholder={memoryDraft.loading ? t('assistant.memoryGenerating') : t('settings.memoryPlaceholder')}
              autoFocus
              className="mt-3 min-h-0 resize-y rounded-2xl border-black/10 bg-surface-hi text-xs leading-relaxed text-ink"
            />
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {MEMORY_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={memoryDraft.loading}
                  onClick={() => setMemoryDraft((d) => (d ? { ...d, kind: k } : d))}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40',
                    memoryDraft.kind === k
                      ? 'bg-accent-soft text-on-accent-soft'
                      : 'bg-surface-hi text-ink-2',
                  )}
                >
                  {t(MEMORY_KIND_KEYS[k])}
                </button>
              ))}
              <button
                type="button"
                disabled={memoryDraft.loading}
                onClick={() => setMemoryDraft((d) => (d ? { ...d, pinned: !d.pinned } : d))}
                className={cn(
                  'ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40',
                  memoryDraft.pinned ? 'bg-accent/15 text-accent' : 'bg-surface-hi text-ink-2',
                )}
              >
                <Star size={11} className={memoryDraft.pinned ? 'fill-accent' : undefined} />
                {t('settings.memoryPin')}
              </button>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={closeMemoryDraft}
                className="px-1 py-2 text-sm font-medium text-ink-2 transition-opacity hover:opacity-70"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={saveMemoryDraft}
                disabled={memoryDraft.loading || !memoryDraft.text.trim()}
                className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
