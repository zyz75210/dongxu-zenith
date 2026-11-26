import React, { memo } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * 连续打卡的火焰图标（自绘 + 参数化）。
 *
 * 为什么不用 Ionicons：它只有 flame / flame-outline 两种，做不出「越练越旺」。
 * 为什么不手工一档一档画：每 10 天一个变化，一年就是 36 档，画不出 36 个能辨清的形态。
 *
 * 所以这里用「一个火焰 + 可叠加的装饰层」，装饰由天数算出来：
 *   每满 10 天升一阶 → 颜色更热、火星 +1、火焰略大；到第 3 阶起加光晕，第 1 阶起加内焰。
 * 同一个火焰骨架，越往上叠得越满，这就是「越来越华丽」——而且永远不会有画不出来的档位。
 *
 * 阈值每 10 天，最高 10 阶（100 天封顶），之后只涨天数不再升阶，避免 300 天做出一个火球。
 */

/** 主火焰轮廓 */
const FLAME_PATH =
  'M12 2.6c.9 3.4 2.9 4.7 4.7 6.7 1.6 1.8 2.4 3.8 2.4 5.8 0 4.2-3.2 6.7-7.1 6.7'
  + 's-7.1-2.5-7.1-6.7c0-2 .8-3.8 1.9-5.2.8 1.2 1.7 1.8 2.6 2.1C8.9 8.3 9.9 5 12 2.6z';

/** 内焰：叠在主火焰里的浅色小焰，形成「烧在中间」的双色感 */
const INNER_PATH =
  'M12 9.4c.5 1.7 1.5 2.3 2.3 3.4.8.9 1.2 1.9 1.2 2.9 0 2.1-1.6 3.3-3.5 3.3'
  + 's-3.5-1.2-3.5-3.3c0-1 .4-1.9 1-2.6.4.6.8.9 1.3 1-.3-1.6.1-3.2 1.2-4.7z';

/** 每满多少天升一阶 */
export const STREAK_STEP_DAYS = 10;
/** 最高阶数：100 天之后只涨天数，不再加装饰，否则会变成一个火球 */
export const STREAK_MAX_TIER = 10;

/**
 * 11 阶色阶（0–10）：从「刚点着的暖橙」烧到「烧透的深红」。
 * 相邻两阶差得很小，用户不会觉得每 10 天都在变色；
 * 但每 10 天回头比一次，就能看出确实更热了。
 */
const COLORS = [
  '#FFB067', '#FF9A45', '#FF8A33', '#FF7A29', '#F86A22',
  '#F0542A', '#E8452C', '#D93A1F', '#C82E14', '#BC2A10', '#B8270E',
];

/** 火星位置：最多 5 颗，散布在火焰外圈（0–5 阶逐步点亮） */
const SPARKS: { x: number; y: number; r: number }[] = [
  { x: 19.7, y: 5.2, r: 1.25 },
  { x: 4.2, y: 8.6, r: 1.05 },
  { x: 20, y: 13.4, r: 0.9 },
  { x: 5, y: 16.2, r: 0.85 },
  { x: 15.4, y: 2.2, r: 0.75 },
];

/**
 * 每阶那句副文案：每 10 天换一次，和火焰同步「升一级」。
 *
 * 写法约定（2026-11 定）：说人话，不写意象。
 * 早先的「火苗点着了」「一百在望」这类，读起来像诗，但用户扫一眼不知道该干什么。
 * 现在每句只做两件事之一：报一个具体进展，或者说一句像人会说的话。
 */
const SUBS = [
  '先动起来，别急着加量',
  '十天，坚持下来了',
  '二十天，不靠硬撑了',
  '一个月，练成习惯了',
  '四十天，习惯替你撑着',
  '五十天，过半了',
  '两个月，成了日常',
  '七十天，稳住了',
  '八十天，一百天不远',
  '九十天，还剩十天',
  '一百天，这事儿成了',
];

const GRAY = '#C4C9D2';

/** 连续天数落在第几阶（0 起，封顶 STREAK_MAX_TIER） */
export function streakTier(streak: number): number {
  return Math.min(Math.floor(streak / STREAK_STEP_DAYS), STREAK_MAX_TIER);
}

/** 该阶对应的副文案（非 0 天时使用） */
export function streakSub(streak: number): string {
  return SUBS[streakTier(streak)];
}

/** 该阶对应的火焰色，供别的页面（比如「我的」的连续天数）取同一个色 */
export function streakColor(streak: number): string {
  return COLORS[streakTier(streak)];
}

type Props = {
  /** 连续打卡天数 */
  streak: number;
  /** 今天是不是已经算完成（训练勾了 / 今天本来就是休息日） */
  doneToday: boolean;
  size?: number;
};

/**
 * 火焰 = 轮廓（今天做到没有） × 阶位（连续多久）。
 * - 0 天：灰色线性，表示还没开始
 * - 有记录但今天没完成：阶位色线性，亮着但没烧起来
 * - 今天完成了：阶位色实心 + 该阶的装饰（内焰 / 火星 / 光晕）
 */
function StreakFlame({ streak, doneToday, size = 17 }: Props) {
  const tier = streakTier(streak);
  const started = streak > 0;
  const solid = started && doneToday;

  const color = started ? COLORS[tier] : GRAY;
  // 升阶时火焰一起变大一点：形状变不了太多，但「更大」是 17px 下最好认的变化
  const px = size + tier * 0.4;

  const sparkCount = Math.min(tier, SPARKS.length);
  const showInner = tier >= 1;
  const showHalo = tier >= 3;
  // 光晕随阶位变大变浓，是「华丽」最主要的观感来源
  const haloR = 8 + tier * 0.45;
  const haloOpacity = 0.08 + tier * 0.012;

  return (
    <Svg width={px} height={px} viewBox="0 0 24 24">
      {solid && showHalo && (
        <Circle cx={12} cy={11.8} r={haloR} fill={color} fillOpacity={haloOpacity} />
      )}

      <Path
        d={FLAME_PATH}
        fill={solid ? color : 'none'}
        stroke={color}
        strokeWidth={solid ? 0 : 1.7}
        strokeLinejoin="round"
      />

      {solid && showInner && <Path d={INNER_PATH} fill="#FFF3E6" fillOpacity={0.9} />}

      {solid &&
        SPARKS.slice(0, sparkCount).map((s) => (
          <Circle
            key={`${s.x}-${s.y}`}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill={color}
            fillOpacity={0.45}
          />
        ))}
    </Svg>
  );
}

export default memo(StreakFlame);
