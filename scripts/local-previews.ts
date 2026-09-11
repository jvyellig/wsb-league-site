// Generate previews locally against the .data file store: LOCAL_BLOBS_DIR=.data npx tsx scripts/local-previews.ts [week]
import { generatePreviews } from '../src/lib/previews';
const week = Number(process.argv[2]) || undefined;
generatePreviews({ week }).then((r) => {
  console.log(r);
  process.exit(r.ok ? 0 : 1);
});
