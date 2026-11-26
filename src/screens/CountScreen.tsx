import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import {
  Delegate, RunningMode, usePoseDetection,
} from 'react-native-mediapipe-posedetection';
import { C } from '../theme';

/**
 * 计数页（2a 验证版）。
 *
 * 这一版只做三件事，目的是先把「能不能数」验证掉：
 *   1. 相机预览能出来
 *   2. MediaPipe 能识别到人（33 个关键点）
 *   3. 靠脚踝纵坐标的滞回判断跳一次、加一个数
 *
 * 还没做的（等 2b）：节奏波形、三类提醒、录像、暂停、目标进度、结果页。
 *
 * ## 计数原理
 * 取左右脚踝（关键点 27 / 28）的归一化纵坐标 y（0 在画面顶部，1 在底部），
 * 跳起时 y 变小、落地时 y 变大。单靠"变小就加一"会抖出一堆假数，所以：
 *   - 先维护一条"地面基线" groundY：只往上跟（脚踩得更低时更新），不主动下降，
 *     这样人往后退一步不会把基线带偏；
 *   - 滞回：高出基线 LIFT_ON 才算离地，回落到 LIFT_OFF 以内才算落地，
 *     两个阈值留差值，避免在阈值附近反复触发；
 *   - 两次计数至少隔 MIN_GAP_MS，挥手、整理衣服这种快速抖动会被吃掉。
 *
 * 所有阈值都要在真机上用真实身高 / 距离标定，现在给的是保守初值。
 */

const MODEL = 'pose_landmarker_lite.task';

/** 起跳：脚踝比基线高出画面高度的 1.8% */
const LIFT_ON = 0.018;
/** 落地：回落到 0.8% 以内（和起跳留 1% 的差值，形成滞回） */
const LIFT_OFF = 0.008;
/** 两次有效跳跃的最小间隔（毫秒） */
const MIN_GAP_MS = 220;
/** 基线只往上跟的系数：越小越稳，越大越跟手 */
const BASELINE_RATE = 0.2;

type Props = {
  /** 页面是否在前台：退出去要关相机，否则一直在耗电 */
  active: boolean;
  onExit: () => void;
  /** 关掉相机后回传这次跳了多少（2b 接结果页时用） */
  onFinish?: (count: number) => void;
};

