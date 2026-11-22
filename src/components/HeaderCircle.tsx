import React from 'react';
import { StyleProp, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';

/**
 * 页面右上角的圆形动作按钮（训练 / 星球 / 积累三页共用）
 *
 * 尺寸只在这里定义。之前三页各写各的（36 / 34 / 40），同一条顶部导航
 * 切过去就能看出图标一大一小。要调大小改 SIZE 一处即可，三页同步。
 *
 * 视觉规格统一成「训练页」那版：36 圆、浅灰底、深色图标、无边框。
 * 积累页原来用白底 + 描边 + 蓝图标，白底页面下那样的按钮会糊掉，一并统一。
 *
 * ⚠️ 这里只共用「长相」，不共用「行为」（用户 2026-11-23 定的规矩）：
 *   每个页面的按钮只负责本页自己的功能 / 编辑，暂时互不打通。
 *   - onPress 必须由页面自己写，不要提到 App 层做成一个多页复用的 handler；
 *   - 不许点 A 页的按钮去改 B 页的东西（例如积累页的编辑只能改积累页布局）；
 *   - 目的是避免以后一个按钮改出多页联动，编辑关系乱掉。
 *   需要多页共用的只有样式，加功能请在各页面里单独实现。
 */
const SIZE = 36;
const ICON = 18;

type Props = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void;
  /** 无障碍名称，例如「编辑」「更多」 */
  label?: string;
  /** 只用来补位（如 marginLeft:'auto'），不要在这里改尺寸 */
  style?: StyleProp<ViewStyle>;
};

export default function HeaderCircle({ icon, onPress, label, style }: Props) {
  return (
    <TouchableOpacity
      style={[styles.circle, style]}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={ICON} color={C.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2,
    backgroundColor: C.soft,
    alignItems: 'center', justifyContent: 'center',
  },
});
