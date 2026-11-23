import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C } from '../theme';

/**
 * 主页日程右侧的状态胶囊：
 * - default 未完成：浅灰胶囊 + 空心圆 + 灰色类型名（空心圆暗示「点一下能勾上」）
 * - done    已完成：浅蓝胶囊 + 勾 + 类型名
 * - overdue 已超时：浅红胶囊 + 叉 + 类型名
 * - rest    休息日：浅灰蓝胶囊 + 无图标（休息不需要勾选，给空心圆反而在骗人去点）
 */
export type PillState = 'default' | 'done' | 'overdue' | 'rest';

const CHECK_PATH = 'M2.8 6.2 L5.1 8.6 L9.4 3.2';
const CROSS_PATH = 'M3.4 3.4 L8.6 8.6 M8.6 3.4 L3.4 8.6';

// default（未完成）态给一个「空心圆」视觉：让用户一眼看懂「这是一个待勾选的完成框，点一下就完成」
const CIRCLE_PATH = 'M6 6 m -4 0 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0';

type PillIcon = 'check' | 'cross' | 'circle' | null;

const LOOKS: Record<PillState, { bg: string; fg: string; icon: PillIcon }> = {
  default: { bg: C.soft, fg: C.gray, icon: 'circle' },
  done: { bg: '#E9F0FE', fg: C.primary, icon: 'check' },
  overdue: { bg: '#FCEBEA', fg: C.danger, icon: 'cross' },
  rest: { bg: '#EFF3F5', fg: C.typeDot.rest, icon: null },
};

type Props = {
  /** 胶囊里显示的文字：日程类型名 */
  label: string;
  state: PillState;
  /** 点一下切换完成状态；休息日不传（它不需要勾选） */
  onPress?: () => void;
};

export default function ScheduleStatusPill({ label, state, onPress }: Props) {
  const look = LOOKS[state];
  const active = state !== 'default';
  const scale = useRef(new Animated.Value(1)).current;
  const prevState = useRef(state);

  // 状态一变就"弹"一下：放大的过程本身就是反馈
  useEffect(() => {
    if (prevState.current === state) return;
    prevState.current = state;
    Animated.sequence([
      Animated.spring(scale, {
        toValue: 1.16, useNativeDriver: true, speed: 40, bounciness: 0,
      }),
      Animated.spring(scale, {
        toValue: 1, useNativeDriver: true, speed: 20, bounciness: 12,
      }),
    ]).start();
  }, [state, scale]);

  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.pill,
            active && styles.pillActive,
            { backgroundColor: look.bg, transform: [{ scale }] },
            pressed && styles.pillPressed,
          ]}
        >
          {look.icon && (
            <Svg width={11} height={11} viewBox="0 0 12 12" style={styles.icon}>
              {look.icon === 'circle' ? (
                <Path
                  d={CIRCLE_PATH}
                  fill="none"
                  stroke={look.fg}
                  strokeWidth={1.6}
                />
              ) : (
                <Path
                  d={look.icon === 'check' ? CHECK_PATH : CROSS_PATH}
                  fill="none"
                  stroke={look.fg}
                  strokeWidth={1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </Svg>
          )}
          <Text style={[styles.text, active && styles.textActive, { color: look.fg }]}>
            {label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center',
    marginLeft: 8,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: 999,
  },
  // 有状态时稍微长大一点，和详情页的按钮呼应
  pillActive: { paddingHorizontal: 10, paddingVertical: 5 },
  pillPressed: { opacity: 0.7 },
  icon: { marginRight: 4 },
  text: { fontSize: 11 },
  // 状态升级只靠底色、图标和字重区分，字号固定 11：
  // 11 → 11.5 差 4.5%，肉眼读不出，却可能在密度换算下被取整成 11 或 12，
  // 表现为勾选那一瞬文字轻跳一下。胶囊"长大一点"的感觉交给 padding（pillActive）。
  textActive: { fontWeight: '500' },
});
