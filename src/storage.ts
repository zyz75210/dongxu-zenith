/**
 * 本地持久化（1.1 待办 #1）。
 *
 * 只负责「内存对象 <-> AsyncStorage 字符串」这一层：带上 schemaVersion 方便以后迁移，
 * 读回来时逐字段校验，避免被改坏的数据让整个 App 起不来。
 * 什么时候读、什么时候写由 App.tsx 决定，这里不碰 React。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initialProfile,
  Profile,
  Schedule,
  ScheduleType,
} from './data';

const STORAGE_KEY = 'zenith.data.v1';

/** 数据结构版本。以后字段不兼容时 +1，并在 loadPersistedData 里加迁移分支。 */
const SCHEMA_VERSION = 1;

type PersistedShape = {
  schemaVersion: number;
  schedules: Schedule[];
  profile: Profile;
};

export type LoadedData = {
  schedules: Schedule[];
  profile: Profile;
};

const SCHEDULE_TYPES: readonly ScheduleType[] = [
  'rope', 'fitness', 'run',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isScheduleType(v: unknown): v is ScheduleType {
  return typeof v === 'string' && (SCHEDULE_TYPES as readonly string[]).includes(v);
}

/** 把一条读回来的数据规整成 Schedule；认不出来就丢掉，不让脏数据进内存。 */
function parseSchedule(v: unknown): Schedule | null {
  if (!isRecord(v)) return null;
  const { id, date, title, start, end, type } = v;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof title !== 'string') return null;
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  if (!isScheduleType(type)) return null;

  const item: Schedule = { id, date, title, start, end, type };
  if (typeof v.tag === 'string') item.tag = v.tag;
  if (typeof v.note === 'string') item.note = v.note;
  if (typeof v.remind === 'boolean') item.remind = v.remind;
  if (typeof v.completed === 'boolean') item.completed = v.completed;
  return item;
}

function parseProfile(v: unknown): Profile | null {
  if (!isRecord(v)) return null;
  const { name, nickname, email, birthday } = v;
  if (typeof name !== 'string') return null;
  if (typeof nickname !== 'string') return null;
  if (typeof email !== 'string') return null;
  if (!isRecord(birthday)) return null;
  const { y, m, d } = birthday;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof m !== 'number' || !Number.isFinite(m)) return null;
  if (typeof d !== 'number' || !Number.isFinite(d)) return null;

  const out: Profile = { name, nickname, email, birthday: { y, m, d } };
  if (typeof v.avatar === 'string') out.avatar = v.avatar;
  return out;
}

/**
 * 启动时读一次。返回 null 表示「没有存过 / 读坏了」，调用方就用初始值。
 * 任何异常都吞掉——存储不可用不应该让 App 起不来。
 */
export async function loadPersistedData(): Promise<LoadedData | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    // 版本不匹配：现在只有 v1，先按「没有数据」处理；以后在这里写迁移再放行。
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.schedules)) return null;

    const schedules = parsed.schedules
      .map(parseSchedule)
      .filter((s): s is Schedule => s !== null);
    const profile = parseProfile(parsed.profile) ?? initialProfile;
    return { schedules, profile };
  } catch {
    return null;
  }
}

/**
 * 写入一份完整快照。覆盖式写入即可（数据量小），不做逐条 diff。
 * 写失败（比如空间不足）也不抛给业务层：内存里的操作照常进行。
 */
export async function savePersistedData(schedules: Schedule[], profile: Profile): Promise<void> {
  const payload: PersistedShape = { schemaVersion: SCHEMA_VERSION, schedules, profile };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 静默失败：下次变更会再试一次
  }
}
