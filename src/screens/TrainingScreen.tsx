import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Svg, { Line } from 'react-native-svg';
import { MAX_MINUTES, MIN_MINUTES } from '../components/DurationPickerSheet';
import HeaderCircle from '../components/HeaderCircle';
import { C } from '../theme';

type MdiName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** 跳绳的四种跳法：目前只切换选中态，各自的动作库 / 计数逻辑后续接 */
const MODES = [
  { key: 'timer', label: '定时跳' },
  { key: 'count', label: '定数跳' },
  { key: 'trick', label: '花样跳' },
  { key: 'free', label: '自由跳' },
] as const;

/** 别的运动类型下，跳法胶囊先留四个空位，形状与跳绳那排完全一致（不让版式跳） */
const GHOST_PILLS = [0, 1, 2, 3];

/** 运动类型：跳绳默认选中（和设计图一致），另外两个是后续扩展口 */
const SPORTS: { key: string; label: string; icon: MdiName }[] = [
  { key: 'rope', label: '跳绳', icon: 'jump-rope' },
  { key: 'run', label: '户外跑步', icon: 'run-fast' },
  { key: 'bike', label: '户外骑行', icon: 'bike' },
];

// 时长的上下限只有一处定义（DurationPickerSheet），这里只做别名，避免两处数字走散
const MIN_DURATION = MIN_MINUTES;
const MAX_DURATION = MAX_MINUTES;
const STEP = 5;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * 卡片底纹：45° 的浅蓝虚线。
 * 用一张固定坐标系的大 SVG 铺满卡片再裁掉溢出部分 —— 不依赖 Pattern，
 * 也不用等 onLayout 拿尺寸，首帧就是对的。
 *
 * memo 是必需的：这 70 条线在父级每次重渲染时都会被重新 diff 一遍（props 没变，
 * 但元素是新建的），点开时长面板 / 弹提示都会连带跑一次，白占 JS 线程。
 */
const HATCH_SPAN = 820;
const HATCH_OFFSETS = Array.from({ length: 70 }, (_, i) => -HATCH_SPAN + i * 26);

const Hatch = memo(function Hatch() {
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
});

type Props = {
  /**
   * 打开时长面板。
   *
   * 面板不在本页渲染 —— 它和日历的年月日、日程的起止时间是同一套全屏浮层，
   * 由 App 在最外层托管。之前这里用 Modal 包着，安卓每次打开都要新建一个
   * Dialog 窗口，点下去到面板出现之间会明显顿一下。
   *
   * 传出去的第二个参数是「确定后怎么应用」：收敛到 5 分钟 ~ 12 小时、超界时提示，
   * 这些规则留在本页，浮层只管把滚轮上的时/分换算成分钟。
   */
  onEditDuration: (current: number, onPick: (total: number) => void) => void;
};

function TrainingScreen({ onEditDuration }: Props) {
  const { height } = useWindowDimensions();
  // 小屏（< 730dp）压一压字号与间距，保证整页在不需要滚动的前提下放得下
  const compact = height < 730;
  // 时间字号跟着屏高走：卡片是弹性高度，固定字号在大屏上会显得偏小
  const timeSize = compact ? 56 : Math.min(78, Math.round(height * 0.09));

  const [minutes, setMinutes] = useState(30);
  // 默认「定时跳」：这一版中间显示的就是目标时长，两处必须对得上
  const [mode, setMode] = useState<string>('timer');
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

  /** 滚轮确定的时长：按 5 ~ 720 分钟收敛。被夹住时说一句，避免"滚到别的数、结果变这样" */
  const applyDuration = (total: number) => {
    const clamped = Math.min(MAX_DURATION, Math.max(MIN_DURATION, total));
    setMinutes(clamped);
    if (clamped !== total) {
      showHint(`训练时长限 ${MIN_DURATION} 分钟 ~ ${MAX_DURATION / 60} 小时，已按边界设定`);
    }
  };

  const isRope = sport === 'rope';

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>训练</Text>
        {/* 只开训练页自己的设置，不跳别的页面 */}
        <HeaderCircle
          icon="ellipsis-horizontal"
          label="更多"
          style={styles.headAct}
          onPress={() => showHint('训练设置待接入')}
        />
      </View>

      {/* 目标时长卡片：整页不滚动，卡片吃满剩余高度 */}
      <View style={styles.hero}>
        <Hatch />

        <View style={styles.heroCenter}>
          {isRope ? (
            <>
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

              {/* 点数字 = 打开滚轮，和日历里改年月日是同一个面板 */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => onEditDuration(minutes, applyDuration)}
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
            </>
          ) : (
            // 跑步 / 骑行：中间的计时面板还没想清楚怎么记，先摆一句实话
            <Text style={styles.soonText}>功能还在开发</Text>
          )}
        </View>

        <View style={styles.modeRow}>
          {isRope
            ? MODES.map((m) => {
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
            })
            // 跑步 / 骑行暂时没有跳法：保留四个等宽空胶囊占位，后续按各自玩法填
            : GHOST_PILLS.map((k) => (
              <View key={k} style={[styles.modePill, styles.modePillGhost]} />
            ))}
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

      {/* 底部：音乐 / GO / 成绩 */}
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

        {/* 成绩：入口先接提示，之后从这里进「历史成绩」记录页 */}
        <TouchableOpacity
          style={styles.sidePill}
          activeOpacity={0.85}
          onPress={() => showHint('训练成绩记录待接入')}
        >
          <MaterialCommunityIcons name="trophy-outline" size={15} color={C.text} />
          <Text style={styles.sideText}>成绩</Text>
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
  headAct: { marginLeft: 'auto' },

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

  /** 跑步 / 骑行：中间的计时面板还没有方案，只放一句实话 */
  soonText: {
    fontSize: 17, color: '#93A1B6', fontWeight: '600', letterSpacing: 0.8,
  },

  modeRow: { flexDirection: 'row', gap: 7 },
  modePill: {
    flex: 1, height: 30, borderRadius: 15,
    backgroundColor: C.white,
    borderWidth: 1, borderColor: '#E4EBF8',
    alignItems: 'center', justifyContent: 'center',
  },
  modePillOn: { backgroundColor: C.primary, borderColor: C.primary },
  /** 空占位：只留胶囊形状，不写文字、不可点，等各自的玩法定下来再填 */
  modePillGhost: { backgroundColor: 'rgba(255,255,255,0.55)', borderColor: '#E7EDF8' },
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

/**
 * memo：这一页在 tab 舞台上常驻，父级（App）任何状态变化都会让它重渲染 ——
 * 弹一次轻提示、开关时长面板、量到导航栏高度，全都会。它的 props 只有 onEditDuration，
 * 是 App 里 useCallback 固定住的，所以整页可以整块跳过。
 */
export default memo(TrainingScreen);
