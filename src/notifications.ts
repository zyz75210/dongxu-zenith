/**
 * 本地通知（1.1 待办里的「真实通知」）。
 *
 * 只做本地通知（local notification），不接远程推送 —— SDK 53 起 Android 的 Expo Go
 * 已经不支持远程推送，要推送得先做 development build，本阶段不需要。
 *
 * 职责边界：这里只负责「什么时候排提醒、怎么排、怎么取消」，不碰 React，
 * 也不决定业务时机（那是 App.tsx 的事）。
 */
import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Schedule } from './data';
import { parseDateKey } from './utils/date';

/** 安卓 8+ 必须有渠道，否则通知不显示，权限弹窗也不会出现 */
export const CHANNEL_ID = 'zenith-reminders';

/** 提前多少分钟提醒：与「添加日程」页写死的文案保持一致 */
export const REMIND_MINUTES = 15;

/** 通知 data 里的来源标记：取消时只认自己排的，不误伤别人（比如将来的推送） */
const MARK = 'zenith';

/** 系统对单 App 待发通知数量有限制（iOS 64 条），留点余量 */
const MAX_SCHEDULED = 60;

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/**
 * 一次性初始化：前台展示策略 + 安卓渠道。
 * 放在模块顶层执行 —— 必须在任何通知触发之前设好 handler，
 * 否则前台收到通知时不会弹横幅（冷启动第一秒也可能收到）。
 */
function setupNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // SDK 58 里 shouldShowAlert 已废弃，拆成 banner / list 两个字段
      shouldShowBanner: true,
      shouldShowList: true,
      // 安卓上 shouldPlaySound: false 会导致横幅不显示，别关
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  ensureChannel();
}

/** 创建/更新安卓渠道。重复调用是安全的（幂等） */
function ensureChannel(): Promise<unknown> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: '日程提醒',
    importance: Notifications.AndroidImportance.HIGH, // HIGH 才会横幅弹出 + 响铃
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#5B8DEF',
    sound: 'default',
  });
}

setupNotifications();

/** 当前权限状态。只查不弹窗，可以在任意时刻调用 */
export async function getPermissionState(): Promise<PermissionState> {
  const p = await Notifications.getPermissionsAsync();
  // iOS 的 provisional / ephemeral 也算能收，统一按 granted 处理
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'granted';
  }
  return p.status === 'undetermined' ? 'undetermined' : 'denied';
}

/**
 * 需要时才弹系统授权框。
 * 已授权 / 已拒绝都不再弹（安卓拒绝两次后会静默拒绝，弹了也没用，引导去系统设置）。
 */
export async function requestPermissionIfNeeded(): Promise<PermissionState> {
  const cur = await getPermissionState();
  if (cur !== 'undetermined') return cur;
  // 安卓 13+ 的权限弹窗要等渠道建好才出现
  await ensureChannel();
  const res = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return res.granted ? 'granted' : 'denied';
}

/**
 * 某条日程应该在什么时刻提醒（毫秒时间戳）。
 * 不该提醒的情况统一返回 null：没开提醒 / 时间已过 / 数据非法。
 * 纯函数，不碰通知 API —— 方便单独测。
 */
export function remindAtOf(
  item: Pick<Schedule, 'date' | 'start' | 'remind'>,
  now: number = Date.now(),
): number | null {
  if (!item.remind) return null;

  const { y, m, d } = parseDateKey(item.date);
  const [h, min] = item.start.split(':').map((n) => Number.parseInt(n, 10));
  if (![y, m, d, h, min].every((n) => Number.isFinite(n))) return null;

  const at = new Date(y, m, d, h, min, 0, 0).getTime() - REMIND_MINUTES * 60_000;
  // 已经过点的提醒直接丢掉：补发一条「15 分钟前该开始了」没有意义
  return Number.isFinite(at) && at > now ? at : null;
}

/** 取消本 App 排下的所有待发通知 */
async function cancelOwn(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const mine = all.filter((n) => n.content.data?.app === MARK);
  await Promise.all(mine.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/**
 * 全量重排：先清掉旧的，再把所有未来日程按「开始前 15 分钟」重新排一遍。
 * 增删改一条日程后调用即可，不用逐个 diff（条数很少，一次全量最不容易出错）。
 *
 * request=true 时会在权限未决时弹授权框（只在用户主动操作后传 true）。
 * 返回实际排成功的条数；没权限时返回 0，不抛异常。
 */
export async function syncReminders(
  items: Schedule[],
  opts: { request?: boolean } = {},
): Promise<number> {
  const state = opts.request ? await requestPermissionIfNeeded() : await getPermissionState();
  if (state !== 'granted') return 0;

  await cancelOwn();

  const now = Date.now();
  const upcoming = items
    .map((item) => ({ item, at: remindAtOf(item, now) }))
    .filter((x): x is { item: Schedule; at: number } => x.at !== null)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_SCHEDULED);

  for (const { item, at } of upcoming) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: `${item.start} - ${item.end} 开始，还有 ${REMIND_MINUTES} 分钟`,
        data: { app: MARK, scheduleId: item.id },
        sound: 'default',
      },
      trigger: {
        // SDK 58 起 trigger 必须带 type，不能只传 Date
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: CHANNEL_ID,
      },
    });
  }
  return upcoming.length;
}

/** 当前已排程的提醒条数：设置页用它做"真的排上了"的证据 */
export async function countScheduled(): Promise<number> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.filter((n) => n.content.data?.app === MARK).length;
  } catch {
    return 0;
  }
}

/**
 * 测试通知：seconds 秒后到达。
 * 用来在真机上验证「权限 → 渠道 → 排程 → 展示」整条链路，不依赖任何日程数据。
 */
export async function sendTestNotification(seconds = 5): Promise<PermissionState> {
  const state = await requestPermissionIfNeeded();
  if (state !== 'granted') return state;

  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '通知链路正常',
      body: `${seconds} 秒后收到的这条就是真实提醒，日程到点也走同一条路`,
      data: { app: MARK, test: true },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: Date.now() + seconds * 1000,
      channelId: CHANNEL_ID,
    },
  });
  return 'granted';
}

/** 被系统拒绝后只能去系统设置里打开 */
export function openSystemNotificationSettings(): void {
  void Linking.openSettings();
}
