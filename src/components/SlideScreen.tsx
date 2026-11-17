import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, useWindowDimensions } from 'react-native';
import { C } from '../theme';

type Props = {
  /** 是否显示：true 滑入，false 滑出（滑出后不卸载，停在屏幕外等着下次滑入） */
  visible: boolean;
  /**
   * 预热：还没打开过就先在屏幕外把视图树建好。
   * 打开时只剩一次位移，不用在动画首帧现建整页，安卓上就不会卡一下。
   */
  preload?: boolean;
  children: React.ReactNode;
  /** 入场方向：right = 从右侧推入（默认）；bottom = 从底部升起 */
  from?: 'right' | 'bottom';
  /**
   * 安全区留白：绝对定位的浮层不会继承父级 SafeAreaView 的 padding，
   * 必须自己补一份，否则标题会顶到状态栏上。
   */
  topInset?: number;
  bottomInset?: number;
};

/**
 * 只做位移的转场容器 —— 刻意不加 opacity / scale / 阴影动画：
 * 这些属性在安卓上会触发离屏合成与整层重绘，是掉帧的主因。
 * 单纯 translate 由 native driver 交给 GPU 做矩阵变换，稳定 60fps。
 */
const IN_MS = 250;
const OUT_MS = 200;
const EASE_IN = Easing.bezier(0.2, 0.72, 0.3, 1);
const EASE_OUT = Easing.bezier(0.4, 0, 0.75, 0.5);

export default function SlideScreen({
  visible, preload = false, children, from = 'right', topInset = 0, bottomInset = 0,
}: Props) {
  const { width, height } = useWindowDimensions();
  const dist = from === 'right' ? width : height;

  // 0 → 1
  const progress = useRef(new Animated.Value(0)).current;

  /**
   * 挂载后一直保留（不再在退场结束时卸载）。
   * 页面重新挂载 = 重新创建整棵原生视图树（Yoga 布局 + 逐个 view 创建），
   * 这一段正好落在动画首帧上，就是"点开时卡一下"的来源。
   * 留在内存里的代价只是一棵不参与绘制（已经平移到屏幕外）的视图树。
   */
  const [mounted, setMounted] = useState(visible || preload);
  if ((visible || preload) && !mounted) setMounted(true);

  // 只有"可见性真正变化"时才播动画：预热挂载时不要空跑一次
  const prevVisible = useRef(false);
  useEffect(() => {
    if (!mounted) return;
    if (visible === prevVisible.current) return;
    prevVisible.current = visible;

    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? IN_MS : OUT_MS,
      easing: visible ? EASE_IN : EASE_OUT,
      useNativeDriver: true,
    }).start();
  }, [visible, mounted, progress]);

  if (!mounted) return null;

  const translate =
    from === 'right'
      ? { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [dist, 0] }) }
      : { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [dist, 0] }) };

  return (
    <Animated.View
      // 停在屏幕外时不吃触摸、也不进无障碍树，避免盖住底层页面
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[
        StyleSheet.absoluteFill,
        styles.screen,
        from === 'right' ? styles.edgeX : styles.edgeY,
        // 安卓：这里补状态栏留白（SafeAreaView 在安卓无效）
        { paddingTop: topInset, paddingBottom: bottomInset, transform: [translate] },
      ]}
    >
      {/* iOS：绝对定位同样吃不到外层 SafeAreaView 的内边距，这里再套一层兜住刘海 */}
      <SafeAreaView style={styles.inner}>{children}</SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: C.bg },
  inner: { flex: 1 },
  // 用 1px 描边代替阴影：阴影是整屏模糊绘制，开销远大于一条线
  edgeX: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(18,24,38,0.10)' },
  edgeY: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(18,24,38,0.10)' },
});
