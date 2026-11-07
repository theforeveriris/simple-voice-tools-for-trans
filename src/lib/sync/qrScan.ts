/**
 * 扫码能力探测（局域网同步用）
 * BarcodeDetector 目前只有 Android Chrome / ChromeOS 等少数浏览器提供；
 * 桌面 Firefox / Safari 不显示扫码入口，退回复制粘贴信令文本。
 */
export function canScanQr(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && 'mediaDevices' in navigator;
}
