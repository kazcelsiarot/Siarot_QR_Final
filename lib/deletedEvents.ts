import { supabase } from '@/lib/supabase';

export type DeletedEvent = {
  id: string;
  event_id: string;
  event_code: string | null;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  created_by: string | null;
  original_created_at: string | null;
  venue: string | null;
  description: string | null;
  status: string | null;
  deleted_by: string | null;
  deleted_at: string;
};

export type DeletedResult = {
  error: string | null;
};

export async function getDeletedEvents(): Promise<
  DeletedEvent[]
> {
  const { data, error } = await supabase
    .from('deleted_events')
    .select('*')
    .order('deleted_at', { ascending: false });

  if (error) {
    console.error(
      'Failed to load deleted events:',
      error.message
    );
    throw new Error(error.message);
  }

  return (data ?? []) as DeletedEvent[];
}

/** Moves an event into the recycle bin, then removes it. */
export async function softDeleteEvent(
  event: {
    id: string;
    event_code: string | null;
    title: string | null;
    start_time: string | null;
    end_time: string | null;
    created_by: string | null;
    created_at: string | null;
    venue: string | null;
    description: string | null;
    status: string | null;
  },
  deletedBy: string | null
): Promise<DeletedResult> {
  const { error: insertError } = await supabase
    .from('deleted_events')
    .insert({
      event_id: event.id,
      event_code: event.event_code,
      title: event.title,
      start_time: event.start_time,
      end_time: event.end_time,
      created_by: event.created_by,
      original_created_at: event.created_at,
      venue: event.venue,
      description: event.description,
      status: event.status,
      deleted_by: deletedBy,
    });

  if (insertError) {
    return { error: insertError.message };
  }

  const { error: deleteError } = await supabase
    .from('events')
    .delete()
    .eq('id', event.id);

  if (deleteError) {
    return { error: deleteError.message };
  }

  return { error: null };
}

/** Puts a binned event back into the events table. */
export async function restoreEvent(
  deleted: DeletedEvent
): Promise<DeletedResult> {
  const { error: insertError } = await supabase
    .from('events')
    .insert({
      event_code: deleted.event_code,
      title: deleted.title,
      start_time: deleted.start_time,
      end_time: deleted.end_time,
      created_by: deleted.created_by,
      venue: deleted.venue,
      description: deleted.description,
      status: deleted.status,
    });

  if (insertError) {
    return { error: insertError.message };
  }

  const { error: removeError } = await supabase
    .from('deleted_events')
    .delete()
    .eq('id', deleted.id);

  if (removeError) {
    return { error: removeError.message };
  }

  return { error: null };
}

export async function purgeDeletedEvent(
  binId: string
): Promise<DeletedResult> {
  const { error } = await supabase
    .from('deleted_events')
    .delete()
    .eq('id', binId);

  return { error: error?.message ?? null };
}

export async function purgeAllDeletedEvents(): Promise<DeletedResult> {
  const { error } = await supabase
    .from('deleted_events')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  return { error: error?.message ?? null };
}
