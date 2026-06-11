import { UnknownError } from "@livestore/common";
import type {
  EventSequenceNumber,
  LiveStoreEvent,
} from "@livestore/common/schema";
import { SyncBackend } from "@livestore/common/sync";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReference } from "convex/server";
import { Effect, Option, Stream, SubscriptionRef } from "effect";

// These types mirror the Convex function signatures exposed via `exposeApi`.
export interface ConvexLivestoreApiRefs {
  pushEvents: FunctionReference<
    "mutation",
    "public",
    {
      storeId: string;
      events: Array<{
        seqNum: number;
        parentSeqNum: number;
        name: string;
        args: string;
        clientId: string;
        sessionId: string;
      }>;
    },
    void
  >;
  getHead: FunctionReference<
    "query",
    "public",
    { storeId: string },
    number | null
  >;
  pullEvents: FunctionReference<
    "query",
    "public",
    { storeId: string; afterSeqNum: number; pageSize?: number },
    {
      events: Array<{
        seqNum: number;
        parentSeqNum: number;
        name: string;
        args: string;
        clientId: string;
        sessionId: string;
        userId?: string | null;
      }>;
      hasMore: boolean;
    } | null
  >;
}

type PullEvent = {
  seqNum: number;
  parentSeqNum: number;
  name: string;
  args: string;
  clientId: string;
  sessionId: string;
};

type LiveStoreEventGlobalEncoded = LiveStoreEvent.Global.Encoded;
type EventSequenceNumberGlobal = EventSequenceNumber.Global.Type;
type SyncBackendType = SyncBackend.SyncBackend;

function mapEvents(events: readonly PullEvent[]) {
  return events.map((e) => ({
    eventEncoded: {
      name: e.name,
      args: JSON.parse(e.args),
      seqNum: e.seqNum as EventSequenceNumberGlobal,
      parentSeqNum: e.parentSeqNum as EventSequenceNumberGlobal,
      clientId: e.clientId,
      sessionId: e.sessionId,
    } satisfies LiveStoreEventGlobalEncoded,
    metadata: Option.none(),
  }));
}

const DEBUG_PREFIX = "Convex Livestore Sync: ";

/**
 * Creates a LiveStore SyncBackend that uses Convex as the event store.
 *
 * Push: sends events to Convex via mutation (server validates seqNums)
 * Pull: subscribes to head signal, fetches new events on change
 *
 * Usage:
 * ```ts
 * import { makeConvexSyncBackend } from "convex-livestore/react";
 * import { api } from "../convex/_generated/api";
 *
 * const backend = makeConvexSyncBackend(convex, {
 *   pushEvents: api.myModule.pushEvents,
 *   getHead: api.myModule.getHead,
 *   pullEvents: api.myModule.pullEvents,
 * });
 * ```
 */
export function makeConvexSyncBackend(
  convex: ConvexReactClient,
  apiRefs: ConvexLivestoreApiRefs,
  options: { debug?: boolean } = {},
): SyncBackend.SyncBackendConstructor {
  const debugLog = options.debug ? console.debug : () => {};

  return ({ storeId }) => {
    return Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(true);

      const backend: SyncBackendType = {
        connect: Effect.void,

        pull: (cursorOption, options) => {
          const afterSeqNum = Option.isSome(cursorOption)
            ? cursorOption.value.eventSequenceNumber
            : 0;
          const live = options?.live === true;

          return Stream.async((emit) => {
            let cursor = afterSeqNum;

            async function fetchOnePage() {
              debugLog(`${DEBUG_PREFIX}Pulling events...`, {
                storeId,
                afterSeqNum: cursor,
              });
              const result = await convex.query(apiRefs.pullEvents, {
                storeId,
                afterSeqNum: cursor,
              });
              debugLog(
                `${DEBUG_PREFIX}Pulled ${result?.events.length ?? 0} events`,
                { hasMore: result?.hasMore },
              );
              return result;
            }

            async function fetchAllPages() {
              while (true) {
                const result = await fetchOnePage();
                if (!result || result.events.length === 0) break;
                cursor = result.events[result.events.length - 1].seqNum;
                await emit.single({
                  batch: mapEvents(result.events),
                  pageInfo: result.hasMore
                    ? SyncBackend.pageInfoMoreUnknown
                    : SyncBackend.pageInfoNoMore,
                });
                if (!result.hasMore) break;
              }
            }

            if (!live) {
              // Non-live: paginate through all current events, then end the stream
              void fetchAllPages()
                .catch((error) => console.error("Pull fetch failed:", error))
                .finally(() => emit.end());
              return Effect.void;
            }

            // Live: subscribe to head changes, fetch on each change
            let fetching = false;
            let queuedFetch = false;

            async function fetchUpdates() {
              if (fetching) {
                debugLog(
                  `${DEBUG_PREFIX}Head changed, fetch already in progress — queuing`,
                );
                queuedFetch = true;
                return;
              }
              const headSeqNum = watch.localQueryResult();
              if (headSeqNum == null || headSeqNum <= cursor) {
                debugLog(
                  `${DEBUG_PREFIX}Head changed but no new events (head=${headSeqNum}, cursor=${cursor})`,
                );
                return;
              }
              debugLog(
                `${DEBUG_PREFIX}Fetching updates (head=${headSeqNum}, cursor=${cursor})`,
              );
              fetching = true;
              try {
                await fetchAllPages();
              } catch (error) {
                console.error("Pull fetch failed:", error);
              } finally {
                fetching = false;
                if (queuedFetch) {
                  queuedFetch = false;
                  void fetchUpdates();
                }
              }
            }

            debugLog(`${DEBUG_PREFIX}Subscribing to head changes`);
            const watch = convex.watchQuery(apiRefs.getHead, { storeId });
            const unsubscribe = watch.onUpdate(() => {
              debugLog(
                `${DEBUG_PREFIX}Head change received`,
                watch.localQueryResult(),
              );
              void fetchUpdates();
            });
            // Kick off initial fetch (onUpdate may not fire if result is already cached)
            void fetchUpdates();

            return Effect.sync(() => {
              debugLog(`${DEBUG_PREFIX}Unsubscribed from head changes`);
              return unsubscribe();
            });
          });
        },

        push: (batch: ReadonlyArray<LiveStoreEventGlobalEncoded>) =>
          Effect.tryPromise({
            try: async () => {
              debugLog(`${DEBUG_PREFIX}Pushing ${batch.length} event(s)`);
              await convex.mutation(apiRefs.pushEvents, {
                storeId,
                events: [...batch].map((e) => ({
                  seqNum: e.seqNum,
                  parentSeqNum: e.parentSeqNum,
                  name: e.name,
                  args: JSON.stringify(e.args),
                  clientId: e.clientId,
                  sessionId: e.sessionId,
                })),
              });
              debugLog(`${DEBUG_PREFIX}Pushed ${batch.length} event(s)`);
            },
            catch: (error): UnknownError => {
              console.error("Push failed:", error);
              return new UnknownError({ cause: error });
            },
          }),

        ping: Effect.void,

        isConnected,

        metadata: {
          name: "convex",
          description: "Convex-based sync backend",
        },

        supports: {
          pullPageInfoKnown: true,
          pullLive: true,
        },
      };

      return backend;
    });
  };
}
