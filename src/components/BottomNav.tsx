import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, Pressable, StyleSheet, Text, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';

export type TabKey = 'calendar' | 'train' | 'planet' | 'content' | 'growth';

export const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'calendar', label: '日历', icon: 'calendar-outline' },
  { key: 'train', label: '训练', icon: 'barbell-outline' },
  { key: 'planet', label: '星球', icon: 'planet-outline' },
  { key: 'content', label: '内容', icon: 'document-text-outline' },
  { key: 'growth', label: '积累', icon: 'layers-outline' },
];

type Props = {
  active: TabKey;
  onChange: (key: TabKey) => void;
};

const BOX = 34;   // 选中态圆的直径
const ICON = 20;  // 图标字号，灰白两层必须一致，否则叠不齐
// 导航条上内边距：bar 与白层共用这一个数，两层图标的垂直原点才严格是同一个
const PAD_TOP = 8;

type Spot = { x: number; y: number };

/* ============================================================================
 * 图标怎么变白
 *
 * 每个图标画两层：底层永远是灰的，上面一层是白的，白层只在一个**跟着小球走的
 * 34×34 裁剪窗口**里露出。窗口位移 = 小球位移（同一个 tx），窗口里的白图标用
 * 反向位移钉回原位。于是：球没到 → 灰；盖住一半 → 白一半、露一半灰（硬切，
 * 不是整字发虚）；盖满 → 全白。颜色完全由小球位置决定，没有定时器、没有状态翻转。
 *
 * ## 两个坑，这次各用一招堵掉
 *
 * 1. **反向位移不能用 `Animated.multiply(tx, -1)`**。multiply 是派生节点，某些安卓
 *    机型上不跟 native 动画逐帧更新，白层带着旧位移 → 窗口扫过时露不出该露的字，
 *    表现就是"球已经压在图标上、图标还是灰的"。改成 `tx.interpolate([0,1]→[0,-1])`，
 *    默认 extend，对任意 tx 严格等于 -tx，且和 tx 在同一次 native 更新里取值。
 *
 * 2. **切页重渲染会把旧位移写回原生层**。BottomNav 每次切 tab 都会重渲染（active 变了），
 *    重渲染时 Animated.View 会把 `__getValue()` 的当前 JS 值 setNativeProps 一遍；
 *    而 native 驱动的值在 JS 侧可能落后一帧 → 白块闪回上一个图标再弹回来，
 *    这就是"日历图标闪动"。所以动画层拆成 `NavBlob` / `NavWhites` 两个 memo 组件，
 *    它们的 props 只有位置和尺寸（切页时一律不变），**切 tab 不会触发它们重渲染**，
 *    原生层只在动画推进时更新。
 * ========================================================================== */

/** 深色小球。props 里没有任何随 tab 变化的东西，切页时不会重渲染。 */
const NavBlob = memo(function NavBlob({
  tx, wobble, top, ready,
}: {
  tx: Animated.Value;
  wobble: Animated.Value;
  top: number;
  ready: boolean;
}) {
  const scaleX = useMemo(
    () => wobble.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }),
    [wobble],
  );
  const scaleY = useMemo(
    () => wobble.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }),
    [wobble],
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.blob,
        {
          top,
          opacity: ready ? 1 : 0,
          transform: [{ translateX: tx }, { scaleX }, { scaleY }],
        },
      ]}
    />
  );
});

/**
 * 白色图标层。窗口跟着小球走（translateX: tx），内层 -tx 把白图标钉回原位，
 * 只有窗口那块露出白色 —— 窗口就是小球的脚印，白色不可能跑到球外面。
 *
 * ## 白图标为什么不用 `left: s.x` 定位
 *
 * 用测量值定位会重影：灰图标的位置是 flex 布局算的（item 宽 = 屏宽/5，常常是 78.6
 * 这种小数），白图标的位置是 `item.x + icon.x` —— 两次布局各自按物理像素取整再相加，
 * 和"整体布局再取整"差 1px 上下。白字旁边就露出灰字的笔画，看起来像重影。
 *
 * 所以这里**复刻灰层那套 flex 布局**：宽度取导航条实宽，五个等分 cell，每格再居中一个
 * 34×34 的框。Yoga 对两层的计算路径完全相同，位置必然逐像素一致，测量值只用来挪小球。
 * 垂直同理 —— 用同一个 PAD_TOP，不用 `spots[i].y`。
 */
