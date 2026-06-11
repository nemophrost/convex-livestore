import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";

const MAX_EVENTS_PER_PUSH = 500;

type PushEvent = {
  seqNum: number;
  parentSeqNum: number;
  name: string;
  args: string;
  clientId: string;
  sessionId: string;
};

function assertSequenceNumber(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function assertValidJson(args: string) {
  try {
    JSON.parse(args);
  } catch {
    throw new Error("Event args must be valid JSON");
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

function validateBatchLength(events: PushEvent[]) {
  if (events.length === 0) {
    throw new Error("At least one event is required");
  }
  if (events.length > MAX_EVENTS_PER_PUSH) {
    throw new Error(`Cannot push more than ${MAX_EVENTS_PER_PUSH} events`);
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
      throw new Error(
        `Event parentSeqNum mismatch: expected ${expectedParentSeqNum}, got ${event.parentSeqNum}`,
      );
    }
    if (event.seqNum !== event.parentSeqNum + 1) {
      throw new Error(
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
          throw new Error(
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
      throw new Error("Cannot push a partially duplicated event batch");
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

const PULL_PAGE_SIZE = 100;

export const pull = query({
  args: {
    storeId: v.string(),
    afterSeqNum: v.number(),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, { storeId, afterSeqNum, pageSize: pageSizeArg }) => {
    const pageSize = pageSizeArg ?? PULL_PAGE_SIZE;

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
    if (userId !== undefined) {
      return ctx.db
        .query("livestoreEvents")
        .withIndex("by_storeId_userId", (q) => {
          const base = q.eq("storeId", storeId).eq("userId", userId);
          if (since !== undefined && until !== undefined)
            return base.gte("_creationTime", since).lte("_creationTime", until);
          if (since !== undefined) return base.gte("_creationTime", since);
          if (until !== undefined) return base.lte("_creationTime", until);
          return base;
        })
        .order("desc")
        .paginate(paginationOpts);
    }
    return ctx.db
      .query("livestoreEvents")
      .withIndex("by_storeId", (q) => {
        const base = q.eq("storeId", storeId);
        if (since !== undefined && until !== undefined)
          return base.gte("_creationTime", since).lte("_creationTime", until);
        if (since !== undefined) return base.gte("_creationTime", since);
        if (until !== undefined) return base.lte("_creationTime", until);
        return base;
      })
      .order("desc")
      .paginate(paginationOpts);
  },
});
