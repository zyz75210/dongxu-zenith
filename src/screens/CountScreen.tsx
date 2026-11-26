import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import {
  Delegate, RunningMode, usePoseDetection,
} from 'react-native-mediapipe-posedetection';
import Svg, { Polyline } from 'react-native-svg';
import { C } from '../theme';
import { jumpStyleLabel, type JumpStyle } from '../jumpStyle';
import {
  createWorkout, defaultWorkoutName, formatDuration, MODE_WORD,
  type JumpMode, type Workout,
} from '../workout';
import {
  keepIssue, pickPosture, readPosture, POSTURE_OK, POSTURE_TEXT,
  type PostureKey, type PostureReadOpts, type PostureSample,
} from '../posture';
import { useVoice, type VoiceMode } from '../audio';

/**
 * 计数页（2a 验证版）。
 *
 * 这一版只做一件事：把「跳一下能不能数对」验证掉。
 * 计分、动作分析、回放这些（2b / 2c）都往后放。
 *
 * ## 计数原理（zigzag 峰值检测）
 *
 * 取「髋部中点」的高度当作人的重心高度。跳起时升高，落地时降低。
 *
 * 不用「跟基线比高低」那种做法，是因为它有个致命缺点：
 * 人往前站、往后退、走开两步，整体高度就变了，基线再怎么也跟不上，
 * 状态机一旦卡在"空中"，就再也不计数（上一版正是这么卡死的）。
 *
 * 改成只看"局部波动"：
 *   1. 高度平滑（3 帧中位数），把单帧抖动吃掉；
 *   2. 一直跟踪当前这一段的最高点和最低点；
 *   3. 从最低点回升超过 REV → 认为「起跳结束」，落定一个谷；
 *   4. 从最高点回落超过 REV → 认为「落地结束」，落定一个峰；
 *   5. 在落定谷的那一刻，看这个峰到谷的落差够不够最小跳幅：
 *        够 → 算跳了一次；不够 → 当噪声忽略。
 *
 * 因为只比"这一段里的落差"，人站在画面哪个位置、站多远、走开又回来，
 * 都不影响判定 —— 这正是「人不在正中间也能数」的关键。
 *
 * ## 为什么看髋部
 *   - 换脚跳两只脚交替抬，脚踝等于没动；髋部是重心，每一下都在动。
 *   - 脚常在画面最下缘容易糊，髋部在画面中间，稳。
 *
 * ## 为什么把坐标投影到身体轴上
 *   这个库的安卓端原本把画面旋转角度写死成 0 度（已经在 patches/ 里修好，
 *   改为透传 CameraX 的真实角度）。为了兼容两种坐标系，这里仍按
 *   「肩中点 → 髋中点」这条身体轴做投影，并且在轴向上做慢速平滑，
 *   避免侧身时轴方向乱抖。
 */

const MODEL = 'pose_landmarker_lite.task';

/**
 * 两种跳法的判定参数（单位都是「躯干长度」的倍数，躯干约 60cm）。
 *
 * 并脚跳：双足同起同落。信号取【腿收缩量】——
 *         真跳时腿收起来、脚踝靠近髋部；镜头晃动时脚和髋一起平移，距离不变。
 *         整体平移对它完全无效，所以门槛能压得很低，轻跳也数得到。
 *
 * 换脚跳：取【两只脚抬升量之差】。左右交替时差值在两个方向大幅摆动，
 *         镜头整体平移时两脚同增同减、差值恒为 0 —— 天然免疫，不用任何闸门。
 */
const TUNE = {
  together: { minAmp: 0.010, rev: 0.005, closeRatio: 0.8 },
  alternate: { minAmp: 0.012, rev: 0.005, closeRatio: 1 },
} as const;

/** 两次计数最小间隔：110ms 对应每秒 9 次，真实跳绳到不了这么快 */
/** 并脚跳融合信号里，扣掉髋部抬升的比例（扣掉"整个画面在平移"的那部分） */
const HIP_CANCEL = 0.85;
const MIN_GAP_MS = 110;
/** 平滑窗口：5 帧中位数，吃掉单帧抖动又不抹掉真位移 */
/** 多久没有新的识别结果就认为人已经离开画面（毫秒） */
const LOST_MS = 700;
/** 超过这么久没有有效帧，就认为追踪断了，重新开始记 */
const RESET_MS = 1500;
/** 波形保留多少帧 */
const WAVE_N = 90;
/** 帧率低于这个值就提示（采样太慢必然漏数） */
const LOW_FPS = 8;

/**
 * 从一帧关键点里算「脚抬起多高」。
 *
 * 这套判据是照着一个成熟的同类产品（Skipper·绳星球）反推出来的，它的做法是：
 *   ① 双足离地 —— 两只脚都离开地面，走路永远做不到；
 *   ② 幅度按「躯干长度」归一 —— 站远站近都不影响，还能滤掉关键点抖动；
 *   ③ 关键点做平滑 —— 抑制模型抖动。
 *
 * 我们这里取【两只脚踝里抬得更高的那只】：
 *   - 并脚跳：两脚一起抬，取谁都一样；
 *   - 换脚跳：总有一只脚在抬，取较高的那只才不会被"另一只落地"抵消。
 *   （之前用重心，换脚跳时左右一上一下互相抵消，这就是换脚跳数不上的原因。）
 *
 * 归一化用【躯干长度（肩中点→髋中点）】而不是"肩到脚踝"：
 * 腿伸直/弯曲会让肩到脚踝忽长忽短，把信号缩放得面目全非（之前出现过 19% 的假振幅）。
 * 躯干长度基本恒定，是这里最可靠的一把尺子。
 *
 * 地面参考 gL/gR 用「只跟低、不跟高」的包络：
 * 脚踩到更低的位置立刻跟上；人走远了就极缓慢回落，不会把跳跃当成地面变化。
 */
function footLift(lm: any[], prev: {
  torso: number;
  gL: number;
  gR: number;
}) {
  const vis = (i: number, j: number) =>
    ((lm[i].visibility ?? 1) + (lm[j].visibility ?? 1)) / 2;

  // 肩和髋的置信度不够，这一帧直接作废
  if (vis(11, 12) < 0.5 || vis(23, 24) < 0.5) return null;

  const sy = (lm[11].y + lm[12].y) / 2;
  const hy = (lm[23].y + lm[24].y) / 2;

  // 脚踝置信度低（被裤腿挡、出画面）时，坐标可能是乱值。
  // 这时沿用上一帧的位置，比丢掉整帧稳妥 —— 换脚跳时一只脚总有一瞬间看不见。
  let aLy = lm[27].y;
  let aRy = lm[28].y;
  if ((lm[27].visibility ?? 1) < 0.3 && prev.aLy > 0) aLy = prev.aLy;
  if ((lm[28].visibility ?? 1) < 0.3 && prev.aRy > 0) aRy = prev.aRy;

  // 躯干长度 = 尺子。太短说明人离得太远或关键点糊了
  const rawTorso = Math.abs(hy - sy);
  if (!(rawTorso > 0.04)) return null;
  const torso = prev.torso > 0.04 ? prev.torso * 0.85 + rawTorso * 0.15 : rawTorso;

  // 地面参考（包络）：更低就跟上，更高只极慢回落
  let gL = prev.gL;
  let gR = prev.gR;
  if (!(gL > 0)) gL = aLy;
  else if (aLy > gL) gL = aLy;
  else gL += (aLy - gL) * 0.02;
  if (!(gR > 0)) gR = aRy;
  else if (aRy > gR) gR = aRy;
  else gR += (aRy - gR) * 0.02;

  // 髋部参考（包络）：用来判断"是人在跳"还是"整个画面在晃"
  let gH = prev.gH;
  if (!(gH > 0)) gH = hy;
  else if (hy > gH) gH = hy;
  else gH += (hy - gH) * 0.02;

  /*
   * 腿长（髋中点到脚踝中点的竖直距离）与它的「站立包络」。
   *
   * 这是并脚跳真正该看的量：真跳时腿收起来，脚踝靠近髋部，腿长变短；
   * 镜头晃动时脚和髋一起平移，腿长纹丝不动。整体平移对这个量完全无效。
   *
   * 包络只跟高：站起来（腿最长）立刻更新；人走远了一点就慢速回落，
   * 免得把"人退后半步"当成"跳了一次"。
   */
  const legLen = (aLy + aRy) / 2 - hy;
  let legMax = prev.legMax;
  if (!(legMax > 0.02)) legMax = legLen;
  else if (legLen > legMax) legMax = legLen;
  else legMax += (legLen - legMax) * 0.02;
  // 收腿量：站立时 0，腿收得越多越接近 1
  // 上限 0.5：腿最多收掉一半，再大就是脚踝关键点抽风了，不能让它顶爆信号
  const legLift = legMax > 0.02
    ? Math.max(0, Math.min(0.5, (legMax - legLen) / legMax))
    : 0;

  // 抬脚量：除以躯干长度，无量纲，越大抬得越高
  const liftL = (gL - aLy) / torso;
  const liftR = (gR - aRy) / torso;
  // 髋部抬升量：画面晃动时它和抬脚量同增同减，相减就能抵消
  const hipLift = (gH - hy) / torso;

  if (!Number.isFinite(liftL) || !Number.isFinite(liftR) || !Number.isFinite(hipLift)) {
    return null;
  }
  if (Math.abs(liftL) > 6 || Math.abs(liftR) > 6) return null;

  // 图像正不正：脚踝应该明显在髋部下方
  const land = aLy > hy && aRy > hy;

  // 髋部的横向位置（归一化，不乘宽高比）：用来判断人是不是在走动
  const hx = (lm[23].x + lm[24].x) / 2;

  return {
    liftL, liftR, hipLift, legLift, legMax, torso,
    gL, gR, gH, aLy, aRy, hx, land,
  };
}

/**
 * zigzag 峰值检测器的状态。
 *
 * 抽成一个结构 + 一个纯函数，是因为换脚跳要**同时跑两套**：
 * 左脚一套、右脚一套，各自独立计数。这样"每只脚抬起都必然 +1"，
 * 不会出现"只数到一只脚"的问题。
 */
type ZigState = {
  dir: 'up' | 'down';
  peak: number;
  valley: number;
  /** 已确认的最高点，等落地确认后才结算 */
  pending: number | null;
  started: boolean;
  lastAt: number;
  /** 最近一次确认的振幅，只给界面显示用 */
  lastAmp: number;
};

const newZig = (): ZigState => ({
  dir: 'up', peak: 0, valley: 0, pending: null,
  started: false, lastAt: 0, lastAmp: 0,
});

/**
 * 推进一步。返回 true = 刚刚完成一次「起 → 落」的完整周期，应该 +1。
 *
 * 只确认半个周期不计数：站着不动的抖动最多只能伪造"到顶"，伪造不出"落地"。
 */
