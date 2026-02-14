import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { generateTextWithGemini, sanitizeAiText } from '../_shared/gemini.ts';
import { ensureProfileExistsForUser, loadUserBehaviorContext } from '../_shared/user-context.ts';
import type { UserBehaviorContext } from '../_shared/user-context.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-ds-token',
};

interface ChatRequest {
  message: string;
  accessToken?: string;
}

interface StoredChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  if (!trimmed) return null;
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return (match?.[1] ?? '').trim() || null;
}

function extractAccessToken(req: Request, body?: ChatRequest): string | null {
  const fromAuth = extractBearerToken(req.headers.get('Authorization'));
  if (fromAuth) return fromAuth;

  const fromCustom = req.headers.get('x-ds-token')?.trim();
  if (fromCustom && fromCustom.length > 20) return fromCustom;

  const fromBody = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  if (fromBody.length > 20) return fromBody;

  return null;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function clampMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function normalizeBaseUsername(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

function buildFallbackContext(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }): UserBehaviorContext {
  const emailLocal = (user.email ?? '').split('@')[0].trim();
  const username = normalizeBaseUsername(emailLocal || `user_${user.id.slice(0, 6)}`) || 'user';
  const displayName = typeof user.user_metadata?.display_name === 'string'
    ? user.user_metadata.display_name.trim().slice(0, 40)
    : (emailLocal || 'Doom Scroller').slice(0, 40);

  return {
    userId: user.id,
    username,
    displayName,
    profileCreatedAt: new Date().toISOString(),
    totalMeters: 0,
    recentMeters: 0,
    topSite: null,
    siteMix: {},
    uniqueSites: 0,
    avgSessionMeters: 0,
    avgSessionDurationSec: 0,
    maxBurstMeters5Min: 0,
    activeHourBuckets: [],
    activeDays: 0,
    streakDays: 0,
    recentAchievementTitles: [],
    rank: null,
    percentile: null,
    sampleWindowDays: 30,
  };
}

function buildPrompt(
  userMessage: string,
  context: Awaited<ReturnType<typeof loadUserBehaviorContext>>,
  history: StoredChatMessage[],
): string {
  const recentHistory = history
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join('\n') || 'none';

  return [
    'You are DoomScroller AI: sarcastic, witty, and concise.',
    'You roast the user based only on their own scrolling data.',
    'Privacy rule: never reveal or invent details about other users.',
    'If asked about others, refuse and pivot to this user only.',
    'Keep responses under 120 words.',
    'Tone: playful roast, not hateful.',
    `username: ${context.username}`,
    `display_name: ${context.displayName}`,
    `total_meters: ${context.totalMeters}`,
    `recent_meters_${context.sampleWindowDays}d: ${context.recentMeters}`,
    `top_site: ${context.topSite ?? 'none'}`,
    `site_mix: ${JSON.stringify(context.siteMix)}`,
    `avg_session_meters: ${context.avgSessionMeters}`,
    `avg_session_duration_sec: ${context.avgSessionDurationSec}`,
    `max_burst_meters_5min: ${context.maxBurstMeters5Min}`,
    `active_days_${context.sampleWindowDays}d: ${context.activeDays}`,
    `streak_days: ${context.streakDays}`,
    `recent_achievement_titles: ${context.recentAchievementTitles.join(' | ') || 'none'}`,
    `rank_among_visible_profiles: ${context.rank ?? 'unknown'}`,
    `percentile_among_visible_profiles: ${context.percentile ?? 'unknown'}`,
    `conversation_history:\n${recentHistory}`,
    `latest_user_message: ${userMessage}`,
    'Respond with plain text only.',
  ].join('\n');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');

    const body = (await req.json()) as ChatRequest;

    const authHeader = req.headers.get('Authorization');
    const accessToken = extractAccessToken(req, body);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    let context: UserBehaviorContext = buildFallbackContext({
      id: user.id,
      email: user.email,
      user_metadata: user.user_metadata as Record<string, unknown> | null,
    });
    let history: StoredChatMessage[] = [];

    const rawMessage = typeof body?.message === 'string' ? body.message : '';
    const message = clampMessage(rawMessage);
    if (message.length < 1) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    try {
      await ensureProfileExistsForUser(supabase, {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata as Record<string, unknown> | null,
      });

      const [loadedContext, historyRes] = await Promise.all([
        loadUserBehaviorContext(supabase, user.id, {
          sampleWindowDays: 30,
          includeRank: true,
        }),
        supabase
          .from('chat_messages')
          .select('role, content, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      context = loadedContext;
      history = ((historyRes.data ?? []) as StoredChatMessage[])
        .slice()
        .reverse();
    } catch (contextError) {
      console.warn('[chatbot] using fallback context:', contextError);
    }

    const fallback = `You scrolled ${Math.round(context.recentMeters)}m in the last ${context.sampleWindowDays} days. Top app: ${context.topSite ?? 'unknown'}. Try touching grass before your thumb files overtime.`;

    const aiRaw = await generateTextWithGemini(
      buildPrompt(message, context, history),
      fallback,
      context.username,
    );

    const reply = sanitizeAiText(aiRaw, context.username).slice(0, 800);

    try {
      await supabase
        .from('chat_messages')
        .insert([
          { user_id: user.id, role: 'user', content: message },
          { user_id: user.id, role: 'assistant', content: reply },
        ]);
    } catch (persistError) {
      console.warn('[chatbot] could not persist chat messages:', persistError);
    }

    return new Response(
      JSON.stringify({
        reply,
        context: {
          rank: context.rank,
          percentile: context.percentile,
          topSite: context.topSite,
          recentMeters: context.recentMeters,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      },
    );
  }
});
