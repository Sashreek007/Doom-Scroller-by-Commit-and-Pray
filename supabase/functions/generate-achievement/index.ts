import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { generateJsonWithGemini } from '../_shared/gemini.ts';
import { loadUserBehaviorContext } from '../_shared/user-context.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

interface TriggerPayload {
  type: string;
  value: number;
  site?: string;
  timestamp?: number;
}

interface GenerateAchievementBody {
  eventKey: string;
  trigger: TriggerPayload;
  runtimeSnapshot?: Record<string, unknown>;
}

interface AiBadgeResult {
  title: string;
  description: string;
  icon: string;
  rarity: AchievementRarity;
  app_scope: string | null;
  meta_tags: string[];
  roast_line: string;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function normalizeRarity(value: unknown): AchievementRarity {
  const rarity = String(value ?? '').toLowerCase();
  if (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') return rarity;
  return 'common';
}

function normalizeIcon(value: unknown): string {
  const icon = String(value ?? '').trim();
  const allowed = new Set(['🏆', '🔥', '💀', '⚡', '🧠', '📱', '🌀', '🎯', '👑', '🪙']);
  if (allowed.has(icon)) return icon;
  return '🏆';
}

function clampText(value: unknown, maxLen: number, fallback: string): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.slice(0, maxLen);
}

function buildDeterministicBadge(body: GenerateAchievementBody, topSite: string | null): AiBadgeResult {
  const triggerType = body.trigger.type || 'scroll';
  const site = (body.trigger.site || topSite || 'social').toLowerCase();

  if (triggerType.includes('burst')) {
    return {
      title: 'Doom Sprint',
      description: `You speed-ran ${Math.round(body.trigger.value)}m of ${site} in a burst.`,
      icon: '⚡',
      rarity: 'rare',
      app_scope: body.trigger.site ?? topSite,
      meta_tags: ['burst', site],
      roast_line: 'Your thumb has entered competitive mode.',
    };
  }

  if (triggerType.includes('specialist')) {
    return {
      title: `${site.toUpperCase()} Loyalist`,
      description: `You spent most of today on ${site}. Diversification was not attempted.`,
      icon: '📱',
      rarity: 'epic',
      app_scope: site,
      meta_tags: ['specialist', site],
      roast_line: `You don't use apps. You use ${site}.`,
    };
  }

  if (triggerType.includes('diversity')) {
    return {
      title: 'Multi-Feed Tourist',
      description: 'You visited multiple apps today just to procrastinate in HD.',
      icon: '🌀',
      rarity: 'rare',
      app_scope: null,
      meta_tags: ['diversity'],
      roast_line: 'You diversified the portfolio of distractions.',
    };
  }

  if (triggerType.includes('session')) {
    return {
      title: 'Infinite Scroll Endurance',
      description: 'You sustained a marathon session. Olympic judges are concerned.',
      icon: '🔥',
      rarity: 'epic',
      app_scope: body.trigger.site ?? topSite,
      meta_tags: ['session'],
      roast_line: 'That was cardio for your thumb and damage for your GPA.',
    };
  }

  return {
    title: 'Meters of Regret',
    description: `You crossed ${Math.round(body.trigger.value)}m today.`,
    icon: '🏆',
    rarity: body.trigger.value >= 1000 ? 'epic' : body.trigger.value >= 500 ? 'rare' : 'common',
    app_scope: body.trigger.site ?? topSite,
    meta_tags: ['distance'],
    roast_line: 'Your study plan just got scrolled past again.',
  };
}

function buildPrompt(body: GenerateAchievementBody, context: Awaited<ReturnType<typeof loadUserBehaviorContext>>): string {
  const runtimeSnapshot = body.runtimeSnapshot ? JSON.stringify(body.runtimeSnapshot) : '{}';
  const siteMix = JSON.stringify(context.siteMix);
  const recentAchievements = context.recentAchievementTitles.join(' | ') || 'none';

  return [
    'You generate one sarcastic doomscroll achievement badge in JSON only.',
    'Return JSON object with keys exactly: title, description, icon, rarity, app_scope, meta_tags, roast_line.',
    'rarity must be one of: common, rare, epic, legendary.',
    'icon must be one emoji from: 🏆 🔥 💀 ⚡ 🧠 📱 🌀 🎯 👑 🪙.',
    'No markdown, no code fences, no extra keys.',
    'Keep title <= 36 chars and description <= 140 chars.',
    'Do not mention any other users. Only refer to this user behavior.',
    `eventKey: ${body.eventKey}`,
    `trigger: ${JSON.stringify(body.trigger)}`,
    `runtimeSnapshot: ${runtimeSnapshot}`,
    `user.username: ${context.username}`,
    `user.displayName: ${context.displayName}`,
    `behavior.totalMeters: ${context.totalMeters}`,
    `behavior.recentMeters(${context.sampleWindowDays}d): ${context.recentMeters}`,
    `behavior.topSite: ${context.topSite ?? 'none'}`,
    `behavior.siteMix: ${siteMix}`,
    `behavior.uniqueSites: ${context.uniqueSites}`,
    `behavior.avgSessionMeters: ${context.avgSessionMeters}`,
    `behavior.avgSessionDurationSec: ${context.avgSessionDurationSec}`,
    `behavior.maxBurstMeters5Min: ${context.maxBurstMeters5Min}`,
    `behavior.activeDays: ${context.activeDays}`,
    `behavior.streakDays: ${context.streakDays}`,
    `recentAchievements: ${recentAchievements}`,
  ].join('\n');
}

function isDuplicateError(message: string, code?: string): boolean {
  const lowered = message.toLowerCase();
  return code === '23505' || lowered.includes('duplicate key');
}

async function insertAchievement(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: GenerateAchievementBody,
  badge: AiBadgeResult,
) {
  const nowIso = new Date().toISOString();

  const fullPayload = {
    user_id: userId,
    trigger_type: clampText(body.trigger.type, 60, 'scroll_pattern'),
    trigger_value: Number.isFinite(body.trigger.value) ? Number(body.trigger.value) : 0,
    title: clampText(badge.title, 64, 'Doom Achievement'),
    description: clampText(badge.description, 180, 'You unlocked a new doomscroll pattern.'),
    icon: normalizeIcon(badge.icon),
    earned_at: nowIso,
    event_key: clampText(body.eventKey, 160, `event_${Date.now()}`),
    rarity: normalizeRarity(badge.rarity),
    app_scope: badge.app_scope ? clampText(badge.app_scope, 40, '') : null,
    meta: {
      tags: Array.isArray(badge.meta_tags) ? badge.meta_tags.slice(0, 8) : [],
      roast_line: clampText(badge.roast_line, 180, ''),
      runtime_snapshot: body.runtimeSnapshot ?? {},
    },
    source: 'rule+ai',
  };

  let { data, error } = await supabase
    .from('achievements')
    .insert(fullPayload)
    .select('*')
    .single();

  if (error && isDuplicateError(error.message, error.code)) {
    const existing = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', userId)
      .eq('event_key', fullPayload.event_key)
      .order('earned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing.error) throw existing.error;
    return existing.data;
  }

  if (error && error.message.toLowerCase().includes('event_key')) {
    // Backward compatibility if migration has not been applied yet.
    const legacyPayload = {
      user_id: userId,
      trigger_type: fullPayload.trigger_type,
      trigger_value: fullPayload.trigger_value,
      title: fullPayload.title,
      description: fullPayload.description,
      icon: fullPayload.icon,
      earned_at: nowIso,
    };

    const legacyInsert = await supabase
      .from('achievements')
      .insert(legacyPayload)
      .select('*')
      .single();

    if (legacyInsert.error) throw legacyInsert.error;
    return legacyInsert.data;
  }

  if (error) throw error;
  return data;
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

    const body = (await req.json()) as GenerateAchievementBody;
    if (!body?.eventKey || !body?.trigger || !body.trigger.type) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const behaviorContext = await loadUserBehaviorContext(supabase, user.id, {
      sampleWindowDays: 30,
      includeRank: false,
    });

    const deterministic = buildDeterministicBadge(body, behaviorContext.topSite);
    const aiResult = await generateJsonWithGemini<AiBadgeResult>(
      buildPrompt(body, behaviorContext),
      deterministic,
    );

    const normalized: AiBadgeResult = {
      title: clampText(aiResult?.title, 36, deterministic.title),
      description: clampText(aiResult?.description, 140, deterministic.description),
      icon: normalizeIcon(aiResult?.icon),
      rarity: normalizeRarity(aiResult?.rarity),
      app_scope: aiResult?.app_scope ? clampText(aiResult.app_scope, 40, '') : deterministic.app_scope,
      meta_tags: Array.isArray(aiResult?.meta_tags)
        ? aiResult.meta_tags.map((item) => clampText(item, 24, '')).filter(Boolean).slice(0, 8)
        : deterministic.meta_tags,
      roast_line: clampText(aiResult?.roast_line, 180, deterministic.roast_line),
    };

    const row = await insertAchievement(supabase, user.id, body, normalized);

    return new Response(
      JSON.stringify({
        achievement: row,
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
