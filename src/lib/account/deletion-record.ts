import "server-only";
import { z } from "zod";
import { accountDeletionRecordEmail } from "@/lib/email/account-deletion-email";
import { sendEmail } from "@/lib/email/send";
import { log } from "@/lib/log";

// After a successful deletion, e-mails the account id and the date to
// ACCOUNT_DELETION_LOG_EMAIL, the record an operator reads after a backup
// restore (docs/gdpr/data-subject-requests.md). Nothing here can fail the
// deletion: the account is already gone when it runs.

const addressSchema = z.string().trim().email();

let warnedUnset = false;

/** For the tests: the next missing setting warns again. */
export function resetDeletionRecordWarning() {
  warnedUnset = false;
}

export async function recordAccountDeletion(userId: string, deletedAt = new Date()): Promise<void> {
  const raw = process.env.ACCOUNT_DELETION_LOG_EMAIL?.trim() ?? "";
  const address = addressSchema.safeParse(raw);
  if (!address.success) {
    // Once per server instance, so the logs say it without repeating it.
    if (!warnedUnset) {
      warnedUnset = true;
      log.warn(
        raw
          ? "account: ACCOUNT_DELETION_LOG_EMAIL is not an e-mail address, deleted accounts are not recorded"
          : "account: ACCOUNT_DELETION_LOG_EMAIL is not set, deleted accounts are not recorded",
      );
    }
    return;
  }

  try {
    const sent = await sendEmail(
      accountDeletionRecordEmail({
        to: address.data,
        userId,
        deletedAt,
        environment: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "development",
      }),
    );
    if (!sent) log.error("account: the deletion record could not be sent", { userId });
  } catch (error) {
    log.error("account: the deletion record could not be sent", { userId, error });
  }
}
