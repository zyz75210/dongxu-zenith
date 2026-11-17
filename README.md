# 动序ZENITH

一个跳绳主题的个人日历 App —— 看日期、记日程、点完成、留历史。

用 Expo + React Native 构建，同一套代码跑安卓与 iOS。当前版本 **1.0.0 内测**。

## 功能

- **日历主页**：真实日期、周一开头、上下月切换、左右滑动切月；点年月弹滚筒选择；选中日期有液体位移动画
- **日程管理**：六类（工作 / 运动 / 学习 / 活动 / 重要 / 其他），日期与时间走同一套滚轮；支持删除
- **完成打卡**：主页右侧类型胶囊与详情页圆形按钮三态（未完成 / 已完成 / 超时），可直接点切换
- **历史日程**：按月 → 按天 → 当天三层折叠，支持批量选择删除
- **个人资料**：头像从相册导入，名字 / 昵称 / 邮箱 / 生日可编辑；统计数字按真实日程计算

## 本地运行

```bash
npm install
npx expo start -c --lan      # 手机装 Expo Go 扫码
```

需要 Node 20+、Expo Go（SDK 58）。

类型检查：

```bash
./node_modules/.bin/tsc --noEmit
```

## 打包

```bash
npx eas-cli build --platform android --profile preview
```

`preview` 出 APK（装机测试用），`production` 出 AAB（应用商店用）。详见 `eas.json`。

## 技术栈

| 项 | 版本 |
|---|---|
| Expo SDK | 58 |
| React Native | 0.88.1 |
| React | 19.3 |
| TypeScript | 5.x |
| react-native-svg | 15.16 |

## 已知限制

1.0.0 的数据存在内存里，关掉 App 会清空。持久化是 1.1 的第一优先级。

其余待办与实现细节见 `运行说明.md` 与归档目录里的《开发交接文档》。

## License

MIT
