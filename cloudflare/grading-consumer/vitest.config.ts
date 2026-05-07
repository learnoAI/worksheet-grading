import { defineConfig } from 'vitest/config';
import path from 'node:path';

// `cloudflare:workers` and `cloudflare:workflows` are runtime-only modules
// supplied by the Workers/Workflows runtime — Node + Vitest can't resolve
// them. Alias both to a Node-side stub so importing `gradingWorkflow.ts`
// from a test (transitively, via `index.ts`'s re-export) doesn't blow up
// at module-load time. Tests that exercise the workflow class itself
// should mock the relevant tier helpers; the stub here only keeps imports
// resolvable.
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, 'src/__test__/cloudflare-workers-stub.ts'),
      'cloudflare:workflows': path.resolve(__dirname, 'src/__test__/cloudflare-workflows-stub.ts'),
    },
  },
});
