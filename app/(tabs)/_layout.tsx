import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile } from '@/lib/profiles';

type UserRole = 'student' | 'teacher' | 'admin';

export default function TabLayout() {
  const { user, loading: authLoading } = useAuth();

  const [role, setRole] = useState<UserRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadRole() {
      if (authLoading) {
        return;
      }

      if (!user) {
        if (active) {
          setRole(null);
          setRoleLoading(false);
        }

        return;
      }

      setRoleLoading(true);

      try {
        const profile = await getProfile(user.id);

        if (!active) {
          return;
        }

        const normalizedRole = profile?.role?.trim().toLowerCase();

        if (
          normalizedRole === 'student' ||
          normalizedRole === 'teacher' ||
          normalizedRole === 'admin'
        ) {
          setRole(normalizedRole);
        } else {
          setRole('student');
        }
      } catch (error) {
        console.error('Failed to load profile role:', error);

        if (active) {
          setRole('student');
        }
      } finally {
        if (active) {
          setRoleLoading(false);
        }
      }
    }

    loadRole();

    return () => {
      active = false;
    };
  }, [user, authLoading]);

  if (authLoading || roleLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#FED7B8',
          tabBarInactiveTintColor: 'rgba(254, 215, 184, 0.55)',
          sceneStyle: { backgroundColor: COLORS.background },
          tabBarStyle: {
            backgroundColor: 'rgba(89, 23, 27, 0.94)',
            borderTopColor: 'rgba(254, 215, 184, 0.25)',
            borderTopWidth: 1,
          },
        }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'home-sharp' : 'home-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'qr-code' : 'qr-code-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'time' : 'time-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="teacher"
        options={{
          title: 'Teacher',
          href: role === 'teacher' ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'clipboard' : 'clipboard-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: role === 'admin' ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={
                focused
                  ? 'shield-checkmark'
                  : 'shield-checkmark-outline'
              }
              color={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
});
