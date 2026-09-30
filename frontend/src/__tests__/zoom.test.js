import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { installZoomControl, resetZoom, RESET_DELAY_MS } from "../lib/zoom";

const BASE = "width=device-width, initial-scale=1.0";

describe("zoom", () => {
  let doc, meta;
  beforeEach(() => {
    vi.useFakeTimers();
    doc = document.implementation.createHTMLDocument("t");
    meta = doc.createElement("meta");
    meta.name = "viewport";
    meta.setAttribute("content", BASE);
    doc.head.append(meta);
    doc.body.innerHTML = `<input id="a" /><select id="b"></select><button id="c">OK</button>`;
    installZoomControl(doc);
  });
  afterEach(() => vi.useRealTimers());

  const blur = (from, to = null) =>
    doc.getElementById(from).dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: to && doc.getElementById(to) }));

  test("quitter un champ : échelle remise à 1, puis viewport libéré pour le prochain champ", () => {
    blur("a", "c");
    expect(meta.getAttribute("content")).toBe(`${BASE}, maximum-scale=1.0`);
    vi.advanceTimersByTime(RESET_DELAY_MS);
    expect(meta.getAttribute("content")).toBe(BASE);
    blur("b");
    expect(meta.getAttribute("content")).toBe(`${BASE}, maximum-scale=1.0`);
  });

  test("passer d'un champ à l'autre garde le zoom", () => {
    blur("a", "b");
    expect(meta.getAttribute("content")).toBe(BASE);
  });

  test("deux remises rapprochées : le viewport d'origine est toujours rétabli", () => {
    resetZoom(doc);
    resetZoom(doc);
    vi.advanceTimersByTime(RESET_DELAY_MS);
    expect(meta.getAttribute("content")).toBe(BASE);
  });

  test("pincement iOS annulé", () => {
    const e = new Event("gesturestart", { cancelable: true });
    doc.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});
