import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import GradientBackground from '@/components/GradientBackground';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile, type Profile } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';
import {
  type DeletedEvent,
  getDeletedEvents,
  purgeAllDeletedEvents,
  purgeDeletedEvent,
  restoreEvent,
  softDeleteEvent,
} from '@/lib/deletedEvents';

type EventStatusValue = 'upcoming' | 'ongoing' | 'closed';
type RoleValue = 'student' | 'teacher' | 'admin';
type DateTarget = 'start' | 'end';

type EventItem = {
  id: string;
  event_code: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  created_by: string | null;
  created_at: string;
  venue: string | null;
  description: string | null;
  status: string | null;
};

type EditEventState = {
  id: string;
  title: string;
  event_code: string;
  startDate: Date;
  endDate: Date;
  venue: string;
  description: string;
};

const ROLE_OPTIONS: RoleValue[] = [
  'student',
  'teacher',
  'admin',
];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const QUICK_END_OPTIONS = [
  { label: '+30 min', milliseconds: 30 * 60 * 1000 },
  { label: '+1 hour', milliseconds: 60 * 60 * 1000 },
  { label: '+2 hours', milliseconds: 2 * 60 * 60 * 1000 },
];

/* ---------- helpers (same as the teacher tab) ---------- */

function toLocalISO(date: Date) {
  const pad = (value: number) =>
    String(value).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  );
}

function parseEventDate(value: string | null) {
  if (!value) {
    return new Date();
  }

  const parsedDate = new Date(value);

  return Number.isNaN(parsedDate.getTime())
    ? new Date()
    : parsedDate;
}

function formatDateTime(date: Date) {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;

  return `${
    MONTH_SHORT[date.getMonth()]
  } ${date.getDate()}, ${date.getFullYear()} at ${displayHour}:${minutes} ${period}`;
}

function formatStoredDateTime(value: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatDateTime(date);
}

function formatEventSchedule(
  start: string | null,
  end: string | null
) {
  const startText = start
    ? formatStoredDateTime(start)
    : 'No start time';

  const endText = end
    ? formatStoredDateTime(end)
    : 'No end time';

  return `${startText} - ${endText}`;
}

function normalizeRole(role: string | null | undefined): RoleValue {
  const value = role?.trim().toLowerCase();

  if (
    value === 'student' ||
    value === 'teacher' ||
    value === 'admin'
  ) {
    return value;
  }

  return 'student';
}

/*
 * Status shown on a card is computed from the real clock, exactly
 * as the teacher tab does it. A manually closed event stays closed.
 */
function getLiveStatus(event: {
  start_time: string | null;
  end_time: string | null;
  status: string | null;
}): EventStatusValue {
  const storedStatus = event.status?.trim().toLowerCase();

  if (storedStatus === 'closed') {
    return 'closed';
  }

  const now = Date.now();
  const start = event.start_time
    ? new Date(event.start_time).getTime()
    : null;
  const end = event.end_time
    ? new Date(event.end_time).getTime()
    : null;

  if (start !== null && now < start) {
    return 'upcoming';
  }

  if (end !== null && now > end) {
    return 'closed';
  }

  if (start !== null && end !== null) {
    if (now >= start && now <= end) {
      return 'ongoing';
    }
  }

  if (start !== null && now >= start) {
    return 'ongoing';
  }

  return 'upcoming';
}

function isLeapYear(year: number) {
  return (
    (year % 4 === 0 && year % 100 !== 0) ||
    year % 400 === 0
  );
}

function daysInMonth(year: number, month: number) {
  const monthLengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return monthLengths[month];
}

