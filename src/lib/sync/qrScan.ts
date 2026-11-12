/**
 * 扫码能力探测（局域网同步用）
 * 只要有摄像头就能在网页内扫码：
 * - 有 BarcodeDetector（Android Chrome / ChromeOS）时用原生识别
 * - 其余浏览器（桌面 Chrome / Firefox / Safari）用 jsQR 逐帧解码
 * 非安全上下文（http:// 局域网 IP）下浏览器不暴露 mediaDevices，扫码按钮自然隐藏，
 * 仍可退回复制粘贴信令文本。
 */
export function canScanQr(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}
