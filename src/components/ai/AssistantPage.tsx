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
 * - 右侧抽屉：新建对话 + 历史列表（点按切换、两步删除）
 * 生成中关闭页面不中断请求（跑完照常写入对话，避免丢回复）；中途取消用停止按钮。
 * 对话存 IndexedDB（llm:chats，封顶 30 条）；生成走活动档案（协议/流式/上下文
 * 均由档案决定），系统提示附用户画像、训练靶标、历史聚合、基线 Δ 与最近记录
 * 明细，按上下文预算裁剪。
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUp, Brain, Copy, GitBranch, Loader2, PanelRight, Plus, RotateCcw, Sparkles, Square, Trash2, AudioLines, ArrowLeft,
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
import { buildAssistantContext } from '@/lib/assistantContext';
import { RecordImage } from '@/lib/assistantCharts';
import { renderAssistantMessage } from '@/lib/assistantContent';
import { GenUiBlock } from '@/lib/assistantGenui';
import { useStore } from '@/store/useStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { recorder } from '@/lib/audio/recorder';
import { maybeAutoBackup } from '@/lib/backup/local';
import { cn } from '@/lib/utils';

/** Token 粗估：中英混合按 2 字符 ≈ 1 token（量级参考，用于预算裁剪） */
const estTokens = (s: string) => Math.ceil(s.length / 2);

/**
 * 读取全量历史记录并组装助手上下文：用户画像、聚合、基线 Δ 与最近明细。
 * 等待 hydrate 完成，避免应用刚启动时把空历史发给模型。
 */
async function loadAssistantContext(
  budgetTokens: number,
  settings: Parameters<typeof buildAssistantContext>[1],
): Promise<ReturnType<typeof buildAssistantContext>> {
  const store = useHistoryStore.getState();
  if (!store.ready) await store.hydrate();
  const stored = await store.getAllRecords();
  // 合并内存中的最新记录：刚录完的语音可能还没等到 IDB 落盘，
  // 直接读 getAllRecords 会漏掉它，导致助手看不到本次录音。
  const byId = new Map(stored.map((r) => [r.id, r]));
  for (const r of useHistoryStore.getState().records) byId.set(r.id, r);
  const records = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  return buildAssistantContext(records, settings, budgetTokens);
}

/**
 * 助手视觉规范：record:// 原生图表与 genui 组件的选择、语法与设计约束。
 * 这段会进入每次请求的系统提示词，保持结构化、可执行，避免模型输出
 * 数据编造、与主题冲突的配色或需要横向滚动的固定宽度组件。
 */
const ASSISTANT_VISUAL_GUIDE = [
  '【引用记录图表】',
  '- 语法严格为 ![一句说明](record://<记录id>/<kind>)；kind 只能是 pitch（音高）/ formant（F1/F2）/ energy（能量）/ vowel（元音散点）。',
  '- 记录 id 必须来自下方历史清单的「id」字段；没有可用记录时如实说明并请用户提供 id，绝不编造。',
  '- 图表是证据，不是装饰：放在相关结论之后；每条回复最多 2 张，同一记录最多 2 种图；不要每段都配图，也不要用文字重复图里已能看出的所有数字。',
  '- 说明文字要写「看什么」（如「句中段稳定在 150–170 Hz」），不要只写「图表」「F0 图」。',
  '- 不要用 genui 重画已有原生图表；不要把 record:// 放进 genui 或代码块。',
  '【genui 交互组件】',
  '- 只在原生图表 + Markdown 不够时使用：滑块、开关、对比切换、计算器、可点选面板；普通解释不要用 genui。',
  '- 用 ```genui 围栏包一个 HTML 片段；不要 doctype/html/head/body；不要外链资源、网络请求或表单提交；每条回复最多 2 个，单个 ≤ 48KB；可写内联 <style>/<script>（沙箱运行，不能访问应用数据）。',
  '- 外层卡片、背景、圆角、阴影由站点提供：根节点直接写内容，不要再包卡片/背景/阴影。',
  '- 颜色只用 CSS 变量：文字 --c-ink / --c-ink-2，主色 --c-accent，浅底 --c-accent-soft，卡片 --c-card，次级底 --c-surface-hi，分隔线 --c-line；透明度用 rgb(var(--c-xxx-rgb) / 0.1)。不要写死黑白/亮色，不要渐变或多套强调色，不要外链图片/字体/图标。',
  '- 版式：宽度 100%，不要固定宽度或横向滚动；内边距 12–14px，元素间距 8–12px，圆角 12–16px；正文 13px/1.6，标题 14px/600，辅助 11px，数字 tabular-nums；标题最多两级。',
  '- 优先用站点类：.svt-title / .svt-muted / .svt-grid / .svt-metric / .svt-badge / .svt-row / .svt-row-between / .svt-bar；需要内部分区时才用 .svt-card。',
  '- 典型结构：.svt-row-between（标题 + 徽标）→ .svt-grid > .svt-metric（2–4 个指标）→ 控件 → .svt-muted（当前值/说明）；不要堆满整屏，信息密度留白。',
  '- 交互：按钮/输入继承主题色；触控区 ≥ 40px；状态不能只靠颜色，配文字或图标；动画 120–180ms，遵循 prefers-reduced-motion，不做无限动画。',
  '- 可访问性：语义标签、aria-label、可见 focus；布局适配 320–640px，高度自适应，通常 120–320px，不要 100vh。',
  '- 数据必须来自历史记录，或明确标注「示例」；不要编造用户数据。',
  '【选择】单条记录的音高/共振峰/能量/元音优先用 record://；多记录对比、趋势、可调参数用 genui；纯文字能讲清就不用图表。',
].join('\n');

