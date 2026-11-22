import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C } from '../theme';
import { APP_VERSION_LABEL } from '../version';
import {
  countScheduled,
  ensureChannel,
  getChannelStatus,
  getPermissionState,
  openSystemNotificationSettings,
  requestPermissionIfNeeded,
  sendTestNotification,
  REMIND_MINUTES,
  type ChannelStatus,
  type PermissionState,
} from '../notifications';

type Props = {
  onBack: () => void;
  onOpenHistory: () => void;
  /** 已保存的日程总数：显示在「历史日程」右侧 */
  scheduleCount: number;
  /** 页面常驻不卸载，靠它判断"重新打开了"从而刷新权限与排程数 */
  visible?: boolean;
  /** 刚拿到通知权限：让上层重排一次提醒 */
  onRemindersChanged: () => void;
};

/** 权限状态 -> 右侧文案 */
const permText: Record<PermissionState | 'checking', string> = {
  checking: '检测中',
  granted: '已开启',
  denied: '未授权',
  undetermined: '未设置',
};

/**
 * 设置页：日程入口 + 通知提醒（真实可用的开关与自检）。
 * 版式沿用"我的"页的分组卡片，后续要加新设置项直接往 card 里加 row 即可。
 */
function SettingsScreen({
  onBack, onOpenHistory, scheduleCount, visible = true, onRemindersChanged,
}: Props) {
  const [perm, setPerm] = useState<PermissionState | 'checking'>('checking');
  /** 系统里已排程的提醒条数：这是"真的排上了"的证据，不是 UI 假状态 */
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /**
   * 安卓渠道是否真的建起来了。建不出来时排程会退化成"不带 channelId"，
   * 通知大概率不显示 —— 这件事必须让用户看见，不能只显示权限"已开启"。
   */
  const [chan, setChan] = useState<ChannelStatus>({ ready: true, degraded: false, error: null });
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 6000);
  }, []);

  const refresh = useCallback(async () => {
    const p = await getPermissionState();
    setPerm(p);
    setPending(await countScheduled());
    // 顺便重试一次建渠道：用户可能刚在系统里放开权限，渠道之前才建失败过
    await ensureChannel();
    setChan(getChannelStatus());
  }, []);

  // 每次打开设置页都重新查一遍（权限可能在系统设置里被改过）
  const prevVisible = useRef(false);
  useEffect(() => {
    if (visible && !prevVisible.current) void refresh();
    prevVisible.current = visible;
  }, [visible, refresh]);

  // 从系统设置返回时也要刷新：用户在那边点了"允许"，回来状态得跟着变
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && visible) void refresh();
    });
    return () => sub.remove();
  }, [visible, refresh]);

  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  /** 开启通知：弹系统授权；已拒绝则引导去系统设置 */
  const enable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const state = await requestPermissionIfNeeded();
      setPerm(state);
      if (state === 'granted') {
        onRemindersChanged();          // 上层按最新日程重排
        say(`通知已开启，将为未来 ${REMIND_MINUTES} 分钟内的日程排提醒`);
      } else if (state === 'denied') {
        say('系统里已关闭本 App 的通知，请到「系统设置 → 通知」里手动允许');
      }
      setPending(await countScheduled());
    } finally {
      setBusy(false);
    }
  }, [busy, onRemindersChanged, say]);

  /** 5 秒后发一条：验证 权限 → 渠道 → 排程 → 展示 整条链路 */
  const test = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const state = await sendTestNotification(5);
      setPerm(state);
      if (state === 'granted') {
        say('已排程：5 秒后到达。可以退回桌面或锁屏，通知照样会弹');
        setTimeout(() => { void refresh(); }, 6500);
      } else {
        say('没有通知权限，先在下面开启再去系统里允许');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, say]);

  const denied = perm === 'denied';

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

        <Text style={[styles.sectionTitle, styles.sectionGap]}>通知提醒</Text>

        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={denied ? openSystemNotificationSettings : enable}
            activeOpacity={0.6}
            disabled={busy}
          >
            <View style={styles.iconBox}>
              <Ionicons name="notifications-outline" size={16} color={C.primary} />
            </View>
            <Text style={styles.label}>提醒与通知</Text>
            <Text style={[styles.value, perm === 'granted' && styles.valueOn]}>
              {permText[perm]}
            </Text>
            <Ionicons name="chevron-forward-outline" size={15} color={C.gray} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={() => void refresh()} activeOpacity={0.6}>
            <View style={styles.iconBox}>
              <Ionicons name="alarm-outline" size={16} color={C.primary} />
            </View>
            <Text style={styles.label}>已排程提醒</Text>
            <Text style={styles.value}>{pending} 条</Text>
            <Ionicons name="refresh-outline" size={15} color={C.gray} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={() => void test()} activeOpacity={0.6} disabled={busy}>
            <View style={styles.iconBox}>
              <Ionicons name="paper-plane-outline" size={16} color={C.primary} />
            </View>
            <Text style={styles.label}>发送测试通知</Text>
            <Text style={styles.value}>{busy ? '发送中…' : '5 秒后'}</Text>
            <Ionicons name="chevron-forward-outline" size={15} color={C.gray} />
          </TouchableOpacity>

          {/* 渠道建不出来时系统会静默丢弃通知，这里如实标出来，别让人以为是"已经好了" */}
          {!chan.ready ? (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <View style={styles.iconBox}>
                  <Ionicons name="warning-outline" size={16} color="#D9534F" />
                </View>
                <Text style={styles.label}>通知渠道</Text>
                <Text style={[styles.value, { color: '#D9534F' }]}>建立失败</Text>
              </View>
            </>
          ) : null}
        </View>

        {!chan.ready && chan.error ? (
          <Text style={styles.warn}>渠道报错：{chan.error.slice(0, 160)}</Text>
        ) : null}

        {note ? <Text style={styles.note}>{note}</Text> : null}

        <Text style={styles.hint}>
          每条开启提醒的日程，会在开始前 {REMIND_MINUTES} 分钟收到一条本地通知。
          通知由手机本地发出，不需要联网，杀进程、重启手机后依然有效。
          {denied ? '当前系统已拒绝本 App 的通知权限，点上面「提醒与通知」去系统设置里打开。' : ''}
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
  sectionGap: { marginTop: 22 },
  card: {
    borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', height: 52 },
  divider: { height: 1, backgroundColor: C.line, marginLeft: 40 },
  iconBox: {
    width: 28, height: 28, borderRadius: 9,
    backgroundColor: '#EAF1FE', alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: 13, color: C.text, marginLeft: 12 },
  value: { fontSize: 11, color: C.gray, marginLeft: 'auto', marginRight: 4 },
  valueOn: { color: C.primary },

  note: {
    fontSize: 11, color: C.primary, lineHeight: 17,
    marginTop: 10, paddingHorizontal: 2,
  },
  warn: {
    fontSize: 11, color: '#D9534F', lineHeight: 17,
    marginTop: 10, paddingHorizontal: 2,
  },
  hint: {
    fontSize: 11, color: C.gray, lineHeight: 18,
    marginTop: 12, paddingHorizontal: 2,
  },
  version: { textAlign: 'center', color: '#C4C9D2', fontSize: 11, marginTop: 40 },
});

export default memo(SettingsScreen);
