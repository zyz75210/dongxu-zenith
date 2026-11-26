import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';
import {
  computeStats, durationWord, formatDuration, MODE_WORD, STANDARD,
  type StyleBest, type Workout, type WorkoutStats,
} from '../workout';
import { jumpStyleLabel, type JumpStyle } from '../jumpStyle';
import { dateKeyOf } from '../utils/date';

/**
 * 解析成绩页搜索输入。和主页的 parseDateInput 不同：
 *   这里支持「只输月份」和「完整年月日」两种，返回归一化的范围键。
 *   - 2026.11       → { year: 2026, month: 10 }（筛整月）
 *   - 2026.11.25    → { year: 2026, month: 10, day: 25 }（筛单天）
 *   - 20261125      → 同上（8 位数字按 YYYYMMDD 切）
 * 认不出返回 null。
 */
function parseWorkoutQuery(raw: string): { year: number; month: number; day?: number } | null {
  const s = raw.trim();
  if (!s) return null;

  let parts: number[];
  if (/[./\-\s年月]/.test(s)) {
    parts = s.split(/[./\-\s年月]+/).filter(Boolean).map(Number);
  } else if (/^\d{8}$/.test(s)) {
    parts = [Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8))];
  } else if (/^\d{6}$/.test(s)) {
    // 6 位数字：YYYYMM
    parts = [Number(s.slice(0, 4)), Number(s.slice(4, 6))];
  } else {
    return null;
  }

  if (parts.some((n) => !Number.isInteger(n))) return null;
  const y = parts[0];
  const m = parts[1];
  if (y < 1900 || y > 2999 || m < 1 || m > 12) return null;

  // 只有年月
  if (parts.length === 2) return { year: y, month: m - 1 };

  // 年月日
  const d = parts[2];
  if (d < 1 || d > new Date(y, m, 0).getDate()) return null;
  return { year: y, month: m - 1, day: d };
}

/** 一个日期分组：标题 + 该组内的记录 */
type Group = { key: string; title: string; items: Workout[] };

