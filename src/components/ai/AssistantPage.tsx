/**
 * AI 助手（大模型子页面入口的独立全屏页）
 * - 顶栏：左上退出 + 右上历史侧边栏开关
 * - 消息流：AI 气泡带头像（左）/ 用户气泡（右）；点按气泡在其下方浮出
 *   复制 / 重做 / 分支（重做 = 截断到该消息之前重新生成；分支 = 以该消息为
 *   结尾复制出一个新对话）
 * - 思考过程：推理模型（reasoning_content / thinking 块）的思考流式展示，
 *   完成后保存到消息里、点气泡内的「思考过程」可展开回看
 * - 底部输入栏：随内容自动增高（上限后内部滚动），生成中变为停止按钮
 * - 右侧抽屉：新建对话 + 历史列表（点按切换、两步删除）
 * 生成中关闭页面不中断请求（跑完照常写入对话，避免丢回复）；中途取消用停止按钮。
 * 对话存 IndexedDB（llm:chats，封顶 30 条）；生成走活动档案（协议/流式/上下文
 * 均由档案决定），系统提示附用户历史测试记录摘要，按上下文预算裁剪。
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowUp, Brain, Copy, GitBranch, PanelRight, Plus, RotateCcw, Sparkles, Square, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { isAbortError, languageName, llmChatStreamMessages } from '@/lib/llm';
import { useActiveLlmConfig, DEFAULT_CONTEXT_TOKENS } from '@/lib/llmProfiles';
import {
  addMessage, createChat, deleteChat, getChat, setMessages, useChats, type ChatMessage,
} from '@/lib/llmChats';
import { renderMarkdown } from '@/lib/markdown';
import { retrieveDocs } from '@/lib/docKnowledge';
import { RecordImage } from '@/lib/assistantCharts';
import { renderAssistantContent } from '@/lib/assistantChartRoute';
import { useStore } from '@/store/useStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { cn } from '@/lib/utils';

/** Token 粗估：中英混合按 2 字符 ≈ 1 token（量级参考，用于预算裁剪） */
const estTokens = (s: string) => Math.ceil(s.length / 2);

/**
 * 用户历史测试记录摘要：按上下文预算（tokens）从最旧开始裁剪。
 * 全量读取（getAllRecords，不受内存 200 条窗口截断），并等待 hydrate 完成，
 * 避免应用刚启动时记录未加载导致历史部分为空。
 */
async function historySection(budgetTokens: number): Promise<string> {
  const store = useHistoryStore.getState();
  if (!store.ready) await store.hydrate();
  const records = await store.getAllRecords();
  if (records.length === 0) return '';
  const lines = [...records]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => {
      const s = r.stats;
      const d = new Date(r.createdAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const parts = [
        `id ${r.id}`,
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        r.mode ?? 'free',
        `${Math.round(r.durationSec)}s`,
        `avg ${s.avgF0.toFixed(1)}Hz`,
        `p10-p90 ${s.p10F0.toFixed(0)}-${s.p90F0.toFixed(0)}Hz`,
        s.avgF1 != null ? `F1 ${s.avgF1.toFixed(0)}` : '',
        s.avgF2 != null ? `F2 ${s.avgF2.toFixed(0)}` : '',
        s.jitterPct != null ? `Jitter ${s.jitterPct.toFixed(2)}%` : '',
        s.hnrDb != null ? `HNR ${s.hnrDb.toFixed(1)}dB` : '',
        s.cppsDb != null ? `CPPS ${s.cppsDb.toFixed(1)}dB` : '',
        r.note ? `「${r.note}」` : '',
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    });
  const kept: string[] = [];
  let acc = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = estTokens(lines[i]) + 4;
    if (acc + cost > budgetTokens) break;
    acc += cost;
    kept.unshift(lines[i]);
  }
  if (kept.length === 0) return '';
  const omitted = lines.length - kept.length;
  return `\n\n## 用户历史测试记录（共 ${lines.length} 条${omitted > 0 ? `，以下为最近 ${kept.length} 条` : ''}，时间从旧到新）\n${kept.join('\n')}`;
}

