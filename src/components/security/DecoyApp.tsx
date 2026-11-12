/**
 * 第二 PIN（duress / decoy）解锁后的独立界面。
 *
 * 刻意不挂载主应用的任何页面或 store：这里没有真实记录、设置、AI Key 或音频，
 * 只有一份内存里的演示数据。它属于界面层安全模式，不是加密；
 * 真实数据仍在 IndexedDB 里，拿得到设备与开发者工具的人仍可能提取。
 */

import { useEffect, useState } from 'react';
import { LockKeyhole, Mic, Square } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { lockNowSafely } from '@/lib/security/manualLock';
import { createDemoRecord } from '@/lib/audio/demo';
import type { AnalysisRecord } from '@/types';

function formatClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function DecoyApp() {
  useI18n();
  const [tab, setTab] = useState<'test' | 'history'>('test');
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const toggle = () => {
    if (!recording) {
      setSeconds(0);
      setRecording(true);
      return;
    }
    setRecording(false);
    const record = createDemoRecord();
    record.id = crypto.randomUUID?.() ?? `demo-${Date.now()}`;
    record.createdAt = Date.now();
    setRecords((all) => [record, ...all]);
    setTab('history');
  };

  const lock = () => {
    // 诱饵录音只存在于内存，锁定前停掉，避免 lockNowSafely 把它当作真实录音落库
    if (recording) setRecording(false);
    void lockNowSafely();
  };

  return (
    <div className="min-h-dvh bg-surface text-ink">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-5 pt-8 pb-10">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold">Simple Voice Tool</p>
            <p className="text-[11px] text-ink-2">{t('decoy.subtitle')}</p>
          </div>
          <button
            onClick={lock}
            aria-label={t('decoy.lock')}
            className="grid size-10 place-items-center rounded-full bg-card text-ink-2 shadow-[0_2px_14px_rgba(28,25,45,0.05)] transition-transform active:scale-90"
          >
            <LockKeyhole size={17} />
          </button>
        </header>

        <div className="flex gap-1.5">
          {(['test', 'history'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                tab === item ? 'bg-accent text-on-accent' : 'bg-card text-ink-2'
              }`}
            >
              {t(item === 'test' ? 'nav.test' : 'nav.history')}
            </button>
          ))}
        </div>

        {tab === 'test' ? (
          <div className="card-surface flex flex-col items-center gap-4 px-5 py-8 text-center">
            {records.length === 0 ? (
              <>
                <p className="text-sm font-semibold text-ink">{t('history.emptyTitle')}</p>
                <p className="max-w-xs text-xs leading-relaxed text-ink-2">{t('decoy.emptyHint')}</p>
              </>
            ) : (
              <p className="text-sm font-semibold text-ink">{t('decoy.readyTitle')}</p>
            )}
            <button
              onClick={toggle}
              aria-label={t(recording ? 'nav.recordStopAria' : 'nav.recordStartAria')}
              className="relative grid size-24 place-items-center rounded-full bg-accent text-on-accent shadow-[0_12px_34px_rgba(28,25,45,0.18)] transition-transform active:scale-95"
            >
              {recording ? <Square size={26} fill="currentColor" /> : <Mic size={30} />}
            </button>
            <p className="text-xs tabular-nums text-ink-2">
              {recording ? t('assistant.voiceRecording', { time: formatClock(seconds) }) : t('decoy.startHint')}
            </p>
          </div>
        ) : records.length === 0 ? (
          <div className="card-surface flex flex-col items-center gap-2 px-5 py-10 text-center">
            <p className="text-sm font-semibold text-ink">{t('history.emptyTitle')}</p>
            <p className="max-w-xs text-xs leading-relaxed text-ink-2">{t('decoy.emptyHint')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {records.map((record) => (
              <div key={record.id} className="card-surface flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-ink">
                    {new Date(record.createdAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                  <p className="text-[11px] text-ink-2">
                    {t('mode.reading')} · {record.durationSec.toFixed(1)} s
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {record.stats.avgF0 != null ? `${Math.round(record.stats.avgF0)} Hz` : '—'}
                  </p>
                  <p className="text-[10px] text-ink-2">{t('analysis.avgF0')}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-auto text-center text-[10px] leading-relaxed text-ink-2/70">{t('decoy.aboutText')}</p>
      </div>
    </div>
  );
}
