import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import Wordmark from "../components/Wordmark";

const PUBLIC = path.resolve(__dirname, "../../public");

describe("marque Mox", () => {
  test("logotype : nom accessible « Mox », un masque propre à chaque exemplaire", () => {
    render(<><Wordmark /><Wordmark className="brand-name" /></>);
    const marks = screen.getAllByRole("img", { name: "Mox" });
    expect(marks).toHaveLength(2);
    const ids = marks.map((m) => m.querySelector("mask").id);
    expect(new Set(ids).size).toBe(2);
    marks.forEach((m, i) => {
      expect(m.querySelector("circle[mask]").getAttribute("mask")).toBe(`url(#${ids[i]})`);
      expect(m.textContent).toBe("mx"); // le « o » est dessiné
    });
    expect(marks[1].classList.contains("brand-name")).toBe(true);
  });

  test("manifeste : nom Mox et icônes présentes (any + maskable)", () => {
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, "manifest.json"), "utf8"));
    expect(m.name).toBe("Mox");
    expect(m.short_name).toBe("Mox");
    expect(m.icons.map((i) => i.purpose).sort()).toEqual(["any", "any", "maskable", "maskable"]);
    for (const icon of m.icons) expect(fs.existsSync(path.join(PUBLIC, icon.src))).toBe(true);
    for (const f of ["apple-touch-icon.png", "badge-72.png", "favicon.svg", "favicon-32.png", "mox-icon-light.svg", "mox-icon-dark.svg"]) {
      expect(fs.existsSync(path.join(PUBLIC, f)), f).toBe(true);
    }
  });
});
