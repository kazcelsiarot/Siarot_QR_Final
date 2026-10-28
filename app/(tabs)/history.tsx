import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import GradientBackground from '@/components/GradientBackground';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import {
  getAllEventAttendance,
  getAttendanceHistory,
  getTeacherEventAttendance,
  type AttendanceRecord,
  type TeacherEventAttendance,
} from '@/lib/attendance';
import { getProfile, type Role } from '@/lib/profiles';

/** Shows the last four characters of a UUID. */
function shortId(id: string) {
  return id ? `…${id.slice(-4)}` : 'unknown';
}

function formatDate(iso: string | null) {
  if (!iso) {
    return 'Not set';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleString();
}

/*
 * Present or late is computed, never read from the stored status.
 * A scan at or before the event's end time is present; a scan
 * after the end time has passed is late.
 */
function getAttendanceLabel(
  scannedAt: string,
  endTime: string | null
): 'present' | 'late' {
  if (!endTime) {
    return 'present';
  }

  const scan = new Date(scannedAt).getTime();
  const end = new Date(endTime).getTime();

  if (Number.isNaN(scan) || Number.isNaN(end)) {
    return 'present';
  }

  return scan <= end ? 'present' : 'late';
}

export default function HistoryScreen() {
  const { user } = useAuth();

  const [role, setRole] = useState<Role | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [events, setEvents] = useState<TeacherEventAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const profile = await getProfile(user.id);
      const currentRole: Role = profile?.role ?? 'student';

      setRole(currentRole);

      if (currentRole === 'teacher') {
        const ownEvents = await getTeacherEventAttendance(user.id);

        setEvents(ownEvents);
        setRecords([]);
        return;
      }

      if (currentRole === 'admin') {
        const allEvents = await getAllEventAttendance();

        setEvents(allEvents);
        setRecords([]);
        return;
      }

      const rows = await getAttendanceHistory(user.id);

      setRecords(rows);
      setEvents([]);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);

      console.error('Failed to load history:', error);
      setLoadError(text);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  const pageTitle =
    role === 'admin'
      ? 'All Attendance'
      : role === 'teacher'
        ? 'My Events Attendance'
        : 'Attendance History';

  const pageSubtitle =
    role === 'admin'
      ? 'Every event created by teachers, with the students who scanned in.'
      : role === 'teacher'
        ? 'Students who scanned into the events you created.'
        : 'The events you scanned into.';

  return (
    <GradientBackground>
      <View style={styles.container}>
        <Text style={styles.pageTitle}>{pageTitle}</Text>
        <Text style={styles.pageSubtitle}>{pageSubtitle}</Text>

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator
              size="large"
              color={COLORS.primary}
            />
            <Text style={styles.loadingText}>
              Loading records...
            </Text>
          </View>
        ) : loadError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              Could not load history
            </Text>
            <Text style={styles.emptyText}>{loadError}</Text>
          </View>
        ) : role === 'student' ? (
          records.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No records yet</Text>
              <Text style={styles.emptyText}>
                Scan a QR code to register your attendance.
              </Text>
            </View>
          ) : (
            <FlatList
              data={records}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const label = getAttendanceLabel(
                  item.scannedAt,
                  item.endTime
                );

                return (
                  <View style={styles.eventCard}>
                    <View style={styles.eventHeader}>
                      <View style={styles.eventTitleContainer}>
                        <Text style={styles.eventTitle}>
                          {item.eventTitle}
                        </Text>
                        <Text style={styles.eventCode}>
                          {item.eventId}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.statusBadge,
                          label === 'late'
                            ? styles.lateBadge
                            : styles.presentBadge,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            label === 'late'
                              ? styles.lateBadgeText
                              : styles.presentBadgeText,
                          ]}
                        >
                          {label}
                        </Text>
                      </View>
                    </View>

                    <EventInformation
                      icon="time-outline"
                      text={`Scanned ${formatDate(
                        item.scannedAt
                      )}`}
                    />
                  </View>
                );
              }}
            />
          )
        ) : events.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No events yet</Text>
            <Text style={styles.emptyText}>
              {role === 'admin'
                ? 'Events created by teachers will appear here.'
                : 'Create an event from the Teacher tab.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={events}
            keyExtractor={(item) => item.eventId}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.eventCard}>
                <View style={styles.eventHeader}>
                  <View style={styles.eventTitleContainer}>
                    <Text style={styles.eventTitle}>
                      {item.title}
                    </Text>
                    <Text style={styles.eventCode}>
                      {item.eventCode}
                    </Text>
                  </View>

                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>
                      {item.attendeeCount}
                    </Text>
                  </View>
                </View>

                {role === 'admin' && item.teacherName ? (
                  <EventInformation
                    icon="person-outline"
                    text={`Created by ${item.teacherName}`}
                  />
                ) : null}

                <EventInformation
                  icon="calendar-outline"
                  text={`${formatDate(
                    item.startTime
                  )} - ${formatDate(item.endTime)}`}
                />

                {item.attendees.length === 0 ? (
                  <Text style={styles.noAttendees}>
                    No students have scanned this event yet.
                  </Text>
                ) : (
                  <View style={styles.attendeeList}>
                    <Text style={styles.attendeeHeading}>
                      Students ({item.attendeeCount})
                    </Text>

                    {item.attendees.map((attendee) => {
                      const label = getAttendanceLabel(
                        attendee.scannedAt,
                        item.endTime
                      );

                      return (
                        <View
                          key={`${item.eventId}-${attendee.studentId}-${attendee.scannedAt}`}
                          style={styles.attendeeRow}
                        >
                          <View style={styles.attendeeInfo}>
                            <Text style={styles.attendeeName}>
                              {attendee.studentName ||
                                'Unnamed student'}
                            </Text>
                            <Text style={styles.attendeeMeta}>
                              ID {shortId(attendee.studentId)}
                            </Text>
                          </View>

                          <View style={styles.attendeeRight}>
                            <View
                              style={[
                                styles.statusBadge,
                                label === 'late'
                                  ? styles.lateBadge
                                  : styles.presentBadge,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusBadgeText,
                                  label === 'late'
                                    ? styles.lateBadgeText
                                    : styles.presentBadgeText,
                                ]}
                              >
                                {label}
                              </Text>
                            </View>

                            <Text style={styles.attendeeMeta}>
                              {formatDate(attendee.scannedAt)}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          />
        )}
      </View>
    </GradientBackground>
  );
}

type EventInformationProps = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
};

function EventInformation({
  icon,
  text,
}: EventInformationProps) {
  return (
    <View style={styles.informationRow}>
      <Ionicons
        name={icon}
        size={17}
        color={COLORS.textSecondary}
      />
      <Text style={styles.informationText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 24,
  },

  pageTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FED7B8',
    marginBottom: 4,
    textShadowColor: 'rgba(58, 15, 18, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  pageSubtitle: {
    fontSize: 14,
    color: 'rgba(254, 215, 184, 0.9)',
    lineHeight: 20,
    marginBottom: 20,
    textShadowColor: 'rgba(58, 15, 18, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },


  loadingBlock: {
    alignItems: 'center',
    paddingVertical: 60,
  },

  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 12,
  },

  list: {
    paddingBottom: 32,
  },

  eventCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 16,
    marginBottom: 14,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },

  eventHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },

  eventTitleContainer: {
    flex: 1,
    marginRight: 10,
  },

  eventTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },

  eventCode: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 3,
  },

  countBadge: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },

  countText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  presentBadge: {
    backgroundColor: COLORS.success + '1A',
  },

  lateBadge: {
    backgroundColor: COLORS.danger + '1A',
  },

  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },

  presentBadgeText: {
    color: COLORS.success,
  },

  lateBadgeText: {
    color: COLORS.danger,
  },

  informationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },

  informationText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginLeft: 8,
  },

  attendeeList: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },

  attendeeHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },

  attendeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  attendeeInfo: {
    flex: 1,
    marginRight: 10,
  },

  attendeeName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },

  attendeeMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 3,
  },

  attendeeRight: {
    alignItems: 'flex-end',
  },

  noAttendees: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 12,
  },

  emptyCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 28,
    alignItems: 'center',
    marginTop: 8,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },

  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 5,
    lineHeight: 20,
  },
});
