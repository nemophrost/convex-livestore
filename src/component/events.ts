import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";

const MAX_EVENTS_PER_PUSH = 500;

export const push = mutation({
  args: {
    storeId: v.string(),
    events: v.array(
      v.object({
        seqNum: v.number(), // client-assigned seqNum (stored as clientSeqNum)
        parentSeqNum: v.number(),
        name: v.string(),
        data: v.string(),
        clientId: v.string(),
        sessionId: v.string(),
      }),
    ),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { storeId, events: allEvents, userId }) => {
    const events = allEvents.slice(0, MAX_EVENTS_PER_PUSH);

    // Get current head seqNum
    const headRow = await ctx.db
      .query("livestoreHeads")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .first();
    let currentSeqNum = headRow?.seqNum ?? 0;

    // Batch idempotency checks in parallel
    const existingChecks = await Promise.all(
      events.map((event) =>
        ctx.db
          .query("livestoreEvents")
          .withIndex("by_storeId_clientId_clientSeqNum", (q) =>
            q
              .eq("storeId", storeId)
              .eq("clientId", event.clientId)
              .eq("clientSeqNum", event.seqNum),
          )
          .first(),
      ),
    );

    for (let i = 0; i < events.length; i++) {
      if (existingChecks[i]) continue;

      const event = events[i];
      currentSeqNum += 1;

      await ctx.db.insert("livestoreEvents", {
        storeId,
        seqNum: currentSeqNum,
        parentSeqNum: currentSeqNum - 1,
        clientSeqNum: event.seqNum,
        name: event.name,
        data: event.data,
        clientId: event.clientId,
        sessionId: event.sessionId,
        userId,
      });
    }

    // Upsert head
    if (headRow) {
      await ctx.db.patch("livestoreHeads", headRow._id, {
        seqNum: currentSeqNum,
      });
    } else if (currentSeqNum > 0) {
      await ctx.db.insert("livestoreHeads", { storeId, seqNum: currentSeqNum });
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
        data: e.data,
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