function buildCalendarDays(year: number, month: number) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const totalDays = daysInMonth(year, month);
  const cells: (number | null)[] = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(day);
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function sameCalendarDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function clampNumberText(
  text: string,
  min: number,
  max: number
): number | null {
  const digits = text.replace(/[^0-9]/g, '');

  if (!digits) {
    return null;
  }

  const parsed = Number(digits);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.min(Math.max(parsed, min), max);
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const messageTimer =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recycle bin — admin only
  const [binOpen, setBinOpen] = useState(false);
  const [binItems, setBinItems] = useState<DeletedEvent[]>([]);
  const [binLoading, setBinLoading] = useState(false);

  // Edit popup
  const [editingEvent, setEditingEvent] =
    useState<EditEventState | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(
    null
  );
  const [editMessageIsError, setEditMessageIsError] =
    useState(false);

  // Calendar / time picker
  const [pickerScope, setPickerScope] = useState<
    'edit' | null
  >(null);
  const [dateTarget, setDateTarget] =
    useState<DateTarget | null>(null);
  const [visibleMonth, setVisibleMonth] =
    useState(() => new Date());
  const [hourDraft, setHourDraft] = useState('');
  const [minuteDraft, setMinuteDraft] = useState('');

  // Role picker
  const [roleTargetId, setRoleTargetId] =
    useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimer.current) {
        clearTimeout(messageTimer.current);
      }
    };
  }, []);

  const showMessage = (text: string, isError = false) => {
    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
    }

    setMessage(text);
    setMessageIsError(isError);

    messageTimer.current = setTimeout(() => {
      setMessage(null);
      messageTimer.current = null;
    }, 3200);
  };

  const showError = (title: string, text: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}: ${text}`);
      return;
    }

    Alert.alert(title, text);
  };

  const loadDashboard = useCallback(async () => {
    if (!user) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const currentProfile = await getProfile(user.id);

      if (!currentProfile || currentProfile.role !== 'admin') {
        showError('Access Denied', 'Admin access only.');
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
      const text =
        error instanceof Error ? error.message : String(error);

      console.error('DASHBOARD LOAD ERROR:', error);
      showError('Dashboard Error', text);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, router]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const loadBin = useCallback(async () => {
    setBinLoading(true);

    try {
      const items = await getDeletedEvents();
      setBinItems(items);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);
      showError('Recycle Bin Error', text);
    } finally {
      setBinLoading(false);
    }
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();

    if (binOpen) {
      loadBin();
    }
  };

  const creatorName = (createdBy: string | null) => {
    if (!createdBy) {
      return 'Unknown teacher';
    }

    const match = users.find((item) => item.id === createdBy);

    if (!match) {
      return 'Unknown teacher';
    }

    return match.full_name || match.email || 'Unnamed teacher';
  };

  /* ---------- edit popup ---------- */

  const openEditEvent = (event: EventItem) => {
    setMessage(null);
    setEditMessage(null);
    setEditMessageIsError(false);

    setEditingEvent({
      id: event.id,
      title: event.title,
      event_code: event.event_code,
      startDate: parseEventDate(event.start_time),
      endDate: event.end_time
        ? parseEventDate(event.end_time)
        : new Date(
            parseEventDate(event.start_time).getTime() +
              60 * 60 * 1000
          ),
      venue: event.venue ?? '',
      description: event.description ?? '',
    });
  };

  const closeEditEvent = () => {
    setEditingEvent(null);
    setEditMessage(null);
    setEditMessageIsError(false);
    setPickerScope(null);
    setDateTarget(null);
  };

  const editDate = (target: DateTarget) =>
    target === 'start'
      ? editingEvent?.startDate ?? new Date()
      : editingEvent?.endDate ?? new Date();

  const setEditDate = (target: DateTarget, next: Date) => {
    setEditingEvent((current) => {
      if (!current) {
        return current;
      }

      return target === 'start'
        ? { ...current, startDate: next }
        : { ...current, endDate: next };
    });
  };

  /*
   * Same rule as the teacher tab: a start-date change moves the
   * end date to that same day and pushes the end to start + 1 hour
   * only when it would land earlier.
   */
  const applyPickedDate = (picked: Date) => {
    if (!editingEvent || !dateTarget) {
      return;
    }

    const currentStart = editingEvent.startDate;
    const currentEnd = editingEvent.endDate;

    if (dateTarget === 'start') {
      const nextStart = new Date(currentStart);
      nextStart.setFullYear(
        picked.getFullYear(),
        picked.getMonth(),
        picked.getDate()
      );

      const nextEnd = new Date(currentEnd);
      nextEnd.setFullYear(
        nextStart.getFullYear(),
        nextStart.getMonth(),
        nextStart.getDate()
      );

      if (nextEnd.getTime() <= nextStart.getTime()) {
        nextEnd.setTime(nextStart.getTime() + 60 * 60 * 1000);
      }

      setEditingEvent((current) =>
        current
          ? {
              ...current,
              startDate: nextStart,
              endDate: nextEnd,
            }
          : current
      );

      return;
    }

    const nextEnd = new Date(currentEnd);
    nextEnd.setFullYear(
      picked.getFullYear(),
      picked.getMonth(),
      picked.getDate()
    );

    if (nextEnd.getTime() <= currentStart.getTime()) {
      nextEnd.setTime(currentStart.getTime() + 60 * 60 * 1000);
    }

    setEditingEvent((current) =>
      current ? { ...current, endDate: nextEnd } : current
    );
  };

  const applyPickedTime = (hours: number, minutes: number) => {
    if (!editingEvent || !dateTarget) {
      return;
    }

    const currentStart = editingEvent.startDate;
    const currentEnd = editingEvent.endDate;

    if (dateTarget === 'start') {
      const nextStart = new Date(currentStart);
      nextStart.setHours(hours, minutes, 0, 0);

      if (
        sameCalendarDay(nextStart, currentEnd) &&
        currentEnd.getTime() <= nextStart.getTime()
      ) {
        const nextEnd = new Date(nextStart);
        nextEnd.setHours(
          nextStart.getHours() + 1,
          nextStart.getMinutes(),
          0,
          0
        );

        setEditingEvent((current) =>
          current
            ? {
                ...current,
                startDate: nextStart,
                endDate: nextEnd,
              }
            : current
        );

        return;
      }

      setEditDate('start', nextStart);
      return;
    }

    const nextEnd = new Date(currentEnd);
    nextEnd.setHours(hours, minutes, 0, 0);

    if (nextEnd.getTime() <= currentStart.getTime()) {
      const adjustedEnd = new Date(currentStart);
      adjustedEnd.setHours(
        currentStart.getHours() + 1,
        currentStart.getMinutes(),
        0,
        0
      );

      setEditDate('end', adjustedEnd);
      return;
    }

    setEditDate('end', nextEnd);
  };

  const openPicker = (target: DateTarget) => {
    setDateTarget(target);
    setPickerScope('edit');

    const current =
      target === 'start'
        ? editingEvent?.startDate ?? new Date()
        : editingEvent?.endDate ?? new Date();

    setVisibleMonth(new Date(current));

    const hour = current.getHours();

    setHourDraft(
      String(hour % 12 === 0 ? 12 : hour % 12)
    );
    setMinuteDraft(
      String(current.getMinutes()).padStart(2, '0')
    );
  };

  const closePicker = () => {
    setPickerScope(null);
    setDateTarget(null);
    setHourDraft('');
    setMinuteDraft('');
  };

  const syncDraftsFrom = (date: Date) => {
    const hour = date.getHours();

    setHourDraft(
      String(hour % 12 === 0 ? 12 : hour % 12)
    );
    setMinuteDraft(
      String(date.getMinutes()).padStart(2, '0')
    );
  };

  const commitTypedTime = (
    hourText: string,
    minuteText: string
  ) => {
    const current = editDate(dateTarget ?? 'start');
    const isPm = current.getHours() >= 12;

    const typedHour = clampNumberText(hourText, 1, 12);
    const typedMinute = clampNumberText(minuteText, 0, 59);

    if (typedHour === null && typedMinute === null) {
      return;
    }

    const resolvedHour =
      typedHour === null
        ? current.getHours()
        : isPm
          ? typedHour === 12
            ? 12
            : typedHour + 12
          : typedHour === 12
            ? 0
            : typedHour;

    applyPickedTime(
      resolvedHour,
      typedMinute === null ? current.getMinutes() : typedMinute
    );
  };

  const handleHourChange = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 2);
    setHourDraft(digits);
    commitTypedTime(digits, minuteDraft);
  };

  const handleMinuteChange = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 2);
    setMinuteDraft(digits);
    commitTypedTime(hourDraft, digits);
  };

  const handlePeriodChange = (isPm: boolean) => {
    if (!dateTarget) {
      return;
    }

    const current = editDate(dateTarget);

    if ((current.getHours() >= 12) === isPm) {
      return;
    }

    const hours = current.getHours();
    const nextHours = isPm
      ? (hours + 12) % 24
      : (hours + 24 - 12) % 24;

    applyPickedTime(nextHours, current.getMinutes());
  };

  const handleQuickEnd = (milliseconds: number) => {
    setEditingEvent((current) =>
      current
        ? {
            ...current,
            endDate: new Date(
              current.startDate.getTime() + milliseconds
            ),
          }
        : current
    );
  };

  const calendarCells = useMemo(
    () =>
      buildCalendarDays(
        visibleMonth.getFullYear(),
        visibleMonth.getMonth()
      ),
    [visibleMonth]
  );

  const pickerDate = dateTarget
    ? editDate(dateTarget)
    : new Date();

  const pickerIsPm = pickerDate.getHours() >= 12;

  /* ---------- save edit ---------- */

  const saveEditedEvent = async () => {
    if (saving || !editingEvent) {
      return;
    }

    const newTitle = editingEvent.title.trim();

    if (!newTitle) {
      setEditMessage('Event name is required.');
      setEditMessageIsError(true);
      return;
    }

    if (
      editingEvent.endDate.getTime() <=
      editingEvent.startDate.getTime()
    ) {
      setEditMessage(
        'The event end time must be after its start time.'
      );
      setEditMessageIsError(true);
      return;
    }

    setSaving(true);
    setEditMessage(null);

    try {
      const { data, error } = await supabase
        .from('events')
        .update({
          title: newTitle,
          event_code: editingEvent.event_code
            .trim()
            .toUpperCase(),
          start_time: toLocalISO(editingEvent.startDate),
          end_time: toLocalISO(editingEvent.endDate),
          venue: editingEvent.venue.trim() || null,
          description:
            editingEvent.description.trim() || null,
        })
        .eq('id', editingEvent.id)
        .select('id');

      if (error) {
        setEditMessage(error.message);
        setEditMessageIsError(true);
        return;
      }

      if (!data || data.length === 0) {
        setEditMessage(
          'No event was updated. Check the admin UPDATE policy on events.'
        );
        setEditMessageIsError(true);
        return;
      }

      closeEditEvent();
      await loadDashboard();
      showMessage('Event updated successfully.');
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);
      setEditMessage(text);
      setEditMessageIsError(true);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- close / reopen ---------- */

  const toggleEventStatus = async (event: EventItem) => {
    const live = getLiveStatus(event);
    const nextStatus = live === 'closed' ? 'upcoming' : 'closed';

    setSaving(true);

    try {
      const { error } = await supabase
        .from('events')
        .update({ status: nextStatus })
        .eq('id', event.id);

      if (error) {
        showError('Update Failed', error.message);
        return;
      }

      await loadDashboard();
      showMessage(
        live === 'closed'
          ? 'Event reopened successfully.'
          : 'Event closed successfully.'
      );
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);
      showError('Update Failed', text);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- delete to bin ---------- */

  const confirmDelete = (event: EventItem) => {
    const run = () => moveToBin(event);

    if (Platform.OS === 'web') {
      if (
        window.confirm(
          `Move "${event.title}" to the recycle bin?`
        )
      ) {
        run();
      }

      return;
    }

    Alert.alert(
      'Move to recycle bin?',
      `"${event.title}" will be hidden from teachers until you restore it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ]
    );
  };

  const moveToBin = async (event: EventItem) => {
    setSaving(true);

    try {
      const result = await softDeleteEvent(
        {
          id: event.id,
          event_code: event.event_code,
          title: event.title,
          start_time: event.start_time,
          end_time: event.end_time,
          created_by: event.created_by,
          created_at: event.created_at,
          venue: event.venue,
          description: event.description,
          status: event.status,
        },
        user?.id ?? null
      );

      if (result.error) {
        showError('Delete Failed', result.error);
        return;
      }

      await loadDashboard();
      showMessage('Event moved to the recycle bin.');

      if (binOpen) {
        await loadBin();
      }
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);
      showError('Delete Failed', text);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- recycle bin ---------- */

  const handleRestore = async (item: DeletedEvent) => {
    setSaving(true);

    try {
      const result = await restoreEvent(item);

      if (result.error) {
        showError('Restore Failed', result.error);
        return;
      }

      await loadBin();
      await loadDashboard();
      showMessage('Event restored successfully.');
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);
      showError('Restore Failed', text);
    } finally {
      setSaving(false);
    }
  };

  const handlePurge = (item: DeletedEvent) => {
    const run = async () => {
      setSaving(true);

      try {
        const result = await purgeDeletedEvent(item.id);

        if (result.error) {
          showError('Delete Failed', result.error);
          return;
        }

        await loadBin();
        showMessage('Event deleted permanently.');
      } catch (error) {
        const text =
          error instanceof Error ? error.message : String(error);
        showError('Delete Failed', text);
      } finally {
        setSaving(false);
      }
    };

    if (Platform.OS === 'web') {
      if (
        window.confirm(
          `Permanently delete "${item.title ?? 'this event'}"? This cannot be undone.`
        )
      ) {
        run();
      }

      return;
    }

    Alert.alert('Delete permanently?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  const handlePurgeAll = () => {
    const run = async () => {
      setSaving(true);

      try {
        const result = await purgeAllDeletedEvents();

        if (result.error) {
          showError('Delete Failed', result.error);
          return;
        }

        await loadBin();
        showMessage('Recycle bin emptied.');
      } catch (error) {
        const text =
          error instanceof Error ? error.message : String(error);
        showError('Delete Failed', text);
      } finally {
        setSaving(false);
      }
    };

    if (Platform.OS === 'web') {
      if (
        window.confirm(
          'Permanently delete every event in the recycle bin?'
        )
      ) {
        run();
      }

      return;
    }

    Alert.alert(
      'Empty the recycle bin?',
      'Every event in the bin is deleted permanently. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: run,
        },
      ]
    );
  };

  /* ---------- roles ---------- */

  const changeUserRole = async (
    target: Profile,
    nextRole: RoleValue
  ) => {
    if (target.id === user?.id) {
      showError('Not Allowed', 'You cannot change your own role.');
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: nextRole })
        .eq('id', target.id);

      if (error) {
        showError('Update Failed', error.message);
        return;
      }

      setRoleTargetId(null);
      await loadDashboard();
      showMessage(`Role updated to ${nextRole}.`);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);
      showError('Update Failed', text);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.lockContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.lockTitle}>
          Loading dashboard...
        </Text>
      </View>
    );
  }

  return (
    <GradientBackground>
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        <Text style={styles.pageTitle}>Admin Dashboard</Text>
        <Text style={styles.pageSubtitle}>
          Welcome, {profile?.full_name || user?.email || 'Admin'}
        </Text>

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

        {message ? (
          <View
            style={[
              styles.messageBox,
              messageIsError && styles.errorMessageBox,
            ]}
          >
            <Text
              style={[
                styles.messageText,
                messageIsError && styles.errorMessageText,
              ]}
            >
              {message}
            </Text>
          </View>
        ) : null}

        {/* ---------- recycle bin (admin only) ---------- */}
        <TouchableOpacity
          style={styles.binToggle}
          onPress={() => {
            if (binOpen) {
              setBinOpen(false);
              setRoleTargetId(null);
              return;
            }

            setBinOpen(true);
            loadBin();
          }}
          disabled={saving}
        >
          <Text style={styles.binToggleText}>
            {binOpen
              ? 'Hide Recycle Bin'
              : `Show Recycle Bin${
                  binItems.length ? ` (${binItems.length})` : ''
                }`}
          </Text>
        </TouchableOpacity>

        {binOpen && (
          <View style={styles.formCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Recycle Bin
              </Text>

              {binItems.length > 0 && (
                <TouchableOpacity
                  style={styles.purgeAllButton}
                  onPress={handlePurgeAll}
                  disabled={saving}
                >
                  <Text style={styles.dangerButtonText}>
                    Empty Bin
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.sectionSubtitle}>
              Only admins can see these events. Teachers see an
              event again only after you restore it.
            </Text>

            {binLoading ? (
              <ActivityIndicator
                size="large"
                color={COLORS.primary}
                style={styles.savingIndicator}
              />
            ) : binItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons
                  name="trash-outline"
                  size={42}
                  color={COLORS.textSecondary}
                />
                <Text style={styles.emptyTitle}>
                  The recycle bin is empty
                </Text>
                <Text style={styles.emptyText}>
                  Deleted events will appear here.
                </Text>
              </View>
            ) : (
              binItems.map((item) => (
                <View key={item.id} style={styles.eventCard}>
                  <View style={styles.eventHeader}>
                    <View style={styles.eventTitleContainer}>
                      <Text style={styles.eventTitle}>
                        {item.title || 'Untitled event'}
                      </Text>
                      <Text style={styles.eventCode}>
                        {item.event_code || 'No code'}
                      </Text>
                    </View>
                  </View>

                  <EventInformation
                    icon="person-outline"
                    text={creatorName(item.created_by)}
                  />
                  <EventInformation
                    icon="time-outline"
                    text={`Deleted ${formatStoredDateTime(
                      item.deleted_at
                    )}`}
                  />

                  <View style={styles.eventActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.editButton,
                        pressed && styles.pressed,
                        saving && styles.disabled,
                      ]}
                      onPress={() => handleRestore(item)}
                      disabled={saving}
                    >
                      <Ionicons
                        name="refresh-outline"
                        size={18}
                        color={COLORS.primary}
                      />
                      <Text style={styles.editButtonText}>
                        Restore
                      </Text>
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.deleteButton,
                        pressed && styles.pressed,
                        saving && styles.disabled,
                      ]}
                      onPress={() => handlePurge(item)}
                      disabled={saving}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={COLORS.danger}
                      />
                      <Text style={styles.deleteButtonText}>
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* ---------- manage events ---------- */}
        <View style={styles.listHeader}>
          <Text style={styles.myEventsTitle}>All Events</Text>
          <Text style={styles.eventCount}>
            {events.length}{' '}
            {events.length === 1 ? 'event' : 'events'}
          </Text>
        </View>

        {events.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons
              name="calendar-outline"
              size={42}
              color={COLORS.textSecondary}
            />
            <Text style={styles.emptyTitle}>No events yet</Text>
            <Text style={styles.emptyText}>
              Teacher events will appear here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={events}
            scrollEnabled={false}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <AdminEventCard
                event={item}
                creator={creatorName(item.created_by)}
                disabled={saving}
                onEdit={() => openEditEvent(item)}
                onToggleStatus={() => toggleEventStatus(item)}
                onDelete={() => confirmDelete(item)}
              />
            )}
          />
        )}

        {/* ---------- manage users ---------- */}
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>
            Manage Users ({users.length})
          </Text>
          <Text style={styles.sectionSubtitle}>
            Choose a role for any account except your own.
          </Text>

          {users.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No users found
              </Text>
              <Text style={styles.emptyText}>
                Accounts will appear here.
              </Text>
            </View>
          ) : (
            users.map((item) => {
              const isSelf = item.id === user?.id;
              const pickerOpen = roleTargetId === item.id;

              return (
                <View key={item.id} style={styles.userItem}>
                  <View style={styles.userRow}>
                    <View style={styles.userInfo}>
                      <Text style={styles.itemTitle}>
                        {item.full_name || 'Unnamed User'}
                        {isSelf ? ' (you)' : ''}
                      </Text>
                      <Text style={styles.itemDetail}>
                        {item.email || 'No email'}
                      </Text>
                    </View>

                    {isSelf ? (
                      <View style={styles.lockedBadge}>
                        <Text style={styles.lockedBadgeText}>
                          {normalizeRole(item.role)} · locked
                        </Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.roleBadgeButton}
                        onPress={() =>
                          setRoleTargetId(
                            pickerOpen ? null : item.id
                          )
                        }
                        disabled={saving}
                      >
                        <Text
                          style={styles.roleBadgeButtonText}
                        >
                          {normalizeRole(item.role)} ▾
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {pickerOpen && !isSelf && (
                    <View style={styles.chipRow}>
                      {ROLE_OPTIONS.map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={[
                            styles.chip,
                            normalizeRole(item.role) ===
                              option && styles.chipActive,
                          ]}
                          onPress={() =>
                            changeUserRole(item, option)
                          }
                          disabled={saving}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              normalizeRole(item.role) ===
                                option && styles.chipTextActive,
                            ]}
                          >
                            {option}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* ---------- edit popup (same as teacher tab) ---------- */}
      {editingEvent !== null && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>
                  Edit Event
                </Text>
                <Text style={styles.modalSubtitle}>
                  {editingEvent.event_code}
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.modalCloseButton,
                  pressed && styles.pressed,
                ]}
                onPress={closeEditEvent}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={COLORS.textPrimary}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.label}>Event Name</Text>
              <TextInput
                style={styles.input}
                value={editingEvent.title}
                onChangeText={(title) =>
                  setEditingEvent((current) =>
                    current ? { ...current, title } : current
                  )
                }
                placeholder="Event name"
                placeholderTextColor={COLORS.textSecondary}
                editable={!saving}
              />

              <Text style={styles.label}>Event Code</Text>
              <TextInput
                style={styles.input}
                value={editingEvent.event_code}
                onChangeText={(event_code) =>
                  setEditingEvent((current) =>
                    current ? { ...current, event_code } : current
                  )
                }
                placeholder="Event code"
                placeholderTextColor={COLORS.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!saving}
              />

              <Text style={styles.label}>Starts</Text>
              <DateTimeField
                value={editingEvent.startDate}
                onPress={() => openPicker('start')}
                disabled={saving}
              />

              <Text style={styles.label}>Ends</Text>
              <DateTimeField
                value={editingEvent.endDate}
                onPress={() => openPicker('end')}
                disabled={saving}
              />

              <Text style={styles.hint}>
                Changing the start date moves the end date to the
                same day.
              </Text>

              <View style={styles.quickEndRow}>
                {QUICK_END_OPTIONS.map((option) => (
                  <Pressable
                    key={option.label}
                    style={({ pressed }) => [
                      styles.quickEndButton,
                      pressed && styles.pressed,
                      saving && styles.disabled,
                    ]}
                    onPress={() =>
                      handleQuickEnd(option.milliseconds)
                    }
                    disabled={saving}
                  >
                    <Text style={styles.quickEndText}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Venue</Text>
              <TextInput
                style={styles.input}
                value={editingEvent.venue}
                onChangeText={(venue) =>
                  setEditingEvent((current) =>
                    current ? { ...current, venue } : current
                  )
                }
                placeholder="Venue"
                placeholderTextColor={COLORS.textSecondary}
                editable={!saving}
              />

              <Text style={styles.label}>
                Description{' '}
                <Text style={styles.optionalText}>
                  (optional)
                </Text>
              </Text>
              <TextInput
                style={[styles.input, styles.descriptionInput]}
                value={editingEvent.description}
                onChangeText={(description) =>
                  setEditingEvent((current) =>
                    current
                      ? { ...current, description }
                      : current
                  )
                }
                placeholder="Describe the event"
                placeholderTextColor={COLORS.textSecondary}
                multiline
                textAlignVertical="top"
                editable={!saving}
              />

              {editMessage ? (
                <View
                  style={[
                    styles.messageBox,
                    editMessageIsError &&
                      styles.errorMessageBox,
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      editMessageIsError &&
                        styles.errorMessageText,
                    ]}
                  >
                    {editMessage}
                  </Text>
                </View>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.modalCancelButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={closeEditEvent}
                  disabled={saving}
                >
                  <Text style={styles.modalCancelText}>
                    Close
                  </Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.modalSaveButton,
                    pressed && styles.pressed,
                    saving && styles.disabled,
                  ]}
                  onPress={saveEditedEvent}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator
                      size="small"
                      color="#FFFFFF"
                    />
                  ) : (
                    <>
                      <Ionicons
                        name="save-outline"
                        size={18}
                        color="#FFFFFF"
                      />
                      <Text style={styles.modalSaveText}>
                        Save Changes
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {/* ---------- calendar + typed time picker ---------- */}
      {pickerScope !== null && dateTarget !== null && (
        <View style={styles.modalOverlay}>
          <View style={styles.pickerCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>
                  {dateTarget === 'start'
                    ? 'Set Start'
                    : 'Set End'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {formatDateTime(pickerDate)}
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.modalCloseButton,
                  pressed && styles.pressed,
                ]}
                onPress={closePicker}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={COLORS.textPrimary}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.pickerBody}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.calendarHeader}>
                <Pressable
                  style={({ pressed }) => [
                    styles.calendarNavButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={() =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear(),
                        visibleMonth.getMonth() - 1,
                        1
                      )
                    )
                  }
                >
                  <Ionicons
                    name="chevron-back"
                    size={20}
                    color={COLORS.primary}
                  />
                </Pressable>

                <Text style={styles.calendarMonthText}>
                  {MONTH_NAMES[visibleMonth.getMonth()]}{' '}
                  {visibleMonth.getFullYear()}
                </Text>

                <Pressable
                  style={({ pressed }) => [
                    styles.calendarNavButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={() =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear(),
                        visibleMonth.getMonth() + 1,
                        1
                      )
                    )
                  }
                >
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={COLORS.primary}
                  />
                </Pressable>
              </View>

              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((label, index) => (
                  <Text
                    key={`${label}-${index}`}
                    style={styles.weekdayLabel}
                  >
                    {label}
                  </Text>
                ))}
              </View>

              <View style={styles.calendarGrid}>
                {calendarCells.map((day, index) => {
                  if (day === null) {
                    return (
                      <View
                        key={`empty-${index}`}
                        style={styles.calendarCell}
                      />
                    );
                  }

                  const cellDate = new Date(
                    visibleMonth.getFullYear(),
                    visibleMonth.getMonth(),
                    day
                  );

                  const selected = sameCalendarDay(
                    cellDate,
                    pickerDate
                  );

                  const today = sameCalendarDay(
                    cellDate,
                    new Date()
                  );

                  return (
                    <Pressable
                      key={`day-${day}`}
                      style={({ pressed }) => [
                        styles.calendarCell,
                        styles.calendarDay,
                        today && styles.calendarToday,
                        selected && styles.calendarDaySelected,
                        pressed && styles.pressed,
                      ]}
                      onPress={() =>
                        applyPickedDate(cellDate)
                      }
                    >
                      <Text
                        style={[
                          styles.calendarDayText,
                          selected &&
                            styles.calendarDayTextSelected,
                        ]}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.timeSection}>
                <Text style={styles.timeTitle}>Time</Text>

                <View style={styles.timeRow}>
                  <TextInput
                    style={styles.timeInput}
                    value={hourDraft}
                    onChangeText={handleHourChange}
                    onBlur={() => {
                      const typed = clampNumberText(
                        hourDraft,
                        1,
                        12
                      );

                      if (typed === null) {
                        syncDraftsFrom(pickerDate);
                        return;
                      }

                      setHourDraft(String(typed));
                    }}
                    placeholder="12"
                    placeholderTextColor={COLORS.textSecondary}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                  />

                  <Text style={styles.timeColon}>:</Text>

                  <TextInput
                    style={styles.timeInput}
                    value={minuteDraft}
                    onChangeText={handleMinuteChange}
                    onBlur={() => {
                      const typed = clampNumberText(
                        minuteDraft,
                        0,
                        59
                      );

                      if (typed === null) {
                        syncDraftsFrom(pickerDate);
                        return;
                      }

                      setMinuteDraft(
                        String(typed).padStart(2, '0')
                      );
                    }}
                    placeholder="00"
                    placeholderTextColor={COLORS.textSecondary}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                  />

                  <View style={styles.periodGroup}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.periodButton,
                        !pickerIsPm &&
                          styles.periodButtonActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => handlePeriodChange(false)}
                    >
                      <Text
                        style={[
                          styles.periodText,
                          !pickerIsPm &&
                            styles.periodTextActive,
                        ]}
                      >
                        AM
                      </Text>
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.periodButton,
                        pickerIsPm &&
                          styles.periodButtonActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => handlePeriodChange(true)}
                    >
                      <Text
                        style={[
                          styles.periodText,
                          pickerIsPm &&
                            styles.periodTextActive,
                        ]}
                      >
                        PM
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <Text style={styles.hint}>
                  Type the hour and minute, then choose AM or PM.
                </Text>
              </View>
            </ScrollView>

            <View style={styles.pickerFooter}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalSaveButton,
                  pressed && styles.pressed,
                ]}
                onPress={closePicker}
              >
                <Text style={styles.modalSaveText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
    </GradientBackground>
  );
}

/* ---------- event card ---------- */

type AdminEventCardProps = {
  event: EventItem;
  creator: string;
  disabled: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
};

function AdminEventCard({
  event,
  creator,
  disabled,
  onEdit,
  onToggleStatus,
  onDelete,
}: AdminEventCardProps) {
  const eventStatus = getLiveStatus(event);
  const isClosed = eventStatus === 'closed';

  return (
    <View style={styles.eventCard}>
      <View style={styles.eventHeader}>
        <View style={styles.eventTitleContainer}>
          <Text style={styles.eventTitle}>{event.title}</Text>
          <Text style={styles.eventCode}>{event.event_code}</Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            isClosed
              ? styles.closedBadge
              : eventStatus === 'ongoing'
                ? styles.ongoingBadge
                : styles.upcomingBadge,
          ]}
        >
          <Text
            style={[
              styles.statusBadgeText,
              isClosed
                ? styles.closedBadgeText
                : eventStatus === 'ongoing'
                  ? styles.ongoingBadgeText
                  : styles.upcomingBadgeText,
            ]}
          >
            {eventStatus}
          </Text>
        </View>
      </View>

      <EventInformation
        icon="person-outline"
        text={creator}
      />

      <EventInformation
        icon="calendar-outline"
        text={formatEventSchedule(
          event.start_time,
          event.end_time
        )}
      />

      <EventInformation
        icon="location-outline"
        text={event.venue || 'No venue provided'}
      />

      <EventInformation
        icon="document-text-outline"
        text={event.description || 'No description provided'}
      />

      <View style={styles.eventActions}>
        <Pressable
          style={({ pressed }) => [
            styles.editButton,
            pressed && styles.pressed,
            disabled && styles.disabled,
          ]}
          onPress={onEdit}
          disabled={disabled}
        >
          <Ionicons
            name="create-outline"
            size={18}
            color={COLORS.primary}
          />
          <Text style={styles.editButtonText}>Edit</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.toggleButton,
            isClosed
              ? styles.reopenButton
              : styles.closeEventButton,
            pressed && styles.pressed,
            disabled && styles.disabled,
          ]}
          onPress={onToggleStatus}
          disabled={disabled}
        >
          <Ionicons
            name={
              isClosed
                ? 'refresh-outline'
                : 'close-circle-outline'
            }
            size={18}
            color={isClosed ? COLORS.primary : COLORS.danger}
          />
          <Text
            style={[
              styles.toggleButtonText,
              isClosed
                ? styles.reopenButtonText
                : styles.closeEventButtonText,
            ]}
          >
            {isClosed ? 'Reopen' : 'Close'}
          </Text>
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
        onPress={onDelete}
        disabled={disabled}
      >
        <Ionicons
          name="trash-outline"
          size={18}
          color={COLORS.danger}
        />
        <Text style={styles.deleteButtonText}>Delete</Text>
      </Pressable>
    </View>
  );
}

