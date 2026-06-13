import { paginationOptsValidator, type IndexRangeBuilder } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { mutation, query } from "./_generated/server.js";
import { ErrorCode, throwError } from "./errors.js";

const MAX_EVENTS_PER_PUSH = 500;
const PULL_PAGE_SIZE = 100;
const MAX_PULL_PAGE_SIZE = 500;
const LIST_EVENTS_PAGE_SIZE = 50;
const MAX_LIST_EVENTS_PAGE_SIZE = 200;

type PushEvent = {
  seqNum: number;
  parentSeqNum: number;
  name: string;
  args: string;
  clientId: string;
  sessionId: string;
};

type ListEventDoc = Doc<"livestoreEvents">;
type ListEventsIndexRange =
  | IndexRangeBuilder<ListEventDoc, ["storeId", "_creationTime"], 1>
  | IndexRangeBuilder<ListEventDoc, ["storeId", "userId", "_creationTime"], 2>;
type CreationTimeUpperBound = {
  value: number;
  inclusive: boolean;
};
const LIST_EVENTS_START_CURSOR = JSON.stringify({ createdAt: null });

function assertSequenceNumber(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) {
    throwError(
      ErrorCode.INVALID_SEQ_NUM,
      `${field} must be a non-negative integer`,
    );
  }
}

function assertTimestamp(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throwError(
      ErrorCode.INVALID_TIMESTAMP,
      `${field} must be a non-negative finite number`,
    );
  }
}

function resolvePageSize(
  value: number | undefined,
  defaultValue: number,
  maxValue: number,
) {
  const pageSize = value ?? defaultValue;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxValue) {
    throwError(
      ErrorCode.INVALID_PAGE_SIZE,
      `pageSize must be an integer between 1 and ${maxValue}`,
    );
  }
  return pageSize;
}

function assertValidJson(args: string) {
  try {
    JSON.parse(args);
  } catch {
    throwError(ErrorCode.INVALID_ARGS_JSON, "Event args must be valid JSON");
  }
}

function eventsMatch(existing: PushEvent, event: PushEvent) {
  return (
    existing.seqNum === event.seqNum &&
    existing.parentSeqNum === event.parentSeqNum &&
    existing.name === event.name &&
    existing.clientId === event.clientId &&
    existing.sessionId === event.sessionId &&
    existing.args === event.args
  );
}

function mapListEvent(event: ListEventDoc) {
  return {
    seqNum: event.seqNum,
    parentSeqNum: event.parentSeqNum,
    name: event.name,
    args: event.args,
    clientId: event.clientId,
    sessionId: event.sessionId,
    userId: event.userId,
    createdAt: event._creationTime,
  };
}

function encodeListEventsCursor(
  event: ListEventDoc | undefined,
  fallbackCursor: string | null,
) {
  if (event === undefined) return fallbackCursor ?? LIST_EVENTS_START_CURSOR;
  return JSON.stringify({ createdAt: event._creationTime });
}

function decodeListEventsCursor(cursor: string | null) {
  if (cursor === null) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(cursor) as { createdAt?: unknown };
  } catch {
    throwError(ErrorCode.INVALID_CURSOR, "Invalid listEvents cursor");
  }
  if (parsed.createdAt === null) {
    return undefined;
  }
  if (typeof parsed.createdAt !== "number") {
    throwError(ErrorCode.INVALID_CURSOR, "Invalid listEvents cursor");
  }
  assertTimestamp(parsed.createdAt, "cursor.createdAt");
  return parsed.createdAt;
}

function resolveCreationTimeUpperBound(
  cursor: number | undefined,
  until: number | undefined,
): CreationTimeUpperBound | undefined {
  if (cursor === undefined) {
    return until === undefined ? undefined : { value: until, inclusive: true };
  }

  // `until` is inclusive, but the cursor is the last event from the previous
  // page, so it must be exclusive to avoid returning that event again.
  if (until !== undefined && until < cursor) {
    return { value: until, inclusive: true };
  }
  return { value: cursor, inclusive: false };
}

