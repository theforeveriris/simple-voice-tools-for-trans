/**
 * 临床报告导出（HTML → 浏览器打印为 PDF）
 * 面向言语治疗师（SLP）等专业人士的静态报告：
 * 页眉（应用署名 + 记录元信息）→ 统计表（全部指标）→ 音高/共振峰/能量
 * 曲线（内嵌 SVG，打印保真）→ 嗓音质量组 + 参考区间 → 免责声明。
 * 无 JS、无外部引用；浏览器「打印 → 另存为 PDF」即得规范 A4 版式。
 * 与交互式 HTML 报告（interactiveHtml.ts）互补：那份给人看和玩，这份给档案和医生。
 */

import { downloadBlob } from '@/lib/file';
import { t, localeTag } from '@/i18n';
import type { AnalysisRecord } from '@/types';

/** 统计行：[标签, 值]（导出端完成格式化，SVG/HTML 内零逻辑） */
function statRows(record: AnalysisRecord): [string, string][] {
  const s = record.stats;
  const n1 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : v.toFixed(1));
  const pct = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `${Math.round(v)}%`);
  const rows: [string, string][] = [
    [t('analysis.rowDuration'), fmtClock(s.durationSec)],
    [t('analysis.rowAvgF0'), `${n1(s.avgF0)} Hz`],
    [t('analysis.rowMedianF0'), `${n1(s.medianF0)} Hz`],
    [t('analysis.rowMinMaxF0'), `${n1(s.minF0)} / ${n1(s.maxF0)} Hz`],
    [t('analysis.rowP10P90'), `${n1(s.p10F0)} / ${n1(s.p90F0)} Hz`],
    [t('analysis.rowStdF0'), `${s.stdF0.toFixed(2)} Hz`],
    [t('analysis.rowMalePct'), pct(s.malePct)],
    [t('analysis.rowFemalePct'), pct(s.femalePct)],
    [t('analysis.rowTransPct'), pct(s.transitionPct)],
    [t('analysis.rowAvgF1'), s.avgF1 != null ? `${Math.round(s.avgF1)} Hz` : '—'],
    [t('analysis.rowF1Range'), s.f1Range ? `${Math.round(s.f1Range[0])} / ${Math.round(s.f1Range[1])} Hz` : '—'],
    [t('analysis.rowAvgF2'), s.avgF2 != null ? `${Math.round(s.avgF2)} Hz` : '—'],
    [t('analysis.rowF2Range'), s.f2Range ? `${Math.round(s.f2Range[0])} / ${Math.round(s.f2Range[1])} Hz` : '—'],
    // 共鸣感知指标（旧记录无字段时不显示该行）
    ...(s.f2f1GapHz != null ? ([[t('analysis.rowF2f1Gap'), `${Math.round(s.f2f1GapHz)} Hz`]] as [string, string][]) : []),
    ...(s.spectralTiltDbOct != null ? ([[t('analysis.rowSpectralTilt'), `${s.spectralTiltDbOct.toFixed(1)} dB/oct`]] as [string, string][]) : []),
    [t('analysis.rowVoicedPct'), pct(s.totalSamples > 0 ? (s.voicedSamples / s.totalSamples) * 100 : 0)],
    [t('analysis.rowAvgDb'), `${n1(s.avgDb)} dB`],
    [t('analysis.rowPeakDb'), `${n1(s.peakDb)} dB`],
    [t('analysis.rowJitter'), s.jitterPct != null ? `${s.jitterPct.toFixed(2)}%` : '—'],
    [t('analysis.rowShimmer'), s.shimmerPct != null ? `${s.shimmerPct.toFixed(2)}%` : '—'],
    [t('analysis.rowHnr'), s.hnrDb != null ? `${s.hnrDb.toFixed(1)} dB` : '—'],
    [t('analysis.rowCpps'), s.cppsDb != null ? `${s.cppsDb.toFixed(1)} dB` : '—'],
  ];
  if (s.inTargetPct != null) rows.push([t('analysis.rowTargetPct'), pct(s.inTargetPct)]);
  return rows;
}

