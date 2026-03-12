import livestoreAdapter from "convex-livestore/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(livestoreAdapter);

export default app;
