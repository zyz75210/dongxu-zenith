import React, { memo } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * 连续打卡的火焰图标（自绘）。
 *
 * 为什么不用 Ionicons：它只有 flame / flame-outline 两种，做不出「越练越旺」的层次。
 * 这里用三个维度叠加表达档位，越往上层越稀有：
 *   轮廓（线性 / 实心） × 颜色（橙 → 红 → 深红） × 装饰（内焰 → 光晕 → 光点）
 *
 * 阈值故意做「稀疏递进」而不是每 10 天一跳：
 * 前 10 天靠意志最难，后 100 天靠习惯最容易，跨度越往后越大，后面的档位才值钱。
 */

/** 主火焰轮廓 */
const FLAME_PATH =
  'M12 2.6c.9 3.4 2.9 4.7 4.7 6.7 1.6 1.8 2.4 3.8 2.4 5.8 0 4.2-3.2 6.7-7.1 6.7'
  + 's-7.1-2.5-7.1-6.7c0-2 .8-3.8 1.9-5.2.8 1.2 1.7 1.8 2.6 2.1C8.9 8.3 9.9 5 12 2.6z';

/** 内焰：叠在主火焰里的浅色小焰，形成「烧在中间」的双色感 */
const INNER_PATH =
  'M12 9.4c.5 1.7 1.5 2.3 2.3 3.4.8.9 1.2 1.9 1.2 2.9 0 2.1-1.6 3.3-3.5 3.3'
  + 's-3.5-1.2-3.5-3.3c0-1 .4-1.9 1-2.6.4.6.8.9 1.3 1-.3-1.6.1-3.2 1.2-4.7z';

/** 档位阈值（升序）。改这里等于改「几档、什么坎」 */
export const STREAK_THRESHOLDS = [10, 30, 60, 100] as const;

type TierLook = {
  /** 该档的火焰颜色 */
  color: string;
  /** 是否叠内焰 */
  inner: boolean;
  /** 是否加外圈光晕 */
  halo: boolean;
  /** 外面撒几颗光点（0 / 2 / 3） */
  dots: number;
  /** 达到档位后，平时（非里程碑）那句副文案 */
  sub: string;
};

/** 五档外观，索引 = streakTier() 的返回值 */
export const STREAK_TIERS: TierLook[] = [
  // 1–9 天：刚点着，火苗还小
  { color: '#FF9A45', inner: false, halo: false, dots: 0, sub: '明天见' },
  // 10–29 天：第一次成势
  { color: '#FF7A29', inner: true, halo: false, dots: 0, sub: '十天下去了，习惯在长' },
  // 30–59 天：跨月，从坚持变成日常
  { color: '#F0442E', inner: true, halo: true, dots: 0, sub: '一个月，这已经是你的节奏' },
  // 60–99 天：两个月，已经超过绝大多数人
  { color: '#D93A1F', inner: true, halo: true, dots: 2, sub: '两个月，别人追不上了' },
  // 100 天以上
  { color: '#B8270E', inner: true, halo: true, dots: 3, sub: '一百天，这事儿拿下了' },
];

/** 刚好跨过阈值那一天说一句专属的，第二天回落到档位句 */
const MILESTONES: Record<number, string> = {
  10: '两位数了，别停在这',
  30: '整一个月，你把它做成了习惯',
  60: '两个月，这已经不是坚持了',
  100: '一百天。说出去没人信那种',
};

/** 连续天数落在第几档（0 起） */
export function streakTier(streak: number): number {
  let tier = 0;
  for (let i = 0; i < STREAK_THRESHOLDS.length; i += 1) {
    if (streak >= STREAK_THRESHOLDS[i]) tier = i + 1;
  }
  // 1–9 天也是 0 档；0 天由组件单独处理成灰色线性
  return tier;
}

/** 里程碑当天的专属句，不是那几天就返回 null */
export function streakMilestone(streak: number): string | null {
  return MILESTONES[streak] ?? null;
}

/** 平时那句副文案（非里程碑） */
export function streakSub(streak: number): string {
  return STREAK_TIERS[streakTier(streak)].sub;
}

const GRAY = '#C4C9D2';
const DOT_POS: { x: number; y: number; r: number }[] = [
  { x: 19.4, y: 5.8, r: 1.3 },
  { x: 4.4, y: 8.4, r: 0.9 },
  { x: 19.8, y: 13.6, r: 0.8 },
];

type Props = {
  /** 连续打卡天数 */
  streak: number;
  /** 今天是不是已经算完成（训练勾了 / 今天本来就是休息日） */
  doneToday: boolean;
  size?: number;
};

/**
 * 火焰 = 轮廓（今天做到没有） × 档位（连续多久）。
 * - 0 天：灰色线性，表示还没开始
 * - 有记录但今天没完成：档位色线性，亮着但没烧起来
 * - 今天完成了：档位色实心 + 该档的装饰
 */
function StreakFlame({ streak, doneToday, size = 17 }: Props) {
  const tier = streakTier(streak);
  const look = STREAK_TIERS[tier];
  const started = streak > 0;
  const solid = started && doneToday;
  const color = started ? look.color : GRAY;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* 光晕：垫在火焰后面的浅色圆，只为让它「远看更亮」，不参与形状识别 */}
      {solid && look.halo && (
        <Circle cx={12} cy={11.6} r={10.4} fill={color} fillOpacity={0.12} />
      )}

      <Path
        d={FLAME_PATH}
        fill={solid ? color : 'none'}
        stroke={color}
        strokeWidth={solid ? 0 : 1.7}
        strokeLinejoin="round"
      />

      {solid && look.inner && (
        <Path d={INNER_PATH} fill="#FFF3E6" fillOpacity={0.9} />
      )}

      {solid &&
        DOT_POS.slice(0, look.dots).map((d) => (
          <Circle key={`${d.x}-${d.y}`} cx={d.x} cy={d.y} r={d.r} fill={color} fillOpacity={0.45} />
        ))}
    </Svg>
  );
}

export default memo(StreakFlame);
