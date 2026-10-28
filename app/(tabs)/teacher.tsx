import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import GradientBackground from '@/components/GradientBackground';
import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import {
  type CloudEvent,
  type EventStatus,
  createEvent,
  getEventsByTeacher,
  updateEvent,
  updateEventStatus,
} from '@/lib/events';
import { getProfile } from '@/lib/profiles';

type UserRole = 'student' | 'teacher' | 'admin';
type PickerScope = 'form' | 'edit';
type DateTarget = 'start' | 'end';

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

/* ---------- helpers ---------- */

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

function formatEventSchedule(
  start: string | null,
  end: string | null
) {
  const startText = start
    ? formatDateTime(parseEventDate(start))
    : 'No start time';

  const endText = end
    ? formatDateTime(parseEventDate(end))
    : 'No end time';

  return `${startText} - ${endText}`;
}

/*
 * Status shown on a card is computed from the real clock:
 *   before start          -> upcoming
 *   between start and end -> ongoing
 *   after end             -> closed
 * An event the teacher closed on purpose stays closed until
 * it is reopened, even if its times would say otherwise.
 */
function getLiveStatus(event: {
  start_time: string | null;
  end_time: string | null;
  status: string | null;
}): EventStatus {
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

/** Clamps typed text into a whole number inside a range. */
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

export default function TeacherScreen() {
  const { user } = useAuth();

  const [role, setRole] = useState<UserRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [events, setEvents] = useState<CloudEvent[]>([]);

  // Create form state
  const [title, setTitle] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [venue, setVenue] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(
    () => new Date(Date.now() + 60 * 60 * 1000)
  );

  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editingEvent, setEditingEvent] =
    useState<CloudEvent | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editEventCode, setEditEventCode] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStartDate, setEditStartDate] =
    useState(() => new Date());
  const [editEndDate, setEditEndDate] = useState(
    () => new Date(Date.now() + 60 * 60 * 1000)
  );
  const [editMessage, setEditMessage] =
    useState<string | null>(null);
  const [editMessageIsError, setEditMessageIsError] =
    useState(false);

  // Close / Reopen confirmation state
  const [confirmEvent, setConfirmEvent] =
    useState<CloudEvent | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Calendar picker state
  const [pickerScope, setPickerScope] =
    useState<PickerScope | null>(null);
  const [dateTarget, setDateTarget] =
    useState<DateTarget | null>(null);
  const [visibleMonth, setVisibleMonth] =
    useState(() => new Date());

  /*
   * Typed time drafts. They hold raw text so a half-typed value
   * such as "1" on its way to "13" is never rewritten mid-edit.
   */
  const [hourDraft, setHourDraft] = useState('');
  const [minuteDraft, setMinuteDraft] = useState('');

  const showMessage = (text: string, isError = false) => {
    setMessage(text);
    setMessageIsError(isError);
  };

  const showEditMessage = (text: string, isError = false) => {
    setEditMessage(text);
    setEditMessageIsError(isError);
  };

  const loadMyEvents = useCallback(
    async (teacherId?: string) => {
      const currentTeacherId = teacherId ?? user?.id;

      if (!currentTeacherId) {
        setEvents([]);
        return;
      }

      setEventsLoading(true);

      try {
        const teacherEvents =
          await getEventsByTeacher(currentTeacherId);

        setEvents(teacherEvents);
      } catch (error) {
        console.error('Failed to load teacher events:', error);
        showMessage('Unable to load your events.', true);
      } finally {
        setEventsLoading(false);
      }
    },
    [user?.id]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadScreen() {
        if (!user) {
          if (active) {
            setRole(null);
            setEvents([]);
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

          const normalizedRole =
            profile?.role?.trim().toLowerCase();

          if (normalizedRole === 'teacher') {
            setRole('teacher');
            await loadMyEvents(user.id);
          } else if (normalizedRole === 'admin') {
            setRole('admin');
            setEvents([]);
          } else {
            setRole('student');
            setEvents([]);
          }
        } catch (error) {
          console.error(
            'Failed to load teacher account:',
            error
          );

          if (active) {
            setRole('student');
            setEvents([]);
          }
        } finally {
          if (active) {
            setRoleLoading(false);
          }
        }
      }

      loadScreen();

      return () => {
        active = false;
      };
    }, [user, loadMyEvents])
  );

  const resetCreateForm = () => {
    const now = new Date();

    setTitle('');
    setEventCode('');
    setVenue('');
    setDescription('');
    setStartDate(now);
    setEndDate(new Date(now.getTime() + 60 * 60 * 1000));
    setPickerScope(null);
    setDateTarget(null);
    setMessage(null);
    setMessageIsError(false);
  };

  /* ---------- calendar / time picker ---------- */

  const getPickerDate = () => {
    if (pickerScope === 'edit') {
      return dateTarget === 'start'
        ? editStartDate
        : editEndDate;
    }

    return dateTarget === 'start' ? startDate : endDate;
  };

  const syncTimeDrafts = (date: Date) => {
    const hours = date.getHours();
    const displayHour = hours % 12 === 0 ? 12 : hours % 12;

    setHourDraft(String(displayHour));
    setMinuteDraft(
      String(date.getMinutes()).padStart(2, '0')
    );
  };

  const openPicker = (
    scope: PickerScope,
    target: DateTarget
  ) => {
    setPickerScope(scope);
    setDateTarget(target);

    const current =
      scope === 'edit'
        ? target === 'start'
          ? editStartDate
          : editEndDate
        : target === 'start'
          ? startDate
          : endDate;

    setVisibleMonth(new Date(current));
    syncTimeDrafts(current);
  };

  const closePicker = () => {
    setPickerScope(null);
    setDateTarget(null);
    setHourDraft('');
    setMinuteDraft('');
  };

  const setDateChange = (newDate: Date) => {
    const isEdit = pickerScope === 'edit';

    const currentStart = isEdit ? editStartDate : startDate;
    const currentEnd = isEdit ? editEndDate : endDate;

    if (dateTarget === 'start') {
      const nextStart = new Date(currentStart);
      nextStart.setFullYear(
        newDate.getFullYear(),
        newDate.getMonth(),
        newDate.getDate()
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

      if (isEdit) {
        setEditStartDate(nextStart);
        setEditEndDate(nextEnd);
      } else {
        setStartDate(nextStart);
        setEndDate(nextEnd);
      }

      return;
    }

    const nextEnd = new Date(currentEnd);
    nextEnd.setFullYear(
      newDate.getFullYear(),
      newDate.getMonth(),
      newDate.getDate()
    );

    if (nextEnd.getTime() <= currentStart.getTime()) {
      nextEnd.setTime(currentStart.getTime() + 60 * 60 * 1000);
    }

    if (isEdit) {
      setEditEndDate(nextEnd);
    } else {
      setEndDate(nextEnd);
    }
  };

  const applyTime = (hours: number, minutes: number) => {
    const isEdit = pickerScope === 'edit';
    const current = getPickerDate();

    const nextDate = new Date(current);
    nextDate.setHours(hours, minutes, 0, 0);

    if (dateTarget === 'start') {
      const currentEnd = isEdit ? editEndDate : endDate;

      if (
        sameCalendarDay(nextDate, currentEnd) &&
        currentEnd.getTime() <= nextDate.getTime()
      ) {
        const adjustedEnd = new Date(nextDate);
        adjustedEnd.setHours(
          nextDate.getHours() + 1,
          nextDate.getMinutes(),
          0,
          0
        );

        if (isEdit) {
          setEditStartDate(nextDate);
          setEditEndDate(adjustedEnd);
        } else {
          setStartDate(nextDate);
          setEndDate(adjustedEnd);
        }

        return;
      }

      if (isEdit) {
        setEditStartDate(nextDate);
      } else {
        setStartDate(nextDate);
      }

      return;
    }

    const currentStart = isEdit ? editStartDate : startDate;

    if (nextDate.getTime() <= currentStart.getTime()) {
      const adjustedEnd = new Date(currentStart);
      adjustedEnd.setHours(
        currentStart.getHours() + 1,
        currentStart.getMinutes(),
        0,
        0
      );

      if (isEdit) {
        setEditEndDate(adjustedEnd);
      } else {
        setEndDate(adjustedEnd);
      }

      return;
    }

    if (isEdit) {
      setEditEndDate(nextDate);
    } else {
      setEndDate(nextDate);
    }
  };

  /** Applies the hour and minute text currently typed. */
  const commitTypedTime = (
    hourText: string,
    minuteText: string
  ) => {
    const current = getPickerDate();
    const isPm = current.getHours() >= 12;

    const typedHour = clampNumberText(hourText, 1, 12);
    const typedMinute = clampNumberText(minuteText, 0, 59);

    const hourOnTwelve = typedHour ?? null;
    const minute = typedMinute ?? null;

    if (hourOnTwelve === null && minute === null) {
      return;
    }

    const resolvedHour =
      hourOnTwelve === null
        ? current.getHours()
        : isPm
          ? (hourOnTwelve === 12 ? 12 : hourOnTwelve + 12)
          : hourOnTwelve === 12
            ? 0
            : hourOnTwelve;

    const resolvedMinute =
      minute === null ? current.getMinutes() : minute;

    applyTime(resolvedHour, resolvedMinute);
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

  const handleHourBlur = () => {
    const typed = clampNumberText(hourDraft, 1, 12);

    if (typed === null) {
      const current = getPickerDate();
      const displayHour =
        current.getHours() % 12 === 0
          ? 12
          : current.getHours() % 12;

      setHourDraft(String(displayHour));
      return;
    }

    setHourDraft(String(typed));
  };

  const handleMinuteBlur = () => {
    const typed = clampNumberText(minuteDraft, 0, 59);

    if (typed === null) {
      setMinuteDraft(
        String(getPickerDate().getMinutes()).padStart(2, '0')
      );
      return;
    }

    setMinuteDraft(String(typed).padStart(2, '0'));
  };

  const handlePeriodChange = (isPm: boolean) => {
    const current = getPickerDate();
    const currentIsPm = current.getHours() >= 12;

    if (currentIsPm === isPm) {
      return;
    }

    const hours = current.getHours();
    const nextHours = isPm
      ? (hours + 12) % 24
      : (hours + 24 - 12) % 24;

    applyTime(nextHours, current.getMinutes());
  };

  const handleQuickEnd = (
    milliseconds: number,
    scope: PickerScope
  ) => {
    if (scope === 'edit') {
      setEditEndDate(
        new Date(editStartDate.getTime() + milliseconds)
      );
      return;
    }

    setEndDate(new Date(startDate.getTime() + milliseconds));
  };

  const calendarCells = useMemo(
    () =>
      buildCalendarDays(
        visibleMonth.getFullYear(),
        visibleMonth.getMonth()
      ),
    [visibleMonth]
  );

  const pickerDate = pickerScope && dateTarget
    ? getPickerDate()
    : new Date();

  const pickerIsPm = pickerDate.getHours() >= 12;

  /* ---------- create event ---------- */

  const handleCreateEvent = async () => {
    if (!user) {
      return;
    }

    if (
      !title.trim() ||
      !eventCode.trim() ||
      !venue.trim()
    ) {
      showMessage(
        'Event name, code, and venue are required.',
        true
      );
      return;
    }

    if (endDate.getTime() <= startDate.getTime()) {
      showMessage(
        'The event end time must be after its start time.',
        true
      );
      return;
    }

    setSaving(true);
    setMessage(null);

    const eventInput = {
      eventId: eventCode.trim().toUpperCase(),
      title: title.trim(),
      start: toLocalISO(startDate),
      end: toLocalISO(endDate),
      venue: venue.trim(),
      description: description.trim(),
      status: 'upcoming' as EventStatus,
    };

    try {
      const result = await createEvent(eventInput);

      if (result.error) {
        showMessage(result.error, true);
        return;
      }

      await loadMyEvents(user.id);
      resetCreateForm();
      showMessage('Event created successfully.');
    } catch (error) {
      console.error('Failed to create event:', error);
      showMessage('Unable to create the event.', true);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- edit event ---------- */

  const openEditModal = (event: CloudEvent) => {
    const eventStart = parseEventDate(event.start_time);
    const eventEnd = event.end_time
      ? parseEventDate(event.end_time)
      : new Date(eventStart.getTime() + 60 * 60 * 1000);

    setEditingEvent(event);
    setEditTitle(event.title);
    setEditEventCode(event.event_code);
    setEditVenue(event.venue ?? '');
    setEditDescription(event.description ?? '');
    setEditStartDate(eventStart);
    setEditEndDate(eventEnd);
    setEditMessage(null);
    setEditMessageIsError(false);
    closePicker();
    setEditVisible(true);
  };

  const closeEditModal = () => {
    setEditVisible(false);
    setEditingEvent(null);
    setEditMessage(null);
    setEditMessageIsError(false);
    closePicker();
  };

  const handleSaveEdit = async () => {
    if (!editingEvent) {
      return;
    }

    if (editEndDate.getTime() <= editStartDate.getTime()) {
      showEditMessage(
        'The event end time must be after its start time.',
        true
      );
      return;
    }

    setSaving(true);
    setEditMessage(null);

    /*
     * Editing never writes a status. The stored value is carried
     * over so an event closed on purpose stays closed.
     */
    const eventInput = {
      eventId: editEventCode.trim().toUpperCase(),
      title: editTitle.trim(),
      start: toLocalISO(editStartDate),
      end: toLocalISO(editEndDate),
      venue: editVenue.trim(),
      description: editDescription.trim(),
      status:
        (editingEvent.status?.trim().toLowerCase() as
          | EventStatus
          | undefined) ?? 'upcoming',
    };

    try {
      const result = await updateEvent(
        editingEvent.id,
        eventInput
      );

      if (result.error) {
        showEditMessage(result.error, true);
        return;
      }

      await loadMyEvents();
      closeEditModal();
      showMessage('Event updated successfully.');
    } catch (error) {
      console.error('Failed to update event:', error);
      showEditMessage('Unable to update the event.', true);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- close / reopen ---------- */

  const openConfirm = (event: CloudEvent) => {
    setConfirmEvent(event);
    setConfirmVisible(true);
  };

  const closeConfirm = () => {
    if (confirmLoading) {
      return;
    }

    setConfirmVisible(false);
    setConfirmEvent(null);
  };

  const handleConfirmToggleStatus = async () => {
    if (!confirmEvent) {
      return;
    }

    const currentlyClosed =
      getLiveStatus(confirmEvent) === 'closed';
    const nextStatus: EventStatus = currentlyClosed
      ? 'upcoming'
      : 'closed';

    setConfirmLoading(true);

    try {
      const result = await updateEventStatus(
        confirmEvent.id,
        nextStatus
      );

      if (result.error) {
        setConfirmVisible(false);
        setConfirmEvent(null);
        showMessage(result.error, true);
        return;
      }

      await loadMyEvents();
      setConfirmVisible(false);
      setConfirmEvent(null);
      showMessage(
        currentlyClosed
          ? 'Event reopened successfully.'
          : 'Event closed successfully.'
      );
    } catch (error) {
      console.error(
        'Failed to update event status:',
        error
      );
      setConfirmVisible(false);
      setConfirmEvent(null);
      showMessage(
        'Unable to update the event status.',
        true
      );
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMyEvents();
    setRefreshing(false);
  };

  if (roleLoading) {
    return (
      <View style={styles.lockContainer}>
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
        />
        <Text style={styles.lockTitle}>
          Checking your account...
        </Text>
      </View>
    );
  }

  if (role !== 'teacher') {
    return (
      <View style={styles.lockContainer}>
        <Ionicons
          name="lock-closed-outline"
          size={48}
          color={COLORS.primary}
        />
        <Text style={styles.lockTitle}>Teachers Only</Text>
        <Text style={styles.lockMessage}>
          Only teacher accounts can create and manage events.
        </Text>
      </View>
    );
  }

  const confirmIsClosed = confirmEvent
    ? getLiveStatus(confirmEvent) === 'closed'
    : false;

  const pickerIsOpen =
    pickerScope !== null && dateTarget !== null;

  return (
    <GradientBackground>
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        <Text style={styles.pageTitle}>Teacher Events</Text>
        <Text style={styles.pageSubtitle}>
          Create events and manage events created by your
          account.
        </Text>

        {/* ---------- Create Event ---------- */}
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>
            Create Event
          </Text>
          <Text style={styles.sectionSubtitle}>
            Enter the event information below.
          </Text>

          <Text style={styles.label}>Event Name</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Founders Day Assembly"
            placeholderTextColor={COLORS.textSecondary}
            editable={!saving}
          />

          <Text style={styles.label}>Event Code</Text>
          <TextInput
            style={styles.input}
            value={eventCode}
            onChangeText={setEventCode}
            placeholder="e.g. EVT-2026-0002"
            placeholderTextColor={COLORS.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!saving}
          />

          <Text style={styles.label}>Starts</Text>
          <DateTimeField
            value={startDate}
            onPress={() => openPicker('form', 'start')}
            disabled={saving}
          />

          <Text style={styles.label}>Ends</Text>
          <DateTimeField
            value={endDate}
            onPress={() => openPicker('form', 'end')}
            disabled={saving}
          />

          <Text style={styles.hint}>
            Changing the start date moves the end date to the
            same day. Status is set automatically from the
            start and end times.
          </Text>

          <QuickEndRow
            onSelect={(milliseconds) =>
              handleQuickEnd(milliseconds, 'form')
            }
            disabled={saving}
          />

          <Text style={styles.label}>Venue</Text>
          <TextInput
            style={styles.input}
            value={venue}
            onChangeText={setVenue}
            placeholder="e.g. Main Auditorium"
            placeholderTextColor={COLORS.textSecondary}
            editable={!saving}
          />

          <Text style={styles.label}>
            Description{' '}
            <Text style={styles.optionalText}>(optional)</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.descriptionInput]}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the event"
            placeholderTextColor={COLORS.textSecondary}
            multiline
            textAlignVertical="top"
            editable={!saving}
          />

          {message && !editVisible ? (
            <View
              style={[
                styles.messageBox,
                messageIsError && styles.errorMessageBox,
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  messageIsError &&
                    styles.errorMessageText,
                ]}
              >
                {message}
              </Text>
            </View>
          ) : null}

          {saving ? (
            <ActivityIndicator
              size="large"
              color={COLORS.primary}
              style={styles.savingIndicator}
            />
          ) : (
            <AppButton
              theme="primary"
              title="Create Event"
              icon="add-circle-outline"
              onPress={handleCreateEvent}
            />
          )}
        </View>

        {/* ---------- My Events ---------- */}
        <View style={styles.listHeader}>
          <Text style={styles.myEventsTitle}>My Events</Text>
          <Text style={styles.eventCount}>
            {events.length}{' '}
            {events.length === 1 ? 'event' : 'events'}
          </Text>
        </View>

        {eventsLoading ? (
          <View style={styles.loadingEvents}>
            <ActivityIndicator
              size="large"
              color={COLORS.primary}
            />
            <Text style={styles.loadingText}>
              Loading your events...
            </Text>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons
              name="calendar-outline"
              size={42}
              color={COLORS.textSecondary}
            />
            <Text style={styles.emptyTitle}>
              No events created
            </Text>
            <Text style={styles.emptyText}>
              Events you create will appear here.
            </Text>
          </View>
        ) : (
          events.map((event) => (
            <MyEventCard
              key={event.id}
              event={event}
              disabled={saving}
              onEdit={() => openEditModal(event)}
              onToggleStatus={() => openConfirm(event)}
            />
          ))
        )}
      </ScrollView>

      {/* ---------- Edit popup ---------- */}
      <Modal
        visible={editVisible}
        animationType="fade"
        transparent
        onRequestClose={closeEditModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>
                  Edit Event
                </Text>
                <Text style={styles.modalSubtitle}>
                  {editingEvent?.event_code ?? ''}
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.modalCloseButton,
                  pressed && styles.pressed,
                ]}
                onPress={closeEditModal}
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
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Event name"
                placeholderTextColor={COLORS.textSecondary}
                editable={!saving}
              />

              <Text style={styles.label}>Event Code</Text>
              <TextInput
                style={styles.input}
                value={editEventCode}
                onChangeText={setEditEventCode}
                placeholder="Event code"
                placeholderTextColor={COLORS.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!saving}
              />

              <Text style={styles.label}>Starts</Text>
              <DateTimeField
                value={editStartDate}
                onPress={() => openPicker('edit', 'start')}
                disabled={saving}
              />

              <Text style={styles.label}>Ends</Text>
              <DateTimeField
                value={editEndDate}
                onPress={() => openPicker('edit', 'end')}
                disabled={saving}
              />

              <Text style={styles.hint}>
                Changing the start date moves the end date to
                the same day.
              </Text>

              <QuickEndRow
                onSelect={(milliseconds) =>
                  handleQuickEnd(milliseconds, 'edit')
                }
                disabled={saving}
              />

              <Text style={styles.label}>Venue</Text>
              <TextInput
                style={styles.input}
                value={editVenue}
                onChangeText={setEditVenue}
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
                value={editDescription}
                onChangeText={setEditDescription}
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
                  onPress={closeEditModal}
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
                  onPress={handleSaveEdit}
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
      </Modal>

      {/* ---------- Close / Reopen confirmation ---------- */}
      <Modal
        visible={confirmVisible}
        animationType="fade"
        transparent
        onRequestClose={closeConfirm}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <View
              style={[
                styles.confirmIconCircle,
                confirmIsClosed
                  ? styles.confirmIconOpen
                  : styles.confirmIconClosed,
              ]}
            >
              <Ionicons
                name={
                  confirmIsClosed
                    ? 'refresh-outline'
                    : 'close-circle-outline'
                }
                size={28}
                color={
                  confirmIsClosed
                    ? COLORS.primary
                    : COLORS.danger
                }
              />
            </View>

            <Text style={styles.confirmTitle}>
              {confirmIsClosed
                ? 'Reopen this event?'
                : 'Close this event?'}
            </Text>

            <Text style={styles.confirmMessage}>
              {confirmIsClosed
                ? `"${confirmEvent?.title ?? ''}" will accept attendance again.`
                : `"${confirmEvent?.title ?? ''}" will no longer accept attendance.`}
            </Text>

            <View style={styles.confirmActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmCancelButton,
                  pressed && styles.pressed,
                ]}
                onPress={closeConfirm}
                disabled={confirmLoading}
              >
                <Text style={styles.confirmCancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.confirmActionButton,
                  confirmIsClosed
                    ? styles.confirmReopenButton
                    : styles.confirmCloseButton,
                  pressed && styles.pressed,
                  confirmLoading && styles.disabled,
                ]}
                onPress={handleConfirmToggleStatus}
                disabled={confirmLoading}
              >
                {confirmLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={
                      confirmIsClosed
                        ? COLORS.primary
                        : '#FFFFFF'
                    }
                  />
                ) : (
                  <Text
                    style={[
                      styles.confirmActionText,
                      confirmIsClosed
                        ? styles.confirmReopenText
                        : styles.confirmCloseText,
                    ]}
                  >
                    {confirmIsClosed ? 'Reopen' : 'Close'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---------- Calendar + typed time picker ---------- */}
      <Modal
        visible={pickerIsOpen}
        animationType="fade"
        transparent
        onRequestClose={closePicker}
      >
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
              {/* Calendar */}
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
                      onPress={() => setDateChange(cellDate)}
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

              {/* Time */}
              <View style={styles.timeSection}>
                <Text style={styles.timeTitle}>Time</Text>

                <View style={styles.timeRow}>
                  <TextInput
                    style={styles.timeInput}
                    value={hourDraft}
                    onChangeText={handleHourChange}
                    onBlur={handleHourBlur}
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
                    onBlur={handleMinuteBlur}
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

                <Text style={styles.timeHelp}>
                  Type the hour and minute, then choose AM or PM.
                </Text>
              </View>
            </ScrollView>

            <View style={styles.pickerFooter}>
              <AppButton
                theme="primary"
                title="Done"
                icon="checkmark-outline"
                onPress={closePicker}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
    </GradientBackground>
  );
}

/* ---------- shared components ---------- */

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

type QuickEndRowProps = {
  onSelect: (milliseconds: number) => void;
  disabled?: boolean;
};

function QuickEndRow({
  onSelect,
  disabled = false,
}: QuickEndRowProps) {
  const options = [
    { label: '+30 min', milliseconds: 30 * 60 * 1000 },
    { label: '+1 hour', milliseconds: 60 * 60 * 1000 },
    { label: '+2 hours', milliseconds: 2 * 60 * 60 * 1000 },
  ];

  return (
    <View style={styles.quickEndRow}>
      {options.map((option) => (
        <Pressable
          key={option.label}
          style={({ pressed }) => [
            styles.quickEndButton,
            pressed && styles.pressed,
            disabled && styles.disabled,
          ]}
          onPress={() => onSelect(option.milliseconds)}
          disabled={disabled}
        >
          <Text style={styles.quickEndText}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

type MyEventCardProps = {
  event: CloudEvent;
  disabled: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
};

function MyEventCard({
  event,
  disabled,
  onEdit,
  onToggleStatus,
}: MyEventCardProps) {
  const eventStatus = getLiveStatus(event);
  const isClosed = eventStatus === 'closed';

  return (
    <View style={styles.eventCard}>
      <View style={styles.eventHeader}>
        <View style={styles.eventTitleContainer}>
          <Text style={styles.eventTitle}>
            {event.title}
          </Text>
          <Text style={styles.eventCode}>
            {event.event_code}
          </Text>
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
        text={
          event.description || 'No description provided'
        }
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
            color={
              isClosed ? COLORS.primary : COLORS.danger
            }
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
    </View>
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
  },

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

  formCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 28,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },

  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 3,
    marginBottom: 8,
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

  descriptionInput: {
    minHeight: 90,
  },

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

  messageBox: {
    backgroundColor: COLORS.primary + '14',
    borderRadius: 10,
    padding: 11,
    marginTop: 16,
  },

  errorMessageBox: {
    backgroundColor: COLORS.danger + '14',
  },

  messageText: {
    fontSize: 13,
    color: COLORS.primary,
    textAlign: 'center',
  },

  errorMessageText: {
    color: COLORS.danger,
  },

  savingIndicator: {
    marginVertical: 18,
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

  loadingEvents: {
    alignItems: 'center',
    paddingVertical: 40,
  },

  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 10,
  },

  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
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

  eventCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 14,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
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

  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  upcomingBadge: {
    backgroundColor: COLORS.primary + '14',
  },

  ongoingBadge: {
    backgroundColor: '#F59E0B20',
  },

  closedBadge: {
    backgroundColor: COLORS.danger + '14',
  },

  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },

  upcomingBadgeText: {
    color: COLORS.primary,
  },

  ongoingBadgeText: {
    color: '#D97706',
  },

  closedBadgeText: {
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

  eventActions: {
    flexDirection: 'row',
    marginTop: 16,
  },

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

  closeEventButton: {
    borderColor: COLORS.danger,
  },

  reopenButton: {
    borderColor: COLORS.primary,
  },

  toggleButtonText: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 5,
  },

  closeEventButtonText: {
    color: COLORS.danger,
  },

  reopenButtonText: {
    color: COLORS.primary,
  },

  modalOverlay: {
    flex: 1,
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

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  modalHeaderText: {
    flex: 1,
    marginRight: 10,
  },

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

  modalActions: {
    flexDirection: 'row',
    marginTop: 20,
  },

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

  confirmCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },

  confirmIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },

  confirmIconOpen: {
    backgroundColor: COLORS.primary + '14',
  },

  confirmIconClosed: {
    backgroundColor: COLORS.danger + '14',
  },

  confirmTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },

  confirmMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
  },

  confirmActions: {
    flexDirection: 'row',
    marginTop: 22,
    width: '100%',
  },

  confirmCancelButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },

  confirmCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },

  confirmActionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  confirmCloseButton: {
    backgroundColor: COLORS.danger,
  },

  confirmReopenButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '14',
  },

  confirmActionText: {
    fontSize: 15,
    fontWeight: '700',
  },

  confirmCloseText: {
    color: '#FFFFFF',
  },

  confirmReopenText: {
    color: COLORS.primary,
  },

  pickerCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    maxHeight: '90%',
    overflow: 'hidden',
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

  weekdayRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },

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

  calendarDay: {
    borderRadius: 10,
  },

  calendarToday: {
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  calendarDaySelected: {
    backgroundColor: COLORS.primary,
  },

  calendarDayText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },

  calendarDayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  timeSection: {
    alignSelf: 'stretch',
    marginTop: 22,
  },

  timeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 10,
  },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

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

  periodGroup: {
    flexDirection: 'row',
    marginLeft: 12,
  },

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

  periodTextActive: {
    color: COLORS.primary,
  },

  timeHelp: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 8,
    lineHeight: 17,
  },

  pressed: {
    opacity: 0.7,
  },

  disabled: {
    opacity: 0.4,
  },

  lockContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  lockTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 12,
  },

  lockMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
  },
});
