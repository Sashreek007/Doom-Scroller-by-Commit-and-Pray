const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

function getApiKey(): string | null {
  const key = Deno.env.get('GEMINI_API_KEY');
  return key && key.trim().length > 0 ? key.trim() : null;
}

function stripCodeFences(value: string): string {
  return value
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractText(response: GeminiResponse): string {
  return response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('\n')
    .trim() ?? '';
}

export function sanitizeAiText(input: string, ownUsername?: string): string {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  if (!ownUsername) return normalized;

  return normalized.replace(/@[a-z0-9_]{3,20}/gi, (handle) => {
    const plain = handle.slice(1).toLowerCase();
    return plain === ownUsername.toLowerCase() ? handle : '@someone';
  });
}

async function invokeGemini(prompt: string, temperature: number): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = extractText(payload);
  return text || null;
}

export async function generateTextWithGemini(
  prompt: string,
  fallback: string,
  ownUsername?: string,
): Promise<string> {
  try {
    const text = await invokeGemini(prompt, 0.75);
    if (!text) return fallback;
    return sanitizeAiText(text, ownUsername) || fallback;
  } catch {
    return fallback;
  }
}

export async function generateJsonWithGemini<T>(
  prompt: string,
  fallback: T,
): Promise<T> {
  try {
    const text = await invokeGemini(prompt, 0.65);
    if (!text) return fallback;

    const direct = stripCodeFences(text);
    try {
      return JSON.parse(direct) as T;
    } catch {
      const start = direct.indexOf('{');
      const end = direct.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(direct.slice(start, end + 1)) as T;
      }
      return fallback;
    }
  } catch {
    return fallback;
  }
}
