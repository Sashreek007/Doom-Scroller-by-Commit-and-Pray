import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { generateChatWithGemini, sanitizeAiText } from '../_shared/gemini.ts';
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

function buildSystemInstruction(
  context: Awaited<ReturnType<typeof loadUserBehaviorContext>>,
): string {
  return [
    'You are DoomScroller AI — sarcastic, witty, concise.',
    'Roast the user based only on their scrolling data below.',
    'Privacy: never reveal or invent details about other users.',
    'Keep responses under 120 words. Playful roast, not hateful.',
    'Reply directly. Never repeat, quote, or paraphrase what the user just said.',
    'Never mention the username or display name.',
    'Plain text only.',
    '',
    '--- USER SCROLL DATA ---',
    `total_meters: ${context.totalMeters}`,
    `recent_meters_${context.sampleWindowDays}d: ${context.recentMeters}`,
    `top_site: ${context.topSite ?? 'none'}`,
    `site_mix: ${JSON.stringify(context.siteMix)}`,
    `avg_session_meters: ${context.avgSessionMeters}`,
    `avg_session_duration_sec: ${context.avgSessionDurationSec}`,
    `max_burst_meters_5min: ${context.maxBurstMeters5Min}`,
    `active_days_${context.sampleWindowDays}d: ${context.activeDays}`,
    `streak_days: ${context.streakDays}`,
    `achievements: ${context.recentAchievementTitles.join(' | ') || 'none'}`,
    `rank: ${context.rank ?? 'unknown'}`,
    `percentile: ${context.percentile ?? 'unknown'}`,
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

    // Primary auth: validate with user's access token.
    const {
      data: { user: primaryUser },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    let user = primaryUser;

    // Fallback: if token is expired but structurally valid, verify user via service role.
    if ((authError || !user) && accessToken.includes('.')) {
      try {
        const payloadB64 = accessToken.split('.')[1];
        const payload = JSON.parse(atob(payloadB64));
        const userId = typeof payload.sub === 'string' ? payload.sub : null;
        if (userId) {
          const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
          const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: { user: serviceUser } } = await serviceClient.auth.admin.getUserById(userId);
          if (serviceUser) {
            user = serviceUser;
          }
        }
      } catch (fallbackErr) {
        console.warn('[chatbot] service-role fallback failed:', fallbackErr);
      }
    }

    if (!user) {
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

    // Rate limit: 5 user messages per day.
    const DAILY_LIMIT = 5;
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count: todayCount, error: countError } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('role', 'user')
      .gte('created_at', todayStart.toISOString());

    if (!countError && typeof todayCount === 'number' && todayCount >= DAILY_LIMIT) {
      return new Response(
        JSON.stringify({
          error: `You've hit your ${DAILY_LIMIT} message limit for today. Come back tomorrow for more roasts!`,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
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

    // Convert DB history to Gemini chat turns.
    const chatHistory = history.map((h) => ({
      role: h.role === 'user' ? 'user' as const : 'model' as const,
      text: h.content,
    }));

    const reply = (await generateChatWithGemini(
      buildSystemInstruction(context),
      chatHistory,
      message,
      fallback,
      context.username,
    )).slice(0, 800);

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
