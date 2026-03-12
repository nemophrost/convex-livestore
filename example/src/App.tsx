import "./App.css";

/**
 * Minimal LiveStore + Convex example.
 *
 * In a real app, you would:
 * 1. Define your LiveStore schema (events + state materializers)
 * 2. Use `makeConvexSyncBackend` from "convex-livestore/react" to create the sync backend
 * 3. Pass it to `storeOptions({ adapter: { sync: { backend } } })`
 * 4. Use `useStore()` from @livestore/react
 *
 * Example wiring (pseudocode):
 *
 * ```ts
 * import { makeConvexSyncBackend } from "convex-livestore/react";
 * import { api } from "../convex/_generated/api";
 * import { useConvex } from "convex/react";
 *
 * const convex = useConvex();
 * const backend = makeConvexSyncBackend(convex, {
 *   pushEvents: api.example.pushEvents,
 *   getHead: api.example.getHead,
 *   pullEvents: api.example.pullEvents,
 * });
 *
 * const options = storeOptions({
 *   storeId: "user",
 *   schema,
 *   adapter: makePersistedAdapter({ sync: { backend } }),
 * });
 *
 * const { useQuery, commit } = useStore(options);
 * ```
 */
function App() {
  return (
    <>
      <h1>LiveStore + Convex Example</h1>
      <div className="card">
        <p>
          See <code>example/convex/example.ts</code> for the server-side wiring
          with <code>exposeApi</code>.
        </p>
        <p>
          Use <code>makeConvexSyncBackend</code> from{" "}
          <code>convex-livestore/react</code> to create the browser-side sync
          backend.
        </p>
      </div>
    </>
  );
}

export default App;
