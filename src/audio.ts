/**
 * 训练播报 —— 比赛语音（MP3）/ 亲切语音（TTS）两套。
 *
 * ## 两种播报模式
 *   - race（比赛）：播放比赛现场的 MP3 录音。
 *     开头 = MP3 里"裁判员准备→运动员准备→预备" + 那声"嘀"（起跳信号），
 *       整段自然播完（约 7 秒），中间不做任何 TTS 补充 —— 口令和"嘀"都是
 *       原录音里现成的，不是另外生成的。
 *     结尾 = seek 到该文件"停"字的位置再播一下。
 *     中间报时（"十/二十/三十…"）属于「训练音乐」大功能，后续再做。
 *   - soft（亲切）：用系统 TTS 播"3、2、1、开始 / 停"。
 *
 * ## 开头口令时长
 *   三个文件开头一致：裁判员准备(0~1.5s) → 运动员准备(2.5~3.4s) → 预备(4.5~5.2s)，
 *   之后紧跟一声"嘀"（起跳信号，纯音效、转录识别不到）。
 *   所以 RACE_INTRO_SEC 取 7 秒，把口令 + "嘀"声完整覆盖，播完自然停。
 *   倒计时的视觉时长也同步到 7 秒，让"嘀"声响起 ≈ 计时开始。
 *
 * ## 为什么比赛模式不裁剪文件、而是用 seek 定位
 *   环境里没有 ffmpeg，硬裁 MP3 字节容易坏。expo-audio 支持 seekTo(秒)：
 *   开头 = 从 0 播到"嘀"声结束；结尾"停" = seek 到该时间点再 play。
 *   三个文件的"停"时间点（转录得到）：10s → 15.8，30s → 35.8，60s → 65.8。
 *
 * ## 为什么用 createAudioPlayer 而不是 useAudioPlayer
 *   之前 useAudioPlayer 在组件顶层无条件建三个播放器，相机页一挂载就同时
 *   初始化音频 + 相机两套原生模块，Android 上抢资源直接闪退。
 *   改成 createAudioPlayer：真正要播时才建，用完 remove() 释放。
 *
 * ## 退出即静音（防残留）
 *   - 所有 setTimeout 都登记进列表，stopAll 时统一 clear。
 *   - 用一个「会话令牌」generation：每次 stopAll 都 +1，异步的 seekTo 完成后
 *     先检查令牌，对不上就说明期间发生过 stopAll（退出/切换），直接放弃 play。
 *     这样退出后绝不会有"停"字或"嘀"声再蹦出来。
 */

import { useEffect, useRef } from 'react';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

/** 播报模式 */
export type VoiceMode = 'race' | 'soft';

/** 三段比赛 MP3 的资源引用（require 才能被 Metro 打进包） */
const RACE_10 = require('../assets/audio/race-10s.mp3');
const RACE_30 = require('../assets/audio/race-30s.mp3');
const RACE_60 = require('../assets/audio/race-60s.mp3');

/** 每段 MP3 里"停"字的时间点（秒），转录得到，结尾 seek 用 */
const RACE_STOP_AT: Record<number, number> = {
  10: 15.8,
  30: 35.8,
  60: 65.8,
};

/**
 * 开头口令（裁判员准备→运动员准备→预备 + 那声"嘀"）的总时长，秒。
 * 口令约 5.2 秒念完，之后紧跟"嘀"声，取 7 秒把两者都覆盖，播完自然停。
 */
const RACE_INTRO_SEC = 7;

/** 匹配目标时长（秒）→ 对应的 MP3 key；非匹配返回 null */
function raceKey(targetSec: number): 10 | 30 | 60 | null {
  if (targetSec === 10) return 10;
  if (targetSec === 30) return 30;
  if (targetSec === 60) return 60;
  return null;
}

/** 三段 MP3 的资源表 */
const RACE_SRC: Record<10 | 30 | 60, number> = {
  10: RACE_10,
  30: RACE_30,
  60: RACE_60,
};

/** 亲切语音三二一：每个数字之间的间隔（毫秒） */
const SOFT_STEP_MS = 800;

