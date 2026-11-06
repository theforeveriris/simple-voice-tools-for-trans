/**
 * 分析页面
 * 结构（自上而下）：
 *   1. 页头：日期 / 模式徽标 + 分享图 / CSV / 备注操作
 *   2. 声纹概览卡：平均基频 + 音域标尺（跟随当前查看区间）
 *   3. 基线对比条（设置中钉选基线时显示）
 *   4. 录音回放条（保存过音频时显示）
 *   5. 长音分析卡（长音模式记录专属：MPT / 稳定度 / 衰减）
 *   6. 统计表格：音高 / 共振峰 / 能量 / 嗓音质量四组（跟随区间）
 *   7. 四个图表（音高、共振峰、能量、语谱图），共享同一个
 *      时间轴区间选择（任一图表下方拖动，全部同步 + 统计联动），
 *      各卡显隐跟随设置的图表卡开关（analysisCards）。
 *
 * 未经过录音直接进入时显示空态提示。
 *
 * 本文件只做数据编排（当前记录 / 回放状态 / 共享时间区间）与组合排版，
 * 各卡片子组件位于 src/components/analysis/，回放引擎见 usePlayback.ts。
 */

import { useEffect, useMemo, useState } from 'react';
import { FileCode2, FileSpreadsheet, Pencil, RefreshCw, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/store/useStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { computeStats } from '@/lib/audio/recorder';
import { downloadText, recordToFrameCsv } from '@/lib/export/csv';
import { downloadBlob } from '@/lib/file';
import { recordToPitchTier, recordToFormant } from '@/lib/export/praat';
import { luaExportEnabled, luaExportOf } from '@/lib/lua/export';
import { midiBlob } from '@/lib/export/midi';
import { ShareCardSheet } from '@/components/share/ShareCardSheet';
import { renderShareCard, shareImageFilename } from '@/lib/export/shareCard';
import { exportInteractiveHtml } from '@/lib/export/interactiveHtml';
import { exportClinicalReport } from '@/lib/export/clinicalReport';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AnalysisRecord, RecordSeries } from '@/types';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui';
import { useDeferredMount } from '@/hooks/useDeferredMount';
import { HeroSummary } from '@/components/analysis/HeroCard';
import { VoiceExpressionCard } from '@/components/analysis/VoiceExpressionCard';
import { BaselineStrip } from '@/components/analysis/BaselineStrip';
import { PlaybackCard } from '@/components/analysis/PlaybackCard';
import { SustainedCard } from '@/components/analysis/SustainedCard';
import { SibilanceCard } from '@/components/analysis/SibilanceCard';
import { AdviceCard } from '@/components/analysis/AdviceCard';
import { StatsTable } from '@/components/analysis/StatsTables';
import { PitchAlgorithmCard } from '@/components/analysis/PitchAlgorithmCard';
import { ReanalyzeDialog } from '@/components/analysis/ReanalyzeDialog';
import { AnalysisChart, FormantCard, SpecCard, VrpCard } from '@/components/analysis/ChartCards';
import { NoteDialog } from '@/components/analysis/NoteDialog';
import { TemplateManager } from '@/components/analysis/TemplateManager';
import { EmptyState } from '@/components/analysis/EmptyState';
import { usePlayback } from '@/components/analysis/usePlayback';

/* -------------------------------- 数据切片 -------------------------------- */

/** 截取时间区间内的序列（统计随区间重算） */
function sliceSeries(series: RecordSeries, t0: number, t1: number): RecordSeries {
  const out: RecordSeries = { t: [], f0: [], rmsDb: [], f1: [], f2: [] };
  for (let i = 0; i < series.t.length; i++) {
    const t = series.t[i];
    if (t < t0 - 1e-6 || t > t1 + 1e-6) continue;
    out.t.push(t);
    out.f0.push(series.f0[i]);
    out.rmsDb.push(series.rmsDb[i]);
    out.f1.push(series.f1[i]);
    out.f2.push(series.f2[i]);
  }
  return out;
}

/** 分析页图表种类（含语谱图/声域图），用于独立时间轴模式 */
type RangedKind = 'pitch' | 'formant' | 'energy' | 'spec' | 'vrp';

