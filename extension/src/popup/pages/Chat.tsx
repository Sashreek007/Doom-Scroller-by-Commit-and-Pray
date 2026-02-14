import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useChat } from '../hooks/useChat';

interface ChatProps {
  userId: string;
}

interface ParsedAssistantMessage {
  quotedUserText: string;
  reply: string;
}

function parseLeadingQuotedUserText(content: string): ParsedAssistantMessage | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return null;

  let closeIndex = -1;
  const scanLimit = Math.min(trimmed.length, 180);
  for (let i = 1; i < scanLimit; i += 1) {
    if (trimmed[i] === quote) {
      closeIndex = i;
      break;
    }
  }

  if (closeIndex <= 1) return null;

  const quotedUserText = trimmed.slice(1, closeIndex).trim();
  if (!quotedUserText || quotedUserText.length > 120) return null;

  let reply = trimmed.slice(closeIndex + 1).trimStart();
  // Remove awkward opener fragments like: ", username?" or ", again, username?"
  reply = reply.replace(
    /^,?\s*(?:again,?\s*)?(?:@[a-z0-9_]{2,30}|[a-z0-9_]{2,30})\??[,:]?\s*/i,
    '',
  );
  reply = reply.replace(/^[,:-]\s*/, '');

  return {
    quotedUserText,
    reply,
  };
}

export default function Chat({ userId }: ChatProps) {
  const {
    messages,
    loading,
    sending,
    error,
    context,
    sendMessage,
    clearError,
  } = useChat(userId);

  const [draft, setDraft] = useState('');
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    await sendMessage(text);
  };

  return (
    <div className="flex flex-col gap-3 h-full min-h-[460px]">
      <div className="card py-3">
        <p className="text-neon-green text-xs font-mono uppercase tracking-wider mb-1">
          AI Chat
        </p>
        <p className="text-doom-muted text-xs leading-relaxed">
          Ask for roasts, patterns, or “how cooked am I today?” and the bot answers using your own doomscroll data.
        </p>
        {context && (
          <p className="text-[10px] text-doom-muted font-mono mt-2">
            {context.rank ? `Rank #${context.rank}` : 'Rank unavailable'}
            {typeof context.percentile === 'number' ? ` • ${context.percentile}% percentile` : ''}
            {context.topSite ? ` • Top app: ${context.topSite}` : ''}
          </p>
        )}
      </div>

      {error && (
        <div className="card border-neon-pink/40 bg-neon-pink/10 text-neon-pink text-xs font-mono flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            className="px-2 py-1 rounded border border-neon-pink/40 hover:bg-neon-pink/20"
            onClick={clearError}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="card flex-1 overflow-y-auto space-y-2">
        {loading ? (
          <p className="text-doom-muted text-xs font-mono animate-pulse">Loading messages...</p>
        ) : messages.length === 0 ? (
          <p className="text-doom-muted text-xs">
            No messages yet. Ask the bot what your worst scrolling habit is.
          </p>
        ) : (
          messages.map((message) => {
            const parsedAssistant = message.role === 'assistant'
              ? parseLeadingQuotedUserText(message.content)
              : null;

            return (
              <div
                key={message.id}
                className={`max-w-[88%] px-3 py-2 rounded-lg text-xs leading-relaxed ${
                  message.role === 'user'
                    ? 'ml-auto bg-neon-green/12 border border-neon-green/35 text-neon-green'
                    : 'mr-auto bg-doom-surface border border-doom-border text-white'
                }`}
              >
                {parsedAssistant ? (
                  <div className="space-y-2">
                    <div className="rounded-md border border-neon-cyan/30 bg-neon-cyan/10 px-2 py-1">
                      <p className="text-[10px] uppercase tracking-wide text-neon-cyan/90 font-mono">
                        You said
                      </p>
                      <p className="text-[11px] italic text-neon-cyan/95">
                        "{parsedAssistant.quotedUserText}"
                      </p>
                    </div>
                    {parsedAssistant.reply && <p>{parsedAssistant.reply}</p>}
                  </div>
                ) : (
                  message.content
                )}
              </div>
            );
          })
        )}

        {sending && (
          <div className="mr-auto bg-doom-surface border border-doom-border text-doom-muted text-xs px-3 py-2 rounded-lg animate-pulse">
            Cooking a roast...
          </div>
        )}

        <div ref={scrollAnchorRef} />
      </div>

      <form className="card !p-2" onSubmit={handleSubmit}>
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask AI chat..."
            className="flex-1 bg-doom-surface border border-doom-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-neon-green"
            maxLength={400}
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="btn-primary text-xs px-3 py-2 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
