import React, { useEffect, useMemo, useRef, useState } from 'react';
import PickerSheet from './PickerSheet';
import WheelColumn from './WheelColumn';

// 1930-2100：生日会用到更早的年份，日历跳转也不会超出
const YEARS = Array.from({ length: 171 }, (_, i) => 1930 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);    // 1-12

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

type Props = {
  visible: boolean;
  year: number;
  month: number; // 0-11
  day: number;
  onClose: () => void;
  onConfirm: (y: number, m: number, d: number) => void;
};

/** 年月日三列滚轮：外壳与交互全部复用 PickerSheet / WheelColumn，与时间选择器完全一致 */
export default function DatePickerSheet({
  visible, year, month, day, onClose, onConfirm,
}: Props) {
  const [y, setY] = useState(year);
  const [m, setM] = useState(month + 1); // 滚轮用的是 1-12
  const [d, setD] = useState(day);

  // 三列的实时值：滚轮滚动时即时写入，"确定"以它为准
  const yLive = useRef(year);
  const mLive = useRef(month + 1);
  const dLive = useRef(day);

  /**
   * 打开的那一帧就把三列同步成当前值 —— 在渲染期同步而不是等 effect。
   * 这样滚轮第一次挂载就停在正确位置，不用"先按旧值挂载、再整批重挂一次"，
   * 开页时的建视图成本直接减半。
   */
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setY(year);
      setM(month + 1);
      setD(day);
      yLive.current = year;
      mLive.current = month + 1;
      dLive.current = day;
    }
  }

  const maxDay = daysInMonth(y, m - 1);
  // 缓存数组引用，避免每次父组件重渲染都把日列的滚动项整批重建
  const DAYS = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);

  // 换月后天数变少，自动收敛到该月最后一天
  useEffect(() => {
    if (d > maxDay) setD(maxDay);
  }, [maxDay]);

  return (
    <PickerSheet
      visible={visible}
      title="选择日期"
      onClose={onClose}
      onConfirm={() => {
        // 用滚轮的实时值，即使还在惯性滚动中也能选到框里显示的那一天
        const yy = yLive.current;
        const mm = mLive.current - 1;
        const dd = Math.min(dLive.current, daysInMonth(yy, mm));
        onConfirm(yy, mm, dd);
      }}
    >
      <WheelColumn
        key="y" data={YEARS} value={y} onChange={setY}
        suffix=" 年" flex={1.5} liveRef={yLive}
      />
      <WheelColumn
        key="m" data={MONTHS} value={m} onChange={setM}
        suffix=" 月" flex={1} liveRef={mLive}
      />
      <WheelColumn
        key={`d-${maxDay}`} data={DAYS} value={d} onChange={setD}
        suffix=" 日" flex={1} liveRef={dLive}
      />
    </PickerSheet>
  );
}
