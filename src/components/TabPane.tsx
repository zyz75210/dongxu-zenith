import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { C } from '../theme';
import { MOTION } from '../motion';

type Props = {
  /** 当前选中的 tab */
  active: boolean;
  children: React.ReactNode;
};

/**
 * tab 页面的容器 —— 只管显隐和交叉淡入，模糊交给整屏的 FrostOverlay。
 *
 * ## 为什么退场不做淡出
 * 退场的这一页是**在下层**（tab 舞台按挂载顺序叠），新页淡入时要靠它垫着：
 * 它保持不透明，新页从 0 淡上来，合成出来是干净的交叉淡化。
 * 之前两边同时淡（一个 1→0、一个 0→1），中间那几帧两层都半透明，
 * 底下的白色舞台会透上来 —— 就是快速来回切时"整页发白"的来源。
 * 现在旧页等新页铺满（paneOut）之后直接收起，中间没有任何一帧是白的。
 *
 * ## 为什么是否参与布局是派生值 `active || exiting`
 * 不靠"动画播完再 setState"。快速来回切时上一次的收尾回调会晚一步到达，
 * 把刚切进来的这一页收掉，而 active 没再变，就没人装回来 —— tab 区域只剩白底。
 * 派生之后只要 active 为真就一定在布局里，回调再晚也收不掉。
 *
 * 未选中的 tab 用 display:none 藏起来：不参与布局和绘制，视图树还在，
 * 切回来不用重建（日历页光日期格就 120 多个视图）。
 */
export default function TabPane({ active, children }: Props) {
  /** 正在退场：为真时即使 active 已经变假，也要留在布局里 */
  const [exiting, setExiting] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  /** 动画回调据此判断"是不是又切回来了"，晚了的那一步就不会误伤 */
  const want = useRef(active);
  const pending = useRef<'in' | 'out' | null>(null);
  const lastActive = useRef(false);

  const mounted = active || exiting;

  if (active !== lastActive.current) {
    lastActive.current = active;
    pending.current = active ? 'in' : 'out';
    if (!active) setExiting(true);
  }

  useEffect(() => {
    const act = pending.current;
    if (!act) return;
    pending.current = null;
    want.current = active;
    fade.stopAnimation();

    if (act === 'in') {
      const anim = Animated.timing(fade, {
        toValue: 1,
        duration: MOTION.paneIn,
        easing: MOTION.easeFade,
        useNativeDriver: true,
      });
      anim.start();
      // 兜底：回调没来也必须停在完全不透明，绝不留一层半透明的盖在上面
      const guard = setTimeout(() => {
        if (want.current) fade.setValue(1);
      }, MOTION.paneIn + 200);
      return () => {
        anim.stop();
        clearTimeout(guard);
      };
    }

    // 退场：保持不透明，等新页把这层盖满再收起
    const guard = setTimeout(() => {
      if (want.current) return;
      // 藏起来的时候顺手归零，下次切进来才有淡入
      fade.setValue(0);
      setExiting(false);
    }, MOTION.paneOut);
    return () => clearTimeout(guard);
  }, [active, fade]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.pane,
        { opacity: fade },
        // 选中 / 退场中的这一层要在上面：新页必须盖着旧页淡入，反过来会露出白底
        active ? styles.top : null,
        !mounted && styles.hidden,
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pane: { backgroundColor: C.bg },
  top: { zIndex: 1 },
  // display:none 只是不参与布局/绘制，视图树还在
  hidden: { display: 'none' },
});