function zigzagStep(
  z: ZigState, v: number, now: number, minAmp: number, rev: number,
): boolean {
  if (!z.started) {
    z.peak = v;
    z.valley = v;
    z.dir = 'up';
    z.started = true;
    return false;
  }
  /*
   * 转向的回撤门槛是「自适应」的：不只看绝对值 rev，还要求回落达到
   * 上一次跳跃振幅的 30%。
   *
   * 为什么必须有这个自适应项：
   *   上一版用「连续 2 帧确认」抗噪，代价是每次转向都晚一帧。
   *   快速跳时一个周期只有 3~5 帧，晚一帧就等于漏掉一个周期 ——
   *   这就是"跳得越快漏得越多"的直接原因。
   *
   *   改成按振幅比例判断：噪声毛刺的幅度远小于真跳跃的 30%，
   *   一帧就被否决；而真跳跃的回落是完整的，一帧就能确认，没有任何延迟。
   */
  /*
   * 「快节奏」判定：上一次成功计数距离现在不到 420ms（约每秒 2.4 次以上）。
   *
   * 为什么要单独识别快节奏：
   *   快速跳的时候人一定跳得矮，信号幅度本来就小；如果还按慢跳的门槛来卡，
   *   就会"越急越数不上"。而这时候人是**确定在跳**的 —— 静止晃动不可能
   *   持续呈现每秒 2~3 次的规律节奏。
   *
   * 所以一旦进入快节奏，门槛自动放松 40%，回撤比例也从 30% 降到 20%：
   *   · 慢跳 / 刚开测 / 静止晃动 → 用严格参数（lastAt 为 0，走不到这个分支）
   *   · 已经连上节奏             → 用宽松参数，专抓小幅度快跳
   *
   * 这是"节奏验证"的思路：不靠把门槛压得很低来救快跳，
   * 而是先确认你确实在跳，再对正在跳的人放宽。
   */
  const fast = z.lastAt > 0 && now - z.lastAt < 420;
  const pullback = z.lastAmp > 0
    ? Math.max(rev, z.lastAmp * (fast ? 0.2 : 0.3))
    : rev;
  const ampNeed = fast ? minAmp * 0.6 : minAmp;

  if (z.dir === 'up') {
    if (v > z.peak) {
      z.peak = v;
    } else if (z.peak - v > pullback) {
      z.pending = z.peak;
      z.dir = 'down';
      z.valley = v;
    }
    return false;
  }
  if (v < z.valley) {
    z.valley = v;
    return false;
  }
  if (v - z.valley > pullback) {
    const top = z.pending;
    let counted = false;
    if (top !== null) {
      const amp = top - z.valley;
      z.lastAmp = amp;
      // 上限 0.8（躯干 80%）：换脚跳提膝时脚踝能抬到 40% 以上，
      // 原来卡 0.5 会把幅度大的那几下直接丢掉，这是"漏数"的另一个来源
      if (amp >= ampNeed && amp <= 0.8 && now - z.lastAt >= MIN_GAP_MS) {
        z.lastAt = now;
        counted = true;
      }
      z.pending = null;
    }
    z.dir = 'up';
    z.peak = v;
    return counted;
  }
  return false;
}

/**
 * 把高度序列折成一条线。
 * 上下按当前窗口的极值拉伸，所以永远铺满整个框（看形状不看绝对值）。
 */
