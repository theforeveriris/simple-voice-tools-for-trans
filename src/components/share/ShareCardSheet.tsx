/**
 * 分享图样式选择底部弹层：四种样式（主题/暗色/浅色/极光）实时预览，
 * 主按钮走系统分享（可用时）或下载 PNG。渲染函数由调用方注入
 * （单条记录 / 两两对比共用同一弹层）。
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { shareOrDownload, type ShareCardStyle } from '@/lib/export/shareCard';
import { renderLuaCard } from '@/lib/lua/cardRender';
import { activeScriptOf, subscribeScripts } from '@/lib/lua/scripts';
import { cn } from '@/lib/utils';

const STYLE_OPTIONS: { id: ShareCardStyle; labelKey: 'share.styleThemed' | 'share.styleDark' | 'share.styleLight' | 'share.styleAurora' | 'share.styleFlower' }[] = [
  { id: 'themed', labelKey: 'share.styleThemed' },
  { id: 'dark', labelKey: 'share.styleDark' },
  { id: 'light', labelKey: 'share.styleLight' },
  { id: 'aurora', labelKey: 'share.styleAurora' },
  { id: 'flower', labelKey: 'share.styleFlower' },
];

export function ShareCardSheet({
  open,
  onClose,
  render,
  filename,
  luaRecord,
}: {
  open: boolean;
  onClose: () => void;
  /** 按样式绘制分享卡（预览与导出共用同一渲染入口） */
  render: (style: ShareCardStyle) => HTMLCanvasElement;
  filename: string;
  /** Lua 模板卡的渲染记录（style = 'lua' 时使用） */
  luaRecord?: import('@/types').AnalysisRecord | null;
}) {
  useI18n();
  const [style, setStyle] = useState<ShareCardStyle>('themed');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Lua 模板可用性 + 生效脚本名：弹层打开时探测并订阅脚本中心变更 */
  const [luaAvailable, setLuaAvailable] = useState(false);
  const [luaName, setLuaName] = useState('');
  /** 异步渲染的 Lua 预览图（与内置样式的同步预览分轨） */
  const [luaPreview, setLuaPreview] = useState<string | null>(null);
  /** 触发本次 Lua 渲染的 style 快照（style 切换后丢弃过期结果） */
  const [luaFor, setLuaFor] = useState<ShareCardStyle | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // 探测 + 订阅：有生效的 card 脚本才显示「Lua 模板」项；脚本失效时若停在 Lua 样式则回退
    const probe = () => {
      void activeScriptOf('card').then((s) => {
        if (!alive) return;
        setLuaAvailable(s !== null);
        setLuaName(s?.name ?? '');
        if (s === null) setStyle((prev) => (prev === 'lua' ? 'themed' : prev));
      }).catch(() => {
        if (!alive) return;
        setLuaAvailable(false);
        setLuaName('');
        setStyle((prev) => (prev === 'lua' ? 'themed' : prev));
      });
    };
    probe();
    const unsubscribe = subscribeScripts(probe);
    return () => { alive = false; unsubscribe(); };
  }, [open]);

  // 切换样式即重渲染预览；render 闭包随父组件更新（开销为一次 Canvas 绘制，可接受）
  useEffect(() => {
    if (!open) return;
    if (style === 'lua') {
      // Lua 模板：异步渲染
      let alive = true;
      setLuaFor(style);
      if (!luaRecord) {
        setLuaPreview(null);
        return;
      }
      void renderLuaCard(luaRecord).then((canvas) => {
        if (alive) setLuaPreview(canvas?.toDataURL('image/png') ?? null);
      }).catch(() => {
        if (alive) setLuaPreview(null);
      });
      return () => { alive = false; };
    }
    try {
      setPreview(render(style).toDataURL('image/png'));
    } catch {
      setPreview(null);
    }
  }, [open, style, render, luaRecord]);

  const onShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let canvas: HTMLCanvasElement;
      if (style === 'lua') {
        if (!luaRecord) throw new Error('no record for lua card');
        const rendered = await renderLuaCard(luaRecord);
        if (!rendered) throw new Error('lua card render failed');
        canvas = rendered;
      } else {
        canvas = render(style);
      }
      const outcome = await shareOrDownload(canvas, filename);
      if (outcome === 'downloaded') toast.success(t('toast.shareDownloaded'));
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') toast.error(t('toast.shareFail'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[160]">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        className="absolute inset-x-0 bottom-0 mx-auto max-w-2xl rounded-t-[28px] bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-[0_-10px_40px_rgba(28,25,45,0.18)]"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">{t('share.pickStyle')}</p>
          <button
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="grid size-8 place-items-center rounded-full text-ink-2 transition-transform active:scale-90"
          >
            <X size={16} />
          </button>
        </div>

        {(style === 'lua'
          ? (luaFor === 'lua' ? luaPreview : null)
          : preview) ? (
          <img
            src={(style === 'lua' ? luaPreview : preview) ?? undefined}
            alt=""
            className="mx-auto max-h-[44dvh] rounded-2xl shadow-[0_4px_24px_rgba(28,25,45,0.14)]"
          />
        ) : (
          <div className="grid h-56 place-items-center rounded-2xl bg-card">
            <Loader2 size={18} className="animate-spin text-ink-2" />
          </div>
        )}

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {STYLE_OPTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              className={cn(
                'shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-colors',
                style === s.id
                  ? 'bg-accent text-white'
                  : 'bg-card text-ink-2 shadow-[0_1px_4px_rgba(28,25,45,0.06)]',
              )}
            >
              {t(s.labelKey)}
            </button>
          ))}
          {luaAvailable && luaRecord && (
            <button
              onClick={() => setStyle('lua')}
              className={cn(
                'shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-colors',
                style === 'lua'
                  ? 'bg-accent text-white'
                  : 'bg-card text-ink-2 shadow-[0_1px_4px_rgba(28,25,45,0.06)]',
              )}
            >
              {luaName ? t('share.styleLuaNamed', { name: luaName }) : t('share.styleLua')}
            </button>
          )}
        </div>

        <button
          onClick={onShare}
          disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
          {t('share.shareAction')}
        </button>
      </motion.div>
    </div>
  );
}
