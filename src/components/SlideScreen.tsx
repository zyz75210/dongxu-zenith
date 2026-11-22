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
 * ## 关键点 1：是否参与布局 = `visible || exiting`
 * 这是个**纯派生值**，不靠动画回调去 setState 决定。
 * 之前是动画播完再 `setShown(false)`，快速来回切时「上一次的收尾回调」会晚一步到达，
 * 把刚打开的这一层收掉；而 visible 没再变，就没人把它装回来 —— 屏幕上只剩白底。
 *
 * ## 关键点 2：透明度只由 `visible` 驱动，且必定收敛到 1
 * 早先这里有一套 `pending / lastVisible` 的"待办动作"机制：渲染期记下该播进还是该播出，
 * 交给 effect 消费。问题是**待办只消费一次** —— 万一 effect 因为任何原因多跑了一轮，
 * 第二轮读到空待办就直接 return，既不播动画、也不装兜底定时器，
 * 那一层就永远停在 opacity 0：视图挂上了、却完全透明。
 * 表现出来就是"点了没反应"（新页面盖在上面但看不见），排查起来极难。
 * 现在改成：`visible` 为真就无条件淡入 + 兜底置 1；为假才淡出。
 * 这样"可见"这件事在结构上不可能失败。
 */
export default function SlideScreen({
  visible, children, topInset = 0, bottomInset = 0,
}: Props) {
  /** 正在退场：为真时即使 visible 已经变假，也要留在布局里把淡出播完 */
  const [exiting, setExiting] = useState(false);
  /** 1 = 不透明 / 0 = 透明。首次就直接显示时不做淡入，避免开屏闪一下 */
  const fade = useRef(new Animated.Value(visible ? 1 : 0)).current;

  /**
   * 这一层有没有「露过面」。首次可见之前不建子视图树。
   *
   * 之前是启动就把 8 个二级页全建出来、只用 display:none 藏着：不绘制，但
   * 每一页的 render 都要在首帧前跑一遍，视图（ShadowNode）也真的分配了 ——
   * 段位地图、历史日程这种几百个节点的大页，用户可能一次都不会打开，白占启动时间和内存。
   * 现在改成首次 visible 才建，之后和原来一样常驻（切走只是 display:none，不卸载）。
   *
   * 不会因此变卡：建树发生在 visible 变真的那一帧，而这一帧正好被整屏起雾盖着，
   * 起雾 / 对焦全是 native driver，JS 线程忙这一下不影响动画本身。
   * 只有一点前提：子组件不能依赖「自己一直挂着」—— 需要初始化就在 effect 里判 visible，
   * 别用 prevVisible 的初始值推（那三个页面都已经按这个写法来）。
   */
  const seen = useRef(visible);
  if (visible) seen.current = true;

  /**
   * 退场必须**在本次渲染就**留在布局里，不能等 effect —— effect 在提交之后才跑，
   * 那一帧页面已经被 display:none 拿掉，看到的是"啪"地消失而不是淡出。
   * 所以这一步用渲染期派生：刚变成不可见就标上 exiting，重新可见就撤销。
   * （这里只是一次收敛的 flag 翻转，不涉及动画值，和之前的"待办动作"不是一回事）
   */
  const wasVisible = useRef(visible);
  if (wasVisible.current !== visible) {
    wasVisible.current = visible;
    if (!visible) setExiting(true);
    else if (exiting) setExiting(false);
  }

  /** 派生：在不在布局里 */
  const mounted = visible || exiting;

  useEffect(() => {
    fade.stopAnimation();

    if (visible) {
      const anim = Animated.timing(fade, {
        toValue: 1,
        // 比起雾稍长一点：雾先盖住，页面再完全显影
        duration: MOTION.paneIn,
        easing: MOTION.easeFade,
        useNativeDriver: true,
      });
      anim.start();
      // 兜底：动画回调没来也必须停在完全不透明，绝不留半透明的一层
      const guard = setTimeout(() => fade.setValue(1), MOTION.paneIn + 150);
      return () => {
        anim.stop();
        clearTimeout(guard);
      };
    }

    if (!exiting) return undefined;

    const anim = Animated.timing(fade, {
      toValue: 0,
      duration: MOTION.exit,
      easing: MOTION.easeFade,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      // 中途又被打开就不收：否则会留下一层看不见的玻璃挡在上面
      if (finished && !visible) setExiting(false);
    });
    // 兜底收起，避免动画回调丢失后这层永远留在树上
    const guard = setTimeout(() => {
      if (visible) return;
      fade.setValue(0);
      setExiting(false);
    }, MOTION.exit + 150);
    return () => {
      anim.stop();
      clearTimeout(guard);
    };
    // exiting 只决定"要不要播淡出"，不需要进依赖：它和 visible=false 是同一次渲染设的
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <SafeAreaView style={styles.fill}>{seen.current ? children : null}</SafeAreaView>
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
