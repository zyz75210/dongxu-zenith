import React, { memo } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, WEEK_DAYS } from '../theme';
import { Schedule } from '../data';
import { dateKeyOf, isFinished, parseDateKey, timeToMinutes, weekdayIndex } from '../utils/date';
import CompletionButton, { CompletionState } from '../components/CompletionButton';
import { durationWord, MODE_WORD } from '../workout';

type Props = {
  item: Schedule;
  onBack: () => void;
  onEdit: (item: Schedule) => void;
  onDelete: (id: string) => void;
  /** 删除整串重复日程（seriesId 相同的全部） */
  onDeleteSeries: (seriesId: string) => void;
  onToggleComplete: (id: string) => void;
  /** 从这条计划直接进计数页（只有跳绳的定时跳 / 定数跳可用） */
  onStartTraining?: (item: Schedule) => void;
};

const typeName: Record<string, string> = {
  rope: '跳绳', fitness: '体能', run: '跑步', rest: '休息',
};

/** 重复频率的中文说法：删除确认里要说清楚"这一串是每天还是每周" */
const repeatName: Record<string, string> = {
  daily: '每天', weekly: '每周', monthly: '每月',
};

function DetailScreen({
  item, onBack, onEdit, onDelete, onDeleteSeries, onToggleComplete, onStartTraining,
}: Props) {
  /**
   * 删除前先分清两种情况：
   * - 普通日程 → 原来的二次确认
   * - 重复日程 → 必须问「删整串还是只删这一天」，否则「每天重复」的人删一次会以为全清了，
   *   或者只想跳过今天却把一整年都删掉。两种误会都很难挽回。
   */
  const remove = () => {
    const seriesId = item.seriesId;
    if (!seriesId || !item.repeat) {
      Alert.alert('删除日程', `确定删除「${item.title}」吗？`, [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => onDelete(item.id) },
      ]);
      return;
    }
    Alert.alert(
      '这是重复日程',
      `「${item.title}」是${repeatName[item.repeat]}重复的。要删除整串，还是只删这一天？`,
      [
        { text: '删除全部', style: 'destructive', onPress: () => onDeleteSeries(seriesId) },
        { text: '只删这一天', style: 'destructive', onPress: () => onDelete(item.id) },
        { text: '取消', style: 'cancel' },
      ],
    );
  };

  // 真实日期与时长
  const d = parseDateKey(item.date);
  const dateText = `${d.y}年${d.m + 1}月${d.d}日 星期${
    WEEK_DAYS[weekdayIndex(new Date(d.y, d.m, d.d))]
  }`;
  const mins = Math.max(0, timeToMinutes(item.end) - timeToMinutes(item.start));
  const durText = mins === 0
    ? ''
    : mins >= 60
      ? `${Math.floor(mins / 60)} 小时${mins % 60 ? ` ${mins % 60} 分钟` : ''}`
      : `${mins} 分钟`;

  const info = [
    { icon: 'calendar-outline', label: '日期', value: dateText },
    {
      icon: 'time-outline',
      label: '时间',
      value: `${item.start} - ${item.end}${durText ? `（${durText}）` : ''}`,
    },
    // 重复日程多一行说明：让用户在按删除之前就知道这是"一串"，不是孤零零一条
    ...(item.repeat
      ? [{ icon: 'repeat-outline', label: '重复', value: `${repeatName[item.repeat]} · 一年内` }]
      : []),
    { icon: 'pricetag-outline', label: '类型', value: typeName[item.type] ?? '其他' },
    // 跳绳日程才有训练内容：让用户一眼看出这条计划练的是定时还是定数
    ...(item.type === 'rope' && item.ropeMode
      ? [{
        icon: 'fitness-outline',
        label: '训练内容',
        // 带上目标值：这条计划是"定数跳 500 个"，看一眼就知道该练多少
        value: `${MODE_WORD[item.ropeMode]}${
          item.ropeTarget
            ? (item.ropeMode === 'timer'
              // ropeTarget 存的是秒，不能直接拼「分钟」—— 1 分钟会显示成「60 分钟」
              ? ` · ${durationWord(item.ropeTarget)}`
              : ` · ${item.ropeTarget} 个`)
            : ''
        }`,
      },
      {
        icon: 'footsteps-outline',
        label: '跳法',
        value: item.jumpStyle === 'alternate' ? '换脚跳' : '并脚跳',
      }]
      : []),
    { icon: 'notifications-outline', label: '提醒', value: item.remind ? '提前 15 分钟' : '不提醒' },
  ];

  /*
   * 这条计划能不能直接开练：跳绳 + 定时跳/定数跳。
   * 体能、跑步没有计数页；花样跳、自由跳还没做 —— 这两种给灰色按钮，
   * 保留位置但不给"点了会有反应"的错觉。
   */
  const canTrain = item.type === 'rope'
    && (item.ropeMode === undefined || item.ropeMode === 'timer' || item.ropeMode === 'count');

  // 完成状态：已完成 > 隔天仍未完成（超时）> 待完成
  const todayKey = dateKeyOf(new Date());
  // 休息日不需要勾选，日期到了就算完成 —— 统一走 isFinished
  const isRest = item.type === 'rest';
  const state: CompletionState = isFinished(item, todayKey)
    ? 'done'
    : item.date < todayKey
      ? 'overdue'
      : 'pending';

  const stateText = isRest
    ? (state === 'done' ? '休息日 · 已记入打卡' : '休息日 · 到了那天自动记入')
    : state === 'done'
      ? '已完成 · 再点一次可撤销'
      : state === 'overdue'
        ? '已超时未完成 · 点击补记'
        : '点击标记为已完成';

  return (
    <View style={styles.root}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 顶部 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back-outline" size={18} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>日程详情</Text>
          <TouchableOpacity style={styles.circle} activeOpacity={0.7}>
            <Ionicons name="share-outline" size={18} color={C.text} />
          </TouchableOpacity>
        </View>

        {/* 主卡片 */}
        <View style={styles.hero}>
          <View style={styles.heroTag}>
            <View style={[styles.heroDot, { backgroundColor: C.typeDot[item.type] }]} />
            <Text
              style={[
                styles.heroTagText,
                { color: C.typeDot[item.type] },
              ]}
            >
              {typeName[item.type]}
            </Text>
          </View>
          <Text style={styles.heroTitle}>{item.title}</Text>
          <View style={styles.heroTimeRow}>
            <Ionicons name="time-outline" size={13} color={C.gray} />
            <Text style={styles.heroTime}>{dateText} · {item.start} - {item.end}</Text>
          </View>
        </View>

        {/* 信息列表 */}
        <View style={styles.infoCard}>
          {info.map((row, i) => (
            <View key={i}>
              <View style={styles.infoRow}>
                <View style={styles.infoIconBox}>
                  <Ionicons name={row.icon as any} size={16} color={C.primary} />
                </View>
                <Text style={styles.infoLabel}>{row.label}</Text>
                <Text style={styles.infoValue}>{row.value}</Text>
              </View>
              {i < info.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {/* 备注 */}
        <View style={styles.noteCard}>
          <Text style={styles.noteLabel}>备注</Text>
          <Text style={[styles.noteText, !item.note && styles.noteEmpty]}>
            {item.note || '暂无备注'}
          </Text>
        </View>

        {/*
          训练视频：只有跳绳日程有。
          这一版是占位 —— 录制模块在下个大版本接，接进来之后这里直接换成
          缩略图 + 播放，布局不用动。
        */}
        {item.type === 'rope' && (
          <View style={styles.noteCard}>
            <Text style={styles.noteLabel}>训练视频</Text>
            <View style={styles.videoSlot}>
              <Ionicons name="videocam-outline" size={15} color={C.gray} />
              <Text style={styles.videoSlotText}>
                视频功能开发中，接入后本次训练的录像会出现在这里
              </Text>
            </View>
          </View>
        )}

        {/* 完成情况：圆形按钮，点一下切换完成 / 未完成 */}
        <View style={styles.doneCard}>
          <View style={styles.doneTexts}>
            <Text style={styles.doneTitle}>完成情况</Text>
            <Text style={[styles.doneSub, state === 'overdue' && styles.doneSubLate]}>
              {stateText}
            </Text>
          </View>
          <View style={styles.doneRight}>
            {/* 开始训练：紧挨着完成按钮，一条计划看一眼就能直接开练 */}
            {item.type === 'rope' && (
              <TouchableOpacity
                style={[styles.trainBtn, !canTrain && styles.trainBtnOff]}
                activeOpacity={canTrain ? 0.85 : 1}
                disabled={!canTrain}
                onPress={() => onStartTraining?.(item)}
              >
                <Ionicons
                  name="play"
                  size={11}
                  color={canTrain ? C.white : '#C2C8D2'}
                />
                <Text style={[styles.trainText, !canTrain && styles.trainTextOff]}>
                  开始训练
                </Text>
              </TouchableOpacity>
            )}

            {/* 休息日不需要勾选：给一个静态的月亮标记，不给「可以点」的按钮 */}
            {isRest ? (
              <View style={styles.restMark}>
                <Ionicons name="moon" size={22} color={C.typeDot.rest} />
              </View>
            ) : (
              <CompletionButton state={state} onPress={() => onToggleComplete(item.id)} />
            )}
          </View>
        </View>
      </ScrollView>

      {/* 底部按钮 */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.editBtn} onPress={() => onEdit(item)} activeOpacity={0.85}>
          <Ionicons name="create-outline" size={16} color={C.white} />
          <Text style={styles.editText}>编辑日程</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={remove} activeOpacity={0.85}>
          <Ionicons name="trash-outline" size={16} color={C.none} />
          <Text style={styles.deleteText}>删除</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  circle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },

  hero: {
    backgroundColor: C.soft, borderRadius: 16, padding: 18, marginBottom: 18,
  },
  heroTag: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', backgroundColor: C.white,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginBottom: 12,
  },
  heroDot: { width: 7, height: 7, borderRadius: 4 },
  heroTagText: { fontSize: 11, fontWeight: '500' },
  heroTitle: { fontSize: 20, fontWeight: '600', color: C.text, marginBottom: 10 },
  heroTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroTime: { fontSize: 11, color: C.gray },

  infoCard: {
    borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 16, marginBottom: 20,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', height: 54 },
  infoIconBox: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: '#EAF1FE', alignItems: 'center', justifyContent: 'center',
  },
  infoLabel: { fontSize: 13, color: C.gray, marginLeft: 12 },
  infoValue: { fontSize: 13, color: C.text, marginLeft: 'auto', fontWeight: '500' },
  divider: { height: 1, backgroundColor: C.line, marginLeft: 42 },

  noteCard: {
    backgroundColor: C.soft, borderRadius: 14,
    padding: 16,
  },
  noteLabel: { fontSize: 12, color: C.gray, marginBottom: 8 },
  noteText: { fontSize: 13, color: C.text, lineHeight: 21 },
  noteEmpty: { color: C.gray },
  /*
   * 视频位在白卡里、白卡又在灰底上：必须用白底 + 描边，
   * 否则和 noteCard 的浅灰同色，两块会连成一片，看不出是两个板块。
   */
  videoSlot: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 14, borderRadius: 12,
    backgroundColor: C.white,
    borderWidth: 1, borderColor: C.line,
  },
  videoSlotText: { flex: 1, fontSize: 11.5, color: C.gray, lineHeight: 16 },

  // 完成情况卡片：左文字 + 右圆形按钮
  doneCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingLeft: 16, paddingRight: 14, paddingVertical: 12, marginTop: 14,
  },
  doneTexts: { flex: 1, paddingRight: 10 },
  doneRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trainBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 30, paddingHorizontal: 11, borderRadius: 15,
    backgroundColor: C.primary,
  },
  trainBtnOff: { backgroundColor: '#F1F3F7' },
  trainText: { fontSize: 11.5, color: C.white, fontWeight: '600' },
  trainTextOff: { color: '#C2C8D2' },
  // 休息日替代完成按钮的静态标记：尺寸和 CompletionButton 的 46 圆对齐，布局不跳
  restMark: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#EFF3F5', alignItems: 'center', justifyContent: 'center',
  },
  doneTitle: { fontSize: 13, color: C.text, fontWeight: '500', marginBottom: 5 },
  doneSub: { fontSize: 11, color: C.gray },
  doneSubLate: { color: C.danger },

  footer: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 20, paddingBottom: 20, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: C.line,
  },
  editBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14,
  },
  editText: { color: C.white, fontSize: 14, fontWeight: '600' },
  deleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: '#F0C4C4', borderRadius: 12, paddingVertical: 14,
  },
  deleteText: { color: C.none, fontSize: 14, fontWeight: '500' },
});

// 父级每次重渲染都会重建元素，memo 让本页在 props 没变时跳过重渲染
export default memo(DetailScreen);
