import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

export default defineConfig({
  output: 'server',
  // Local dev only: skip the Edge Functions emulator (needs Deno). Production is unaffected.
  adapter: netlify({ devFeatures: { edgeFunctions: false } }),
  site: 'https://wsbgenerations.com',
});
