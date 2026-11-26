/**
 * Babel 配置。
 *
 * 这个项目原本没有 babel.config.js（靠 Expo 的默认配置就能跑），
 * 但从接入 vision-camera / MediaPipe 姿态识别开始必须显式写一份 ——
 * 因为帧处理器里的函数要交给 worklets 在独立线程跑，
 * 少了下面那个 plugin，`useFrameProcessor` 会在运行时直接崩。
 *
 * 改动这个文件后 Metro 必须带 --clear 重启，否则旧缓存还会生效。
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets-core/plugin'],
  };
};