function fmtClock(sec: number): string {
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 记录序列 → SVG polyline 点串（时间轴全宽，音高轴 60–520 Hz 对数刻度） */
function pitchPoints(record: AnalysisRecord, w: number, h: number, pitchAxis: [number, number]): string {
  const { series } = record;
  const tMax = Math.max(0.001, record.durationSec);
  const [fMin, fMax] = pitchAxis;
  const pts: string[] = [];
  for (let i = 0; i < series.t.length; i++) {
    const f = series.f0[i];
    if (f == null || !isFinite(f)) continue;
    const x = (series.t[i] / tMax) * w;
    const y = h - ((Math.min(fMax, Math.max(fMin, f)) - fMin) / (fMax - fMin)) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

/** 能量序列 → SVG polyline 点串（-90–0 dBFS） */
function energyPoints(record: AnalysisRecord, w: number, h: number): string {
  const { series } = record;
  const tMax = Math.max(0.001, record.durationSec);
  const pts: string[] = [];
  for (let i = 0; i < series.t.length; i++) {
    const db = series.rmsDb[i];
    if (!isFinite(db)) continue;
    const x = (series.t[i] / tMax) * w;
    const y = h - ((db + 90) / 90) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

/** 共振峰双线 → 两条 polyline（F1 / F2，0–3500 Hz） */
function formantPoints(record: AnalysisRecord, w: number, h: number): { f1: string; f2: string } {
  const { series } = record;
  const tMax = Math.max(0.001, record.durationSec);
  const yF = (f: number) => h - (Math.min(3500, Math.max(0, f)) / 3500) * h;
  const p1: string[] = [];
  const p2: string[] = [];
  for (let i = 0; i < series.t.length; i++) {
    const x = (series.t[i] / tMax) * w;
    const f1 = series.f1[i];
    const f2 = series.f2[i];
    if (f1 != null && isFinite(f1)) p1.push(`${x.toFixed(1)},${yF(f1).toFixed(1)}`);
    if (f2 != null && isFinite(f2)) p2.push(`${x.toFixed(1)},${yF(f2).toFixed(1)}`);
  }
  return { f1: p1.join(' '), f2: p2.join(' ') };
}

/** 导出时的主题强调色（打印黑白也清晰；彩色屏上增强辨识） */
function accentColors(): { accent: string; accent2: string } {
  if (typeof document === 'undefined') return { accent: '#5B5BD6', accent2: '#8B5BD6' };
  const s = getComputedStyle(document.documentElement);
  return {
    accent: s.getPropertyValue('--c-accent').trim() || '#5B5BD6',
    accent2: s.getPropertyValue('--c-accent2').trim() || '#8B5BD6',
  };
}

/** 组装临床报告 HTML（静态，打印即 PDF） */
export function buildClinicalReportHtml(record: AnalysisRecord): string {
  const s = record.stats;
  const { accent, accent2 } = accentColors();
  const dateStr = new Date(record.createdAt).toLocaleString(localeTag());
  const modeLabel = t(`mode.${record.mode ?? 'reading'}`);
  const rows = statRows(record);
  const chartW = 720;
  const chartH = 150;
  const pitchAxis: [number, number] = [60, 520];
  const pitch = pitchPoints(record, chartW, chartH, pitchAxis);
  const energy = energyPoints(record, chartW, chartH);
  const formants = formantPoints(record, chartW, chartH);

  const tableRows = rows
    .map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`)
    .join('\n');

  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const noteHtml = record.note ? `<p class="note">${t('analysis.noteAria')}: ${esc(record.note)}</p>` : '';

  return `<!DOCTYPE html>
<html lang="${localeTag()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simple Voice Tool for Trans — ${t('report.clinicalTitle')} — ${dateStr}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 12px/1.5 system-ui, sans-serif; color: #1c1a22; margin: 0 auto; max-width: 780px; padding: 24px; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid ${accent}; padding-bottom: 8px; }
  header .brand { font-weight: 600; font-size: 14px; }
  header .date { color: #6e6a78; }
  h1 { font-size: 18px; margin: 16px 0 4px; }
  h2 { font-size: 13px; margin: 20px 0 8px; color: ${accent}; }
  .meta { color: #6e6a78; margin: 0 0 12px; }
  .note { background: #f5f3ef; border-radius: 8px; padding: 8px 10px; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #eee; font-weight: 400; }
  th { color: #6e6a78; width: 55%; }
  td { text-align: right; font-variant-numeric: tabular-nums; }
  .charts { display: grid; gap: 14px; margin-top: 8px; }
  .chart svg { width: 100%; height: auto; display: block; background: #fafafa; border: 1px solid #e5e3ec; border-radius: 8px; }
  .chart .cap { font-size: 10px; color: #6e6a78; margin: 2px 2px 0; }
  .disclaimer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e5e3ec; font-size: 10px; color: #6e6a78; }
  @media print {
    body { padding: 0; }
    .chart svg { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
  @page { size: A4; margin: 14mm; }
</style>
</head>
<body>
<header>
  <span class="brand">Simple Voice Tool for Trans</span>
  <span class="date">${t('report.clinicalTitle')} · ${dateStr}</span>
</header>
<h1>${t('report.clinicalTitle')}</h1>
<p class="meta">${t('analysis.rowDuration')}: ${fmtClock(record.durationSec)} · ${t('history.trendModeLabel')}: ${modeLabel} · ${t('analysis.rowFrames')}: ${s.totalSamples} (${s.sampleHz.toFixed(0)} Hz)</p>
${noteHtml}

<h2>${t('report.sectionStats')}</h2>
<table>
${tableRows}
</table>

<h2>${t('report.sectionCurves')}</h2>
<div class="charts">
  <div class="chart">
    <svg viewBox="0 0 ${chartW} ${chartH}" role="img" aria-label="${t('analysis.titlePitch')}">
      <polyline fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pitch}"/>
    </svg>
    <p class="cap">${t('analysis.titlePitch')} (${pitchAxis[0]}–${pitchAxis[1]} Hz)</p>
  </div>
  <div class="chart">
    <svg viewBox="0 0 ${chartW} ${chartH}" role="img" aria-label="${t('analysis.titleFormant')}">
      <polyline fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${formants.f1}"/>
      <polyline fill="none" stroke="${accent2}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${formants.f2}"/>
    </svg>
    <p class="cap">${t('analysis.titleFormant')} (F1 / F2, 0–3500 Hz)</p>
  </div>
  <div class="chart">
    <svg viewBox="0 0 ${chartW} ${chartH}" role="img" aria-label="${t('analysis.titleEnergy')}">
      <polyline fill="none" stroke="${accent}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${energy}"/>
    </svg>
    <p class="cap">${t('analysis.titleEnergy')} (−90 – 0 dBFS)</p>
  </div>
</div>

<p class="disclaimer">${t('report.disclaimer')}</p>
</body>
</html>`;
}

/** 生成并下载临床报告 HTML（浏览器打开后 Ctrl/Cmd+P → 另存为 PDF） */
export function exportClinicalReport(record: AnalysisRecord): void {
  const html = buildClinicalReportHtml(record);
  downloadBlob(
    `clinical-report-${record.id.slice(0, 8)}.html`,
    new Blob([html], { type: 'text/html;charset=utf-8' }),
  );
}
