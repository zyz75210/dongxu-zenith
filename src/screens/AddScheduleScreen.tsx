import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, WEEK_DAYS } from '../theme';
import { Schedule, ScheduleType, Repeat } from '../data';
import { dateKey, parseDateKey, weekdayIndex, repeatDates } from '../utils/date';
import { MAX_SECONDS, MIN_SECONDS } from '../components/DurationPickerSheet';
import { MAX_COUNT, MIN_COUNT, STANDARD } from '../workout';
import { JUMP_STYLES, type JumpStyle } from '../jumpStyle';

type Props = {
  /** 是否可见：页面常驻不卸载，靠它判断"重新打开了"从而重置表单 */
  visible?: boolean;
  onClose: () => void;
  /** 默认日期：日历当前选中的那天（新建时用） */
  initialDate: { y: number; m: number; d: number };
  /** 编辑目标：非空时本页进入「修改」分支，表单从这条日程回填 */
  editItem?: Schedule | null;
  /**
   * 快捷新建的预设时长（分钟）。从首页空状态「先动三分钟」进来时传 3，
   * 让表单默认就是一小段，而不是 90 分钟 —— 否则文案说三分钟、表单一开是一个半小时，
   * 用户第一反应就是「算了」。普通新建 / 编辑不传，走原来的默认值。
   */
  presetMinutes?: number;
  onOpenDate: (
    init: { y: number; m: number; d: number },
    onPick: (y: number, m: number, d: number) => void,
  ) => void;
  /** 打开跳绳时长面板（分/秒滚轮，和训练页同一个） */
  onEditDuration: (currentSeconds: number, onPick: (totalSeconds: number) => void) => void;
  onOpenTime: (
    title: string,
    init: { h: number; m: number },
    onPick: (h: number, m: number) => void,
  ) => void;
  /** 保存：把草稿交给上层 —— 新建走追加，编辑走覆盖（id / completed 由上层保留） */
  onSave: (draft: Omit<Schedule, 'id'>) => void;
};

const types: { key: ScheduleType; label: string }[] = [
  { key: 'rope', label: '跳绳' },
  { key: 'fitness', label: '体能' },
  { key: 'run', label: '跑步' },
  { key: 'rest', label: '休息' },
];

/**
 * 跳绳的训练内容。
 *
 * 只选「练什么」，不填数值 —— 跳多少、跳多久每天都不同，
 * 写死在计划里反而累赘，进训练页当场定更合理。
 *
 * 左边用图标而不是颜色点：日程类型靠颜色区分（马卡龙三色），
 * 训练内容挨在下面，再用颜色会混；图标还能直接说明内容是什么。
 */
const ROPE_MODES: {
  key: JumpMode;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** 选中时的强调色。前两个用马卡龙色系里的奶绿 / 奶蓝，和日程类型那排同族 */
  color: string;
  /** 选中时的浅底：同色相的极淡版，不用半透明，免得叠在灰底上发脏 */
  soft: string;
  /** 还没做的项目：可选、能保存，但点了不会有训练入口，所以显示成灰的 */
  ready: boolean;
}[] = [
  { key: 'timer', label: '定时跳', icon: 'timer-outline', color: '#2E9A6B', soft: '#EAF8F1', ready: true },
  { key: 'count', label: '定数跳', icon: 'flag-outline', color: '#3B78D0', soft: '#ECF3FF', ready: true },
  { key: 'trick', label: '花样跳', icon: 'sparkles-outline', color: '#AAB2BF', soft: '#F4F5F8', ready: false },
  { key: 'free', label: '自由跳', icon: 'infinite-outline', color: '#AAB2BF', soft: '#F4F5F8', ready: false },
];

/**
 * 重复选项。文案都短，是为了四个能在一行里放下（窄屏也不会换行）。
 * 「不重复」放第一个：多数人就是排一次，默认值也是它。
 */
const repeats: { key: Repeat; label: string }[] = [
  { key: 'none', label: '不重复' },
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
];

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const timeText = (t: { h: number; m: number }) => `${pad2(t.h)}:${pad2(t.m)}`;

