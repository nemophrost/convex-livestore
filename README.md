# convex-livestore

A [Convex](https://convex.dev) component that provides a sync backend for [LiveStore](https://livestore.dev).

LiveStore is a local-first state management library. This component stores and serves its event log using Convex, so events are persisted, replicated across clients in real time, and scoped per store.

Found a bug? Feature request? [File it here](https://github.com/nemophrost/convex-livestore/issues).

## Installation

```sh
npm install convex-livestore
```

Register the component in your app's `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import livestoreAdapter from "convex-livestore/convex.config.js";

const app = defineApp();
app.use(livestoreAdapter);

export default app;
```

## Server-side setup

Use `exposeApi` to expose the sync functions from your Convex backend. The `transformStoreId` callback runs on every request — use it to authenticate the caller and map the client-supplied `storeId` to the one stored internally.

```ts
// convex/example.ts
import { exposeApi } from "convex-livestore";
import { components } from "./_generated/api.js";

export const { pushEvents, getHead, pullEvents, clearStore, listEvents } = exposeApi(
  components.livestoreAdapter,
  {
    transformStoreId: async (ctx, { storeId, op }) => {
      if (storeId === "user") {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");
        // Each user gets their own isolated event log
        return identity.subject;
      }
      throw new Error("Unknown storeId");
    },
    resolveUserId: async (ctx) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity?.subject ?? null;
    },
  },
);
```

`transformStoreId` receives:
- `ctx` — a Convex **query** context: `ctx.auth` for identity, `ctx.db` for read-only lookups. No writes — this callback runs for both queries and mutations.
- `params.storeId` — the value sent by the client
- `params.op` — `"push"` | `"getHead"` | `"pull"` | `"clearStore"` | `"listEvents"`

Throw an error to reject the request. Return the resolved `storeId` (a string) to allow it — this is the key used to scope the event log in the database.

`resolveUserId` is an optional callback, called only on push. It receives a Convex **mutation** context (`ctx.auth`, `ctx.db` with full read/write access), and the resolved `storeId`. Return the user ID to store alongside each event — useful for filtering with `listEvents`.

`clearStore` deletes all events and resets the head for a given store. Call it when you need to wipe a store's history — for example, during development or when a user's data should be reset.

## Browsing the event log

`listEvents` is a paginated query for browsing a store's event log, newest-first. It's intended for admin or audit views, not for sync. Use it with Convex's [`usePaginatedQuery`](https://docs.convex.dev/api/modules/react#usepaginatedquery):

```ts
const { results, status, loadMore } = usePaginatedQuery(
  api.example.listEvents,
  { storeId: "user" },
  { initialNumItems: 50 },
);
```

Pass `userId` to filter to events pushed by a specific user (requires `resolveUserId` to be configured):

```ts
const { results } = usePaginatedQuery(
  api.example.listEvents,
  { storeId: "user", userId: "user-123" },
  { initialNumItems: 50 },
);
```

Pass `since` and/or `until` (Unix timestamps in milliseconds) to filter by time range:

```ts
const { results } = usePaginatedQuery(
  api.example.listEvents,
  { storeId: "user", since: Date.now() - 24 * 60 * 60 * 1000 },
  { initialNumItems: 50 },
);
```

## Client-side setup

Use `makeConvexSyncBackend` from `convex-livestore/react` to create the LiveStore sync backend:

```ts
import { makeConvexSyncBackend } from "convex-livestore/react";
import { useConvex } from "convex/react";
import { api } from "../convex/_generated/api";

const convex = useConvex();

const backend = makeConvexSyncBackend(convex, {
  pushEvents: api.example.pushEvents,
  getHead: api.example.getHead,
  pullEvents: api.example.pullEvents,
});
```

Pass the backend to your LiveStore `storeOptions`. The `storeId` you set here is forwarded to `transformStoreId` on the server:

```ts
const options = storeOptions({
  storeId: "user",
  schema,
  adapter: makePersistedAdapter({ sync: { backend } }),
});
```

## Running the example

```sh
npm i
npm run dev
```
