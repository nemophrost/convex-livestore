import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  livestoreEvents: defineTable({
    storeId: v.string(),
    seqNum: v.number(),
    parentSeqNum: v.number(),
    clientSeqNum: v.number(),
    name: v.string(),
    data: v.string(), // JSON-encoded event args
    clientId: v.string(),
    sessionId: v.string(),
    userId: v.optional(v.string()),
  })
    .index("by_storeId", ["storeId"])
    .index("by_storeId_seqNum", ["storeId", "seqNum"])
    .index("by_storeId_userId", ["storeId", "userId"])
    .index("by_storeId_clientId_clientSeqNum", [
      "storeId",
      "clientId",
      "clientSeqNum",
    ]),
  livestoreHeads: defineTable({
    storeId: v.string(),
    seqNum: v.number(),
  }).index("by_storeId", ["storeId"]),
});
