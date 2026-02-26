/**
 * Shared LLM utility — Claude API wrapper
 *
 * Used by outreach and prep modules.
 * Gracefully falls back to null when API key is not configured.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Call Claude API
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {{ model?: string, maxTokens?: number }} [opts]
 * @returns {Promise<string|null>}
 */
async function callLLM(systemPrompt, userPrompt, opts = {}) {
  if (!ANTHROPIC_API_KEY) {
    return null;
  }

  const model = opts.model || DEFAULT_MODEL;
  const maxTokens = opts.maxTokens || 1024;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      console.error(`[llm] Claude API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch (err) {
    console.error(`[llm] Claude API network error: ${err.message}`);
    return null;
  }
}

/**
 * Call Claude API expecting JSON response
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {{ model?: string, maxTokens?: number }} [opts]
 * @returns {Promise<object|null>}
 */
async function callLLMJson(systemPrompt, userPrompt, opts = {}) {
  const text = await callLLM(systemPrompt, userPrompt, opts);
  if (!text) return null;

  try {
    // Extract JSON from potential markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    return JSON.parse(jsonMatch[1].trim());
  } catch {
    console.error(`[llm] Failed to parse JSON response: ${text.slice(0, 200)}`);
    return null;
  }
}

export { callLLM, callLLMJson, ANTHROPIC_API_KEY, DEFAULT_MODEL };
