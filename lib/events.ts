import { supabase } from '@/lib/supabase';

export type EventStatus =
  | 'upcoming'
  | 'ongoing'
  | 'closed';

export type Event = {
  eventId: string;
  title: string;
  start: string;
  end: string;
  venue?: string;
  description?: string;
  status?: EventStatus;
};

export type CloudEvent = {
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

export type EventActionResult = {
  error: string | null;
};

const EVENT_COLUMNS = `
  id,
  event_code,
  title,
  start_time,
  end_time,
  created_by,
  created_at,
  venue,
  description,
  status
`;

function normalizeOptionalText(value?: string) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : null;
}

function normalizeEventStatus(
  status?: EventStatus | string | null
): EventStatus {
  const normalizedStatus = status?.trim().toLowerCase();

  if (
    normalizedStatus === 'upcoming' ||
    normalizedStatus === 'ongoing' ||
    normalizedStatus === 'closed'
  ) {
    return normalizedStatus;
  }

  return 'upcoming';
}

async function getCurrentUserId(): Promise<{
  userId: string | null;
  error: string | null;
}> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return {
      userId: null,
      error: error.message,
    };
  }

  if (!user) {
    return {
      userId: null,
      error: 'You must be signed in to manage events.',
    };
  }

  return {
    userId: user.id,
    error: null,
  };
}

export async function createEvent(
  event: Event
): Promise<EventActionResult> {
  const { userId, error: userError } =
    await getCurrentUserId();

  if (!userId) {
    return {
      error:
        userError ?? 'Unable to identify the current user.',
    };
  }

  const { error } = await supabase.from('events').insert({
    event_code: event.eventId.trim().toUpperCase(),
    title: event.title.trim(),
    start_time: event.start || null,
    end_time: event.end || null,
    created_by: userId,
    venue: normalizeOptionalText(event.venue),
    description: normalizeOptionalText(event.description),
    status: normalizeEventStatus(event.status),
  });

  return {
    error: error?.message ?? null,
  };
}

export async function getAllEvents(): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to get events:', error.message);
    throw new Error(error.message);
  }

  return (data ?? []) as CloudEvent[];
}

export async function getEventsByTeacher(
  teacherId: string
): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(
      'Failed to get teacher events:',
      error.message
    );
    throw new Error(error.message);
  }

  return (data ?? []) as CloudEvent[];
}

export async function getEventByCode(
  code: string
): Promise<CloudEvent | null> {
  const normalizedCode = code.trim().toUpperCase();

  if (!normalizedCode) {
    return null;
  }

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('event_code', normalizedCode)
    .maybeSingle();

  if (error) {
    console.error('Failed to get event:', error.message);
    return null;
  }

  return data ? (data as CloudEvent) : null;
}

export async function updateEvent(
  eventDatabaseId: string,
  event: Event
): Promise<EventActionResult> {
  const { userId, error: userError } =
    await getCurrentUserId();

  if (!userId) {
    return {
      error:
        userError ?? 'Unable to identify the current user.',
    };
  }

  const { data, error } = await supabase
    .from('events')
    .update({
      event_code: event.eventId.trim().toUpperCase(),
      title: event.title.trim(),
      start_time: event.start || null,
      end_time: event.end || null,
      venue: normalizeOptionalText(event.venue),
      description: normalizeOptionalText(event.description),
      status: normalizeEventStatus(event.status),
    })
    .eq('id', eventDatabaseId)
    .eq('created_by', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: error.message,
    };
  }

  if (!data) {
    return {
      error:
        'Event not found, or you do not have permission to edit it.',
    };
  }

  return {
    error: null,
  };
}

export async function updateEventStatus(
  eventDatabaseId: string,
  status: EventStatus
): Promise<EventActionResult> {
  const { userId, error: userError } =
    await getCurrentUserId();

  if (!userId) {
    return {
      error:
        userError ?? 'Unable to identify the current user.',
    };
  }

  const { data, error } = await supabase
    .from('events')
    .update({
      status: normalizeEventStatus(status),
    })
    .eq('id', eventDatabaseId)
    .eq('created_by', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: error.message,
    };
  }

  if (!data) {
    return {
      error:
        'Event not found, or you do not have permission to change its status.',
    };
  }

  return {
    error: null,
  };
}
