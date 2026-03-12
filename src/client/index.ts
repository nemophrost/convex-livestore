import {
  mutationGeneric,
  paginationOptsValidator,
  queryGeneric,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";
import { v } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";

/**
 * For re-exporting component functions with auth wrappers.
 *
 * Usage:
 * ```ts
 * export const { pushEvents, getHead, pullEvents } = exposeApi(
 *   components.livestoreAdapter,
 *   {
 *     transformStoreId: async (ctx, { storeId, op }) => {
 *       // validate auth and return the resolved storeId
 *       const identity = await ctx.auth.getUserIdentity();
 *       if (!identity) throw new Error("Not authenticated");
 *       return identity.subject;
 *     },
 *     resolveUserId: async (ctx) => {
 *       const identity = await ctx.auth.getUserIdentity();
 *       return identity?.subject ?? null;
 *     },
 *   },
 * );
 * ```
 */
export function exposeApi(
  component: ComponentApi,
  options: {
    /**
     * Validate or transform the passed storeId.
     * Called for all operations. Throw an error to reject the request.
     */
    transformStoreId: (
      ctx: GenericQueryCtx<GenericDataModel>,
      params: {
        storeId: string;
        op: "push" | "getHead" | "pull" | "clearStore" | "listEvents";
      },
    ) => Promise<string>;
    /**
     * Optionally resolve the userId to store with each pushed event.
     * Called only for push operations, after transformStoreId resolves.
     */
    resolveUserId?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      params: { storeId: string },
    ) => Promise<string | null | undefined>;
  },
) {
  return {
    pushEvents: mutationGeneric({
      args: {
        storeId: v.string(),
        events: v.array(
          v.object({
            seqNum: v.number(),
            parentSeqNum: v.number(),
            name: v.string(),
            data: v.string(),
            clientId: v.string(),
            sessionId: v.string(),
          }),
        ),
      },
      handler: async (ctx, args) => {
        const storeId = await options.transformStoreId(ctx, {
          storeId: args.storeId,
          op: "push",
        });
        const userId = await options.resolveUserId?.(ctx, { storeId });
        return await ctx.runMutation(component.events.push, {
          storeId,
          events: args.events,
          userId: userId ?? undefined,
        });
      },
    }),
    getHead: queryGeneric({
      args: {
        storeId: v.string(),
      },
      handler: async (ctx, args) => {
        try {
          const storeId = await options.transformStoreId(ctx, {
            storeId: args.storeId,
            op: "getHead",
          });
          return await ctx.runQuery(component.events.getHead, { storeId });
        } catch {
          return null;
        }
      },
    }),
    clearStore: mutationGeneric({
      args: { storeId: v.string() },
      handler: async (ctx, args) => {
        const storeId = await options.transformStoreId(ctx, {
          storeId: args.storeId,
          op: "clearStore",
        });
        return await ctx.runMutation(component.events.clearStore, { storeId });
      },
    }),
    pullEvents: queryGeneric({
      args: {
        storeId: v.string(),
        afterSeqNum: v.number(),
        pageSize: v.optional(v.number()),
      },
      handler: async (ctx, args) => {
        try {
          const storeId = await options.transformStoreId(ctx, {
            storeId: args.storeId,
            op: "pull",
          });
          return await ctx.runQuery(component.events.pull, {
            storeId,
            afterSeqNum: args.afterSeqNum,
            pageSize: args.pageSize,
          });
        } catch {
          return null;
        }
      },
    }),
    listEvents: queryGeneric({
      args: {
        storeId: v.string(),
        userId: v.optional(v.string()),
        since: v.optional(v.number()),
        until: v.optional(v.number()),
        paginationOpts: paginationOptsValidator,
      },
      handler: async (ctx, args) => {
        try {
          const storeId = await options.transformStoreId(ctx, {
            storeId: args.storeId,
            op: "listEvents",
          });
          return await ctx.runQuery(component.events.listEvents, {
            storeId,
            userId: args.userId,
            since: args.since,
            until: args.until,
            paginationOpts: args.paginationOpts,
          });
        } catch {
          return null;
        }
      },
    }),
  };
}

export type { ComponentApi };

// Re-export types for the sync backend (the actual implementation is in ./sync.ts)
export { makeConvexSyncBackend } from "./sync.js";
export type { ConvexLivestoreApiRefs } from "./sync.js";
