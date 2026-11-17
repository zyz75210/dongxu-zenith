import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, StyleSheet, Text, TouchableOpacity, View,
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

const BOX = 34;          // 选中态圆的直径（和原来的 iconBox 一致）
const PAINT_DELAY = 150; // 滑块走到位后再让图标变白，避免白图标浮在白底上

function BottomNav({ active, onChange }: Props) {
  const activeIdx = Math.max(0, TABS.findIndex((t) => t.key === active));

  /** 每个 item / 图标相对父级的位置，用来算出滑块该停在哪 */
  const itemPos = useRef<{ x: number; y: number }[]>([]);
  const iconPos = useRef<{ x: number; y: number }[]>([]);

  const tx = useRef(new Animated.Value(0)).current;      // 横向位置
  const wobble = useRef(new Animated.Value(0)).current;  // 0=圆 1=被拉长
  const [top, setTop] = useState(0);
  const [ready, setReady] = useState(false);
  const placed = useRef(false);

  /**
   * 已经变白的下标。
   * 注意不要用"先置 null 再置新值"的写法 —— 那会多出一次整条导航的重渲染，
   * 正好落在滑块起步的那几帧。这里只记"哪一项的白已经画上去"，
   * 图标是否白 = 它既是当前项、又已经画过：切走的那一项当帧就变灰，天然正确。
   */
  const [paintedIdx, setPaintedIdx] = useState(activeIdx);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    // 新图标等滑块快到位再变白，避免白图标浮在白底上
    const t = setTimeout(() => setPaintedIdx(activeIdx), PAINT_DELAY);
    return () => clearTimeout(t);
  }, [activeIdx]);

  const spotOf = (i: number) => {
    const a = itemPos.current[i];
    const b = iconPos.current[i];
    return a && b ? { x: a.x + b.x, y: a.y + b.y } : null;
  };

  // 首次布局完成：把滑块直接摆到当前选中项，不播动画
  const placeIfNeeded = (i: number) => {
    if (placed.current || i !== activeIdx) return;
    const s = spotOf(i);
    if (!s) return;
    placed.current = true;
    setTop(s.y);
    tx.setValue(s.x);
    setReady(true);
  };

  // 切换 tab：位移用弹簧，同时把圆横向拉长再收回来（液体感）
  const firstAnim = useRef(true);
  useEffect(() => {
    // 首次挂载只是"摆位"，不该有拉伸动作
    if (firstAnim.current) {
      firstAnim.current = false;
      return;
    }
    const s = spotOf(activeIdx);
    if (!s || !placed.current) return;
    setTop(s.y);
    Animated.parallel([
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
    ]).start();
  }, [activeIdx, tx, wobble]);

  const scaleX = wobble.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const scaleY = wobble.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });

  return (
    <View style={styles.bar}>
      {/* 液态滑块：垫在图标下面，只做 transform，跑在 native 线程上 */}
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

      {TABS.map((t, i) => (
        <TouchableOpacity
          key={t.key}
          style={styles.item}
          onPress={() => onChange(t.key)}
          activeOpacity={0.7}
          onLayout={(e) => {
            const { x, y } = e.nativeEvent.layout;
            itemPos.current[i] = { x, y };
            placeIfNeeded(i);
          }}
        >
          <View
            style={styles.iconBox}
            onLayout={(e) => {
              const { x, y } = e.nativeEvent.layout;
              iconPos.current[i] = { x, y };
              placeIfNeeded(i);
            }}
          >
            <Ionicons
              name={t.icon as any}
              size={20}
              color={i === activeIdx && i === paintedIdx ? C.white : C.gray}
            />
          </View>
          <Text style={[styles.label, i === activeIdx && styles.labelOn]} numberOfLines={1}>
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: C.bg,
    flexShrink: 0,
  },
  // 选中态的深色圆：现在由这一层统一承担，在项目之间移动
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
    flexShrink: 0, overflow: 'hidden',
  },
  label: { fontSize: 11, color: C.gray, marginTop: 3 },
  labelOn: { color: C.text, fontWeight: '500' },
});

// tab 没变时不必跟着 App 重渲染（内部有测量与动画状态，能省则省）
export default memo(BottomNav);
