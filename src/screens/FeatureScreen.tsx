import React, { memo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import HeaderCircle from '../components/HeaderCircle';
import { C } from '../theme';

type Props = {
  title: string;
  en: string;
  desc: string;
  icon: string;
  features: { icon: string; text: string }[];
  /** 本页右上角「更多」：只关本页设置，禁止在这里跳去别的页面 */
  onMore?: (label: string) => void;
};

function FeatureScreen({ title, en, desc, icon, features, onMore }: Props) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        <HeaderCircle
          icon="ellipsis-horizontal"
          label={`${title}更多`}
          onPress={() => onMore?.(`${title}设置`)}
        />
      </View>

      {/* 顶部大卡片 */}
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name={icon as any} size={26} color={C.primary} />
        </View>
        <Text style={styles.heroEn}>{en}</Text>
        <Text style={styles.heroTitle}>{title}</Text>
        <Text style={styles.heroDesc}>{desc}</Text>
      </View>

      {/* 功能条目 */}
      <View style={styles.featureList}>
        {features.map((f, i) => (
          <View key={i} style={styles.featureRow}>
            <View style={styles.featureIconBox}>
              <Ionicons name={f.icon as any} size={16} color={C.primary} />
            </View>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.comingSoon}>
        <Ionicons name="time-outline" size={14} color={C.gray} />
        <Text style={styles.comingSoonText}>功能建设中 · 敬请期待</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: C.text },

  hero: {
    backgroundColor: C.cardSoft, borderRadius: 18,
    paddingVertical: 30, paddingHorizontal: 20,
    alignItems: 'center', marginBottom: 20,
  },
  heroIcon: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: C.white, alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  heroEn: { fontSize: 10, color: C.primary, letterSpacing: 1.5, fontWeight: '600' },
  heroTitle: { fontSize: 20, fontWeight: '600', color: C.text, marginTop: 6 },
  heroDesc: { fontSize: 11, color: C.gray, marginTop: 10, textAlign: 'center', lineHeight: 18 },

  featureList: { gap: 10 },
  featureRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  featureIconBox: {
    width: 28, height: 28, borderRadius: 9,
    backgroundColor: '#EAF1FE', alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  featureText: { fontSize: 12, color: C.text, flex: 1 },

  comingSoon: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 18, paddingVertical: 12,
    borderWidth: 1, borderColor: C.line, borderRadius: 999,
  },
  comingSoonText: { fontSize: 11, color: C.gray },
});

/** memo：占位页也常驻 tab 舞台，props 全是模块级常量 + 稳定回调，没必要跟着父级重渲染 */
export default memo(FeatureScreen);
