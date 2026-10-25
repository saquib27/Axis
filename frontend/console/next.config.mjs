import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Resolve the workspace root explicitly for Next.js file tracing. */
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import('next').NextConfig} */
export default {
  // @axis/shared is TypeScript source, consumed directly from the workspace.
  transpilePackages: ["@axis/shared"],
  outputFileTracingRoot: workspaceRoot,
};
