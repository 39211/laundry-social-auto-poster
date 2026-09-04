// Thin wrapper around src/publicImageMetadata.ts. Run with tsx:
//   node --import tsx scripts/regen-public-image-metadata.mjs [repo-root]
//   npm run regen-public-image-metadata
import { regeneratePublicImageMetadata } from "../src/publicImageMetadata.ts";

const root = process.argv[2] ?? process.cwd();
await regeneratePublicImageMetadata(root);
