import React, { memo } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';
import { Profile } from '../data';
import { APP_VERSION_LABEL } from '../version';

type Props = {
  profile: Profile;
  /** 点「个人资料」进编辑页 */
  onEditProfile: () => void;
  /** 真实统计：已添加 / 已完成 / 连续天数，由 App 按日程算好传进来 */
  stats: { total: number; done: number; streak: number; monthTotal: number; monthDone: number };
  /** 进数据报告页 */
  onOpenReport: () => void;
  /** 右上角齿轮：和日历首页那颗同一个去处（设置页） */
  onOpenSettings: () => void;
  /** 云同步：本地已存，云端还没接 */
  onOpenCloud: () => void;
  /** 还没做的入口：只弹一句提示，别让点了没反应 */
  onPressSoon: (label: string) => void;
};

type Group = {
  title: string;
  more?: string;
  items: { icon: string; label: string; value?: string }[];
};

const account: Group = {
  title: '账户设置',
  more: '查看全部',
  items: [
    { icon: 'person-outline', label: '个人资料', value: '已完善' },
    { icon: 'notifications-outline', label: '提醒与通知', value: '在设置中管理' },
    { icon: 'color-palette-outline', label: '外观主题', value: '清爽白' },
  ],
};
/**
 * 数据报告 / 云同步 已经上提到了顶部那张卡，这里不再重复列 ——
 * 同一件事出现两个入口，用户会怀疑哪个才是"真的"。
 */
const more: Group = {
  title: '更多功能',
  more: '即将开放',
  items: [
    { icon: 'lock-closed-outline', label: '隐私与安全' },
    { icon: 'help-circle-outline', label: '帮助与反馈' },
  ],
};

