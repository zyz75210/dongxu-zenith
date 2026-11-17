import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, BackHandler, Easing, Pressable, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { C } from '../theme';
import { ITEM_H, VISIBLE, WHEEL_H } from './WheelColumn';

// 收起时向下偏移的距离，略大于面板高度即可完全移出屏幕
const HIDDEN_Y = 460;
// 取消/确定的点击热区，避免小字不好点
const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  /** 滚轮列，几列由调用方决定（日期三列 / 时间两列） */
  children: React.ReactNode;
};

/**
 * 底部滚轮面板外壳：遮罩 + 上滑动画 + 取消/确定 + 中央选中框。
 * 日期选择器与时间选择器都用它，保证两处交互和观感完全一致。
 */
export default function PickerSheet({
  visible, title, onClose, onConfirm, children,
}: Props) {
  /**
   * 渲染期就挂载（而不是等 effect）：否则动画先起来、滚轮列后创建，
   * 建视图那一下正好压在面板上滑的过程中，看起来就是"点开年份卡一下"。
   */
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const anim = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(false);
  mountedRef.current = mounted;

  useEffect(() => {
    if (visible) {
      Animated.timing(anim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mountedRef.current) {
      Animated.timing(anim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible]);

  // Android 返回键关闭面板
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [HIDDEN_Y, 0],
  });

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* 遮罩 */}
      <Animated.View style={[styles.mask, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* 底部面板 */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.sheetHeader}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7} hitSlop={HIT}>
            <Text style={styles.cancel}>取消</Text>
          </TouchableOpacity>
          <Text style={styles.sheetTitle}>{title}</Text>
          <TouchableOpacity onPress={onConfirm} activeOpacity={0.7} hitSlop={HIT}>
            <Text style={styles.confirm}>确定</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.wheels}>
          {/* 中间选中高亮条，放在滚轮下层 */}
          <View style={styles.highlight} pointerEvents="none" />
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

const FULL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  // zIndex 抬高：二级页面滑入时带 elevation，避免滚轮被压在下面
  overlay: { ...FULL, justifyContent: 'flex-end', zIndex: 200, elevation: 24 },
  mask: {
    ...FULL,
    backgroundColor: 'rgba(16,20,30,0.35)',
  },

  sheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingTop: 12, paddingBottom: 26,
    // Android 上没有阴影时，用一条细边把面板和背景分开
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 8, height: 40,
  },
  sheetTitle: { fontSize: 14, fontWeight: '600', color: C.text },
  cancel: { fontSize: 13, color: C.gray },
  confirm: { fontSize: 13, color: C.primary, fontWeight: '600' },

  wheels: {
    position: 'relative',
    height: WHEEL_H,
    flexDirection: 'row',
    paddingHorizontal: 12,
  },
  highlight: {
    position: 'absolute',
    left: 12, right: 12,
    top: ITEM_H * ((VISIBLE - 1) / 2),
    height: ITEM_H,
    backgroundColor: C.soft,
    borderRadius: 12,
    borderWidth: 1, borderColor: C.line,
  },
});
