import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, BackHandler, Easing, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';

// 收起时向下偏移。三种文案里最长的是 permission（多一段路径说明），
// 这里取一个明显大于面板高度的值，保证收起动画期间不会露出半截
const HIDDEN_Y = 560;

/** 引导要解决的那一步：前两个来自体检结果，battery 由国产 ROM 的授权时机触发 */
export type GuideKind = 'permission' | 'channel' | 'battery';

type Props = {
  visible: boolean;
  kind: GuideKind;
  /** 机型品牌，只有 battery 那一条会写进文案（"小米/华为这类机型…"） */
  brand: string;
  onClose: () => void;
  /** 跳到系统里本 App 的设置页（通知权限 / 渠道 / 省电策略都在那儿） */
  onOpenSettings: () => void;
};

type Copy = {
  icon: 'notifications-off-outline' | 'volume-mute-outline' | 'battery-half-outline';
  title: string;
  /** 主段落：说清"发生了什么、为什么界面看不出来" */
  lead: (brand: string) => string;
  /** 次段落：说清"要做什么" */
  action: string;
  path: string;
  hint?: string;
};

/**
 * 三种情况的文案。共同点：症状都是「一条通知都收不到」，
 * 但原因分别在权限、渠道、系统省电策略三层 —— 给错出口等于没解决，
 * 所以这里按体检结果分开写，不合并成一段通用说明。
 */
const COPY: Record<GuideKind, Copy> = {
  permission: {
    icon: 'notifications-off-outline',
    title: '通知权限被关闭了',
    lead: () =>
      '系统里本 App 的「允许通知」是关着的。这时日程到点不会有任何提示，'
      + '提醒也排不进去 —— 设置页显示「已排程 0 条」就是这里的原因。',
    action: '系统不会重复弹授权框，只能在这一页里手动打开。',
    path: '设置 → 应用管理 → 本 App → 通知 → 允许通知',
    hint: '在 Expo Go 里调试时选「Expo Go」；装上正式安装包后选「动序ZENITH」。',
  },
  channel: {
    icon: 'volume-mute-outline',
    title: '提醒渠道被关闭了',
    lead: () =>
      '权限是开着的，但「日程提醒」这个渠道被系统设成了关闭或静音。'
      + '安卓 8 以后通知必须挂在渠道上，渠道被关掉时系统会直接丢弃 —— 不报错、不提示。',
    action: '把这个渠道重新打开，重要性调回「高」，提醒才会弹出横幅并响铃。',
    path: '设置 → 应用管理 → 本 App → 通知 → 日程提醒 → 允许 + 重要性「高」',
    hint: '如果这一页里根本没有「日程提醒」这一项，说明渠道没建出来；'
      + '先发一条测试通知，仍不弹就把设置页那行红色报错发给我。',
  },
  battery: {
    icon: 'battery-half-outline',
    title: '让提醒准时响',
    lead: (brand) =>
      `${brand ? `${brand} 这类` : '这台'}机型的省电策略会在锁屏后限制后台闹钟。`
      + '日程提醒可能晚到，严重时整条不响 —— 这不是权限问题，权限开着也一样。',
    action: '把本 App 的省电策略改成「无限制」，并允许「自启动」，提醒才有保障。',
    path: '设置 → 应用管理 → 找到本 App → 省电策略 → 无限制',
    hint: '现在是在 Expo Go 里调试，所以上面那一步要选「Expo Go」；装上正式安装包后选「动序ZENITH」。',
  },
};

/**
 * 通知引导面板。三种原因共用一套版式，只有文案与图标不同 ——
 * 用户每次看到一个面板，不必分辨这是第几种弹窗。
 *
 * 时机由调用方决定（见 App.tsx / SettingsScreen）：
 * - 点「提醒与通知」时体检出 blocker → 弹 permission / channel
 * - 刚授予权限且是国产 ROM → 弹 battery
 * - 设置页「省电策略」一行 → 弹 battery
 */
export default function NotifyGuideSheet({
  visible, kind, brand, onClose, onOpenSettings,
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

  const copy = COPY[kind];
  const backdrop = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [HIDDEN_Y, 0] });

  return (
    /*
      同上：收起过程中一律不吃触摸。这个面板还有一条"去系统设置"的路径 ——
      点完 App 会切到后台，淡出动画很可能根本播不完，回调不回来就永远 mounted，
      那层 opacity 0 的遮罩会一直挡着整屏。
    */
    <View style={styles.root} pointerEvents={visible ? 'box-none' : 'none'}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        <TouchableOpacity style={styles.fill} activeOpacity={1} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        <View style={styles.titleRow}>
          <View style={styles.iconBox}>
            <Ionicons name={copy.icon} size={18} color={C.primary} />
          </View>
          <Text style={styles.title}>{copy.title}</Text>
        </View>

        <Text style={styles.body}>{copy.lead(brand)}</Text>
        <Text style={styles.body}>{copy.action}</Text>

        <View style={styles.stepBox}>
          <Text style={styles.stepTitle}>操作路径</Text>
          <Text style={styles.stepText}>{copy.path}</Text>
          {copy.hint ? <Text style={styles.stepHint}>{copy.hint}</Text> : null}
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
