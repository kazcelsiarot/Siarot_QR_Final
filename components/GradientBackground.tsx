import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';

import { COLORS } from '@/constants/colors';

type GradientBackgroundProps = {
  children: ReactNode;
};

/*
 * Deep maroon at the top easing into warm cream at the bottom,
 * the direction your reference image uses. Children stack on top.
 */
export default function GradientBackground({
  children,
}: GradientBackgroundProps) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[
          COLORS.gradientDark,
          '#8E4043',
          COLORS.gradientLight,
        ]}
        locations={[0, 0.52, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.gradientDark },
  content: { flex: 1 },
});
