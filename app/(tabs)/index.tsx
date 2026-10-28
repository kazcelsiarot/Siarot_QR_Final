import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GradientBackground from '@/components/GradientBackground';
import Header from '@/components/Header';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';

type Stat = { label: string; value: string };

type Action = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  filled?: boolean;
};

export default function Index() {
  const { user } = useAuth();

  const [role, setRole] = useState<Role | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [stats, setStats] = useState<Stat[]>([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);

  const loadHome = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const profile = await getProfile(user.id);
      const currentRole: Role = profile?.role ?? 'student';

      setRole(currentRole);
      setDisplayName(profile?.full_name || user.email || 'there');

      if (currentRole === 'student') {
        const { count: myScans } = await supabase
          .from('attendance')
          .select('id', { count: 'exact', head: true })
          .eq('student_id', user.id);

        const { count: openEvents } = await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'closed');

        setStats([
          { label: 'My scans', value: String(myScans ?? 0) },
          { label: 'Open events', value: String(openEvents ?? 0) },
        ]);

        setSummary(
          'Scan a QR code at a school activity to record your attendance. Everything you scan appears in History.'
        );
        return;
      }

      if (currentRole === 'teacher') {
        const { data: myEvents } = await supabase
          .from('events')
          .select('id')
          .eq('created_by', user.id);

        const eventIds = (myEvents ?? []).map((row: any) => row.id);

        const { count: scans } = eventIds.length
          ? await supabase
              .from('attendance')
              .select('id', { count: 'exact', head: true })
              .in('event_id', eventIds)
          : { count: 0 };

        const { count: openCount } = await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', user.id)
          .neq('status', 'closed');

        setStats([
          { label: 'My events', value: String(eventIds.length) },
          { label: 'Total scans', value: String(scans ?? 0) },
          { label: 'Open', value: String(openCount ?? 0) },
        ]);

        setSummary(
          'Create events and share the QR code with your students. Every scan shows up under your events in History.'
        );
        return;
      }

      const [{ count: userCount }, { count: eventCount }] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true }),
          supabase
            .from('events')
            .select('id', { count: 'exact', head: true }),
        ]);

      const { count: scanCount } = await supabase
        .from('attendance')
        .select('id', { count: 'exact', head: true });

      setStats([
        { label: 'Users', value: String(userCount ?? 0) },
        { label: 'Events', value: String(eventCount ?? 0) },
        { label: 'Scans', value: String(scanCount ?? 0) },
      ]);

      setSummary(
        'Review every teacher event, manage account roles, and restore or permanently remove deleted events from the recycle bin.'
      );
    } catch (error) {
      console.error('Failed to load home:', error);
      setStats([]);
      setSummary('Unable to load your summary right now.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadHome();
    }, [loadHome])
  );

  const roleLabel =
    role === 'admin'
      ? 'Administrator'
      : role === 'teacher'
        ? 'Teacher'
        : 'Student';

  const actions: Action[] =
    role === 'admin'
      ? [
          {
            title: 'Admin Dashboard',
            icon: 'shield-checkmark-outline',
            route: '/(tabs)/admin',
            filled: true,
          },
          {
            title: 'View All Attendance',
            icon: 'time-outline',
            route: '/history',
          },
        ]
      : role === 'teacher'
        ? [
            {
              title: 'Manage My Events',
              icon: 'calendar-outline',
              route: '/(tabs)/teacher',
              filled: true,
            },
            {
              title: 'View Attendance',
              icon: 'time-outline',
              route: '/history',
            },
          ]
        : [
            {
              title: 'Scan QR Code',
              icon: 'qr-code-outline',
              route: '/scan',
              filled: true,
            },
            {
              title: 'Attendance History',
              icon: 'time-outline',
              route: '/history',
            },
          ];

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerContainer}>
            <Header title="QR Attendance" />
          </View>

          {/* ---------- hero (text sits on a glass panel) ---------- */}
          <View style={styles.heroCard}>
            <View style={styles.rolePill}>
              <Ionicons
                name={
                  role === 'admin'
                    ? 'shield-checkmark-outline'
                    : role === 'teacher'
                      ? 'clipboard-outline'
                      : 'school-outline'
                }
                size={14}
                color={COLORS.primary}
              />
              <Text style={styles.rolePillText}>{roleLabel}</Text>
            </View>

            <Text style={styles.greeting}>Hello, {displayName}</Text>

            <Text style={styles.heroText}>
              {loading ? 'Loading your summary...' : summary}
            </Text>
          </View>

          {/* ---------- stats ---------- */}
          {loading ? (
            <View style={styles.glassCard}>
              <ActivityIndicator
                size="large"
                color={COLORS.primary}
              />
            </View>
          ) : (
            <View style={styles.statsRow}>
              {stats.map((stat) => (
                <View key={stat.label} style={styles.statCard}>
                  <Text style={styles.statValue}>{stat.value}</Text>
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ---------- actions ---------- */}
          <View style={styles.glassCard}>
            <Text style={styles.cardTitle}>Quick actions</Text>

            {actions.map((action) => (
              <Pressable
                key={action.title}
                style={({ pressed }) => [
                  styles.actionButton,
                  action.filled
                    ? styles.actionFilled
                    : styles.actionOutline,
                  pressed && styles.pressed,
                ]}
                onPress={() => router.push(action.route as never)}
              >
                <Ionicons
                  name={action.icon}
                  size={20}
                  color={
                    action.filled
                      ? COLORS.textOnPrimary
                      : COLORS.primary
                  }
                />
                <Text
                  style={[
                    styles.actionText,
                    action.filled
                      ? styles.actionTextFilled
                      : styles.actionTextOutline,
                  ]}
                >
                  {action.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },

  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    flexGrow: 1,
  },

  headerContainer: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 18,
  },

  /* Glass surfaces: translucent white over the gradient. */
  glassCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 16,
    marginBottom: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },

  heroCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 18,
    marginBottom: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },

  rolePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },

  rolePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    marginLeft: 5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  greeting: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 8,
  },

  heroText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },

  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },

  statCard: {
    flexGrow: 1,
    minWidth: 96,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginRight: 10,
    marginBottom: 10,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },

  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.primary,
  },

  statLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },

  actionButton: {
    minHeight: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    paddingHorizontal: 16,
  },

  actionFilled: {
    backgroundColor: COLORS.primary,
  },

  actionOutline: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },

  actionText: {
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },

  actionTextFilled: {
    color: COLORS.textOnPrimary,
  },

  actionTextOutline: {
    color: COLORS.primary,
  },

  pressed: {
    opacity: 0.75,
  },
});
