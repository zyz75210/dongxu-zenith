/**
 * 段位进度：只存「已掌握动作」的 key 列表（形如 `2-5`）。
 *
 * 刻意不走 storage.ts 那套 schema —— 那边一动 schemaVersion 就得写迁移，
 * 迁移写错会把用户的日程一起丢掉。段位进度是独立的一小份数据，
 * 读坏了也只是回到「一段从头开始」，与日程互不影响。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STAGES, actionKey } from './grades';

const KEY = 'zenith.grades.v1';

export type StageStat = { total: number; got: number };
export type StageState = 'done' | 'cur' | 'lock';

const KEY_RE = /^\d+-\d+$/;

export async function loadGradeProgress(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 只收格式对的 key；数量越界的旧数据交给 stageStats 忽略
    return parsed.filter((v): v is string => typeof v === 'string' && KEY_RE.test(v));
  } catch {
    return [];
  }
}

export async function saveGradeProgress(keys: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(keys));
  } catch {
    // 静默失败：下次改动会再写一次
  }
}

/** 每一段已掌握几个 / 一共几个。越界的 key 不计入。 */
export function stageStats(done: Set<string>): StageStat[] {
  return STAGES.map((s, i) => ({
    total: s.actions.length,
    got: s.actions.reduce((n, _, j) => (done.has(actionKey(i, j)) ? n + 1 : n), 0),
  }));
}

/** 解锁线：上一段掌握到这个比例，下一段就可以开始挑战 */
export const UNLOCK_RATIO = 0.5;

/** 这一段要掌握几个才算「够到下一段」：8 个动作 → 4 个，14 个 → 7 个 */
export const unlockNeed = (total: number) => Math.ceil(total * UNLOCK_RATIO);

/**
 * 段位状态：整段动作都掌握 = 已通关；
 * 上一段掌握过半（≥50%）= 这一段可以开始挑战；否则锁着。
 *
 * 早先的门槛是「上一段必须全部掌握」，结果是只要卡在一个动作上，
 * 后面整条路都走不动 —— 对只想先试试某个模块的人太狠。
 * 现在改成 50%：够得着下一段，但「通关」仍然要求整段掌握，
 * 所以已获段位不会虚高，解锁的和算通关的是两件事。
 *
 * 一段永远可练，新用户打开地图不会看到「一片灰」。
 */
export function stageStates(stats: StageStat[]): StageState[] {
  return stats.map((st, i) => {
    if (st.total > 0 && st.got === st.total) return 'done';
    if (i === 0) return 'cur';
    const prev = stats[i - 1];
    if (prev && prev.total > 0 && prev.got >= unlockNeed(prev.total)) return 'cur';
    return 'lock';
  });
}

/**
 * 点亮线：这一段剩下的未掌握动作 ≤ 2 个，就算点亮。
 *
 * 不要求 100%：卡在最后那一两个动作上（比如双摇还没稳）是很常见的事，
 * 之前整段一直是灰的，看着像「这一段白练了」。现在差两个就点亮，
 * 和「上一段过半就解锁」是同一个思路 —— 让路先能走通。
 * 「通关」仍然要求整段全部掌握，点亮不等于通关。
 */
export const LIT_REMAIN = 2;

/** 这一段是否点亮：至少动手过，且剩余未掌握 ≤ 2 个 */
export const isLit = (st: StageStat) =>
  st.total > 0 && st.got > 0 && st.total - st.got <= LIT_REMAIN;

/**
 * 每个动作值多少分 —— 按段位分级，越往后越值钱：
 * 一~三段 5 分、四~五段 10 分、六~八段 20 分、九段 30 分。
 *
 * 用一个数组按段位下标取，别再写「动作数 × 固定分值」：
 * 固定分值会让后期的段位（动作更多更难）和起手段位同价，练到高阶反而没成就感。
 * 九段满分 = 8×5×3 + 8×10×2 + 20×(8+12+16) + 14×30 = 1,420 分。
 */
const POINT_BY_STAGE = [5, 5, 5, 10, 10, 20, 20, 20, 30];

/** 第 i 段每个动作的积分（下标越界时退到最后一段的分值，不抛错） */
export const stagePoint = (i: number) =>
  POINT_BY_STAGE[Math.min(Math.max(i, 0), POINT_BY_STAGE.length - 1)];

/** 首页卡与地图头部要的三个数：已点亮段位、已掌握动作、累计积分 */
export function gradeTotals(stats: StageStat[]) {
  return {
    litStages: stats.filter(isLit).length,
    mastered: stats.reduce((n, s) => n + s.got, 0),
    points: stats.reduce((n, s, i) => n + s.got * stagePoint(i), 0),
  };
}
