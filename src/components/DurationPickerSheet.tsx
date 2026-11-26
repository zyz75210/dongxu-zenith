import React, { useMemo, useRef, useState } from 'react';
import PickerSheet from './PickerSheet';
import WheelColumn from './WheelColumn';

/**
 * 时长选择（分 / 秒两列）—— 跳绳的「定时跳」时长用。
 *
 * 外壳、滚轮、手感全部复用 PickerSheet / WheelColumn，所以和日历那边选年月日、
 * 日程里选开始时间是同一套观感和交互，不另起一种编辑方式。
 *
 * 为什么是「分 + 秒」而不是「时 + 分」：
 *   跳绳一组通常是几十秒到几分钟，用"时"列去选 1 分钟要滚一整圈，
 *   而且一不小心就滑到 3 小时，完全不合运动习惯。
 *   60 分钟封顶，正好覆盖「间歇 30 秒」到「耐力 60 分钟」整个区间。
 *
 * 只负责把滚轮上的两列换算成总秒数；上下限由调用方决定，
 * 这里不做静默收敛 —— 免得滚轮停在一个数、结果却是另一个。
 */

/** 上限：60 分钟（3600 秒）。分列 0 ~ 60 */
export const MAX_SECONDS = 60 * 60;
/** 下限：1 秒。再小没有意义 */
export const MIN_SECONDS = 1;

const MINUTES = Array.from({ length: 61 }, (_, i) => i);
const SECONDS = Array.from({ length: 60 }, (_, i) => i);

const fmtMinute = (v: number) => `${v} 分`;
const fmtSecond = (v: number) => `${v} 秒`;

type Props = {
  visible: boolean;
  /** 当前总秒数 */
  seconds: number;
  onClose: () => void;
  /** 确定时回传总秒数（未收敛，交给调用方按上下限处理） */
  onConfirm: (totalSeconds: number) => void;
};

export default function DurationPickerSheet({
  visible, seconds, onClose, onConfirm,
}: Props) {
  const m0 = Math.min(60, Math.floor(seconds / 60));
  const s0 = Math.min(59, Math.max(0, seconds % 60));

  const [mi, setMi] = useState(m0);
  const [se, setSe] = useState(s0);

  const mLive = useRef(m0);
  const sLive = useRef(s0);

  // 打开那一帧同步两列：首帧挂载就停在正确位置，避免挂载后整列重挂一次
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setMi(m0);
      setSe(s0);
      mLive.current = m0;
      sLive.current = s0;
    }
  }

  const minuteData = useMemo(() => MINUTES, []);
  const secondData = useMemo(() => SECONDS, []);

  return (
    <PickerSheet
      visible={visible}
      title="目标时长"
      onClose={onClose}
      onConfirm={() => {
        // 读实时值：惯性滚动中点「确定」也不会拿到停稳前的旧数
        onConfirm(mLive.current * 60 + sLive.current);
      }}
    >
      <WheelColumn
        key="mi" data={minuteData} value={mi} onChange={setMi}
        format={fmtMinute} flex={1} liveRef={mLive}
      />
      <WheelColumn
        key="se" data={secondData} value={se} onChange={setSe}
        format={fmtSecond} flex={1} liveRef={sLive}
      />
    </PickerSheet>
  );
}
