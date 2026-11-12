/**
 * 录音崩溃恢复提示
 * 启动时扫描 IndexedDB 中未完成的录音草稿：
 *   - 草稿对应的记录已正常落库：静默清理，不打扰用户；
 *   - 记录不存在：弹窗询问「恢复 / 放弃」，恢复后重新分析并走正常落库。
 * 该组件挂在 LockGate 内，应用锁未解锁时不会显示任何草稿信息。
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useStore } from '@/store/useStore';
import { analyzeAudioFile, importErrorKey } from '@/lib/audio/importAudio';
import { RECORDING_MAX_SEC } from '@/lib/audio/recorder';
import {
  clearRecordingDraft,
  clearRecordingDraftIfSaved,
  draftRecordExists,
  hasRecordingDraft,
  linkRecordingDraftRecord,
  loadRecordingDraft,
  type RecordingDraft,
} from '@/lib/audio/recordingDraft';
import { maybeAutoBackup } from '@/lib/backup/local';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { TestMode } from '@/types';

const MODES: readonly TestMode[] = ['reading', 'sustained', 'glide'];

/** 启动扫描只执行一次（StrictMode 二次挂载不重复读取草稿） */
let startupScan: Promise<RecordingDraft | null> | null = null;

function scanDraft(): Promise<RecordingDraft | null> {
  if (!startupScan) {
    startupScan = (async () => {
      const draft = await loadRecordingDraft();
      if (!draft) {
        // 元数据还在但没有音频块：清理孤儿草稿，避免设置页一直显示「未完成」
        if (await hasRecordingDraft()) await clearRecordingDraft();
        return null;
      }
      if (await draftRecordExists(draft.meta)) {
        await clearRecordingDraft();
        return null;
      }
      return draft;
    })().catch(() => null);
  }
  return startupScan;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  return 'webm';
}

export function RecordingRecoveryPrompt() {
  useI18n();
  const [draft, setDraft] = useState<RecordingDraft | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void scanDraft().then((found) => {
      if (!cancelled && found) setDraft(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!draft) return null;

  const discard = () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    const id = draft?.meta.id;
    setDraft(null);
    startupScan = Promise.resolve(null);
    void clearRecordingDraft(id);
    toast.success(t('recover.discarded'));
  };

  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const { meta, audio } = draft;
      const file = new File([audio], `recovered-${meta.id}.${fileExtension(meta.mimeType)}`, {
        type: meta.mimeType || 'audio/webm',
      });
      const { record, audio: savedAudio } = await analyzeAudioFile(file, {
        targetRange: meta.targetRange,
        saveAudio: useStore.getState().settings.audioSave,
        // 实时录音上限 10 分钟；恢复时不能按外部导入的 5 分钟截断
        maxSec: RECORDING_MAX_SEC,
      });
      // 恢复的记录不是「导入文件」：去掉文件名备注，并还原录音时间与模式
      delete record.note;
      record.createdAt = meta.startedAt;
      if (MODES.includes(meta.mode)) record.mode = meta.mode;

      const saved = await useHistoryStore.getState().addRecord(record, savedAudio ?? undefined);
      if (!saved) {
        // 写库失败：保留草稿和弹窗，用户可以重试或下次启动再恢复
        toast.error(t('recover.failed'));
        return;
      }
      // 先把新记录 id 写回草稿，再等记录与音频都落库后清理
      await linkRecordingDraftRecord(record.id);
      setDraft(null);
      window.setTimeout(() => void clearRecordingDraftIfSaved(true), 1500);
      // 应用锁切换会卸载/重挂本组件；清掉扫描缓存，避免恢复后再次弹出
      startupScan = Promise.resolve(null);
      useStore.getState().setCurrentAnalysis(record);
      if (useStore.getState().settings.autoEnterAnalysis) useStore.getState().setTab('analysis');
      void maybeAutoBackup('record');
      toast.success(t('recover.restored'));
    } catch (err) {
      // 草稿保留，用户可以重试或手动放弃
      toast.error(err instanceof Error && 'reason' in err ? t(importErrorKey(err)) : t('recover.failed'));
    } finally {
      setRestoring(false);
    }
  };

  const started = new Date(draft.meta.startedAt);
  const date = `${started.getFullYear()}/${started.getMonth() + 1}/${started.getDate()} ${String(
    started.getHours(),
  ).padStart(2, '0')}:${String(started.getMinutes()).padStart(2, '0')}`;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-ink">{t('recover.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-relaxed text-ink-2">
          {t('recover.desc', { date, size: formatSize(draft.meta.totalBytes || draft.audio.size) })}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={discard}
            disabled={restoring}
            className="flex-1 rounded-full bg-surface-hi py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {confirmDiscard ? t('recover.discardConfirm') : t('recover.discard')}
          </button>
          <button
            onClick={() => void restore()}
            disabled={restoring}
            className="flex-1 rounded-full bg-accent py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {restoring ? t('recover.restoring') : t('recover.restore')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
