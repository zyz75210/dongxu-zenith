import React, { useMemo, useRef, useState } from 'react';
import PickerSheet from './PickerSheet';
import WheelColumn from './WheelColumn';

/**
 * 时长选择（时 / 分两列）—— 训练页「目标时长」用。
 *
 * 外壳、滚轮、手感全部复用 PickerSheet / WheelColumn，所以和日历那边选年月日、
 * 日程里选开始时间是同一套观感和交互，不另起一种编辑方式。
 *
 * 只负责"把滚轮上的时、分换算成总分钟"；上下限由调用方决定
 * （训练页是 5 分钟 ~ 12 小时），这里不做静默收敛 —— 免得滚轮停在一个数、结果却是另一个。
 */

/** 训练时长上限：12 小时。时列 0 ~ 12，分列 0 ~ 59 */
export const MAX_HOURS = 12;
/** 上限的总分钟数，调用方直接用这个，不要自己写 720 */
export const MAX_MINUTES = MAX_HOURS * 60;
/** 下限 5 分钟：再短不如直接 GO */
export const MIN_MINUTES = 5;

const HOURS = Array.from({ length: MAX_HOURS + 1 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

const fmtHour = (v: number) => `${v} 时`;
const fmtMinute = (v: number) => `${v} 分`;

type Props = {
  visible: boolean;
  /** 当前总分钟数 */
  minutes: number;
  onClose: () => void;
  /** 确定时回传总分钟（未收敛，交给调用方按上下限处理） */
  onConfirm: (total: number) => void;
};

export default function DurationPickerSheet({
  visible, minutes, onClose, onConfirm,
}: Props) {
  const h0 = Math.min(MAX_HOURS, Math.floor(minutes / 60));
  const m0 = Math.min(59, minutes % 60);

  const [h, setH] = useState(h0);
  const [mi, setMi] = useState(m0);

  const hLive = useRef(h0);
  const mLive = useRef(m0);

  // 打开那一帧同步两列：首帧挂载就停在正确位置，避免挂载后整列重挂一次
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setH(h0);
      setMi(m0);
      hLive.current = h0;
      mLive.current = m0;
    }
  }

  const hourData = useMemo(() => HOURS, []);
  const minuteData = useMemo(() => MINUTES, []);

  return (
    <PickerSheet
      visible={visible}
      title="目标时长"
      onClose={onClose}
      onConfirm={() => {
        // 读实时值：惯性滚动中点「确定」也不会拿到停稳前的旧数
        onConfirm(hLive.current * 60 + mLive.current);
      }}
    >
      <WheelColumn
        key="h" data={hourData} value={h} onChange={setH}
        format={fmtHour} flex={1} liveRef={hLive}
      />
      <WheelColumn
        key="mi" data={minuteData} value={mi} onChange={setMi}
        format={fmtMinute} flex={1} liveRef={mLive}
      />
    </PickerSheet>
  );
}