/**
 * 训练播报控制器（一个 React Hook）。
 *
 * 用法（在计数页组件里）：
 *   const voice = useVoice();
 *   voice.startCountdown(mode, targetSec)  // 倒计时/训练开始
 *   voice.sayStop(mode, targetSec)         // 结束时喊"停"
 *   voice.stopAll()                         // 中途退出，全部静音
 */
export function useVoice() {
  /** 当前正在用的那个播放器（每次只会有一个在播） */
  const playerRef = useRef<AudioPlayer | null>(null);
  /** 所有还没执行的 setTimeout 句柄，退出时统一清掉 */
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /**
   * 会话令牌：每 stopAll 一次 +1。异步 seekTo 完成后核对它，
   * 对不上说明期间退出/切换过，放弃 play，杜绝退出后残留语音。
   */
  const genRef = useRef(0);

  /** 登记一个定时器，退出时会被一起清掉 */
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timersRef.current = timersRef.current.filter((x) => x !== t);
      fn();
    }, ms);
    timersRef.current.push(t);
  };

  /** 清掉所有 pending 的定时器 */
  const clearTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  /** 关掉正在播的东西、释放播放器、清掉定时器、作废所有在途的异步播放 */
  const stopAll = () => {
    genRef.current += 1;
    clearTimers();
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch { /* 忽略 */ }
      try { playerRef.current.remove(); } catch { /* 忽略 */ }
      playerRef.current = null;
    }
    try { Speech.stop(); } catch { /* 忽略 */ }
  };

  /** 页面卸载时，把还活着的播放器、定时器一起清掉 */
  useEffect(() => {
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 从某个时间点开始播一段（seek 是异步的，做完先核令牌再 play） */
  const playFrom = async (key: 10 | 30 | 60, atSec: number) => {
    const gen = genRef.current;
    const p = createAudioPlayer(RACE_SRC[key]);
    playerRef.current = p;
    try {
      await p.seekTo(atSec);
      // 等待期间如果发生过 stopAll（退出/切换），令牌已变，放弃播放
      if (genRef.current !== gen) return;
      p.play();
    } catch { /* 忽略 */ }
  };

  /**
   * 开始倒计时播报。
   * 比赛模式：从 0 播放开头口令，让"裁判员准备→运动员准备→预备→嘀"整段
   *   自然播完（约 7 秒），不做任何 TTS 补充。
   * 亲切模式：TTS 播 3、2、1、开始。
   */
  const startCountdown = (mode: VoiceMode, targetSec: number) => {
    stopAll();

    if (mode === 'soft') {
      Speech.speak('三', { language: 'zh-CN', rate: 1.0 });
      later(SOFT_STEP_MS, () => Speech.speak('二', { language: 'zh-CN' }));
      later(SOFT_STEP_MS * 2, () => Speech.speak('一', { language: 'zh-CN' }));
      later(SOFT_STEP_MS * 3, () => Speech.speak('开始', { language: 'zh-CN' }));
      return;
    }

    // 比赛模式：播开头口令 + 那声"嘀"，整段自然播完，RACE_INTRO_SEC 后停掉。
    const key = raceKey(targetSec) ?? 30;
    void playFrom(key, 0);
    later(RACE_INTRO_SEC * 1000, () => {
      try {
        if (playerRef.current) {
          playerRef.current.pause();
          playerRef.current.remove();
          playerRef.current = null;
        }
      } catch { /* 忽略 */ }
    });
  };

  /**
   * 结束时喊"停"。
   * 比赛模式：seek 到对应文件的"停"字再播；非匹配时长用 30s 文件的"停"。
   * 亲切模式：TTS 播"停"。
   */
  const sayStop = (mode: VoiceMode, targetSec: number) => {
    stopAll();
    if (mode === 'soft') {
      Speech.speak('停', { language: 'zh-CN' });
      return;
    }
    const key = raceKey(targetSec) ?? 30;
    const stopAt = RACE_STOP_AT[key];
    void playFrom(key, stopAt);
  };

  return { startCountdown, sayStop, stopAll };
}

/** 播报模式默认值：比赛语音 */
export const DEFAULT_VOICE: VoiceMode = 'race';
