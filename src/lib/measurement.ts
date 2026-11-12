/**
 * 录音质量与最小可检测变化（MDC）
 *
 * 这里的阈值是产品初值，不是临床标准：目的是避免把环境噪声、短录音或
 * 测量波动误写成「进步 / 退化」。后续可以用用户自己的重复测试校准。
 */
import type { AnalysisRecord, TestMode } from '@/types';

export type QualityLevel = 'ok' | 'warn' | 'bad';

export interface RecordQuality {
  level: QualityLevel;
  score: number;
  reasons: string[];
}

export type MdcMetric =
  | 'medianF0'
  | 'avgF1'
  | 'avgF2'
  | 'jitter'
  | 'shimmer'
  | 'hnr'
  | 'cpps'
  | 'inTarget';

/** 保守 MDC 初值；单位与对应指标一致 */
export const MDC: Record<MdcMetric, number> = {
  medianF0: 12,
  avgF1: 35,
  avgF2: 45,
  jitter: 0.6,
  shimmer: 1.2,
  hnr: 1.5,
  cpps: 1.2,
  inTarget: 8,
};

/** 差值是否超出测量波动范围 */
export function deltaIsSignificant(metric: MdcMetric, delta: number): boolean {
  return Math.abs(delta) >= MDC[metric];
}

/** 低于该时长视为过短（秒） */
const MIN_DURATION: Record<TestMode | 'unknown', number> = {
  reading: 5,
  sustained: 7,
  glide: 5,
  unknown: 5,
};

/**
 * 评估一条记录的可解读程度。
 * 只使用已有字段：durationSec、stats、env.noiseFloorDb、stats.peakDb、有声帧占比。
 */
export function assessRecordQuality(record: AnalysisRecord): RecordQuality {
  const stats = record.stats;
  const reasons: string[] = [];
  let score = 100;

  const duration = Number.isFinite(stats.durationSec) ? stats.durationSec : record.durationSec;
  const minDuration = MIN_DURATION[record.mode ?? 'unknown'];
  if (duration < minDuration / 2) {
    reasons.push(`录音仅 ${duration.toFixed(1)} 秒，过短`);
    score -= 45;
  } else if (duration < minDuration) {
    reasons.push(`录音 ${duration.toFixed(1)} 秒，偏短`);
    score -= 20;
  }

  const noise = record.env?.noiseFloorDb;
  if (typeof noise === 'number' && Number.isFinite(noise)) {
    if (noise > -30) {
      reasons.push(`底噪 ${noise.toFixed(0)} dB，环境偏吵`);
      score -= 30;
    } else if (noise > -40) {
      reasons.push(`底噪 ${noise.toFixed(0)} dB，建议安静环境`);
      score -= 12;
    }
  }

  const peak = stats.peakDb;
  if (typeof peak === 'number' && Number.isFinite(peak) && peak >= -1) {
    reasons.push('峰值接近满幅，可能削波');
    score -= 25;
  }

  const total = stats.totalSamples;
  const voiced = stats.voicedSamples;
  const voicedRatio = total > 0 ? voiced / total : 0;
  if (total > 0 && voicedRatio < 0.15) {
    reasons.push(`有声帧仅 ${Math.round(voicedRatio * 100)}%，内容不足`);
    score -= 30;
  } else if (total > 0 && voicedRatio < 0.3) {
    reasons.push(`有声帧 ${Math.round(voicedRatio * 100)}%，偏少`);
    score -= 12;
  }

  if (!Number.isFinite(stats.medianF0) || stats.medianF0 <= 0) {
    reasons.push('未能稳定检出基频');
    score -= 35;
  }

  const level: QualityLevel = score <= 55 ? 'bad' : score < 80 ? 'warn' : 'ok';
  return { level, score: Math.max(0, score), reasons };
}

/** 质量等级的简短中文标签，供工具结果使用 */
export function qualityLabel(level: QualityLevel): string {
  return level === 'ok' ? '良好' : level === 'warn' ? '偏低' : '低';
}
