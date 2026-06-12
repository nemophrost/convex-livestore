import {
  anyApi,
  type ApiFromModules,
  type DataModelFromSchemaDefinition,
  defineSchema,
  defineTable,
} from "convex/server";
import { v } from "convex/values";
import { describe, expect, test } from "vitest";
import { exposeApi } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";

const testSchema = defineSchema({
  users: defineTable({
    subject: v.string(),
  }).index("by_subject", ["subject"]),
});
type TestDataModel = DataModelFromSchemaDefinition<typeof testSchema>;

export const { pushEvents, getHead, pullEvents } = exposeApi(
  components.livestoreAdapter,
  {
    transformStoreId: async (ctx, { storeId }) => {
      if (storeId === "user") {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");
        return identity.subject;
      }
      throw new Error("Unknown storeId");
    },
  },
);

const testApi = (
  anyApi as unknown as ApiFromModules<{
    "index.test": {
      pushEvents: typeof pushEvents;
      getHead: typeof getHead;
      pullEvents: typeof pullEvents;
    };
  }>
)["index.test"];

describe("client tests", () => {
  test("exposeApi callbacks can be typed with the caller data model", () => {
    const typedApi = exposeApi<TestDataModel>(components.livestoreAdapter, {
      transformStoreId: async (ctx, { storeId }) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_subject", (q) => q.eq("subject", storeId))
          .first();

        // @ts-expect-error transformStoreId intentionally receives a read-only context.
        await ctx.db.insert("users", { subject: "blocked" });

        if (!user) throw new Error("Unknown user");
        return user._id;
      },
      resolveUserId: async (ctx) => {
        return await ctx.db.insert("users", { subject: "created-from-push" });
      },
    });

    expect(testSchema).toBeTruthy();
    expect(typedApi.getHead).toBeTruthy();
  });

  test("exposeApi transformStoreId callback is invoked and storeId is scoped", async () => {
    const t = initConvexTest().withIdentity({ subject: "user-1" });

    await t.mutation(testApi.pushEvents, {
      storeId: "user",
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "testEvent",
          args: '{"key":"value"}',
          clientId: "c1",
          sessionId: "s1",
        },
      ],
    });

    const head = await t.query(testApi.getHead, { storeId: "user" });
    expect(head).toBe(1);

    const result = await t.query(testApi.pullEvents, {
      storeId: "user",
      afterSeqNum: 0,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].name).toBe("testEvent");
    expect(result.events[0].args).toBe('{"key":"value"}');
  });

  test("different users have isolated stores", async () => {
    const t1 = initConvexTest().withIdentity({ subject: "user-1" });
    const t2 = initConvexTest().withIdentity({ subject: "user-2" });

    await t1.mutation(testApi.pushEvents, {
      storeId: "user",
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "user1Event",
          args: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
      ],
    });

    await t2.mutation(testApi.pushEvents, {
      storeId: "user",
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "user2Event",
          args: "{}",
          clientId: "c2",
          sessionId: "s2",
        },
      ],
    });

    const events1 = await t1.query(testApi.pullEvents, {
      storeId: "user",
      afterSeqNum: 0,
    });
    expect(events1.events).toHaveLength(1);
    expect(events1.events[0].name).toBe("user1Event");

    const events2 = await t2.query(testApi.pullEvents, {
      storeId: "user",
      afterSeqNum: 0,
    });
    expect(events2.events).toHaveLength(1);
    expect(events2.events[0].name).toBe("user2Event");
  });

  test("unauthenticated request rejects", async () => {
    const t = initConvexTest();
    await expect(t.query(testApi.getHead, { storeId: "user" })).rejects.toThrow(
      "Not authenticated",
    );
  });
});