/** 助手系统提示词：定位与边界 + 历史记录使用规则 + 内置文档摘录，按界面语言回答 */
function systemPrompt(history: string, docs = ''): string {
  return [
    '你是 Simple Voice Tool for Trans 内置的 AI 助手——一个严肃的嗓音测量、分析与训练追踪工具。',
    '回答简洁、务实、有依据；涉及嗓音训练时给出可操作的练习建议；',
    '不做医学诊断，遇到疑似嗓音疾病（持续嘶哑、疼痛等）时建议就医或咨询言语治疗师。',
    '回复支持 Markdown：可用 **粗体**、*斜体*、`行内代码`、有序/无序列表、表格（| 列 | 列 |）、> 引用与 ## 小标题，让长回答结构清晰；但不要输出代码块。',
    '你可以嵌入用户某次记录的图表，语法：![图表说明](record://<记录id>/<kind>)，kind 取 pitch（音高曲线）/ formant（F1/F2）/ energy（能量）/ vowel（元音散点）之一；记录 id 见下方历史清单的「id」字段。仅在有助于说明时插图（如同一条记录不超过 2 张、答趋势时对比不同记录），不要每句都配图；不存在的 id 不要编造。',
    history
      ? '下方附有用户的历史测试记录：回答趋势、进步与训练计划类问题时引用它们；记录里没有的指标如实说明，不要编造。'
      : '',
    history,
    docs,
    `使用「${languageName()}」回答。`,
  ].filter(Boolean).join('\n');
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

/** 思考过程块 */
function ThinkBlock({ text, live }: { text: string; live?: boolean }) {
  return (
    <span className="mb-2 block max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/[0.04] px-2.5 py-2 text-left text-[11px] leading-relaxed text-ink-2">
      {live && !text ? <span className="italic">{t('assistant.thinking')}</span> : text}
    </span>
  );
}

/** 消息正文：record:// 图片引用独立渲染，其余 Markdown */
function MessageBody({ text }: { text: string }) {
  const parts = renderAssistantContent(text);
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'img' && p.kind && p.recordId ? (
          <RecordImage key={i} recordId={p.recordId} kind={p.kind} alt={p.alt ?? ''} />
        ) : (
          <span key={i} className="block [&>p]:my-0.5 [&_blockquote]:my-1 [&_table]:my-1">
            {renderMarkdown(p.content)}
          </span>
        ),
      )}
    </>
  );
}

/** 消息气泡（模块级，理由同上；交互状态与回调由 props 传入） */
function Bubble({
  m,
  idx,
  streaming = false,
  liveThink = '',
  active,
  thinkOpen,
  onAction,
  onToggleThink,
  onCopy,
  onRedo,
  onBranch,
}: {
  m: ChatMessage;
  idx: number;
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
}) {
  const mine = m.role === 'user';
  const think = streaming ? liveThink : m.think ?? '';
  const thinkVisible = streaming ? !!think || !m.content : !!m.think && thinkOpen;
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
      <button
        onClick={() => onAction(streaming ? null : active ? null : idx)}
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-left text-[13px] leading-relaxed text-ink',
          'shadow-[0_2px_10px_rgba(28,25,45,0.05)]',
          mine ? 'bg-accent/15' : 'bg-card',
          mine && 'whitespace-pre-wrap',
        )}
      >
        {!mine && thinkVisible && think && <ThinkBlock text={think} live={streaming} />}
        {mine
          ? (m.content || (streaming ? (liveThink ? '' : '…') : ''))
          : (m.content
            ? <MessageBody text={m.content} />
            : (streaming ? (liveThink ? '' : '…') : ''))}
        {!mine && !!m.think && !streaming && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleThink(idx);
            }}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-2"
          >
            <Brain size={10} />
            {t('assistant.think')}
          </span>
        )}
      </button>
      {active && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="mt-1.5 flex items-center gap-1.5"
        >
          <ActionBtn icon={Copy} label={t('assistant.copy')} onClick={() => onCopy(idx)} />
          {!streaming && <ActionBtn icon={RotateCcw} label={t('assistant.redo')} onClick={() => onRedo(idx)} />}
          {!streaming && <ActionBtn icon={GitBranch} label={t('assistant.branch')} onClick={() => onBranch(idx)} />}
        </motion.div>
      )}
    </div>
  );
}