function withCreationTimeBounds(
  q: ListEventsIndexRange,
  {
    since,
    until,
    cursor,
  }: {
    since: number | undefined;
    until: number | undefined;
    cursor: number | undefined;
  },
) {
  const upperBound = resolveCreationTimeUpperBound(cursor, until);
  if (since !== undefined && upperBound !== undefined) {
    const lowerBounded = q.gte("_creationTime", since);
    return upperBound.inclusive
      ? lowerBounded.lte("_creationTime", upperBound.value)
      : lowerBounded.lt("_creationTime", upperBound.value);
  }
  if (since !== undefined) return q.gte("_creationTime", since);
  if (upperBound !== undefined) {
    return upperBound.inclusive
      ? q.lte("_creationTime", upperBound.value)
      : q.lt("_creationTime", upperBound.value);
  }
  return q;
}

function validateBatchLength(events: PushEvent[]) {
  if (events.length === 0) {
    throwError(ErrorCode.EMPTY_BATCH, "At least one event is required");
  }
  if (events.length > MAX_EVENTS_PER_PUSH) {
    throwError(
      ErrorCode.BATCH_TOO_LARGE,
      `Cannot push more than ${MAX_EVENTS_PER_PUSH} events`,
    );
  }
}

function validateBatch(events: PushEvent[], currentSeqNum: number) {
  validateBatchLength(events);

  let expectedParentSeqNum = currentSeqNum;
  for (const event of events) {
    assertSequenceNumber(event.seqNum, "seqNum");
    assertSequenceNumber(event.parentSeqNum, "parentSeqNum");
    assertValidJson(event.args);

    if (event.parentSeqNum !== expectedParentSeqNum) {
      throwError(
        ErrorCode.SEQ_NUM_CONFLICT,
        `Event parentSeqNum mismatch: expected ${expectedParentSeqNum}, got ${event.parentSeqNum}`,
      );
    }
    if (event.seqNum !== event.parentSeqNum + 1) {
      throwError(
        ErrorCode.SEQ_NUM_CONFLICT,
        `Event seqNum mismatch: expected ${event.parentSeqNum + 1}, got ${event.seqNum}`,
      );
    }
    expectedParentSeqNum = event.seqNum;
  }
}

export const push = mutation({
  args: {
    storeId: v.string(),
    events: v.array(
      v.object({
        seqNum: v.number(),
        parentSeqNum: v.number(),
        name: v.string(),
        args: v.string(),
        clientId: v.string(),
        sessionId: v.string(),
      }),
    ),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { storeId, events, userId }) => {
    validateBatchLength(events);

    // Get current head seqNum
    const headRow = await ctx.db
      .query("livestoreHeads")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .first();
    const currentSeqNum = headRow?.seqNum ?? 0;

    // Batch idempotency checks in parallel
    const existingChecks = await Promise.all(
      events.map(async (event) => {
        const existing = await ctx.db
          .query("livestoreEvents")
          .withIndex("by_storeId_seqNum", (q) =>
            q.eq("storeId", storeId).eq("seqNum", event.seqNum),
          )
          .first();

        if (existing !== null && !eventsMatch(existing, event)) {
          throwError(
            ErrorCode.DUPLICATE_EVENT_CONFLICT,
            "Duplicate event payload does not match existing event",
          );
        }

        return existing;
      }),
    );

    const allExisting = existingChecks.every((existing) => existing !== null);
    if (allExisting) {
      return;
    }

    if (existingChecks.some((existing) => existing !== null)) {
      throwError(
        ErrorCode.PARTIAL_DUPLICATE_BATCH,
        "Cannot push a partially duplicated event batch",
      );
    }

    validateBatch(events, currentSeqNum);

    for (const event of events) {
      await ctx.db.insert("livestoreEvents", {
        storeId,
        seqNum: event.seqNum,
        parentSeqNum: event.parentSeqNum,
        name: event.name,
        args: event.args,
        clientId: event.clientId,
        sessionId: event.sessionId,
        userId,
      });
    }

    // Upsert head
    const newSeqNum = events[events.length - 1].seqNum;
    if (headRow) {
      await ctx.db.patch("livestoreHeads", headRow._id, {
        seqNum: newSeqNum,
      });
    } else {
      await ctx.db.insert("livestoreHeads", {
        storeId,
        seqNum: newSeqNum,
      });
    }
  },
});

