// isMain-free entry. package.json at merge should be:
//   "regen-public-image-metadata": "node --import tsx scripts/regen-public-image-metadata.mjs"
// Direct / tests / CI equivalent (no npm script name):
//   node --import tsx scripts/regen-public-image-metadata.mjs [repo-root]
import { regeneratePublicImageMetadata } from "../src/publicImageMetadata.ts";

const root = process.argv[2] ?? process.cwd();
regeneratePublicImageMetadata(root, { env: process.env });
