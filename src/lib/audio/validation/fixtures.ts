/**
 * 参数验证 · WAV 读取（验证测试专用）
 * 只支持本目录 synth_fixtures.py 生成的格式：RIFF / 16bit PCM / 单声道。
 * 验证缓存音频不入仓（见 .gitignore），脚本与预期值入仓。
 */

const text = (buf: Uint8Array, off: number, len: number): string =>
  String.fromCharCode(...buf.subarray(off, off + len));

/** 16bit PCM mono WAV → Float32 [-1, 1]（管线口径） */
export function readWavMono16(path: string): { pcm: Float32Array; sampleRate: number } {
  // Node 环境读文件（vitest node 模式）
  const fs = require('node:fs') as typeof import('node:fs');
  const buf = fs.readFileSync(path);
  const u8 = new Uint8Array(buf);
  if (text(u8, 0, 4) !== 'RIFF' || text(u8, 8, 4) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE file: ${path}`);
  }
  let off = 12;
  let sampleRate = 0;
  let bits = 0;
  let channels = 1;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= u8.length) {
    const id = text(u8, off, 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(off + 8);
      sampleRate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = Math.min(size, u8.length - dataOff);
    }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0 || bits !== 16) throw new Error(`unsupported WAV (bits=${bits}): ${path}`);
  const n = Math.floor(dataLen / 2 / channels);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 多声道取首声道（fixture 均为单声道，此处防御）
    let acc = 0;
    for (let c = 0; c < channels; c++) acc += buf.readInt16LE(dataOff + (i * channels + c) * 2);
    pcm[i] = acc / channels / 32768;
  }
  return { pcm, sampleRate };
}
