// Routes messages from content scripts and popup to appropriate handlers

import { addScrollData } from './scroll-aggregator';
import type { ExtensionMessage, GetStatsResponse } from '../shared/messages';
import { getSupabase } from './supabase-client';

export function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  switch (message.type) {
    case 'SCROLL_UPDATE': {
      const { site, pixels, meters } = message.payload;
      addScrollData(site, pixels, meters);
      sendResponse({ ok: true });
      return false; // synchronous response
    }

    case 'GET_STATS': {
      // Async: fetch stats from Supabase
      getStats().then(sendResponse).catch(() => {
        sendResponse({ todayMeters: 0, todayBysite: {}, totalMeters: 0 });
      });
      return true; // async response
    }

    default:
      return false;
  }
}

async function getStats(): Promise<GetStatsResponse> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { todayMeters: 0, todayBysite: {}, totalMeters: 0 };
  }

  // Get today's start in UTC
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todaySessions } = await supabase
    .from('scroll_sessions')
    .select('site, meters_scrolled')
    .eq('user_id', session.user.id)
    .gte('created_at', todayStart.toISOString());

  const todayBysite: Record<string, number> = {};
  let todayMeters = 0;

  if (todaySessions) {
    for (const s of todaySessions) {
      const meters = Number(s.meters_scrolled);
      todayMeters += meters;
      todayBysite[s.site] = (todayBysite[s.site] ?? 0) + meters;
    }
  }

  // Get total from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('total_meters_scrolled')
    .eq('id', session.user.id)
    .single();

  return {
    todayMeters: parseFloat(todayMeters.toFixed(2)),
    todayBysite,
    totalMeters: profile ? Number(profile.total_meters_scrolled) : 0,
  };
}
