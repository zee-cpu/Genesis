import { createHash } from "node:crypto";

import { GenesisError } from "../core/errors.mjs";

function invalid(message, path = "/") {
  throw new GenesisError("CANONICALIZATION_FAILED", message, {
    path,
    correction: "Use schema-valid JSON values without negative zero, unsupported values, or invalid Unicode",
    escalation: "builder",
  });
}

function assertValidUnicode(value, pointer) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid("Canonical JSON cannot contain an unpaired Unicode surrogate", pointer);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid("Canonical JSON cannot contain an unpaired Unicode surrogate", pointer);
    }
  }
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function serialize(value, pointer) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertValidUnicode(value, pointer);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("Canonical JSON requires finite numbers", pointer);
    if (Object.is(value, -0)) invalid("Canonical JSON rejects negative zero", pointer);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => serialize(item, `${pointer}/${index}`)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => {
      assertValidUnicode(key, `${pointer}/${pointerSegment(key)}`);
      const item = value[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
        invalid("Canonical JSON encountered an unsupported value", `${pointer}/${pointerSegment(key)}`);
      }
      return `${JSON.stringify(key)}:${serialize(item, `${pointer}/${pointerSegment(key)}`)}`;
    }).join(",")}}`;
  }
  invalid("Canonical JSON encountered an unsupported value", pointer);
}

export function canonicalizeJson(value) {
  return serialize(value, "");
}

export function canonicalDigest(value) {
  return `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;
}
