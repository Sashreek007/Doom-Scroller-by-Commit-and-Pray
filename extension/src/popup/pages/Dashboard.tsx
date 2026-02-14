import { useMemo } from 'react';
import { useScrollStats } from '../hooks/useScrollStats';
import SiteCard from '../components/SiteCard';
import type { GetStatsResponse } from '@/shared/messages';

const FUN_COMPARISONS = [
  (m: number) => `That's ${(m / 91.44).toFixed(1)} football fields`,
  (m: number) => `${(m / 330).toFixed(2)} Eiffel Towers tall`,
  (m: number) => `${Math.round(m / 0.25)} lengths of your unread textbook`,
  (m: number) => `${(m / 2.7).toFixed(0)} flights of stairs you didn't climb`,
  (m: number) => `${(m / 110).toFixed(1)} blue whales long`,
  (m: number) => `That's ${(m / 1.7).toFixed(0)} you's stacked up`,
];

interface DashboardProps {
  stats?: GetStatsResponse;
  loading?: boolean;
}

export default function Dashboard({ stats: externalStats, loading: externalLoading }: DashboardProps) {
  const { stats: hookStats, loading: hookLoading } = useScrollStats();
  const stats = externalStats ?? hookStats;
  const loading = externalLoading ?? hookLoading;

  const comparison = useMemo(() => {
    if (stats.todayMeters === 0) return "You haven't scrolled today. Suspicious.";
    const idx = Math.floor(Math.random() * FUN_COMPARISONS.length);
    return FUN_COMPARISONS[idx](stats.todayMeters);
  }, [stats.todayMeters]);

  const sitesWithData = Object.entries(stats.todayBysite)
    .sort(([, a], [, b]) => b - a);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-doom-muted font-mono text-sm animate-pulse">Loading stats...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Big today stat */}
      <div className="text-center py-4">
        <p className="text-doom-muted text-xs font-mono uppercase tracking-widest mb-2">
          Today
        </p>
        <p className="text-5xl font-bold font-mono neon-text-green">
          {stats.todayMeters < 1000
            ? `${Math.round(stats.todayMeters)}m`
            : `${(stats.todayMeters / 1000).toFixed(2)}km`}
        </p>
        <p className="text-doom-muted text-xs mt-2 italic">
          "{comparison}"
        </p>
      </div>

      {/* Per-site breakdown */}
      {sitesWithData.length > 0 && (
        <div>
          <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">
            Breakdown
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sitesWithData.map(([site, meters]) => (
              <SiteCard key={site} site={site} meters={meters} />
            ))}
          </div>
        </div>
      )}

      {/* Total all-time */}
      <div className="card neon-border">
        <div className="flex items-center justify-between">
          <span className="text-doom-muted text-xs font-mono">TOTAL DISTANCE</span>
          <span className="text-white font-mono font-bold">
            {stats.totalMeters < 1000
              ? `${Math.round(stats.totalMeters)}m`
              : `${(stats.totalMeters / 1000).toFixed(2)}km`}
          </span>
        </div>
      </div>

      {/* Empty state */}
      {stats.todayMeters === 0 && stats.totalMeters === 0 && (
        <div className="text-center py-6">
          <svg className="w-8 h-8 mx-auto mb-2 text-doom-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
          <p className="text-doom-muted text-sm">
            Open a social media site and start scrolling.
          </p>
          <p className="text-doom-muted text-xs mt-1">
            We'll track your shame automatically.
          </p>
        </div>
      )}
    </div>
  );
}
