import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from 'react-native';
import { C } from '../theme';
import { wheelTick } from '../utils/haptics';

// 滚轮尺寸：日期、时间两处共用，保证观感完全一致
export const ITEM_H = 44;
export const VISIBLE = 5;
export const WHEEL_H = ITEM_H * VISIBLE;

/** 首尾留白：让第一项和最后一项也能停在正中间 */
const PAD = ITEM_H * ((VISIBLE - 1) / 2);

/**
 * 只渲染"当前格"上下各 12 行（共 25 行）。
 * 年列有 171 项，全建出来要创建 340+ 个原生视图和动画节点 ——
 * 那正是"点开年份卡一下"的来源。窗口滚动到边缘时再整段平移，视觉上完全看不出来。
 */
const RENDER_HALF = 12;

// ——— 惯性参数：整组调这里就能改手感 ———
/** 松手速度低于此值（px/ms）算轻推：不做惯性，直接吸附到最近一格 */
const FLICK_MIN = 0.1;
/** 衰减时间常数（ms）：松手越快取越大 —— 滑得更远 */
const TAU_MIN = 120;
const TAU_MAX = 360;
/** 到这个速度就吃满 TAU_MAX，再快也不再加长 */
const SPEED_REF = 2.2;
/** 一次甩动最多滑几格（再多就不好控制） */
const MAX_ROWS = 11;
const MAX_TRAVEL = ITEM_H * MAX_ROWS;
/**
 * 时长 = 系数 × 落格距离 / 松手速度：保证起手速度跟手指基本一致（不"顿"），
 * 系数越接近 3 越跟手；小于 3 会有一点点加速感，更有"被甩出去"的动量。
 */
const DUR_K = 2.5;
const DUR_MIN = 190;
const DUR_MAX = 900;
/** 估算时长时的速度下限，避免慢速小位移被算成很长的时间 */
const V_FLOOR = 0.25;
/** 拖到两端之外时的橡皮筋阻尼（0.32 = 手指走 100px，内容只走 32px） */
const RUBBER = 0.32;
/** 松手速度上限，避免超大甩动一下飞出几十格 */
const V_MAX = 4;

type Props = {
  data: number[];
  value: number;
  onChange: (v: number) => void;
  /** 数字后面跟的单位，例如 " 年" */
  suffix?: string;
  /** 自定义显示（时间需要补零），优先于 suffix */
  format?: (v: number) => string;
  flex?: number;
  /** 实时值回写：拖动中也能被父级读到，避免"没停稳就点确定"拿到旧值 */
  liveRef?: React.RefObject<number>;
};

/**
 * 滚动层：只负责把一个"窗口"内的行画出来。
 * 单独 memo，这样中央黑字换数值时（父级重渲染），这 25 行不会跟着重建。
 */
const WheelItems = memo(function WheelItems({
  data, lo, hi, scrollY, label,
}: {
  data: number[];
  lo: number;
  hi: number;
  scrollY: Animated.Value;
  label: (v: number) => string;
}) {
  const rows: React.ReactNode[] = [];
  for (let i = lo; i < hi; i++) {
    const v = data[i];
    const dist = scrollY.interpolate({
      inputRange: [(i - 1) * ITEM_H, i * ITEM_H, (i + 1) * ITEM_H],
      outputRange: [1, 0, -1],
      extrapolate: 'clamp',
    });
    rows.push(
      <Animated.View
        key={i}
        style={[
          styles.item,
          {
            // 远离中心只做"缩小"，不压扁字形
            transform: [
              {
                scale: dist.interpolate({
                  inputRange: [-1, 0, 1],
                  outputRange: [0.76, 1, 0.76],
                }),
              },
            ],
          },
        ]}
      >
        <Animated.Text
          style={[
            styles.itemText,
            {
              // 中心 ±0.55 格（约 24px，正好覆盖选中框高度）完全透明，
              // 让位给中央固定层的黑字，避免两层数字叠在一起
              opacity: dist.interpolate({
                inputRange: [-1, -0.92, -0.55, 0, 0.55, 0.92, 1],
                outputRange: [0.24, 0.42, 0, 0, 0, 0.42, 0.24],
                extrapolate: 'clamp',
              }),
            },
          ]}
        >
          {label(v)}
        </Animated.Text>
      </Animated.View>,
    );
  }

  return (
    <>
      {/* 窗口之前的部分用等高的空 View 占位，保证每一行的绝对位置不变 */}
      {lo > 0 && <View style={{ height: lo * ITEM_H }} />}
      {rows}
    </>
  );
});

