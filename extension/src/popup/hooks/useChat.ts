import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/shared/supabase';
import type { ChatMessage } from '@/shared/types';
import type { ChatbotResponse } from '@/shared/messages';

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

  const sendMessage = useCallback(async (rawInput: string) => {
    const message = rawInput.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);

    const localUser = temporaryMessage('user', message);
    setMessages((prev) => [...prev, localUser]);

    try {
      const response = await supabase.functions.invoke('chatbot', {
        body: { message },
      });

      if (response.error) {
        throw response.error;
      }

      const payload = (response.data ?? {}) as ChatbotResponse;
      const reply = typeof payload.reply === 'string' ? payload.reply.trim() : '';
      if (!reply) {
        throw new Error('Empty AI response');
      }

      setMessages((prev) => [...prev, temporaryMessage('assistant', reply)]);
      setContext(payload.context ?? null);
      void refresh();
    } catch {
      const fallback = buildFallbackReply(message);
      setMessages((prev) => [...prev, temporaryMessage('assistant', fallback)]);
      setError('AI service unavailable. Showing fallback roast.');

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
  }, [refresh, sending, userId]);

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
