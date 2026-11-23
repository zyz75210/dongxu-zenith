import React, { memo } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, WEEK_DAYS } from '../theme';
import { Schedule } from '../data';
import { dateKeyOf, parseDateKey, timeToMinutes, weekdayIndex } from '../utils/date';
import CompletionButton, { CompletionState } from '../components/CompletionButton';

type Props = {
  item: Schedule;
  onBack: () => void;
  onEdit: (item: Schedule) => void;
  onDelete: (id: string) => void;
  onToggleComplete: (id: string) => void;
};

const typeName: Record<string, string> = {
  rope: '跳绳', fitness: '体能', run: '跑步', rest: '休息',
};

function DetailScreen({
  item, onBack, onEdit, onDelete, onToggleComplete,
}: Props) {
  const remove = () => {
    Alert.alert('删除日程', `确定删除「${item.title}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => onDelete(item.id) },
    ]);
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
    { icon: 'pricetag-outline', label: '类型', value: typeName[item.type] ?? '其他' },
    { icon: 'notifications-outline', label: '提醒', value: item.remind ? '提前 15 分钟' : '不提醒' },
  ];

  // 完成状态：已完成 > 隔天仍未完成（超时）> 待完成
  const todayKey = dateKeyOf(new Date());
  const state: CompletionState = item.completed
    ? 'done'
    : item.date < todayKey
      ? 'overdue'
      : 'pending';

  const stateText =
    state === 'done'
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

        {/* 完成情况：圆形按钮，点一下切换完成 / 未完成 */}
        <View style={styles.doneCard}>
          <View style={styles.doneTexts}>
            <Text style={styles.doneTitle}>完成情况</Text>
            <Text style={[styles.doneSub, state === 'overdue' && styles.doneSubLate]}>
              {stateText}
            </Text>
          </View>
          <CompletionButton state={state} onPress={() => onToggleComplete(item.id)} />
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

  // 完成情况卡片：左文字 + 右圆形按钮
  doneCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingLeft: 16, paddingRight: 14, paddingVertical: 12, marginTop: 14,
  },
  doneTexts: { flex: 1, paddingRight: 10 },
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
