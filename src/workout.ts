import AsyncStorage from '@react-native-async-storage/async-storage';
import type { JumpStyle } from './jumpStyle';
import type { JumpMode } from './data';

/**
 * 训练项目类型的唯一定义在 data.ts（它要跟着 Schedule 一起存），
 * 这里只做转出，避免两处各写一份、以后改一处漏一处。
 */
export type { JumpMode };

export const MODE_WORD: Record<JumpMode, string> = {
  timer: '定时跳',
  count: '定数跳',
  trick: '花样跳',
  free: '自由跳',
};

/**
 * 一次训练的成绩记录。
 *
 * 为什么不挂在日程上：
 *   训练页的 GO 是独立入口，跳完那一刻并不对应某一条具体日程
 *   （一条重复日程有 365 个实例，谁也不知道这次练的是哪一天的）。
 *   所以成绩单独成一条记录，自带日期和名称，日历那边不需要跟着改。
 */
export type Workout = {
  id: string;
  /** 训练结束的时间戳 */
  at: number;
  /** 显示名称：默认自动生成，用户可以在成绩页改 */
  name: string;
  mode: JumpMode;
  jumpStyle: JumpStyle;
  /** 实际跳了多少个 */
  count: number;
  /** 实际用时（秒） */
  duration: number;
  /** 目标：定时跳是秒数，定数跳是个数 */
  target: number;
  /**
   * 视频。这一版只留字段，不写入 —— 录制模块下个大版本接。
   * 有值的时候成绩页会显示缩略图入口，没值就显示「视频待开启」。
   */
  videoUri?: string;
  /** 视频时长（秒），列表里显示用 */
  videoDuration?: number;
  /**
   * 这次训练来自哪条日程。
   *
   * 从训练页 GO 进来的没有这个字段（那是独立训练，不对应任何计划）；
   * 从日程「去训练 / 开始训练」进来的会带上那条日程的 id，
   * 保存成绩时顺手把那条日程标成已完成 —— 用户按计划练完了，
   * 回来却发现还得手动打个勾，这种事不该发生。
   */
  scheduleId?: string;
  /**
   * 本次训练里每个动作问题出现了几次，例如 { handsHigh: 3, kneesBent: 1 }。
   *
   * 由计数页在训练过程中统计（每次从"没问题"变成"有问题"算 1 次）。
   * 结算页拿它做「AI 动作分析」那一块，成绩详情以后也能回顾。
   * 老记录没有这个字段，读的时候一律当空对象处理。
   */
  posture?: Record<string, number>;
};

/**
 * 定数跳的目标个数上下限。
 *
 * 原来只在训练页里定义，现在新建计划也要用同一套限制，
 * 所以搬到这儿统一出口 —— 两处的校验必须完全一致，
 * 不然计划里能填 20000、进训练页又被砍回 10000，很费解。
 */
export const MIN_COUNT = 50;
export const MAX_COUNT = 10000;

/** 独立存储键：不动 zenith.data.v1 的结构，日程那边的读写完全不受影响 */
const WORKOUT_KEY = 'zenith.workouts.v1';
/** 只保留最近多少条：视频接进来之后存储会涨，先定个数免得无限长 */
const MAX_RECORDS = 300;

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 26.11.26 这种短日期：比 2026-11-26 紧凑，放在名称里更像一条训练记录 */
function dateStamp(at: number) {
  const d = new Date(at);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

/**
 * 默认名称：`26.11.26.定时跳30秒` / `26.11.26.定数跳500个`
 *
 * 定时跳用「目标秒数」，定数跳用「实际完成个数」——
 * 因为定数跳经常没跳完就停，写实际数比写目标数诚实。
 */
export function defaultWorkoutName(w: Pick<Workout, 'at' | 'mode' | 'target' | 'count'>) {
  const stamp = dateStamp(w.at);
  const word = MODE_WORD[w.mode];
  const amount = w.mode === 'timer'
    ? `${Math.round(w.target)}秒`
    : `${w.count}个`;
  return `${stamp}.${word}${amount}`;
}

export function createWorkout(input: {
  mode: JumpMode;
  jumpStyle: JumpStyle;
  count: number;
  duration: number;
  target: number;
  scheduleId?: string;
  posture?: Record<string, number>;
}): Workout {
  const at = Date.now();
  return {
    id: makeId(),
    at,
    name: defaultWorkoutName({ at, ...input }),
    ...input,
  };
}

export async function loadWorkouts(): Promise<Workout[]> {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((w) => w && typeof w.id === 'string' && typeof w.at === 'number');
  } catch {
    return [];
  }
}

export async function saveWorkouts(list: Workout[]): Promise<void> {
  try {
    const trimmed = list.slice(0, MAX_RECORDS);
    await AsyncStorage.setItem(WORKOUT_KEY, JSON.stringify(trimmed));
  } catch {
    // 写失败不影响本次训练，用户下次打开还是旧列表 —— 不值得弹错打断
  }
}

