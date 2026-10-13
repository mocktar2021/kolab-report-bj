// Token counts the context builder plans with. The real count depends on the
// model's tokenizer, so this is an estimate on the high side.

/**
 * French text runs at about 3.5 to 4 characters per token with the Claude
 * and OpenAI tokenizers, less for tables full of digits and pipes. The
 * deliverable parser counts 4; we count 3 to keep a margin.
 */
export const CHARS_PER_TOKEN = 3;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
