/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    events: {
      clearStore: FunctionReference<
        "mutation",
        "internal",
        { storeId: string },
        any,
        Name
      >;
      getHead: FunctionReference<
        "query",
        "internal",
        { storeId: string },
        any,
        Name
      >;
      listEvents: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          since?: number;
          storeId: string;
          until?: number;
          userId?: string;
        },
        any,
        Name
      >;
      pull: FunctionReference<
        "query",
        "internal",
        { afterSeqNum: number; pageSize?: number; storeId: string },
        any,
        Name
      >;
      push: FunctionReference<
        "mutation",
        "internal",
        {
          events: Array<{
            clientId: string;
            args: string;
            name: string;
            parentSeqNum: number;
            seqNum: number;
            sessionId: string;
          }>;
          storeId: string;
          userId?: string;
        },
        any,
        Name
      >;
    };
  };
