import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { C, WEEK_DAYS } from '../theme';
import { Profile } from '../data';
import { weekdayIndex } from '../utils/date';

type Props = {
  profile: Profile;
  /** 是否可见：页面常驻不卸载，靠它判断"重新打开了"从而把表单恢复成已保存的资料 */
  visible?: boolean;
  onClose: () => void;
  onSave: (p: Profile) => void;
  /** 复用首页那套年月日滚轮 */
  onOpenDate: (
    init: { y: number; m: number; d: number },
    onPick: (y: number, m: number, d: number) => void,
  ) => void;
};

function ProfileEditScreen({
  profile, visible = true, onClose, onSave, onOpenDate,
}: Props) {
  const [name, setName] = useState(profile.name);
  const [nickname, setNickname] = useState(profile.nickname ?? '');
  const [email, setEmail] = useState(profile.email ?? '');
  const [birthday, setBirthday] = useState(profile.birthday);
  const [avatar, setAvatar] = useState<string | undefined>(profile.avatar);
  /** 当前聚焦的输入框：只有正在编辑的那一栏描边变蓝，避免三栏都亮着 */
  const [focus, setFocus] = useState<'name' | 'nickname' | 'email' | null>(null);

  /**
   * 页面常驻后，重新打开时要把编辑过的临时内容丢弃、恢复成已保存的资料；
   * 否则上次没保存就退出的改动会留在输入框里。
   */
  const prevVisible = useRef(false);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      setName(profile.name);
      setNickname(profile.nickname ?? '');
      setEmail(profile.email ?? '');
      setBirthday(profile.birthday);
      setAvatar(profile.avatar);
      setFocus(null);
      // 页面常驻不卸载，上次滑到的位置会留着，重新打开时回到顶部
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
    prevVisible.current = visible;
  }, [visible, profile]);

  const birthdayText = `${birthday.y}年${birthday.m + 1}月${birthday.d}日 星期${
    WEEK_DAYS[weekdayIndex(new Date(birthday.y, birthday.m, birthday.d))]
  }`;

  const openBirthday = () => onOpenDate(birthday, (y, m, d) => setBirthday({ y, m, d }));

  /** 从系统相册选一张图，并按 1:1 裁好当头像 */
  const pickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          '无法访问相册',
          '请在系统设置里允许本应用访问照片，然后再试一次。',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets?.length) {
        setAvatar(result.assets[0].uri);
      }
    } catch {
      Alert.alert('选择图片失败', '相册打不开，请稍后重试。');
    }
  };

  const save = () => {
    const mail = email.trim();
    // 邮箱可以不填，但填了就得像个邮箱
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      Alert.alert('邮箱格式不对', '请检查一下，正确格式类似 name@mail.com。');
      return;
    }
    onSave({
      ...profile,
      name: name.trim() || '未命名用户',
      nickname: nickname.trim(),
      email: mail,
      birthday,
      avatar,
    });
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* 顶部 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="chevron-back-outline" size={18} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>个人资料</Text>
          <View style={styles.circleGhost} />
        </View>

        {/* 头像 */}
        <Text style={[styles.label, styles.labelTop]}>头像</Text>
        <View style={styles.avatarBlock}>
          <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} activeOpacity={0.8}>
            <Image
              source={avatar ? { uri: avatar } : require('../../assets/avatar.png')}
              style={styles.avatar}
            />
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={13} color={C.white} />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>点击从相册选择</Text>
        </View>

        {/* 名字 */}
        <Text style={[styles.label, styles.labelGap]}>名字</Text>
        <TextInput
          style={[styles.input, focus === 'name' && styles.inputOn]}
          value={name}
          onChangeText={setName}
          placeholder="输入你的名字"
          placeholderTextColor={C.gray}
          maxLength={20}
          returnKeyType="done"
          onFocus={() => setFocus('name')}
          onBlur={() => setFocus(null)}
        />
        <Text style={styles.counter}>{name.length}/20</Text>

        {/* 个人昵称：显示在"我的"页名字下方那一行 */}
        <Text style={[styles.label, styles.labelGap]}>个人昵称</Text>
        <TextInput
          style={[styles.input, focus === 'nickname' && styles.inputOn]}
          value={nickname}
          onChangeText={setNickname}
          placeholder="例如：产品设计师"
          placeholderTextColor={C.gray}
          maxLength={20}
          returnKeyType="done"
          onFocus={() => setFocus('nickname')}
          onBlur={() => setFocus(null)}
        />
        <Text style={styles.counter}>{nickname.length}/20</Text>
        <Text style={styles.hint}>会显示在「我的」页名字下方</Text>

        {/* 邮箱 */}
        <Text style={[styles.label, styles.labelGap]}>邮箱</Text>
        <TextInput
          style={[styles.input, focus === 'email' && styles.inputOn]}
          value={email}
          onChangeText={setEmail}
          placeholder="name@mail.com"
          placeholderTextColor={C.gray}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={60}
          returnKeyType="done"
          onFocus={() => setFocus('email')}
          onBlur={() => setFocus(null)}
        />
        <Text style={styles.counter}>{email.length}/60</Text>

        {/* 生日 */}
        <Text style={[styles.label, styles.labelGap]}>生日</Text>
        <TouchableOpacity style={styles.fieldCard} onPress={openBirthday} activeOpacity={0.6}>
          <Ionicons name="calendar-outline" size={17} color={C.primary} />
          <Text style={styles.fieldText}>{birthdayText}</Text>
          <Ionicons name="chevron-forward-outline" size={16} color={C.gray} />
        </TouchableOpacity>
      </ScrollView>

      {/* 保存 */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.saveBtn} onPress={save} activeOpacity={0.85}>
          <Text style={styles.saveText}>保存资料</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const AVATAR = 96;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },
  circleGhost: { width: 34, height: 34 },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },

  label: { fontSize: 12, color: C.gray, marginBottom: 8 },
  labelTop: { marginTop: 26 },
  labelGap: { marginTop: 22 },

  avatarBlock: { alignItems: 'center', marginTop: 4, marginBottom: 4 },
  avatarWrap: { width: AVATAR, height: AVATAR },
  avatar: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2,
    backgroundColor: C.soft,
  },
  // 右下角的相机小圆标：提示这里可以换图
  cameraBadge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.primary,
    borderWidth: 2, borderColor: C.white,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarHint: { fontSize: 11, color: C.gray, marginTop: 10 },

  input: {
    borderWidth: 1.5, borderColor: C.line,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 14, color: C.text, backgroundColor: C.bg,
  },
  // 聚焦时才高亮，三个输入框不会同时亮蓝边
  inputOn: { borderColor: C.primary },
  counter: { fontSize: 11, color: C.gray, textAlign: 'right', marginTop: 6 },
  hint: { fontSize: 11, color: C.gray, marginTop: 4 },

  fieldCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 16,
  },
  fieldText: { flex: 1, fontSize: 13, color: C.text, marginLeft: 10 },

  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line },
  saveBtn: {
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  saveText: { color: C.white, fontSize: 15, fontWeight: '600' },
});

// 父级（App）每次重渲染都会重建元素，memo 让本页在 props 没变时直接跳过重渲染
export default memo(ProfileEditScreen);