function CountScreen({ active, onExit, onFinish }: Props) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();

  const [count, setCount] = useState(0);
  const [detected, setDetected] = useState(false);
  /** 调试用：当前脚踝 y、离地高度、帧率 —— 标定阈值全靠这三个数 */
  const [probe, setProbe] = useState({ y: 0, lift: 0, fps: 0 });
  const [error, setError] = useState<string | null>(null);

  /** 计数相关的状态全部放 ref：onResults 每帧都会调用，走 setState 会卡死 */
  const countRef = useRef(0);
  const stateRef = useRef<'ground' | 'air'>('ground');
  const baselineRef = useRef(-1);
  const lastCountAt = useRef(0);
  const lastY = useRef(0);
  const lastLift = useRef(0);
  const frames = useRef(0);
  const fpsWindowStart = useRef(0);
  const fpsRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (!hasPermission) requestPermission();
  }, [active, hasPermission, requestPermission]);

  /** 每帧回调：只做算术，不做渲染 */
  const handleResults = useCallback((result: any) => {
    const lm = result?.landmarks?.[0];
    if (!lm || lm.length < 33) {
      setDetected(false);
      return;
    }
    setDetected(true);

    // 左右脚踝取平均，单脚晃动不会影响判断
    const y = (lm[27].y + lm[28].y) / 2;

    if (baselineRef.current < 0) {
      baselineRef.current = y;
      lastY.current = y;
      return;
    }
    // 基线只往上跟：脚踩得更低（y 更大）才更新，起跳时不会把基线带着走
    if (y > baselineRef.current) {
      baselineRef.current += (y - baselineRef.current) * BASELINE_RATE;
    }

    const lift = baselineRef.current - y;
    lastY.current = y;
    lastLift.current = lift;

    const now = Date.now();
    if (stateRef.current === 'ground' && lift > LIFT_ON) {
      stateRef.current = 'air';
    } else if (stateRef.current === 'air' && lift < LIFT_OFF) {
      stateRef.current = 'ground';
      if (now - lastCountAt.current >= MIN_GAP_MS) {
        lastCountAt.current = now;
        countRef.current += 1;
        setCount(countRef.current);
      }
    }

    // 帧率：每满 1 秒结算一次，不要每帧都算
    frames.current += 1;
    if (fpsWindowStart.current === 0) fpsWindowStart.current = now;
    const span = now - fpsWindowStart.current;
    if (span >= 1000) {
      fpsRef.current = Math.round((frames.current * 1000) / span);
      frames.current = 0;
      fpsWindowStart.current = now;
    }
  }, []);

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
      });
    }, 300);
    return () => clearInterval(t);
  }, [active]);

  const stop = () => {
    onFinish?.(countRef.current);
    onExit();
  };

  const notReady = !device || !hasPermission;

  return (
    <View style={styles.root}>
      {!notReady && active && (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={active}
          frameProcessor={pose.frameProcessor}
          onLayout={pose.cameraViewLayoutChangeHandler}
          // 这一版只要预览 + 帧数据，不拍照不录像
          photo={false}
          video={false}
        />
      )}

      {/* 取景提示：只是告诉人站哪儿，不是动作分析框 */}
      <View style={styles.frame} pointerEvents="none" />

      <View style={styles.topRow}>
        <TouchableOpacity style={styles.closeBtn} activeOpacity={0.8} onPress={stop}>
          <Ionicons name="close" size={20} color={C.white} />
        </TouchableOpacity>
        <View style={[styles.badge, detected ? styles.badgeOn : styles.badgeOff]}>
          <Text style={styles.badgeText}>
            {notReady
              ? (hasPermission ? '相机启动中' : '需要相机权限')
              : detected ? 'AI 已识别到人体 · 计数中' : '请让人完整入镜'}
          </Text>
        </View>
      </View>

      <View style={styles.center} pointerEvents="none">
        <Text style={styles.count}>{count}</Text>
        <Text style={styles.unit}>次</Text>
      </View>

      <View style={styles.bottom}>
        {/* 标定区：这三行数字决定阈值该怎么调，正式版会隐藏 */}
        <View style={styles.probeBox}>
          <Text style={styles.probeTitle}>标定数据</Text>
          <Text style={styles.probeText}>脚踝 y {probe.y.toFixed(3)}</Text>
          <Text style={styles.probeText}>离地幅度 {probe.lift.toFixed(3)}（阈值 {LIFT_ON}）</Text>
          <Text style={styles.probeText}>识别帧率 {probe.fps} fps</Text>
          {error ? <Text style={styles.probeErr}>{error}</Text> : null}
        </View>

        {!hasPermission && (
          <TouchableOpacity style={styles.permBtn} activeOpacity={0.85} onPress={requestPermission}>
            <Text style={styles.permText}>允许使用相机</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.stopBtn} activeOpacity={0.85} onPress={stop}>
          <Text style={styles.stopText}>结束训练 · {count} 次</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  frame: {
    position: 'absolute', left: 28, right: 28, top: '18%', bottom: '26%',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    borderStyle: 'dashed', borderRadius: 18,
  },

  topRow: {
    position: 'absolute', left: 16, right: 16, top: 54,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  badge: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  badgeOn: { backgroundColor: 'rgba(22,134,74,0.85)' },
  badgeOff: { backgroundColor: 'rgba(0,0,0,0.55)' },
  badgeText: { fontSize: 11, color: C.white },

  center: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  count: {
    fontSize: 104, fontWeight: '700', color: C.white,
    fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
  },
  unit: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: -6 },

  bottom: { position: 'absolute', left: 16, right: 16, bottom: 34, gap: 10 },
  probeBox: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 3,
  },
  probeTitle: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 2 },
  probeText: { fontSize: 11, color: C.white, fontVariant: ['tabular-nums'] },
  probeErr: { fontSize: 11, color: '#FF8A80', marginTop: 4 },

  permBtn: {
    height: 46, borderRadius: 23, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  permText: { fontSize: 14, color: C.white, fontWeight: '600' },

  stopBtn: {
    height: 50, borderRadius: 25, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  stopText: { fontSize: 15, color: C.white, fontWeight: '600' },
});

export default memo(CountScreen);
