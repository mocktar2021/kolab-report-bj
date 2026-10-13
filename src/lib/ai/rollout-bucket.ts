import { createHash } from "node:crypto";

// Which sections get the candidate of a prompt rollout. The bucket comes
// from a hash of the rollout and the section, so a section keeps the same
// version for the whole rollout, and raising the percentage only adds
// sections.

/** 0 to 99, stable for a rollout and a section. */
export function rolloutBucket(rolloutId: string, sectionId: string): number {
  const digest = createHash("sha256")
    .update(`${rolloutId.toLowerCase()}:${sectionId.toLowerCase()}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

export function inRollout(rollout: { id: string; percent: number }, sectionId: string): boolean {
  return rolloutBucket(rollout.id, sectionId) < rollout.percent;
}
