import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, WEEK_DAYS } from '../theme';
import { Schedule } from '../data';
import { dateKeyOf, parseDateKey, timeToMinutes, weekdayIndex } from '../utils/date';
import ScheduleCapsule from '../components/ScheduleCapsule';
import Collapse from '../components/Collapse';

type Props = {
  schedules: Schedule[];
  /** 进入本页时为 true：用来把编辑态、展开态复位 */
  visible: boolean;
  onBack: () => void;
  onOpenDetail: (item: Schedule) => void;
  onToggleComplete: (id: string) => void;
  /** 批量删除（按 id），删除后列表由上层 schedules 变化自动刷新 */
  onDeleteMany: (ids: string[]) => void;
};

/** 按天分组 */
type DayGroup = {
  /** YYYY-MM-DD */
  key: string;
  d: number;
  items: Schedule[];
};

/** 按月分组 */
type MonthGroup = {
  /** YYYY-MM */
  key: string;
  y: number;
  m: number; // 0-11
  total: number;
  days: DayGroup[];
};

/** 折角箭头：展开时转 180°，和高度动画同步 */
function Chevron({ open, size = 14 }: { open: boolean; size?: number }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: open ? 1 : 0,
      duration: 240,
      easing: Easing.bezier(0.22, 0.7, 0.28, 1),
      useNativeDriver: true,
    }).start();
  }, [open, v]);

  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="chevron-down" size={size} color={C.gray} />
    </Animated.View>
  );
}

