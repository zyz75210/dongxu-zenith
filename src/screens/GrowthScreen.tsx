import React, { memo } from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import HeaderCircle from '../components/HeaderCircle';
import { C } from '../theme';

/**
 * 积累页 · 运动置顶版
 *
 * 版式规则（全页只有两种尺寸，别再引入第三种）：
 *   大板块 wide  -> 通栏，与小板块等高（HEIGHT）
 *   小板块 small -> 半栏，两个并排 = 一个大板块
 * 高度统一由 HEIGHT 决定，卡片内容靠 marginTop:'auto' 撑开，
 * 所以加内容时只会更挤不会变高 —— 高度一乱，整页节奏就散了。
 *
 * 这一版所有入口都还没接（按需求只做样子）：
 * 卡片、编辑、三点都只给一句提示，不跳页。等运行逻辑定下来再逐个接。
 */

type Props = {
  /** 统一提示：这一版的入口都还没接，点哪里都走这里 */
  onSoon: (label: string) => void;
};

/** 全页唯一高度：大板块 / 小板块 / 置顶卡三者等高 */
const HEIGHT = 150;
/** 卡片间距，也是两栏之间的缝 */
const GAP = 10;

type Widget = {
  id: string;
  name: string;
  icon: string;
  size: 'wide' | 'small';
  desc?: string;
  num?: string;
  unit?: string;
  /** 说明行，允许内嵌加粗片段（完成度那类的强调数字） */
  meta?: React.ReactNode;
  /** 进度条百分比，0 表示不画 */
  pct?: number;
  /** 小板块底部的迷你柱（百分比高度） */
  spark?: number[];
  /** 三个数并排：步数 / 千卡 / 分钟 */
  stats?: { n: string; u: string }[];
  /** 跳绳专用：累计 / 今日 / 连续天数 */
  total?: string;
  today?: string;
  streak?: string;
  bars?: number[];
};

/**
 * 置顶卡
 * 设计稿里的数字都是示意值 —— 真实数据要等「运动记录」那条链路定下来再接，
 * 现在填死是为了把版式的呼吸感做出来，不要当成真实数据用。
 */
const SPORT = {
  stats: [
    { n: '8,420', u: '步' },
    { n: '326', u: '千卡' },
    { n: '42', u: '分钟' },
  ],
  // 14 根柱子：前 4 根压暗当作「上一段」，后面才是今天
  spark: [38, 58, 46, 72, 55, 84, 62, 90, 66, 78, 58, 88, 70, 96],
};

/**
 * 说明行里加粗的片段。
 * 不能用 styles.metaHi —— styles 在文件末尾才创建，模块求值时这里还在暂时性死区里。
 */
const HI = { color: '#2F6FD0', fontWeight: '800' as const };

const WIDGETS: Widget[] = [
  {
    id: 'jump',
    name: '跳绳积累',
    icon: 'jump-rope',
    size: 'wide',
    desc: '每一次跳跃都算数',
    total: '12,680',
    today: '620',
    streak: '9',
    bars: [38, 55, 44, 70, 58, 86, 66],
  },
  {
    id: 'sportData',
    name: '今日运动数据',
    icon: 'run',
    size: 'wide',
    desc: '步数 · 消耗 · 时长，来自你的运动记录',
    stats: SPORT.stats,
    meta: (<>其中<Text style={HI}>跳绳 42%</Text> · 比昨天多 1,120 步</>),
    pct: 84,
  },
  {
    id: 'time',
    name: '时间投入',
    icon: 'chart-timeline-variant',
    size: 'wide',
    desc: '看清每一分钟的去向',
    num: '12.5',
    unit: '小时 / 本周',
    meta: (<>目标 14 小时 · 完成 <Text style={HI}>89%</Text></>),
    pct: 89,
  },
  {
    id: 'streak',
    name: '连续打卡',
    icon: 'flag-outline',
    size: 'small',
    num: '18',
    unit: '天',
    spark: [42, 58, 50, 72, 64, 86, 78],
  },
  {
    id: 'report',
    name: '月度报告',
    icon: 'file-document-outline',
    size: 'small',
    num: '6',
    unit: '期',
    spark: [30, 48, 62, 55, 70, 66, 82],
  },
  {
    id: 'mile',
    name: '里程碑',
    icon: 'flag-outline',
    size: 'wide',
    desc: '记录每一个值得纪念的突破',
    num: '12',
    unit: '个已达成',
    meta: '最近 · 连续 30 天不断更',
    pct: 60,
  },
];