const CLEAR_BATCH_SIZE = 500;

export const clearStore = mutation({
  args: { storeId: v.string() },
  handler: async (ctx, { storeId }) => {
    let batch;
    do {
      batch = await ctx.db
        .query("livestoreEvents")
        .withIndex("by_storeId_seqNum", (q) => q.eq("storeId", storeId))
        .take(CLEAR_BATCH_SIZE);
      await Promise.all(
        batch.map((e) => ctx.db.delete("livestoreEvents", e._id)),
      );
    } while (batch.length === CLEAR_BATCH_SIZE);

    const head = await ctx.db
      .query("livestoreHeads")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .first();
    if (head) {
      await ctx.db.delete("livestoreHeads", head._id);
    }
  },
});

export const getHead = query({
  args: { storeId: v.string() },
  handler: async (ctx, { storeId }) => {
    const head = await ctx.db
      .query("livestoreHeads")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .first();
    return head?.seqNum ?? 0;
  },
});

export const pull = query({
  args: {
    storeId: v.string(),
    afterSeqNum: v.number(),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, { storeId, afterSeqNum, pageSize: pageSizeArg }) => {
    assertSequenceNumber(afterSeqNum, "afterSeqNum");
    const pageSize = resolvePageSize(
      pageSizeArg,
      PULL_PAGE_SIZE,
      MAX_PULL_PAGE_SIZE,
    );

    const events = await ctx.db
      .query("livestoreEvents")
      .withIndex("by_storeId_seqNum", (q) =>
        q.eq("storeId", storeId).gt("seqNum", afterSeqNum),
      )
      .take(pageSize + 1);

    const hasMore = events.length > pageSize;
    const page = hasMore ? events.slice(0, pageSize) : events;

    return {
      events: page.map((e) => ({
        seqNum: e.seqNum,
        parentSeqNum: e.parentSeqNum,
        name: e.name,
        args: e.args,
        clientId: e.clientId,
        sessionId: e.sessionId,
        userId: e.userId,
      })),
      hasMore,
    };
  },
});

export const listEvents = query({
  args: {
    storeId: v.string(),
    userId: v.optional(v.string()),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { storeId, userId, since, until, paginationOpts }) => {
    const cursor = decodeListEventsCursor(paginationOpts.cursor);
    if (since !== undefined) {
      assertTimestamp(since, "since");
    }
    if (until !== undefined) {
      assertTimestamp(until, "until");
    }
    if (since !== undefined && until !== undefined && since > until) {
      throwError(
        ErrorCode.INVALID_TIME_RANGE,
        "since must be less than or equal to until",
      );
    }
    const pageSize = resolvePageSize(
      paginationOpts.numItems,
      LIST_EVENTS_PAGE_SIZE,
      MAX_LIST_EVENTS_PAGE_SIZE,
    );

    const events =
      userId === undefined
        ? await ctx.db
            .query("livestoreEvents")
            .withIndex("by_storeId", (q) =>
              withCreationTimeBounds(q.eq("storeId", storeId), {
                since,
                until,
                cursor,
              }),
            )
            .order("desc")
            .take(pageSize + 1)
        : await ctx.db
            .query("livestoreEvents")
            .withIndex("by_storeId_userId", (q) =>
              withCreationTimeBounds(
                q.eq("storeId", storeId).eq("userId", userId),
                { since, until, cursor },
              ),
            )
            .order("desc")
            .take(pageSize + 1);

    const isDone = events.length <= pageSize;
    const page = isDone ? events : events.slice(0, pageSize);
    const lastEvent = page[page.length - 1];
    return {
      page: page.map(mapListEvent),
      isDone,
      continueCursor: encodeListEventsCursor(lastEvent, paginationOpts.cursor),
    };
  },
});