/** 'HH:mm' -> { h, m }；脏值（空串 / 非数字）退化成 0，不让表单崩 */
const parseTime = (t: string): { h: number; m: number } => {
  const [h, m] = t.split(':').map((n) => Number.parseInt(n, 10));
  return {
    h: Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 0,
    m: Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0,
  };
};

/**
 * 标题长度上限：按「视觉宽度」算，不是字符数。
 * 中文/全角算 2、英文/数字/半角算 1，总宽 40 —— 等价于 20 个汉字、或 40 个字母，
 * 或「10 汉字 + 20 字母」这种混合。这样中英文在同一行占的宽度是一致的，
 * 卡片上不会出现"英文排得很长、中文排得很短"的偏差。
 */
const TITLE_UNITS = 40;
/** 展示给用户的口径：折算成「几个汉字」 */
const TITLE_MAX_HAN = TITLE_UNITS / 2;

/** 宽字符（中文/日韩文/全角标点）占两个宽度单位 */
const isWide = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x1100 && c <= 0x115f)     // 韩文字母
    || (c >= 0x2e80 && c <= 0xa4cf)  // 中日韩部首、假名、汉字
    || (c >= 0xac00 && c <= 0xd7a3)  // 韩文音节
    || (c >= 0xf900 && c <= 0xfaff)  // 兼容汉字
    || (c >= 0xfe30 && c <= 0xfe6f)  // 兼容形式
    || (c >= 0xff00 && c <= 0xff60)  // 全角字符
    || (c >= 0xffe0 && c <= 0xffe6)
  );
};

/** 文本占用的宽度单位（中文 2 / 英文 1） */
const unitsOf = (text: string) => {
  let w = 0;
  for (const ch of text) w += isWide(ch) ? 2 : 1;
  return w;
};

/**
 * 按宽度上限裁剪：超出的部分直接不接收，不做「先输进去再弹错误」。
 * 用 for...of 走码点，避免把代理对（emoji 等）切成半个字符。
 */
const clampTitle = (text: string) => {
  let w = 0;
  let out = '';
  for (const ch of text) {
    const cw = isWide(ch) ? 2 : 1;
    if (w + cw > TITLE_UNITS) break;
    w += cw;
    out += ch;
  }
  return out;
};

// 新建日程时的默认值（编辑时全部由 editItem 覆盖）
/**
 * 训练内容的默认目标 = 该跳法的「标准档」。
 *
 * 成绩页的"最好成绩"只认固定档位：
 *   并脚跳 1 分钟 / 300 个    换脚跳 30 秒 / 200 个
 * 默认值直接落在这两个档上，用户照着默认练，成绩就自动能进评比 ——
 * 否则练了一堆，一个都进不了榜，还以为统计坏了。
 *
 * 想练别的量随时改，改了只是不参与评比，训练和记录都不受影响。
 */
const DEFAULT_SECONDS = STANDARD.together.timerTarget;
const DEFAULT_COUNT = STANDARD.together.countTarget;

