/**
 * A run that can't start: missing key, unknown subset, unreadable baseline,
 * a budget that can't be measured. `npm run eval` prints the message and
 * exits with 2.
 */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}