export function AnalysisPage() {
  useI18n();
  const record = useStore((s) => s.currentAnalysis);
  const syncChartRange = useStore((s) => s.settings.syncChartRange);
  const baselineId = useStore((s) => s.settings.baselineRecordId);
  const settings = useStore((s) => s.settings);
  const pendingAutoReplay = useStore((s) => s.pendingAutoReplay);
  const clearPendingAutoReplay = useStore((s) => s.clearPendingAutoReplay);
  const baselineRecord = useHistoryStore((s) =>
    baselineId ? s.records.find((r) => r.id === baselineId) ?? null : null,
  );
  const [sharedRange, setSharedRange] = useState<[number, number]>([0, record?.durationSec ?? 0]);
  const [ownRanges, setOwnRanges] = useState<Partial<Record<RangedKind, [number, number]>>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // 用当前算法参数重算（先预览新旧对比，确认后才覆盖）
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  // 交互 HTML 报告：含音频与否的选择弹窗（无音频记录直接导出）
  const [htmlDialogOpen, setHtmlDialogOpen] = useState(false);
  const [htmlBusy, setHtmlBusy] = useState(false);
  // 帧数据导出（CSV / Praat PitchTier / Praat Formant / Lua 自定义格式）弹窗
  const [exportOpen, setExportOpen] = useState(false);
  // Lua 自定义格式导出（脚本中心 export 脚本；入口可用性由探测 state 控制）
  const [luaExportAvailable, setLuaExportAvailable] = useState(false);
  const [luaExportBusy, setLuaExportBusy] = useState(false);
  const recordId = record?.id ?? null;
  useEffect(() => {
    let alive = true;
    void luaExportEnabled().then((v) => {
      if (alive) setLuaExportAvailable(v);
    }).catch(() => setLuaExportAvailable(false));
    return () => { alive = false; };
  }, [recordId]);

  const fullRange = useMemo<[number, number]>(() => [0, record?.durationSec ?? 0], [record?.durationSec]);
  const getRange = (kind: RangedKind): [number, number] =>
    syncChartRange ? sharedRange : (ownRanges[kind] ?? fullRange);
  const setRangeFor = (kind: RangedKind, r: [number, number]) => {
    if (syncChartRange) setSharedRange(r);
    else setOwnRanges((prev) => ({ ...prev, [kind]: r }));
  };

  // 切换记录时重置区间（回放位置由 usePlayback 同步重置；渲染期派生，避免 effect 级联渲染）
  const [loadedRecordId, setLoadedRecordId] = useState<string | null>(record?.id ?? null);
  if (record && record.id !== loadedRecordId) {
    setLoadedRecordId(record.id);
    setSharedRange([0, record.durationSec]);
    setOwnRanges({});
  }

  // 回放：音频元素挂在页面层，播放头位置驱动全部图表
  const pitchRange = getRange('pitch');
  const playback = usePlayback(record, pitchRange);

  // 录完自动回放：标记置位且音频源就绪后播放一次并消费。
  // store 侧仅在记录带音频时置位标记；无音频场景标记不会被置位，
  // 播放失败等边缘情况至多残留到下一条音频就绪的记录，可接受
  const { audioUrl, togglePlay } = playback;
  useEffect(() => {
    if (!pendingAutoReplay || !audioUrl) return;
    clearPendingAutoReplay();
    void togglePlay();
  }, [pendingAutoReplay, audioUrl, clearPendingAutoReplay, togglePlay]);

  // R = 回放 / 暂停当前记录（页面级快捷键；输入控件聚焦或对话框打开时不接管，
  // 与历史页 / 测试页快捷键同一豁免口径）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key !== 'r' && e.key !== 'R') return;
      const target = e.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.tagName === 'BUTTON'
          || target.isContentEditable)
      ) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      void togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  // 区间联动统计：跟随音高曲线的区间（联动模式下即共享区间）。
  // 统一由序列重算（含全段）：保证与区间统计口径一致（如响度只计发声帧）；
  // 嗓音质量四项与靶标达成率是整段录音的临床指标，沿用录音时的整段值
  const contentReady = useDeferredMount();
  const rangeStats = useMemo(() => {
    if (!record) return null;
    const r = syncChartRange ? sharedRange : (ownRanges.pitch ?? fullRange);
    return {
      ...computeStats(sliceSeries(record.series, r[0], r[1]), record.sampleHz),
      // 以下来自整段录音的离线分析（或整段临床指标），不随查看区间变化：
      // 必须原样带过来，否则表格会显示成「—」
      jitterPct: record.stats.jitterPct,
      shimmerPct: record.stats.shimmerPct,
      hnrDb: record.stats.hnrDb,
      cppsDb: record.stats.cppsDb,
      h1h2Db: record.stats.h1h2Db,
      h2h4Db: record.stats.h2h4Db,
      h1a3Db: record.stats.h1a3Db,
      breathiness: record.stats.breathiness,
      nasalityDb: record.stats.nasalityDb,
      spectralTiltDbOct: record.stats.spectralTiltDbOct,
      inTargetPct: record.stats.inTargetPct,
    };
  }, [record, syncChartRange, sharedRange, ownRanges, fullRange]);

  if (!record || !rangeStats) return <EmptyState />;

  const recordWithStats: AnalysisRecord = { ...record, stats: rangeStats };
  const showBaseline = baselineRecord && baselineRecord.id !== record.id
    && (baselineRecord.stats.avgF0 > 0 || record.stats.avgF0 > 0);

  const onExportCsv = () => {
    downloadText(`voice-frames-${record.id.slice(0, 8)}.csv`, recordToFrameCsv(record));
    toast.success(t('toast.frameCsvExported'));
  };

  /** MIDI 导出（音高曲线 → 音符 + 弯音） */
  const onExportMidi = () => {
    downloadBlob(`voice-${record.id.slice(0, 8)}.mid`, midiBlob(record));
    toast.success(t('toast.midiExported'));
    setExportOpen(false);
  };

  /** Praat 对象导出（PitchTier = 基频曲线；Formant = 逐帧 F1/F2） */
  const onExportPraat = (kind: 'pitchTier' | 'formant') => {
    const stem = `voice-${record.id.slice(0, 8)}`;
    if (kind === 'pitchTier') {
      downloadText(`${stem}.PitchTier`, recordToPitchTier(record));
    } else {
      downloadText(`${stem}.Formant`, recordToFormant(record));
    }
    toast.success(t('toast.praatExported'));
    setExportOpen(false);
  };

  /** Lua 自定义格式导出（脚本中心 export 脚本） */
  const onExportLua = async () => {
    if (!record || luaExportBusy) return;
    setLuaExportBusy(true);
    try {
      const result = await luaExportOf(record);
      if (!result) {
        toast.error(t('toast.luaExportFail'));
        return;
      }
      downloadText(result.filename, result.content);
      toast.success(t('toast.luaExported'));
      setExportOpen(false);
    } finally {
      setLuaExportBusy(false);
    }
  };

  /** 交互 HTML 报告导出（withAudio 决定是否内嵌录音） */
  const onExportHtml = async (withAudio: boolean) => {
    if (htmlBusy) return;
    setHtmlBusy(true);
    setHtmlDialogOpen(false);
    try {
      const audio = withAudio ? await useHistoryStore.getState().getAudio(record.id) : null;
      await exportInteractiveHtml(record, { audio });
      toast.success(t('toast.htmlExported'));
    } catch {
      toast.error(t('toast.htmlExportFail'));
    } finally {
      setHtmlBusy(false);
    }
  };

  /** 入口：有录音音频先弹选择，无音频直接导出纯数据版 */
  const onHtmlClick = async () => {
    if (htmlBusy) return;
    const audio = await useHistoryStore.getState().getAudio(record.id);
    if (audio) setHtmlDialogOpen(true);
    else void onExportHtml(false);
  };

  /** 用当前参数重算：无录音音频直接提示；有则打开重算对话框（内部跑管线出对比） */
  const onReanalyzeClick = async () => {
    const audio = await useHistoryStore.getState().getAudio(record.id);
    if (!audio) {
      toast.info(t('analysis.reanalyzeNeedAudio'));
      return;
    }
    setReanalyzeOpen(true);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <HeroSummary
        record={recordWithStats}
        range={pitchRange}
        actions={
          <>
            <button
              onClick={() => setShareOpen(true)}
              className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-accent"
              aria-label={t('analysis.shareAria')}
              title={t('analysis.shareTitle')}
            >
              <Share2 size={16} />
            </button>
            <button
              onClick={() => setExportOpen(true)}
              className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-accent"
              aria-label={t('analysis.csvAria')}
              title={t('analysis.exportDataTitle')}
            >
              <FileSpreadsheet size={16} />
            </button>
            <button
              onClick={() => void onHtmlClick()}
              disabled={htmlBusy}
              className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-accent disabled:opacity-60"
              aria-label={t('analysis.htmlAria')}
              title={t('analysis.htmlTitle')}
            >
              <FileCode2 size={16} />
            </button>
            <button
              onClick={() => void onReanalyzeClick()}
              className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-accent"
              aria-label={t('analysis.reanalyzeAria')}
              title={t('analysis.reanalyzeAria')}
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => setNoteOpen(true)}
              className={cn(
                'grid size-9 place-items-center rounded-full transition-colors hover:bg-surface-hi hover:text-accent',
                record.note ? 'text-accent' : 'text-ink-2',
              )}
              aria-label={t('analysis.noteAria')}
              title={t('analysis.noteAria')}
            >
              <Pencil size={15} />
            </button>
          </>
        }
      />
      {/* 重内容延迟两帧挂载：Hero 概览先随入场动画绘制（见 useDeferredMount） */}
      {!contentReady && <div className="min-h-[60vh]" aria-hidden />}
      {contentReady && (<>
      <VoiceExpressionCard record={recordWithStats} />
      {showBaseline && baselineRecord && <BaselineStrip record={record} baseline={baselineRecord} />}
      <PlaybackCard
        url={playback.audioUrl}
        playing={playback.playing}
        position={playback.playTime}
        duration={playback.audioDur || record.durationSec}
        onToggle={playback.togglePlay}
        onSeek={playback.seekPlay}
      />
      {record.mode === 'sustained' && <SustainedCard record={record} />}
      <SibilanceCard record={record} />
      {settings.pitchCompareEnabled && <PitchAlgorithmCard record={record} />}
      <StatsTable record={recordWithStats} />
      <AdviceCard records={[record]} />

      {/* 图表卡显隐跟随设置（analysisCards）；语谱图另需实验性开关，声域图仅滑音记录 */}
      {settings.analysisCards.pitch && (
        <AnalysisChart
          kind="pitch"
          title={t('analysis.titlePitch')}
          record={recordWithStats}
          heightClass="h-[210px] sm:h-[280px]"
          range={pitchRange}
          onRangeChange={(r) => setRangeFor('pitch', r)}
          playhead={playback.playTime}
        />
      )}
      {/* 共振峰卡片：曲线 / 元音空间散点双视图 */}
      {settings.analysisCards.formant && (
        <FormantCard
          record={record}
          range={getRange('formant')}
          onRangeChange={(r) => setRangeFor('formant', r)}
          playhead={playback.playTime}
        />
      )}
      {settings.analysisCards.energy && (
        <AnalysisChart
          kind="energy"
          title={t('analysis.titleEnergy')}
          record={record}
          heightClass="h-[130px] sm:h-[180px]"
          range={getRange('energy')}
          onRangeChange={(r) => setRangeFor('energy', r)}
          playhead={playback.playTime}
        />
      )}
      {record.spec && settings.showSpectrogram && settings.analysisCards.spec && (
        <SpecCard
          record={record}
          range={getRange('spec')}
          onRangeChange={(r) => setRangeFor('spec', r)}
          playhead={playback.playTime}
        />
      )}
      {/* 声域图（VRP）：仅滑音模式记录显示 */}
      {record.mode === 'glide' && settings.analysisCards.vrp && (
        <VrpCard
          record={record}
          range={getRange('vrp')}
          onRangeChange={(r) => setRangeFor('vrp', r)}
          playhead={playback.playTime}
        />
      )}

      </>)}

      <NoteDialog record={record} open={noteOpen} onOpenChange={setNoteOpen} />

      {/* 用当前参数重算：新旧统计对比后确认覆盖 */}
      <ReanalyzeDialog record={record} open={reanalyzeOpen} onOpenChange={setReanalyzeOpen} />

      {/* 交互 HTML 报告：是否内嵌录音音频 */}
      <Dialog open={htmlDialogOpen} onOpenChange={setHtmlDialogOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t('html.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('html.dialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => void onExportHtml(true)}
              disabled={htmlBusy}
              className="rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-left transition-colors hover:border-accent disabled:opacity-60"
            >
              <span className="block text-sm font-medium text-ink">{t('html.withAudio')}</span>
              <span className="mt-0.5 block text-xs text-ink-2">{t('html.withAudioDesc')}</span>
            </button>
            <button
              onClick={() => void onExportHtml(false)}
              disabled={htmlBusy}
              className="rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-left transition-colors hover:border-accent disabled:opacity-60"
            >
              <span className="block text-sm font-medium text-ink">{t('html.withoutAudio')}</span>
              <span className="mt-0.5 block text-xs text-ink-2">{t('html.withoutAudioDesc')}</span>
            </button>
            {/* 临床报告：静态排版（打印为 PDF），面向医生 / 言语治疗师的存档格式 */}
            <button
              onClick={() => {
                setHtmlDialogOpen(false);
                exportClinicalReport(record);
                toast.success(t('toast.clinicalExported'));
              }}
              className="rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-left transition-colors hover:border-accent"
            >
              <span className="block text-sm font-medium text-ink">{t('html.clinical')}</span>
              <span className="mt-0.5 block text-xs text-ink-2">{t('html.clinicalDesc')}</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 帧数据导出：CSV / Praat PitchTier / Praat Formant /（Lua 自定义格式，有启用脚本时出现） */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t('analysis.exportDataTitle')}</DialogTitle>
            <DialogDescription>{t('analysis.exportDataDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              onClick={onExportCsv}
              className="rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-left transition-colors hover:border-accent"
            >
              <span className="block text-sm font-medium text-ink">{t('analysis.exportCsv')}</span>
              <span className="mt-0.5 block text-xs text-ink-2">{t('analysis.exportCsvDesc')}</span>
            </button>
            <button
              onClick={onExportMidi}
              className="rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-left transition-colors hover:border-accent"
            >
              <span className="block text-sm font-medium text-ink">{t('analysis.exportMidi')}</span>
              <span className="mt-0.5 block text-xs text-ink-2">{t('analysis.exportMidiDesc')}</span>
            </button>
            <button
              onClick={() => onExportPraat('pitchTier')}
              className="rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-left transition-colors hover:border-accent"
            >
              <span className="block text-sm font-medium text-ink">{t('analysis.exportPitchTier')}</span>
              <span className="mt-0.5 block text-xs text-ink-2">{t('analysis.exportPitchTierDesc')}</span>
            </button>
            <button
              onClick={() => onExportPraat('formant')}
              className="rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-left transition-colors hover:border-accent"
            >
              <span className="block text-sm font-medium text-ink">{t('analysis.exportFormant')}</span>
              <span className="mt-0.5 block text-xs text-ink-2">{t('analysis.exportFormantDesc')}</span>
            </button>
            {luaExportAvailable && (
              <button
                onClick={() => void onExportLua()}
                disabled={luaExportBusy}
                className="rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-left transition-colors hover:border-accent disabled:opacity-50"
              >
                <span className="block text-sm font-medium text-ink">{t('analysis.exportLua')}</span>
                <span className="mt-0.5 block text-xs text-ink-2">{t('analysis.exportLuaDesc')}</span>
              </button>
            )}
            <TemplateManager record={record} onDone={() => setExportOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      {/* 回放音频源（页面级，播放头位置由 rAF 循环同步到各图表） */}
      <audio {...playback.audioProps} />

      <ShareCardSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        render={(style) => renderShareCard(record, style)}
        filename={shareImageFilename(record)}
        luaRecord={record}
      />
    </div>
  );
}
