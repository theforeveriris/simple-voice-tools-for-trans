/**
 * 扫码弹窗（局域网同步用）
 * 打开后置摄像头逐帧识别二维码：
 * - 支持 BarcodeDetector 的浏览器（Android Chrome / ChromeOS）走原生识别
 * - 其余浏览器动态加载 jsQR 做纯 JS 解码（桌面 Chrome / Firefox / Safari、iOS）
 * 识别成功后把文本交给调用方（调用方再解压成 SDP）。
 */

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue?: string }[]>;
}

type JsQrFn = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;

/** 解码时的最大边长：太小认不出，太大拖慢逐帧解码 */
const MAX_SCAN_EDGE = 640;
/** 每帧解码间隔（约 8 帧/秒，扫静态二维码足够） */
const FRAME_INTERVAL_MS = 120;

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
    let done = false;
    /** 上一帧解码时间（jsQR 限流；原生识别同样复用） */
    let lastScan = 0;
    let detector: BarcodeDetectorLike | null = null;
    let jsqr: JsQrFn | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    /** 解码一帧；失败或未识别返回 undefined */
    const detectFrame = async (video: HTMLVideoElement): Promise<string | undefined> => {
      if (detector) {
        try {
          const codes = await detector.detect(video);
          return codes.find((c) => c.rawValue)?.rawValue;
        } catch {
          return undefined;
        }
      }
      if (!jsqr || !ctx || video.videoWidth === 0 || video.videoHeight === 0) return undefined;
      const scale = Math.min(1, MAX_SCAN_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.max(1, Math.round(video.videoWidth * scale));
      const h = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      return jsqr(img.data, w, h)?.data || undefined;
    };

    void (async () => {
      try {
        const Detector = (window as unknown as {
          BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike;
        }).BarcodeDetector;
        if (typeof Detector === 'function') {
          detector = new Detector({ formats: ['qr_code'] });
        } else {
          // 按需加载：不支持原生识别的浏览器才付出这份解码器体积
          const mod = await import('jsqr');
          jsqr = mod.default as JsQrFn;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
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

        const tick = async (now: number) => {
          if (cancelled || done) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && now - lastScan >= FRAME_INTERVAL_MS) {
            lastScan = now;
            const text = await detectFrame(v);
            if (text) {
              done = true;
              onResultRef.current(text);
              return;
            }
          }
          raf = window.requestAnimationFrame((ts) => void tick(ts));
        };
        raf = window.requestAnimationFrame((ts) => void tick(ts));
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
