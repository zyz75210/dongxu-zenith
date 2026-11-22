import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Svg, { Line } from 'react-native-svg';
import { C } from '../theme';

type MdiName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** 四个跳法：当前只是选中态，各自的动作库后续接 */
const MODES = [
  { key: 'free', label: '自由跳' },
  { key: 'course', label: '课程跳' },
  { key: 'ropefree', label: '无绳跳' },
  { key: 'newbie', label: '新手跳' },
] as const;

/** 运动类型：跳绳默认选中（和设计图一致），另外两个是后续扩展口 */
const SPORTS: { key: string; label: string; icon: MdiName }[] = [
  { key: 'rope', label: '跳绳', icon: 'jump-rope' },
  { key: 'run', label: '户外跑步', icon: 'run-fast' },
  { key: 'bike', label: '户外骑行', icon: 'bike' },
];

const MIN_DURATION = 5;
const MAX_DURATION = 180;
const STEP = 5;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * 卡片底纹：45° 的浅蓝虚线。
 * 用一张固定坐标系的大 SVG 铺满卡片再裁掉溢出部分 —— 不依赖 Pattern，
 * 也不用等 onLayout 拿尺寸，首帧就是对的。
 */
const HATCH_SPAN = 820;
const HATCH_OFFSETS = Array.from({ length: 70 }, (_, i) => -HATCH_SPAN + i * 26);

