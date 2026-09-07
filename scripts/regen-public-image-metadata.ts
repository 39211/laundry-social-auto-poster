import { regeneratePublicImageMetadata } from "../src/publicImageMetadata";

const root = process.argv[2] ?? process.cwd();
regeneratePublicImageMetadata(root, { env: process.env });
