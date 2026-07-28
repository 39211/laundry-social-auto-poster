import { describe, expect, it } from "vitest";
import { findC2paManifestSize } from "../src/imageProvenance";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  // The scanner walks by declared length and never validates the CRC, so any
  // four bytes stand in for it here.
  return Buffer.concat([length, Buffer.from(type, "latin1"), payload, Buffer.alloc(4)]);
}

function png(...chunks: Buffer[]): Buffer {
  return Buffer.concat([SIGNATURE, ...chunks, chunk("IEND", Buffer.alloc(0))]);
}

describe("C2PA manifest detection", () => {
  it("reports the manifest size when the image model left its provenance behind", () => {
    const image = png(chunk("IHDR", Buffer.alloc(13)), chunk("caBX", Buffer.alloc(2048)), chunk("IDAT", Buffer.alloc(64)));
    expect(findC2paManifestSize(image)).toBe(2048);
  });

  it("reports nothing once a re-encode has dropped the manifest", () => {
    const image = png(chunk("IHDR", Buffer.alloc(13)), chunk("IDAT", Buffer.alloc(64)));
    expect(findC2paManifestSize(image)).toBeUndefined();
  });

  it("stops at IEND rather than reading trailing bytes as chunks", () => {
    const image = Buffer.concat([
      png(chunk("IHDR", Buffer.alloc(13))),
      chunk("caBX", Buffer.alloc(999))
    ]);
    expect(findC2paManifestSize(image)).toBeUndefined();
  });

  it("ignores a file that is not a PNG", () => {
    expect(findC2paManifestSize(Buffer.from("not a png at all"))).toBeUndefined();
  });
});
