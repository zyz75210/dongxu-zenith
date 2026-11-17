import React, { memo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';
import { APP_VERSION_LABEL } from '../version';

type Props = {
  onBack: () => void;
  onOpenHistory: () => void;
  /** 已保存的日程总数：显示在「历史日程」右侧 */
  scheduleCount: number;
};

/**
 * 设置页：目前只有「历史日程」一个入口。
 * 版式沿用"我的"页的分组卡片，后续要加新设置项直接往 card 里加 row 即可。
 */
function SettingsScreen({ onBack, onOpenHistory, scheduleCount }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.circle} onPress={onBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back-outline" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>设置</Text>
        {/* 占位，让标题保持左对齐、和详情页一致 */}
        <View style={styles.circleGhost} />
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>日程</Text>

        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={onOpenHistory} activeOpacity={0.6}>
            <View style={styles.iconBox}>
              <Ionicons name="time-outline" size={16} color={C.primary} />
            </View>
            <Text style={styles.label}>历史日程</Text>
            <Text style={styles.value}>{scheduleCount} 个</Text>
            <Ionicons name="chevron-forward-outline" size={15} color={C.gray} />
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>
          按月折叠查看所有已创建的日程，点开月份和日期即可回看；
          右上角「编辑」可批量删除不再需要的记录。
        </Text>

        <Text style={styles.version}>{APP_VERSION_LABEL}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 14, marginBottom: 22,
  },
  circle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },
  circleGhost: { width: 34, height: 34 },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text, marginLeft: 12 },

  sectionTitle: { fontSize: 12, color: C.gray, marginBottom: 10 },
  card: {
    borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', height: 52 },
  iconBox: {
    width: 28, height: 28, borderRadius: 9,
    backgroundColor: '#EAF1FE', alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: 13, color: C.text, marginLeft: 12 },
  value: { fontSize: 11, color: C.gray, marginLeft: 'auto', marginRight: 4 },

  hint: {
    fontSize: 11, color: C.gray, lineHeight: 18,
    marginTop: 12, paddingHorizontal: 2,
  },
  version: { textAlign: 'center', color: '#C4C9D2', fontSize: 11, marginTop: 40 },
});

export default memo(SettingsScreen);
