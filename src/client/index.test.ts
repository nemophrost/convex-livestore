import { anyApi, type ApiFromModules } from "convex/server";
import { describe, expect, test } from "vitest";
import { exposeApi } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";

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
    expect(result!.events).toHaveLength(1);
    expect(result!.events[0].name).toBe("testEvent");
    expect(result!.events[0].args).toBe('{"key":"value"}');
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
    expect(events1!.events).toHaveLength(1);
    expect(events1!.events[0].name).toBe("user1Event");

    const events2 = await t2.query(testApi.pullEvents, {
      storeId: "user",
      afterSeqNum: 0,
    });
    expect(events2!.events).toHaveLength(1);
    expect(events2!.events[0].name).toBe("user2Event");
  });

  test("unauthenticated request returns null", async () => {
    const t = initConvexTest();
    const head = await t.query(testApi.getHead, { storeId: "user" });
    expect(head).toBeNull();
  });
});
