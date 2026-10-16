
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useAuth } from '@/lib/auth';
import { getProfile, type Profile } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';
import { COLORS } from '@/constants/colors';

type EventItem = {
  id: string;
  event_code: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  created_by: string | null;
  created_at: string;
};

type EditEventState = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
};

export default function AdminDashboard() {
  const router = useRouter();
  const { user } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  return () => {
    if (successTimer.current) {
      clearTimeout(successTimer.current);
    }
  };
}, []);

const showSuccessMessage = (message: string) => {
  if (successTimer.current) {
    clearTimeout(successTimer.current);
  }

  setSuccessMessage(message);

  successTimer.current = setTimeout(() => {
    setSuccessMessage('');
    successTimer.current = null;
  }, 3000);
};

  const [editingEvent, setEditingEvent] =
    useState<EditEventState | null>(null);

  const [pickerField, setPickerField] =
    useState<'start_time' | 'end_time' | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!user) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const currentProfile = await getProfile(user.id);

      if (!currentProfile || currentProfile.role !== 'admin') {
        Alert.alert('Access Denied', 'Admin access only.');
        router.replace('/(tabs)');
        return;
      }

      setProfile(currentProfile);

      const [usersResult, eventsResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .order('full_name', { ascending: true }),

        supabase
          .from('events')
          .select('*')
          .order('created_at', { ascending: false }),
      ]);

      if (usersResult.error) throw usersResult.error;
      if (eventsResult.error) throw eventsResult.error;

      setUsers((usersResult.data ?? []) as Profile[]);
      setEvents((eventsResult.data ?? []) as EventItem[]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      console.error('DASHBOARD LOAD ERROR:', error);
      Alert.alert('Dashboard Error', message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, router]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  
const openEditEvent = (event: EventItem) => {
  if (successTimer.current) {
    clearTimeout(successTimer.current);
    successTimer.current = null;
  }

  setSuccessMessage('');

  setEditingEvent({
    id: event.id,
    title: event.title,
    start_time: event.start_time ?? '',
    end_time: event.end_time ?? '',
  });

  setPickerField(null);
};

  const saveEditedEvent = async () => {
    if (saving) return;

    const eventToSave = editingEvent;

    if (!eventToSave) {
      Alert.alert('Error', 'Please select an event first.');
      return;
    }

    const newTitle = eventToSave.title.trim();

    if (!newTitle) {
      Alert.alert('Missing Title', 'Please enter an event title.');
      return;
    }

    setSaving(true);
    setSuccessMessage('');

    try {
      console.log('--- SAVING EVENT ---');
      console.log('Event ID:', eventToSave.id);
      console.log('New title:', newTitle);

      const { data, error } = await supabase
        .from('events')
        .update({
          title: newTitle,
          start_time: eventToSave.start_time || null,
          end_time: eventToSave.end_time || null,
        })
        .eq('id', eventToSave.id)
        .select('id, title, start_time, end_time');

      console.log('Returned data:', data);
      console.log('Update error:', error);

      if (error) {
        console.error('SUPABASE UPDATE ERROR:', error);

        Alert.alert(
          'Save Failed',
          `${error.message}\nCode: ${error.code ?? 'N/A'}`,
        );
        return;
      }

      if (!data || data.length === 0) {
        Alert.alert(
          'No Event Updated',
          'No updated event was returned. Check the event ID and Supabase UPDATE policy.',
        );
        return;
      }

      const updatedEvent = data[0];

      setEvents((currentEvents) =>
        currentEvents.map((event) =>
          event.id === updatedEvent.id
            ? {
                ...event,
                title: updatedEvent.title,
                start_time: updatedEvent.start_time,
                end_time: updatedEvent.end_time,
              }
            : event,
        ),
      );

      setEditingEvent(null);
      setPickerField(null);

      // Show an in-page success message on both web and phone.
      showSuccessMessage('Event updated successfully');
        

      // Refresh the dashboard data from Supabase.
      await loadDashboard();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      console.error('SAVE EVENT ERROR:', error);
      Alert.alert('Save Failed', message);
    } finally {
      setSaving(false);
    }
  };

  const handleDateChange = (
    _event: unknown,
    selectedDate?: Date,
  ) => {
    const field = pickerField;
    const currentEvent = editingEvent;

    if (selectedDate && field && currentEvent) {
      setEditingEvent({
        ...currentEvent,
        [field]: selectedDate.toISOString(),
      });
    }

    setPickerField(null);
  };

  const formatDate = (value: string | null) => {
    if (!value) return 'Not set';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      }
    >
      <Text style={styles.heading}>Admin Dashboard</Text>

      <Text style={styles.subtitle}>
        Welcome, {profile?.full_name || user?.email || 'Admin'}
      </Text>

      {successMessage !== '' && (
        <View
          accessibilityRole="alert"
          style={styles.successMessage}
        >
          <Text style={styles.successMessageText}>
            {successMessage}
          </Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{users.length}</Text>
          <Text style={styles.statLabel}>Users</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{events.length}</Text>
          <Text style={styles.statLabel}>Events</Text>
        </View>
      </View>

      {editingEvent !== null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Edit Event</Text>

          <Text style={styles.label}>Event Title</Text>
          <TextInput
            style={styles.input}
            value={editingEvent.title}
            onChangeText={(title) =>
              setEditingEvent((current) =>
                current ? { ...current, title } : current,
              )
            }
            placeholder="Enter event title"
            placeholderTextColor="#888"
          />

          <Text style={styles.label}>Start Date</Text>
          <Text style={styles.dateText}>
            {formatDate(editingEvent.start_time || null)}
          </Text>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setPickerField('start_time')}
          >
            <Text style={styles.secondaryButtonText}>
              Choose Start Date
            </Text>
          </TouchableOpacity>

          <Text style={styles.label}>End Date</Text>
          <Text style={styles.dateText}>
            {formatDate(editingEvent.end_time || null)}
          </Text>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setPickerField('end_time')}
          >
            <Text style={styles.secondaryButtonText}>
              Choose End Date
            </Text>
          </TouchableOpacity>

          {pickerField !== null && (
            <DateTimePicker
              value={
                editingEvent[pickerField] &&
                !Number.isNaN(
                  new Date(editingEvent[pickerField]).getTime(),
                )
                  ? new Date(editingEvent[pickerField])
                  : new Date()
              }
              mode="date"
              display="default"
              onChange={handleDateChange}
            />
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.saveButton,
                saving && styles.disabledButton,
              ]}
              onPress={saveEditedEvent}
              disabled={saving}
            >
              <Text style={styles.buttonText}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.cancelButton,
                saving && styles.disabledButton,
              ]}
              onPress={() => {
                setEditingEvent(null);
                setPickerField(null);
              }}
              disabled={saving}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Manage Events ({events.length})
        </Text>

        {events.length === 0 ? (
          <Text style={styles.emptyText}>No events found.</Text>
        ) : (
          <FlatList
            data={events}
            scrollEnabled={false}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.listItem}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemDetail}>
                    Code: {item.event_code}
                  </Text>
                  <Text style={styles.itemDetail}>
                    Start: {formatDate(item.start_time)}
                  </Text>
                  <Text style={styles.itemDetail}>
                    End: {formatDate(item.end_time)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => openEditEvent(item)}
                >
                  <Text style={styles.buttonText}>Edit</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Manage Users ({users.length})
        </Text>

        {users.length === 0 ? (
          <Text style={styles.emptyText}>No users found.</Text>
        ) : (
          users.map((item) => (
            <View key={item.id} style={styles.userItem}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemTitle}>
                  {item.full_name || 'Unnamed User'}
                </Text>
                <Text style={styles.itemDetail}>
                  {item.email || 'No email'}
                </Text>
              </View>

              <Text style={styles.roleBadge}>
                {item.role || 'student'}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6F8',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F6F8',
  },
  loadingText: {
    marginTop: 10,
    color: '#555',
  },
  heading: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#172B4D',
  },
  subtitle: {
    fontSize: 14,
    color: '#667085',
    marginTop: 5,
    marginBottom: 20,
  },
  successMessage: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  successMessageText: {
    color: '#166534',
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 12,
    elevation: 2,
  },
  statNumber: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#107020',
  },
  statLabel: {
    color: '#667085',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#172B4D',
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#344054',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#101828',
    backgroundColor: '#FFFFFF',
  },
  dateText: {
    fontSize: 13,
    color: '#475467',
    marginBottom: 6,
  },
  secondaryButton: {
    backgroundColor: '#E8EEF9',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#107020',
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#16A34A',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#667085',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  editButton: {
    backgroundColor: '#107020',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EAECF0',
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#101828',
  },
  itemDetail: {
    fontSize: 12,
    color: '#667085',
    marginTop: 4,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EAECF0',
  },
  roleBadge: {
    backgroundColor: '#E8EEF9',
    color: '#107020',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    color: '#667085',
    textAlign: 'center',
    paddingVertical: 16,
  },
});
