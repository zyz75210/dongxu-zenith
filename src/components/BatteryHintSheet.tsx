import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, BackHandler, Easing, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';

// 收起时向下偏移，略大于面板高度即可完全移出屏幕
const HIDDEN_Y = 420;

type Props = {
  visible: boolean;
  /** 机型品牌，写进文案里（"小米/华为这类机型…"），命中率比泛泛而谈高 */
  brand: string;
  onClose: () => void;
  /** 跳到系统里本 App 的设置页（省电策略 / 自启动都在那儿） */
  onOpenSettings: () => void;
};

/**
 * 省电策略引导。
 *
 * 为什么需要它：安卓的本地提醒本质是系统闹钟。小米/华为/OPPO 这类系统的省电策略
 * 会把后台闹钟"合并"甚至直接掐掉 —— 表现是「刚发完测试通知马上就响了，
 * 锁屏半小时后到点的提醒却没响」。这不是权限问题，权限开着也一样，
 * 只能引导用户去系统里把省电策略改成「无限制」。
 *
 * 时机：刚授予通知权限的那一刻。用户刚刚表达"我要提醒"，此时解释最不唐突；
 * 而且权限只会授一次，所以这个面板天然只弹一次，不需要额外存"看过没"。
 */
export default function BatteryHintSheet({
  visible, brand, onClose, onOpenSettings,
}: Props) {
  // 渲染期挂载，避免动画先起来、内容后建（和 PickerSheet 同样的理由）
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

  // 安卓返回键等同于"稍后再说"
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) return null;

  const backdrop = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [HIDDEN_Y, 0] });

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        <TouchableOpacity style={styles.fill} activeOpacity={1} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        <View style={styles.titleRow}>
          <View style={styles.iconBox}>
            <Ionicons name="battery-half-outline" size={18} color={C.primary} />
          </View>
          <Text style={styles.title}>让提醒准时响</Text>
        </View>

        <Text style={styles.body}>
          {brand ? `${brand} 这类` : '这台'}机型的省电策略会在锁屏后限制后台闹钟。
          日程提醒可能晚到，严重时整条不响 —— 这不是权限问题，权限开着也一样。
        </Text>

        <Text style={styles.body}>
          把本 App 的省电策略改成「无限制」，并允许「自启动」，提醒才有保障。
        </Text>

        <View style={styles.stepBox}>
          <Text style={styles.stepTitle}>操作路径</Text>
          <Text style={styles.stepText}>设置 → 应用管理 → 找到本 App → 省电策略 → 无限制</Text>
          <Text style={styles.stepHint}>
            现在是在 Expo Go 里调试，所以上面那一步要选「Expo Go」；装上正式安装包后选「动序ZENITH」。
          </Text>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={onOpenSettings}
        >
          <Text style={styles.primaryText}>去系统设置</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ghostBtn} activeOpacity={0.7} onPress={onClose}>
          <Text style={styles.ghostText}>稍后再说</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end', zIndex: 60,
  },
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(20,24,32,0.34)',
  },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 26,
  },
  handle: {
    alignSelf: 'center',
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: C.line,
    marginBottom: 16,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconBox: {
    width: 30, height: 30, borderRadius: 10,
    backgroundColor: C.soft,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  title: { fontSize: 17, fontWeight: '600', color: C.text },
  body: { fontSize: 13, lineHeight: 21, color: C.gray, marginBottom: 10 },
  stepBox: {
    backgroundColor: C.cardSoft,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 2,
    marginBottom: 18,
  },
  stepTitle: { fontSize: 11, color: C.primary, fontWeight: '600', marginBottom: 6 },
  stepText: { fontSize: 12.5, lineHeight: 19, color: C.text },
  stepHint: { fontSize: 11, lineHeight: 17, color: C.gray, marginTop: 6 },
  primaryBtn: {
    height: 48, borderRadius: 16,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: C.white, fontSize: 15, fontWeight: '600' },
  ghostBtn: { height: 42, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  ghostText: { color: C.gray, fontSize: 13 },
});
