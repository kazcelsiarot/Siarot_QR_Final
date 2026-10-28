import { supabase } from './supabase';
import { parseQRPayload } from './qr';
import { getEventByCode } from './events';

export type AttendanceRecord = {
  id: string;
  eventId: string;
  eventTitle: string;
  scannedAt: string;
  endTime: string | null;
};

export type RegisterResult = {
  success: boolean;
  message: string;
  eventTitle?: string;
};

export async function registerAttendance(
  rawPayload: string,
  studentId: string
): Promise<RegisterResult> {
  const parsed = parseQRPayload(rawPayload);

  if (!parsed.ok) {
    return {
      success: false,
      message: parsed.message,
    };
  }

  const payload = parsed.payload;

  const now = Date.now();

  const start = payload.start
    ? new Date(payload.start).getTime()
    : null;

  const end = payload.end
    ? new Date(payload.end).getTime()
    : null;

  if (start && now < start) {
    return {
      success: false,
      message: 'Event has not started yet.',
    };
  }

  if (end && now > end) {
    return {
      success: false,
      message: 'Event has already ended.',
    };
  }

  const title = payload.title ?? payload.event;

  let event: { id: string; title: string } | null = null;

  const foundEvent = await getEventByCode(payload.event);

  if (foundEvent) {
    event = foundEvent;
  } else {
    const {
      data: newEvent,
      error: insertError,
    } = await supabase
      .from('events')
      .insert([
        {
          event_code: payload.event,
          title,
          start_time: payload.start ?? null,
          end_time: payload.end ?? null,
        },
      ])
      .select('id, title')
      .single();

    if (insertError) {
      return {
        success: false,
        message: 'Could not create event.',
      };
    }

    event = newEvent;
  }

  const { error: attError } = await supabase
    .from('attendance')
    .insert([
      {
        student_id: studentId,
        event_id: event.id,
      },
    ]);

  if (attError) {
    if (attError.code === '23505') {
      return {
        success: false,
        message: 'Already registered for this event.',
        eventTitle: event.title,
      };
    }

    return {
      success: false,
      message: attError.message,
    };
  }

  return {
    success: true,
    message: 'Attendance recorded!',
    eventTitle: event.title,
  };
}

export type AttendanceAttendee = {
  studentId: string;
  studentName: string;
  scannedAt: string;
};

export type TeacherEventAttendance = {
  eventId: string;
  eventCode: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  teacherName?: string;
  attendeeCount: number;
  attendees: AttendanceAttendee[];
};

export type TeacherEventSummary = {
  eventId: string;
  eventCode: string;
  title: string;
  attendeeCount: number;
};

type RawEventRow = {
  id: string;
  event_code: string | null;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  created_by: string | null;
};

type RawAttendanceRow = {
  student_id: string | null;
  scanned_at: string | null;
  event_id: string | null;
};

type RawProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

/** Resolves names for a set of profile ids, keyed by id. */
async function loadProfileNames(
  ids: string[]
): Promise<Record<string, string>> {
  const uniqueIds = Array.from(
    new Set(ids.filter((id) => Boolean(id)))
  );

  if (uniqueIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', uniqueIds);

  if (error || !data) {
    console.error(
      'Failed to load profile names:',
      error?.message
    );
    return {};
  }

  const names: Record<string, string> = {};

  (data as RawProfileRow[]).forEach((row) => {
    names[row.id] = row.full_name || row.email || 'Unnamed user';
  });

  return names;
}

/**
 * Builds the per-event attendance view. When teacherId is null it
 * covers every teacher's events, which is what an admin sees.
 */
async function buildEventAttendance(
  teacherId: string | null
): Promise<TeacherEventAttendance[]> {
  let eventQuery = supabase
    .from('events')
    .select(
      'id, event_code, title, start_time, end_time, created_by'
    )
    .order('created_at', { ascending: false });

  if (teacherId) {
    eventQuery = eventQuery.eq('created_by', teacherId);
  }

  const { data: events, error: eventError } = await eventQuery;

  if (eventError || !events) {
    console.error(
      'Failed to load events:',
      eventError?.message
    );
    return [];
  }

  const eventRows = events as RawEventRow[];
  const eventIds = eventRows.map((row) => row.id);

  if (eventIds.length === 0) {
    return [];
  }

  const { data: attendance, error: attError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, event_id')
    .in('event_id', eventIds)
    .order('scanned_at', { ascending: false });

  if (attError || !attendance) {
    console.error(
      'Failed to load attendance:',
      attError?.message
    );
    return [];
  }

  const attendanceRows = attendance as RawAttendanceRow[];

  /* One profiles lookup covers both attendee names and teachers. */
  const names = await loadProfileNames([
    ...attendanceRows.map((row) => row.student_id ?? ''),
    ...eventRows.map((row) => row.created_by ?? ''),
  ]);

  return eventRows.map((eventRow) => {
    const rows = attendanceRows.filter(
      (row) => row.event_id === eventRow.id
    );

    return {
      eventId: eventRow.id,
      eventCode: eventRow.event_code ?? '',
      title: eventRow.title ?? 'Untitled event',
      startTime: eventRow.start_time,
      endTime: eventRow.end_time,
      teacherName: eventRow.created_by
        ? names[eventRow.created_by] ?? 'Unknown teacher'
        : 'Unknown teacher',
      attendeeCount: rows.length,
      attendees: rows.map((row) => ({
        studentId: row.student_id ?? '',
        studentName: row.student_id
          ? names[row.student_id] ?? 'Unnamed student'
          : 'Unnamed student',
        scannedAt: row.scanned_at ?? '',
      })),
    };
  });
}

/** Every event the signed-in teacher created. */
export async function getTeacherEventAttendance(
  teacherId: string
): Promise<TeacherEventAttendance[]> {
  return buildEventAttendance(teacherId);
}

/** Every event from every teacher, for the admin view. */
export async function getAllEventAttendance(): Promise<
  TeacherEventAttendance[]
> {
  return buildEventAttendance(null);
}

export async function getTeacherEventSummary(
  teacherId: string
): Promise<TeacherEventSummary[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (eventError || !events) return [];

  const eventIds = events.map((e: any) => e.id);

  if (eventIds.length === 0) return [];

  const { data: attRows, error: attError } = await supabase
    .from('attendance')
    .select('event_id')
    .in('event_id', eventIds);

  if (attError || !attRows) return [];

  const counts: Record<string, number> = {};

  attRows.forEach((r: any) => {
    counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
  });

  return events.map((e: any) => ({
    eventId: e.id,
    eventCode: e.event_code,
    title: e.title,
    attendeeCount: counts[e.id] ?? 0,
  }));
}

export async function getAttendanceHistory(
  studentId: string
): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select(
      'id, scanned_at, events ( event_code, title, end_time )'
    )
    .eq('student_id', studentId)
    .order('scanned_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    eventId: row.events?.event_code ?? '',
    eventTitle: row.events?.title ?? '',
    scannedAt: row.scanned_at,
    endTime: row.events?.end_time ?? null,
  }));
}