/* ---------- shared bits ---------- */

type DateTimeFieldProps = {
  value: Date;
  onPress: () => void;
  disabled?: boolean;
};

function DateTimeField({
  value,
  onPress,
  disabled = false,
}: DateTimeFieldProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.pickerField,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Ionicons
        name="calendar-outline"
        size={20}
        color={COLORS.primary}
      />
      <Text style={styles.pickerValue}>
        {formatDateTime(value)}
      </Text>
      <Ionicons
        name="create-outline"
        size={18}
        color={COLORS.textSecondary}
      />
    </Pressable>
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
  container: { flex: 1, backgroundColor: 'transparent' },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
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
  statsRow: { flexDirection: 'row', marginBottom: 16 },
statCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 16,
    marginRight: 12,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  messageBox: {
    backgroundColor: COLORS.primary + '14',
    borderRadius: 10,
    padding: 11,
    marginBottom: 14,
  },
  errorMessageBox: { backgroundColor: COLORS.danger + '14' },
  messageText: {
    fontSize: 13,
    color: COLORS.primary,
    textAlign: 'center',
  },
  errorMessageText: { color: COLORS.danger },
  binToggle: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 16,
  },
  binToggleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
formCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 16,
    marginBottom: 20,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 3,
    marginBottom: 12,
    lineHeight: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 12,
  },
  optionalText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 10,
    lineHeight: 17,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  descriptionInput: { minHeight: 90 },
  pickerField: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerValue: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    marginHorizontal: 10,
  },
  quickEndRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  quickEndButton: {
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 4,
  },
  quickEndText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  myEventsTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: '#FED7B8',
    textShadowColor: 'rgba(58, 15, 18, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  eventCount: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(254, 215, 184, 0.9)',
    textShadowColor: 'rgba(58, 15, 18, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
  eventTitleContainer: { flex: 1, marginRight: 10 },
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
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  upcomingBadge: { backgroundColor: COLORS.primary + '14' },
  ongoingBadge: { backgroundColor: '#F59E0B20' },
  closedBadge: { backgroundColor: COLORS.danger + '14' },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  upcomingBadgeText: { color: COLORS.primary },
  ongoingBadgeText: { color: '#D97706' },
  closedBadgeText: { color: COLORS.danger },
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
  eventActions: { flexDirection: 'row', marginTop: 16 },
  editButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
    marginLeft: 5,
  },
  toggleButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  closeEventButton: { borderColor: COLORS.danger },
  reopenButton: { borderColor: COLORS.primary },
  toggleButtonText: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 5,
  },
  closeEventButtonText: { color: COLORS.danger },
  reopenButtonText: { color: COLORS.primary },
  deleteButton: {
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.danger,
    marginLeft: 5,
  },
  userItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  userRow: { flexDirection: 'row', alignItems: 'center' },
  userInfo: { flex: 1, marginRight: 10 },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  itemDetail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  roleBadgeButton: {
    backgroundColor: COLORS.primary + '14',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roleBadgeButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'capitalize',
  },
  lockedBadge: {
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  lockedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'capitalize',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  chip: {
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  chipTextActive: { color: '#FFFFFF' },
  purgeAllButton: {
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  dangerButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
emptyCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 28,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 5,
  },
  savingIndicator: { marginVertical: 18 },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  pickerCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalHeaderText: { flex: 1, marginRight: 10 },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  modalCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 22,
  },
  pickerBody: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
    alignItems: 'center',
  },
  pickerFooter: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    alignSelf: 'stretch',
  },
  modalActions: { flexDirection: 'row', marginTop: 20 },
  modalCancelButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  modalSaveButton: {
    flex: 1.4,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 6,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    alignSelf: 'stretch',
  },
  calendarNavButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarMonthText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  weekdayRow: { flexDirection: 'row', alignSelf: 'stretch' },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    paddingVertical: 6,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'stretch',
  },
  calendarCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDay: { borderRadius: 10 },
  calendarToday: {
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  calendarDaySelected: { backgroundColor: COLORS.primary },
  calendarDayText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  calendarDayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  timeSection: { alignSelf: 'stretch', marginTop: 22 },
  timeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeInput: {
    width: 62,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  timeColon: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginHorizontal: 8,
  },
  periodGroup: { flexDirection: 'row', marginLeft: 12 },
  periodButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginLeft: 8,
  },
  periodButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '14',
  },
  periodText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  periodTextActive: { color: COLORS.primary },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  lockContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  lockTitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 12,
  },
});
