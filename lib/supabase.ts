import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Supabase environment variables are not set. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
      // v20: Higher event rate for snappier cross-device sync.
      // Default 10 was conservative; 50 gives near-instant updates without
      // overwhelming the WebSocket on bulk operations.
      realtime: { params: { eventsPerSecond: 50 } },
    });
  }
  return client;
}
