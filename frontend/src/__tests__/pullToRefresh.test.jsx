import { describe, test, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import PullToRefresh, { PULL_THRESHOLD } from "../components/PullToRefresh";

/** Événement tactile minimal (jsdom n'implémente pas TouchEvent complètement). */
function touch(type, x, y, target = document.body) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
  target.dispatchEvent(e);
  return e;
}

async function gesture(dx, dy) {
  await act(async () => {
    touch("touchstart", 100, 100);
    touch("touchmove", 100 + dx / 2, 100 + dy / 2);
    touch("touchmove", 100 + dx, 100 + dy);
    touch("touchend", 0, 0);
  });
}

describe("tirer pour actualiser", () => {
  test("tiré au-delà du seuil depuis le haut : actualise", async () => {
    const onRefresh = vi.fn(async () => {});
    render(<PullToRefresh onRefresh={onRefresh}><p>contenu</p></PullToRefresh>);
    await gesture(0, (PULL_THRESHOLD + 10) * 2); // résistance 0,5
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("relâché avant le seuil : rien", async () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh}><p>contenu</p></PullToRefresh>);
    await gesture(0, PULL_THRESHOLD);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test("geste horizontal (glisser pour supprimer) : ignoré", async () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh}><p>contenu</p></PullToRefresh>);
    await gesture(300, 40);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test("indicateur : « Relâchez pour actualiser » une fois le seuil atteint", async () => {
    render(<PullToRefresh onRefresh={vi.fn()}><p>contenu</p></PullToRefresh>);
    await act(async () => {
      touch("touchstart", 100, 100);
      touch("touchmove", 100, 110);
      touch("touchmove", 100, 100 + (PULL_THRESHOLD + 10) * 2);
    });
    expect(screen.getByText("Relâchez pour actualiser")).toBeTruthy();
    await act(async () => touch("touchend", 0, 0));
  });
});