const NavWhites = memo(function NavWhites({
  tx, txNeg, ready, barW,
}: {
  tx: Animated.Value;
  txNeg: Animated.AnimatedInterpolation<number>;
  ready: boolean;
  barW: number;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.whiteWindow,
        {
          opacity: ready && barW > 0 ? 1 : 0,
          transform: [{ translateX: tx }],
        },
      ]}
    >
      <Animated.View
        style={[
          styles.whiteShift,
          { width: barW, transform: [{ translateX: txNeg }] },
        ]}
      >
        {TABS.map((t) => (
          <View key={t.key} style={styles.whiteCell}>
            {/* 复用灰层的 iconBox：外层等分格 + 内层 34 框，两级居中与灰层逐级对应 */}
            <View style={styles.iconBox}>
              <Ionicons name={t.icon as any} size={ICON} color={C.white} />
            </View>
          </View>
        ))}
      </Animated.View>
    </Animated.View>
  );
});

function BottomNav({ active, onChange }: Props) {
  const activeIdx = Math.max(0, TABS.findIndex((t) => t.key === active));

  /** 每个 item / 图标相对导航条的位置 */
  const itemPos = useRef<Spot[]>([]);
  const iconPos = useRef<Spot[]>([]);
  /** 两份位置合起来的结果；同一份引用交给 memo 层，切页时它不会重渲染 */
  const spotsRef = useRef<Spot[] | null>(null);
  const [spots, setSpots] = useState<Spot[] | null>(null);

  const tx = useRef(new Animated.Value(0)).current;      // 小球横向位置
  const wobble = useRef(new Animated.Value(0)).current;  // 0=圆 1=被拉长
  /** -tx：窗口跟着球走，白图标靠它钉回原位 */
  const txNeg = useMemo(
    () => tx.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }),
    [tx],
  );

  const [top, setTop] = useState(0);
  /** 导航条实宽：白层要用它铺出和灰层完全一样的五个等分格 */
  const [barW, setBarW] = useState(0);
  const placed = useRef(false);
  /** 当前在播的滑块动画；换目标时先停掉，免得两段 timing 同时写 wobble */
  const liquid = useRef<Animated.CompositeAnimation | null>(null);

  /**
   * 位置齐了就记一份。第一次齐的时候把小球直接摆到当前项（不播动画）；
   * 之后位置再变（转屏、分屏）说明之前的动画已经没意义了，停掉重摆。
   */
  const refresh = () => {
    const list: Spot[] = [];
    for (let i = 0; i < TABS.length; i += 1) {
      const a = itemPos.current[i];
      const b = iconPos.current[i];
      if (!a || !b) return;  // 还没量全，等下一次 onLayout
      list.push({ x: a.x + b.x, y: a.y + b.y });
    }
    const prev = spotsRef.current;
    const same = prev !== null && prev.every((p, i) => p.x === list[i].x && p.y === list[i].y);
    spotsRef.current = list;

    if (!placed.current) {
      placed.current = true;
      setTop(list[activeIdx].y);
      tx.setValue(list[activeIdx].x);
    } else if (!same) {
      liquid.current?.stop();
      setTop(list[activeIdx].y);
      tx.setValue(list[activeIdx].x);
    }
    if (!same) setSpots(list);
  };

  const measure = (store: React.MutableRefObject<Spot[]>, i: number, x: number, y: number) => {
    const prev = store.current[i];
    // onLayout 会对同一组数字反复回调，没变就别惊动渲染
    if (prev && prev.x === x && prev.y === y) return;
    store.current[i] = { x, y };
    refresh();
  };

  // 切换 tab：位移用弹簧，同时把圆横向拉长再收回来（液体感）
  const firstAnim = useRef(true);
  useEffect(() => {
    // 首次挂载只是"摆位"，不该有拉伸动作
    if (firstAnim.current) {
      firstAnim.current = false;
      return;
    }
    const list = spotsRef.current;
    // 位置还没量到（冷启动最初几帧就点了）：refresh 会把球直接摆到当前项
    if (!list || !placed.current) return;
    const s = list[activeIdx];
    if (!s) return;

    setTop(s.y);
    liquid.current?.stop();

    const run = Animated.parallel([
      Animated.spring(tx, {
        toValue: s.x,
        useNativeDriver: true,
        stiffness: 300,
        damping: 26,
        mass: 0.9,
      }),
      Animated.sequence([
        Animated.timing(wobble, {
          toValue: 1,
          duration: 95,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(wobble, {
          toValue: 0,
          duration: 190,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]);
    liquid.current = run;
    // 不需要结束回调：白色由位置决定，球停在哪，白色就停在哪
    run.start();
  }, [activeIdx, tx, wobble]);

  useEffect(() => () => liquid.current?.stop(), []);

  return (
    <View
      style={styles.bar}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        // 只在真的变了才 setState，转屏 / 分屏才需要重铺白层
        setBarW((prev) => (prev === w ? prev : w));
      }}
    >
      {/* 小球在最底层：灰图标压在它上面，再由白层盖回来 */}
      <NavBlob tx={tx} wobble={wobble} top={top} ready={spots !== null} />

      {TABS.map((t, i) => (
        <Pressable
          key={t.key}
          style={styles.item}
          onPress={() => onChange(t.key)}
          onLayout={(e) => {
            const { x, y } = e.nativeEvent.layout;
            measure(itemPos, i, x, y);
          }}
        >
          <View
            style={styles.iconBox}
            onLayout={(e) => {
              const { x, y } = e.nativeEvent.layout;
              measure(iconPos, i, x, y);
            }}
          >
            {/* 底层永远是灰的；变白是上面那层的事 */}
            <Ionicons name={t.icon as any} size={ICON} color={C.gray} />
          </View>
          <Text style={[styles.label, i === activeIdx && styles.labelOn]} numberOfLines={1}>
            {t.label}
          </Text>
        </Pressable>
      ))}

      {/* 白层在最上面：只在小球那块露出白色 */}
      <NavWhites tx={tx} txNeg={txNeg} ready={spots !== null} barW={barW} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: PAD_TOP,
    paddingBottom: 6,
    backgroundColor: C.bg,
    flexShrink: 0,
  },
  // 选中态的深色圆：由这一层统一承担，在项目之间移动
  blob: {
    position: 'absolute',
    left: 0,
    width: BOX, height: BOX, borderRadius: BOX / 2,
    backgroundColor: C.text,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconBox: {
    width: BOX, height: BOX, borderRadius: BOX / 2,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  label: { fontSize: 11, color: C.gray, marginTop: 3 },
  labelOn: { color: C.text, fontWeight: '500' },

  // 白色裁剪窗口：宽度严格等于小球直径，所以"球盖满 = 整块白"。
  // 垂直方向不裁（高度铺满导航条）：球是圆的，球外露出的白字落在白底上本来就看不见，
  // 反而省掉"窗口 top 怎么和图标对齐"这件事 —— 对齐交给白层自己的 flex 布局。
  whiteWindow: {
    position: 'absolute',
    left: 0, top: 0,
    width: BOX, height: '100%',
    overflow: 'hidden',
  },
  // 复刻灰层的横向布局：五个等分格。反向位移把它整体钉回去，只有窗口那 34 宽露白。
  whiteShift: {
    position: 'absolute', left: 0, top: 0,
    flexDirection: 'row',
    paddingTop: PAD_TOP,
  },
  // 与 iconBox 同构：34×34 居中，只是里面换成白图标
  whiteCell: {
    flex: 1, height: BOX,
    alignItems: 'center', justifyContent: 'center',
  },
});

// tab 没变、props 没变就不重渲染
export default memo(BottomNav);
