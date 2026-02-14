import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { generateTextWithGemini, sanitizeAiText } from '../_shared/gemini.ts';
import { loadUserBehaviorContext } from '../_shared/user-context.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChatRequest {
  message: string;
}

interface StoredChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function clampMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1000);
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
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
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const body = (await req.json()) as ChatRequest;
    const rawMessage = typeof body?.message === 'string' ? body.message : '';
    const message = clampMessage(rawMessage);
    if (message.length < 1) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const [context, historyRes] = await Promise.all([
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

    const history = ((historyRes.data ?? []) as StoredChatMessage[])
      .slice()
      .reverse();

    const fallback = `You scrolled ${Math.round(context.recentMeters)}m in the last ${context.sampleWindowDays} days. Top app: ${context.topSite ?? 'unknown'}. Try touching grass before your thumb files overtime.`;

    const aiRaw = await generateTextWithGemini(
      buildPrompt(message, context, history),
      fallback,
      context.username,
    );

    const reply = sanitizeAiText(aiRaw, context.username).slice(0, 800);

    await supabase
      .from('chat_messages')
      .insert([
        { user_id: user.id, role: 'user', content: message },
        { user_id: user.id, role: 'assistant', content: reply },
      ]);

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
