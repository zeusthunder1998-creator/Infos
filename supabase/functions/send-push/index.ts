// Supabase Edge Function: send-push
//
// Triggered by a database webhook on insert/update to notices, backend_entries,
// game_entries, idpass_entries. Reads push_subscriptions and delivers a
// notification to each subscribed device that should receive it.
//
// Required environment variables (set in Supabase Dashboard → Edge Functions → Settings):
//   VAPID_PRIVATE_KEY  — your VAPID private key (NOT the NEXT_PUBLIC_ one)
//   VAPID_PUBLIC_KEY   — your VAPID public key (same as NEXT_PUBLIC_VAPID_PUBLIC_KEY)
//   VAPID_SUBJECT      — a mailto: URL or your domain (e.g. mailto:zeus@example.com)
//
// To deploy:
//   supabase functions deploy send-push --project-ref <your-project-ref>
//
// To trigger via DB webhook:
//   Supabase Dashboard → Database → Webhooks → New webhook
//   - Table: notices (and create one each for backend_entries, game_entries, idpass_entries)
//   - Events: Insert, Update
//   - Type: HTTP Request → Supabase Edge Functions
//   - Function: send-push
//
// The webhook payload Supabase sends looks like:
//   { type: 'INSERT', table: 'notices', record: {...}, schema: 'public' }
//
// We use this to determine the right notification text + recipients.

// @ts-ignore — Deno runtime
import webpush from "npm:web-push@3.6.7";

// CORS headers for the function (only POST is real, others are for OPTIONS)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // @ts-ignore
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    // @ts-ignore
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    // @ts-ignore
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    // @ts-ignore
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    // @ts-ignore
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response("VAPID keys not configured", { status: 500, headers: corsHeaders });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response("Supabase env not configured", { status: 500, headers: corsHeaders });
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const payload = await req.json();
    const table: string = payload.table || "";
    const eventType: string = payload.type || "";
    const record: any = payload.record || {};
    const oldRecord: any = payload.old_record || null;

    // Skip if this is a soft-delete (deleted_at went from null to non-null)
    // We don't want to notify on deletion.
    if (record.deleted_at && !oldRecord?.deleted_at) {
      return new Response(JSON.stringify({ skipped: "soft delete" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Skip if soft-deleted item is being updated
    if (record.deleted_at) {
      return new Response(JSON.stringify({ skipped: "deleted item" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine notification content based on table
    let title = "Infos";
    let body = "Something new in your workspace.";
    let url = "/";
    const ownerId: string = record.owner_id || "zeus";

    // Decide who should get this notification.
    // - For notices: use record.recipients[] (sub-admin IDs) OR all sub-admins in this workspace
    // - For entries: use record.assignees[] (sub-admin IDs)
    // - Admins (Zeus, co-admin) of the workspace also get notified
    let recipientUserIds: string[] = [];

    if (table === "notices") {
      title = record.title ? `New notice: ${record.title}` : "New notice";
      body = (record.body || "").slice(0, 100);
      url = "/?tab=notice";
      recipientUserIds = Array.isArray(record.recipients) ? record.recipients : [];
    } else if (table === "backend_entries") {
      title = "New backend entry";
      body = record.game_name || "Backend entry added";
      url = "/?tab=backend";
      recipientUserIds = Array.isArray(record.assignees) ? record.assignees : [];
    } else if (table === "game_entries") {
      title = "New game entry";
      body = record.game_name || "Game entry added";
      url = "/?tab=games";
      recipientUserIds = Array.isArray(record.assignees) ? record.assignees : [];
    } else if (table === "idpass_entries") {
      title = "New credential added";
      body = record.game || "Id & Pass entry";
      url = "/?tab=idpass";
      recipientUserIds = Array.isArray(record.assignees) ? record.assignees : [];
    } else {
      return new Response(JSON.stringify({ skipped: "unknown table" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the list of user IDs that should receive this push.
    // Always include the workspace admin(s) — they want to see their own activity
    // confirmed, and on co-admin workspaces, the co-admin's id IS the owner_id.
    const recipientSet = new Set<string>(recipientUserIds);
    recipientSet.add(ownerId === "zeus" ? "zeus" : ownerId);

    // Fetch all push subscriptions for these recipients in this workspace
    const subsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,user_id,endpoint,p256dh_key,auth_key`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!subsResp.ok) {
      const txt = await subsResp.text();
      return new Response(`Failed to fetch subscriptions: ${txt}`, { status: 500, headers: corsHeaders });
    }
    const allSubs: any[] = await subsResp.json();
    const targetSubs = allSubs.filter((s) => recipientSet.has(s.user_id));

    const pushPayload = JSON.stringify({
      title, body, url, tag: `infos-${table}-${record.id || Date.now()}`,
    });

    // Send to each subscription. If a sub returns 404/410, it's expired —
    // delete it from the database to avoid retrying.
    const results = await Promise.allSettled(
      targetSubs.map(async (s) => {
        const subscription = {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh_key, auth: s.auth_key },
        };
        try {
          await webpush.sendNotification(subscription, pushPayload);
          return { id: s.id, status: "sent" };
        } catch (err: any) {
          const statusCode = err?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Subscription gone — clean up
            await fetch(
              `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(s.id)}`,
              {
                method: "DELETE",
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                },
              },
            );
            return { id: s.id, status: "expired-and-deleted" };
          }
          return { id: s.id, status: "error", error: err?.message || String(err) };
        }
      }),
    );

    return new Response(
      JSON.stringify({
        table, eventType,
        delivered: results.filter((r) => r.status === "fulfilled" && (r.value as any).status === "sent").length,
        total: targetSubs.length,
        details: results.map((r) => r.status === "fulfilled" ? r.value : { error: r.reason }),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(`Error: ${err?.message || String(err)}`, { status: 500, headers: corsHeaders });
  }
});
