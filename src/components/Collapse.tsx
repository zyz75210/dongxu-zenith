import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, StyleProp, StyleSheet, ViewStyle,
} from 'react-native';

/**
 * 折叠 / 展开容器：高度从 0 长到内容真实高度，里面的内容同时淡入并轻轻下滑，
 * 看起来就是"从胶囊里往下滑出来"。
 *
 * 为什么不用 LayoutAnimation：安卓 + 新架构下它偶发失效，而且会给整棵列表
 * 做一次全局重排；这里只动自己这一块的高度，范围可控。
 *
 * 高度用 p（0~1）× hh（像素）两个值相乘：
 * - p 是这一层自己的开合进度，负责"从 0 长出来"；
 * - hh 跟住内容最新高度，"按天折叠"在里面展开时，外层能平滑地跟着长高。
 *
 * 完全展开后会切到 free（高度交给布局自适应）：这很关键 ——
 * 否则里面每一天展开时，本层都会逐帧被重新测量、逐帧 setState，
 * 整个月份子树跟着重渲染，滚起来就会卡。
 */

const EASE = Easing.bezier(0.22, 0.7, 0.28, 1);
const OPEN_MS = 260;
const CLOSE_MS = 200;
const GROW_MS = 170;

type Props = {
  open: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export default function Collapse({ open, children, style }: Props) {
  const p = useRef(new Animated.Value(0)).current;
  const hh = useRef(new Animated.Value(0)).current;
  /** 最新量到的高度：走 ref 而不是 state，避免逐帧渲染 */
  const hRef = useRef(0);
  /** hh 当前对应的像素值，用来判断要不要补间（不读 Animated 私有 API） */
  const shown = useRef(0);
  const [ready, setReady] = useState(false);
  /** true = 完全展开，高度自适应（不再写死像素） */
  const [free, setFree] = useState(false);
  /** 上一次的 open 值 + 是否已经开过第一枪，用来避免"内容变高"时重复起动画 */
  const openRef = useRef(open);
  const started = useRef(false);

  /**
   * 懒挂载：没展开过就一个视图都不建。
   * 月份一多的时候，这一步能把历史页的视图数量压到个位数。
   */
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const onLayout = (e: { nativeEvent: { layout: { height: number } } }) => {
    const nh = Math.round(e.nativeEvent.layout.height);
    if (nh <= 0) return;
    hRef.current = nh;
    if (!ready) {
      // 第一次量到：先把像素高度填进去，再让 p 从 0 长到 1
      hh.setValue(nh);
      shown.current = nh;
      setReady(true);
      return;
    }
    // 自适应状态（布局自己跟）或已经收起：都不需要改像素高度
    if (free || !openRef.current) return;
    if (Math.abs(nh - shown.current) > 1) {
      shown.current = nh;
      Animated.timing(hh, {
        toValue: nh, duration: GROW_MS, easing: EASE, useNativeDriver: false,
      }).start();
    }
  };

  useEffect(() => {
    if (!mounted || !ready) return;
    // 只有 open 真的变了才播；内容高度变化交给 hh / 自适应去跟
    if (started.current && openRef.current === open) return;
    started.current = true;
    openRef.current = open;

    if (open) {
      setFree(false);
      hh.setValue(hRef.current);
      shown.current = hRef.current;
      Animated.timing(p, {
        toValue: 1,
        duration: OPEN_MS,
        easing: EASE,
        // 高度不是原生动画的属性，只好走 JS driver（转场很短，代价可控）
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) setFree(true);
      });
    } else {
      // 收起前把当前真实高度写死，否则从 auto 直接跳到 0 会有一帧闪动
      if (free) {
        hh.setValue(hRef.current);
        shown.current = hRef.current;
        setFree(false);
      }
      Animated.timing(p, {
        toValue: 0,
        duration: CLOSE_MS,
        easing: EASE,
        useNativeDriver: false,
      }).start();
    }
  }, [open, mounted, ready, p, hh, free]);

  const heightStyle = useMemo(
    () => ({ height: Animated.multiply(p, hh) }),
    [p, hh],
  );
  const innerStyle = useMemo(
    () => ({
      opacity: p,
      transform: [{
        translateY: p.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }),
      }],
    }),
    [p],
  );

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.clip, !free && heightStyle, style]}>
      <Animated.View onLayout={onLayout} style={innerStyle}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