function GrowthScreen({ onSoon }: Props) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      /* 只允许上下滑：横轴不出滚动（子元素一律按容器宽度撑开） */
      horizontal={false}
    >
      <View style={styles.header}>
        <View style={styles.headText}>
          <Text style={styles.cap}>GROWTH · 积累</Text>
          <Text style={styles.title}>积累</Text>
          <Text style={styles.sub}>记录沉淀成资产，布局由你决定</Text>
        </View>

        {/* 编辑与「更多」：与训练 / 星球两页同一个组件、同一尺寸。
            行为只属于本页 —— 编辑只改「我的组件」的顺序，不碰其它页面；更多只开本页设置 */}
        <View style={styles.acts}>
          <HeaderCircle
            icon="pencil-outline"
            label="编辑"
            onPress={() => onSoon('编辑模式')}
          />
          <HeaderCircle
            icon="ellipsis-horizontal"
            label="更多"
            onPress={() => onSoon('更多设置')}
          />
        </View>
      </View>

      <TouchableOpacity
        activeOpacity={0.94}
        onPress={() => onSoon('「我的运动」详情页')}
      >
        <View style={styles.pinWrap}>
          <View style={styles.pin}>
            {/* 渐变底：只靠绝对定位 + 四边外扩 1px，别再写 width/height="100%"，
                否则量到的尺寸会比卡片小半个像素，深蓝底色沿边露出来像黑边 */}
            <Svg style={styles.pinGrad} preserveAspectRatio="none" pointerEvents="none">
              <Defs>
                <LinearGradient id="pinGrad" x1="0" y1="0" x2="0.9" y2="1">
                  <Stop offset="0" stopColor="#173F80" />
                  <Stop offset="0.58" stopColor="#2F6FD0" />
                  <Stop offset="1" stopColor="#5B9DFF" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#pinGrad)" />
            </Svg>

            <View pointerEvents="none" style={styles.pinRingBig} />
            <View pointerEvents="none" style={styles.pinRingSmall} />

            <View style={styles.pinTop}>
              <View style={styles.pinIco}>
                <MaterialCommunityIcons name="run" size={21} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.pinCap}>DAILY SPORT · 今日运动</Text>
                <Text style={styles.pinName}>我的运动</Text>
              </View>
            </View>

            <View style={styles.pinStats}>
              {SPORT.stats.map((s) => (
                <View key={s.u} style={styles.ps}>
                  <Text style={styles.psNum}>{s.n}</Text>
                  <Text style={styles.psUnit}>{s.u}</Text>
                </View>
              ))}
            </View>

            <View style={styles.spark}>
              {SPORT.spark.map((h, i) => (
                <View
                  key={i}
                  style={[
                    styles.sparkBar,
                    { height: `${h}%` },
                    // 前 4 根压暗：读起来是「之前」与「今天」的对比，不是满屏等亮
                    { backgroundColor: i < 4 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.55)' },
                  ]}
                />
              ))}
            </View>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.sechead}>
        <Text style={styles.secTitle}>我的组件</Text>
        <Text style={styles.secHint}>布局固定 · 自定义稍后开放</Text>
      </View>

      <View style={styles.grid}>
        {WIDGETS.map((w) => (
          <TouchableOpacity
            key={w.id}
            activeOpacity={0.94}
            onPress={() => onSoon(`「${w.name}」详情页`)}
            style={w.size === 'wide' ? styles.wideCell : styles.smallCell}
          >
            <View style={styles.card}>
              <View pointerEvents="none" style={styles.cardRing} />
              <CardBody w={w} />
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function CardBody({ w }: { w: Widget }) {
  // 三个数并排（我的运动数据）
  if (w.stats) {
    return (
      <>
        <CardHead w={w} />
        <View style={styles.sportStats}>
          {w.stats.map((s, i) => (
            <View key={s.u} style={[styles.st, i === w.stats!.length - 1 && styles.stLast]}>
              <Text style={styles.stNum}>{s.n}</Text>
              <Text style={styles.stUnit}>{s.u}</Text>
            </View>
          ))}
        </View>
        <Meta w={w} />
      </>
    );
  }

  // 跳绳：左边累计数 + 右边七根柱
  if (w.bars) {
    return (
      <>
        <CardHead w={w} />
        <View style={styles.jumpBd}>
          <View style={styles.jumpLeft}>
            <View style={styles.jumpBigRow}>
              <Text style={styles.jumpBig}>{w.total}</Text>
              <Text style={styles.jumpUnit}>个</Text>
            </View>
            <Text style={styles.jumpMeta}>
              今日 <Text style={HI}>{w.today}</Text> 个 · 连续{' '}
              <Text style={HI}>{w.streak}</Text> 天
            </Text>
          </View>
          <View style={styles.jumpBars}>
            {w.bars.map((h, i) => (
              <View key={i} style={[styles.jumpBar, { height: `${h}%` }]} />
            ))}
          </View>
        </View>
      </>
    );
  }

  // 通栏：图标 + 名字 + 大数字 + 说明 / 进度条
  if (w.size === 'wide') {
    return (
      <>
        <CardHead w={w} />
        <View style={styles.wideNum}>
          <Text style={styles.wn}>{w.num}</Text>
          <Text style={styles.wu}>{w.unit}</Text>
        </View>
        <Meta w={w} />
      </>
    );
  }

  // 半栏：图标 → 名字 → 数字 → 底部迷你柱，四段把 150 撑满
  return (
    <>
      <View style={styles.wt}>
        <View style={styles.wi}>
          <MaterialCommunityIcons name={w.icon as any} size={19} color="#2F6FD0" />
        </View>
      </View>
      <Text style={styles.wname}>{w.name}</Text>
      <View style={styles.wbig}>
        <Text style={styles.wbigNum}>{w.num}</Text>
        <Text style={styles.wbigUnit}>{w.unit}</Text>
      </View>
      <View style={styles.wspark}>
        {(w.spark ?? []).map((h, i) => (
          <View key={i} style={[styles.wsparkBar, { height: `${h}%` }]} />
        ))}
      </View>
    </>
  );
}

function CardHead({ w }: { w: Widget }) {
  return (
    <View style={styles.wt}>
      <View style={styles.wi}>
        <MaterialCommunityIcons name={w.icon as any} size={19} color="#2F6FD0" />
      </View>
      <View style={styles.wtt}>
        <Text style={styles.wName} numberOfLines={1}>{w.name}</Text>
        {w.desc ? <Text style={styles.wDesc} numberOfLines={1}>{w.desc}</Text> : null}
      </View>
    </View>
  );
}

function Meta({ w }: { w: Widget }) {
  if (!w.meta && !w.pct) return null;
  return (
    <>
      {w.meta ? <Text style={styles.meta} numberOfLines={1}>{w.meta}</Text> : null}
      {w.pct ? (
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${w.pct}%` }]} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // 白底，和内容库页面统一（2026-11 统一过一轮；后续想加底色在这一处改）
  screen: { flex: 1, backgroundColor: C.bg },
  // 左右留白 20、上边 10：与内容库完全一致，两个页面切换时标题左沿对得上
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: 2, paddingBottom: 16,
  },
  headText: { flex: 1 },
  // 以下三行字号 / 行高 / 颜色与内容库首页保持同一套，改动时两页一起改
  cap: { fontSize: 9.5, letterSpacing: 2.4, color: C.primary, fontWeight: '800' },
  title: {
    fontSize: 28, lineHeight: 34, marginTop: 6, marginBottom: 5,
    color: C.text, fontWeight: '800', letterSpacing: -0.4,
  },
  sub: { fontSize: 11.5, color: C.gray },
  acts: { flexDirection: 'row', gap: 8 },

  // 阴影层与裁切层必须分开：同一层加了 overflow:'hidden' 会把 iOS 阴影一起裁掉
  pinWrap: {
    borderRadius: 26,
    backgroundColor: '#1E539C',
    boxShadow: '0 12px 26px rgba(23, 63, 128, 0.26)',
    marginBottom: GAP,
  },
  pin: {
    height: HEIGHT,
    borderRadius: 26,
    paddingTop: 16, paddingHorizontal: 18, paddingBottom: 14,
    overflow: 'hidden',
    backgroundColor: '#1E539C',
  },
  pinGrad: { position: 'absolute', left: -1, right: -1, top: -1, bottom: -1 },
  pinRingBig: {
    position: 'absolute', width: 170, height: 170, borderRadius: 85,
    borderWidth: 22, borderColor: 'rgba(255,255,255,0.08)',
    right: -46, top: -56,
  },
  pinRingSmall: {
    position: 'absolute', width: 110, height: 110, borderRadius: 55,
    borderWidth: 14, borderColor: 'rgba(255,255,255,0.06)',
    right: 26, bottom: -58,
  },

  pinTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  pinIco: {
    width: 40, height: 40, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  pinCap: { fontSize: 8.5, letterSpacing: 1.6, color: 'rgba(255,255,255,0.8)', fontWeight: '800' },
  pinName: { fontSize: 16, color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.3, marginTop: 3 },

  pinStats: { flexDirection: 'row', gap: 16, marginTop: 13 },
  ps: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  psNum: { fontSize: 17, color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.3 },
  psUnit: { fontSize: 10, color: 'rgba(255,255,255,0.82)' },

  spark: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 2,
    height: 30, marginTop: 'auto',
  },
  sparkBar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3 },

  sechead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 3, paddingTop: 14, paddingBottom: 9,
  },
  secTitle: { fontSize: 11, color: '#16325C', fontWeight: '800', letterSpacing: 0.3 },
  secHint: { fontSize: 9, color: '#87A3C8' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  wideCell: { width: '100%' },
  // 半栏：flexBasis 47% 保证一行只放得下两个，flexGrow 再把剩余空间平分
  // 所以半栏卡必须成对出现，落单的那个会被拉成通栏
  smallCell: { flexGrow: 1, flexBasis: '47%' },

  card: {
    height: HEIGHT,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#DCE9FA',
    padding: 15,
    overflow: 'hidden',
  },
  // 装饰圆环：留在卡片内、被裁掉一半，观感是角落的一道光弧
  cardRing: {
    position: 'absolute', width: 96, height: 96, borderRadius: 48,
    borderWidth: 13, borderColor: 'rgba(47,111,208,0.05)',
    right: -26, top: -28,
  },

  wt: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wi: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: '#D8E8FF',
    alignItems: 'center', justifyContent: 'center',
  },
  wtt: { flex: 1 },
  wName: { fontSize: 12.5, color: '#16325C', fontWeight: '800' },
  wDesc: { fontSize: 9.5, color: '#87A3C8', marginTop: 3 },

  // 跳绳
  jumpBd: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 'auto' },
  jumpLeft: { flex: 1 },
  jumpBigRow: { flexDirection: 'row', alignItems: 'flex-end' },
  jumpBig: { fontSize: 28, color: '#173F80', fontWeight: '800', letterSpacing: -0.5 },
  jumpUnit: { fontSize: 12, color: '#87A3C8', fontWeight: '600', marginLeft: 4, marginBottom: 4 },
  jumpMeta: { fontSize: 9, color: '#87A3C8', marginTop: 4 },
  jumpBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 48 },
  jumpBar: { width: 9, backgroundColor: '#6FA6E8', borderTopLeftRadius: 4, borderTopRightRadius: 4 },

  // 三个数并排
  sportStats: { flexDirection: 'row', marginTop: 'auto' },
  st: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#EEF0F4' },
  stLast: { borderRightWidth: 0 },
  stNum: { fontSize: 20, color: '#173F80', fontWeight: '800', letterSpacing: -0.3 },
  stUnit: { fontSize: 8.5, color: '#87A3C8', marginTop: 2 },

  // 通栏数字
  wideNum: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, marginTop: 'auto' },
  wn: { fontSize: 24, color: '#173F80', fontWeight: '800' },
  wu: { fontSize: 11, color: '#87A3C8', fontWeight: '600', marginBottom: 3 },

  meta: { fontSize: 10, color: '#87A3C8', marginTop: 7 },
  bar: {
    height: 5, borderRadius: 99, backgroundColor: '#EEF4FD',
    marginTop: 8, overflow: 'hidden',
  },
  barFill: { height: 5, borderRadius: 99, backgroundColor: '#5B9BEF' },

  // 半栏
  wname: { fontSize: 11.5, color: '#16325C', fontWeight: '800', marginTop: 8 },
  wbig: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 'auto' },
  wbigNum: { fontSize: 21, color: '#173F80', fontWeight: '800' },
  wbigUnit: { fontSize: 11, color: '#87A3C8', fontWeight: '600', marginLeft: 3, marginBottom: 3 },
  // 22 而不是设计稿的 26：安卓 Text 自带 font padding，四段加起来会顶破 150 的内高
  wspark: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 22, marginTop: 8 },
  wsparkBar: {
    flex: 1, backgroundColor: '#A8CDF6',
    borderTopLeftRadius: 2, borderTopRightRadius: 2,
  },
});

/** memo：常驻 tab 页，props 只有 onSoon（稳定引用），父级重渲染时整页可以跳过 */
export default memo(GrowthScreen);