function Section({
  group, onPressItem,
}: {
  group: Group;
  onPressItem?: (label: string) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{group.title}</Text>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={styles.sectionMore}>{group.more}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.groupCard}>
        {group.items.map((it, i) => (
          <View key={i}>
            <TouchableOpacity
              style={styles.groupRow}
              activeOpacity={0.6}
              onPress={() => onPressItem?.(it.label)}
            >
              <View style={styles.groupIconBox}>
                <Ionicons name={it.icon as any} size={16} color={C.primary} />
              </View>
              <Text style={styles.groupLabel}>{it.label}</Text>
              {it.value && <Text style={styles.groupValue}>{it.value}</Text>}
              <Ionicons name="chevron-forward-outline" size={15} color={C.gray} />
            </TouchableOpacity>
            {i < group.items.length - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </View>
    </View>
  );
}

function ProfileScreen({
  profile, onEditProfile, stats, onOpenReport, onOpenCloud, onPressSoon, onOpenSettings,
}: Props) {
  const birthdayText =
    `${profile.birthday.y}年${profile.birthday.m + 1}月${profile.birthday.d}日`;

  // 报告卡上的一行摘要：直接把"这个月怎么样"摆出来，不用点进去才知道
  const monthPct = stats.monthTotal
    ? Math.round((stats.monthDone / stats.monthTotal) * 100)
    : null;
  const reportSub = monthPct === null ? '本月暂无记录' : `本月完成率 ${monthPct}%`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>我的</Text>
        {/*
          触摸区做到 44×44（系统建议的最小可点尺寸），但用负外边距把它"收"回来，
          视觉上那个 34×34 的圆一动不动。
          之前是 34 的圆 + hitSlop：hitSlop 超到父容器外面的部分在安卓上会被裁掉，
          指尖稍微偏一点就落空，手感就是"点了没反应"。
        */}
        <TouchableOpacity
          style={styles.gearHit}
          onPress={onOpenSettings}
          activeOpacity={0.6}
        >
          <View style={styles.circle}>
            <Ionicons name="settings-outline" size={18} color={C.text} />
          </View>
        </TouchableOpacity>
      </View>

      {/* 用户信息：点整块也能进编辑 */}
      <TouchableOpacity style={styles.userRow} activeOpacity={0.75} onPress={onEditProfile}>
        <Image
          source={profile.avatar ? { uri: profile.avatar } : require('../../assets/avatar.png')}
          style={styles.avatar}
        />
        <View style={styles.userInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{profile.name}</Text>
            <View style={styles.lvBadge}><Text style={styles.lvText}>L9</Text></View>
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {[profile.nickname?.trim(), '加入 428 天'].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.emailRow}>
            <Ionicons name="mail-outline" size={11} color={C.gray} />
            <Text style={styles.email} numberOfLines={1}>
              {profile.email || '未填写邮箱'}
            </Text>
          </View>
          <View style={styles.emailRow}>
            <Ionicons name="gift-outline" size={11} color={C.gray} />
            <Text style={styles.email}>生日 {birthdayText}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward-outline" size={16} color={C.gray} />
      </TouchableOpacity>

      {/*
        统计 + 两个入口做成一块：上半是三个数字，下半左"数据报告"、右"云同步"。
        分成三块并列会显得散，合成一张卡才有"这是我的总览"的感觉。
      */}
      <View style={styles.hero}>
        <View style={styles.heroStats}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{stats.total}</Text>
            <Text style={styles.statLabel}>已添加</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{stats.done}</Text>
            <Text style={styles.statLabel}>已完成</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{stats.streak}</Text>
            <Text style={styles.statLabel}>连续天数</Text>
          </View>
        </View>

        <View style={styles.heroActions}>
          <TouchableOpacity style={styles.actionCard} onPress={onOpenReport} activeOpacity={0.75}>
            <View style={styles.actionIcon}>
              <Ionicons name="stats-chart-outline" size={16} color={C.primary} />
            </View>
            <Text style={styles.actionTitle}>数据报告</Text>
            <Text style={styles.actionSub} numberOfLines={1}>{reportSub}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard} onPress={onOpenCloud} activeOpacity={0.75}>
            <View style={[styles.actionIcon, styles.actionIconMuted]}>
              <Ionicons name="cloud-upload-outline" size={16} color={C.gray} />
            </View>
            <Text style={styles.actionTitle}>云同步</Text>
            <Text style={styles.actionSub} numberOfLines={1}>尚未开启</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Section
        group={account}
        onPressItem={(label) => {
          if (label === '个人资料') onEditProfile();
          // 这一行右边本来就写着"在设置中管理"，直接送过去比弹一句"还在开发中"诚实
          else if (label === '提醒与通知') onOpenSettings();
          else onPressSoon(label);
        }}
      />
      <Section group={more} onPressItem={onPressSoon} />
      <Text style={styles.version}>{APP_VERSION_LABEL}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: C.text },
  // 44×44 的真实触摸区，负外边距把多出来的 10px 收回去，圆的位置不变
  gearHit: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -5, marginBottom: -5, marginRight: -5, marginLeft: -5,
  },
  circle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },

  userRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  userInfo: { marginLeft: 14, flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 17, fontWeight: '600', color: C.text },
  lvBadge: { backgroundColor: '#EAF1FE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  lvText: { fontSize: 10, color: C.primary, fontWeight: '600' },
  meta: { fontSize: 11, color: C.gray, marginTop: 4 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  email: { fontSize: 10, color: C.gray, flexShrink: 1 },

  // 总览卡：上半三个数字、下半两个入口，一张卡说清"我做得怎么样、还能去哪儿看"
  hero: {
    borderWidth: 1, borderColor: C.line, borderRadius: 16,
    backgroundColor: C.white,
    paddingHorizontal: 14, paddingVertical: 16, marginBottom: 24,
  },
  heroStats: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '600', color: C.text },
  statLabel: { fontSize: 11, color: C.gray, marginTop: 5 },
  statDivider: { width: 1, height: 30, backgroundColor: C.line },

  heroActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionCard: {
    flex: 1, backgroundColor: C.soft, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  actionIcon: {
    width: 28, height: 28, borderRadius: 9, backgroundColor: '#EAF1FE',
    alignItems: 'center', justifyContent: 'center', marginBottom: 9,
  },
  actionIconMuted: { backgroundColor: '#EDEFF3' },
  actionTitle: { fontSize: 13, fontWeight: '600', color: C.text },
  actionSub: { fontSize: 10, color: C.gray, marginTop: 3 },

  section: { marginBottom: 22 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 12, color: C.gray },
  sectionMore: { fontSize: 11, color: C.gray },
  groupCard: {
    borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14,
  },
  groupRow: { flexDirection: 'row', alignItems: 'center', height: 52 },
  groupIconBox: {
    width: 28, height: 28, borderRadius: 9,
    backgroundColor: '#EAF1FE', alignItems: 'center', justifyContent: 'center',
  },
  groupLabel: { fontSize: 13, color: C.text, marginLeft: 12 },
  groupValue: { fontSize: 11, color: C.gray, marginLeft: 'auto', marginRight: 4 },
  divider: { height: 1, backgroundColor: C.line, marginLeft: 40 },

  version: { textAlign: 'center', color: '#C4C9D2', fontSize: 11, marginTop: 6 },
});

// 父级每次重渲染都会重建元素，memo 让本页在 props 没变时跳过重渲染
export default memo(ProfileScreen);
