import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, WEEK_DAYS } from '../theme';
import { Schedule, ScheduleType } from '../data';
import { dateKey, parseDateKey, weekdayIndex } from '../utils/date';

type Props = {
  /** 是否可见：页面常驻不卸载，靠它判断"重新打开了"从而重置表单 */
  visible?: boolean;
  onClose: () => void;
  /** 默认日期：日历当前选中的那天（新建时用） */
  initialDate: { y: number; m: number; d: number };
  /** 编辑目标：非空时本页进入「修改」分支，表单从这条日程回填 */
  editItem?: Schedule | null;
  onOpenDate: (
    init: { y: number; m: number; d: number },
    onPick: (y: number, m: number, d: number) => void,
  ) => void;
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
const BLANK = {
  title: '跳绳训练',
  type: 'rope' as ScheduleType,
  note: '',
  remind: true,
  start: { h: 14, m: 0 },
  end: { h: 15, m: 30 },
};

function AddScheduleScreen({
  visible = true, onClose, initialDate, editItem = null, onOpenDate, onOpenTime, onSave,
}: Props) {
  const [title, setTitle] = useState(BLANK.title);
  const [type, setType] = useState<ScheduleType>(BLANK.type);
  const [note, setNote] = useState(BLANK.note);
  const [remind, setRemind] = useState(BLANK.remind);

  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(BLANK.start);
  const [end, setEnd] = useState(BLANK.end);
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
        setEnd(BLANK.end);
      }
      // 页面常驻不卸载，上次滑到的位置会留着，重新打开时回到顶部
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      // 上一次的超限提示不要带到这一次开页
      setTitleFull(false);
    }
    prevVisible.current = visible;
  }, [visible, initialDate, editItem]);

  const dateText = `${date.y}年${date.m + 1}月${date.d}日 星期${
    WEEK_DAYS[weekdayIndex(new Date(date.y, date.m, date.d))]
  }`;

  // 编辑老数据时标题可能超长（那时还没限制）：计数标红提醒，但不偷偷改用户内容
  const titleOver = unitsOf(title) > TITLE_UNITS;

  // 点日期：复用首页那套年月日滚轮
  const openDate = () => onOpenDate(date, (y, m, d) => setDate({ y, m, d }));
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
          <Text style={styles.headerTitle}>{editItem ? '编辑日程' : '添加日程'}</Text>
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
                onPress={() => setType(t.key)}
                activeOpacity={0.7}
              >
                <View style={[styles.typeDot, { backgroundColor: C.typeDot[t.key] }]} />
                <Text style={[styles.typeText, on && styles.typeTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 训练内容：三类都是训练，始终显示；当前只是预留占位 */}
        <Text style={[styles.label, styles.labelGap]}>训练内容</Text>
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
          <Text style={styles.saveText}>{editItem ? '保存修改' : '保存日程'}</Text>
        </TouchableOpacity>
      </View>
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
  fieldBlock: { paddingVertical: 10 },
  fieldLabel: { fontSize: 11, color: C.gray, marginBottom: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', height: 24 },
  fieldText: { flex: 1, fontSize: 13, color: C.text, marginLeft: 10 },
  divider: { height: 1, backgroundColor: C.line },

  // 开始 / 结束时间同一行，中间一条竖线
  timeRow: { flexDirection: 'row', alignItems: 'stretch' },
  timeCell: { flex: 1, paddingVertical: 10 },
  vDivider: { width: 1, backgroundColor: C.line, marginVertical: 12, marginHorizontal: 10 },

  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // 六大分类：两行三列等宽，胶囊样式不变
  typePill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    flexGrow: 1, flexBasis: '30%',
    paddingHorizontal: 13, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg,
  },
  typePillOn: { borderColor: C.primary, backgroundColor: '#F0F5FF' },
  typeDot: { width: 7, height: 7, borderRadius: 4 },
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
