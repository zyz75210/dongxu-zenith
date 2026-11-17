import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { C } from '../theme';

/**
 * 完成状态：
 * - pending 未完成：蓝色描边空心圆 + 手背（四指并拢、腕朝下）
 * - done    已完成：蓝色实心圆 + 白色大拇指
 * - overdue 已超时（隔天仍未完成）：红色实心圆 + 白色感叹号
 */
export type CompletionState = 'pending' | 'done' | 'overdue';

/**
 * 手背图标：四条圆头笔画拼成并拢的手指，外侧一笔连成手掌与腕。
 * 全部是直线配 1.5 半径的圆角、round 线帽，没有任何尖角。
 */
const HAND_PATHS = [
  'M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5',
  'M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5',
  'M14 5.5a1.5 1.5 0 0 1 3 0v6.5',
  'M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2h0.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47',
];

/** 圆头感叹号（上粗下点，两端都是圆角） */
const ALERT_PATH =
  'M144,200a16,16,0,1,1-16-16A16,16,0,0,1,144,200Zm-16-40a8,8,0,0,0,8-8V48a8,8,0,0,0-16,0V152A8,8,0,0,0,128,160Z';

function HandIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {HAND_PATHS.map((d, i) => (
          <Path key={i} d={d} />
        ))}
      </G>
    </Svg>
  );
}

function AlertIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256">
      <Path d={ALERT_PATH} fill={color} />
    </Svg>
  );
}

/** 三种状态的配色与图标集中在这里，改样式只动这张表 */
const LOOKS: Record<CompletionState, { fill: string; border: string; fg: string }> = {
  pending: { fill: C.white, border: C.primary, fg: C.primary },
  done: { fill: C.primary, border: C.primary, fg: C.white },
  overdue: { fill: C.typeDot.important, border: C.typeDot.important, fg: C.white },
};

type Props = {
  state: CompletionState;
  onPress: () => void;
  /** 圆的直径，默认 46 */
  size?: number;
};

export default function CompletionButton({ state, onPress, size = 46 }: Props) {
  const look = LOOKS[state];
  const scale = useRef(new Animated.Value(1)).current;
  // 图标比圆小一圈：46 的圆里放 26 的图标
  const iconSize = Math.round(size * 0.56);

  // 按下缩小、松手回弹：圆点自己的按压反馈
  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.88, useNativeDriver: true, speed: 40, bounciness: 0,
    }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1, useNativeDriver: true, speed: 22, bounciness: 14,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={
        state === 'done'
          ? '已完成，点击取消完成'
          : state === 'overdue'
            ? '已超时，点击补记完成'
            : '未完成，点击标记完成'
      }
    >
      <Animated.View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: look.fill,
            borderColor: look.border,
            transform: [{ scale }],
          },
        ]}
      >
        {state === 'pending' && <HandIcon size={iconSize} color={look.fg} />}
        {state === 'done' && (
          <MaterialCommunityIcons name="thumb-up" size={iconSize} color={look.fg} />
        )}
        {state === 'overdue' && <AlertIcon size={iconSize} color={look.fg} />}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
