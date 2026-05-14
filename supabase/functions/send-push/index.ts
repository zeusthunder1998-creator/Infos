// Supabase Edge Function: send-push
//
// Triggered by Supabase Database Webhooks on INSERT events for:
//   - notices
//   - backend_entries
//   - game_entries
//   - idpass_entries
//
// Sends Web Push notifications to subscribers whose user_id is in
// record.recipients[] (for notices) or record.assignees[] (for entries).
//
// Handles the special "__ALL__" sentinel by expanding to every sub-admin
// in the workspace.
//
// Required environment variables (Supabase Dashboard → Edge Functions → send-push → Settings):
//   VAPID_PRIVATE_KEY  — your VAPID private key
//   VAPID_PUBLIC_KEY   — your VAPID public key (same as NEXT_PUBLIC_VAPID_PUBLIC_KEY)
//   VAPID_SUBJECT      — a mailto: URL (e.g. mailto:zeusthunder1998@gmail.com)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically injected.
//
// Deploy:
//   supabase functions deploy send-push --project-ref mljqvpjmcrjpmbtztctm
//
// The webhook payload from Supabase looks like:
//   { type: 'INSERT', table: 'notices', record: {...}, schema: 'public', old_record: null }

// @ts-ignore — Deno runtime
import webpush from "npm:web-push@3.6.7";

// CORS headers — only POST is real, OPTIONS is for browser preflight (rarely needed
// here since webhooks call server-to-server, but harmless)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Constant used by the frontend to indicate "assign to all sub-admins"
const ALL_SENTINEL = "__ALL__";
const MAX_FAILURES = 5;

// @ts-ignore — Deno
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // @ts-ignore — Deno
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    // @ts-ignore
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    // @ts-ignore
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:zeusthunder1998@gmail.com";
    // @ts-ignore
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    // @ts-ignore
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.error("[send-push] VAPID keys not configured");
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[send-push] Supabase env not configured");
      return new Response(JSON.stringify({ error: "Supabase env not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const payload = await req.json();
    const table: string = payload.table || "";
    const eventType: string = payload.type || "";
    const record: any = payload.record || {};
    const oldRecord: any = payload.old_record || null;

    // Skip non-INSERTs (we only notify on creation, not edits)
    if (eventType !== "INSERT") {
      return new Response(JSON.stringify({ skipped: "non-insert event", eventType }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if soft-deleted (defensive — INSERT of a deleted item is weird, but handle it)
    if (record.deleted_at) {
      return new Response(JSON.stringify({ skipped: "deleted item" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine notification content + target field per table
    let title = "Infos";
    let body = "Something new in your workspace.";
    let url = "/";
    let targetIds: string[] = [];
    const ownerId: string = record.owner_id || "zeus";

    if (table === "notices") {
      title = record.title ? `📢 ${record.title}` : "📢 New notice";
      body = (record.body || "A new notice was posted for you.").slice(0, 140);
      url = "/?tab=notice";
      targetIds = Array.isArray(record.recipients) ? record.recipients : [];
    } else if (table === "backend_entries") {
      title = "⚙️ New System entry";
      body = record.game_name || "A new system entry was assigned to you.";
      url = "/?tab=backend";
      targetIds = Array.isArray(record.assignees) ? record.assignees : [];
    } else if (table === "game_entries") {
      title = "🎮 New Game entry";
      body = record.game_name || "A new game entry was assigned to you.";
      url = "/?tab=games";
      targetIds = Array.isArray(record.assignees) ? record.assignees : [];
    } else if (table === "idpass_entries") {
      title = "🔐 New Id & Pass entry";
      body = record.game || "A new credential was assigned to you.";
      url = "/?tab=idpass";
      targetIds = Array.isArray(record.assignees) ? record.assignees : [];
    } else {
      return new Response(JSON.stringify({ skipped: "unknown table", table }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Expand ALL_SENTINEL → every sub-admin id in this workspace
    if (targetIds.includes(ALL_SENTINEL)) {
      const subsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/sub_admins?owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (subsResp.ok) {
        const rows = await subsResp.json();
        targetIds = (rows || []).map((r: any) => r.id);
      } else {
        // Fallback: just drop the sentinel and keep any explicit IDs
        targetIds = targetIds.filter((t) => t !== ALL_SENTINEL);
      }
    }

    if (targetIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no targets" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all push subscriptions for those users in this workspace.
    // Note: column is `p256dh` (not `p256dh_key`) — matches the storage.ts schema.
    const inList = targetIds.map((t) => `"${t}"`).join(",");
    const subsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?owner_id=eq.${encodeURIComponent(ownerId)}&user_id=in.(${inList})&select=id,user_id,endpoint,p256dh,auth`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!subsResp.ok) {
      const txt = await subsResp.text();
      console.error("[send-push] subs query failed", txt);
      return new Response(JSON.stringify({ error: "subs query failed", details: txt }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetSubs: any[] = await subsResp.json();
    if (targetSubs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no subscriptions" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tag = `infos-${table}-${record.id || Date.now()}`;
    const pushPayload = JSON.stringify({ title, body, url, tag });

    // Send to each subscription. On 404/410, the subscription is dead — delete it.
    // On other errors, increment failed_count and delete once it hits MAX_FAILURES.
    const results = await Promise.allSettled(
      targetSubs.map(async (s) => {
        const subscription = {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        };
        try {
          await webpush.sendNotification(subscription, pushPayload, { TTL: 60 * 60 * 24 });
          // Reset failure counter on success
          await fetch(
            `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(s.id)}`,
            {
              method: "PATCH",
              headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              body: JSON.stringify({ failed_count: 0, last_seen_at: Date.now() }),
            },
          ).catch(() => {});
          return { id: s.id, status: "sent" };
        } catch (err: any) {
          const statusCode = err?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Subscription gone — delete
            await fetch(
              `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(s.id)}`,
              {
                method: "DELETE",
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                },
              },
            ).catch(() => {});
            return { id: s.id, status: "expired-and-deleted" };
          }
          // Other error → bump failed_count; delete if >= MAX_FAILURES
          try {
            const cur = await fetch(
              `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(s.id)}&select=failed_count`,
              {
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                },
              },
            );
            const rows = cur.ok ? await cur.json() : [];
            const newCount = (rows?.[0]?.failed_count || 0) + 1;
            if (newCount >= MAX_FAILURES) {
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
              return { id: s.id, status: "deleted-after-max-failures" };
            } else {
              await fetch(
                `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(s.id)}`,
                {
                  method: "PATCH",
                  headers: {
                    apikey: SUPABASE_SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json",
                    Prefer: "return=minimal",
                  },
                  body: JSON.stringify({ failed_count: newCount }),
                },
              );
            }
          } catch (_) { /* swallow */ }
          return { id: s.id, status: "error", code: statusCode, error: err?.message || String(err) };
        }
      }),
    );

    const delivered = results.filter((r) =>
      r.status === "fulfilled" && (r.value as any).status === "sent"
    ).length;
    const expired = results.filter((r) =>
      r.status === "fulfilled" && (r.value as any).status === "expired-and-deleted"
    ).length;

    return new Response(
      JSON.stringify({
        table,
        delivered,
        expired,
        total: targetSubs.length,
        results: results.map((r) => r.status === "fulfilled" ? r.value : { error: String(r.reason) }),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[send-push] unexpected error", err);
    return new Response(
      JSON.stringify({ error: err?.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