/** 把秒数格式化成 12:34，列表和结果页共用 */
export function formatDuration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * 把时长说成人话：30 秒 / 1 分钟 / 1 分 30 秒。
 *
 * 成绩页的档位标签、训练页的计划胶囊都要用同一个说法，
 * 分成两处写迟早会一个说「60 秒」一个说「1 分钟」。
 */
export function durationWord(sec: number) {
  const total = Math.max(0, Math.round(sec));
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const r = total % 60;
  return r === 0 ? `${m} 分钟` : `${m} 分 ${r} 秒`;
}

/** 列表里显示的时间：19:32 */
export function formatClock(at: number) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * 标准成绩口径
 *
 * 成绩页顶部要显示「换脚跳最好成绩」「并脚跳最好成绩」。
 * 但"最好"必须有个可比的前提 —— 跳 3 分钟跳 300 个，
 * 和跳 30 秒跳 42 个，哪个算好？没法比。
 *
 * 所以每种跳法只认两个固定档位（这也是新建计划的默认值）：
 *   换脚跳  定时跳 30 秒  → 比个数        定数跳 200 个 → 比用时
 *   并脚跳  定时跳 60 秒  → 比个数        定数跳 300 个 → 比用时
 *
 * 不在档位上的训练照常记成绩，只是不进"最好成绩"评选。
 * ------------------------------------------------------------------ */
export const STANDARD: Record<JumpStyle, { timerTarget: number; countTarget: number }> = {
  together: { timerTarget: 60, countTarget: 300 },
  alternate: { timerTarget: 30, countTarget: 200 },
};

/** 某种跳法的两项最好成绩；没练过就是 null */
export type StyleBest = {
  /** 标准时长（定时跳）里个数最多的那次 */
  timer: Workout | null;
  /** 标准个数（定数跳）里用时最短的那次 */
  count: Workout | null;
};

export type WorkoutStats = {
  /** 本月训练次数 */
  monthCount: number;
  /** 历史最长连续训练天数 */
  streakDays: number;
  /** 当前连续天数（今天或昨天练过才连着） */
  currentStreak: number;
  best: Record<JumpStyle, StyleBest>;
};

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** 本地日期键：2026-11-26 */
function dayKeyOf(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 日期键 → 天序号。用 UTC 算，避开夏令时/时区把差值算成 23 或 25 小时 */
function dayIndex(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
}

/**
 * 把训练记录算成成绩页顶部那几个数。
 *
 * 全部按本地日期算 —— 用户眼里的"今天"是手机上的今天，
 * 用 UTC 会让晚上练的算到明天去。
 */
export function computeStats(list: Workout[], now = Date.now()): WorkoutStats {
  const today = new Date(now);
  const monthPrefix = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;

  let monthCount = 0;
  for (const w of list) {
    if (dayKeyOf(w.at).startsWith(monthPrefix)) monthCount += 1;
  }

  // 连续天数：先去重再排序，找最长的一段连续整数
  const days = [...new Set(list.map((w) => dayKeyOf(w.at)))]
    .map(dayIndex)
    .sort((a, b) => a - b);

  let streakDays = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const d of days) {
    run = d === prev + 1 ? run + 1 : 1;
    if (run > streakDays) streakDays = run;
    prev = d;
  }

  // 当前连续：从今天（或昨天）往前数，断了就停
  const todayIdx = dayIndex(dayKeyOf(now));
  const daySet = new Set(days);
  let currentStreak = 0;
  let cursor = daySet.has(todayIdx) ? todayIdx : todayIdx - 1;
  while (daySet.has(cursor)) {
    currentStreak += 1;
    cursor -= 1;
  }

  const best: Record<JumpStyle, StyleBest> = {
    together: { timer: null, count: null },
    alternate: { timer: null, count: null },
  };

  for (const w of list) {
    // 早期记录可能没存 jumpStyle —— 一律当并脚跳，不能让它静默掉出统计
    const style: JumpStyle = w.jumpStyle === 'alternate' ? 'alternate' : 'together';
    const std = STANDARD[style];
    const b = best[style];

    if (w.mode === 'timer'
      && Math.round(w.target) === std.timerTarget
      && w.duration >= std.timerTarget - 2) {
      // 时长对上了，比个数
      if (!b.timer || w.count > b.timer.count) b.timer = w;
    } else if (w.mode === 'count'
      && Math.round(w.target) === std.countTarget
      && w.count >= std.countTarget) {
      // 个数跳够了，比用时
      if (!b.count || w.duration < b.count.duration) b.count = w;
    }
  }

  return { monthCount, streakDays, currentStreak, best };
}
