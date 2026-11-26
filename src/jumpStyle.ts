/**
 * 跳绳的「跳法」。
 *
 * 为什么单独抽出来：跳法决定计数页用哪一套判据 ——
 *   并脚跳：两只脚同时离地，适合「双足离地」这类严格判据，抗误计强；
 *   换脚跳：左右交替抬脚，只能按「单脚抬升」计数，判据完全不同。
 * 训练页负责选，计数页负责按选中的那套算。
 */
export type JumpStyle = 'together' | 'alternate';

export const JUMP_STYLES: { key: JumpStyle; label: string }[] = [
  { key: 'together', label: '并脚跳' },
  { key: 'alternate', label: '换脚跳' },
];

export const jumpStyleLabel = (s: JumpStyle) =>
  s === 'alternate' ? '换脚跳' : '并脚跳';
