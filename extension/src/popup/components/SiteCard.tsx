import {
  siFacebook,
  siInstagram,
  siPinterest,
  siReddit,
  siSnapchat,
  siTiktok,
  siX,
  siYoutube,
  type SimpleIcon,
} from 'simple-icons';
import { SITE_INFO, toCanonicalSite, type SupportedSite } from '@/shared/constants';

interface SiteCardProps {
  site: string;
  meters: number;
}

const SITE_ICONS: Record<SupportedSite, SimpleIcon> = {
  facebook: siFacebook,
  x: siX,
  tiktok: siTiktok,
  instagram: siInstagram,
  snapchat: siSnapchat,
  reddit: siReddit,
  youtube: siYoutube,
  pinterest: siPinterest,
};

export default function SiteCard({ site, meters }: SiteCardProps) {
  const canonicalSite = toCanonicalSite(site);
  const info = canonicalSite
    ? SITE_INFO[canonicalSite]
    : { name: site, short: '??', color: '#666' };
  const icon = canonicalSite ? SITE_ICONS[canonicalSite] : null;

  return (
    <div className="card flex flex-col items-center gap-1 min-w-[70px]">
      {icon ? (
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4"
          aria-label={info.name}
          role="img"
          style={{ color: info.color }}
        >
          <path d={icon.path} fill="currentColor" />
        </svg>
      ) : (
        <span
          className="text-xs font-bold font-mono"
          style={{ color: info.color }}
        >
          {info.short}
        </span>
      )}
      <span className="text-white text-sm font-mono font-bold">
        {meters < 1000
          ? `${Math.round(meters)}m`
          : `${(meters / 1000).toFixed(1)}km`}
      </span>
    </div>
  );
}