/** 秒数说成人话：30 秒 / 1 分 30 秒 / 30 分 */
function formatSeconds(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} 秒`;
  if (s === 0) return `${m} 分`;
  return `${m} 分 ${s} 秒`;
}

const BLANK = {
  title: '跳绳训练',
  type: 'rope' as ScheduleType,
  ropeMode: 'timer' as JumpMode,
  note: '',
  remind: true,
  start: { h: 14, m: 0 },
  end: { h: 15, m: 30 },
};

function AddScheduleScreen({
  visible = true, onClose, initialDate, editItem = null, presetMinutes,
  onOpenDate, onEditDuration, onOpenTime, onSave,
}: Props) {
  const [title, setTitle] = useState(BLANK.title);
  const [type, setType] = useState<ScheduleType>(BLANK.type);
  /** 训练内容：只有跳绳用得到，切到别的类型时保留但不写入 */
  const [ropeMode, setRopeMode] = useState<JumpMode>(BLANK.ropeMode);
  /**
   * 目标值分开存两份。
   * 定时跳存分钟、定数跳存个数，量级完全不同（30 vs 500）——
   * 共用一个变量的话，从定时跳 40 分钟切到定数跳会变成"40 个"，
   * 再切回来又变成"500 分钟"，来回横跳。
   */
  const [timerSeconds, setTimerSeconds] = useState(DEFAULT_SECONDS);
  /** 跳法：决定计数页用哪一套判据，默认并脚跳 */
  const [jumpStyle, setJumpStyle] = useState<JumpStyle>('together');
  const [countTarget, setCountTarget] = useState(DEFAULT_COUNT);
  /** 目标编辑小窗 */
  const [targetEditing, setTargetEditing] = useState(false);
  const [targetDraft, setTargetDraft] = useState('');
  const [note, setNote] = useState(BLANK.note);
  const [remind, setRemind] = useState(BLANK.remind);

  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(BLANK.start);
  const [end, setEnd] = useState(BLANK.end);
  /** 重复：只在新建时可选；编辑针对的是某一天的那一条，给「重复」会让人误以为能改整串 */
  const [repeat, setRepeat] = useState<Repeat>('none');
  // 刚才这一下输入被字数限制挡掉了 → 立刻在输入框下方提示，别让用户以为键盘坏了
  const [titleFull, setTitleFull] = useState(false);

  /**
   * 这个页面现在会常驻在屏幕外（为了开页不卡），
   * 所以每次重新打开时手动把表单重置一遍：新建回默认值，编辑按 editItem 回填。
   */
  const prevVisible = useRef(false);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      if (editItem) {
        setTitle(editItem.title);
        setType(editItem.type);
        setRopeMode(editItem.ropeMode ?? BLANK.ropeMode);
        setJumpStyle(editItem.jumpStyle ?? 'together');
        if (editItem.ropeMode === 'timer' && editItem.ropeTarget) {
          setTimerSeconds(editItem.ropeTarget);
        } else if (editItem.ropeMode === 'count' && editItem.ropeTarget) {
          setCountTarget(editItem.ropeTarget);
        }
        setNote(editItem.note ?? '');
        setRemind(editItem.remind ?? false);
        setDate(parseDateKey(editItem.date));
        setStart(parseTime(editItem.start));
        setEnd(parseTime(editItem.end));
      } else {
        setTitle(BLANK.title);
        setType(BLANK.type);
        setNote(BLANK.note);
        setRemind(BLANK.remind);
        setDate(initialDate);
        setStart(BLANK.start);
        setRepeat('none');
        // 空状态快捷进来：结束时间 = 开始 + 预设时长，表单和「三分钟」的文案对得上
        if (presetMinutes && presetMinutes > 0) {
          const total = BLANK.start.h * 60 + BLANK.start.m + presetMinutes;
          setEnd({ h: Math.floor(total / 60) % 24, m: total % 60 });
        } else {
          setEnd(BLANK.end);
        }
      }
      // 页面常驻不卸载，上次滑到的位置会留着，重新打开时回到顶部
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      // 上一次的超限提示不要带到这一次开页
      setTitleFull(false);
    }
    prevVisible.current = visible;
  }, [visible, initialDate, editItem, presetMinutes]);

  const dateText = `${date.y}年${date.m + 1}月${date.d}日 星期${
    WEEK_DAYS[weekdayIndex(new Date(date.y, date.m, date.d))]
  }`;

  // 编辑老数据时标题可能超长（那时还没限制）：计数标红提醒，但不偷偷改用户内容
  const titleOver = unitsOf(title) > TITLE_UNITS;

  /**
   * 选了重复后一共会排几次（含起始那天）。
   * 直接在按钮上写出来，别等保存完才让用户看到日历里多了一整年。
   */
  const repeatTotal = useMemo(
    () => (repeat === 'none'
      ? 1
      : 1 + repeatDates(dateKey(date.y, date.m, date.d), repeat).length),
    [repeat, date.y, date.m, date.d],
  );

  // 点日期：复用首页那套年月日滚轮
  const openDate = () => onOpenDate(date, (y, m, d) => setDate({ y, m, d }));
  /**
   * 选类型：标题还停在初始默认值「跳绳训练」时，跟着类型一起换，
   * 否则会出现「休息 / 跳绳训练」这种自相矛盾的搭配。
   * 用户自己改过标题就不碰他的内容。
   */
  const pickType = (key: ScheduleType) => {
    if (title === BLANK.title) {
      const label = types.find((t) => t.key === key)?.label ?? '';
      setTitle(key === 'rest' ? '休息日' : `${label}训练`);
    }
    setType(key);
  };

  // 点开始/结束时间：同一个时间滚轮，只是标题和初值不同
  const openStart = () => onOpenTime('开始时间', start, (h, m) => setStart({ h, m }));
  const openEnd = () => onOpenTime('结束时间', end, (h, m) => setEnd({ h, m }));

  /**
   * 输入标题：超出的部分直接吃掉（限制本身不打折），
   * 但要立刻在输入框下方亮出「到上限了」，否则用户只会觉得「字怎么打不进去」。
   * 只在「这一次输入确实被截断」时亮，删字后自动消失，不会一直挂着。
   */
  const onTitleChange = (t: string) => {
    const clamped = clampTitle(t);
    setTitleFull(clamped !== t);
    setTitle(clamped);
  };

  /**
   * 打开目标编辑：
   *   定时跳 → 分/秒滚轮（和训练页同一个面板，手感和观感统一）
   *   定数跳 → 数字小窗（个数是整数，滚轮一格一格滚几十次太慢）
   */
  /**
   * 切跳法时把目标同步成该跳法的标准档。
   *
   * 两种跳法的标准档不一样（并脚 1 分钟 / 换脚 30 秒），
   * 切完还留着上一档的数字，很容易练出一堆进不了榜的成绩。
   * 用户想要别的量，切完再改就是。
   */
  const pickJumpStyle = (k: JumpStyle) => {
    setJumpStyle(k);
    setTimerSeconds(STANDARD[k].timerTarget);
    setCountTarget(STANDARD[k].countTarget);
  };

  const openTargetEditor = () => {
    if (ropeMode === 'timer') {
      onEditDuration(timerSeconds, applyTimerSeconds);
      return;
    }
    if (ropeMode === 'count') {
      setTargetDraft(String(countTarget));
      setTargetEditing(true);
    }
  };

  /** 滚轮确定的时长：按 1 秒 ~ 60 分钟收敛，被夹住时说一句 */
  const applyTimerSeconds = (total: number) => {
    const clamped = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, total));
    setTimerSeconds(clamped);
    if (clamped !== total) {
      Alert.alert('超出范围', '跳绳时长只能在 1 秒 ~ 60 分钟之间，已按边界设定。');
    }
  };

  /** 提交个数：越界就收敛到边界并说清楚，不静默改数字 */
  const applyTarget = () => {
    const n = parseInt(targetDraft.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(n)) {
      Alert.alert('数字不对', '请填一个数字。');
      return;
    }
    const clamped = Math.min(MAX_COUNT, Math.max(MIN_COUNT, n));
    if (clamped !== n) {
      Alert.alert(
        '超出范围',
        `个数只能在 ${MIN_COUNT} ~ ${MAX_COUNT} 之间，已按 ${clamped} 设定。`,
      );
    }
    setCountTarget(clamped);
    setTargetEditing(false);
  };

  // 训练内容：后期开发的预留入口，先给个轻提示，避免点了没反应像坏了
  const openTrainingPlaceholder = () => {
    Alert.alert('训练内容', '这里之后可以添加动作、组数、次数和重量，功能正在开发中。');
  };

  const save = () => {
    // 结束时间必须晚于开始时间：跨零点不在这里支持，先把明显填反的情况拦住
    if (end.h * 60 + end.m <= start.h * 60 + start.m) {
      Alert.alert('时间设置不对', '结束时间要晚于开始时间，改一下再保存吧。', [
        { text: '知道了' },
      ]);
      return;
    }
    const typeLabel = types.find((t) => t.key === type)?.label ?? '其他';
    onSave({
      date: dateKey(date.y, date.m, date.d),
      title: clampTitle(title.trim()) || '未命名日程',
      start: timeText(start),
      end: timeText(end),
      type,
      tag: typeLabel,
      note: note.trim() || undefined,
      remind,
      // 训练内容只有跳绳日程才有意义，别的类型不写这个字段
      ...(type === 'rope' ? {
        ropeMode,
        // 花样跳 / 自由跳没有目标值
        jumpStyle,
        ...(ropeMode === 'timer'
          ? { ropeTarget: timerSeconds }
          : ropeMode === 'count'
            ? { ropeTarget: countTarget }
            : {}),
      } : {}),
      // 编辑的是某一天的那一条，没有"重复"可言；新建时只有选了重复才带这个字段
      ...(editItem || repeat === 'none' ? {} : { repeat }),
    });
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 顶部 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close-outline" size={18} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{editItem ? '编辑日程' : '新建训练计划'}</Text>
          <TouchableOpacity style={styles.circle} activeOpacity={0.7}>
            <Ionicons name="ellipsis-horizontal" size={18} color={C.text} />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          {editItem ? '修改' : '为'} {date.y}年{date.m + 1}月{date.d}日 {editItem ? '的安排' : '创造新的安排'}
        </Text>

        {/* 标题 */}
        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelInRow]}>标题</Text>
          <Text style={[styles.titleCount, (titleFull || titleOver) && styles.titleCountOver]}>
            {Math.ceil(unitsOf(title) / 2)}/{TITLE_MAX_HAN}
          </Text>
        </View>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={onTitleChange}
          placeholder="输入日程标题"
          placeholderTextColor={C.gray}
          // 字符数兜底：防止粘贴上千字；真正的宽度限制在 clampTitle 里
          maxLength={TITLE_UNITS}
        />
        {(titleFull || titleOver) && (
          <Text style={styles.titleHint}>
            {titleFull ? '已到字数上限：' : '标题超出上限：'}中文 {TITLE_MAX_HAN} 字 / 英文 {TITLE_UNITS} 个字母
          </Text>
        )}

        {/* 日期与时间 */}
        <Text style={[styles.label, styles.labelGap]}>日期与时间</Text>
        <View style={styles.fieldCard}>
          <TouchableOpacity style={styles.fieldBlock} onPress={openDate} activeOpacity={0.6}>
            <Text style={styles.fieldLabel}>日期</Text>
            <View style={styles.fieldRow}>
              <Ionicons name="calendar-outline" size={17} color={C.primary} />
              <Text style={styles.fieldText}>{dateText}</Text>
              <Ionicons name="chevron-down-outline" size={16} color={C.gray} />
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* 开始 / 结束并成一行：左边开始，右边结束 */}
          <View style={styles.timeRow}>
            <TouchableOpacity style={styles.timeCell} onPress={openStart} activeOpacity={0.6}>
              <Text style={styles.fieldLabel}>开始时间</Text>
              <View style={styles.fieldRow}>
                <Ionicons name="time-outline" size={17} color={C.primary} />
                <Text style={styles.fieldText}>{timeText(start)}</Text>
                <Ionicons name="chevron-down-outline" size={16} color={C.gray} />
              </View>
            </TouchableOpacity>

            <View style={styles.vDivider} />

            <TouchableOpacity style={styles.timeCell} onPress={openEnd} activeOpacity={0.6}>
              <Text style={styles.fieldLabel}>结束时间</Text>
              <View style={styles.fieldRow}>
                <Ionicons name="time-outline" size={17} color={C.primary} />
                <Text style={styles.fieldText}>{timeText(end)}</Text>
                <Ionicons name="chevron-down-outline" size={16} color={C.gray} />
              </View>
            </TouchableOpacity>
          </View>

          {/* 重复：只在新建时出现。横排一行，和上面「开始/结束」同属时间这一块 */}
          {!editItem && (
            <>
              <View style={styles.divider} />
              <View style={styles.repeatRow}>
                <Text style={styles.repeatLabel}>重复</Text>
                <View style={styles.repeatChips}>
                  {repeats.map((r) => {
                    const on = r.key === repeat;
                    return (
                      <TouchableOpacity
                        key={r.key}
                        style={[styles.repeatChip, on && styles.repeatChipOn]}
                        onPress={() => setRepeat(r.key)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.repeatText, on && styles.repeatTextOn]}>{r.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </>
          )}
        </View>

        {/* 日程类型 */}
        <Text style={[styles.label, styles.labelGap]}>日程类型</Text>
        <View style={styles.typeRow}>
          {types.map((t) => {
            const on = t.key === type;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.typePill, on && styles.typePillOn]}
                onPress={() => pickType(t.key)}
                activeOpacity={0.7}
              >
                <View style={[styles.typeDot, { backgroundColor: C.typeDot[t.key] }]} />
                <Text style={[styles.typeText, on && styles.typeTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 训练内容：跳绳是四种跳法可选；其他类型还是原来的占位 */}
        <Text style={[styles.label, styles.labelGap]}>训练内容</Text>
        {type === 'rope' ? (
          <>
            <View style={styles.typeRow}>
              {ROPE_MODES.map((m) => {
                const on = m.key === ropeMode;
                return (
                  <TouchableOpacity
                    key={m.key}
                    /*
                     * 点已选中的那个 = 改目标值（用户说的"再次点击训练内容"）；
                     * 点没选中的 = 换类型。选中的胶囊再点一下就是编辑，
                     * 这样不用额外加一个按钮，手指也不用跑远。
                     */
                    onPress={() => {
                      if (on && m.ready) openTargetEditor();
                      else setRopeMode(m.key);
                    }}
                    style={[
                      styles.typePill,
                      on && { borderColor: m.color, backgroundColor: m.soft },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={m.icon}
                      size={14}
                      color={on ? m.color : (m.ready ? C.sub : '#C2C8D2')}
                    />
                    <Text
                      style={[
                        styles.typeText,
                        on && { color: m.color, fontWeight: '600' },
                        !on && !m.ready && { color: '#C2C8D2' },
                      ]}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 目标值提示：只有能真正练的两个项目才有，花样跳/自由跳没有目标 */}
            {(ropeMode === 'timer' || ropeMode === 'count') && (
              <TouchableOpacity
                style={styles.targetRow}
                activeOpacity={0.7}
                onPress={openTargetEditor}
              >
                <Ionicons
                  name={ropeMode === 'timer' ? 'time-outline' : 'flag-outline'}
                  size={13}
                  color={C.primary}
                />
                <Text style={styles.targetValue}>
                  {ropeMode === 'timer'
                    ? `时长 ${formatSeconds(timerSeconds)}`
                    : `个数 ${countTarget} 个`}
                </Text>
                <Text style={styles.targetHint}>点一下修改</Text>
              </TouchableOpacity>
            )}

            {/* 标准档说明：说清楚"练多少才进最好成绩评比"，省得练完发现没上榜 */}
            {(ropeMode === 'timer' || ropeMode === 'count') && (
              <Text style={styles.standardHint}>
                最好成绩按标准档评比：{jumpStyle === 'together' ? '并脚跳' : '换脚跳'}
                {' '}
                {ropeMode === 'timer'
                  ? formatSeconds(STANDARD[jumpStyle].timerTarget)
                  : `${STANDARD[jumpStyle].countTarget} 个`}
              </Text>
            )}

            {/*
              跳法：和训练页那排是同一件事、同一套选项。
              在这里先定好，从日程点「去训练」时直接按它选判据，
              计数页就不用再问一次"你跳的是并脚还是换脚"。
            */}
            <Text style={[styles.label, styles.labelGap]}>跳法</Text>
            <View style={styles.typeRow}>
              {JUMP_STYLES.map((j) => {
                const on = j.key === jumpStyle;
                return (
                  <TouchableOpacity
                    key={j.key}
                    style={[styles.typePill, on && styles.typePillOn]}
                    onPress={() => pickJumpStyle(j.key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={j.key === 'together' ? 'footsteps-outline' : 'swap-horizontal-outline'}
                      size={14}
                      color={on ? C.primary : C.sub}
                    />
                    <Text style={[styles.typeText, on && styles.typeTextOn]}>
                      {j.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.trainingRow}>
            <TouchableOpacity
              style={styles.trainingPill}
              onPress={openTrainingPlaceholder}
              activeOpacity={0.6}
            >
              <Ionicons name="add" size={15} color={C.gray} />
              <Text style={styles.trainingText}>添加训练</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 备注 */}
        <View style={styles.noteHeader}>
          <Text style={styles.label}>备注</Text>
          <Text style={styles.counter}>{note.length}/200</Text>
        </View>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={(v) => setNote(v.slice(0, 200))}
          placeholder="写下会议目标、参与者或需要准备的材料…"
          placeholderTextColor={C.gray}
          multiline
          textAlignVertical="top"
        />

        {/* 提醒开关 */}
        <View style={styles.remindRow}>
          <View style={styles.remindLeft}>
            <Ionicons name="notifications-outline" size={17} color={C.primary} />
            <Text style={styles.remindText}>提前 15 分钟提醒</Text>
          </View>
          <Switch
            value={remind}
            onValueChange={setRemind}
            trackColor={{ false: '#D8DCE3', true: C.primary }}
            thumbColor={C.white}
          />
        </View>
      </ScrollView>

      {/* 保存按钮 */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.saveBtn} onPress={save} activeOpacity={0.85}>
          <Text style={styles.saveText}>
            {/* 选了重复就把"会排几次"提前写在按钮上，别等保存完才让人意外 */}
            {editItem
              ? '保存修改'
              : repeat === 'none'
                ? '保存日程'
                : `保存日程 · 一年内 ${repeatTotal} 次`}
          </Text>
        </TouchableOpacity>
      </View>

      {/*
        目标值编辑小窗。
        用弹窗而不是把输入框直接摆在表单里：训练内容那排已经有四个胶囊，
        再加输入框会把这一块撑得很高，而且大多数人根本不会改这个数。
      */}
      <Modal
        visible={targetEditing}
        transparent
        animationType="fade"
        onRequestClose={() => setTargetEditing(false)}
      >
        <View style={styles.targetMask}>
          <View style={styles.targetCard}>
            <Text style={styles.targetTitle}>目标个数</Text>
            <TextInput
              style={styles.targetInput}
              value={targetDraft}
              onChangeText={(t) => setTargetDraft(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={5}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={applyTarget}
              placeholder={String(countTarget)}
              placeholderTextColor="#C4C9D2"
            />
            <Text style={styles.targetRangeText}>
              {MIN_COUNT} – {MAX_COUNT} 个
            </Text>
            <View style={styles.targetBtns}>
              <TouchableOpacity
                style={styles.targetBtn}
                activeOpacity={0.8}
                onPress={() => setTargetEditing(false)}
              >
                <Text style={styles.targetBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.targetBtn, styles.targetBtnMain]}
                activeOpacity={0.85}
                onPress={applyTarget}
              >
                <Text style={[styles.targetBtnText, styles.targetBtnMainText]}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  subtitle: { fontSize: 12, color: C.gray, textAlign: 'center', marginTop: 8, marginBottom: 22 },

  label: { fontSize: 12, color: C.gray, marginBottom: 8 },
  labelGap: { marginTop: 20 },
  // 标题这一行的 label：右边要挂字数计数，所以把自身下边距交给 labelRow
  labelInRow: { marginBottom: 0 },
  labelRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  titleCount: { fontSize: 11, color: C.gray },
  titleCountOver: { color: C.danger },

  titleInput: {
    borderWidth: 1.5, borderColor: C.primary,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 14, color: C.text, backgroundColor: C.bg,
  },
  titleHint: { fontSize: 11, color: C.danger, marginTop: 6 },

  fieldCard: {
    borderWidth: 1, borderColor: C.line, borderRadius: 12,
    backgroundColor: C.bg, paddingHorizontal: 14,
  },
  /**
   * 卡片里三块的上下内距必须一致：日期块、时间块、重复行都是 12。
   * 之前是 10 / 10 / 12，看着「重复」那行比上面松一点，整张卡就不是一个节奏了。
   */
  fieldBlock: { paddingVertical: 12 },
  fieldLabel: { fontSize: 11, color: C.gray, marginBottom: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', height: 24 },
  fieldText: { flex: 1, fontSize: 13, color: C.text, marginLeft: 10 },
  divider: { height: 1, backgroundColor: C.line },

  // 开始 / 结束时间同一行，中间一条竖线
  timeRow: { flexDirection: 'row', alignItems: 'stretch' },
  timeCell: { flex: 1, paddingVertical: 12 },
  vDivider: { width: 1, backgroundColor: C.line, marginVertical: 12, marginHorizontal: 10 },

  // 重复：左侧一个短标签，右边四个选项横排靠右。
  // 四个选项都压到最小尺寸，是为了窄屏也在一行里放得下，不换行、不横向滚动。
  repeatRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, gap: 10,
  },
  repeatLabel: { fontSize: 11, color: C.gray },
  repeatChips: { flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'flex-end' },
  repeatChip: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg,
  },
  repeatChipOn: { borderColor: C.primary, backgroundColor: '#F0F5FF' },
  repeatText: { fontSize: 12, color: C.sub },
  repeatTextOn: { color: C.primary, fontWeight: '500' },

  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // 四个分类（跳绳/体能/跑步/休息）等分一行：flexBasis 0 让它们自己均分宽度，
  // 不写死百分比，窄屏也不会挤到第二行
  typePill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    flexGrow: 1, flexBasis: 0,
    paddingHorizontal: 13, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg,
  },
  typePillOn: { borderColor: C.primary, backgroundColor: '#F0F5FF' },
  typeDot: { width: 7, height: 7, borderRadius: 4 },

  targetMask: {
    flex: 1, backgroundColor: 'rgba(20,24,36,0.4)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40,
  },
  targetCard: {
    width: '100%', borderRadius: 18, padding: 20, gap: 10,
    backgroundColor: C.white,
  },
  targetTitle: { fontSize: 14, fontWeight: '700', color: C.text, textAlign: 'center' },
  targetInput: {
    height: 52, borderRadius: 14, textAlign: 'center',
    backgroundColor: C.soft, color: C.text,
    fontSize: 24, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  targetRangeText: { fontSize: 11, color: C.gray, textAlign: 'center' },
  targetBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  targetBtn: {
    flex: 1, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.soft,
  },
  targetBtnText: { fontSize: 13, color: C.sub, fontWeight: '600' },
  targetBtnMain: { backgroundColor: C.primary },
  targetBtnMainText: { color: C.white },

  /** 训练内容的目标值：跟在胶囊下面一行，轻描淡写但可点 */
  targetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 8, paddingHorizontal: 2,
  },
  targetValue: { fontSize: 12, color: C.text, fontWeight: '600' },
  targetHint: { fontSize: 11, color: C.gray, marginLeft: 2 },
  standardHint: { fontSize: 10, color: C.gray, marginTop: 6, marginLeft: 2 },
  typeText: { fontSize: 12, color: C.gray },
  typeTextOn: { color: C.primary, fontWeight: '500' },

  // 训练内容占位：虚线胶囊 + 加号，形态与日程类型胶囊一致
  trainingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trainingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingLeft: 10, paddingRight: 14, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1,
    borderColor: '#C6CDDA', borderStyle: 'dashed',
    backgroundColor: C.bg,
  },
  trainingText: { fontSize: 12, color: C.gray },

  noteHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  counter: { fontSize: 11, color: C.gray },
  noteInput: {
    minHeight: 92, borderWidth: 1, borderColor: C.line,
    borderRadius: 12, padding: 13, fontSize: 13, color: C.text,
    backgroundColor: C.soft,
  },

  remindRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 18, paddingVertical: 12,
  },
  remindLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  remindText: { fontSize: 13, color: C.text },

  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line },
  saveBtn: {
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  saveText: { color: C.white, fontSize: 15, fontWeight: '600' },
});

// 父级（App）每次重渲染都会重建元素，memo 让本页在 props 没变时直接跳过重渲染
export default memo(AddScheduleScreen);
