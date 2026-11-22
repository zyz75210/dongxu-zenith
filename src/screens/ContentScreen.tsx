import React from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { C } from '../theme';
import { STAGES } from '../content/grades';
import { type StageStat, isLit, stageStates } from '../content/gradeProgress';

type Props = {
  /** 每一段的「已掌握 / 总数」：点亮判断在 gradeProgress 里，这里只负责显示 */
  stats: StageStat[];
  onOpenMap: () => void;
  onSoon: (msg: string) => void;
};

/** 阶梯条：按段位状态上色，越往后越高，一眼能看出难度在往上走 */
const ZONE_TAGS = ['基础', '步伐', '多摇'];

export default function ContentScreen({ stats, onOpenMap, onSoon }: Props) {
  const total = STAGES.length;
  const states = stageStates(stats);
  const litCount = stats.filter(isLit).length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.cap}>EXPLORE · 探索</Text>
        <Text style={styles.title}>内容库</Text>
        <Text style={styles.sub}>为你的每一次运动 Find 灵感</Text>
      </View>

      <TouchableOpacity
        style={styles.heroWrap}
        activeOpacity={0.94}
        onPress={onOpenMap}
      >
        <View style={styles.hero}>
          {/* 渐变底：用 svg 画，不额外引第三方渐变库
              尺寸只交给 absoluteFill 决定；再写 width/height="100%" 会出现「量到的尺寸比卡片小一点」，
              卡片自身的深蓝底色就沿右边和下边露出来，看着像黑边 */}
          <Svg style={styles.heroGrad} preserveAspectRatio="none" pointerEvents="none">
            <Defs>
              <LinearGradient id="heroGrad" x1="0" y1="0" x2="0.9" y2="1">
                <Stop offset="0" stopColor="#153E82" />
                <Stop offset="0.55" stopColor="#2F6FD0" />
                <Stop offset="1" stopColor="#6AAEF2" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGrad)" />
          </Svg>

          {/* 圆环纹理：装饰，不参与点击 */}
          <View pointerEvents="none" style={styles.ringBig} />
          <View pointerEvents="none" style={styles.ringSmall} />

          <View style={styles.heroTop}>
            <Text style={styles.eyebrow}>SYSTEM · 段位体系</Text>
            <View style={styles.noPill}>
              <Text style={styles.noText}>已点亮 {litCount} / {total} 段</Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>跳绳花样段位制</Text>
          <Text style={styles.heroSub}>九段进阶 · 从并脚跳到四摇</Text>
          <Text style={styles.heroIntro}>
            一~三段练基础与双摇，四~六段玩空间和手上花样，七~九段进后摇与翻腾。
          </Text>

          <View style={styles.ladder}>
            <Text style={styles.ladderCap}>一段</Text>
            <View style={styles.bars}>
              {STAGES.map((s, i) => {
                // 点亮 = 这一段剩下的未掌握动作 ≤ 2 个，不要求全部清完
                const on = isLit(stats[i]);
                // 没点亮但已经解锁 / 已经动手：半透明白，和完全没碰过的灰分开
                const cur = !on && states[i] !== 'lock';
                return (
                  <View
                    key={s.lv}
                    style={[
                      styles.bar,
                      { height: 6 + i * 2.5 },
                      on ? styles.barOn : cur ? styles.barCur : null,
                    ]}
                  />
                );
              })}
            </View>
            <Text style={styles.ladderCap}>九段</Text>
          </View>

          <View style={styles.heroBottom}>
            <View style={styles.tags}>
              {ZONE_TAGS.map((t) => (
                <View key={t} style={styles.tag}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
            <View style={styles.enterBtn}>
              <Text style={styles.enterText}>进入地图 →</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.aiPill}
        activeOpacity={0.9}
        onPress={() => onSoon('运动问答即将上线')}
      >
        <Ionicons name="sparkles-outline" size={19} color={C.white} />
        <View style={styles.aiText}>
          <Text style={styles.aiTitle}>问问我</Text>
          <Text style={styles.aiSub}>关于运动的任何问题</Text>
        </View>
        <Text style={styles.aiGo}>→</Text>
      </TouchableOpacity>

      {/* 底部预留：后续加新板块 / 新想法，先留出位置不让版式跳 */}
      <View style={styles.future} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },

  header: { paddingTop: 2, paddingBottom: 16 },
  cap: { fontSize: 9.5, letterSpacing: 2.4, color: C.primary, fontWeight: '800' },
  title: {
    fontSize: 28, lineHeight: 34, marginTop: 6, marginBottom: 5,
    color: C.text, fontWeight: '800', letterSpacing: -0.4,
  },
  sub: { fontSize: 11.5, color: C.gray },

  // 阴影和裁切必须分两层：overflow:hidden 会把阴影一起裁掉
  // 不能再用 elevation：安卓的 elevation 阴影是「有方向的硬阴影」（光从左上打，落在右下），
  // shadowRadius / shadowOpacity 在安卓又是无效的，于是白底上右边和下边会压出一圈发黑的边。
  // boxShadow 是新架构的真模糊阴影，两端一致，颜色也能自己定。
  heroWrap: {
    borderRadius: 26,
    backgroundColor: '#1E539C',
    boxShadow: '0 10px 26px rgba(30, 75, 150, 0.24)',
  },
  hero: {
    minHeight: 300,
    borderRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 20,
    overflow: 'hidden',
    backgroundColor: '#1E539C',
  },
  // 比卡片四边各多出 1px：SVG 量到的尺寸偶尔比卡片小半个像素，
  // 卡片自己的深蓝底就会沿着右边和下边露出来，被当成「黑边」
  heroGrad: { position: 'absolute', left: -1, right: -1, top: -1, bottom: -1 },
  ringBig: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    borderWidth: 28, borderColor: 'rgba(255,255,255,0.08)',
    right: -72, top: -64,
  },
  ringSmall: {
    position: 'absolute', width: 150, height: 150, borderRadius: 75,
    borderWidth: 18, borderColor: 'rgba(255,255,255,0.12)',
    right: -26, bottom: -58,
  },

  heroTop: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { fontSize: 10, letterSpacing: 2.2, color: 'rgba(255,255,255,0.9)', fontWeight: '800' },
  noPill: {
    marginLeft: 'auto',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.42)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  noText: { fontSize: 10.5, color: 'rgba(255,255,255,0.92)', fontWeight: '800' },

  heroTitle: {
    fontSize: 28, lineHeight: 34, color: C.white, fontWeight: '800',
    letterSpacing: -0.4, marginTop: 22,
  },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.92)', marginTop: 8 },
  heroIntro: {
    fontSize: 11.5, lineHeight: 19, color: 'rgba(255,255,255,0.86)',
    marginTop: 12, maxWidth: '94%',
  },

  ladder: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, marginTop: 16 },
  ladderCap: {
    fontSize: 9, color: 'rgba(255,255,255,0.72)', fontWeight: '700', paddingBottom: 3,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 26 },
  bar: { width: 17, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.32)' },
  barOn: { backgroundColor: C.white },
  barCur: { backgroundColor: 'rgba(255,255,255,0.72)' },

  heroBottom: {
    flexDirection: 'row', alignItems: 'center', marginTop: 'auto',
    paddingTop: 16, gap: 10,
  },
  tags: { flexDirection: 'row', gap: 6, flexShrink: 1 },
  tag: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.34)',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5,
  },
  tagText: { fontSize: 9.5, color: C.white, fontWeight: '600' },
  enterBtn: {
    marginLeft: 'auto', backgroundColor: C.white,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8,
  },
  enterText: { fontSize: 10.5, color: '#2F6FD0', fontWeight: '800' },

  aiPill: {
    marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#2F6FD0', borderRadius: 999,
    paddingHorizontal: 18, paddingVertical: 13,
  },
  aiText: { flex: 1 },
  aiTitle: { fontSize: 13, color: C.white, fontWeight: '700' },
  aiSub: { fontSize: 10, color: 'rgba(255,255,255,0.82)', marginTop: 2 },
  aiGo: { fontSize: 18, color: C.white, fontWeight: '300' },

  future: { height: 26 },
});
