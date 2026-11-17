import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';

type Props = {
  title: string;
  en: string;
  desc: string;
  icon: string;
  features: { icon: string; text: string }[];
};

export default function FeatureScreen({ title, en, desc, icon, features }: Props) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity style={styles.circle} activeOpacity={0.7}>
          <Ionicons name="ellipsis-horizontal" size={18} color={C.text} />
        </TouchableOpacity>
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
  circle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },

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
