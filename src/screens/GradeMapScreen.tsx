import React, { memo, useMemo, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, {
  Circle, Defs, LinearGradient, Path, Rect, Stop,
} from 'react-native-svg';
import { C } from '../theme';
import {
  GRADE_TAGS, STAGES, ZONE_LABEL, ZONE_RANGE, actionKey,
} from '../content/grades';
import {
  type StageState, gradeTotals, isLit, stagePoint, stageStats, stageStates, unlockNeed,
} from '../content/gradeProgress';

type Props = {
  /** 已掌握的动作 key（`段位-动作`） */
  done: Set<string>;
  onToggle: (key: string) => void;
  onBack: () => void;
};

const NODE = 34;
const BLUE = C.primary;
const BLUE_DEEP = C.primaryDark;
const LOCK = '#C7C9D2';
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** 分区配色：进阶区用深一档的蓝，高阶区压到 55% —— 与设计稿 z1/z2/z3 一致 */
const zoneColor = (z: number) => (z === 2 ? BLUE_DEEP : BLUE);

function GradeMapScreen({ done, onToggle, onBack }: Props) {
  const stats = useMemo(() => stageStats(done), [done]);
  const states = useMemo(() => stageStates(stats), [stats]);
  const totals = useMemo(() => gradeTotals(stats), [stats]);

  /** 手风琴：默认展开当前在练的那一段 */
  const [openStage, setOpenStage] = useState<number | null>(
    () => states.findIndex((s) => s === 'cur'),
  );
  const [tag, setTag] = useState<string>('全部');
  const [detail, setDetail] = useState<{ s: number; a: number } | null>(null);

  const filtering = tag !== '全部';
  const stageHits = useMemo(
    () => STAGES.map((s) => (filtering ? s.actions.filter((a) => a.tags.includes(tag)).length : 0)),
    [tag, filtering],
  );

  /**
   * 当前要显示的段位（筛选时只留有命中的）。
   * 顺带记下「上一个可见段位」的分区：筛掉了四段之后，六段前面的「进阶区」标题要重出一遍，
   * 不能因为原始下标没变就跳过。
   */
  const shownStages = useMemo(() => {
    const list: { i: number; stage: typeof STAGES[number]; prevZone: number }[] = [];
    STAGES.forEach((stage, i) => {
      if (filtering && stageHits[i] === 0) return;
      list.push({ i, stage, prevZone: list.length > 0 ? list[list.length - 1].stage.zone : 0 });
    });
    return list;
  }, [filtering, stageHits]);

  /**
   * 关掉弹层时 detail 立刻变 null，但淡出还要几十毫秒：留一份最后打开的内容，
   * 别让弹层在淡出的那几帧里空着闪一下。（用 state 而不是 ref，渲染期读 ref 会违反 hooks 规则）
   */
  const [lastDetail, setLastDetail] = useState<{ s: number; a: number } | null>(null);
  const openDetail = (s: number, a: number) => {
    setDetail({ s, a });
    setLastDetail({ s, a });
  };
  const shown = detail ?? lastDetail;
  const sheetData = shown ? {
    i: shown.s,
    stage: STAGES[shown.s], action: STAGES[shown.s].actions[shown.a],
    state: states[shown.s], key: actionKey(shown.s, shown.a),
  } : null;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} activeOpacity={0.7} onPress={onBack}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>段位地图</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
      >
        {/* 头部主卡：浅蓝渐变 + 白色图标牌，三个数回答「我现在到哪儿了」 */}
        <View style={styles.hero}>
          <Svg style={styles.heroBg} preserveAspectRatio="none" pointerEvents="none">
            <Defs>
              <LinearGradient id="skillMapBg" x1="0" y1="0" x2="0.45" y2="1">
                <Stop offset="0" stopColor="#EEF3FF" />
                <Stop offset="1" stopColor="#E4ECFF" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#skillMapBg)" />
          </Svg>

          <View style={styles.heroIcon}>
            <Svg
              width={26}
              height={26}
              viewBox="0 0 24 24"
              fill="none"
              stroke={BLUE}
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <Path d="M3 19 L9 13 L7 9 L14 4 L20 7" />
              <Circle cx={3} cy={19} r={1.6} fill={BLUE} />
              <Circle cx={20} cy={7} r={1.6} fill={BLUE} />
            </Svg>
          </View>

          <Text style={styles.heroEn}>SKILL MAP</Text>
          <Text style={styles.heroTitle}>花样跳绳段位地图</Text>
          <Text style={styles.heroDesc}>
            跟着官方九段一路进阶{'\n'}每一步都有据可依
          </Text>

          <View style={styles.heroStats}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{totals.litStages}</Text>
              <Text style={styles.statCap}>已点亮</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{totals.mastered}</Text>
              <Text style={styles.statCap}>掌握动作</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{fmt(totals.points)}</Text>
              <Text style={styles.statCap}>累计积分</Text>
            </View>
          </View>
        </View>

        <Text style={styles.secTitle}>段位徽章</Text>
        <View style={styles.badges}>
          {STAGES.map((s, i) => {
            const st = states[i];
            // 点亮线：本段剩余未掌握 ≤ 2 个，徽章就点亮（不要求全部清完）
            const lit = isLit(stats[i]);
            return (
              <View key={s.lv} style={styles.badge}>
                <View style={[
                  styles.badgeDot,
                  lit ? styles.bDone : st === 'cur' ? styles.bCur : styles.bLock,
                ]}>
                  <Text style={[
                    styles.badgeNum,
                    lit ? styles.badgeNumOn : st === 'cur' ? styles.badgeNumCur : null,
                  ]}>
                    {st === 'lock' ? '·' : i + 1}
                  </Text>
                </View>
                <Text style={[styles.badgeCap, lit && styles.badgeCapOn]}>{s.lv}</Text>
              </View>
            );
          })}
        </View>

        {/* 能力标签筛选：选中后只留有命中的段位与动作 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {['全部', ...GRADE_TAGS].map((t) => {
            const on = t === tag;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.chip, on && styles.chipOn]}
                activeOpacity={0.85}
                onPress={() => setTag(t)}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {shownStages.map(({ i, stage: s, prevZone }) => {
          const st = states[i];
          const stat = stats[i];
          const lit = isLit(stat);
          const pct = stat.total > 0 ? Math.round((stat.got / stat.total) * 100) : 0;
          const expanded = filtering ? stageHits[i] > 0 : openStage === i;
          const showZone = prevZone !== s.zone;
          // 胶囊展开后要换成圆角矩形，阴影层和裁切层必须用同一个半径
          const radius = expanded ? 22 : 999;
          // 保留原始下标：进度 key 是「段位-动作」，筛选后不能重新编号
          const acts = s.actions
            .map((a, idx) => ({ a, idx }))
            .filter((x) => !filtering || x.a.tags.includes(tag));

          return (
            <View key={s.lv}>
              {showZone && (
                <View style={styles.zoneRow}>
                  <View style={[
                    styles.zoneMark,
                    { backgroundColor: zoneColor(s.zone) },
                    s.zone === 3 && styles.zoneMarkHigh,
                  ]} />
                  <Text style={[
                    styles.zoneText,
                    { color: zoneColor(s.zone) },
                    s.zone === 3 && styles.zoneTextHigh,
                  ]}>
                    {ZONE_LABEL[s.zone]}（{ZONE_RANGE[s.zone]}）
                  </Text>
                </View>
              )}

              {/* 阴影在外层、裁切在内层：同一层会被 overflow:hidden 把阴影裁掉 */}
              <View style={[styles.stationWrap, { borderRadius: radius }]}>
                <View style={[styles.station, { borderRadius: radius }]}>
                  <TouchableOpacity
                    style={styles.sHead}
                    activeOpacity={0.85}
                    onPress={() => {
                      // 筛选状态下点一下 = 清掉筛选、展开这一段
                      if (filtering) { setTag('全部'); setOpenStage(i); return; }
                      setOpenStage(expanded ? null : i);
                    }}
                  >
                    <View style={[
                      styles.node,
                      lit ? styles.nDone : st === 'cur' ? styles.nCur : styles.nLock,
                    ]}>
                      <Text style={[
                        styles.nodeText,
                        lit ? styles.nodeTextOn : st === 'cur' ? styles.nodeTextCur : null,
                      ]}>
                        {st === 'lock' ? '·' : i + 1}
                      </Text>
                    </View>

                    <View style={styles.sInfo}>
                      <View style={styles.sTitleRow}>
                        <Text style={styles.sLv}>{s.lv}</Text>
                        <Text style={styles.sTheme} numberOfLines={1}>{s.theme}</Text>
                      </View>
                      <View style={styles.pbar}>
                        <View style={[styles.pfill, {
                          width: `${pct}%` as `${number}%`,
                          backgroundColor: lit ? BLUE : st === 'cur' ? BLUE_DEEP : LOCK,
                        }]} />
                      </View>
                      <Text style={styles.sMeta} numberOfLines={1}>
                        {s.abilities}　·　{stateLabel(st, lit, stat)}　·　{stat.got}/{stat.total}
                      </Text>
                    </View>

                    <Ionicons
                      name={expanded ? 'chevron-down' : 'chevron-forward'}
                      size={17}
                      color={LOCK}
                    />
                  </TouchableOpacity>

                  {expanded && (
                    <View style={styles.acts}>
                      {acts.map(({ a, idx }, pos) => {
                        const key = actionKey(i, idx);
                        const got = done.has(key);
                        // 设计稿里动作时间轴的最后一项不再往下画线，末端留白
                        const last = pos === acts.length - 1;
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.act, st === 'lock' && styles.actLock]}
                            activeOpacity={0.7}
                            onPress={() => openDetail(i, idx)}
                          >
                            <View style={[styles.actRail, last && styles.actRailEnd]} pointerEvents="none" />
                            <View style={[styles.actDot, got && styles.actDotOn]} />
                            <View style={styles.actBody}>
                              <View style={styles.actNameRow}>
                                <Text style={styles.actName}>{a.name}</Text>
                                {a.code !== '' && (
                                  <Text style={styles.actCode}>{a.code}</Text>
                                )}
                              </View>
                              <Text style={styles.actPre}>
                                {a.pre === '无' ? '无前置' : `前置：${a.pre}`}
                              </Text>
                            </View>
                            {got && (
                              <Ionicons name="checkmark-circle" size={16} color={BLUE} />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
            </View>
          );
        })}

        {/* 图例：颜色语义 + 解锁/依赖两条规则 */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>地图规则</Text>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: BLUE }]} />
            <Text style={styles.legendText}>已点亮</Text>
            <View style={[styles.legendDot, styles.legendDotCur]} />
            <Text style={styles.legendText}>学习中</Text>
            <View style={[styles.legendDot, { backgroundColor: LOCK }]} />
            <Text style={styles.legendText}>未解锁</Text>
          </View>
          <Text style={styles.legendBody}>
            <Text style={styles.legendStrong}>点亮：</Text>这一段剩余不超过 2 个动作，段位与徽章点亮
          </Text>
          <Text style={styles.legendBody}>
            <Text style={styles.legendStrong}>解锁：</Text>上一段掌握过半，下一段就能开始挑战
          </Text>
          <Text style={styles.legendBody}>
            <Text style={styles.legendStrong}>通关：</Text>整段动作全部掌握，才算拿下这一段
          </Text>
          <Text style={styles.legendBody}>
            <Text style={styles.legendStrong}>积分：</Text>一~三段 5 分 · 四~五段 10 分 · 六~八段 20 分 · 九段 30 分
          </Text>
          <Text style={styles.legendBody}>
            <Text style={styles.legendStrong}>依赖：</Text>基础先行 · 摇数逐级 · 后摇 / 缠绕最后
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={detail !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.mask}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDetail(null)} />
          {sheetData && (
            <View style={styles.sheet}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.sheetHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>{sheetData.action.name}</Text>
                    {sheetData.action.code !== '' && (
                      <Text style={styles.sheetCode}>编码 {sheetData.action.code}</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.sheetClose}
                    activeOpacity={0.7}
                    onPress={() => setDetail(null)}
                  >
                    <Ionicons name="close" size={18} color={C.gray} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldKey}>所属段位</Text>
                <Text style={styles.fieldVal}>
                  {sheetData.stage.lv} · {sheetData.stage.theme}
                </Text>

                <Text style={styles.fieldKey}>积分</Text>
                <Text style={styles.fieldVal}>掌握后 +{stagePoint(sheetData.i)} 分</Text>

                <Text style={styles.fieldKey}>能力标签</Text>
                <View style={styles.tagWrap}>
                  {sheetData.action.tags.map((t) => (
                    <View key={t} style={styles.tagChip}>
                      <Text style={styles.tagChipText}>{t}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.fieldKeyRow}>
                  <Text style={styles.fieldKeyInline}>前置技能</Text>
                  <Text style={styles.builtIn}>内置数据</Text>
                </View>
                <View style={styles.preBox}>
                  <Text style={styles.preBoxText}>
                    {sheetData.action.pre === '无'
                      ? '无前置，起点即可学习'
                      : `先掌握：${sheetData.action.pre}`}
                  </Text>
                </View>

                <Text style={styles.fieldKey}>技巧要点 · Drill 拆解</Text>
                {sheetData.action.drill.map((d, idx) => (
                  <View key={`${idx}-${d}`} style={styles.drillRow}>
                    <View style={styles.drillNum}>
                      <Text style={styles.drillNumText}>{idx + 1}</Text>
                    </View>
                    <Text style={styles.drillText}>{d}</Text>
                  </View>
                ))}

                <Text style={styles.fieldKey}>通关标准</Text>
                <View style={styles.stdBox}>
                  <Text style={styles.stdText}>
                    动作准确 + 熟练 + 合拍 + 衔接流畅，模拟考评 ≥60 分通过。
                  </Text>
                </View>

                <Text style={styles.fieldKey}>示范视频</Text>
                <View style={styles.videoBox}>
                  <Ionicons name="videocam-outline" size={17} color={C.gray} />
                  <Text style={styles.videoText}>正面 + 侧面慢动作示范 · 制作中</Text>
                </View>

                {sheetData.state === 'lock' && (
                  <Text style={styles.lockHint}>
                    {`解锁条件：把 ${STAGES[sheetData.i - 1].lv} 掌握过半（`
                      + `${stats[sheetData.i - 1].got}/${unlockNeed(stats[sheetData.i - 1].total)}）就能开始挑战`}
                  </Text>
                )}

                <TouchableOpacity
                  style={[
                    styles.markBtn,
                    sheetData.state === 'lock' && styles.markBtnAfterHint,
                    sheetData.state === 'lock' && styles.markBtnLocked,
                    done.has(sheetData.key) && styles.markBtnDone,
                  ]}
                  activeOpacity={0.9}
                  disabled={sheetData.state === 'lock'}
                  onPress={() => onToggle(sheetData.key)}
                >
                  <Text style={[
                    styles.markText,
                    done.has(sheetData.key) && styles.markTextDone,
                  ]}>
                    {sheetData.state === 'lock'
                      ? '上一段掌握过半即可解锁'
                      : done.has(sheetData.key) ? '取消已掌握' : '标记为已掌握'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

function stateLabel(st: StageState, lit: boolean, stat: { total: number; got: number }) {
  // 全部掌握才算通关；点亮只代表「快到了」，两者不混
  if (stat.got >= stat.total) return '已通关';
  if (lit) return `点亮 · 差 ${stat.total - stat.got} 个`;
  // 解锁了但一个动作都没标记，说「可挑战」比「学习中」准确
  if (st === 'cur') return stat.got > 0 ? '学习中' : '可挑战';
  return '待解锁';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.soft },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8,
  },
  back: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.3 },

  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28 },

  hero: {
    borderRadius: 20,
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14,
    alignItems: 'center',
    marginBottom: 16,
    overflow: 'hidden',
    // 渐变没画上时的兜底色，与渐变起点同色
    backgroundColor: '#EEF3FF',
  },
  // 四边各多 1px：SVG 量到的尺寸偶尔比卡片小半点，卡片底色会沿边露出来
  heroBg: { position: 'absolute', left: -1, right: -1, top: -1, bottom: -1 },
  heroIcon: {
    width: 44, height: 44, borderRadius: 13, backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
    boxShadow: '0 4px 12px rgba(74,124,247,0.15)',
  },
  heroEn: { fontSize: 9, letterSpacing: 2, color: BLUE, fontWeight: '800', marginBottom: 3 },
  heroTitle: { fontSize: 17, fontWeight: '800', color: C.text, marginBottom: 4 },
  heroDesc: { fontSize: 11, color: C.gray, lineHeight: 17, textAlign: 'center' },
  heroStats: {
    flexDirection: 'row', marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(91,141,239,0.15)',
    width: '100%',
  },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 15, fontWeight: '800', color: BLUE, marginBottom: 1 },
  statCap: { fontSize: 9, color: C.gray },

  secTitle: { fontSize: 13, fontWeight: '700', color: '#3C3C43', marginBottom: 10, marginLeft: 2 },
  badges: {
    flexDirection: 'row', backgroundColor: C.white, borderRadius: 18,
    paddingVertical: 14, paddingHorizontal: 8, marginBottom: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#EDEFF5',
    boxShadow: '0 1px 4px rgba(30,41,59,0.04)',
  },
  badge: { flex: 1, alignItems: 'center' },
  badgeDot: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  bDone: { backgroundColor: BLUE },
  bCur: { backgroundColor: C.white, borderWidth: 2, borderColor: BLUE },
  bLock: { backgroundColor: LOCK },
  badgeNum: { fontSize: 11, fontWeight: '800', color: C.white },
  badgeNumOn: { color: C.white },
  badgeNumCur: { color: BLUE },
  badgeCap: { fontSize: 9, color: C.gray },
  badgeCapOn: { color: BLUE, fontWeight: '700' },

  filters: { gap: 7, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 12, height: 28, borderRadius: 14,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.white,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: BLUE, borderColor: BLUE },
  chipText: { fontSize: 11, color: C.gray },
  chipTextOn: { color: C.white, fontWeight: '700' },

  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 9, marginLeft: 4 },
  zoneMark: { width: 8, height: 8, borderRadius: 3 },
  zoneMarkHigh: { opacity: 0.55 },
  zoneText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  zoneTextHigh: { opacity: 0.55 },

  // 阴影层：胶囊态是 999，展开态由 radius 覆盖成 22
  stationWrap: {
    backgroundColor: C.white,
    marginBottom: 9,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#EDEFF5',
    boxShadow: '0 2px 8px rgba(30,41,59,0.05)',
  },
  station: { backgroundColor: C.white, overflow: 'hidden' },
  sHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 11 },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, alignItems: 'center', justifyContent: 'center' },
  nDone: { backgroundColor: BLUE },
  nCur: { backgroundColor: C.white, borderWidth: 2, borderColor: BLUE },
  nLock: { backgroundColor: LOCK },
  nodeText: { fontSize: 13, fontWeight: '800', color: C.white },
  nodeTextOn: { color: C.white },
  nodeTextCur: { color: BLUE },

  sInfo: { flex: 1, minWidth: 0 },
  sTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sLv: { fontSize: 15, fontWeight: '700', color: C.text },
  sTheme: { fontSize: 11, color: C.gray, flexShrink: 1 },
  pbar: { height: 4, borderRadius: 4, backgroundColor: C.line, marginTop: 7, overflow: 'hidden' },
  pfill: { height: '100%', borderRadius: 4 },
  sMeta: { fontSize: 10, color: C.gray, marginTop: 5 },

  acts: { backgroundColor: '#F5F8FF', paddingLeft: 30, paddingRight: 18, paddingTop: 4, paddingBottom: 14 },
  act: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 9, paddingLeft: 18 },
  actLock: { opacity: 0.55 },
  actRail: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 1.5,
    backgroundColor: '#E4E8F0',
  },
  actRailEnd: { backgroundColor: 'transparent' },
  actDot: {
    position: 'absolute', left: -4, top: 13,
    width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: C.white, borderWidth: 1.5, borderColor: LOCK,
  },
  actDotOn: { backgroundColor: BLUE, borderColor: BLUE },
  actBody: { flex: 1, paddingRight: 8 },
  actNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  actName: { fontSize: 12, fontWeight: '600', color: C.text },
  actCode: {
    fontSize: 10, color: BLUE, backgroundColor: '#EEF3FF',
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
    overflow: 'hidden',
  },
  actPre: { fontSize: 10, color: C.gray, marginTop: 2 },

  legend: {
    marginTop: 18, backgroundColor: C.white, borderRadius: 18,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#EDEFF5',
    boxShadow: '0 1px 4px rgba(30,41,59,0.04)',
  },
  legendTitle: { fontSize: 11, fontWeight: '700', color: '#3C3C43', marginBottom: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  legendDot: { width: 9, height: 9, borderRadius: 4.5 },
  legendDotCur: { backgroundColor: C.white, borderWidth: 1.5, borderColor: BLUE },
  legendText: { fontSize: 10, color: C.gray, marginRight: 10 },
  legendBody: { fontSize: 10, color: C.gray, lineHeight: 18, marginTop: 6 },
  legendStrong: { color: '#3C3C43', fontWeight: '700' },

  mask: {
    flex: 1, backgroundColor: 'rgba(20,24,36,0.42)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 22, paddingTop: 22, paddingBottom: 26,
    maxHeight: '84%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  sheetCode: {
    fontSize: 11, color: BLUE, backgroundColor: '#EEF3FF',
    alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 6, overflow: 'hidden', marginTop: 8,
  },
  sheetClose: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  fieldKey: { fontSize: 11, fontWeight: '700', color: C.gray, marginTop: 18, marginBottom: 7 },
  fieldKeyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 18, marginBottom: 7,
  },
  fieldKeyInline: { fontSize: 11, fontWeight: '700', color: C.gray },
  builtIn: {
    fontSize: 9, color: C.gray, backgroundColor: C.soft,
    borderWidth: 1, borderColor: C.line, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  fieldVal: { fontSize: 13, color: '#3C3C43' },

  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: {
    backgroundColor: '#EEF3FF', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  tagChipText: { fontSize: 11, color: BLUE },

  // 不要写 borderLeftWidth + borderRadius 做「左侧强调条」：
  // 安卓会把它画成一根两端方头的竖线，戳到圆角外面，看着像多出来的一条蓝边
  //（白底页面尤其明显）。强调交给底色就行，和下面的「通关标准」框保持一致。
  preBox: {
    backgroundColor: '#F5F8FF', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  preBoxText: { fontSize: 12, color: '#3C3C43' },

  drillRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6 },
  drillNum: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: BLUE,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  drillNumText: { fontSize: 10, color: C.white, fontWeight: '700' },
  drillText: { flex: 1, fontSize: 12, color: '#3C3C43', lineHeight: 19 },

  stdBox: {
    backgroundColor: '#EEF3FF', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  stdText: { fontSize: 12, color: C.primaryDark, lineHeight: 19 },

  videoBox: {
    backgroundColor: C.soft, borderRadius: 10, height: 80,
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  videoText: { fontSize: 11, color: C.gray },

  lockHint: {
    fontSize: 11, color: C.gray, lineHeight: 18,
    marginTop: 20, textAlign: 'center',
  },

  markBtn: {
    marginTop: 22, height: 46, borderRadius: 14,
    backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center',
  },
  markBtnLocked: { backgroundColor: '#D8DCE6' },
  // 上面已经有「解锁条件」这行了，按钮不用再留那么大空
  markBtnAfterHint: { marginTop: 10 },
  markBtnDone: { backgroundColor: C.white, borderWidth: 1, borderColor: BLUE },
  markText: { fontSize: 14, fontWeight: '700', color: C.white },
  markTextDone: { color: BLUE },
});

/**
 * memo：这一页节点最多（九段 × 十个动作），又常驻在转场层里 ——
 * 不包 memo 的话，App 侧任何状态变化（轻提示、面板开关、导航栏高度）都会让它整套重算重渲染。
 * props 里 done 是 Set、由 App useMemo 产出，onToggle / onBack 都是稳定引用。
 */
export default memo(GradeMapScreen);
