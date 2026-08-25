import { describe, it, expect } from "vitest";
import {
  detectLocation,
  detectFromFragment,
  detectFromHostname,
  detectFromSourceName,
  getCountryCount,
  isValidCountryCode,
} from "../../src/utils/location";

describe("Location Detection Module", () => {
  describe("detectFromFragment", () => {
    it("should detect flag emoji at start", () => {
      const result = detectFromFragment("🇩🇪 Germany");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("DE");
      expect(result!.country).toBe("Germany");
      expect(result!.confidence).toBe("high");
    });
    it("should detect flag emoji at end", () => {
      const result = detectFromFragment("France 🇫🇷");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("FR");
      expect(result!.confidence).toBe("high");
    });
    it("should detect CC-prefix DE-Frankfurt", () => {
      const result = detectFromFragment("DE-Frankfurt");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("DE");
    });
    it("should detect CC-prefix US-California", () => {
      const result = detectFromFragment("US-California");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("US");
    });
    it("should detect standalone CC", () => {
      const result = detectFromFragment("FR");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("FR");
      expect(["high", "medium"]).toContain(result!.confidence);
    });
    it("should detect country name Germany", () => {
      const result = detectFromFragment("Germany");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("DE");
    });
    it("should detect IRAN", () => {
      const result = detectFromFragment("IRAN-Server");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("IR");
    });
    it("should handle URL-encoded fragments", () => {
      const result = detectFromFragment("DE%20Frankfurt");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("DE");
    });
    it("should return null for empty fragment", () => {
      expect(detectFromFragment("")).toBeNull();
      expect(detectFromFragment("   ")).toBeNull();
    });
    it("should return null for unrecognized text", () => {
      expect(detectFromFragment("random-server-123")).toBeNull();
    });
  });

  describe("detectFromHostname", () => {
    it("should detect ccTLD .de", () => {
      const result = detectFromHostname("server.de");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("DE");
    });
    it("should detect ccTLD .ir", () => {
      const result = detectFromHostname("vpn.ir");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("IR");
    });
    it("should detect ccTLD .us", () => {
      const result = detectFromHostname("node.us");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("US");
    });
    it("should detect prefix de-de1.server.com", () => {
      const result = detectFromHostname("de-de1.server.com");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("DE");
      expect(result!.confidence).toBe("low");
    });
    it("should skip IPv4", () => {
      expect(detectFromHostname("192.168.1.1")).toBeNull();
    });
    it("should skip IPv6", () => {
      expect(detectFromHostname("::1")).toBeNull();
    });
    it("should return null for empty", () => {
      expect(detectFromHostname("")).toBeNull();
    });
    it("should handle .com (not ccTLD)", () => {
      expect(detectFromHostname("server.com")).toBeNull();
    });
  });

  describe("detectFromSourceName", () => {
    it("should detect Germany", () => {
      const result = detectFromSourceName("VPN Germany Channel");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("DE");
    });
    it("should detect Iran", () => {
      const result = detectFromSourceName("Iran VPN");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("IR");
    });
    it("should detect UK", () => {
      const result = detectFromSourceName("UK VPN Server");
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("GB");
    });
    it("should return null for empty", () => {
      expect(detectFromSourceName("")).toBeNull();
    });
    it("should return null for unrecognized", () => {
      expect(detectFromSourceName("My Channel")).toBeNull();
    });
  });

  describe("detectLocation orchestrator", () => {
    it("should prefer fragment over hostname", () => {
      const result = detectLocation("FR-Paris", "server.de", "UK");
      expect(result!.countryCode).toBe("FR");
    });
    it("should fall back to hostname", () => {
      const result = detectLocation(undefined, "server.de");
      expect(result!.countryCode).toBe("DE");
    });
    it("should fall back to source name", () => {
      const result = detectLocation(undefined, undefined, "Japan VPN");
      expect(result!.countryCode).toBe("JP");
    });
    it("should return Unknown for no input", () => {
      const result = detectLocation(undefined, undefined, undefined);
      expect(result!.countryCode).toBe("XX");
      expect(result!.confidence).toBe("none");
    });
    it("should handle VLESS config fragment", () => {
      const result = detectLocation("🇩🇪 Germany", "de.example.com");
      expect(result!.countryCode).toBe("DE");
    });
    it("should handle Trojan config fragment", () => {
      const result = detectLocation("US-California");
      expect(result!.countryCode).toBe("US");
    });
  });

  describe("utility functions", () => {
    it("getCountryCount > 50", () => {
      expect(getCountryCount()).toBeGreaterThan(50);
    });
    it("isValidCountryCode valid", () => {
      expect(isValidCountryCode("DE")).toBe(true);
      expect(isValidCountryCode("US")).toBe(true);
    });
    it("isValidCountryCode invalid", () => {
      expect(isValidCountryCode("XX")).toBe(false);
    });
  });

  describe("LocationResult shape", () => {
    it("should have all fields", () => {
      const r = detectLocation("Germany");
      expect(r).toHaveProperty("country");
      expect(r).toHaveProperty("countryCode");
      expect(r).toHaveProperty("flag");
      expect(r).toHaveProperty("display");
      expect(r).toHaveProperty("confidence");
    });
    it("display should contain country", () => {
      const r = detectLocation("Germany");
      expect(r.display).toContain("Germany");
    });
  });
});
