import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateGrokHandoff } from "../src/validateGrokHandoff";
import type { VideoMetadata } from "../src/videoMedia";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createHandoff(options: { manualStatus?: string; withClip?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "laundry-grok-handoff-"));
  roots.push(root);
  const handoff = join(root, "handoff");
  const input = "first-frame";
  const prompt = "one action";
  const tts = "eight-second-tts";
  const clip = "returned-video";

  await mkdir(join(handoff, "input"), { recursive: true });
  await mkdir(join(handoff, "prompts"), { recursive: true });
  await writeFile(join(handoff, "input", "frame.png"), input, "utf8");
  await writeFile(join(handoff, "input", "voice.wav"), tts, "utf8");
  await writeFile(join(handoff, "prompts", "shot.txt"), prompt, "utf8");
  if (options.withClip) {
    await mkdir(join(handoff, "clip-drop"), { recursive: true });
    await writeFile(join(handoff, "clip-drop", "shot.mp4"), clip, "utf8");
  }

  await writeJson(join(handoff, "data", "grok-web-handoff-manifest-v01.json"), {
    schema_version: "1.1",
    handoff_id: "test-handoff",
    status: "handoff_ready",
    state: {
      handoff_ready: true,
      generated: false,
      technical_validated: false,
      creative_validated: false,
      publish_authorized: false
    },
    authorization: {
      automated_generation_authorized: false,
      manual_web_submission: "owner_action_required"
    },
    pipeline: {
      assignment_status: "unassigned",
      date: null,
      slot: null,
      import_ready: false
    },
    shot: {
      input: { file: "input/frame.png", bytes: input.length, sha256: hash(input) },
      prompt: { file: "prompts/shot.txt", bytes: prompt.length, sha256: hash(prompt) },
      expected_download: "clip-drop/shot.mp4"
    },
    postproduction_audio: {
      tts_file: "input/voice.wav",
      bytes: tts.length,
      sha256: hash(tts)
    }
  });
  await writeJson(join(handoff, "data", "manual-run-record-v01.json"), {
    status: options.manualStatus ?? "not_submitted",
    page_or_post_url: options.withClip ? "https://grok.com/imagine/test" : null,
    source_reference: options.withClip ? "manual-project-test" : null,
    expected_download: "clip-drop/shot.mp4",
    download_sha256: options.withClip ? hash(clip) : null
  });
  return { root, handoff };
}

const validMetadata: VideoMetadata = {
  duration_seconds: 6,
  width: 720,
  height: 1280,
  frame_rate: 30,
  video_codec: "h264",
  audio_codec: "aac",
  audio_sample_rate: 48_000,
  format_name: "mov,mp4"
};

describe("Grok web handoff validation", () => {
  it("reports a consistent package as handoff ready without claiming generation", async () => {
    const { root, handoff } = await createHandoff();

    const report = await validateGrokHandoff({
      handoffDir: handoff,
      root,
      writeReport: true,
      now: new Date("2026-07-28T00:00:00.000Z")
    });

    expect(report).toMatchObject({
      status: "handoff_ready",
      state: {
        handoff_ready: true,
        generated: false,
        technical_validated: false,
        creative_validated: false,
        pipeline_assigned: false,
        standalone_test: false,
        publish_authorized: false,
        publish_ready: false
      }
    });
    expect(report.blockers).toEqual(
      expect.arrayContaining(["pipeline_target_unassigned", "returned_clip_missing"])
    );
    const persisted = JSON.parse(
      await readFile(join(handoff, "qa", "handoff-validation-v01.json"), "utf8")
    ) as Record<string, unknown>;
    expect(persisted.status).toBe("handoff_ready");
  });

  it("technically validates a returned clip but keeps creative and publish gates closed", async () => {
    const { root, handoff } = await createHandoff({ manualStatus: "downloaded", withClip: true });
    const probe = vi.fn().mockResolvedValue(validMetadata);
    const decode = vi.fn().mockResolvedValue(undefined);

    const report = await validateGrokHandoff({
      handoffDir: handoff,
      root,
      probe,
      decode,
      now: new Date("2026-07-28T00:00:00.000Z")
    });

    expect(report).toMatchObject({
      status: "returned_clip_technical_pass",
      state: {
        generated: true,
        technical_validated: true,
        creative_validated: false,
        standalone_test: false,
        publish_authorized: false,
        publish_ready: false
      },
      returned_clip: {
        file: "clip-drop/shot.mp4",
        sha256: hash("returned-video"),
        metadata: validMetadata
      }
    });
    expect(probe).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledOnce();
  });

  it("fails closed when a returned file has no completed provenance record", async () => {
    const { root, handoff } = await createHandoff({ manualStatus: "submitted", withClip: true });
    await writeJson(join(handoff, "data", "manual-run-record-v01.json"), {
      status: "submitted",
      page_or_post_url: null,
      source_reference: null,
      expected_download: "clip-drop/shot.mp4",
      download_sha256: null
    });

    const report = await validateGrokHandoff({ handoffDir: handoff, root });

    expect(report).toMatchObject({
      status: "invalid",
      state: {
        generated: true,
        technical_validated: false,
        creative_validated: false,
        standalone_test: false,
        publish_authorized: false,
        publish_ready: false
      }
    });
    expect(report.blockers).toContain("returned_clip_provenance_not_recorded");
  });

  it("accepts an owner-authorized standalone test without assigning a publish slot", async () => {
    const { root, handoff } = await createHandoff();
    const manifestPath = join(handoff, "data", "grok-web-handoff-manifest-v01.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      authorization: { manual_web_submission: string };
      pipeline: { assignment_status: string };
    };
    manifest.authorization.manual_web_submission = "owner_authorized";
    manifest.pipeline.assignment_status = "standalone_test";
    await writeJson(manifestPath, manifest);

    const report = await validateGrokHandoff({ handoffDir: handoff, root });

    expect(report).toMatchObject({
      status: "handoff_ready",
      state: {
        handoff_ready: true,
        generated: false,
        technical_validated: false,
        creative_validated: false,
        pipeline_assigned: false,
        standalone_test: true,
        publish_authorized: false,
        publish_ready: false
      }
    });
    expect(report.blockers).toEqual(["returned_clip_missing"]);
  });
});
