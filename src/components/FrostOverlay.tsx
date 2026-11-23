import React, { useLayoutEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { MOTION } from '../motion';

type Props = {
  /** 模糊取样的目标：整屏内容层（主界面 + 二级页面都包在里面） */
  targetRef: React.RefObject<React.ComponentRef<typeof View> | null>;
  /** 导航标识（页面 + tab）。值一变就播一次转场 */
  trigger: string;
  /** 起雾时长 */
  fog: number;
  /** 对焦时长 */
  focus: number;
  /**
   * 模糊层的底部留白：底部菜单栏的高度。
   * 压暗（wash）永远盖整屏，菜单栏也跟着压暗；
   * 但**模糊只到菜单栏上沿** —— 菜单栏的内容和滑块动画不需要被糊住。
   * 进出二级页面时传 0（那时菜单栏本来就被页面盖住了）。
   */
  clipBottom?: number;
  /**
   * 是否压一层冷灰（默认 true）。
   * 关掉之后整屏亮度不变 —— 首页搜索栏的进出要这个效果：
   * "屏幕忽然暗一下"会让人以为点错了，只留模糊就够了。
   */
  dim?: boolean;
  /** 是否使用原生模糊。默认跟随全局 MOTION.useBlur，个别转场可以单独打开 */
  blur?: boolean;
  /** 模糊强度覆盖（默认 MOTION.blur） */
  intensity?: number;
};

/** 雾最浓时容器的不透明度：不做模糊时用满值，靠 wash 自己的 alpha 控制浓淡 */

/**
 * 整屏转场层 —— 全 App 唯一的转场动画，分「起雾 → 对焦」两段。
 *
 * 两层、职责分开：
 * - **压暗**：一层冷灰纯色，永远盖满整屏，底部菜单栏也在内；
 * - **模糊**：只盖内容区，底部停在菜单栏上沿（`clipBottom`）。
 * 菜单栏一起压暗、但不被糊 —— 它要跟着"被盖住"，图标却不该发毛。
 *
 * ## 为什么默认不做原生模糊
 * 原生模糊每次转场都要异步抓一张整屏位图，抓完的时刻和当前帧对不上，
 * 动画那几帧里会交替显示新旧两张快照 —— 就是"闪"。
 * 现在改成一层**中性冷灰薄雾**：只动一个纯色视图的透明度，没有任何离屏渲染，
 * 逐帧输出是单调变化的，物理上不可能闪。
 * 想要真模糊，把 `MOTION.useBlur` 改成 true（参数都已备好），建议等正式包再开。
 *
 * ## 为什么容器常驻、只挂 / 摘里面的内容
 * 容器（Animated.View）一直挂着，`opacity` 绑的 Animated.Value 原生节点就永远在。
 * 之前整组件 `return null` 卸载，再挂回来时原生节点是新的、值是旧的 ——
 * 若"卸载那一刻浓度刚好最高"，重挂就是一层满屏白。现在只摘里面的内容，值不会丢。
 *
 * ## 为什么动画值一律不在渲染期写
 * 渲染期 `setValue` 时视图可能还没上屏，值写不进原生节点，`0 → 1` 的动画就成了 `0 → 0`，
 * 表现为"待久了再切，动画没了"。渲染期只决定"内容要不要挂"，值只在 layout effect 里动。
 */
export default function FrostOverlay({
  targetRef, trigger, fog, focus, clipBottom = 0,
  dim = true, blur = MOTION.useBlur, intensity,
}: Props) {
  /** 0 = 清晰 / 1（或 MOTION.peak）= 最浓 */
  const val = useRef(new Animated.Value(0)).current;
  /** 转场内容是否挂出来：只在转场这几百毫秒里挂，平时一个视图都不留 */
  const [live, setLive] = useState(false);

  const prev = useRef(trigger);
  const first = useRef(true);
  /** 本轮转场的参数在触发那一刻锁定；转场途中别的 state 变化不能改它 */
  const cfg = useRef({ fog, focus, clipBottom, dim, blur, intensity });
  const seq = useRef<Animated.CompositeAnimation | null>(null);
  const guard = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 上一段转场是否还在播：还在播就从当前浓度接着走，跳回 0 会闪一下 */
  const flying = useRef(false);

  /**
   * 渲染期只干一件事：把内容挂出来，让"页面换掉"和"雾出现"落在同一帧。
   * 动画值一个都不碰。
   */
  if (trigger !== prev.current) {
    prev.current = trigger;
    cfg.current = { fog, focus, clipBottom, dim, blur, intensity };
    if (!live) setLive(true);
  }

  /** 收尾：浓度归零、摘掉内容。幂等，动画回调和兜底定时器都可能调它 */
  const settle = () => {
    flying.current = false;
    val.setValue(0);
    setLive(false);
  };

  // layout effect：在提交之后、这一帧画出来之前就跑，雾和页面同一帧出现
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const { fog: fogMs, focus: focusMs } = cfg.current;
    // 用真模糊的转场停在 peak（不然整屏糊成一片白）；纯压暗的转场靠 wash 自己的 alpha 控浓淡
    const peak = cfg.current.blur ? MOTION.peak : 1;

    seq.current?.stop();
    if (guard.current) clearTimeout(guard.current);
    // 上一段已经停了才归零；途中接着走，避免浓度突然掉下去闪一帧
    if (!flying.current) val.setValue(0);
    flying.current = true;

    const run = Animated.sequence([
      Animated.timing(val, {
        toValue: peak,
        duration: fogMs,
        easing: MOTION.easeFog,
        useNativeDriver: true,
      }),
      Animated.timing(val, {
        toValue: 0,
        duration: focusMs,
        easing: MOTION.easeFocus,
        useNativeDriver: true,
      }),
    ]);
    seq.current = run;

    run.start(({ finished }) => {
      // 被打断（又来了一次转场）就不收尾，交给下一段接着走
      if (!finished) return;
      // 正常播完就把兜底定时器撤掉，免得它下一轮误收
      if (guard.current) {
        clearTimeout(guard.current);
        guard.current = null;
      }
      settle();
    });

    /**
     * 兜底收尾：回调万一没来（被系统丢帧 / 打断），这层会一直挂在最上面。
     */
    guard.current = setTimeout(settle, fogMs + focusMs + 300);

    return () => {
      run.stop();
      if (guard.current) clearTimeout(guard.current);
    };
    // settle 只碰 ref 和 setState，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, val]);

  return (
    <Animated.View
      // 容器常驻：没在转场时它就是一层完全透明的空视图
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity: val }]}
    >
      {live ? (
        <>
          {/*
            压暗层：整屏覆盖，**包括底部菜单栏**。
            它只是一层纯色，压暗菜单栏反而让"整屏被盖住"这件事更成立。
            dim=false 的转场（首页搜索）不挂这层：屏幕亮度全程不变。
          */}
          {cfg.current.dim ? (
            <View style={[StyleSheet.absoluteFill, styles.wash]} />
          ) : null}

          {/*
            模糊层：只在内容区，底部停在菜单栏上沿（clipBottom）。
            菜单栏要一起压暗，但不要被糊 —— 糊住会让上面那排图标发毛。
          */}
          {cfg.current.blur ? (
            <View style={[StyleSheet.absoluteFill, { bottom: cfg.current.clipBottom }]}>
              <BlurView
                blurTarget={targetRef}
                // 安卓 12+ 走 RenderEffect；低版本直接不糊（退化成半透明）
                blurMethod="dimezisBlurViewSdk31Plus"
                blurReductionFactor={MOTION.blurReductionFactor}
                intensity={cfg.current.intensity ?? MOTION.blur}
                tint="default"
                style={StyleSheet.absoluteFill}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** 中性冷灰：不是白，白在整屏白底上等于一次闪光 */
  wash: { backgroundColor: `rgba(18,24,38,${MOTION.wash})` },
});
