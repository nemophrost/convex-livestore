/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("component lib", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("pushEvents inserts events and updates head", async () => {
    const t = initConvexTest();
    const storeId = "store-1";

    await t.mutation(api.events.push, {
      storeId,
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "todoCreated",
          data: '{"id":"abc"}',
          clientId: "client-1",
          sessionId: "session-1",
        },
        {
          seqNum: 2,
          parentSeqNum: 1,
          name: "todoUpdated",
          data: '{"id":"abc","text":"hello"}',
          clientId: "client-1",
          sessionId: "session-1",
        },
      ],
    });

    const head = await t.query(api.events.getHead, { storeId });
    expect(head).toBe(2);
  });

  test("pullEvents returns events after seqNum", async () => {
    const t = initConvexTest();
    const storeId = "store-1";

    await t.mutation(api.events.push, {
      storeId,
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "event1",
          data: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
        {
          seqNum: 2,
          parentSeqNum: 1,
          name: "event2",
          data: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
        {
          seqNum: 3,
          parentSeqNum: 2,
          name: "event3",
          data: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
      ],
    });

    const result = await t.query(api.events.pull, {
      storeId,
      afterSeqNum: 1,
    });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].name).toBe("event2");
    expect(result.events[1].name).toBe("event3");
    expect(result.hasMore).toBe(false);
  });

  test("pullEvents pagination", async () => {
    const t = initConvexTest();
    const storeId = "store-1";

    // Push 101 events to exceed PULL_PAGE_SIZE (100)
    await t.mutation(api.events.push, {
      storeId,
      events: Array.from({ length: 101 }, (_, i) => ({
        seqNum: i + 1,
        parentSeqNum: i,
        name: `e${i + 1}`,
        data: "{}",
        clientId: "c1",
        sessionId: "s1",
      })),
    });

    const page1 = await t.query(api.events.pull, {
      storeId,
      afterSeqNum: 0,
    });
    expect(page1.events).toHaveLength(100);
    expect(page1.hasMore).toBe(true);

    const page2 = await t.query(api.events.pull, {
      storeId,
      afterSeqNum: page1.events[99].seqNum,
    });
    expect(page2.events).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  test("pullEvents respects pageSize", async () => {
    const t = initConvexTest();
    const storeId = "store-1";

    await t.mutation(api.events.push, {
      storeId,
      events: Array.from({ length: 3 }, (_, i) => ({
        seqNum: i + 1,
        parentSeqNum: i,
        name: `e${i + 1}`,
        data: "{}",
        clientId: "c1",
        sessionId: "s1",
      })),
    });

    const page1 = await t.query(api.events.pull, {
      storeId,
      afterSeqNum: 0,
      pageSize: 2,
    });
    expect(page1.events).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await t.query(api.events.pull, {
      storeId,
      afterSeqNum: page1.events[1].seqNum,
      pageSize: 2,
    });
    expect(page2.events).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  test("idempotent push (duplicate events are skipped)", async () => {
    const t = initConvexTest();
    const storeId = "store-1";

    const event = {
      seqNum: 1,
      parentSeqNum: 0,
      name: "event1",
      data: "{}",
      clientId: "c1",
      sessionId: "s1",
    };

    await t.mutation(api.events.push, { storeId, events: [event] });
    await t.mutation(api.events.push, { storeId, events: [event] });

    const result = await t.query(api.events.pull, {
      storeId,
      afterSeqNum: 0,
    });
    expect(result.events).toHaveLength(1);
    const head = await t.query(api.events.getHead, { storeId });
    expect(head).toBe(1);
  });

  test("multiple stores are isolated", async () => {
    const t = initConvexTest();

    await t.mutation(api.events.push, {
      storeId: "store-a",
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "eventA",
          data: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
      ],
    });

    await t.mutation(api.events.push, {
      storeId: "store-b",
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "eventB",
          data: "{}",
          clientId: "c2",
          sessionId: "s2",
        },
      ],
    });

    const headA = await t.query(api.events.getHead, { storeId: "store-a" });
    const headB = await t.query(api.events.getHead, { storeId: "store-b" });
    expect(headA).toBe(1);
    expect(headB).toBe(1);

    const eventsA = await t.query(api.events.pull, {
      storeId: "store-a",
      afterSeqNum: 0,
    });
    expect(eventsA.events).toHaveLength(1);
    expect(eventsA.events[0].name).toBe("eventA");

    const eventsB = await t.query(api.events.pull, {
      storeId: "store-b",
      afterSeqNum: 0,
    });
    expect(eventsB.events).toHaveLength(1);
    expect(eventsB.events[0].name).toBe("eventB");
  });

  test("getHead returns 0 for unknown store", async () => {
    const t = initConvexTest();
    const head = await t.query(api.events.getHead, { storeId: "nonexistent" });
    expect(head).toBe(0);
  });

  test("clearStore removes all events and head", async () => {
    const t = initConvexTest();
    const storeId = "store-1";

    await t.mutation(api.events.push, {
      storeId,
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "e1",
          data: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
        {
          seqNum: 2,
          parentSeqNum: 1,
          name: "e2",
          data: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
      ],
    });

    await t.mutation(api.events.clearStore, { storeId });

    const head = await t.query(api.events.getHead, { storeId });
    expect(head).toBe(0);

    const result = await t.query(api.events.pull, { storeId, afterSeqNum: 0 });
    expect(result.events).toHaveLength(0);
  });

  test("clearStore only affects the target store", async () => {
    const t = initConvexTest();

    await t.mutation(api.events.push, {
      storeId: "store-a",
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "e1",
          data: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
      ],
    });
    await t.mutation(api.events.push, {
      storeId: "store-b",
      events: [
        {
          seqNum: 1,
          parentSeqNum: 0,
          name: "e2",
          data: "{}",
          clientId: "c1",
          sessionId: "s1",
        },
      ],
    });

    await t.mutation(api.events.clearStore, { storeId: "store-a" });

    const headA = await t.query(api.events.getHead, { storeId: "store-a" });
    expect(headA).toBe(0);

    const headB = await t.query(api.events.getHead, { storeId: "store-b" });
    expect(headB).toBe(1);
  });
});
