/**
 * Tests — Admin Authorization
 *
 * Tests admin ID parsing, authorization checks, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { parseAdminUserIds, isAdmin, getAdminIds } from "../../src/telegram/auth";

describe("Admin Authorization", () => {
  describe("parseAdminUserIds()", () => {
    it("should parse comma-separated IDs", () => {
      const ids = parseAdminUserIds("123456,789012");
      expect(ids.size).toBe(2);
      expect(ids.has(123456)).toBe(true);
      expect(ids.has(789012)).toBe(true);
    });

    it("should handle spaces around IDs", () => {
      const ids = parseAdminUserIds(" 123456 , 789012 ");
      expect(ids.size).toBe(2);
      expect(ids.has(123456)).toBe(true);
      expect(ids.has(789012)).toBe(true);
    });

    it("should return empty set for undefined", () => {
      const ids = parseAdminUserIds(undefined);
      expect(ids.size).toBe(0);
    });

    it("should return empty set for empty string", () => {
      const ids = parseAdminUserIds("");
      expect(ids.size).toBe(0);
    });

    it("should return empty set for whitespace-only string", () => {
      const ids = parseAdminUserIds("   ");
      expect(ids.size).toBe(0);
    });

    it("should ignore invalid (non-numeric) parts", () => {
      const ids = parseAdminUserIds("123456,abc,789012");
      expect(ids.size).toBe(2);
      expect(ids.has(123456)).toBe(true);
      expect(ids.has(789012)).toBe(true);
    });

    it("should ignore negative IDs", () => {
      const ids = parseAdminUserIds("-123456,123456");
      expect(ids.size).toBe(1);
      expect(ids.has(123456)).toBe(true);
    });

    it("should ignore zero", () => {
      const ids = parseAdminUserIds("0,123456");
      expect(ids.size).toBe(1);
      expect(ids.has(123456)).toBe(true);
    });

    it("should handle single ID", () => {
      const ids = parseAdminUserIds("123456");
      expect(ids.size).toBe(1);
      expect(ids.has(123456)).toBe(true);
    });
  });

  describe("isAdmin()", () => {
    it("should return true for configured admin ID", () => {
      expect(isAdmin(123456, "123456,789012")).toBe(true);
      expect(isAdmin(789012, "123456,789012")).toBe(true);
    });

    it("should return false for non-admin ID", () => {
      expect(isAdmin(999999, "123456,789012")).toBe(false);
    });

    it("should return false when no admin IDs configured (undefined)", () => {
      expect(isAdmin(123456, undefined)).toBe(false);
    });

    it("should return false when admin IDs is empty string", () => {
      expect(isAdmin(123456, "")).toBe(false);
    });

    it("SECURITY: first user is never auto-admin", () => {
      // Even with /start, no user is auto-promoted
      expect(isAdmin(111111, undefined)).toBe(false);
      expect(isAdmin(111111, "")).toBe(false);
    });

    it("SECURITY: empty config means nobody authorized", () => {
      expect(isAdmin(123, undefined)).toBe(false);
      expect(isAdmin(123, "")).toBe(false);
      expect(isAdmin(123, "   ")).toBe(false);
    });
  });

  describe("getAdminIds()", () => {
    it("should return list of admin IDs", () => {
      const ids = getAdminIds("123456,789012");
      expect(ids).toEqual(expect.arrayContaining([123456, 789012]));
      expect(ids.length).toBe(2);
    });

    it("should return empty array for undefined", () => {
      expect(getAdminIds(undefined)).toEqual([]);
    });

    it("should return empty array for empty string", () => {
      expect(getAdminIds("")).toEqual([]);
    });
  });
});