/** 中央固定黑字：位置不动，只换数值 */
const CenterLabel = memo(function CenterLabel({ text }: { text: string }) {
  return (
    <View style={styles.centerLayer} pointerEvents="none">
      <Text style={styles.centerText}>{text}</Text>
    </View>
  );
});

/**
 * 单列滚筒滚轮（日期 / 时间共用）：
 *
 * 1. 手势和惯性全部自己接管，不再依赖 ScrollView 固定的 decelerationRate ——
 *    松手速度直接决定衰减时间：轻推一下立刻停住，甩得越快滑得越远、减速越缓；
 * 2. 位移由「缓出曲线」驱动，全程走 native driver，绘制不经 JS 线程；
 * 3. 每滑过一个数字打一下清脆震动（iOS 用系统 selection，安卓用 Clock_Tick）；
 * 4. 视觉保持原样：未选中项只缩小变浅，中央黑字固定不动、只换数值。
 */
export default function WheelColumn({
  data, value, onChange, suffix, format, flex = 1, liveRef,
}: Props) {
  const n = data.length;
  const maxOffset = Math.max(0, (n - 1) * ITEM_H);
  const maxOffsetRef = useRef(maxOffset);
  maxOffsetRef.current = maxOffset;

  // 只取首帧：初始停在哪一行
  const initialIdx = useRef(Math.max(0, data.indexOf(value))).current;

  /** 当前最近的整格下标（和 center 保持同步，但改它不需要重渲染） */
  const idxRef = useRef(initialIdx);
  /** 当前滚动位移（px）：手势、动画都以它为唯一真值 */
  const offsetRef = useRef(initialIdx * ITEM_H);
  const [center, setCenter] = useState(value);
  /** 上一次和父级同步过的数值，用于判断"外部是否改过值" */
  const lastValue = useRef(value);

  /** 绘制用的位移：native driver 驱动，只参与 transform / 插值 */
  const scrollY = useRef(new Animated.Value(initialIdx * ITEM_H)).current;
  const translateY = useMemo(() => Animated.multiply(scrollY, -1), [scrollY]);

  /** 渲染窗口：默认只画当前格附近 */
  const [win, setWin] = useState(() => ({
    lo: Math.max(0, initialIdx - RENDER_HALF),
    hi: Math.min(n, initialIdx + RENDER_HALF + 1),
  }));
  const winRef = useRef(win);
  winRef.current = win;

  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef({ start: 0, samples: [] as { t: number; y: number }[] });

  /** 拖动中的位移与合帧用的 rAF：把多次 move 合并成每帧一次 setValue */
  const pendingY = useRef(initialIdx * ITEM_H);
  const moveRaf = useRef<number | null>(null);

  const label = useCallback(
    (v: number) => (format ? format(v) : `${v}${suffix ?? ''}`),
    [format, suffix],
  );

  /** 掐断进行中的惯性 / 镜像循环 / 待提交的拖动位移 */
  const stopAnim = useCallback(() => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (moveRaf.current != null) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = null;
    }
  }, []);

  /** 窗口边界：尽量让当前格居中，靠边时贴住两端 */
  const windowAt = useCallback(
    (idx: number) => ({
      lo: Math.max(0, idx - RENDER_HALF),
      hi: Math.min(n, idx + RENDER_HALF + 1),
    }),
    [n],
  );

  /**
   * 只在跨过半格时更新中央黑字并打一次震动 —— 这就是"数字变了"的瞬间，
   * 拖动和惯性、吸附都走这里，所以一手感。
   */
  const syncIndex = useCallback(
    (y: number) => {
      const i = Math.min(n - 1, Math.max(0, Math.round(y / ITEM_H)));
      if (i === idxRef.current) return;
      idxRef.current = i;
      setCenter(data[i]);
      wheelTick();

      // 滚到窗口边缘时整段平移窗口（离窗口边缘还有 3 行余量，看不出切换）
      const w = winRef.current;
      if (i < w.lo + 3 || i > w.hi - 4) {
        const next = windowAt(i);
        if (next.lo !== w.lo || next.hi !== w.hi) setWin(next);
      }
    },
    [data, n, windowAt],
  );

  /** 程序化定位（外部改值、列长度变化）：瞬移，不打震动 */
  const placeAt = useCallback(
    (v: number) => {
      const idx = data.indexOf(v);
      if (idx < 0) return;
      stopAnim();
      idxRef.current = idx;
      offsetRef.current = idx * ITEM_H;
      pendingY.current = idx * ITEM_H;
      lastValue.current = v;
      scrollY.setValue(idx * ITEM_H);
      setCenter(v);
      setWin(windowAt(idx));
    },
    [data, scrollY, stopAnim, windowAt],
  );

  /**
   * 回写数值：只在滚轮停稳时通知父级（滚动途中靠 liveRef 读实时值）。
   * 惯性过程中不通知，避免父级中途重渲染把列数据换掉、打断滚动。
   */
  const commit = useCallback(
    (y: number) => {
      const i = Math.min(n - 1, Math.max(0, Math.round(y / ITEM_H)));
      const v = data[i];
      lastValue.current = v;
      if (v !== value) onChange(v);
    },
    [data, n, onChange, value],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;

  /**
   * 把拖动位移合到每帧一次：手指移动事件可能 120Hz，逐个下发既浪费桥调用，
   * 又容易在 JS 忙时堆成延迟 —— 合并后视觉仍按屏幕刷新率更新。
   */
  const queueDrag = useCallback(() => {
    if (moveRaf.current != null) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = null;
      const y = pendingY.current;
      scrollY.setValue(y);
      syncIndex(y);
    });
  }, [scrollY, syncIndex]);

  /** 立即把待提交的位移落地（松手/吸附前调用，避免慢一帧） */
  const flushDrag = useCallback(() => {
    if (moveRaf.current != null) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = null;
    }
    pendingY.current = offsetRef.current;
    scrollY.setValue(offsetRef.current);
  }, [scrollY]);

  /**
   * 滑到某个位移：绘制交给 native driver，JS 侧再跑一个只做算术的镜像循环
   * （按同一条缓动曲线算"现在到第几格"），用来换黑字和触发震动。
   */
  const glideTo = useCallback(
    (target: number, duration: number, easing: (t: number) => number) => {
      const from = offsetRef.current;
      if (Math.abs(target - from) < 0.5) {
        offsetRef.current = target;
        scrollY.setValue(target);
        syncIndex(target);
        commitRef.current(target);
        return;
      }

      stopAnim();

      const t0 = Date.now();
      const mirror = () => {
        const p = Math.min(1, (Date.now() - t0) / duration);
        const y = from + (target - from) * easing(p);
        // 同步维护位移真值：惯性中再次按住滚轮时，从这里接着拖
        offsetRef.current = y;
        syncIndex(y);
        if (p < 1) {
          rafRef.current = requestAnimationFrame(mirror);
        } else {
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(mirror);

      const anim = Animated.timing(scrollY, {
        toValue: target,
        duration,
        easing,
        useNativeDriver: true,
      });
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (!finished) return; // 被新手势接管，交给接管者收尾
        animRef.current = null;
        offsetRef.current = target;
        scrollY.setValue(target);
        syncIndex(target);
        commitRef.current(target);
      });
    },
    [scrollY, stopAnim, syncIndex],
  );

  /** 松手速度（px/ms）：取最近 90ms 样本的平均值，比"最后两帧相减"稳得多 */
  const readVelocity = useCallback(() => {
    const now = Date.now();
    const s = dragRef.current.samples;
    while (s.length && now - s[0].t > 90) s.shift();
    if (s.length < 2) return 0;
    // 抬手前手指停住了（超过 40ms 没动），就不该再有惯性
    if (now - s[s.length - 1].t > 40) return 0;
    const dt = s[s.length - 1].t - s[0].t;
    if (dt < 8) return 0;
    return (s[s.length - 1].y - s[0].y) / dt;
  }, []);

  /** 松手：按速度决定滚多远、滚多久 */
  const settle = useCallback(
    (rawOffset: number, velocity: number) => {
      const speed = Math.abs(velocity);
      const max = maxOffsetRef.current;

      if (speed < FLICK_MIN) {
        // 轻推：几乎不过格，短促吸附
        const target = Math.min(max, Math.max(0, Math.round(rawOffset / ITEM_H) * ITEM_H));
        glideTo(target, Math.min(300, 150 + Math.abs(target - rawOffset) * 1.8), Easing.out(Easing.cubic));
        return;
      }

      // 速度越快，衰减时间常数越大 → 滑得更远；再按"格"吸附成确定性终点
      const t = Math.min(1, speed / SPEED_REF);
      const tau = TAU_MIN + (TAU_MAX - TAU_MIN) * t;

      const travel = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, velocity * tau));
      const projected = rawOffset + travel;
      const target = Math.min(max, Math.max(0, Math.round(projected / ITEM_H) * ITEM_H));

      // 时长由"实际要走的距离 / 松手速度"决定：越快的甩动同距离耗时越短，
      // 起手速度跟手指基本一致，之后沿缓出曲线逐渐减速到 0
      const dist = Math.abs(target - rawOffset);
      // 只走一两格时不该慢悠悠地漂过去，按格数给一个上界，轻推才够"脆"
      const softMax = 200 + 62 * Math.round(dist / ITEM_H);
      const duration = Math.min(
        DUR_MAX,
        softMax,
        Math.max(DUR_MIN, (DUR_K * dist) / Math.max(speed, V_FLOOR)),
      );
      glideTo(target, duration, Easing.out(Easing.cubic));
    },
    [glideTo],
  );

  // 手势每次都读最新的回调，但 PanResponder 本身只创建一次，避免中途重建丢掉手势
  const apiRef = useRef({ stopAnim, syncIndex, settle, readVelocity, queueDrag, flushDrag });
  apiRef.current = { stopAnim, syncIndex, settle, readVelocity, queueDrag, flushDrag };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // 手指按在滚轮上时不让外层抢走
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          // 惯性中按住：先把位移对齐到当前视觉位置，再接着拖，不会跳回去
          apiRef.current.stopAnim();
          pendingY.current = offsetRef.current;
          scrollY.setValue(offsetRef.current);
          dragRef.current.start = offsetRef.current;
          dragRef.current.samples = [];
        },
        onPanResponderMove: (_e, g) => {
          const raw = dragRef.current.start - g.dy;
          const max = maxOffsetRef.current;
          // 两端之外加阻尼：越拉越费劲，松手弹回
          let y = raw;
          if (raw < 0) y = raw * RUBBER;
          else if (raw > max) y = max + (raw - max) * RUBBER;

          offsetRef.current = y;
          pendingY.current = y;
          apiRef.current.queueDrag();

          // 记录未加阻尼的位移，用于估算甩动速度。
          // 每 8ms 才采一次、且只留最近 24 个：长距离连续拖动时不会堆出成百上千个对象
          // （那些临时对象会造成 GC 暂停，表现就是"滑到一半数字卡住"）。
          const samples = dragRef.current.samples;
          const now = Date.now();
          if (!samples.length || now - samples[samples.length - 1].t >= 8) {
            samples.push({ t: now, y: raw });
            if (samples.length > 24) samples.shift();
          }
        },
        onPanResponderRelease: () => {
          apiRef.current.flushDrag();
          const v = Math.max(
            -V_MAX,
            Math.min(V_MAX, apiRef.current.readVelocity()),
          );
          apiRef.current.settle(offsetRef.current, v);
        },
        onPanResponderTerminate: () => {
          apiRef.current.flushDrag();
          apiRef.current.settle(offsetRef.current, 0);
        },
      }),
    [scrollY],
  );

  // 外部值变化（例如天数被收敛）时跟着滚过去
  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      placeAt(value);
    }
  }, [value, placeAt]);

  // 列数据长度变化（2 月天数变少）时等这一帧布局更新完再重新定位
  useEffect(() => {
    const id = requestAnimationFrame(() => placeAt(value));
    return () => cancelAnimationFrame(id);
    // 只在长度变化时触发，value 用当前闭包即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length]);

  // 实时值同步给父级（"确定"按钮直接读它，所以拖动中、惯性中都不会拿到旧值）
  useEffect(() => {
    if (liveRef) liveRef.current = center;
  }, [center, liveRef]);

  useEffect(() => stopAnim, [stopAnim]);

  return (
    <View style={{ flex, height: WHEEL_H, overflow: 'hidden' }} {...panResponder.panHandlers}>
      {/* 滚动层：整体上下平移，位移就是 -scrollY */}
      <Animated.View
        pointerEvents="none"
        style={{ paddingVertical: PAD, transform: [{ translateY }] }}
      >
        <WheelItems data={data} lo={win.lo} hi={win.hi} scrollY={scrollY} label={label} />
      </Animated.View>

      {/* 中央固定黑字：位置不动，只换数值 */}
      <CenterLabel text={label(center)} />
    </View>
  );
}

const styles = StyleSheet.create({
  item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 16, color: C.gray },

  // 中央固定黑字层：与选中框完全重合，不参与滚动
  centerLayer: {
    position: 'absolute',
    left: 0, right: 0,
    top: PAD,
    height: ITEM_H,
    alignItems: 'center', justifyContent: 'center',
  },
  centerText: { fontSize: 18, fontWeight: 'bold', color: C.text },
});
