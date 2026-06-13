import { ConvexError } from "convex/values";

/**
 * Error codes thrown by convex-livestore operations as ConvexError instances.
 *
 * All errors have the shape: `{ code: ErrorCode; message: string }`
 *
 * Example:
 * ```ts
 * import { ConvexError } from "convex/values";
 * import { ErrorCode } from "convex-livestore";
 *
 * try {
 *   await ctx.runMutation(api.myModule.pushEvents, { ... });
 * } catch (e) {
 *   if (e instanceof ConvexError && e.data.code === ErrorCode.SEQ_NUM_CONFLICT) {
 *     // fetch current head and retry
 *   }
 * }
 * ```
 */
export const ErrorCode = {
  // --- Push errors ---

  /** Batch must contain at least one event. */
  EMPTY_BATCH: "EMPTY_BATCH",

  /** Batch exceeds the maximum of 500 events per push. */
  BATCH_TOO_LARGE: "BATCH_TOO_LARGE",

  /** An event seqNum or parentSeqNum is not a non-negative integer. */
  INVALID_SEQ_NUM: "INVALID_SEQ_NUM",

  /**
   * The batch's parentSeqNum does not match the store's current head.
   * Retryable: fetch the current head with `getHead` and resubmit with corrected seqNums.
   */
  SEQ_NUM_CONFLICT: "SEQ_NUM_CONFLICT",

  /** An event's args field is not valid JSON. */
  INVALID_ARGS_JSON: "INVALID_ARGS_JSON",

  /**
   * A seqNum in the batch already exists in the store with different event data.
   * This indicates a data integrity issue — do not retry.
   */
  DUPLICATE_EVENT_CONFLICT: "DUPLICATE_EVENT_CONFLICT",

  /**
   * Some events in the batch were already committed but others were not.
   * This indicates an inconsistent retry — do not retry the same batch.
   */
  PARTIAL_DUPLICATE_BATCH: "PARTIAL_DUPLICATE_BATCH",

  // --- Query errors ---

  /** pageSize is not a valid integer within the allowed range. */
  INVALID_PAGE_SIZE: "INVALID_PAGE_SIZE",

  /** The pagination cursor is malformed. */
  INVALID_CURSOR: "INVALID_CURSOR",

  /** A timestamp value (since or until) is not a valid non-negative finite number. */
  INVALID_TIMESTAMP: "INVALID_TIMESTAMP",

  /** The `since` value is greater than `until`. */
  INVALID_TIME_RANGE: "INVALID_TIME_RANGE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ConvexLivestoreErrorData = {
  code: ErrorCode;
  message: string;
};

export function throwError(code: ErrorCode, message: string): never {
  throw new ConvexError<ConvexLivestoreErrorData>({ code, message });
}
