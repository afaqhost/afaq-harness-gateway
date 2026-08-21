import { describe, it, expect } from "vitest";
import { resolveSafePath, isSafePath, PathResolutionError } from "./path-resolution.js";

describe("resolveSafePath", () => {
  it("resolves an absolute path", () => {
    expect(resolveSafePath("/usr/bin")).toBe("/usr/bin");
  });

  it("normalizes redundant slashes", () => {
    expect(resolveSafePath("/usr//bin")).toBe("/usr/bin");
  });

  it("normalizes trailing slash", () => {
    expect(resolveSafePath("/usr/bin/")).toBe("/usr/bin");
  });

  it("rejects empty string", () => {
    expect(() => resolveSafePath("")).toThrow(PathResolutionError);
    expect(() => resolveSafePath("   ")).toThrow(PathResolutionError);
  });

  it("rejects relative paths", () => {
    expect(() => resolveSafePath("usr/bin")).toThrow(PathResolutionError);
    expect(() => resolveSafePath("./foo")).toThrow(PathResolutionError);
  });

  it("rejects paths with traversal", () => {
    expect(() => resolveSafePath("/usr/../etc/passwd")).toThrow(PathResolutionError);
  });

  it("rejects null bytes", () => {
    expect(() => resolveSafePath("/usr/bin\0")).toThrow(PathResolutionError);
  });

  it("rejects non-string input type via empty check", () => {
    expect(() => resolveSafePath(null as unknown as string)).toThrow(PathResolutionError);
    expect(() => resolveSafePath(undefined as unknown as string)).toThrow(PathResolutionError);
  });
});

describe("isSafePath", () => {
  it("returns true for safe absolute paths", () => {
    expect(isSafePath("/usr/bin")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isSafePath("relative")).toBe(false);
  });

  it("returns false for traversal", () => {
    expect(isSafePath("/foo/../bar")).toBe(false);
  });

  it("returns false for empty", () => {
    expect(isSafePath("")).toBe(false);
  });
});
