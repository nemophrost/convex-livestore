import {
  type MutationBuilder,
  mutationGeneric,
  paginationOptsValidator,
  type QueryBuilder,
  queryGeneric,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";
import { v } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";

export type ExposeApiOperation =
  | "push"
  | "getHead"
  | "pull"
  | "clearStore"
  | "listEvents";

export type ExposeApiOptions<
  DataModel extends GenericDataModel = GenericDataModel,
> = {
  /**
   * Validate or transform the passed storeId.
   * Called for all operations. Throw an error to reject the request.
   */
  transformStoreId: (
    ctx: GenericQueryCtx<DataModel>,
    params: {
      storeId: string;
      op: ExposeApiOperation;
    },
  ) => Promise<string>;
  /**
   * Optionally resolve the userId to store with each pushed event.
   * Called only for push operations, after transformStoreId resolves.
   */
  resolveUserId?: (
    ctx: GenericMutationCtx<DataModel>,
    params: { storeId: string },
  ) => Promise<string | null | undefined>;
};

/**
 * For re-exporting component functions with auth wrappers.
 *
 * Usage:
 * ```ts
 * import type { DataModel } from "./_generated/dataModel.js";
 *
 * export const { pushEvents, getHead, pullEvents } = exposeApi<DataModel>(
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
export function exposeApi<
  DataModel extends GenericDataModel = GenericDataModel,
>(component: ComponentApi, options: ExposeApiOptions<DataModel>) {
  const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
  const query = queryGeneric as QueryBuilder<DataModel, "public">;

  return {
    pushEvents: mutation({
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
    getHead: query({
      args: {
        storeId: v.string(),
      },
      handler: async (ctx, args) => {
        const storeId = await options.transformStoreId(ctx, {
          storeId: args.storeId,
          op: "getHead",
        });
        return await ctx.runQuery(component.events.getHead, { storeId });
      },
    }),
    clearStore: mutation({
      args: { storeId: v.string() },
      handler: async (ctx, args) => {
        const storeId = await options.transformStoreId(ctx, {
          storeId: args.storeId,
          op: "clearStore",
        });
        return await ctx.runMutation(component.events.clearStore, { storeId });
      },
    }),
    pullEvents: query({
      args: {
        storeId: v.string(),
        afterSeqNum: v.number(),
        pageSize: v.optional(v.number()),
      },
      handler: async (ctx, args) => {
        const storeId = await options.transformStoreId(ctx, {
          storeId: args.storeId,
          op: "pull",
        });
        return await ctx.runQuery(component.events.pull, {
          storeId,
          afterSeqNum: args.afterSeqNum,
          pageSize: args.pageSize,
        });
      },
    }),
    listEvents: query({
      args: {
        storeId: v.string(),
        userId: v.optional(v.string()),
        since: v.optional(v.number()),
        until: v.optional(v.number()),
        paginationOpts: paginationOptsValidator,
      },
      handler: async (ctx, args) => {
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
      },
    }),
  };
}

export type { ComponentApi };
export { ErrorCode } from "../component/errors.js";
export type {
  ErrorCode as ErrorCodeType,
  ConvexLivestoreErrorData,
} from "../component/errors.js";
