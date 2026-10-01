import { describe, expect, it } from "vitest";
import { NonRetryableError, requestNeverSent } from "../src/retry";

describe("requestNeverSent", () => {
  // R3(a): Literal lists are independent of production so each removed code fails.
  it.each([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ERR_TLS_HANDSHAKE_TIMEOUT",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "CERT_NOT_YET_VALID",
    "CERT_REVOKED",
    "CERT_UNTRUSTED",
    "CERT_REJECTED",
    "HOSTNAME_MISMATCH"
  ])("recognizes %s as never sent", (code) => {
    expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause: { code } }))).toBe(true);
  });

  // R3(b): Match the exact SSL prefix, including its trailing underscore.
  it("recognizes ERR_SSL_WRONG_VERSION_NUMBER as never sent", () => {
    expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause: { code: "ERR_SSL_WRONG_VERSION_NUMBER" } }))).toBe(true);
  });

  it("does not mistake ERR_SSLX for the ERR_SSL_ prefix", () => {
    expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause: { code: "ERR_SSLX" } }))).toBe(false);
  });

  // R3(c): Count the root error as object one; retain the five-object boundary.
  it("finds a code in the third object through a NonRetryableError cause", () => {
    const error = new NonRetryableError("commit not confirmed", {
      cause: Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })
    });
    expect(requestNeverSent(error)).toBe(true);
  });

  it("finds a code in the fifth object", () => {
    const error = { cause: { cause: { cause: { cause: { code: "ENOTFOUND" } } } } };
    expect(requestNeverSent(error)).toBe(true);
  });

  it("ignores a code in the sixth object", () => {
    const error = { cause: { cause: { cause: { cause: { cause: { code: "ENOTFOUND" } } } } } };
    expect(requestNeverSent(error)).toBe(false);
  });

  // R3(d): Node's AggregateError may copy errors[0].code onto the outer cause.
  it("recognizes an AggregateError-shaped cause with its own ECONNREFUSED code", () => {
    const cause = { code: "ECONNREFUSED", errors: [{ code: "ECONNREFUSED" }] };
    expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause }))).toBe(true);
  });

  it("does not inspect errors[0] when an AggregateError-shaped cause has no code", () => {
    // Known conservative boundary: only cause is walked, not the errors array.
    const cause = { errors: [{ code: "ECONNREFUSED" }] };
    expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause }))).toBe(false);
  });

  // R3(e): These failures may happen after sending the HTTP request.
  it.each(["ECONNRESET", "EPROTO", "UND_ERR_SOCKET", "ETIMEDOUT", "EPIPE"])(
    "keeps %s possibly sent",
    (code) => {
      expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause: { code } }))).toBe(false);
    }
  );

  it("returns false when no code exists", () => {
    expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause: new Error("offline") }))).toBe(false);
  });

  it("stops when cause is a string", () => {
    expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause: "ENOTFOUND" }))).toBe(false);
  });

  it("returns false for a non-string code", () => {
    expect(requestNeverSent(Object.assign(new TypeError("fetch failed"), { cause: { code: 42 } }))).toBe(false);
  });

  it.each([undefined, null, "ENOTFOUND"])("returns false for primitive error %s", (error) => {
    expect(requestNeverSent(error)).toBe(false);
  });
});
