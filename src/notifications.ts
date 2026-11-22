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
  // 必须吞掉结果：这里在模块顶层执行，没人 await，
  // 一旦拒绝就会变成「Uncaught (in promise)」红屏 —— 见 ensureChannel 的注释
  void ensureChannel();
}

/** 完整配置：横幅 + 响铃 + 震动 + 呼吸灯 */
const CHANNEL_FULL = {
  name: '日程提醒',
  importance: Notifications.AndroidImportance.HIGH, // HIGH 才会横幅弹出 + 响铃
  vibrationPattern: [0, 250, 250, 250],
  lightColor: '#5B8DEF',
  sound: 'default',
};

/** 兜底配置：只留建渠道必需的两项（官方文档的最小示例就是这个形状） */
const CHANNEL_MINIMAL = {
  name: '日程提醒',
  importance: Notifications.AndroidImportance.HIGH,
};

/** 渠道状态：ready=false 表示这台机器上建不出渠道，通知基本发不出来 */
export type ChannelStatus = {
  ready: boolean;
  /** 用最简配置才建成功：说明某个装饰性字段在这台机器/ROM 上会炸 */
  degraded: boolean;
  /** 最后一次的原生报错文案，给设置页显示真实原因 */
  error: string | null;
};

let channelReady = false;
let channelDegraded = false;
let channelError: string | null = null;

/**
 * 创建/更新安卓渠道。重复调用安全（幂等）。
 *
 * 两种失败都必须吞掉，不能往外抛：
 * 1) 某些 ROM / Expo Go 版本上，`vibrationPattern`、`lightColor` 这类字段会让原生层
 *    抛 NullPointerException（实测报错：Object.getClass() on a null object reference）。
 *    遇到就退回最小配置再试一次，别为了震动效果把整个通知功能拖死。
 * 2) 全失败时也只记录状态、返回 false —— 排程那边会改为不带 channelId，
 *    交给系统/库自己的兜底渠道，界面上再从设置页如实告诉用户。
 */
export async function ensureChannel(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    channelReady = true;
    return true;
  }
  if (channelReady) return true;

  let last: unknown = null;
  const variants = [CHANNEL_FULL, CHANNEL_MINIMAL];
  for (let i = 0; i < variants.length; i += 1) {
    try {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, variants[i]);
      channelReady = true;
      channelDegraded = i > 0;
      channelError = null;
      return true;
    } catch (e) {
      last = e;
    }
  }

  channelError = last instanceof Error ? last.message : String(last);
  return false;
}

/** 设置页用：把「渠道到底建没建起来」如实暴露出来，而不是只显示一个假的开/关 */
export function getChannelStatus(): ChannelStatus {
  return { ready: channelReady, degraded: channelDegraded, error: channelError };
}

setupNotifications();

/** 当前权限状态。只查不弹窗，可以在任意时刻调用 */
export async function getPermissionState(): Promise<PermissionState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    // iOS 的 provisional / ephemeral 也算能收，统一按 granted 处理
    if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return 'granted';
    }
    return p.status === 'undetermined' ? 'undetermined' : 'denied';
  } catch {
    // 系统接口异常时按"不能发"处理：宁可什么都不弹，也不要抛到界面上
    return 'denied';
  }
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
  try {
    const res = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    // 只有「从未决变已授」这一瞬间才置位：权限不会重复授予，
    // 所以引导只需要弹一次，不必再往 storage 里存一个"看过没"的字段
    if (res.granted) freshGrant = true;
    return res.granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
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

/** 取消本 App 排下的所有待发通知。读不到就当没有，别让取消失败挡住重排 */
async function cancelOwn(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const mine = all.filter((n) => n.content.data?.app === MARK);
    await Promise.all(mine.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch {
    // 系统接口异常时跳过：宁可留着旧提醒，也不要让整轮重排崩掉
  }
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

  // 渠道建不出来时仍然排程，只是不指定 channelId：让系统走兜底渠道，
  // 至少还能收到提醒，不至于因为一个装饰性字段全军覆没
  const withChannel = await ensureChannel();

  await cancelOwn();

  const now = Date.now();
  const upcoming = items
    .map((item) => ({ item, at: remindAtOf(item, now) }))
    .filter((x): x is { item: Schedule; at: number } => x.at !== null)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_SCHEDULED);

  let scheduled = 0;
  for (const { item, at } of upcoming) {
    try {
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
          ...(withChannel ? { channelId: CHANNEL_ID } : {}),
        },
      });
      scheduled += 1;
    } catch {
      // 单条排不上不影响其它条：这是"尽力而为"的批量排程
    }
  }
  return scheduled;
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

  const withChannel = await ensureChannel();
  try {
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
        ...(withChannel ? { channelId: CHANNEL_ID } : {}),
      },
    });
  } catch {
    // 排不上就不抛：设置页 6 秒后会自动刷新「已排程 N 条」，那里能看到真实结果
  }
  return 'granted';
}

/** 打开本 App 的系统设置页：通知权限、省电策略、自启动都在这一页里 */
export function openAppSystemSettings(): void {
  void Linking.openSettings();
}

/**
 * 后台限制较狠的品牌。这些系统的省电策略会把 App 的闹钟推迟甚至掐掉，
 * 表现就是「测试通知立刻能收到，锁屏久了到点却不响」。
 * 品牌名从 Platform.constants 读，不需要额外装原生库。
 */
const STRICT_BRANDS = /xiaomi|redmi|poco|huawei|honor|oppo|vivo|iqoo|oneplus|realme|meizu|samsung/i;

/** 当前机型品牌（安卓才有意义，取不到时返回空串） */
export function deviceBrand(): string {
  if (Platform.OS !== 'android') return '';
  const c = (Platform as unknown as { constants?: Record<string, unknown> }).constants ?? {};
  return String(c.Brand ?? c.Manufacturer ?? '');
}

/** 是否属于「需要引导用户去把省电策略改成无限制」的机型 */
export function needsBatteryHint(): boolean {
  return Platform.OS === 'android' && STRICT_BRANDS.test(deviceBrand());
}

/**
 * 是否「刚刚」拿到了通知权限。
 * 用它来决定要不要弹省电策略引导：权限只会有一次从未决变已授，
 * 天然就是一次性的，不用往 storage 里加"已提示过"的字段。
 */
let freshGrant = false;

/** 读一次就清零，避免来回切页面时反复弹 */
export function consumeFreshGrant(): boolean {
  const value = freshGrant;
  freshGrant = false;
  return value;
}
