import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * 滚轮过格触感：每滑过一个数字"咔"一下。
 *
 * - iOS：UISelectionFeedbackGenerator，就是系统选择器那一下。
 * - Android：Clock_Tick（时钟应用调时分时的系统触感），短促清脆、不吃马达权限，
 *   并且尊重系统"触感反馈"开关；个别机型该开关关闭时它不出声，退回直接振动马达的
 *   selectionAsync，保证一定有反馈。
 */

/** 最短间隔：手指飞快划过时把过密的震动合并，否则马达连击会变成一团"嗡" */
const MIN_GAP = 26;
let lastAt = 0;

function androidFallback() {
  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {
    // 设备不支持触感：静默降级，不影响滚动
  }
}

/** 滑过一个数字：清脆的一下 */
export function wheelTick() {
  const now = Date.now();
  if (now - lastAt < MIN_GAP) return;
  lastAt = now;

  if (Platform.OS === 'android') {
    try {
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(
        androidFallback,
      );
    } catch {
      androidFallback();
    }
    return;
  }

  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {
    // 静默降级
  }
}

/**
 * 勾选完成：一下明确的成功触感（力度比滚轮重一档）。
 * 只在「变成已完成」时调用（取消完成不震），避免噪音。
 * - Android：impactAsync(Medium)，比 Confirm 更沉更明显
 * - iOS：impactAsync(Medium)，比 notification Success 更实
 */
export function completeTick() {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  } catch {
    // 设备不支持触感：静默降级
  }
}
