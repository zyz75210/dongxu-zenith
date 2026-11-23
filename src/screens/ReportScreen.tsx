import React, { memo, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { C } from '../theme';
import { Schedule, ScheduleType } from '../data';
import { TYPE_NAME } from '../components/ScheduleCapsule';
import { dateKeyOf, isFinished } from '../utils/date';

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** 类型展示的兜底顺序：数量相同的时候按这个排 */
const TYPES: ScheduleType[] = ['rope', 'fitness', 'run', 'rest'];

// 环形进度：外径正好 RING，线宽全部落在里面，不会超出画布
const RING = 126;
const R = 55;
const STROKE = 12;
const CIRC = 2 * Math.PI * R;

type Props = {
  schedules: Schedule[];
  /** 每次进入都把月份重置到当前月：报告默认看"这个月" */
  visible: boolean;
  onBack: () => void;
};

/**
 * 数据报告 —— 按月看两件事：完成率、类型分布。
 *
 * 边界一律按「该月有没有日程」算，不把没安排的空白日算进分母：
 * 分母如果掺进空白日，完成率会常年是个位数，数字就没有参考价值了。
 * 所以这里的完成率 = 该月已完成的日程数 / 该月日程总数。
 */
function ReportScreen({ schedules, visible, onBack }: Props) {
  const today = useMemo(() => new Date(), []);
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });

  // 每次重新进入回到当前月：上次看到 3 月，这次进来还停在 3 月会让人误以为是本月
  useEffect(() => {
    if (!visible) return;
    setYm({ y: today.getFullYear(), m: today.getMonth() });
  }, [visible, today]);

  const monthKey = `${ym.y}-${pad2(ym.m + 1)}`;

  const { total, done, undone, pct, byType } = useMemo(() => {
    const rows = schedules.filter((s) => s.date.startsWith(monthKey));
    // 休息日日期到了就算完成（统一走 isFinished），和首页 / 我的 口径保持一致
    const nowKey = dateKeyOf(new Date());
    const doneCount = rows.filter((s) => isFinished(s, nowKey)).length;

    // 一次遍历把六类的数量数出来，避免每类各扫一遍列表
    const count: Record<string, number> = {};
    for (const s of rows) count[s.type] = (count[s.type] ?? 0) + 1;

    const list = TYPES.map((type, i) => ({
      type,
      n: count[type] ?? 0,
      pct: rows.length ? Math.round(((count[type] ?? 0) / rows.length) * 100) : 0,
      i,
    }))
      // 数量多的在前，一样多按 TYPES 顺序，保证每月看起来是同一种排法
      .sort((a, b) => b.n - a.n || a.i - b.i);

    return {
      total: rows.length,
      done: doneCount,
      undone: rows.length - doneCount,
      pct: rows.length ? Math.round((doneCount / rows.length) * 100) : 0,
      byType: list,
    };
  }, [schedules, monthKey]);

  const atCurrentMonth =
    ym.y === today.getFullYear() && ym.m === today.getMonth();

  const shift = (delta: number) => {
    setYm((cur) => {
      const d = new Date(cur.y, cur.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const ringDash = (CIRC * pct) / 100;
  // 100% 给一点奖励色：满勤的月份值得和"完成八成"看起来不一样
  const ringColor = pct >= 100 ? C.done : C.primary;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.circle} onPress={onBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back-outline" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>数据报告</Text>
        <View style={styles.headerGhost} />
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* 月份切换：只往回看，未来的月份还不是"报告" */}
        <View style={styles.monthBar}>
          <TouchableOpacity style={styles.monthBtn} onPress={() => shift(-1)} activeOpacity={0.7}>
            <Ionicons name="chevron-back-outline" size={16} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{ym.y} 年 {ym.m + 1} 月</Text>
          <TouchableOpacity
            style={[styles.monthBtn, atCurrentMonth && styles.monthBtnOff]}
            onPress={() => shift(1)}
            disabled={atCurrentMonth}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-forward-outline" size={16} color={atCurrentMonth ? C.line : C.text} />
          </TouchableOpacity>
        </View>

        {/* 完成率：左边环形，右边三个数，一屏之内看完 */}
        <View style={styles.card}>
          <View style={styles.ringWrap}>
            <Svg width={RING} height={RING}>
              <Circle
                cx={RING / 2} cy={RING / 2} r={R}
                stroke={C.line} strokeWidth={STROKE} fill="none"
              />
              {pct > 0 && (
                <Circle
                  cx={RING / 2} cy={RING / 2} r={R}
                  stroke={ringColor} strokeWidth={STROKE} fill="none"
                  strokeDasharray={`${ringDash} ${CIRC}`}
                  strokeLinecap="round"
                  // 从 12 点开始顺时针长，符合读表盘的直觉
                  transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                />
              )}
            </Svg>
            <View style={styles.ringCenter} pointerEvents="none">
              <Text style={styles.ringPct}>{total ? `${pct}%` : '—'}</Text>
              <Text style={styles.ringLabel}>完成率</Text>
            </View>
          </View>

          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>日程总数</Text>
              <Text style={styles.metricNum}>{total}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>已完成</Text>
              <Text style={[styles.metricNum, total > 0 && { color: C.done }]}>{done}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>未完成</Text>
              <Text style={[styles.metricNum, undone > 0 && { color: C.gray }]}>{undone}</Text>
            </View>
          </View>
        </View>

        {/* 类型分布 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>类型分布</Text>
          <Text style={styles.sectionMore}>{total} 条</Text>
        </View>

        {total === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="bar-chart-outline" size={26} color="#C9CED8" />
            <Text style={styles.emptyText}>这个月还没有日程记录</Text>
            <Text style={styles.emptyHint}>在日历里添加之后，这里会自动生成分布</Text>
          </View>
        ) : (
          <View style={styles.typeList}>
            {byType.map(({ type, n, pct: p }) => (
              <View key={type} style={styles.typeRow}>
                <View style={styles.typeHead}>
                  <View style={[styles.typeDot, { backgroundColor: C.typeDot[type] }]} />
                  <Text style={styles.typeName}>{TYPE_NAME[type]}</Text>
                  <Text style={styles.typeValue}>{n} 条 · {p}%</Text>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.bar,
                      {
                        // 有记录就先给一段最小可见长度，否则 1/50 会被算成像素级细线
                        width: n > 0 ? `${Math.max(p, 3)}%` : 0,
                        backgroundColor: C.typeDot[type],
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footnote}>
          统计范围：日历里录入的全部日程；完成率 = 已完成 / 该月日程总数。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 30 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 14, marginBottom: 10,
  },
  circle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: C.text, marginLeft: 12 },
  headerGhost: { width: 34 },

  monthBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 18, marginTop: 6, marginBottom: 16,
  },
  monthBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },
  monthBtnOff: { backgroundColor: '#FAFBFC' },
  monthText: { fontSize: 15, fontWeight: '600', color: C.text, minWidth: 116, textAlign: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.line, borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 18, marginBottom: 24,
  },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringCenter: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  ringPct: { fontSize: 28, fontWeight: '700', color: C.text, letterSpacing: -0.5 },
  ringLabel: { fontSize: 11, color: C.gray, marginTop: 2 },

  metrics: { flex: 1, marginLeft: 18, gap: 12 },
  metric: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  metricLabel: { fontSize: 12, color: C.gray },
  metricNum: { fontSize: 19, fontWeight: '600', color: C.text },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: C.text },
  sectionMore: { fontSize: 11, color: C.gray },

  typeList: { gap: 16 },
  typeRow: {},
  typeHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  typeDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  typeName: { fontSize: 12, color: C.text },
  typeValue: { fontSize: 11, color: C.gray, marginLeft: 'auto' },
  track: { height: 7, borderRadius: 4, backgroundColor: C.soft, overflow: 'hidden' },
  bar: { height: 7, borderRadius: 4 },

  empty: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 34, gap: 6,
    borderWidth: 1, borderColor: C.line, borderRadius: 16, borderStyle: 'dashed',
  },
  emptyText: { fontSize: 12, color: C.gray, marginTop: 4 },
  emptyHint: { fontSize: 11, color: '#B9BFCA' },

  footnote: { fontSize: 10, color: '#B9BFCA', marginTop: 22, lineHeight: 16 },
});

/** memo：报告页只在打开时才有意义，别让 App 侧的轻提示 / 面板开关带着它一起重算月份统计 */
export default memo(ReportScreen);
