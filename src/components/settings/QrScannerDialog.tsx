/**
 * 扫码弹窗（局域网同步用）
 * 用 getUserMedia 打开后置摄像头，配合 BarcodeDetector 逐帧识别二维码，
 * 识别成功后把文本交给调用方（调用方再解压成 SDP）。
 * BarcodeDetector 不可用的浏览器不显示扫码入口，退回粘贴文本。
 */

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue?: string }[]>;
}

export function QrScannerDialog({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 回调放 ref 里：父组件重渲染不重启摄像头 */
  const onResultRef = useRef(onResult);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onResultRef.current = onResult;
    onCloseRef.current = onClose;
  }, [onResult, onClose]);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let detector: BarcodeDetectorLike | null = null;
    /** 识别成功即置位，避免同一帧重复回调 */
    let done = false;

    void (async () => {
      try {
        const Detector = (window as unknown as {
          BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike;
        }).BarcodeDetector;
        detector = new Detector({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});

        const tick = async () => {
          if (cancelled || done) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && detector) {
            try {
              const codes = await detector.detect(v);
              const text = codes.find((c) => c.rawValue)?.rawValue;
              if (text) {
                done = true;
                onResultRef.current(text);
                return;
              }
            } catch {
              /* 单帧识别失败继续下一帧 */
            }
          }
          raf = window.requestAnimationFrame(() => void tick());
        };
        raf = window.requestAnimationFrame(() => void tick());
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 px-6" onClick={() => onCloseRef.current()}>
      <div
        className="card-surface relative w-full max-w-sm overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">{t('lanSync.scanTitle')}</p>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-hi"
          >
            <X size={15} />
          </button>
        </div>
        {error ? (
          <p className="py-6 text-center text-[11px] leading-relaxed text-[#B0532F]">
            {t('lanSync.scanFail')}
          </p>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-square w-full rounded-xl bg-black object-cover"
            />
            <p className="mt-2 text-center text-[11px] text-ink-2">{t('lanSync.scanHint')}</p>
          </>
        )}
      </div>
    </div>
  );
}
