import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C } from '../theme';
import { Schedule, ScheduleType } from '../data';
import ScheduleStatusPill, { PillState } from './ScheduleStatusPill';

/** 类型中文名：tag 缺失时兜底 */
export const TYPE_NAME: Record<ScheduleType, string> = {
  rope: '跳绳', fitness: '体能', run: '跑步', rest: '休息',
};

type Props = {
  item: Schedule;
  /** 今天的日期键：用来判断"隔天未完成 = 超时" */
  todayKey: string;
  /** 点整条：看详情 */
  onPress: () => void;
  /** 点右侧类型胶囊：切换完成状态 */
  onToggle: () => void;
  /** 可选：点「去训练」入口（仅主页当天列表传，历史页不传就不显示） */
  onGoTrain?: () => void;
};

/**
 * 日程胶囊 —— 主页当天列表和历史日程共用同一个组件，
 * 这样两处的圆角、内边距、字号、状态胶囊完全一致（改一处两边同步）。
 * 「去训练」入口只在传了 onGoTrain 时显示（主页），历史页不显示。
 */
function ScheduleCapsule({ item, todayKey, onPress, onToggle, onGoTrain }: Props) {
  // 休息日是「计划内的不做事」：不需要勾完成，胶囊只作状态标识，不给点击暗示
  const isRest = item.type === 'rest';
  const state: PillState = isRest
    ? 'rest'
    : item.completed
      ? 'done'
      : item.date < todayKey
        ? 'overdue'
        : 'default';

  return (
    <TouchableOpacity style={styles.capsule} activeOpacity={0.75} onPress={onPress}>
      <View style={[styles.dot, { backgroundColor: C.typeDot[item.type] }]} />
      <View style={styles.body}>
        <Text
          style={[styles.title, !isRest && item.completed && styles.titleDone]}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.time}>{item.start} — {item.end}</Text>
          {/* 休息日不该出现「去训练」入口，那和这天的安排是矛盾的 */}
          {onGoTrain && !isRest && (
            <TouchableOpacity
              style={styles.goTrain}
              activeOpacity={0.6}
              onPress={onGoTrain}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.goTrainText}>去训练 ›</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <ScheduleStatusPill
        label={isRest ? '休息日' : (item.completed ? '已完成' : (item.tag || TYPE_NAME[item.type]))}
        state={state}
        onPress={isRest ? undefined : onToggle}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  capsule: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.white,
    borderWidth: 1, borderColor: C.line,
    borderRadius: 999,
    paddingVertical: 13, paddingHorizontal: 16,
    marginBottom: 10,
  },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 12 },
  body: { flex: 1 },
  title: { fontSize: 13, fontWeight: '500', color: C.text },
  // 已完成：标题删除线 + 转灰（完成态三重信号之一）
  titleDone: { textDecorationLine: 'line-through', color: C.gray },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  time: { fontSize: 11, color: C.sub },
  goTrain: { marginLeft: 10 },
  goTrainText: { fontSize: 12, color: C.primary, fontWeight: '500' },
});

// 列表里可能有几十条，memo 让没变化的那几条跳过重渲染
export default memo(ScheduleCapsule);