function Hatch() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      {HATCH_OFFSETS.map((x) => (
        <Line
          key={x}
          x1={x}
          y1={0}
          x2={x + HATCH_SPAN}
          y2={HATCH_SPAN}
          stroke="#DFE8F8"
          strokeWidth={1.1}
          strokeDasharray="5 9"
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}

export default function TrainingScreen() {
  const { height } = useWindowDimensions();
  // 小屏（< 730dp）压一压字号与间距，保证整页在不需要滚动的前提下放得下
  const compact = height < 730;
  // 时间字号跟着屏高走：卡片是弹性高度，固定字号在大屏上会显得偏小
  const timeSize = compact ? 56 : Math.min(78, Math.round(height * 0.09));

  const [minutes, setMinutes] = useState(30);
  const [mode, setMode] = useState<string>('free');
  const [sport, setSport] = useState<string>('rope');

  /**
   * 轻提示：所有「还没接功能」的入口都走这里，点了有反馈、不装作能用。
   * 每条后续接入真实功能时，把 showHint 换成对应的跳转 / 弹层即可。
   */
  const [hint, setHint] = useState<string | null>(null);
  const hintOpacity = useRef(new Animated.Value(0)).current;
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = useCallback((text: string) => {
    setHint(text);
    hintOpacity.stopAnimation();
    hintOpacity.setValue(0);
    Animated.timing(hintOpacity, {
      toValue: 1, duration: 140, useNativeDriver: true,
    }).start();
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      Animated.timing(hintOpacity, {
        toValue: 0, duration: 260, useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setHint(null); });
    }, 1600);
  }, [hintOpacity]);

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const changeMinutes = (delta: number) => {
    setMinutes((m) => {
      const next = m + delta;
      if (next < MIN_DURATION || next > MAX_DURATION) return m;
      return next;
    });
  };

  const timeText = `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>训练</Text>
        <TouchableOpacity
          style={styles.circle}
          activeOpacity={0.7}
          onPress={() => showHint('训练设置待接入')}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* 目标时长卡片：整页不滚动，卡片吃满剩余高度 */}
      <View style={styles.hero}>
        <Hatch />

        <View style={styles.heroCenter}>
          <View style={styles.targetRow}>
            <TouchableOpacity
              style={styles.chevron}
              activeOpacity={0.7}
              onPress={() => changeMinutes(-STEP)}
            >
              <Ionicons name="chevron-back" size={13} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.targetLabel}>目标时长</Text>
            <TouchableOpacity
              style={styles.chevron}
              activeOpacity={0.7}
              onPress={() => changeMinutes(STEP)}
            >
              <Ionicons name="chevron-forward" size={13} color={C.text} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => showHint('自定义时长（时:分）设置待接入')}
          >
            <Text
              style={[
                styles.time,
                { fontSize: timeSize, lineHeight: Math.round(timeSize * 1.16) },
              ]}
            >
              {timeText}
            </Text>
            <Text style={styles.timeHint}>点击设定（时:分）</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modeRow}>
          {MODES.map((m) => {
            const on = m.key === mode;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.modePill, on && styles.modePillOn]}
                activeOpacity={0.85}
                onPress={() => {
                  setMode(m.key);
                  if (!on) showHint(`已切换到${m.label} · 动作库待接入`);
                }}
              >
                <Text style={[styles.modeText, on && styles.modeTextOn]} numberOfLines={1}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 运动类型：竖排「更多运动」+ 三张卡 */}
      <View style={[styles.sportRow, compact && styles.sportRowCompact]}>
        <TouchableOpacity
          style={styles.moreCard}
          activeOpacity={0.7}
          onPress={() => showHint('更多运动类型待接入')}
        >
          <Text style={styles.moreText}>更多</Text>
          <Text style={styles.moreText}>运动</Text>
        </TouchableOpacity>

        {SPORTS.map((s) => {
          const on = s.key === sport;
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.sportCard, on && styles.sportCardOn]}
              activeOpacity={0.85}
              onPress={() => {
                setSport(s.key);
                if (!on) showHint(`已选择${s.label} · 数据记录待接入`);
              }}
            >
              <MaterialCommunityIcons
                name={s.icon}
                size={compact ? 20 : 23}
                color={on ? C.primary : C.text}
              />
              <Text style={[styles.sportLabel, on && styles.sportLabelOn]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 底部：音乐 / GO / 相机 */}
      <View style={[styles.actionRow, compact && styles.actionRowCompact]}>
        <TouchableOpacity
          style={styles.sidePill}
          activeOpacity={0.85}
          onPress={() => showHint('训练音乐播放待接入')}
        >
          <MaterialCommunityIcons name="music-note" size={15} color={C.text} />
          <Text style={styles.sideText}>音乐</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.go, compact && styles.goCompact]}
          activeOpacity={0.9}
          onPress={() => showHint('开始训练：倒计时与结果记录待接入')}
        >
          <Text style={[styles.goText, compact && { fontSize: 22 }]}>GO</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.sidePill}
          activeOpacity={0.85}
          onPress={() => showHint('训练拍照记录待接入')}
        >
          <MaterialCommunityIcons name="camera-outline" size={15} color={C.text} />
          <Text style={styles.sideText}>相机</Text>
        </TouchableOpacity>
      </View>

      {hint !== null && (
        <Animated.View style={[styles.hintWrap, { opacity: hintOpacity }]} pointerEvents="none">
          <View style={styles.hintPill}>
            <Text style={styles.hintText}>{hint}</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
  },

  header: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 14, paddingTop: 4,
  },
  title: { fontSize: 22, fontWeight: 'bold', color: C.text, letterSpacing: 0.3 },
  circle: {
    marginLeft: 'auto',
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },

  hero: {
    flex: 1,
    minHeight: 234,
    borderRadius: 22,
    backgroundColor: '#F1F5FD',
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 14,
    overflow: 'hidden',
  },
  heroCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  chevron: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1B2A4A', shadowOpacity: 0.10, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  targetLabel: { fontSize: 12, color: C.text },

  time: {
    fontWeight: '700', color: C.text,
    letterSpacing: 1, fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  timeHint: { fontSize: 10.5, color: C.gray, textAlign: 'center', marginTop: 2 },

  modeRow: { flexDirection: 'row', gap: 7 },
  modePill: {
    flex: 1, height: 30, borderRadius: 15,
    backgroundColor: C.white,
    borderWidth: 1, borderColor: '#E4EBF8',
    alignItems: 'center', justifyContent: 'center',
  },
  modePillOn: { backgroundColor: C.primary, borderColor: C.primary },
  modeText: { fontSize: 11, color: '#5C6577' },
  modeTextOn: { color: C.white, fontWeight: 'bold' },

  sportRow: { flexDirection: 'row', gap: 8, marginTop: 14, height: 86 },
  sportRowCompact: { height: 74, marginTop: 10 },
  moreCard: {
    width: 26, borderRadius: 12,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  moreText: { fontSize: 9, color: C.gray, lineHeight: 11 },

  sportCard: {
    flex: 1, borderRadius: 16,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center',
  },
  sportCardOn: { backgroundColor: '#EEF4FF', borderColor: '#BBD3FF' },
  sportLabel: { fontSize: 11, color: C.text, marginTop: 6 },
  sportLabelOn: { color: C.primary, fontWeight: 'bold' },

  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 108, paddingHorizontal: 6,
  },
  actionRowCompact: { height: 94 },
  sidePill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    width: 90, height: 40, borderRadius: 20, backgroundColor: C.cardSoft,
  },
  sideText: { fontSize: 12, color: C.text },

  go: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.45, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  goCompact: { width: 82, height: 82, borderRadius: 41 },
  goText: { fontSize: 26, fontWeight: '700', color: C.white, letterSpacing: 1.5 },

  hintWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 6,
    alignItems: 'center',
  },
  hintPill: {
    maxWidth: '92%',
    backgroundColor: 'rgba(32,36,49,0.90)',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  hintText: { fontSize: 11, color: C.white, lineHeight: 16 },
});
