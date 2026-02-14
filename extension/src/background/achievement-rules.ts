import type { AchievementRarity } from '../shared/types';

export interface RuleUnlockCandidate {
  eventKey: string;
  triggerType: string;
  triggerValue: number;
  title: string;
  description: string;
  icon: string;
  rarity: AchievementRarity;
  appScope: string | null;
  roastLine: string;
  meta: Record<string, unknown>;
}

export interface AchievementRuleContext {
  dayKey: string;
  site: string;
  timestamp: number;
  todayMeters: number;
  todayBySite: Record<string, number>;
  rolling30Meters: number;
  sessionMeters: number;
  sessionDurationSec: number;
  previousTodayMeters: number;
  previousTodayBySite: Record<string, number>;
  previousRolling30Meters: number;
  previousSessionMeters: number;
  previousSessionDurationSec: number;
}

function getTopSiteShare(todayBySite: Record<string, number>, totalMeters: number): {
  site: string | null;
  share: number;
} {
  if (totalMeters <= 0) {
    return { site: null, share: 0 };
  }

  const entries = Object.entries(todayBySite).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return { site: null, share: 0 };
  return {
    site: entries[0][0],
    share: entries[0][1] / totalMeters,
  };
}

export function evaluateAchievementRules(ctx: AchievementRuleContext): RuleUnlockCandidate[] {
  const unlocks: RuleUnlockCandidate[] = [];

  const distanceThresholds = [100, 250, 500, 1000, 2000];
  for (const threshold of distanceThresholds) {
    if (ctx.previousTodayMeters < threshold && ctx.todayMeters >= threshold) {
      unlocks.push({
        eventKey: `daily_distance_${threshold}_${ctx.dayKey}`,
        triggerType: 'daily_distance_threshold',
        triggerValue: threshold,
        title: `${threshold}m Regret`,
        description: `You crossed ${threshold}m today. Productivity remains theoretical.`,
        icon: threshold >= 1000 ? '🔥' : '🏆',
        rarity: threshold >= 1000 ? 'epic' : threshold >= 500 ? 'rare' : 'common',
        appScope: null,
        roastLine: 'Your thumb is building endurance faster than your assignments.',
        meta: {
          threshold,
          dayKey: ctx.dayKey,
        },
      });
    }
  }

  const previousTop = getTopSiteShare(ctx.previousTodayBySite, ctx.previousTodayMeters);
  const currentTop = getTopSiteShare(ctx.todayBySite, ctx.todayMeters);

  const wasSpecialized = (
    previousTop.site
    && previousTop.share >= 0.75
    && ctx.previousTodayMeters >= 180
  );
  const isSpecialized = (
    currentTop.site
    && currentTop.share >= 0.75
    && ctx.todayMeters >= 180
  );

  if (!wasSpecialized && isSpecialized && currentTop.site) {
    unlocks.push({
      eventKey: `app_specialist_${currentTop.site}_${ctx.dayKey}`,
      triggerType: 'app_specialist',
      triggerValue: Number((currentTop.share * 100).toFixed(2)),
      title: `${currentTop.site.toUpperCase()} Loyalist`,
      description: `${Math.round(currentTop.share * 100)}% of today's scroll happened on ${currentTop.site}.`,
      icon: '📱',
      rarity: 'epic',
      appScope: currentTop.site,
      roastLine: `You didn't browse apps. You moved into ${currentTop.site}.`,
      meta: {
        share: Number(currentTop.share.toFixed(4)),
      },
    });
  }

  const prevUniqueSites = Object.keys(ctx.previousTodayBySite).filter((site) => ctx.previousTodayBySite[site] > 0).length;
  const currentUniqueSites = Object.keys(ctx.todayBySite).filter((site) => ctx.todayBySite[site] > 0).length;

  if (prevUniqueSites < 4 && currentUniqueSites >= 4 && ctx.todayMeters >= 200) {
    unlocks.push({
      eventKey: `app_diversity_4_${ctx.dayKey}`,
      triggerType: 'app_diversity',
      triggerValue: currentUniqueSites,
      title: 'Multi-Feed Tourist',
      description: `You sampled ${currentUniqueSites} apps today. Procrastination buffet unlocked.`,
      icon: '🌀',
      rarity: 'rare',
      appScope: null,
      roastLine: 'You diversified your distraction portfolio.',
      meta: {
        uniqueSites: currentUniqueSites,
      },
    });
  }

  if (ctx.previousRolling30Meters < 40 && ctx.rolling30Meters >= 40) {
    unlocks.push({
      eventKey: `burst_scroll_${ctx.dayKey}`,
      triggerType: 'burst_scroll',
      triggerValue: Number(ctx.rolling30Meters.toFixed(2)),
      title: 'Doom Sprint',
      description: `${Math.round(ctx.rolling30Meters)}m in 30s. Your thumb is speedrunning.`,
      icon: '⚡',
      rarity: 'rare',
      appScope: ctx.site,
      roastLine: 'That burst had more urgency than your deadlines.',
      meta: {
        windowSeconds: 30,
      },
    });
  }

  const wasMarathon = ctx.previousSessionDurationSec >= 20 * 60 && ctx.previousSessionMeters >= 250;
  const isMarathon = ctx.sessionDurationSec >= 20 * 60 && ctx.sessionMeters >= 250;

  if (!wasMarathon && isMarathon) {
    unlocks.push({
      eventKey: `session_marathon_${ctx.dayKey}`,
      triggerType: 'session_marathon',
      triggerValue: Number(ctx.sessionMeters.toFixed(2)),
      title: 'Infinite Scroll Endurance',
      description: `You survived a ${Math.round(ctx.sessionDurationSec / 60)} min doom session.`,
      icon: '🔥',
      rarity: 'epic',
      appScope: currentTop.site ?? ctx.site,
      roastLine: 'Your stamina is impressive and deeply concerning.',
      meta: {
        sessionDurationSec: Math.round(ctx.sessionDurationSec),
      },
    });
  }

  return unlocks;
}
