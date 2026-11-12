/**
 * 手动锁定：先结束当前录音，再上锁，避免录音状态跨锁屏悬挂。
 */

import { useStore } from '@/store/useStore';
import { lockNow } from './state';

export async function lockNowSafely(): Promise<void> {
  const { isRecording, stopRecording } = useStore.getState();
  if (isRecording) {
    try {
      await stopRecording();
    } catch {
      /* 录音失败也不阻止上锁 */
    }
  }
  lockNow();
}
