import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api } from "./_generated/api";

describe("example", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  test("pushEvents and pullEvents via exposeApi", async () => {
    const t = initConvexTest().withIdentity({ subject: "user-1" });

    await t.mutation(api.example.pushEvents, {
      storeId: "user",
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "testEvent",
          data: '{"hello":"world"}',
          clientId: "c1",
          sessionId: "s1",
        },
      ],
    });

    const head = await t.query(api.example.getHead, { storeId: "user" });
    expect(head).toBe(1);

    const result = await t.query(api.example.pullEvents, {
      storeId: "user",
      afterSeqNum: 0,
    });
    expect(result!.events).toHaveLength(1);
    expect(result!.events[0].name).toBe("testEvent");
  });
});