/** 助手系统提示词：定位与边界 + 历史记录使用规则 + 内置文档摘录，按界面语言回答 */
function systemPrompt(profile: string, history: string, docs = ''): string {
  return [
    '你是 Simple Voice Tool for Trans 内置的 AI 助手——一个严肃的嗓音测量、分析与训练追踪工具。',
    '不要使用 emoji 或颜文字；用文字、Markdown、图表和交互组件表达。',
    '回答简洁、务实、有依据；涉及嗓音训练时给出可操作的练习建议；',
    '不做医学诊断，遇到疑似嗓音疾病（持续嘶哑、疼痛等）时建议就医或咨询言语治疗师。',
    '记录里的底噪、麦克风、录音小时是自动采集的环境元数据：可用于解释数据可比性与可信度，缺失时不要假设，也不要据此做医学判断。',
    '回复支持 Markdown：可用 **粗体**、*斜体*、`行内代码`、有序/无序列表、表格（| 列 | 列 |）、> 引用与 ## 小标题，让长回答结构清晰；除 genui 组件外不要输出代码块。',
    ASSISTANT_VISUAL_GUIDE,
    profile,
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

/** 消息正文：record:// 图表 / genui 组件独立成块，其余 Markdown */
function MessageBody({ text }: { text: string }) {
  const parts = renderAssistantMessage(text);
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
  const onBodyClick = () => onAction(streaming ? null : active ? null : idx);
  const body = (
    <>
      {!mine && thinkVisible && think && <ThinkBlock text={think} live={streaming} />}
      {mine
        ? (m.content || (streaming ? (liveThink ? '' : '…') : ''))
        : (m.content
          ? <MessageBody text={m.content} />
          : (streaming ? (liveThink ? '' : '…') : ''))}
      {!mine && !!m.think && !streaming && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleThink(idx);
          }}
          className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-2"
        >
          <Brain size={10} />
          {t('assistant.think')}
        </button>
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
          {!streaming && <ActionBtn icon={RotateCcw} label={t('assistant.redo')} onClick={() => onRedo(idx)} />}
          {!streaming && <ActionBtn icon={GitBranch} label={t('assistant.branch')} onClick={() => onBranch(idx)} />}
        </motion.div>
      )}
    </div>
  );
}

export function AssistantPage() {
  useI18n();
  const settings = useStore((s) => s.settings);
  const activeProfileId = useStore((s) => s.settings.llmActiveProfileId);
  const setTab = useStore((s) => s.setTab);
  const lastTab = useStore((s) => s.lastTab);
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
  /** 输入框是否有光标：无光标且为空时，右侧按钮切换为语音输入 */
  const [inputFocused, setInputFocused] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'starting' | 'recording' | 'processing'>('idle');
  const [voiceSec, setVoiceSec] = useState(0);
  const voiceActiveRef = useRef(false);

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
    const hist = await loadAssistantContext(histBudget, settings);
    // 内置文档检索：拿最近一条用户消息查相关文档摘录（官方口径注入，模型不瞎猜参考区间）
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const docs = lastUser ? await retrieveDocs(lastUser.content) : '';
    const sys = systemPrompt(hist.profile, hist.history, docs);
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

  /** 发送一条文本消息（文本输入与语音记录共用） */
  const sendMessage = (raw: string) => {
    const text = raw.trim();
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

  const send = () => sendMessage(input);

  /** 语音输入：本地录音 → 保存历史 → 把分析结果通过记录 id 交给助手 */
  const startVoice = async () => {
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
        mode: 'reading',
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

  /** 输入栏右侧按钮：有文字/光标 → 发送；空且失焦 → 语音；录音中 → 停止 */
  const voiceTime = `${Math.floor(voiceSec / 60)}:${String(voiceSec % 60).padStart(2, '0')}`;
  const voiceMode = !busy && !input.trim() && !inputFocused && voiceState === 'idle';
  const voicePending = voiceState === 'starting' || voiceState === 'processing';
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

  const topBar = (
    <div className="flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <button
        onClick={() => setTab(lastTab === 'assistant' ? 'test' : lastTab)}
        aria-label={t('common.back')}
        className={iconBtn}
      >
        <ArrowLeft size={18} />
      </button>
      <p className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{t('assistant.title')}</p>
      <button onClick={newChat} aria-label={t('assistant.newChat')} className={iconBtn}>
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

  const shellClass = 'fixed inset-0 z-[60] flex flex-col bg-surface';

  if (!cfg) {
    return (
      <div className={shellClass}>
        {topBar}
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-xs text-center text-sm leading-relaxed text-ink-2">{t('assistant.needConfig')}</p>
        </div>
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
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <div className="min-w-0 flex-1 rounded-2xl bg-card px-3.5 py-2.5 shadow-[0_2px_10px_rgba(28,25,45,0.06)]">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={voiceState === 'recording'
                ? t('assistant.voiceRecording', { time: voiceTime })
                : t('assistant.ph')}
              className="max-h-[120px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-2/60"
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
