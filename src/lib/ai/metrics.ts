import { diffWords } from "diff";

// Offline signals for Story KRB-17: how much of a proposal the expert kept.

const MAX_EDIT_LENGTH = 5000;
const TIMEOUT_MS = 200;

/** Words of a text, as the edit distance counts them. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Words added or removed between the proposal and the text accepted. Past
 * the diff's limits (a text rewritten from scratch), every word of both
 * texts counts as changed, which is what such an edit amounts to.
 */
export function wordEditDistance(proposal: string, accepted: string): number {
  const parts = diffWords(proposal, accepted, { maxEditLength: MAX_EDIT_LENGTH, timeout: TIMEOUT_MS });
  if (!parts) return wordCount(proposal) + wordCount(accepted);
  return parts.reduce(
    (total, part) => (part.added || part.removed ? total + wordCount(part.value) : total),
    0,
  );
}
