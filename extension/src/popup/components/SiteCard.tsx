import { SITE_INFO } from '@/shared/constants';

interface SiteCardProps {
  site: string;
  meters: number;
}

export default function SiteCard({ site, meters }: SiteCardProps) {
  const info = SITE_INFO[site] ?? { name: site, short: '??', color: '#666' };

  return (
    <div className="card flex flex-col items-center gap-1 min-w-[70px]">
      <span
        className="text-xs font-bold font-mono"
        style={{ color: info.color }}
      >
        {info.short}
      </span>
      <span className="text-white text-sm font-mono font-bold">
        {meters < 1000
          ? `${Math.round(meters)}m`
          : `${(meters / 1000).toFixed(1)}km`}
      </span>
    </div>
  );
}
