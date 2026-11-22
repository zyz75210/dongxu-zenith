import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { C } from '../theme';

type Props = {
  /** null = 隐藏；换一条新文案就重新淡入 */
  message: string | null;
  /** 距屏幕底部的距离：默认落在底部导航上方 */
  bottom?: number;
};

/**
 * 轻提示条。只负责"显示"，不自己计时 ——
 * 什么时候收起由调用方决定（App 里统一 2.4s），这样连续触发时不会互相打断。
 * 淡出期间保留最后一条文案，避免文字先消失、背景还在。
 */
export default function Toast({ message, bottom = 92 }: Props) {
  const anim = useRef(new Animated.Value(0)).current;
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    if (message) {
      setHeld(message);
      Animated.timing(anim, {
        toValue: 1, duration: 160, useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(anim, {
      toValue: 0, duration: 220, useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setHeld(null);
    });
  }, [message, anim]);

  if (!held) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          bottom,
          opacity: anim,
          transform: [{
            translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
          }],
        },
      ]}
    >
      <View style={styles.pill}>
        <Text style={styles.text}>{held}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', paddingHorizontal: 24, zIndex: 80,
  },
  pill: {
    maxWidth: '100%',
    backgroundColor: 'rgba(32,36,49,0.92)',
    borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  text: { fontSize: 12, color: C.white, lineHeight: 18, textAlign: 'center' },
});
