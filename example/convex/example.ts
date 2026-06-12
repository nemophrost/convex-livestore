import { exposeApi } from "convex-livestore";
import type { Auth } from "convex/server";
import { components } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";

/**
 * Expose LiveStore sync functions with authentication.
 *
 * The `transformStoreId` callback validates or transforms the passed storeId
 * that scopes the event log. Here we use the user's identity as the storeId,
 * so each user has their own isolated event stream.
 */
export const { pushEvents, getHead, pullEvents, clearStore, listEvents } =
  exposeApi<DataModel>(components.livestoreAdapter, {
    transformStoreId: async (ctx, { storeId }) => {
      if (storeId === "user") {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Not authenticated");
        return userId;
      }
      throw new Error("Unknown store Id");
    },
    resolveUserId: async (ctx) => getAuthUserId(ctx),
  });

async function getAuthUserId(ctx: { auth: Auth }) {
  return (await ctx.auth.getUserIdentity())?.subject ?? null;
}