export function AssistantPage({ onClose }: { onClose: () => void }) {
  useI18n();
  const activeProfileId = useStore((s) => s.settings.llmActiveProfileId);
  const cfg = useActiveLlmConfig(activeProfileId);
  const chats = useChats();
  /** null = 尚未开始对话（发送第一条时创建） */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  /** null = 空闲；否则为流式累积文本 */
  const [streamText, setStreamText] = useState<string | null>(null);
  /** 流式思考累积文本（推理模型） */
  const [streamThink, setStreamThink] = useState('');
  /** 展开思考过程的持久化消息下标 */
  const [thinkIdx, setThinkIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 点按气泡浮出操作行的消息下标 */
  const [actionIdx, setActionIdx] = useState<number | null>(null);
  /** 侧边栏两步删除的待确认对话 id */
  const [delId, setDelId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const conv = activeId ? chats?.find((c) => c.id === activeId) ?? null : null;
  const messages = conv?.messages ?? [];
  const busy = streamText !== null;

  // 自动滚底：仅当用户本来就贴近底部时跟随（上翻历史时不打扰）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamText, streamThink]);

  // 输入栏随内容增高（上限 120px，之后内部滚动）
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const generate = async (convId: string, history: ChatMessage[]) => {
    if (!cfg || history.length === 0) return;
    // 上下文预算：历史记录摘要 + 系统提示 + 对话 + 回复余量都要装进窗口。
    // 历史记录预算自适应：对话越短分给记录摘要越多（旧实现固定 40%，
    // 明明装得下的旧记录也被裁掉，导致 AI 读不到全部历史）
    const context = cfg.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
    const replyReserve = Math.ceil(context * 0.25);
    const convTokens = history.reduce((n, x) => n + estTokens(x.content), 0);
    const histBudget = Math.max(
      512,
      Math.min(Math.floor(context * 0.6), context - convTokens - replyReserve - 512),
    );
    const hist = await historySection(histBudget);
    // 内置文档检索：拿最近一条用户消息查相关文档摘录（官方口径注入，模型不瞎猜参考区间）
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const docs = lastUser ? await retrieveDocs(lastUser.content) : '';
    const sys = systemPrompt(hist, docs);
    const reserve = estTokens(sys) + replyReserve;
    let turns = history;
    const maxTok = Math.max(1024, context - reserve);
    const totalOf = (ts: ChatMessage[]) => ts.reduce((n, x) => n + estTokens(x.content), 0);
    // 从最旧开始裁剪；保证 user 开头（Anthropic 要求 user/assistant 交替且以 user 起始）
    while (turns.length > 1 && totalOf(turns) > maxTok) turns = turns.slice(1);
    if (turns[0]?.role !== 'user') turns = turns.slice(1);
    if (turns.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setStreamText('');
    setStreamThink('');
    stickRef.current = true;
    let thinkAcc = '';
    try {
      const reply = await llmChatStreamMessages(cfg, turns, {
        feature: 'assistant',
        signal: controller.signal,
        system: sys,
        onDelta: (acc) => setStreamText(acc),
        onThink: (acc) => {
          thinkAcc = acc;
          setStreamThink(acc);
        },
      });
      addMessage(convId, {
        role: 'assistant',
        content: reply,
        ...(thinkAcc ? { think: thinkAcc } : {}),
      });
    } catch (err: unknown) {
      if (!isAbortError(err)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreamText(null);
      setStreamThink('');
      abortRef.current = null;
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy || !cfg) return;
    setInput('');
    let convId = activeId;
    if (!convId) {
      convId = createChat('');
      setActiveId(convId);
    }
    addMessage(convId, { role: 'user', content: text });
    void generate(convId, getChat(convId)?.messages ?? [{ role: 'user', content: text }]);
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
    if (!conv) return;
    const id = createChat(
      conv.title ? `${conv.title} · ${t('assistant.branch')}` : t('assistant.title'),
      conv.messages.slice(0, idx + 1),
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

  const resetConversationView = () => {
    setError(null);
    setActionIdx(null);
    setThinkIdx(null);
  };

  const newChat = () => {
    setActiveId(null);
    setSidebarOpen(false);
    resetConversationView();
  };

  const onDeleteChat = (id: string) => {
    if (delId !== id) {
      setDelId(id);
      return;
    }
    deleteChat(id);
    if (activeId === id) setActiveId(null);
    setDelId(null);
  };

  const retry = () => {
    if (!conv || busy) return;
    void generate(conv.id, conv.messages);
  };

  const iconBtn =
    'grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90';

  const topBar = (
    <div className="flex items-center gap-2 px-3 pt-3">
      <button onClick={onClose} aria-label={t('common.back')} className={iconBtn}>
        <ArrowLeft size={18} />
      </button>
      <p className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{t('assistant.title')}</p>
      <button
        onClick={() => { setSidebarOpen(true); setDelId(null); }}
        aria-label={t('assistant.history')}
        className={iconBtn}
      >
        <PanelRight size={17} />
      </button>
    </div>
  );

  if (!cfg) {
    return (
      <div className="fixed inset-0 z-[150] flex flex-col bg-surface">
        {topBar}
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-xs text-center text-sm leading-relaxed text-ink-2">{t('assistant.needConfig')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-surface">
      {topBar}

      {/* 消息流 */}
      <div ref={scrollRef} onScroll={() => {
        const el = scrollRef.current;
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !busy ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-accent/15 text-accent">
              <Sparkles size={26} />
            </span>
            <p className="max-w-[17rem] text-[13px] leading-relaxed text-ink-2">{t('assistant.greeting')}</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-3 pb-2">
            {messages.map((m, i) => (
              <Bubble
                key={`${i}-${m.role}`}
                m={m}
                idx={i}
                active={actionIdx === i}
                thinkOpen={thinkIdx === i}
                onAction={setActionIdx}
                onToggleThink={(idx) => setThinkIdx(thinkIdx === idx ? null : idx)}
                onCopy={copy}
                onRedo={redo}
                onBranch={branch}
              />
            ))}
            {busy && (
              <Bubble
                m={{ role: 'assistant', content: streamText ?? '' }}
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
              />
            )}
            {error && (
              <div className="mx-auto flex flex-col items-center gap-1.5">
                <p className="max-w-md text-center text-[11px] leading-relaxed text-red-500">{error}</p>
                <button onClick={retry} className="text-[11px] font-medium text-accent">
                  {t('assistant.retry')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入栏 */}
      <div className="px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <div className="min-w-0 flex-1 rounded-2xl bg-card px-3.5 py-2.5 shadow-[0_2px_10px_rgba(28,25,45,0.06)]">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('assistant.ph')}
              className="max-h-[120px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-2/60"
            />
          </div>
          <button
            onClick={busy ? () => abortRef.current?.abort() : send}
            disabled={!busy && !input.trim()}
            aria-label={busy ? t('assistant.stop') : t('assistant.send')}
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-full text-white transition-transform active:scale-90',
              'bg-accent disabled:opacity-40',
              busy && 'bg-ink text-surface',
            )}
          >
            {busy ? <Square size={14} /> : <ArrowUp size={17} />}
          </button>
        </div>
      </div>

      {/* 右侧历史抽屉 */}
      {sidebarOpen && (
        <div className="absolute inset-0 z-20">
          <div className="absolute inset-0 bg-black/20" onClick={() => setSidebarOpen(false)} />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className="absolute inset-y-0 right-0 flex w-72 flex-col bg-surface shadow-[-8px_0_30px_rgba(28,25,45,0.12)]"
          >
            <button
              onClick={newChat}
              className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-2xl bg-accent/15 py-2.5 text-sm font-medium text-accent transition-transform active:scale-[0.98]"
            >
              <Plus size={15} />
              {t('assistant.newChat')}
            </button>
            <p className="px-4 pb-1 pt-3 text-[11px] font-medium text-ink-2">{t('assistant.history')}</p>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {(chats ?? []).length === 0 ? (
                <p className="px-3 py-4 text-xs text-ink-2/70">{t('assistant.historyEmpty')}</p>
              ) : (
                (chats ?? []).map((c) => (
                  <div
                    key={c.id}
                    className={cn('flex items-center gap-1 rounded-xl px-1.5', c.id === activeId && 'bg-accent/10')}
                  >
                    <button
                      onClick={() => { setActiveId(c.id); setSidebarOpen(false); resetConversationView(); }}
                      className="min-w-0 flex-1 py-2.5 text-left"
                    >
                      <span className="block truncate text-[13px] text-ink">
                        {c.title || t('assistant.newChat')}
                      </span>
                      <span className="block text-[10px] text-ink-2">
                        {new Date(c.updatedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                    <button
                      onClick={() => onDeleteChat(c.id)}
                      aria-label={t('assistant.deleteChat')}
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full text-ink-2 transition-colors',
                        delId === c.id && 'bg-red-500/10 text-red-500',
                      )}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
