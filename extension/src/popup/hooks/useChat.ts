import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/shared/supabase';
import type { ChatMessage } from '@/shared/types';
import type { ChatbotResponse } from '@/shared/messages';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface ChatContextSnapshot {
  rank?: number | null;
  percentile?: number | null;
  topSite?: string | null;
  recentMeters?: number;
}

function buildFallbackReply(message: string): string {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes('rank')) {
    return 'Your rank is somewhere between "needs help" and "thumb athlete." Keep scrolling and you will definitely move in one direction.';
  }
  if (normalized.includes('study') || normalized.includes('focus')) {
    return 'You asked for focus advice from a doomscroll bot. Respectfully, close this tab and touch your textbook for 20 minutes.';
  }
  return 'AI roast service is taking a break, but your scrolling never does. Consider a hydration break before your thumb asks for overtime pay.';
}

function temporaryMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: `tmp_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: 'local',
    role,
    content,
    created_at: new Date().toISOString(),
  };
}

function errorToString(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;

  if (err instanceof Error) {
    return err.message || '';
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function getEdgeStatus(err: unknown): number | null {
  if (err instanceof ChatbotHttpError) return err.status;
  if (!err || typeof err !== 'object') return null;
  const context = (err as { context?: { status?: unknown } }).context;
  const status = typeof context?.status === 'number' ? context.status : Number(context?.status);
  return Number.isFinite(status) ? status : null;
}

function errorMessage(err: unknown): string {
  const status = getEdgeStatus(err);
  if (status === 401 || status === 403) {
    return 'Session expired. Please sign out and sign in again.';
  }
  if (status && status >= 500) {
    return `Chat service error (${status}). Please try again.`;
  }
  if (status && status >= 400) {
    return `Request failed (${status}).`;
  }

  const message = errorToString(err) || 'Unknown error';
  const lowered = message.toLowerCase();

  if (lowered.includes('failed to fetch') || lowered.includes('networkerror')) {
    return 'Cannot reach AI service. Network may be blocking Supabase.';
  }
  if (lowered.includes('401') || lowered.includes('jwt') || lowered.includes('unauthorized')) {
    return 'Session expired. Please sign out and sign in again.';
  }
  return message;
}

function isAuthError(err: unknown): boolean {
  const status = getEdgeStatus(err);
  if (status === 401 || status === 403) return true;

  const message = errorToString(err);
  const lowered = message.toLowerCase();
  return lowered.includes('401') || lowered.includes('jwt') || lowered.includes('unauthorized');
}

class ChatbotHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChatbotHttpError';
    this.status = status;
  }
}

async function invokeChatbotApi(message: string, accessToken: string): Promise<ChatbotResponse> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase env vars missing in extension build');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/chatbot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'x-ds-token': accessToken,
    },
    body: JSON.stringify({ message }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore body parse errors; we still handle by status code.
  }

  if (!response.ok) {
    const serverError =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error ?? '')
        : '';
    throw new ChatbotHttpError(
      response.status,
      serverError || `Edge function failed (${response.status})`,
    );
  }

  return (payload ?? {}) as ChatbotResponse;
}

export function useChat(userId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<ChatContextSnapshot | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('chat_messages')
      .select('id, user_id, role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(60);

    if (queryError) {
      setLoading(false);
      return;
    }

    setMessages((data as ChatMessage[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const getAccessToken = useCallback(async (): Promise<string> => {
    // Try refreshing the session first to ensure a fresh token.
    // In Chrome extensions, tokens expire frequently between popup opens.
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (refreshData.session?.access_token) {
      return refreshData.session.access_token;
    }

    // Fall back to existing session if refresh didn't work.
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;
    if (!session?.access_token) {
      throw new Error('Session expired. Please sign in again.');
    }
    return session.access_token;
  }, []);

  const invokeChatbot = useCallback(async (message: string): Promise<ChatbotResponse> => {
    const accessToken = await getAccessToken();
    try {
      return await invokeChatbotApi(message, accessToken);
    } catch (firstError) {
      if (!isAuthError(firstError)) {
        throw firstError;
      }

      const refreshSessionResult = await supabase.auth.refreshSession();
      if (refreshSessionResult.error || !refreshSessionResult.data.session?.access_token) {
        throw refreshSessionResult.error ?? new Error('Session expired. Please sign in again.');
      }

      return invokeChatbotApi(message, refreshSessionResult.data.session.access_token);
    }
  }, [getAccessToken]);

  const sendMessage = useCallback(async (rawInput: string) => {
    const message = rawInput.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);

    const localUser = temporaryMessage('user', message);
    setMessages((prev) => [...prev, localUser]);

    try {
      const payload = await invokeChatbot(message);
      const reply = typeof payload.reply === 'string' ? payload.reply.trim() : '';
      if (!reply) {
        throw new Error('Empty AI response');
      }

      setMessages((prev) => [...prev, temporaryMessage('assistant', reply)]);
      setContext(payload.context ?? null);
      void refresh();
    } catch (err) {
      const fallback = buildFallbackReply(message);
      setMessages((prev) => [...prev, temporaryMessage('assistant', fallback)]);
      const reason = errorMessage(err);
      setError(`AI service unavailable. ${reason || 'Showing fallback roast.'}`);
      console.error('[DoomScroller] Chat invoke failed:', err);

      // Keep local fallback visible and persist basic chat continuity when possible.
      try {
        await supabase
          .from('chat_messages')
          .insert([
            { user_id: userId, role: 'user', content: message },
            { user_id: userId, role: 'assistant', content: fallback },
          ]);
      } catch {
        // Ignore fallback persistence errors.
      }
      void refresh();
    } finally {
      setSending(false);
    }
  }, [invokeChatbot, refresh, sending, userId]);

  return {
    messages,
    loading,
    sending,
    error,
    context,
    refresh,
    sendMessage,
    clearError: () => setError(null),
  };
}
