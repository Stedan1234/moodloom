// Thin client for the Anthropic Messages API, called with fetch (no SDK
// dependency). Images go first and the instruction last, which is the
// ordering the API documentation recommends for vision requests.
import { config } from '../../../config.js';
import { HttpError } from '../../../lib/errors.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export const anthropicProvider = {
  name: 'anthropic',
  get model() {
    return config.ai.model;
  },
  /**
   * @param {{system: string, images: Array<{mediaType: string, base64: string, label: string}>, prompt: string, maxTokens?: number}} request
   * @returns {Promise<{text: string, usage: object|null, model: string}>}
   */
  async complete({ system, images, prompt, maxTokens = 2000 }) {
    const content = [];
    for (const image of images) {
      content.push({ type: 'text', text: image.label });
      content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
    }
    content.push({ type: 'text', text: prompt });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key': config.ai.anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.ai.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content }],
        }),
      });
    } catch (err) {
      throw new HttpError(504, 'The AI service took too long to answer. Try again.', 'AI_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // Log the provider's reason for the operator; never echo it to the user
      // (it can include request details).
      const detail = await res.text().catch(() => '');
      console.error(`Anthropic API error ${res.status}: ${detail.slice(0, 500)}`);
      if (res.status === 429 || res.status === 529) {
        throw new HttpError(503, 'The AI service is busy right now. Try again in a minute.', 'AI_UNAVAILABLE');
      }
      throw new HttpError(502, 'The AI service could not complete that request.', 'AI_UNAVAILABLE');
    }

    const body = await res.json();
    const text = (body.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return { text, usage: body.usage || null, model: body.model || config.ai.model };
  },
};
