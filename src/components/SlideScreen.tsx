import React, { useEffect, useRef, useState } from 'react';
import { Animated, SafeAreaView, StyleSheet, View } from 'react-native';
import { C } from '../theme';
import { MOTION } from '../motion';

type Props = {
  /** 是否显示：转场由整屏的 FrostOverlay 负责，这里只管进出与生命周期 */
  visible: boolean;
  children: React.ReactNode;
  /**
   * 安全区留白：这一层是绝对定位的整屏层，吃不到外层 SafeAreaView 的内边距，
   * 必须自己补一份，否则标题会顶到状态栏上。
   */
  topInset?: number;
  bottomInset?: number;
};

/**
 * 二级页面的容器 —— 只负责「在不在」和淡入淡出，模糊交给整屏的 FrostOverlay。
 *
 * ## 关键点：是否参与布局 = `visible || exiting`
 * 这是个**纯派生值**，不靠动画回调去 setState 决定。
 * 之前是动画播完再 `setShown(false)`，快速来回切时「上一次的收尾回调」会晚一步到达，
 * 把刚打开的这一层收掉；而 visible 没再变，就没人把它装回来 —— 屏幕上只剩白底。
 * 现在只要 visible 为真，这一层就必定在布局里，收尾回调再晚也收不掉它。
 *
 * 入场是短淡入而不是直接给整页：起雾那几十毫秒里旧页面还在下面，
 * 新页面在雾里显影，换页那一下就被雾接住了。直接给整页等于"啪"地换张图。
 */
export default function SlideScreen({
  visible, children, topInset = 0, bottomInset = 0,
}: Props) {
  /** 正在退场：为真时即使 visible 已经变假，也要留在布局里把淡出播完 */
  const [exiting, setExiting] = useState(false);
  /** 1 = 不透明 / 0 = 透明。首次就直接显示时不做淡入，避免开屏闪一下 */
  const fade = useRef(new Animated.Value(visible ? 1 : 0)).current;

  /** 动画回调据此判断"是不是又打开了"，晚了的那一步就不会误伤 */
  const want = useRef(visible);
  const pending = useRef<'in' | 'out' | null>(null);
  const lastVisible = useRef(visible);

  /** 派生：在不在布局里 */
  const mounted = visible || exiting;

  if (visible !== lastVisible.current) {
    lastVisible.current = visible;
    pending.current = visible ? 'in' : 'out';
    // 退场必须在本次渲染就留在布局里，不能等 effect —— 那会先硬切一下再淡出
    if (!visible) setExiting(true);
  }

  useEffect(() => {
    const act = pending.current;
    if (!act) return;
    pending.current = null;
    want.current = visible;
    fade.stopAnimation();

    if (act === 'in') {
      const anim = Animated.timing(fade, {
        toValue: 1,
        // 比起雾稍长一点：雾先盖住，页面再完全显影
        duration: MOTION.paneIn,
        easing: MOTION.easeFade,
        useNativeDriver: true,
      });
      anim.start();
      // 兜底：回调没来也必须停在完全不透明，绝不留半透明的一层
      const guard = setTimeout(() => {
        if (want.current) fade.setValue(1);
      }, MOTION.paneIn + 200);
      return () => {
        anim.stop();
        clearTimeout(guard);
      };
    }

    const anim = Animated.timing(fade, {
      toValue: 0,
      duration: MOTION.exit,
      easing: MOTION.easeFade,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      // 中途又被打开就不收：否则会留下一层看不见的玻璃挡在上面
      if (finished && !want.current) setExiting(false);
    });
    // 兜底收起，避免动画回调丢失后这层永远留在树上
    const guard = setTimeout(() => {
      if (want.current) return;
      fade.setValue(0);
      setExiting(false);
    }, MOTION.exit + 200);
    return () => {
      anim.stop();
      clearTimeout(guard);
    };
  }, [visible, fade]);

  return (
    <Animated.View
      // 隐藏时不吃触摸、也不进无障碍树，避免盖住底层页面
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[StyleSheet.absoluteFill, styles.screen, { opacity: fade }, !mounted && styles.gone]}
    >
      <View style={[styles.fill, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        {/* iOS：绝对定位同样吃不到外层 SafeAreaView 的内边距，这里再套一层兜住刘海 */}
        <SafeAreaView style={styles.fill}>{children}</SafeAreaView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: C.bg },
  // 不在场：从布局里整层拿掉（不绘制、不参与命中测试），视图树仍然留着
  gone: { display: 'none' },
  fill: { flex: 1, backgroundColor: C.bg },
});
