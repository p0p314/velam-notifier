import { describe, test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { getBikePref, setBikePref, getLandingPref, setLandingPref, landingPath, stationFilterFor } from "../lib/prefs";
import { fmtLastSeen, exportFileName } from "../lib/devices";
import { defaultForm } from "../lib/alerts";
import { ThemeProvider, useTheme } from "../useTheme";

describe("préférences de l'appareil", () => {
  test("valeurs par défaut, mémorisation, valeurs inconnues ignorées", () => {
    expect(getBikePref()).toBe("any");
    expect(getLandingPref()).toBe("auto");
    setBikePref("ebike");
    setLandingPref("trains");
    expect(getBikePref()).toBe("ebike");
    expect(getLandingPref()).toBe("trains");
    // Choix d'avant la v1.7 : convertis vers la page équivalente.
    localStorage.setItem("velopulse-pref-landing", "favoris");
    expect(getLandingPref()).toBe("trajets");
    localStorage.setItem("velopulse-pref-landing", "carte");
    expect(getLandingPref()).toBe("velos");
    localStorage.setItem("velopulse-pref-bike", "tandem");
    expect(getBikePref()).toBe("any");
  });

  test("page d'ouverture", () => {
    expect(landingPath("auto", true)).toBe("/trajets");
    expect(landingPath("auto", false)).toBe("/velos");
    expect(landingPath("trains", true)).toBe("/trains");
    expect(landingPath("trajets", false)).toBe("/trajets");
  });

  test("filtre Stations / Carte et formulaire d'alerte suivent le type préféré", () => {
    expect(stationFilterFor("ebike")).toBe("elec");
    expect(stationFilterFor("mechanical")).toBe("meca");
    expect(stationFilterFor("any")).toBe("all");
    expect(defaultForm().bikeType).toBe("any");
    setBikePref("mechanical");
    expect(defaultForm().bikeType).toBe("mechanical");
  });
});

describe("appareils : dernière activité", () => {
  const now = new Date(2025, 8, 24, 15, 0);
  test("à l'instant, aujourd'hui, hier, date", () => {
    expect(fmtLastSeen(now.getTime() - 30_000, now)).toBe("à l'instant");
    expect(fmtLastSeen(new Date(2025, 8, 24, 9, 5).getTime(), now)).toBe("aujourd'hui à 09:05");
    expect(fmtLastSeen(new Date(2025, 8, 23, 22, 40).getTime(), now)).toBe("hier à 22:40");
    expect(fmtLastSeen(new Date(2025, 8, 2, 8, 0).getTime(), now)).toBe("le 02/09");
    expect(fmtLastSeen(new Date(2024, 11, 31, 8, 0).getTime(), now)).toBe("le 31/12/2024");
  });
  test("nom du fichier d'export", () => {
    expect(exportFileName(now)).toBe("velopulse-mes-donnees-2025-09-24.json");
  });
});

describe("thème automatique", () => {
  let listeners, dark;
  const fakeMatchMedia = () => {
    listeners = [];
    window.matchMedia = (query) => ({
      get matches() { return query.includes("dark") ? dark : false; }, media: query,
      addEventListener: (_, cb) => listeners.push(cb), removeEventListener() {},
      addListener() {}, removeListener() {},
    });
  };
  function Probe() {
    const { theme, mode, setMode } = useTheme();
    return <button onClick={() => setMode("light")}>{mode}:{theme}</button>;
  }

  test("par défaut, suit le réglage de l'appareil, y compris quand il change", async () => {
    dark = false;
    fakeMatchMedia();
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole("button").textContent).toBe("system:light");
    dark = true;
    const { act } = await import("@testing-library/react");
    act(() => listeners.forEach((cb) => cb()));
    expect(screen.getByRole("button").textContent).toBe("system:dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("un thème explicite choisi remplace le réglage de l'appareil", () => {
    dark = true;
    fakeMatchMedia();
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("light:light");
    expect(localStorage.getItem("velopulse-theme")).toBe("light");
  });

  test("choix explicite déjà enregistré : conservé", () => {
    dark = true;
    fakeMatchMedia();
    localStorage.setItem("velopulse-theme", "light");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole("button").textContent).toBe("light:light");
  });
});