/** 编辑态的圆形勾选框：整月全选时是勾，部分选中时显示一条横杠 */
function Checkbox({
  checked, partial, small, onPress,
}: {
  checked: boolean;
  partial?: boolean;
  small?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={10} activeOpacity={0.7}>
      <View style={[
        styles.check,
        small && styles.checkSmall,
        checked && styles.checkOn,
      ]}>
        {checked ? (
          <Ionicons name="checkmark" size={small ? 11 : 13} color={C.white} />
        ) : partial ? (
          <View style={styles.checkDash} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function HistoryScreen({
  schedules, visible, onBack, onOpenDetail, onToggleComplete, onDeleteMany,
}: Props) {
  const todayKey = useMemo(() => dateKeyOf(new Date()), []);

  /* ---------------- 分组：月 → 天 → 日程（都按时间倒序 / 正序排好） ---------------- */
  const months = useMemo<MonthGroup[]>(() => {
    const bucket = new Map<string, Map<string, Schedule[]>>();
    for (const s of schedules) {
      const mk = s.date.slice(0, 7);
      let days = bucket.get(mk);
      if (!days) {
        days = new Map();
        bucket.set(mk, days);
      }
      const arr = days.get(s.date);
      if (arr) arr.push(s);
      else days.set(s.date, [s]);
    }

    // 月份倒序（最近的在前）、同月内日期倒序、同一天按开始时间正序
    return [...bucket.keys()]
      .sort((a, b) => (a < b ? 1 : -1))
      .map((mk) => {
        const days = bucket.get(mk)!;
        const { y, m } = parseDateKey(`${mk}-01`);
        const groups: DayGroup[] = [...days.keys()]
          .sort((a, b) => (a < b ? 1 : -1))
          .map((dk) => ({
            key: dk,
            d: parseDateKey(dk).d,
            items: days.get(dk)!.slice().sort(
              (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start),
            ),
          }));
        return {
          key: mk,
          y,
          m,
          total: groups.reduce((n, g) => n + g.items.length, 0),
          days: groups,
        };
      });
  }, [schedules]);

  /* ---------------- 展开状态 ---------------- */
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set());
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());

  // 首次进来把最近的那个月展开，一眼就能看到内容和折叠效果
  const inited = useRef(false);
  useEffect(() => {
    if (inited.current || months.length === 0) return;
    inited.current = true;
    setOpenMonths(new Set([months[0].key]));
  }, [months]);

  /* ---------------- 编辑 / 选择状态 ---------------- */
  const [editing, setEditing] = useState(false);
  const [selMonths, setSelMonths] = useState<Set<string>>(() => new Set());
  const [selDays, setSelDays] = useState<Set<string>>(() => new Set());

  // 每次重新进入本页都从干净状态开始（上次的选中不要残留）
  useEffect(() => {
    if (!visible) return;
    setEditing(false);
    setSelMonths(new Set());
    setSelDays(new Set());
  }, [visible]);

  // 真正会被删掉的日程：整月选中 or 单独选中某天
  const selIds = useMemo(
    () => schedules
      .filter((s) => selMonths.has(s.date.slice(0, 7)) || selDays.has(s.date))
      .map((s) => s.id),
    [schedules, selMonths, selDays],
  );
  const selCount = selIds.length;
  const allSelected = months.length > 0 && months.every((m) => selMonths.has(m.key));

  const toggleMonthOpen = (key: string) => {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleDayOpen = (key: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleMonthSel = (key: string) => {
    const on = !selMonths.has(key);
    setSelMonths((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
    // 整月选了就不用再单独记它下面的天，反之也清掉，避免计数重复
    setSelDays((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      prev.forEach((k) => { if (!k.startsWith(key)) next.add(k); });
      return next.size === prev.size ? prev : next;
    });
  };

  const toggleDaySel = (mg: MonthGroup, dk: string) => {
    if (selMonths.has(mg.key)) {
      // 整月已选时点某一天 = "除了这天以外全选"
      const nextMonths = new Set(selMonths);
      nextMonths.delete(mg.key);
      const nextDays = new Set(selDays);
      mg.days.forEach((g) => { if (g.key !== dk) nextDays.add(g.key); });
      setSelMonths(nextMonths);
      setSelDays(nextDays);
      return;
    }
    setSelDays((prev) => {
      const next = new Set(prev);
      if (next.has(dk)) next.delete(dk); else next.add(dk);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelMonths(new Set());
      setSelDays(new Set());
    } else {
      setSelMonths(new Set(months.map((m) => m.key)));
      setSelDays(new Set());
    }
  };

  const toggleEditing = () => {
    setEditing((e) => !e);
    setSelMonths(new Set());
    setSelDays(new Set());
  };

  const askDelete = () => {
    if (selCount === 0) return;
    Alert.alert(
      '删除日程',
      `将删除 ${selCount} 个日程，删除后无法恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            onDeleteMany(selIds);
            setSelMonths(new Set());
            setSelDays(new Set());
            setEditing(false);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      {/* 顶部：返回 / 标题 / 编辑 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.circle} onPress={onBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back-outline" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {editing ? `已选 ${selCount}` : '历史日程'}
        </Text>
        {schedules.length > 0 ? (
          <TouchableOpacity onPress={toggleEditing} hitSlop={10} activeOpacity={0.7}>
            <Text style={styles.editText}>{editing ? '完成' : '编辑'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.editGhost} />
        )}
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.scroll, editing && styles.scrollEditing]}
        showsVerticalScrollIndicator={false}
      >
        {months.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={20} color={C.gray} />
            <Text style={styles.emptyText}>还没有任何日程记录</Text>
          </View>
        ) : (
          <Text style={styles.summary}>
            {editing
              ? '点月份或日期胶囊即可选中，点右侧箭头展开'
              : `共 ${schedules.length} 个日程 · ${months.length} 个月`}
          </Text>
        )}

        {months.map((mg) => {
          const open = openMonths.has(mg.key);
          const monthOn = selMonths.has(mg.key);
          const partial = !monthOn && mg.days.some((g) => selDays.has(g.key));

          return (
            <View key={mg.key} style={styles.monthBlock}>
              {/* 月份胶囊：和主页当天的日程胶囊同一套圆角与内边距 */}
              <View style={[styles.capsule, monthOn && styles.capsuleOn]}>
                {editing && (
                  <Checkbox
                    checked={monthOn}
                    partial={partial}
                    onPress={() => toggleMonthSel(mg.key)}
                  />
                )}
                <TouchableOpacity
                  style={[styles.capsuleMain, editing && styles.capsuleMainEdit]}
                  activeOpacity={0.75}
                  onPress={() => (editing ? toggleMonthSel(mg.key) : toggleMonthOpen(mg.key))}
                >
                  <View style={[styles.dot, { backgroundColor: C.primary }]} />
                  <View style={styles.capsuleBody}>
                    <Text style={styles.capsuleTitle}>{mg.y}年{mg.m + 1}月</Text>
                    <Text style={styles.capsuleSub}>
                      {mg.total} 个日程 · {mg.days.length} 天
                    </Text>
                  </View>
                  {/* 编辑态下胶囊点击是"选中"，展开交给这个箭头（命中区域放大，不改变视觉位置） */}
                  <TouchableOpacity
                    style={styles.chevronHit}
                    activeOpacity={0.6}
                    hitSlop={6}
                    onPress={() => toggleMonthOpen(mg.key)}
                  >
                    <Chevron open={open} />
                  </TouchableOpacity>
                </TouchableOpacity>
              </View>

              {/* 展开：按天折叠的胶囊 */}
              <Collapse open={open}>
                <View style={styles.daysWrap}>
                  {mg.days.map((dg) => {
                    const dOpen = openDays.has(dg.key);
                    const dayOn = monthOn || selDays.has(dg.key);
                    return (
                      <View key={dg.key} style={styles.dayBlock}>
                        <View style={[styles.dayCapsule, dayOn && styles.dayCapsuleOn]}>
                          {editing && (
                            <Checkbox
                              checked={dayOn}
                              small
                              onPress={() => toggleDaySel(mg, dg.key)}
                            />
                          )}
                          <TouchableOpacity
                            style={[styles.capsuleMain, editing && styles.capsuleMainEdit]}
                            activeOpacity={0.75}
                            onPress={() => (editing ? toggleDaySel(mg, dg.key) : toggleDayOpen(dg.key))}
                          >
                            <View style={styles.dayDots}>
                              {dg.items.slice(0, 3).map((it) => (
                                <View
                                  key={it.id}
                                  style={[styles.dayDot, { backgroundColor: C.typeDot[it.type] }]}
                                />
                              ))}
                            </View>
                            <View style={styles.capsuleBody}>
                              {/* 用模板串拼：JSX 里换行会被折成空格，会变成"星期 二" */}
                              <Text style={styles.dayTitle}>
                                {`${mg.m + 1}月${dg.d}日 · 星期${
                                  WEEK_DAYS[weekdayIndex(new Date(mg.y, mg.m, dg.d))]
                                }`}
                              </Text>
                              <Text style={styles.daySub}>
                                {`${dg.items.length} 个日程 · ${dg.items[0].start} 起`}
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={styles.chevronHit}
                              activeOpacity={0.6}
                              hitSlop={6}
                              onPress={() => toggleDayOpen(dg.key)}
                            >
                              <Chevron open={dOpen} size={12} />
                            </TouchableOpacity>
                          </TouchableOpacity>
                        </View>

                        {/* 再展开：当天日程，和主页胶囊完全一致 */}
                        <Collapse open={dOpen}>
                          <View style={styles.itemsWrap}>
                            {dg.items.map((it) => (
                              <ScheduleCapsule
                                key={it.id}
                                item={it}
                                todayKey={todayKey}
                                onPress={() => onOpenDetail(it)}
                                onToggle={() => onToggleComplete(it.id)}
                              />
                            ))}
                          </View>
                        </Collapse>
                      </View>
                    );
                  })}
                </View>
              </Collapse>
            </View>
          );
        })}
      </ScrollView>

      {/* 编辑态底部操作条 */}
      {editing && (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.allBtn} onPress={toggleSelectAll} activeOpacity={0.7}>
            <Text style={styles.allText}>{allSelected ? '取消全选' : '全选'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.delBtn, selCount === 0 && styles.delBtnOff]}
            activeOpacity={0.85}
            onPress={askDelete}
            disabled={selCount === 0}
          >
            <Ionicons name="trash-outline" size={15} color={C.white} />
            <Text style={styles.delText}>
              删除{selCount > 0 ? ` ${selCount} 个` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },
  scrollEditing: { paddingBottom: 100 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 14, marginBottom: 18,
  },
  circle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: C.text, marginLeft: 12 },
  editText: { fontSize: 13, color: C.primary, fontWeight: '500' },
  editGhost: { width: 26 },

  summary: { fontSize: 11, color: C.gray, marginBottom: 12, marginLeft: 4 },

  monthBlock: { marginBottom: 10 },
  capsule: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.white,
    borderWidth: 1, borderColor: C.line,
    borderRadius: 999,
    paddingLeft: 16, paddingRight: 16, paddingVertical: 12,
  },
  capsuleOn: { borderColor: C.primary, backgroundColor: '#F6F9FF' },
  capsuleMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  capsuleMainEdit: { marginLeft: 10 },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 12 },
  capsuleBody: { flex: 1 },
  // 箭头单独可点（编辑态点胶囊是选中，展开靠这里）：用内边距放大命中区，
  // 再用负 margin 抵掉，视觉位置和原来一样贴着右边
  chevronHit: {
    paddingLeft: 10, paddingRight: 4, paddingVertical: 4, marginRight: -4,
    alignItems: 'center', justifyContent: 'center',
  },
  capsuleTitle: { fontSize: 13, fontWeight: '500', color: C.text },
  capsuleSub: { fontSize: 11, color: C.gray, marginTop: 3 },

  daysWrap: { paddingLeft: 12, paddingRight: 12, paddingTop: 10 },
  dayBlock: { marginBottom: 8 },
  dayCapsule: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.soft,
    borderRadius: 999,
    paddingLeft: 14, paddingRight: 14, paddingVertical: 10,
  },
  dayCapsuleOn: { backgroundColor: '#E9F0FE' },
  dayDots: { flexDirection: 'row', gap: 3, width: 26, marginRight: 10 },
  dayDot: { width: 7, height: 7, borderRadius: 4 },
  dayTitle: { fontSize: 12.5, fontWeight: '500', color: C.text },
  daySub: { fontSize: 10.5, color: C.gray, marginTop: 3 },

  itemsWrap: {
    marginLeft: 10, paddingLeft: 10, marginTop: 10, marginBottom: 2,
    borderLeftWidth: 1, borderLeftColor: C.line,
  },

  check: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: '#CBD2DE',
    alignItems: 'center', justifyContent: 'center',
  },
  checkSmall: { width: 19, height: 19, borderRadius: 10 },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },
  checkDash: { width: 8, height: 2, borderRadius: 1, backgroundColor: C.gray },

  empty: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 40, gap: 8, marginTop: 20,
    borderWidth: 1, borderColor: C.line, borderRadius: 18, borderStyle: 'dashed',
  },
  emptyText: { fontSize: 12, color: C.gray },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14,
    backgroundColor: C.white,
    borderTopWidth: 1, borderTopColor: C.line,
  },
  allBtn: {
    paddingHorizontal: 16, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1, borderColor: C.line,
  },
  allText: { fontSize: 13, color: C.text },
  delBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.danger,
    borderRadius: 12, paddingVertical: 12,
  },
  delBtnOff: { backgroundColor: '#F3C6C2' },
  delText: { fontSize: 14, fontWeight: '600', color: C.white },
});

// 内容随 schedules 变化才需要重算，其余时候跳过重渲染
export default memo(HistoryScreen);
