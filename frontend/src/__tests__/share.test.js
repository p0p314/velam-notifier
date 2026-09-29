import { describe, test, expect, vi, afterEach } from "vitest";
import { shareApp } from "../lib/share";

const URL_APP = "https://velopulse.example";
const setClipboard = (writeText) =>
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });

afterEach(() => { delete navigator.share; delete navigator.canShare; setClipboard(null); });

describe("shareApp", () => {
  test("feuille de partage du système", async () => {
    navigator.share = vi.fn(async () => {});
    expect(await shareApp(URL_APP)).toBe("shared");
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ url: URL_APP, title: "VéloPulse" }));
  });

  test("partage annulé par l'utilisateur : rien n'est copié", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    navigator.share = vi.fn(async () => { throw Object.assign(new Error("annulé"), { name: "AbortError" }); });
    expect(await shareApp(URL_APP)).toBe("shared");
    expect(writeText).not.toHaveBeenCalled();
  });

  test("partage refusé (autre erreur) ou indisponible : copie du lien", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    navigator.share = vi.fn(async () => { throw Object.assign(new Error("non"), { name: "NotAllowedError" }); });
    expect(await shareApp(URL_APP)).toBe("copied");
    delete navigator.share;
    expect(await shareApp(URL_APP)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL_APP);
  });

  test("données non partageables (canShare) : copie", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    navigator.share = vi.fn();
    navigator.canShare = () => false;
    expect(await shareApp(URL_APP)).toBe("copied");
    expect(navigator.share).not.toHaveBeenCalled();
  });

  test("ni partage ni presse-papiers : échec signalé", async () => {
    setClipboard(vi.fn(async () => { throw new Error("refusé"); }));
    expect(await shareApp(URL_APP)).toBe("failed");
  });
});
