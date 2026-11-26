import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Svg, { Line } from 'react-native-svg';
import { MAX_SECONDS, MIN_SECONDS } from '../components/DurationPickerSheet';
import HeaderCircle from '../components/HeaderCircle';
import { C } from '../theme';
import { JUMP_STYLES, type JumpStyle } from '../jumpStyle';
import {
  durationWord, MAX_COUNT, MIN_COUNT, MODE_WORD, STANDARD, type JumpMode,
} from '../workout';
import { DEFAULT_VOICE, type VoiceMode } from '../audio';
import type { Schedule } from '../data';

type MdiName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** 跳绳的四种跳法。定时跳 / 定数跳已可用；花样跳 / 自由跳待开发，点了只给提示 */
const MODES = [
  { key: 'timer', label: '定时跳' },
  { key: 'count', label: '定数跳' },
  { key: 'trick', label: '花样跳' },
  { key: 'free', label: '自由跳' },
] as const;

/** 已经能用的模式：用来判断切换模式时要不要拦一下 */
const READY_MODES: string[] = ['timer', 'count'];

/** 别的运动类型下，跳法胶囊先留四个空位，形状与跳绳那排完全一致（不让版式跳） */
const GHOST_PILLS = [0, 1, 2, 3];

/** 运动类型：跳绳默认选中（和设计图一致），另外两个是后续扩展口 */
const SPORTS: { key: string; label: string; icon: MdiName }[] = [
  { key: 'rope', label: '跳绳', icon: 'jump-rope' },
  { key: 'run', label: '户外跑步', icon: 'run-fast' },
  { key: 'bike', label: '户外骑行', icon: 'bike' },
];

// 时长的上下限只有一处定义（DurationPickerSheet），这里只做别名，避免两处数字走散
const MIN_DURATION = MIN_SECONDS;
const MAX_DURATION = MAX_SECONDS;
/**
 * 上下箭头的步进：30 秒。
 * 原来是 5 分钟 —— 那会儿时长是"时/分"刻度，跳绳根本用不上。
 * 现在最常见的是 30 秒 / 1 分钟 / 3 分钟，30 秒一格按起来最顺手；
 * 要精确到秒就直接点数字开滚轮。
 */
const STEP = 30;

/**
 * 定数跳的目标个数。
 * 步进 50 而不是 1：一个人不会想要「跳 502 个」，整十整百才是真实的报数方式。
 * 上限 10000：给「一天跳一万个」这种高强度目标留出空间，再往上就不现实了。
 */
const COUNT_STEP = 50;

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
   * 是否在前台（当前选中的 tab 是不是「训练」）。
   *
   * 用途：训练页是常驻挂载的（切 tab 只 display:none，不卸载），
   * 所以 state 会一直留着。用这个标志在「离开又回来」时把目标重置成默认档；
   * 页内的跳法切换（并脚↔换脚）不算离开，不重置。
   */
  active: boolean;
  /**
   * 打开时长面板。
   *
   * 面板不在本页渲染 —— 它和日历的年月日、日程的起止时间是同一套全屏浮层，
   * 由 App 在最外层托管。之前这里用 Modal 包着，安卓每次打开都要新建一个
   * Dialog 窗口，点下去到面板出现之间会明显顿一下。
   *
   * 传出去的第二个参数是「确定后怎么应用」：收敛到 1 秒 ~ 60 分钟、超界时提示，
   * 这些规则留在本页，浮层只管把滚轮上的分/秒换算成总秒数。
   */
  onEditDuration: (current: number, onPick: (total: number) => void) => void;
  /**
   * 点 GO：进全屏计数页。
   * 除了跳法，还要带上「训练项目」和「目标」—— 计数页靠它们决定
   * 是倒数计时、还是数够了自动收尾。
   */
  onStartJump: (payload: {
    style: JumpStyle; mode: JumpMode; target: number; voice: VoiceMode;
  }) => void;
  /** 打开成绩页（训练页底部「成绩」和右上角三点的「历史成绩」共用一个入口） */
  onOpenWorkouts: () => void;
  /** 今天还没完成的跳绳计划：顶上那条胶囊带 */
  todayPlans: Schedule[];
  /** 点计划胶囊：直接把这条计划的目标带进计数页 */
  onOpenPlan: (plan: Schedule) => void;
};

