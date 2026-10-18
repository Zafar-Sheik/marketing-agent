import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { env, requireKey } from '@/env';
import type { Llm, StructuredRequest, LlmResult } from './types';

/** USD per million tokens (input, output) for cost tracking in agent_runs. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export class RefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`Claude declined this request${category ? ` (${category})` : ''}.`);
    this.name = 'RefusalError';
  }
}

let client: Anthropic | undefined;

export const claude: Llm = {
  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<LlmResult<z.infer<S>>> {
    client ??= new Anthropic({ apiKey: requireKey('ANTHROPIC_API_KEY') });
    const model = req.tier === 'fast' ? env().ANTHROPIC_FAST_MODEL : env().ANTHROPIC_MODEL;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(req.images ?? []).map(
        (img): Anthropic.Beta.BetaImageBlockParam =>
          'url' in img
            ? { type: 'image', source: { type: 'url', url: img.url } }
            : { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
      ),
      { type: 'text', text: req.prompt },
    ];

    // Streaming avoids HTTP timeouts on long plans and reports.
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      output_config: { effort: req.effort ?? (req.tier === 'fast' ? 'low' : 'high'), format: betaZodOutputFormat(req.schema) },
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') throw new RefusalError(message.stop_details?.category ?? null);
    if (message.stop_reason === 'max_tokens') throw new Error('Claude response was cut off (max_tokens).');
    if (message.parsed_output == null) throw new Error('Claude returned output that does not match the schema.');

    const [inPrice, outPrice] = PRICES[message.model] ?? PRICES[model] ?? [0, 0];
    const u = message.usage;
    const inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
    const costCents = Math.ceil(((inputTokens * inPrice + u.output_tokens * outPrice) / 1_000_000) * 100);
    return { data: message.parsed_output as z.infer<S>, costCents, model: message.model };
  },
};