type Props = {
  active: boolean;
  workouts: Workout[];
  onBack: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

/** 左侧日期块拆成两行：年份在上、月.日在下面 */
function splitDate(at: number) {
  const d = new Date(at);
  return {
    year: String(d.getFullYear()),
    md: `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
  };
}

/**
 * 成绩页：训练记录的单一入口。
 *
 * 训练页底部「成绩」和右上角三点里的「历史成绩」都指向这里 ——
 * 两个入口、一个页面，不会出现两套各自维护的记录。
 *
 * 版式：顶部一块统计（本月次数 / 连续天数 / 两种跳法的最好成绩），
 * 下面一条条胶囊记录。统计置顶是因为「我最近练得怎么样」比
 * 「我 11 月 23 日练了什么」更常被看。
 */
function WorkoutListScreen({
  active, workouts, onBack, onRename, onDelete,
}: Props) {
  /** 正在编辑的记录；null = 弹窗关着 */
  const [editing, setEditing] = useState<Workout | null>(null);
  const [draft, setDraft] = useState('');
  /** 页面内轻提示（视频待开发、统计口径说明都用它） */
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 搜索：右上角搜索按钮 → 顶栏换成输入框 → 按日期筛本页记录 */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const stats: WorkoutStats = useMemo(() => computeStats(workouts), [workouts]);

  /** 当前搜索条件（null = 没在筛选，显示全部） */
  const filter = useMemo(() => parseWorkoutQuery(query), [query]);

  /**
   * 过滤 + 按日期分组。
   * 顺序：先按 filter 过滤（筛月 / 筛日），再把「今天」「昨天」单独拎出来置顶，
   * 其余按「YYYY年M月」归组，组内按时间倒序。
   */
  const groups = useMemo<Group[]>(() => {
    const now = new Date();
    const todayKey = dateKeyOf(now);
    const yesterday = new Date(now.getTime() - 86400000);
    const yesterdayKey = dateKeyOf(yesterday);

    // 先过滤
    let list = workouts;
    if (filter) {
      list = workouts.filter((w) => {
        const d = new Date(w.at);
        if (d.getFullYear() !== filter.year || d.getMonth() !== filter.month) return false;
        if (filter.day !== undefined && d.getDate() !== filter.day) return false;
        return true;
      });
    }

    // 再按时间倒序
    const sorted = [...list].sort((a, b) => b.at - a.at);

    const out: Group[] = [];
    const monthMap = new Map<string, Group>();

    for (const w of sorted) {
      const key = dateKeyOf(new Date(w.at));
      let group: Group;
      if (key === todayKey) {
        group = out[0]?.key === '__today__'
          ? out[0]
          : { key: '__today__', title: '今天', items: [] };
        if (out[0]?.key !== '__today__') out.unshift(group);
      } else if (key === yesterdayKey) {
        // 昨天：跟在今天后面
        group = out[0]?.key === '__yesterday__'
          ? out[0]
          : { key: '__yesterday__', title: '昨天', items: [] };
        const todayIdx = out.findIndex((g) => g.key === '__today__');
        if (todayIdx === -1) {
          if (out[0]?.key !== '__yesterday__') out.unshift(group);
        } else if (out[todayIdx + 1]?.key !== '__yesterday__') {
          out.splice(todayIdx + 1, 0, group);
        }
      } else {
        const d = new Date(w.at);
        const mk = `${d.getFullYear()}-${d.getMonth()}`;
        const title = `${d.getFullYear()}年${d.getMonth() + 1}月`;
        if (!monthMap.has(mk)) {
          group = { key: mk, title, items: [] };
          monthMap.set(mk, group);
          out.push(group);
        } else {
          group = monthMap.get(mk)!;
        }
      }
      group.items.push(w);
    }

    return out;
  }, [workouts, filter]);

  const openSearch = () => {
    setQuery('');
    setSearchErr(null);
    setSearching(true);
  };

  const closeSearch = () => {
    Keyboard.dismiss();
    setSearching(false);
    setQuery('');
    setSearchErr(null);
  };

  /** 回车执行：合法就留在本页筛选，不合法报错 */
  const runSearch = () => {
    const p = parseWorkoutQuery(query);
    if (!p) {
      setSearchErr('没认出这个日期，格式如 2026.11 或 2026.11.25');
      return;
    }
    Keyboard.dismiss();
    setSearching(false);
    setSearchErr(null);
  };

  const changeQuery = (t: string) => {
    setQuery(t);
    if (searchErr) setSearchErr(null);
  };

  const openEdit = useCallback((w: Workout) => {
    setEditing(w);
    setDraft(w.name);
  }, []);

  const closeEdit = useCallback(() => setEditing(null), []);

  const submit = useCallback(() => {
    if (!editing) return;
    const name = draft.trim();
    if (name) onRename(editing.id, name);
    setEditing(null);
  }, [editing, draft, onRename]);

  if (!active) return null;

  /** 一种跳法的最好成绩：两个档位并排 */
  const renderBest = (style: JumpStyle, b: StyleBest) => {
    const std = STANDARD[style];
    return (
      <View style={styles.bestRow} key={style}>
        <Text style={styles.bestStyle}>{jumpStyleLabel(style)}</Text>

        <View style={styles.bestItem}>
          <Text style={styles.bestCond}>{durationWord(std.timerTarget)}</Text>
          <Text style={styles.bestValue}>
            {b.timer ? `${b.timer.count} 个` : '—'}
          </Text>
        </View>

        <View style={styles.bestItem}>
          <Text style={styles.bestCond}>{std.countTarget} 个</Text>
          <Text style={styles.bestValue}>
            {b.count ? formatDuration(b.count.duration) : '—'}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {searching ? (
        <View style={styles.header}>
          <View style={[styles.searchField, searchErr ? styles.searchFieldErr : null]}>
            <Ionicons name="search" size={15} color={C.gray} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={changeQuery}
              placeholder="例如 2026.11 或 2026.11.25"
              placeholderTextColor={C.gray}
              keyboardType="numbers-and-punctuation"
              autoFocus
              autoCorrect={false}
              maxLength={10}
              returnKeyType="search"
              onSubmitEditing={runSearch}
              selectionColor={C.primary}
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => changeQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={15} color={C.gray} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            activeOpacity={0.6}
            onPress={runSearch}
            disabled={!filter}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          >
            <Text style={[styles.searchGo, !filter && styles.searchGoOff]}>筛选</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={closeSearch}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          >
            <Text style={styles.searchCancel}>取消</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} activeOpacity={0.8} onPress={onBack}>
            <Ionicons name="chevron-back" size={20} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>成绩</Text>
          <TouchableOpacity
            style={styles.searchBtn}
            activeOpacity={0.7}
            onPress={openSearch}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="search" size={18} color={C.text} />
          </TouchableOpacity>
        </View>
      )}

      {searchErr ? (
        <View style={styles.searchErrSlot}>
          <Text style={styles.searchErr}>{searchErr}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {/*
          统计模块。
          点它会说明口径 —— 「最好成绩」不是所有训练里挑最大，
          只认两个固定档位，不说清楚会被当成算错了。
        */}
        <TouchableOpacity
          style={styles.statsCard}
          activeOpacity={0.9}
          onPress={() => showToast(
            `只有标准档位参与评比：换脚跳 ${durationWord(STANDARD.alternate.timerTarget)} / ${STANDARD.alternate.countTarget} 个，`
            + `并脚跳 ${durationWord(STANDARD.together.timerTarget)} / ${STANDARD.together.countTarget} 个`,
          )}
        >
          <View style={styles.sumRow}>
            <View style={styles.sumItem}>
              <Text style={styles.sumLabel}>本月训练</Text>
              <View style={styles.sumValueRow}>
                <Text style={styles.sumValue}>{stats.monthCount}</Text>
                <Text style={styles.sumUnit}>次</Text>
              </View>
            </View>

            <View style={styles.sumDivider} />

            <View style={styles.sumItem}>
              <Text style={styles.sumLabel}>连续训练</Text>
              <View style={styles.sumValueRow}>
                <Text style={styles.sumValue}>{stats.streakDays}</Text>
                <Text style={styles.sumUnit}>天最高</Text>
              </View>
            </View>
          </View>

          <View style={styles.statsLine} />

          <View style={styles.bestHead}>
            <Text style={styles.bestHeadText}>最好成绩</Text>
            <Ionicons name="information-circle-outline" size={13} color={C.gray} />
          </View>

          {renderBest('alternate', stats.best.alternate)}
          {renderBest('together', stats.best.together)}
        </TouchableOpacity>

        {workouts.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="pulse-outline" size={30} color={C.gray} />
            <Text style={styles.emptyTitle}>还没有训练记录</Text>
            <Text style={styles.emptyText}>去训练页开一次，成绩会自动存到这里</Text>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={30} color={C.gray} />
            <Text style={styles.emptyTitle}>这个日期没有训练</Text>
            <Text style={styles.emptyText}>换个月份或日期再试试，或点取消回到全部</Text>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.key}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{g.title}</Text>
                <Text style={styles.groupCount}>{g.items.length} 次</Text>
              </View>
              {g.items.map((w) => {
                const d = splitDate(w.at);
                return (
                  <TouchableOpacity
                    key={w.id}
                    style={styles.pill}
                    activeOpacity={0.8}
                    onPress={() => openEdit(w)}
                  >
                    {/* 左：年份在上、月日在下 */}
                    <View style={styles.dateBox}>
                      <Text style={styles.dateYear}>{d.year}</Text>
                      <Text style={styles.dateMD}>{d.md}</Text>
                    </View>

                    {/* 中：跳法 + 训练内容 / 成绩 */}
                    <View style={styles.pillMain}>
                      <Text style={styles.pillMeta} numberOfLines={1}>
                        {jumpStyleLabel(w.jumpStyle)} · {MODE_WORD[w.mode]}
                        {w.mode === 'timer'
                          ? ` ${durationWord(Math.round(w.target))}`
                          : ` ${w.target} 个`}
                      </Text>
                      <View style={styles.pillValueRow}>
                        <Text style={styles.pillCount}>{w.count}</Text>
                        <Text style={styles.pillCountUnit}>个</Text>
                        <Text style={styles.pillTime}>· {formatDuration(w.duration)}</Text>
                      </View>
                    </View>

                    {/* 右：视频回放（功能未开） */}
                    <TouchableOpacity
                      style={styles.videoBtn}
                      activeOpacity={0.75}
                      onPress={() => showToast('视频回放功能还在开发')}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="play" size={13} color={C.primary} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <Modal
        visible={!!editing}
        transparent
        animationType="fade"
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          style={styles.modalMask}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>训练名称</Text>
            <TextInput
              style={styles.modalInput}
              value={draft}
              onChangeText={(v) => setDraft(v.slice(0, 40))}
              maxLength={40}
              autoFocus
              placeholder="给这次训练起个名字"
              placeholderTextColor={C.gray}
            />

            <TouchableOpacity
              style={styles.deleteRow}
              activeOpacity={0.7}
              onPress={() => {
                if (editing) onDelete(editing.id);
                setEditing(null);
              }}
            >
              <Ionicons name="trash-outline" size={15} color={C.danger} />
              <Text style={styles.deleteText}>删除这条记录</Text>
            </TouchableOpacity>

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.85} onPress={closeEdit}>
                <Text style={styles.cancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.okBtn} activeOpacity={0.85} onPress={submit}>
                <Text style={styles.okText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 19, fontWeight: '700', color: C.text },
  /** 右上角搜索按钮：和主页搜索图标同款圆形小钮 */
  searchBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  count: { fontSize: 12, color: C.sub },

  /* ---- 搜索栏（复用主页搜索的样式语言） ---- */
  searchField: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 36, borderRadius: 18, paddingHorizontal: 12,
    backgroundColor: C.soft,
  },
  searchFieldErr: { backgroundColor: '#FFF4F2' },
  searchInput: { flex: 1, fontSize: 14, color: C.text, paddingVertical: 0 },
  searchGo: { fontSize: 13, fontWeight: '600', color: C.primary, marginLeft: 12 },
  searchGoOff: { color: '#C4C9D2' },
  searchCancel: { fontSize: 13, color: C.sub, marginLeft: 12 },
  searchErrSlot: {
    paddingHorizontal: 16, paddingBottom: 6, marginTop: -6,
  },
  searchErr: { fontSize: 11, color: C.danger },

  /* ---- 分组标题 ---- */
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 4, marginTop: 14, marginBottom: 6,
  },
  groupTitle: { fontSize: 13, fontWeight: '700', color: C.text },
  groupCount: { fontSize: 11, color: C.sub },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 36, gap: 8 },

  /* ---- 顶部统计 ---- */
  statsCard: {
    padding: 14, borderRadius: 18, marginBottom: 4,
    backgroundColor: C.cardSoft,
  },
  sumRow: { flexDirection: 'row', alignItems: 'center' },
  sumItem: { flex: 1, alignItems: 'center', gap: 5 },
  sumLabel: { fontSize: 10.5, color: C.sub },
  sumValueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  sumValue: {
    fontSize: 24, fontWeight: '700', color: C.text,
    fontVariant: ['tabular-nums'], lineHeight: 27,
  },
  sumUnit: { fontSize: 10.5, color: C.sub, marginBottom: 3 },
  sumDivider: { width: 1, height: 30, backgroundColor: '#DFE6F5' },

  statsLine: { height: 1, backgroundColor: '#DFE6F5', marginVertical: 12 },
  bestHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  bestHeadText: { fontSize: 10.5, color: C.sub },

  bestRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5,
  },
  bestStyle: { width: 52, fontSize: 11.5, color: C.text, fontWeight: '600' },
  bestItem: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  bestCond: { fontSize: 10, color: C.gray, minWidth: 40 },
  bestValue: {
    fontSize: 12.5, color: C.text, fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  /* ---- 记录胶囊 ---- */
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, paddingLeft: 13, paddingRight: 11,
    borderRadius: 18,
    backgroundColor: C.soft,
  },
  dateBox: { width: 42, alignItems: 'center' },
  dateYear: { fontSize: 9.5, color: C.gray, letterSpacing: 0.3 },
  dateMD: {
    fontSize: 13, fontWeight: '700', color: C.text,
    fontVariant: ['tabular-nums'], marginTop: 1,
  },

  pillMain: { flex: 1, gap: 3 },
  pillMeta: { fontSize: 11, color: C.sub },
  pillValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  pillCount: {
    fontSize: 17, fontWeight: '700', color: C.text,
    fontVariant: ['tabular-nums'], lineHeight: 20,
  },
  pillCountUnit: { fontSize: 10, color: C.sub },
  pillTime: {
    fontSize: 11, color: C.sub, marginLeft: 3,
    fontVariant: ['tabular-nums'],
  },

  videoBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.white,
    borderWidth: 1, borderColor: '#E4EBF8',
  },

  empty: {
    alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 40, paddingTop: 60, paddingBottom: 40,
  },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 4 },
  emptyText: { fontSize: 12, color: C.sub, textAlign: 'center', lineHeight: 18 },

  toast: {
    position: 'absolute', left: 24, right: 24, bottom: 40,
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12,
    backgroundColor: 'rgba(32,36,49,0.92)',
  },
  toastText: { fontSize: 11.5, color: C.white, lineHeight: 17, textAlign: 'center' },

  modalMask: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%', borderRadius: 18, padding: 18, gap: 12,
    backgroundColor: C.white,
  },
  modalTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  modalInput: {
    height: 44, borderRadius: 12, paddingHorizontal: 13,
    backgroundColor: C.soft, color: C.text, fontSize: 13,
  },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6,
  },
  deleteText: { fontSize: 12, color: C.danger },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 2 },
  cancelBtn: {
    flex: 1, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.soft,
  },
  cancelText: { fontSize: 13, color: C.sub, fontWeight: '600' },
  okBtn: {
    flex: 1, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary,
  },
  okText: { fontSize: 13, color: C.white, fontWeight: '600' },
});

export default memo(WorkoutListScreen);