function TrainingScreen({
  active, onEditDuration, onStartJump, onOpenWorkouts, todayPlans, onOpenPlan,
}: Props) {
  const { height } = useWindowDimensions();
  // 小屏（< 730dp）压一压字号与间距，保证整页在不需要滚动的前提下放得下
  const compact = height < 730;
  // 时间字号跟着屏高走：卡片是弹性高度，固定字号在大屏上会显得偏小
  const timeSize = compact ? 56 : Math.min(78, Math.round(height * 0.09));

  /**
   * 定时跳的目标时长（秒）。
   * 默认值按跳法区分：并脚跳 60 秒、换脚跳 30 秒（见 STANDARD）。
   * 初始就是并脚跳的默认值。
   */
  const [seconds, setSeconds] = useState(STANDARD.together.timerTarget);
  /**
   * 定数跳的目标个数。
   * 默认值按跳法区分：并脚跳 300 个、换脚跳 200 个。
   */
  const [count, setCount] = useState(STANDARD.together.countTarget);
  /**
   * 个数输入小窗。
   * 为什么不用 Modal：安卓每次 open 都要新建一个 Dialog 窗口，
   * 点下去到窗口出现之间会有明显一顿（时长面板当初就是因此改成 App 托管的）。
   * 这里只是一张居中卡，用绝对定位的覆盖层就够，不起原生窗口。
   */
  const [countEditing, setCountEditing] = useState(false);
  /** 右上角三点的菜单 */
  const [menuOpen, setMenuOpen] = useState(false);
  const [countDraft, setCountDraft] = useState(String(STANDARD.together.countTarget));
  // 默认「定时跳」：这一版中间显示的就是目标时长，两处必须对得上
  const [mode, setMode] = useState<string>('timer');
  /** 跳法：并脚跳 / 换脚跳。计数页靠它决定用哪套判据 */
  const [jumpStyle, setJumpStyle] = useState<JumpStyle>('together');
  const [sport, setSport] = useState<string>('rope');
  /** 播报模式：比赛语音 / 亲切语音。默认比赛语音 */
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(DEFAULT_VOICE);

  /**
   * 离开训练页再回来时，把目标重置回「当前跳法的默认档」。
   *
   * 只在这两种情形重置：
   *   1. 切到别的 tab（日历/星球/内容/积累）再切回训练 tab；
   *   2. 首次进入训练 tab（prev 是 undefined，也归为"回来了"）。
   * 页内的跳法切换（并脚↔换脚）不走这里 —— 那是 setJumpStyle 自己的逻辑，
   * 会保留用户编辑过的目标，不做重置。
   */
  const prevActive = useRef<boolean | undefined>(undefined);
  const jumpStyleRef = useRef<JumpStyle>(jumpStyle);
  jumpStyleRef.current = jumpStyle;
  useEffect(() => {
    const was = prevActive.current;
    prevActive.current = active;
    // 只在「从非前台 → 前台」这个沿上重置；一开始就是 undefined → true 也算
    if (active && was !== true) {
      const std = STANDARD[jumpStyleRef.current];
      setSeconds(std.timerTarget);
      setCount(std.countTarget);
      setCountDraft(String(std.countTarget));
    }
  }, [active]);

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

  const changeSeconds = (delta: number) => {
    setSeconds((v) => {
      const next = v + delta;
      if (next < MIN_DURATION || next > MAX_DURATION) return v;
      return next;
    });
  };

  /** 个数用箭头调，到边界就停住（和时长一个行为，不弹解释） */
  const changeCount = (delta: number) => {
    setCount((c) => {
      const next = c + delta;
      if (next < MIN_COUNT || next > MAX_COUNT) return c;
      return next;
    });
  };

  const openCountEditor = () => {
    setCountDraft(String(count));
    setCountEditing(true);
  };

  /**
   * 确认输入的个数：只收整数，越界按边界夹住**并说明**。
   * 不静默改数字 —— 输了 5000 却变成 3000 还不吭声，比直接拒绝更让人困惑。
   */
  const applyCountDraft = () => {
    const raw = countDraft.replace(/[^0-9]/g, '');
    if (raw === '') {
      showHint(`请输入 ${MIN_COUNT} ~ ${MAX_COUNT} 之间的个数`);
      return;
    }
    const n = Number.parseInt(raw, 10);
    const clamped = Math.min(MAX_COUNT, Math.max(MIN_COUNT, n));
    setCount(clamped);
    setCountEditing(false);
    Keyboard.dismiss();
    if (clamped !== n) {
      showHint(`个数限 ${MIN_COUNT} ~ ${MAX_COUNT}，已按 ${clamped} 设定`);
    }
  };

  const cancelCountEditor = () => {
    setCountEditing(false);
    Keyboard.dismiss();
  };

  // 分:秒 —— 30 分钟显示成 30:00，1 分 30 秒显示成 01:30
  const timeText = `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;

  /** 滚轮确定的时长：按 1 秒 ~ 60 分钟收敛。被夹住时说一句，避免"滚到别的数、结果变这样" */
  const applyDuration = (totalSeconds: number) => {
    const clamped = Math.min(MAX_DURATION, Math.max(MIN_DURATION, totalSeconds));
    setSeconds(clamped);
    if (clamped !== totalSeconds) {
      showHint('训练时长限 1 秒 ~ 60 分钟，已按边界设定');
    }
  };

  const isRope = sport === 'rope';

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {/*
          标题和小提示放在同一个 row 里、按「基线」对齐。
          用法和外文排版一样：小字坐在大字的基线上，底部自然齐平。
          之前把两者分开摆、靠容器高度硬凑，怎么调都会差一两像素。
        */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>训练</Text>

          {/*
            只在今天真的有安排时出现 —— 没计划还喊"点胶囊"，
            等于指着一个不存在的按钮。箭头指下方，省掉"哪个胶囊"的解释。
          */}
          {todayPlans.length > 0 && (
            <Text style={styles.titleTip} numberOfLines={1}>↓ 别翻日历了，胶囊点一下</Text>
          )}
        </View>

        {/* 只开训练页自己的设置，不跳别的页面 */}
        <HeaderCircle
          icon="ellipsis-horizontal"
          label="更多"
          style={styles.headAct}
          onPress={() => setMenuOpen(true)}
        />
      </View>

      {/*
        今日跳绳计划：有几个排几个，横向滑动。
        放在 header 下面、大卡片上面 —— 这个位置是"今天要做什么"，
        和下面"现在怎么练"是两件事，自上而下正好是「安排 → 执行」的读法。
        只有跳绳才显示：跑步 / 骑行的计划不在这一版的训练范围里，
        摆出来只会点不动。
      */}
      {isRope && todayPlans.length > 0 && (
        <View style={styles.planRow}>
          <Text style={styles.planLabel}>今日</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.planList}
          >
            {todayPlans.map((p) => {
              const m = p.ropeMode ?? 'timer';
              const ready = m === 'timer' || m === 'count';
              const target = p.ropeTarget
                ? (m === 'timer' ? durationWord(p.ropeTarget) : `${p.ropeTarget} 个`)
                : '';
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.planPill,
                    !ready && styles.planPillOff,
                    p.completed && styles.planPillDone,
                  ]}
                  activeOpacity={ready ? 0.8 : 1}
                  disabled={!ready}
                  onPress={() => onOpenPlan(p)}
                >
                  <Text style={styles.planTime}>{p.start}</Text>
                  {/*
                    跳法放在时间后面、训练内容前面。
                    顺序就是阅读顺序：几点 → 怎么跳 → 练什么、练多少。
                    老数据没存 jumpStyle 时按并脚跳显示（和计数页的兜底一致）。
                  */}
                  <Text style={styles.planStyle}>
                    {p.jumpStyle === 'alternate' ? '换脚跳' : '并脚跳'}
                  </Text>
                  <Text style={styles.planMode} numberOfLines={1}>
                    {MODE_WORD[m]}{target ? ` ${target}` : ''}
                  </Text>
                  {p.completed && (
                    <Ionicons name="checkmark" size={11} color={C.done} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 目标时长卡片：整页不滚动，卡片吃满剩余高度 */}
      <View style={styles.hero}>
        <Hatch />

        <View style={styles.heroCenter}>
          {isRope ? (
            mode === 'count' ? (
              /* 定数跳：同一张卡片换成「目标个数」。
                 个数没有合适的滚轮（时分面板是时间单位），所以只用两侧箭头调；
                 数字本身不做成可点的 —— 点了没东西可弹，比不能点更让人困惑。 */
              <>
                <View style={styles.targetRow}>
                  <TouchableOpacity
                    style={styles.chevron}
                    activeOpacity={0.7}
                    onPress={() => changeCount(-COUNT_STEP)}
                  >
                    <Ionicons name="chevron-back" size={13} color={C.text} />
                  </TouchableOpacity>
                  <Text style={styles.targetLabel}>目标个数</Text>
                  <TouchableOpacity
                    style={styles.chevron}
                    activeOpacity={0.7}
                    onPress={() => changeCount(COUNT_STEP)}
                  >
                    <Ionicons name="chevron-forward" size={13} color={C.text} />
                  </TouchableOpacity>
                </View>

                {/* 点数字 = 直接敲一个数（箭头只适合微调，输 800 要按 6 次太笨） */}
                <TouchableOpacity activeOpacity={0.85} onPress={openCountEditor}>
                  <Text
                    style={[
                      styles.time,
                      { fontSize: timeSize, lineHeight: Math.round(timeSize * 1.16) },
                    ]}
                  >
                    {count}
                  </Text>
                  <Text style={styles.timeHint}>点击可直接输入，或用两侧箭头调</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.targetRow}>
                  <TouchableOpacity
                    style={styles.chevron}
                    activeOpacity={0.7}
                    onPress={() => changeSeconds(-STEP)}
                  >
                    <Ionicons name="chevron-back" size={13} color={C.text} />
                  </TouchableOpacity>
                  <Text style={styles.targetLabel}>目标时长</Text>
                  <TouchableOpacity
                    style={styles.chevron}
                    activeOpacity={0.7}
                    onPress={() => changeSeconds(STEP)}
                  >
                    <Ionicons name="chevron-forward" size={13} color={C.text} />
                  </TouchableOpacity>
                </View>

                {/* 点数字 = 打开滚轮，和日历里改年月日是同一个面板 */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => onEditDuration(seconds, applyDuration)}
                >
                  <Text
                    style={[
                      styles.time,
                      { fontSize: timeSize, lineHeight: Math.round(timeSize * 1.16) },
                    ]}
                  >
                    {timeText}
                  </Text>
                  <Text style={styles.timeHint}>点击设定（分:秒）</Text>
                </TouchableOpacity>
              </>
            )
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
                    // 花样跳 / 自由跳还没做：不切过去，只如实说一句。
                    // 切过去却什么都不变，比点了没反应更让人以为坏了。
                    if (!READY_MODES.includes(m.key)) {
                      showHint(`${m.label}还在开发，敬请期待`);
                      return;
                    }
                    setMode(m.key);
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

      {/*
        跳法切换 + AI 标签，合成一行。
        只有定时跳 / 定数跳会出现（这两种才进真正的计数页，也才有 AI 评分）。
        放在卡片外面、运动选择上面 —— 卡片是 flex:1 的弹性高度，
        在卡片里塞一行会把大数字挤小。
      */}
      {(isRope && (mode === 'timer' || mode === 'count')) && (
        <View style={styles.styleRow}>
          <View style={styles.styleSegWrap}>
            <Text style={styles.styleSegLabel}>跳法</Text>
            <View style={styles.styleSeg}>
              {JUMP_STYLES.map((m) => {
                const on = m.key === jumpStyle;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[styles.styleSegItem, on && styles.styleSegItemOn]}
                    activeOpacity={0.85}
                    onPress={() => {
                      // 切跳法时，目标也跟着切到新跳法的默认档
                      // （并脚跳 60 秒/300 个，换脚跳 30 秒/200 个）。
                      setJumpStyle(m.key);
                      const std = STANDARD[m.key];
                      setSeconds(std.timerTarget);
                      setCount(std.countTarget);
                      setCountDraft(String(std.countTarget));
                    }}
                  >
                    <Text style={[styles.styleSegText, on && styles.styleSegTextOn]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 示范视频入口：先留位，点开只给一句「待接入」，视频后续补 */}
            <TouchableOpacity
              style={styles.demoBtn}
              activeOpacity={0.8}
              onPress={() => showHint('示范视频待接入')}
            >
              <Ionicons name="play-circle-outline" size={14} color={C.sub} />
              <Text style={styles.demoText} numberOfLines={1}>示范</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.aiChip}>
            <Ionicons name="sparkles" size={12} color={C.ai} />
            <Text style={styles.aiChipText} numberOfLines={1}>AI 动作分析</Text>
          </View>
        </View>
      )}

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
                // 跳绳已经能记成绩了，不用再弹「待接入」；
                // 跑步 / 骑行还没做，选了只给一句实话
                if (!on && s.key !== 'rope') showHint(`${s.label}还在开发，敬请期待`);
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

      {/* 底部：播报切换 / GO / 成绩 */}
      <View style={[styles.actionRow, compact && styles.actionRowCompact]}>
        {/*
          播报模式切换：比赛语音（MP3 裁判口令）/ 亲切语音（TTS 3-2-1）。
          点一下在两种之间切，图标和文案跟着变。
          「音乐」的半屏弹窗后续再开发，这里先只做切换。
        */}
        <TouchableOpacity
          style={styles.sidePill}
          activeOpacity={0.85}
          onPress={() => {
            const next: VoiceMode = voiceMode === 'race' ? 'soft' : 'race';
            setVoiceMode(next);
            showHint(next === 'race' ? '已切换：比赛语音播报' : '已切换：亲切语音播报');
          }}
        >
          <MaterialCommunityIcons
            name={voiceMode === 'race' ? 'whistle-outline' : 'message-text-outline'}
            size={15}
            color={C.text}
          />
          <Text style={styles.sideText} numberOfLines={1}>
            {voiceMode === 'race' ? '比赛' : '亲切'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.go, compact && styles.goCompact]}
          activeOpacity={0.9}
          onPress={() => {
            // 只有跳绳进了计数页；跑步 / 骑行还没做，照实说
            if (!isRope) {
              showHint('这个运动还在开发，敬请期待');
              return;
            }
            // 花样跳 / 自由跳还没有计数逻辑，别让人进去了才发现跳不了
            if (!READY_MODES.includes(mode)) {
              const m = MODES.find((x) => x.key === mode);
              showHint(`${m?.label ?? '这个模式'}还在开发，敬请期待`);
              return;
            }
            onStartJump({
              style: jumpStyle,
              mode: mode as JumpMode,
              // 定时跳传秒数、定数跳传个数 —— 计数页只认一种「目标数字」
              target: mode === 'timer' ? seconds : count,
              voice: voiceMode,
            });
          }}
        >
          <Text style={[styles.goText, compact && { fontSize: 22 }]}>GO</Text>
        </TouchableOpacity>

        {/* 成绩：进成绩页（和右上角三点的「历史成绩」是同一个页面） */}
        <TouchableOpacity
          style={styles.sidePill}
          activeOpacity={0.85}
          onPress={onOpenWorkouts}
        >
          <MaterialCommunityIcons name="trophy-outline" size={15} color={C.text} />
          <Text style={styles.sideText}>成绩</Text>
        </TouchableOpacity>
      </View>

      {/*
        个数输入小窗。
        负边距是补 screen 自己的 padding（左右 20 / 上 8 / 下 6）；
        不补的话遮罩会缩在内容区里，四周露出白条。
      */}
      {countEditing && (
        <View style={styles.countMask}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={cancelCountEditor}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.countDialogWrap}
            pointerEvents="box-none"
          >
            <View style={styles.countDialog}>
              <Text style={styles.countDialogTitle}>目标个数</Text>
              <TextInput
                style={styles.countInput}
                value={countDraft}
                onChangeText={(t) => setCountDraft(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={5}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={applyCountDraft}
                placeholder="500"
                placeholderTextColor="#C4C9D2"
              />
              <Text style={styles.countRange}>{MIN_COUNT} – {MAX_COUNT} 个</Text>
              <View style={styles.countBtnRow}>
                <TouchableOpacity
                  style={styles.countBtn}
                  activeOpacity={0.8}
                  onPress={cancelCountEditor}
                >
                  <Text style={styles.countBtnText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.countBtn, styles.countBtnMain]}
                  activeOpacity={0.85}
                  onPress={applyCountDraft}
                >
                  <Text style={[styles.countBtnText, styles.countBtnMainText]}>确定</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}

      {/*
        右上角三点的菜单。
        只放和训练页本身相关的两项 —— 历史成绩（进成绩页）和训练设置（待接入）。
        按既定规矩：这里的按钮只服务本页，不跨页改别处的数据。
      */}
      {menuOpen && (
        <View style={styles.countMask}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setMenuOpen(false)}
          />
          <View style={styles.menuWrap} pointerEvents="box-none">
            <View style={styles.menuCard}>
              <TouchableOpacity
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  onOpenWorkouts();
                }}
              >
                <MaterialCommunityIcons name="trophy-outline" size={17} color={C.text} />
                <Text style={styles.menuText}>历史成绩</Text>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  showHint('训练设置待接入');
                }}
              >
                <Ionicons name="settings-outline" size={17} color={C.text} />
                <Text style={styles.menuText}>训练设置</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

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

  /* 今日计划：一条横滑胶囊带，高度按最小可读尺寸给，尽量不吃 hero 的空间 */
  planRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 1, marginBottom: 8,
  },
  planLabel: { fontSize: 11, color: C.sub },
  planList: { gap: 6, paddingRight: 4, alignItems: 'center' },
  planPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 26, paddingHorizontal: 9, borderRadius: 13,
    backgroundColor: C.soft,
  },
  planPillOff: { opacity: 0.45 },
  planPillDone: { backgroundColor: '#EFF8F2' },
  planTime: {
    fontSize: 10.5, color: C.gray,
    fontVariant: ['tabular-nums'],
  },
  /**
   * 跳法用次要灰：它和「定时跳 30 秒」都是内容，
   * 但"怎么跳"是前提、"练多少"是主体，靠明度差分开才不会糊成一句。
   */
  planStyle: { fontSize: 11, color: C.sub },
  planMode: { fontSize: 11, color: C.text, fontWeight: '500' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 14, paddingTop: 4,
  },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'baseline' },
  title: { fontSize: 25, fontWeight: 'bold', color: C.text, letterSpacing: 0.3 },
  /** 小字坐到大字的基线上 —— 中文字形底就在基线上，两条底边自然齐平 */
  titleTip: {
    flexShrink: 1, fontSize: 11, color: C.gray, marginLeft: 8,
  },
  // titleRow 已经 flex:1 占满，auto 只是双保险
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

  /**
   * 跳法切换行：左边「跳法 并脚跳|换脚跳 ▶示范」，右边「AI 动作分析」小标签。
   * 跳法用主色实心表示选中，AI 标签用浅紫 —— 一个能点、一个是说明，靠颜色分开。
   */
  styleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, marginTop: 10,
  },
  styleSegWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  styleSegLabel: { fontSize: 11, color: C.sub },
  styleSeg: {
    flexDirection: 'row', gap: 2, padding: 2, borderRadius: 11,
    backgroundColor: C.white, borderWidth: 1, borderColor: '#E4EBF8',
  },
  styleSegItem: {
    paddingHorizontal: 11, height: 25, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  styleSegItemOn: { backgroundColor: C.primary },
  styleSegText: { fontSize: 11, color: '#5C6577' },
  styleSegTextOn: { color: C.white, fontWeight: 'bold' },

  /** 示范视频入口：跟胶囊同高，描边而不是实心，避免和「选中态」抢注意力 */
  demoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, height: 25, borderRadius: 8,
    backgroundColor: C.white, borderWidth: 1, borderColor: '#E4EBF8',
  },
  demoText: { fontSize: 11, color: C.sub },

  aiChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, height: 25, borderRadius: 8,
    backgroundColor: C.aiSoft,
  },
  aiChipText: { fontSize: 10, color: C.aiText },

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

  /** 个数输入小窗：遮罩铺满训练页（负边距抵消 screen 的 padding） */
  countMask: {
    position: 'absolute',
    left: -20, right: -20, top: -8, bottom: -6,
    backgroundColor: 'rgba(20,24,36,0.35)',
    zIndex: 40,
  },
  countDialogWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  menuWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    paddingTop: 92,
    paddingRight: 20,
  },
  menuCard: {
    minWidth: 156,
    borderRadius: 14,
    paddingVertical: 4,
    backgroundColor: C.white,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  menuText: { fontSize: 13, color: C.text },
  menuDivider: { height: 1, marginHorizontal: 14, backgroundColor: C.line },
  countDialog: {
    width: 268,
    backgroundColor: C.white,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
  },
  countDialogTitle: { fontSize: 14, fontWeight: '600', color: C.text, textAlign: 'center' },
  countInput: {
    marginTop: 14,
    fontSize: 34, fontWeight: '700', color: C.text, textAlign: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: C.line,
    fontVariant: ['tabular-nums'],
  },
  countRange: { fontSize: 11, color: C.sub, textAlign: 'center', marginTop: 8 },
  countBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  countBtn: {
    flex: 1, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.soft,
  },
  countBtnMain: { backgroundColor: C.primary },
  countBtnText: { fontSize: 13, color: C.text },
  countBtnMainText: { color: C.white, fontWeight: '600' },

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
