import React, { useMemo, useRef, useState } from 'react';
import PickerSheet from './PickerSheet';
import WheelColumn from './WheelColumn';

// 24 小时制：时 0-23、分 0-59，都补两位
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtHour = (v: number) => `${pad2(v)} 时`;
const fmtMinute = (v: number) => `${pad2(v)} 分`;

type Props = {
  visible: boolean;
  /** 面板标题：开始时间 / 结束时间 */
  title: string;
  hour: number;
  minute: number;
  onClose: () => void;
  onConfirm: (h: number, m: number) => void;
};

/** 时间选择：两列（时、分），外壳与手感全部复用 PickerSheet / WheelColumn */
export default function TimePickerSheet({
  visible, title, hour, minute, onClose, onConfirm,
}: Props) {
  const [h, setH] = useState(hour);
  const [mi, setMi] = useState(minute);

  const hLive = useRef(hour);
  const mLive = useRef(minute);

  // 打开那一帧同步两列：首帧挂载就停在正确位置，避免挂载后整列重挂一次
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setH(hour);
      setMi(minute);
      hLive.current = hour;
      mLive.current = minute;
    }
  }

  // 分钟列内容固定，缓存引用避免无谓重建
  const hourData = useMemo(() => HOURS, []);
  const minuteData = useMemo(() => MINUTES, []);

  return (
    <PickerSheet
      visible={visible}
      title={title}
      onClose={onClose}
      onConfirm={() => {
        // 同样读实时值，惯性滚动中点确定也不会拿到旧时间
        onConfirm(hLive.current, mLive.current);
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