function wavePoints(data: number[], w = 320, h = 54) {
  if (data.length < 2) return '';
  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min < 1e-5 ? 1e-5 : max - min;
  return data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

type Props = {
  /** 页面是否在前台：退出去要关相机，否则一直在耗电 */
  active: boolean;
  /** 训练页选好的跳法：决定用哪一套计数判据 */
  jumpStyle: JumpStyle;
  /** 训练项目：定时跳 / 定数跳。花样跳和自由跳还没接 */
  mode: JumpMode;
  /** 目标：定时跳是秒数，定数跳是个数 */
  target: number;
  /**
   * 从哪条日程进来的。有值就在保存成绩时把那条日程标成完成。
   * 从训练页 GO 进来是 undefined —— 那种训练不对应任何计划。
   */
  scheduleId?: string;
  /**
   * 状态栏高度。
   * 这一页是全屏铺底的（不套 SafeAreaView），顶部控件得自己避开状态栏，
   * 否则关闭按钮会顶到时间显示上。
   */
  insetTop?: number;
  /**
   * 历史成绩（新的在前）。只用来做结算页的「比上次多/少几个」，
   * 不在这里落库 —— 落库一律走 onDone。
   */
  history?: Workout[];
  /** 播报模式：比赛语音（MP3）/ 亲切语音（TTS 3-2-1） */
  voice: VoiceMode;
  onExit: () => void;
  /** 一次训练结束并保存：把完整成绩交出去，由 App 层落库并跳成绩页 */
  onDone?: (w: Workout) => void;
};

/**
 * 页面的四个阶段。
 *
 * ready     刚进来，只有预览，什么都不会发生
 * countdown 3-2-1，人往画面里站好，这段时间不计数
 * running   正式计数
 * done      结果页（盖在相机上面）
 */
/* ---------- 动作提示的指标平滑器 ---------- */

/** 调试面板用的数字格式化：读不到就显示横杠，别显示 0 骗人 */
const fix = (v: number | null, d = 2) =>
  (v === null || !Number.isFinite(v) ? '—' : v.toFixed(d));

/**
 * 每一项单独平滑：
 *   · 这一帧读到值 → 按 0.3 往新值靠（约 5 帧跟到位，反应不能太慢，否则"不灵敏"）；
 *   · 这一帧读不到（手腕被腿挡住、脚尖出画面）→ 沿用上一次的值，
 *     但连续 20 帧都读不到就作废成 null —— 不然一个过期值会一直挂着判错。
 */
type PostureField = Exclude<keyof PostureSample, 'spanX'>;
const POSTURE_FIELDS: PostureField[] = [
  'handUp', 'handDiff', 'armSpread', 'facing', 'kneeAngle', 'headDrop', 'inward', 'legRaise',
];
const PST_ALPHA = 0.3;
const PST_MISS_MAX = 20;

type PostureSmooth = {
  v: Record<PostureField, number | null>;
  miss: Record<PostureField, number>;
};

const emptyPostureSmooth = (): PostureSmooth => ({
  v: {
    handUp: null, handDiff: null, armSpread: null,
    facing: null, kneeAngle: null, headDrop: null, inward: null, legRaise: null,
  },
  miss: {
    handUp: 0, handDiff: 0, armSpread: 0,
    facing: 0, kneeAngle: 0, headDrop: 0, inward: 0, legRaise: 0,
  },
});

type Phase = 'ready' | 'countdown' | 'running' | 'paused' | 'done';

/** 柱子数量：24 根、每根约 11px，比 32 根细柱醒目得多 */
const BAR_N = 24;

/**
 * 柱子高矮由「相邻两次落地的间隔」决定：跳得慢柱子高、跳得快柱子矮。
 *
 * 区间 200 ~ 520ms，是按真实跳绳节奏卡出来的：
 *   200ms → 每分钟 300 个（极限冲速度）
 *   300ms → 每分钟 200 个（快跳）
 *   400ms → 每分钟 150 个（正常）
 *   520ms → 每分钟 115 个（慢跳）
 *
 * 为什么从 250~950 一路收到 200~520：
 *   跳绳绝大多数时间落在 300~450ms（每分钟 130~200 个），
 *   原来那个区间里这一段只占 20%，柱子全挤在 6~12px 之间晃 ——
 *   肉眼看就是"一片矮桩，跳快跳慢一个样"。现在同样的变化能铺满 10~42px，
 *   快跳时每一跳的高矮差都能看出来。
 *
 * 跳得比 520ms 还慢（每分钟 115 个以下）会顶到最高的柱子，不再继续变高 ——
 * 那种速度更该看"稳不稳"，不该继续拉高。
 */
const barHeight = (gap: number) => {
  const t = Math.min(1, Math.max(0, (gap - 200) / 320));
  // 最矮也给 10px：快跳时柱子太短会看起来像"没在动"
  return Math.round(10 + t * 32);
};

/** 倒计时从几开始 */
const COUNTDOWN_FROM = 3;
/** 每个数字停多久（毫秒）。800ms 大约是「三、二、一」的自然语速 */
const COUNTDOWN_STEP_MS = 800;

function CountScreen({
  active, jumpStyle, mode, target, scheduleId, insetTop = 0, history, voice, onExit, onDone,
}: Props) {
  /** 训练播报：比赛语音 / 亲切语音 */
  const voiceCtl = useVoice();
  // useVoice 每次渲染都返回新对象，把最新方法存进 ref，供 start/finish 等稳定回调取用
  const voiceCtlRef = useRef(voiceCtl);
  voiceCtlRef.current = voiceCtl;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  /**
   * 摄像头朝向。
   * 默认后置（拍全身、视野宽）；前置留给"想看着屏幕跳"或用支架对着自己的场景。
   * 切换时追踪状态要作废重来 —— 前置画面是镜像的，左右脚会互换，
   * 沿用旧的峰谷会让第一下计数错位。
   */
  const [position, setPosition] = useState<'back' | 'front'>('back');
  /*
   * 两个方向的设备都取出来：
   * 有些设备（尤其平板、部分备用机）没有前置摄像头，
   * 直接 useCameraDevice(position) 会在切过去那一刻返回 undefined ——
   * 画面直接黑掉，用户还以为坏了。先拿到手才好判断能不能切。
   */
  const backDevice = useCameraDevice('back');
  const frontDevice = useCameraDevice('front');
  const device = position === 'front' ? frontDevice : backDevice;
  const { hasPermission, requestPermission } = useCameraPermission();

  const [count, setCount] = useState(0);
  const [detected, setDetected] = useState(false);
  const [phase, setPhase] = useState<Phase>('ready');
  /** 倒计时剩余数字 */
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM);
  /** 已用秒数（只在 running 时累加，暂停不计） */
  const [elapsed, setElapsed] = useState(0);
  /** 结果页上的名称：默认自动生成，用户可以改 */
  const [resultName, setResultName] = useState('');
  /** 结果页最终定格的数据（done 之后 count 不再变，单独存一份更稳） */
  const [result, setResult] = useState<{
    count: number; duration: number;
  } | null>(null);
  /** 节奏柱：每根柱子对应一次落地的间隔（毫秒），给底部波形卡用 */
  const [beats, setBeats] = useState<number[]>([]);
  /** 实时速度（个/分） */
  const [rate, setRate] = useState(0);
  /** rate 的镜像：updatePosture 是稳定引用，读 state 会读到旧值，速度分档靠它 */
  const rateRef = useRef(0);
  /** 节奏稳定度：靠最近 8 跳间隔的变异系数判断，比单看柱高更容易读懂 */
  const [stability, setStability] = useState<'none' | 'steady' | 'mild' | 'wild'>('none');
  /** 本次训练出现过的最高瞬时速度 —— 有它才知道自己冲到了哪儿 */
  const [maxRate, setMaxRate] = useState(0);
  /** 标定数据默认收起：画面上不该摆一堆数字（设计稿明确要求） */
  const [probeOpen, setProbeOpen] = useState(false);
  /**
   * 调试用：标定阈值全靠这几个数，也是排查「识别不到人」的唯一窗口
   *   y / lift / fps —— 脚踝沿身体轴的位置、离地幅度、识别帧率
   *   results        —— MediaPipe 一共回调了多少次（0 说明帧没进到识别层）
   *   pts            —— 最近一次回调里关键点的个数（0 说明收到帧但没检出人）
   *   size           —— MediaPipe 看到的画面尺寸（宽>高 说明画面是横的）
   *   axis           —— 身体轴朝向（横 / 竖）
   */
  const [probe, setProbe] = useState<{
    y: number; lift: number; fps: number; results: number; pts: number;
    size: string; axis: string;
    handUp: number | null; handDiff: number | null; armSpread: number | null;
    facing: number | null; kneeAngle: number | null; headDrop: number | null;
    inward: number | null; legRaise: number | null; world: boolean;
  }>({
    y: 0, lift: 0, fps: 0, results: 0, pts: 0, size: '', axis: '',
    handUp: null, handDiff: null, armSpread: null,
    facing: null, kneeAngle: null, headDrop: null, inward: null, legRaise: null, world: false,
  });
  const [error, setError] = useState<string | null>(null);
  /** 最近的姿态高度曲线，给调试波形用（也是以后节奏波形的原型） */
  const [wave, setWave] = useState<number[]>([]);

  /** 计数相关的状态全部放 ref：onResults 每帧都会调用，走 setState 会卡死 */
  const countRef = useRef(0);
  const frames = useRef(0);
  const fpsWindowStart = useRef(0);
  const fpsRef = useRef(0);
  /** running 的镜像：onResults 是每帧回调，读 state 会读到闭包里的旧值 */
  const runningRef = useRef(false);
  const resultsRef = useRef(0);
  const ptsRef = useRef(0);
  const sizeRef = useRef('');
  const axisRef = useRef('');
  /** 尺子和方向：身长 EMA + 身体轴单位向量，跨帧共用 */
  const shapeRef = useRef<{
    torso: number; gL: number; gR: number; gH: number; aLy: number; aRy: number;
    legMax: number;
  }>({
    torso: 0, gL: 0, gR: 0, gH: 0, aLy: 0, aRy: 0, legMax: 0,
  });
  /**
   * 两套 zigzag 检测器：
   *   one —— 并脚跳（两只脚一起看，信号取较低的脚，要求双足离地）
   *   alt —— 换脚跳（看两脚抬升量之差，左右交替时差值大幅摆动）
   */
  const zigOneRef = useRef<ZigState>(newZig());
  const zigAltRef = useRef<ZigState>(newZig());

  /** 两路信号的平滑值（EMA 0.65 = 2 点平均，峰顶最多削两成） */
  const emaOneRef = useRef(Number.NaN);
  const emaAltRef = useRef(Number.NaN);
  /** 全局去抖：两路几乎同时触发时只算一次 */
  const globalAtRef = useRef(0);

  /** 上一次确认的振幅，只给界面显示用 */
  const ampRef = useRef(0);
  const lastY = useRef(0);
  const lastLift = useRef(0);
  /** 上一次真的认出人的时间，用来判断人是否已经离开画面 */
  const lastHitAt = useRef(0);
  /** jumpStyle 的镜像：handleResults 是稳定引用，不能直接闭包捕获 props */
  const styleRef = useRef<JumpStyle>(jumpStyle);
  /** 已用秒数（ref 版）：定时跳每 200ms 查一次，不能等 state */
  const elapsedRef = useRef(0);
  /** 上一次累计计时的时刻，用来算增量 */
  const lastTickRef = useRef(0);
  /** finish 的镜像：handleResults 里达标要立刻结束，不能依赖闭包里的旧函数 */
  const finishRef = useRef<() => void>(() => {});
  /** 阶段的镜像：finish 里要判断"是不是已经结束了"，state 拿不到最新值 */
  const phaseRef = useRef<Phase>('ready');
  /** mode / target 的镜像：handleResults 是稳定引用 */
  const modeRef = useRef<JumpMode>(mode);
  const targetRef = useRef(target);
  /** 上一次拿到有效帧的时间，断流太久要重开追踪 */
  const lastFrameAt = useRef(0);
  /** 高度曲线的环形缓冲 */
  const waveRef = useRef<number[]>([]);
  /** 髋部横向位置的滑动窗口：用来判断人在走动还是在原地跳 */
  const hxRef = useRef<number[]>([]);
  /**
   * 每次计数的时刻（毫秒），最多留 40 个。
   * 节奏卡要算两件事：相邻间隔 → 每根柱子的高矮；最近几跳的间隔 → 「个/分」。
   */
  const beatsRef = useRef<number[]>([]);
  const maxRateRef = useRef(0);

  /**
   * 动作提示。
   *   · hint    —— 当前显示的内容（'ok' 或某个问题码）
   *   · pst     —— 动作指标的平滑值，每帧更新，不出 state
   *   · cand*   —— 候选问题 + 它从什么时候开始持续出现
   *   · shownAt —— 上一次真正换文案的时刻（控制最小停留时间）
   *   · lastAt  —— 每个问题上一次提醒的时刻（同一个问题 6 秒内只提一次）
   *   · jumpPeak—— 最近 1.2 秒内的最大跳起高度
   */
  const [hint, setHint] = useState<PostureKey | 'ok'>('ok');
  /** hint 的镜像：判定逻辑在稳定引用的回调里跑，读 state 会读到旧值 */
  const hintRef = useRef<PostureKey | 'ok'>('ok');
  const pstRef = useRef<PostureSmooth>(emptyPostureSmooth());
  const hintCandRef = useRef<PostureKey | null>(null);
  const hintCandAtRef = useRef(0);
  const hintShownAtRef = useRef(0);
  const hintLastAtRef = useRef<Partial<Record<PostureKey, number>>>({});
  /** 本次训练每个动作问题出现了几次（onset 计数），结算页要用 */
  const issueCountRef = useRef<Partial<Record<PostureKey, number>>>({});
  const jumpPeakRef = useRef({ v: 0, at: 0 });
  /** 画面横纵比 min(w,h)/max(w,h)：把 x 换算到和 y 同一个尺度，缺了就不做横向判据 */
  const aspectRef = useRef(0);
  /** 这一路有没有 worldLandmarks（有就用真 3D 判动作，调试面板会显示） */
  const worldRef = useRef(false);

  useEffect(() => {
    styleRef.current = jumpStyle;
  }, [jumpStyle]);

  useEffect(() => {
    modeRef.current = mode;
    targetRef.current = target;
  }, [mode, target]);

  useEffect(() => {
    if (!active) return;
    if (!hasPermission) requestPermission();
  }, [active, hasPermission, requestPermission]);

  /**
   * 语音只在相机训练界面生效。
   * 这页是常驻挂载的（靠 active 控制显隐，不卸载），所以不能只靠组件卸载清理。
   * 这里在「离开相机页」这个沿上主动停掉所有语音 —— 无论用户是点左上角关闭、
   * 系统返回手势、还是切到别的页面，只要 active 变 false，残留的播报/嘟声全停。
   */
  useEffect(() => {
    if (!active) voiceCtlRef.current.stopAll();
  }, [active]);

  /**
   * 每次重新进这个页面 = 新的一轮，全部清零。
   * 这个页面在 App 里是常驻挂载的（靠 visible 控制显隐，不卸载），
   * 所以不主动清的话，上一轮跳的数字会一直留在屏幕上。
   */
  useEffect(() => {
    if (!active) return;
    countRef.current = 0;
    setCount(0);
    shapeRef.current = {
      torso: 0, gL: 0, gR: 0, gH: 0, aLy: 0, aRy: 0, legMax: 0,
    };
    zigOneRef.current = newZig();
    zigAltRef.current = newZig();
    emaOneRef.current = Number.NaN;
    emaAltRef.current = Number.NaN;
    globalAtRef.current = 0;
    ampRef.current = 0;
    lastY.current = 0;
    lastLift.current = 0;
    resultsRef.current = 0;
    ptsRef.current = 0;
    sizeRef.current = '';
    axisRef.current = '';
    lastHitAt.current = 0;
    lastFrameAt.current = 0;
    waveRef.current = [];
    hxRef.current = [];
    beatsRef.current = [];
    setBeats([]);
    setRate(0);
    maxRateRef.current = 0;
    setMaxRate(0);
    setWave([]);
    runningRef.current = false;
    phaseRef.current = 'ready';
    setPhase('ready');
    setCountdown(COUNTDOWN_FROM);
    setElapsed(0);
    elapsedRef.current = 0;
    setResult(null);
    setResultName('');
    setDetected(false);
    setError(null);
    // 动作提示也回到"没问题"：新一轮从头开始提醒
    pstRef.current = emptyPostureSmooth();
    hintCandRef.current = null;
    hintCandAtRef.current = 0;
    hintShownAtRef.current = 0;
    hintLastAtRef.current = {};
    issueCountRef.current = {};
    jumpPeakRef.current = { v: 0, at: 0 };
    hintRef.current = 'ok';
    setHint('ok');
  }, [active]);

  /**
   * 平滑强度按帧率自适应。
   *
   * 帧率高（≥12）：用 0.65 的 2 点平均，够压噪声，峰只削两成。
   * 帧率低（<12） ：干脆一点不平滑（1.0）。采样本来就只有 8~10 张/秒，
   *                一次快速跳可能只被拍到 2~3 帧，这时候再平滑等于把峰直接抹平。
   *                噪声只能靠 minAmp 和自适应回撤去挡，不能再牺牲信号。
   */
  const smoothAlpha = useCallback(
    () => (fpsRef.current > 0 && fpsRef.current < 12 ? 1 : 0.65),
    [],
  );

  /** 把所有追踪状态作废重来（走动、断流、暂停时都调它） */
  const resetTrack = useCallback(() => {
    zigOneRef.current = newZig();
    zigAltRef.current = newZig();
    emaOneRef.current = Number.NaN;
    emaAltRef.current = Number.NaN;
  }, []);

  /**
   * 动作提示：判定 + 节流。
   *
   * 三条规矩，都是为了"别烦人"：
   *   1. 同一个问题要连续撑住 420ms 才提示 —— 关键点抖一下就报，人会以为设备坏了；
   *   2. 换过文案后至少停 2.6 秒 —— 跳着的时候根本来不及读完又换一句；
   *   3. 同一个问题 8 秒内只提一次 —— 提了不改是用户的选择，别追着念。
   *
   * 另外它和计数完全解耦：这里算错最多是文案不准，
   * 不会影响数的个数（返回值和计数没有任何共享状态）。
   */
  const updatePosture = useCallback(
    (lm: any[], opts: PostureReadOpts, hipLift: number, now: number) => {
      const s = readPosture(lm, opts);
      if (!s) return;

      /*
       * 逐项平滑。注意是"按项"而不是"整帧"：
       * 手贴在髋侧时手腕常被腿挡住，但膝盖、朝向、脚尖都读得到，
       * 这时候不能因为手读不到就把整帧分析丢掉（上一版就是这么静默的）。
       */
      const st = pstRef.current;
      for (const f of POSTURE_FIELDS) {
        const next = s[f];
        if (next === null) {
          st.miss[f] += 1;
          if (st.miss[f] > PST_MISS_MAX) st.v[f] = null;
          continue;
        }
        st.miss[f] = 0;
        const prev = st.v[f];
        st.v[f] = prev === null ? next : prev + (next - prev) * PST_ALPHA;
      }

      // 跳起高度取最近 1.2 秒的峰值：看的是"这段时间弹得高不高"，
      // 不是"这一帧在哪"，落地的瞬间才是最高点，所以必须取峰值
      const jp = jumpPeakRef.current;
      if (hipLift > jp.v) {
        jp.v = hipLift;
        jp.at = now;
      } else if (now - jp.at > 1200) {
        jp.v *= 0.88;
      }

      const m: PostureSample = { ...st.v, spanX: s.spanX };
      /*
       * 滞回：已经提示着的问题，指标要回落一截才放掉。
       * 不这么做的话，值正好卡在阈值上时会「有问题 / 动作 OK」来回抖。
       * 速度分档 + 跳法：按当下 rate（rateRef）和跳法（styleRef）查两套标准。
       */
      const curRate = rateRef.current;
      const curStyle = styleRef.current;
      const prevIssue = hintCandRef.current;
      const issue = prevIssue && keepIssue(prevIssue, m, curRate, curStyle, jp.v)
        ? prevIssue
        : pickPosture(m, curRate, curStyle, jp.v);

      // 候选换了就重新计时（包括从"有问题"变回"没问题"）
      if (issue !== prevIssue) {
        hintCandRef.current = issue;
        hintCandAtRef.current = now;
        // 统计"这次训练这个问题出现了几次"：从没问题→有问题的每一次onset都算，
        // 不管有没有真的弹出来（8 秒冷却里也算），结算页要用
        if (issue) {
          issueCountRef.current[issue] = (issueCountRef.current[issue] ?? 0) + 1;
        }
        return;
      }
      const held = now - hintCandAtRef.current;

      const show = (next: PostureKey | 'ok') => {
        hintRef.current = next;
        hintShownAtRef.current = now;
        setHint(next);
      };

      if (issue) {
        if (hintRef.current === issue) return;                     // 已经在说这件事
        if (held < 320) return;                                    // 刚出现，再等 0.3 秒确认
        if (now - hintShownAtRef.current < 2200) return;           // 上一句还没停够
        if (now - (hintLastAtRef.current[issue] ?? 0) < 6000) return; // 6 秒内不重复
        hintLastAtRef.current[issue] = now;
        show(issue);
        return;
      }

      // 没毛病：撑住 1.2 秒再切回 OK，否则会在阈值边缘来回闪
      if (hintRef.current !== 'ok' && held > 1200 && now - hintShownAtRef.current > 2200) {
        show('ok');
      }
    },
    [],
  );

  /** 每帧回调：只做算术，不做渲染 */
  const handleResults = useCallback((result: any) => {
    resultsRef.current += 1;

    // ⚠️ 安卓原生回传的真实结构（这个库的 README 是错的，别照它读）：
    //   {
    //     results: [ { landmarks: [[33 个点]], worldLandmarks: [...] } ],
    //     inputImageWidth: 480, inputImageHeight: 640, inferenceTime: 12.3
    //   }
    // 关键点藏在 results[0] 里面，顶层只有尺寸和耗时。
    // 之前按 result.landmarks[0] 读，永远读到空 —— 于是「明明识别到了也显示 0」。
    const pack = result?.results?.[0];
    const lm = pack?.landmarks?.[0];
    /*
     * worldLandmarks = 真实 3D（米，原点在髋中点）。
     * 动作分析优先用它：屈膝、内八、低头这些问题的变化主要在深度方向，
     * 投影坐标里根本看不出来。读点和计数仍然用 lm（投影坐标），两者互不影响。
     */
    const wl = pack?.worldLandmarks?.[0];
    /*
     * 世界坐标的躯干长度（米）。正常成年人 0.3~0.5，
     * 小于 0.08 说明这组世界坐标是坏的（全 0 或没算出来），
     * 这时老老实实退回投影坐标，别拿坏数据去判动作。
     */
    const torso3 = wl && wl.length >= 33
      ? Math.abs((wl[23].y + wl[24].y) / 2 - (wl[11].y + wl[12].y) / 2)
      : 0;
    const use3d = torso3 > 0.08;
    worldRef.current = use3d;
    const imgW = result?.inputImageWidth ?? result?.size?.width ?? 0;
    const imgH = result?.inputImageHeight ?? result?.size?.height ?? 0;
    if (imgW && imgH) {
      sizeRef.current = `${imgW}×${imgH}`;
      /*
       * 横纵比取 min/max（App 锁竖屏，所以结果一定 ≤ 1）。
       * 为什么不直接 imgW/imgH：库回传的是旋转前的传感器尺寸（如 640×480），
       * 而原始帧已经在原生层转正成 480×640 才喂给 MediaPipe，
       * 直接相除会把 0.75 算成 1.33，所有横向判据全部反掉。
       */
      aspectRef.current = Math.min(imgW, imgH) / Math.max(imgW, imgH);
    }
    ptsRef.current = lm?.length ?? 0;

    // 帧率：每满 1 秒结算一次，不要每帧都算。
    // 放在「有没有检出人」之前统计：没人时也要能看出帧在不在流
    const t0 = Date.now();
    frames.current += 1;
    if (fpsWindowStart.current === 0) fpsWindowStart.current = t0;
    const span0 = t0 - fpsWindowStart.current;
    if (span0 >= 1000) {
      fpsRef.current = Math.round((frames.current * 1000) / span0);
      frames.current = 0;
      fpsWindowStart.current = t0;
    }

    if (!lm || lm.length < 33) {
      setDetected(false);
      return;
    }
    setDetected(true);

    const bp = footLift(lm, shapeRef.current);
    // 这一帧关键点不干净：整帧跳过，任何状态都不动（别让脏数据钻进来）
    if (!bp) return;

    // 先把包络/尺子推进去：哪怕这一帧不参与计数，地面参考也得跟着走，
    // 否则遇到连续几帧"不合格"，包络会停在原地，之后全部判错。
    shapeRef.current = {
      torso: bp.torso, gL: bp.gL, gR: bp.gR, gH: bp.gH,
      aLy: bp.aLy, aRy: bp.aRy, legMax: bp.legMax,
    };
    axisRef.current = bp.land ? '竖' : '横';
    lastHitAt.current = Date.now();

    /*
     * 走动检测：跳绳是原地运动，走路/走位一定带明显的横向位移。
     * 光看"脚抬起来"分不开这两件事 —— 走路时每一步脚都抬，
     * 跑步甚至有两脚同时腾空，双足离地判据也挡不住。
     * 所以加一道：最近 20 帧里髋部横移超过画面宽度 12%，就认为人在移动，
     * 这段时间不计数，等站回原地重新开始记。
     */
    hxRef.current.push(bp.hx);
    if (hxRef.current.length > 20) hxRef.current.shift();
    if (hxRef.current.length >= 10) {
      let lo = 1;
      let hi = 0;
      for (const x of hxRef.current) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      if (hi - lo > 0.12) {
        resetTrack();
        return;
      }
    }

    const tune = TUNE[styleRef.current];
    const now = Date.now();

    // 断流太久（人在休息、或者识别卡了几秒）→ 追踪状态作废重来。
    // 不这么做的话，peak/valley 会停在很久以前的极值上，之后怎么跳都判不出落差。
    if (lastFrameAt.current && now - lastFrameAt.current > RESET_MS) {
      resetTrack();
      waveRef.current = [];
    }
    lastFrameAt.current = now;

    // 没点「开始测试」时只认人、不判定
    if (!runningRef.current) {
      resetTrack();
      return;
    }

    /*
     * 动作提示：接在这里，而不是接在计数分支里面。
     * 计数分支有好几个 return（走动了、并脚跳检测到两只脚不同步…），
     * 那些都是"这次不计数"，但人还在跳，动作该怎么提醒还得提醒。
     */
    updatePosture(
      use3d ? wl : lm,
      {
        torso: use3d ? torso3 : bp.torso,
        aspect: use3d ? 1 : aspectRef.current,
        spanX: Math.abs(lm[11].x - lm[12].x),
        use3d,
      },
      bp.hipLift,
      now,
    );

    /*
     * 按跳法取信号，然后分别喂给对应的检测器。
     *
     * 并脚跳：只有一套检测器，信号取「抬得低的那只脚」——
     *   它能起来就说明两只脚都离地了，「双足离地」自然成立。
     *
     * 换脚跳：只有一套检测器，信号取「两只脚抬升量之差」——
     *   左右交替时差值在两个方向大幅摆动，晃镜头时差值恒为 0。
     */
    const bump = () => {
      // 左右脚几乎同时触发（双脚同时落地/双摇）只算一次
      if (now - globalAtRef.current < 60) return;
      globalAtRef.current = now;
      countRef.current += 1;
      setCount(countRef.current);

      // 记下这一跳的时刻：节奏卡的柱高和「个/分」都从这儿算
      beatsRef.current.push(now);
      if (beatsRef.current.length > 40) beatsRef.current.shift();
      // 定数跳：跳够了立刻收尾，不用等用户自己点结束
      if (modeRef.current === 'count' && countRef.current >= targetRef.current) {
        finishRef.current();
      }
    };

    if (styleRef.current === 'together') {
      const mx = Math.max(bp.liftL, bp.liftR);
      // 两只脚抬升差太多 = 不是并脚（多半是换脚或单脚乱动），这一帧不参与。
      // 系数 0.8 而不是 0.6：真人两脚发力很难完全对称，0.6 会把正常并脚当成换脚丢掉。
      // 真换脚跳的差值是 100%，仍稳稳落在门外。
      if (mx > 0.02 && Math.abs(bp.liftL - bp.liftR) > mx * tune.closeRatio) return;

      /*
       * 信号 = 「腿收缩量」和「脚相对髋的上移」两个量的平均。
       *
       * 为什么会数不到轻跳：只用腿收缩量时，轻跳的收腿只有一两厘米，
       * 而腿长是由髋和脚踝两个点算出来的，两点各自的检测误差会叠加进去 ——
       * 信号一半是噪声，一跳就被埋掉了。
       *
       * 两个量看的是同一件事（脚相对身体往上走），但算的路径不同：
       *   腿收缩量  = 髋到脚踝的竖直距离变短了多少
       *   相对上移  = 脚踝的抬升 − 髋部的抬升
       * 它们的噪声几乎不相关，取平均后噪声互相抵消一部分（约降 1.4 倍），
       * 而真信号是同向叠加的，不会被削弱。
       *
       * 再加上 3 帧中位数：关键点偶尔跳到错误位置造成的是"单帧尖峰"，
       * 中位数直接把它过滤掉。3 帧不会削掉峰顶——真跳的峰至少连着 3~4 帧。
       */
      const sig = 0.5 * bp.legLift
        + 0.5 * (Math.min(bp.liftL, bp.liftR) - bp.hipLift * HIP_CANCEL);

      /*
       * 平滑只用「2 点平均」（EMA 0.65），不再用 3 帧中位数。
       *
       * 3 帧中位数降噪很好，但它有个致命代价：快速跳时一个峰只占 1~2 帧，
       * 3 帧里取中间那个，正好把峰顶削掉一半 —— 跳得越快削得越狠。
       * 这就是"两个模式都是越快越漏"的共同原因。
       *
       * 2 点平均只跨一帧，峰顶最多削两成，而噪声照样能压掉三成。
       */
      emaOneRef.current = Number.isFinite(emaOneRef.current)
        ? emaOneRef.current + (sig - emaOneRef.current) * smoothAlpha()
        : sig;
      const smooth = emaOneRef.current;

      lastY.current = smooth;
      waveRef.current.push(smooth);
      if (waveRef.current.length > WAVE_N) waveRef.current.shift();
      if (zigzagStep(zigOneRef.current, smooth, now, tune.minAmp, tune.rev)) {
        bump();
      }
    } else {
      /*
       * 换脚跳的信号 = 「两只脚抬升量之差」d = 左脚 − 右脚。
       *
       * 为什么用差值，而不是"每只脚各跑一套"：
       *   · 真换脚：左脚抬起时 d 是大正数，右脚抬起时 d 是大负数
       *     → d 在两个方向大幅摆动，每个来回正好是一次换脚
       *   · 镜头晃动：两只脚被一起平移，左右抬升量同增同减，d 完全不变
       *     → 天然归零，不需要任何"同步度"闸门
       *
       * 上一版正是败在闸门上：换脚跳落地过渡期，抬脚落回、撑地脚微抬，
       * 两脚高度短暂接近，被误判成"两脚同步"，把追踪清掉 → 漏数。
       * 差值法把"是不是整体平移"这个判断直接做进了信号本身，就不再需要闸门。
       *
       * 也不减髋部：整体平移对差值本来就无效，减了反而会削掉真信号。
       *
       * 取绝对值再喂 zigzag：一次换脚 = |d| 走完一个「升 → 降」的完整周期。
       */
      const d = Math.abs(bp.liftL - bp.liftR);

      /*
       * 平滑改成 3 帧中位数，而不是把 EMA 系数压小。
       *
       * 上一版把 EMA 压到 0.35 降噪，结果峰顶也被削掉三成，轻跳直接掉到门槛下
       * —— 这就是"晃镜头不计数了，但漏了十个"的原因。
       *
       * 中位数只丢"最离谱的那一帧"，不参与平均，所以峰顶基本原样保留；
       * 而关键点跳错造成的正是单帧尖峰，3 帧中位数刚好能杀掉。
       *
       * 剩下的抗噪交给 zigzag 里的「连续 2 帧确认」：单帧毛刺连第二帧都撑不到。
       */
      // 同样改成 2 点平均：快速换脚时一个峰只有 1~2 帧，中位数会把峰削平
      emaAltRef.current = Number.isFinite(emaAltRef.current)
        ? emaAltRef.current + (d - emaAltRef.current) * smoothAlpha()
        : d;
      const smoothAlt = emaAltRef.current;

      lastY.current = smoothAlt;
      waveRef.current.push(smoothAlt);
      if (waveRef.current.length > WAVE_N) waveRef.current.shift();

      if (zigzagStep(zigAltRef.current, smoothAlt, now, tune.minAmp, tune.rev)) {
        bump();
      }
    }

    // 界面上的「上次跳幅」：取最近一次确认的振幅
    const zigMain = styleRef.current === 'together' ? zigOneRef.current : zigAltRef.current;
    ampRef.current = zigMain.lastAmp;
    lastLift.current = Math.max(-0.3, Math.min(zigMain.lastAmp, 0.3));
  }, [smoothAlpha, updatePosture]);

  const handleError = useCallback((e: any) => {
    setError(e?.message ?? '识别出错了');
  }, []);

  const pose = usePoseDetection(
    { onResults: handleResults, onError: handleError },
    RunningMode.LIVE_STREAM,
    MODEL,
    {
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      delegate: Delegate.GPU,
    },
  );

  // 调试数字 300ms 刷一次就够了：每帧刷会让整页一直重渲染，帧率立刻掉下来
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setProbe({
        y: lastY.current,
        lift: lastLift.current,
        fps: fpsRef.current,
        results: resultsRef.current,
        pts: ptsRef.current,
        size: sizeRef.current,
        axis: axisRef.current,
        handUp: pstRef.current.v.handUp,
        handDiff: pstRef.current.v.handDiff,
        armSpread: pstRef.current.v.armSpread,
        facing: pstRef.current.v.facing,
        kneeAngle: pstRef.current.v.kneeAngle,
        headDrop: pstRef.current.v.headDrop,
        inward: pstRef.current.v.inward,
        legRaise: pstRef.current.v.legRaise,
        world: worldRef.current,
      });
      /*
       * 节奏卡：由「相邻两次落地的间隔」驱动。
       *
       * 柱高按间隔算 —— 间隔长（跳得慢）柱子高，间隔短（跳得快）柱子矮，
       * 一排看过去就是节奏的形状：整齐的等高柱 = 节奏稳，忽高忽低 = 乱。
       * 「个/分」取最近 6 跳的平均间隔换算，比"最近 1 秒数了几个"稳得多 ——
       * 后者在落地跨过整秒时会剧烈跳变。
       */
      const ts = beatsRef.current;
      const gaps: number[] = [];
      for (let i = Math.max(1, ts.length - 33); i < ts.length; i += 1) {
        gaps.push(ts[i] - ts[i - 1]);
      }
      setBeats(gaps);

      // 用最近 4 个间隔算速度：6 个太黏，快跳时数字半天不动，看着像"没反应"
      const recent = gaps.slice(-4);
      const lastAt = ts.length ? ts[ts.length - 1] : 0;
      if (recent.length >= 2 && Date.now() - lastAt < 3000) {
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const r = avg > 0 ? Math.round(60000 / avg) : 0;
        setRate(r);
        rateRef.current = r;
        if (r > maxRateRef.current) {
          maxRateRef.current = r;
          setMaxRate(r);
        }
      } else {
        // 停下来超过 3 秒就当没在跳了，别让速度停在最后那个数上
        setRate(0);
        rateRef.current = 0;
      }

      /*
       * 节奏稳不稳：最近 8 跳间隔的变异系数（标准差 ÷ 平均）。
       * 只看柱子高低其实很难判断「这是稳还是乱」—— 柱子本来就该有高有低。
       * 给一个明确结论（稳 / 略起伏 / 忽快忽慢）比让人自己数柱子可靠。
       */
      const last8 = gaps.slice(-8);
      if (last8.length >= 4 && Date.now() - lastAt < 3000) {
        const mean = last8.reduce((a, b) => a + b, 0) / last8.length;
        const sd = Math.sqrt(
          last8.reduce((acc, g) => acc + (g - mean) ** 2, 0) / last8.length,
        );
        const cv = mean > 0 ? sd / mean : 0;
        setStability(cv < 0.12 ? 'steady' : cv < 0.25 ? 'mild' : 'wild');
      } else {
        setStability('none');
      }

      // 人走出画面后原生就不再回调了（它只在认到人时才发），
      // 所以这里靠超时把角标清掉，否则会一直谎报「已识别到人体」
      if (lastHitAt.current && Date.now() - lastHitAt.current > LOST_MS) {
        setDetected(false);
      }
    }, 300);
    return () => clearInterval(t);
  }, [active]);

  // 波形只在标定面板打开时同步 —— 收起状态下每 300ms 刷一次纯属浪费
  useEffect(() => {
    if (!active || !probeOpen) return;
    const t = setInterval(() => setWave(waveRef.current.slice()), 300);
    return () => clearInterval(t);
  }, [active, probeOpen]);

  /** 换阶段：所有 setPhase 都走它，保证 phaseRef 和 state 不会走散 */
  const goto = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** 开始一次训练：清零 → 3-2-1 → 计数 */
  const start = useCallback(() => {
    // 相机没就绪就别进倒计时，否则数到 0 也没人在看
    if (!device || !hasPermission) return;
    resetTrack();
    countRef.current = 0;
    setCount(0);
    elapsedRef.current = 0;
    setElapsed(0);
    setResult(null);
    setResultName('');
    beatsRef.current = [];
    setBeats([]);
    setRate(0);
    maxRateRef.current = 0;
    setMaxRate(0);
    setCountdown(COUNTDOWN_FROM);
    // 「再跳一次」也要把动作问题统计清零，否则两次的账会混在一起
    issueCountRef.current = {};
    hintCandRef.current = null;
    hintCandAtRef.current = 0;
    hintShownAtRef.current = 0;
    hintLastAtRef.current = {};
    pstRef.current = emptyPostureSmooth();
    jumpPeakRef.current = { v: 0, at: 0 };
    hintRef.current = 'ok';
    setHint('ok');
    goto('countdown');
    // 开始播报：比赛语音（MP3）/ 亲切语音（3-2-1）。定数跳没有时长，
    // 开头口令照样播；定时跳的目标秒数决定匹配哪段 MP3。
    voiceCtlRef.current.startCountdown(voiceRef.current, target);
  }, [device, hasPermission, resetTrack, goto, target]);

  /**
   * 倒计时推进：每个数字停多久，走完自动开跳。
   *
   * 比赛语音模式下，开头口令是"裁判员准备→运动员准备→预备→嘀"（约 7 秒），
   * 比亲切语音的"3-2-1"（约 2.4 秒）长得多。所以：
   *   · 亲切：每格 800ms（3 格 ≈ 2.4 秒）
   *   · 比赛：每格 2333ms（3 格 ≈ 7 秒），让视觉倒计时走完、口令和"嘀"声
   *     完整播完在同一个时刻 —— 计时正式开始。
   */
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      runningRef.current = true;
      lastTickRef.current = Date.now();
      goto('running');
      return;
    }
    const step = voiceRef.current === 'race' ? 2333 : COUNTDOWN_STEP_MS;
    const t = setTimeout(() => setCountdown((n) => n - 1), step);
    return () => clearTimeout(t);
  }, [phase, countdown, goto]);

  /** 计时：running 时每 200ms 累加；定时跳到点自动结束 */
  useEffect(() => {
    if (phase !== 'running') return;
    lastTickRef.current = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      /*
       * 单次增量封顶。
       *
       * 切到后台、锁屏、或者系统把 JS 线程挂起时，setInterval 会被冻住，
       * 回来那一跳算出来的 delta 可能是几十秒甚至几分钟 ——
       * 定时跳会直接跳到结束，用户还以为自己练完了。
       *
       * 正常情况下 200ms 一跳，偶尔卡一下也就三四百毫秒。
       * 超过 1 秒的一律按 200ms 认，宁可少算这几秒，也不能凭空吞掉一整段。
       * （真正的后台暂停交给下面的 AppState 监听，那条才是主逻辑。）
       */
      const delta = Math.min((now - lastTickRef.current) / 1000, 0.2);
      elapsedRef.current += delta;
      lastTickRef.current = now;
      setElapsed(elapsedRef.current);
      if (mode === 'timer' && elapsedRef.current >= target) {
        finishRef.current();
      }
    }, 200);
    return () => clearInterval(t);
  }, [phase, mode, target]);

  /**
   * 切到后台自动暂停。
   *
   * 为什么必须暂停：计数靠相机取帧，App 一进后台相机就被系统收走，
   * 没人取帧 = 一个数都不会记，但计时还在走 —— 定时跳会「凭空少掉一大段」，
   * 定数跳会顶着一个不动的数字干等。这比直接暂停难受得多。
   *
   * 回来不自动继续：用户可能刚接过电话、人已经不在画面里了，
   * 自动开始只会录进一堆废数据。屏幕上会显示「已暂停」，点一下继续即可。
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      // 只在真正在跳的时候暂停；倒计时阶段切走也不用管，回来会重新数
      if (phaseRef.current === 'running') {
        runningRef.current = false;
        phaseRef.current = 'paused';
        setPhase('paused');
      }
    });
    return () => sub.remove();
  }, []);

  /** 结束：定格数据、停掉计数、进结果页 */
  const finish = useCallback(() => {
    if (phaseRef.current === 'done' || phaseRef.current === 'ready') return;
    runningRef.current = false;
    const c = countRef.current;
    const dur = Math.max(1, Math.round(elapsedRef.current));
    setResult({ count: c, duration: dur });
    // 名称先按默认规则生成（26.11.26.定数跳500个），用户在结果页可以改
    setResultName(defaultWorkoutName({
      at: Date.now(), mode, count: c, target,
    }));
    goto('done');

    // 结束喊"停"：比赛模式 seek 到 MP3 的"停"，亲切模式 TTS 播"停"
    voiceCtlRef.current.sayStop(voiceRef.current, target);
  }, [mode, jumpStyle, target, goto]);

  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  /** 暂停 / 继续：暂停期间不计时不计数 */
  const togglePause = useCallback(() => {
    if (phaseRef.current === 'running') {
      runningRef.current = false;
      goto('paused');
    } else if (phaseRef.current === 'paused') {
      resetTrack();
      runningRef.current = true;
      goto('running');
    }
  }, [resetTrack, goto]);

  /** 结果页保存：把成绩交给 App 落库 */
  const save = useCallback(() => {
    if (!result) return;
    const w = createWorkout({
      mode,
      jumpStyle,
      count: result.count,
      duration: result.duration,
      target,
      scheduleId,
      // 本次动作问题的次数一起存下来：结算页当场用，成绩详情以后也能看
      posture: { ...issueCountRef.current },
    });
    onDone?.({ ...w, name: resultName.trim() || w.name });
  }, [result, mode, jumpStyle, target, scheduleId, resultName, onDone]);

  // 告诉识别层当前用的是哪颗摄像头（决定画面要不要镜像）
  useEffect(() => {
    if (device) pose.cameraDeviceChangeHandler(device);
  }, [device, pose.cameraDeviceChangeHandler]);

  /** 切换前后摄像头：画面镜像关系变了，旧的峰谷得作废，否则第一下会错位 */
  const flipCamera = useCallback(() => {
    setPosition((v) => (v === 'back' ? 'front' : 'back'));
    resetTrack();
    beatsRef.current = [];
    setBeats([]);
    setRate(0);
  }, [resetTrack]);

  /* ---- 顶部那两块的显示内容 ---- */

  /** 左上角时间：定时跳显示还剩多少，定数跳显示已经用掉多少 */
  const remain = Math.max(0, Math.ceil(target - elapsed));
  const timeLabel = mode === 'timer' ? formatDuration(remain) : formatDuration(elapsed);
  /** 最后 5 秒变红 —— 这时候人一般在硬撑，需要一个明确的"要到点了" */
  const urgent = mode === 'timer' && phase === 'running' && remain <= 5;

  const statusOk = detected && phase === 'running';
  const statusWarn = !notReady && !detected;

  const statusText = notReady
    ? (hasPermission ? '相机启动中' : '需要相机权限')
    : !detected
      ? (phase === 'running' ? '看不到你了 · 站回框里' : '请让人完整入镜')
      : phase === 'countdown'
        ? '准备开始 · 站进虚线框'
        : phase === 'paused'
          ? '已暂停'
          : phase === 'done'
            ? '训练完成'
            : phase === 'running'
              ? `AI 计数中 · ${jumpStyleLabel(jumpStyle)}`
              : `点下面「开始训练」`;

  const dotColor = statusOk
    ? '#79D3A6'
    : statusWarn ? '#FFB86B' : 'rgba(255,255,255,0.55)';

  const statusColor = statusOk
    ? 'rgba(255,255,255,0.92)'
    : statusWarn ? '#FFC46B' : 'rgba(255,255,255,0.72)';

  /**
   * 速度分档上色。
   * 跳绳的常见区间：每分钟 130~200 个。所以分档卡在这里：
   *   200 以上 = 冲刺（橙）  170~199 = 快（奶绿）
   *   130~169 = 正常（白）   130 以下 = 慢 / 在恢复（半透明白）
   * 光看数字变化不快，颜色一变立刻能感觉到"我在冲了"。
   */
  const rateColor = rate >= 200
    ? '#FFB86B'
    : rate >= 170
      ? '#79D3A6'
      : rate >= 130
        ? C.white
        : 'rgba(255,255,255,0.68)';

  const stabilityText = stability === 'steady'
    ? '节奏稳'
    : stability === 'mild' ? '略有起伏' : stability === 'wild' ? '忽快忽慢' : '';

  const stabilityColor = stability === 'steady'
    ? '#79D3A6'
    : stability === 'wild' ? '#FFB86B' : 'rgba(255,255,255,0.72)';

  /** 平均速度：个数 ÷ 用时（分钟），结果页和成绩口径一致 */
  const avgRate = result && result.duration > 0
    ? Math.round(result.count / (result.duration / 60))
    : 0;

  /** 左上角关闭：中途退出，不保存成绩 */
  const stop = () => {
    runningRef.current = false;
    voiceCtlRef.current.stopAll();
    onExit();
  };

  const notReady = !device || !hasPermission;

  /**
   * 顶部留白：只留出状态栏那一条，比之前贴着顶。
   * iOS 上 insetTop 传的是 0（全屏外层没补安全区），这里兜一个 42，
   * 免得关闭按钮钻进刘海/灵动岛里点不到。
   */
  const topPad = Math.max(insetTop, 42);

  /*
   * 取景虚线框：上下留白必须一样宽，而且不能跟别的元素贴得太近 ——
   * 所以不用百分比（21% / 29% 这种屏幕一高一矮就失真：
   * 360×800 的机子上框顶离数据卡只剩 11px、离节奏卡却有 34px，
   * 看着就是「上面贴死、下面空一截」）。
   *
   * 现在改成：把上下两块真实量出来的位置记下来，
   * 框顶 = 数据卡底 + 留白，框底 = 底部内容顶 - 留白。
   * 任何机型、任何状态下都是两段等宽的留白。
   */
  const FRAME_GAP = 34;
  const [rootH, setRootH] = useState(0);
  /** 顶部数据卡的底边（相对屏幕顶部） */
  const [topBlockBottom, setTopBlockBottom] = useState(0);
  /** 底部内容区（节奏卡 / 按钮行）的顶边 */
  const [bottomBlockTop, setBottomBlockTop] = useState(0);

  /**
   * 量之前先用估算值兜一下，避免第一帧框跳到别处。
   * 116 = 状态胶囊 32 + 间距 18 + 数据卡 66
   * 262 = 提示行 36 + 12 + 节奏卡 ~126 + 12 + 按钮 50 + 底边距 26
   */
  const frameTop = (topBlockBottom || topPad + 116) + FRAME_GAP;
  const frameBottomEdge = (bottomBlockTop || rootH - 262) - FRAME_GAP;
  const frameHeight = Math.max(140, frameBottomEdge - frameTop);

  return (
    <View
      style={styles.root}
      onLayout={(e) => setRootH(e.nativeEvent.layout.height)}
    >
      {!notReady && active && (
        <Camera
          // 换摄像头时强制重建：MediaPipe 的取景尺寸回调靠 onLayout 触发，
          // 只换 device 不重建，识别可能还按旧尺寸算，第一下计数会错位
          key={position}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={active}
          frameProcessor={pose.frameProcessor}
          onLayout={pose.cameraViewLayoutChangeHandler}
          // 方向回调必须接上：MediaPipe 靠它决定把画面转多少度再识别，
          // 不接就会一直按「竖屏 0 度」处理，人横在画面里 = 认不出来
          onOutputOrientationChanged={pose.cameraOrientationChangedHandler}
          // 关键：MediaPipe 安卓端只认 RGBA_8888 的图像。
          // 默认帧是 YUV_420_888，直接喂过去会抛
          // "Android media image must use RGBA_8888 config"。
          // 设为 rgb 后 CameraX 会输出 RGBA_8888，正好对上 MediaPipe 的要求。
          pixelFormat="rgb"
          // 这一版只要预览 + 帧数据，不拍照不录像
          photo={false}
          video={false}
        />
      )}

      {/*
        取景提示：只是告诉人站哪儿，不是动作分析框。
        上下位置由顶部数据卡和底部节奏卡实际量出来的位置算，两边留白等宽。
      */}
      <View
        style={[styles.frame, { top: frameTop, height: frameHeight }]}
        pointerEvents="none"
      />

      {/*
        开始前的框内提示：框上移过一点，怕人以为必须严格站进去。
        所以写清楚"大概在框里、人露在画面里就行"，语气上先解压。
        只在 ready 阶段出现 —— 倒计时开始后中间要留给 3-2-1。
      */}
      {phase === 'ready' && !notReady && (
        <View style={[styles.frameHint, { top: frameTop + 22 }]} pointerEvents="none">
          <View style={styles.frameHintRow}>
            <Ionicons name="scan-outline" size={15} color="rgba(255,255,255,0.92)" />
            <Text style={styles.frameHintText}>站进框里 · 全身露出来</Text>
          </View>
          <Text style={styles.frameHintSub}>远一点近一点都行，人在画面里就能数</Text>
        </View>
      )}

      {/*
        关闭按钮：单独拎出来贴着左上角，不和下面那排数据挤在一条线上。
        它的位置只受安全区影响，时间/个数怎么排都不会把它挤走。
      */}
      <TouchableOpacity
        style={[styles.closeBtn, { top: topPad + 2 }]}
        activeOpacity={0.8}
        onPress={stop}
      >
        <Ionicons name="close" size={20} color={C.white} />
      </TouchableOpacity>

      {/*
        顶部信息区，从上到下两块：
          1. AI 状态胶囊 —— 屏幕正上方居中，一眼就知道识别有没有在工作
          2. 时间 + 个数 —— 两块同样大小的圆角矩形，成对居中
        跳的时候人就在画面中间，所以这两块都压在很上面，不挡身体。
      */}
      <View
        style={[styles.topWrap, { top: topPad }]}
        onLayout={(e) => {
          const { y, height } = e.nativeEvent.layout;
          setTopBlockBottom(y + height);
        }}
      >
        {/*
          AI 状态：做成居中的灰色胶囊。
          文字颜色按状态变（正常白、异常橙），底色统一灰 ——
          底色固定，只有字在变色，扫一眼就知道"是正常还是出问题了"。
          长按这一行可以调出标定数据（调阈值时用，平时不出现）。
        */}
        <TouchableOpacity
          style={styles.statusPill}
          activeOpacity={1}
          onLongPress={() => setProbeOpen((v) => !v)}
          delayLongPress={400}
        >
          <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
            {statusText}
          </Text>
        </TouchableOpacity>

        {/*
          时间和个数并排放，字号、框的大小完全一致 ——
          跳的时候余光扫过去，两个数字一样重、一样大，不用分辨谁是谁。
          整对居中摆放，不贴着屏幕左右两条边。
        */}
        <View style={styles.statRow}>
          <View style={styles.statChip}>
            <View style={styles.statChipInner}>
              <Text
                style={[styles.statValue, urgent && styles.timeTextUrgent]}
                numberOfLines={1}
              >
                {timeLabel}
              </Text>
            </View>
          </View>

          <View style={styles.statChip}>
            <View style={styles.statChipInner}>
              <Text style={styles.statValue} numberOfLines={1}>{count}</Text>
              {mode === 'count' && (
                <Text style={styles.statSub} numberOfLines={1}>/{target}</Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* 中央只留 3-2-1 倒计时：计数过程中这里什么都不放，别挡人 */}
      {phase === 'countdown' && (
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.countdownNum}>{countdown > 0 ? countdown : 'GO'}</Text>
          <Text style={styles.unit}>准备好，站进框里</Text>
        </View>
      )}

      <View
        style={styles.bottom}
        onLayout={(e) => {
          const { y, height } = e.nativeEvent.layout;
          // 只在节奏卡在的时候取值：那时这块的顶边就是卡片顶边。
          // 准备阶段这块只有一排按钮，顶边会掉到很下面，
          // 记下来会让虚线框一跳一跳地撑高。
          if (height > 120) setBottomBlockTop(y);
        }}
      >
        {/*
          动作提示：贴在节奏卡正上方，是"边跳边看"的第二块信息。
          排版上单占一行、自己居中 —— 不和节奏卡抢宽度，
          也不像顶部 AI 胶囊那样常驻，只在有问题/正常之间换文案。

          平时是绿色「动作 OK」，出问题换成琥珀色 + 图标。
          只显示**一条**：同时念三条等于没念，跳着的人只来得及改一件事。
        */}
        {(phase === 'running' || phase === 'paused') && (
          <View style={styles.hintRow} pointerEvents="none">
            <View style={[styles.hintPill, hint === 'ok' ? styles.hintOk : styles.hintWarn]}>
              <Ionicons
                name={hint === 'ok' ? 'checkmark-circle' : 'alert-circle'}
                size={15}
                color={hint === 'ok' ? '#8FE3BE' : '#FFC46B'}
              />
              <Text
                style={[styles.hintText, { color: hint === 'ok' ? '#8FE3BE' : '#FFC46B' }]}
                numberOfLines={1}
              >
                {hint === 'ok' ? POSTURE_OK : POSTURE_TEXT[hint]}
              </Text>
            </View>
          </View>
        )}

        {/*
          节奏卡：跳的时候唯一能"边跳边看"的东西。
          柱子高矮 = 相邻两次落地的间隔（跳得慢柱子高、跳得快柱子矮），
          一排看过去节奏稳不稳一目了然；右边是最近 6 跳换算的「个/分」。
        */}
        {phase === 'running' || phase === 'paused' ? (
          <View style={styles.rhythmCard}>
            <View style={styles.rhythmHead}>
              <View style={styles.rhythmTitleRow}>
                <Text style={styles.rhythmTitle}>跳绳节奏</Text>
                {stability !== 'none' && (
                  <Text style={[styles.stability, { color: stabilityColor }]}>
                    {stabilityText}
                  </Text>
                )}
              </View>

              <View style={styles.rhythmRateWrap}>
                <View style={styles.rhythmRateRow}>
                  <Text style={[styles.rhythmRate, { color: rateColor }]}>{rate}</Text>
                  <Text style={styles.rhythmRateUnit}>个/分</Text>
                </View>
                {maxRate > 0 && (
                  <Text style={styles.rhythmMax}>最快 {maxRate}</Text>
                )}
              </View>
            </View>

            <View style={styles.bars}>
              {Array.from({ length: BAR_N }).map((_, i) => {
                const idx = beats.length - BAR_N + i;
                const gap = idx >= 0 ? beats[idx] : null;
                const isLast = i === BAR_N - 1;
                return (
                  <View
                    key={i}
                    style={[
                      styles.bar,
                      { height: gap === null ? 6 : barHeight(gap) },
                      gap === null && styles.barEmpty,
                      // 最新一根纯白当"指针"，最近几根奶绿，越旧越淡
                      gap !== null && isLast && styles.barNow,
                      gap !== null && !isLast && i >= BAR_N - 4 && styles.barHot,
                    ]}
                  />
                );
              })}
            </View>
          </View>
        ) : null}

        {/* 标定区：长按顶部状态条才会出现，调阈值时用 */}
        {probeOpen && (
        <View style={styles.probeBox}>
          <Text style={styles.probeTitle}>动作曲线（站着不动时应该是一条平线）</Text>
          <View style={styles.waveBox}>
            <Svg width="100%" height={54} viewBox="0 0 320 54" preserveAspectRatio="none">
              <Polyline
                points={wavePoints(wave)}
                fill="none"
                stroke="#79D3A6"
                strokeWidth={1.6}
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <Text style={styles.probeTitle}>标定数据</Text>
          <Text style={styles.probeText}>抬脚量 {probe.y.toFixed(2)} 倍躯干（{probe.axis || '—'}）</Text>
          <Text style={styles.probeText}>
            上次跳幅 {(probe.lift * 100).toFixed(1)}%（需 ≥ {(TUNE[jumpStyle].minAmp * 100).toFixed(1)}%）
          </Text>
          <Text style={styles.probeText}>识别帧率 {probe.fps} fps</Text>
          {/* 动作提示的原始指标：阈值全靠这几个数调，别删 */}
          <Text style={styles.probeText}>
            手高 {fix(probe.handUp)} · 两手差 {fix(probe.handDiff)} · 张开 {fix(probe.armSpread)}
          </Text>
          <Text style={styles.probeText}>
            朝向 {fix(probe.facing, 0)}° · 膝角 {fix(probe.kneeAngle, 0)}° · 低头 {fix(probe.headDrop)}
          </Text>
          <Text style={styles.probeText}>内八 {fix(probe.inward)}</Text>
          {/* 换脚跳专属：抬腿幅度（度），只在换脚跳时有意义 */}
          {jumpStyle === 'alternate' && (
            <Text style={styles.probeText}>
              抬腿幅度 {fix(probe.legRaise, 0)}° · 当前速度 {rate} 个/分
            </Text>
          )}
          <Text style={styles.probeText}>回调 {probe.results} 次 · 关键点 {probe.pts} 个</Text>
          <Text style={styles.probeText}>
            输入画面 {probe.size || '—'} · {probe.axis === '竖' ? '已转正' : '未转正'} · 动作分析 {probe.world ? '3D' : '投影'}
          </Text>
          {probe.fps > 0 && probe.fps < LOW_FPS && (
            <Text style={styles.probeWarn}>
              帧率只有 {probe.fps}，太慢会漏数：把手机拿远一点、光线亮一点
            </Text>
          )}
          {error ? <Text style={styles.probeErr}>{error}</Text> : null}
        </View>
        )}

        {!hasPermission && (
          <TouchableOpacity style={styles.permBtn} activeOpacity={0.85} onPress={requestPermission}>
            <Text style={styles.permText}>允许使用相机</Text>
          </TouchableOpacity>
        )}

        <View style={styles.btnRow}>
          {/* 前后摄像头切换：低频操作，放在底部最左边，不和主按钮抢 */}
          <TouchableOpacity
            style={[styles.flipBtn, !frontDevice && styles.flipBtnOff]}
            activeOpacity={0.8}
            disabled={!frontDevice}
            onPress={flipCamera}
          >
            <Ionicons name="camera-reverse-outline" size={19} color={C.white} />
          </TouchableOpacity>

          {phase === 'ready' || phase === 'countdown' ? (
            <TouchableOpacity
              style={[styles.startBtn, phase === 'countdown' && styles.startBtnDim]}
              activeOpacity={0.85}
              disabled={phase === 'countdown'}
              onPress={start}
            >
              <Text style={styles.startText}>
                {phase === 'countdown' ? '准备…' : '开始训练'}
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.startBtn, styles.pauseBtn]}
                activeOpacity={0.85}
                onPress={togglePause}
              >
                <Text style={styles.startText}>{phase === 'paused' ? '继续' : '暂停'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stopBtn} activeOpacity={0.85} onPress={finish}>
                <Text style={styles.stopText}>结束</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/*
        结果页：盖在相机上面，一屏说清「这次练了多少」。
        用 position:absolute 四个方向都拉满，确保整块盖住全屏 ——
        之前它排在相机层下面、又没有明确撑高，结果只在屏幕上边露出一截。
        先定住数据再显示：相机还在底下跑，count 还会继续涨，
        不冻结的话用户盯着看数字会一直往上跳。
      */}
      {phase === 'done' && result && (
        <View style={styles.resultRoot}>
          <ScrollView
            contentContainerStyle={styles.resultScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.resultTitle}>训练完成</Text>

            <View style={styles.resultCountRow}>
              <Text style={styles.resultCount}>{result.count}</Text>
              <Text style={styles.resultUnit}>次</Text>
            </View>

            <View style={styles.resultStats}>
              <View style={styles.resultStat}>
                <Text style={styles.resultStatValue}>{formatDuration(result.duration)}</Text>
                <Text style={styles.resultStatLabel}>用时</Text>
              </View>
              <View style={styles.resultDivider} />
              <View style={styles.resultStat}>
                <Text style={styles.resultStatValue}>{avgRate}</Text>
                <Text style={styles.resultStatLabel}>个/分</Text>
              </View>
              <View style={styles.resultDivider} />
              <View style={styles.resultStat}>
                <Text style={styles.resultStatValue}>{jumpStyleLabel(jumpStyle)}</Text>
                <Text style={styles.resultStatLabel}>跳法</Text>
              </View>
              <View style={styles.resultDivider} />
              <View style={styles.resultStat}>
                <Text style={styles.resultStatValue}>{MODE_WORD[mode]}</Text>
                <Text style={styles.resultStatLabel}>项目</Text>
              </View>
            </View>

            <Text style={styles.resultLabel}>训练名称</Text>
            <TextInput
              style={styles.resultInput}
              value={resultName}
              onChangeText={(v) => setResultName(v.slice(0, 40))}
              placeholder="给这次训练起个名字"
              placeholderTextColor={C.gray}
              maxLength={40}
            />

            {/* AI 评分位：这一版先占住，以后加评分不用重排整页 */}
            <View style={styles.scoreSlot}>
              <Ionicons name="sparkles" size={13} color={C.ai} />
              <Text style={styles.scoreSlotText}>AI 动作分析 · 评分待开启</Text>
            </View>

            <View style={styles.resultBtns}>
              <TouchableOpacity style={styles.againBtn} activeOpacity={0.85} onPress={start}>
                <Text style={styles.againText}>再跳一次</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} activeOpacity={0.85} onPress={save}>
                <Text style={styles.saveText}>保存成绩</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  frame: {
    position: 'absolute', left: 28, right: 28,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    borderStyle: 'dashed', borderRadius: 18,
  },

  /** 关闭按钮：贴左上角，实底主色蓝 —— 和底部「开始训练」同一个色、同一种实底风格 */
  closeBtn: {
    position: 'absolute', left: 14,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  /* 顶部整块：状态胶囊 + 数据行，纵向排，整体居中 */
  topWrap: {
    position: 'absolute', left: 14, right: 14, gap: 18,
    alignItems: 'center',
  },

  /* AI 状态胶囊：灰色底、居中、字号放大。高度定死 32，取景框才算得准 */
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 32, paddingHorizontal: 13, borderRadius: 99,
    backgroundColor: 'rgba(120,128,140,0.55)',
    maxWidth: '70%',
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },

  /*
    时间 / 个数：两块一样宽的圆角矩形，左右分列、中间留出大片空档。
    参考了专业跳绳 App 的排法 —— 框做得宽一点、字撑满框，
    余光扫一眼就能读到，不用凑近看。字号、高度、圆角完全一致。
  */
  statRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 46, alignSelf: 'stretch',
  },
  statChip: {
    flex: 1, height: 66, borderRadius: 20,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  /** 里面这层横排 + 基线对齐：大数字和 /目标 的底边能对齐 */
  statChipInner: { flexDirection: 'row', alignItems: 'baseline' },
  statValue: {
    fontSize: 34, fontWeight: '700', color: C.white,
    fontVariant: ['tabular-nums'], letterSpacing: 0.5, lineHeight: 40,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  statSub: {
    fontSize: 13, color: 'rgba(255,255,255,0.7)', marginLeft: 3,
    fontVariant: ['tabular-nums'],
  },
  timeTextUrgent: { color: '#FF7B72' },

  center: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  unit: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 6 },

  /* 框内提示：贴着框的顶边往下 22px，不压人的身体中段 */
  frameHint: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', gap: 6,
  },
  frameHintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 15, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  frameHintText: { fontSize: 14, fontWeight: '600', color: C.white },
  frameHintSub: {
    fontSize: 11.5, color: 'rgba(255,255,255,0.72)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  bottom: { position: 'absolute', left: 16, right: 16, bottom: 26, gap: 12 },
  /* 动作提示：单占一行、自己居中，宽度跟着文案走 */
  hintRow: { alignItems: 'center' },
  /**
   * 提示胶囊固定宽度。
   * 文案长短不一样（"动作 OK · 保持这个节奏" 比 "手抬太高 · 收到髋部" 长两字），
   * 让宽度跟着文字走的话，每换一句它就左右缩一下 —— 跳着的时候余光会晃。
   * 定死 232、内容居中，宽度不动，只有字和颜色在变。
   */
  hintPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    width: 232, height: 36, paddingHorizontal: 12, borderRadius: 18,
    borderWidth: 1,
  },
  /** 正常：冷绿，几乎不抢戏，但一直"在" */
  hintOk: {
    backgroundColor: 'rgba(12,22,18,0.6)',
    borderColor: 'rgba(121,211,166,0.42)',
  },
  /** 有问题：琥珀，比绿色亮一档，余光能感觉到 */
  hintWarn: {
    backgroundColor: 'rgba(32,21,8,0.62)',
    borderColor: 'rgba(255,184,107,0.5)',
  },
  hintText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },

  /* 节奏卡：半透明深底，压在相机画面上仍能读清 */
  rhythmCard: {
    backgroundColor: 'rgba(12,18,28,0.42)',
    borderRadius: 16,
    // 顶部多留 3px：标题和「个/分」整体往下压一点，别顶着虚线框
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 11,
  },
  rhythmHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  rhythmTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rhythmTitle: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.88)' },
  stability: { fontSize: 12.5, fontWeight: '700' },
  rhythmRateWrap: { alignItems: 'flex-end' },
  rhythmRateRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  rhythmMax: {
    fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: -1,
    fontVariant: ['tabular-nums'],
  },
  rhythmRate: {
    fontSize: 28, fontWeight: '800', color: C.white,
    fontVariant: ['tabular-nums'], lineHeight: 31,
  },
  rhythmRateUnit: { fontSize: 12, color: 'rgba(255,255,255,0.72)' },
  bars: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
    height: 46, marginTop: 10,
  },
  bar: {
    flex: 1, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  barEmpty: { backgroundColor: 'rgba(255,255,255,0.1)' },
  /** 最近几根用奶绿点亮 */
  barHot: { backgroundColor: '#79D3A6' },
  /** 最新一根纯白加亮：像一根指针，标出"刚刚这一下" */
  barNow: { backgroundColor: C.white },

  probeBox: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 3,
  },
  probeTitle: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 2 },
  probeText: { fontSize: 11, color: C.white, fontVariant: ['tabular-nums'] },
  probeErr: { fontSize: 11, color: '#FF8A80', marginTop: 4 },
  probeWarn: { fontSize: 11, color: '#FFC46B', marginTop: 4 },
  waveBox: { height: 54, marginTop: 2, marginBottom: 4 },

  permBtn: {
    height: 46, borderRadius: 23, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  permText: { fontSize: 14, color: C.white, fontWeight: '600' },

  btnRow: { flexDirection: 'row', gap: 10 },
  startBtn: {
    flex: 1, height: 50, borderRadius: 25, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  pauseBtn: { backgroundColor: 'rgba(255,255,255,0.24)' },
  flipBtn: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  /** 没有前置摄像头：按钮留着但明显点不动 */
  flipBtnOff: { opacity: 0.35 },
  startText: { fontSize: 15, color: C.white, fontWeight: '600' },

  stopBtn: {
    width: 108, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  stopText: { fontSize: 15, color: C.white, fontWeight: '600' },
  startBtnDim: { backgroundColor: 'rgba(255,255,255,0.2)' },

  countdownNum: {
    fontSize: 132, fontWeight: '700', color: C.white,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 16,
  },

  resultRoot: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: C.bg,
  },
  /** 滚动容器：内容纵向居中，短内容铺满一屏，超长时可滚不溢出 */
  resultScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 12,
  },
  resultTitle: { fontSize: 13, color: C.sub, textAlign: 'center' },
  resultCountRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 6,
  },
  resultCount: {
    fontSize: 78, fontWeight: '700', color: C.text,
    fontVariant: ['tabular-nums'],
  },
  resultUnit: { fontSize: 14, color: C.gray, marginBottom: 14 },
  resultStats: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 16,
    backgroundColor: C.cardSoft,
  },
  resultStat: { alignItems: 'center', gap: 4, minWidth: 52, paddingHorizontal: 2 },
  resultStatValue: { fontSize: 14, color: C.text, fontWeight: '600' },
  resultStatLabel: { fontSize: 10, color: C.gray },
  resultDivider: { width: 1, height: 26, backgroundColor: '#DFE6F5' },
  resultLabel: { fontSize: 11, color: C.sub, marginTop: 4 },
  resultInput: {
    height: 44, borderRadius: 12, paddingHorizontal: 14,
    backgroundColor: C.soft,
    color: C.text, fontSize: 13,
  },
  scoreSlot: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12,
    backgroundColor: C.aiSoft,
    borderWidth: 1, borderColor: 'rgba(139,124,240,0.22)',
  },
  scoreSlotText: { fontSize: 11, color: C.aiText },
  resultBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  againBtn: {
    flex: 1, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.soft,
  },
  againText: { fontSize: 14, color: C.text, fontWeight: '600' },
  saveBtn: {
    flex: 1.4, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary,
  },
  saveText: { fontSize: 14, color: C.white, fontWeight: '600' },
});

export default memo(CountScreen);
