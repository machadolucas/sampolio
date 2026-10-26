import { describe, expect, it } from "vitest";
import {
  CHART_PALETTES,
  resolveChartPalette,
  themedChartOptions,
} from "./chart-theme";

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const values = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
describe("per-instance chart chrome", () => {
  it("merges nested colours immutably while retaining callbacks, filters, scales and tooltip identity", () => {
    const tick = (value: string | number) => `€${value}`;
    const filter = (item: { text: string }) => item.text !== "Zero";
    const tooltip = Object.freeze({ callbacks: { label: tick } });
    const source = Object.freeze({
      maintainAspectRatio: false,
      plugins: Object.freeze({
        legend: Object.freeze({
          display: false,
          labels: Object.freeze({ filter, padding: 20 }),
        }),
        tooltip,
      }),
      scales: Object.freeze({
        y: Object.freeze({
          min: -100,
          max: 500,
          stacked: true,
          ticks: Object.freeze({ callback: tick }),
          grid: Object.freeze({ display: false, color: "#000" }),
        }),
      }),
    });
    const themed = themedChartOptions("bar", source, CHART_PALETTES.dark);
    expect(themed).not.toBe(source);
    expect(themed.plugins?.legend?.labels?.filter).toBe(filter);
    expect(themed.plugins?.legend?.display).toBe(false);
    expect(themed.plugins?.tooltip).toBe(tooltip);
    expect(themed.scales?.y?.ticks?.callback).toBe(tick);
    expect(themed.scales?.y).toMatchObject({
      min: -100,
      max: 500,
      stacked: true,
      grid: { display: false },
      ticks: { color: CHART_PALETTES.dark.text },
    });
    expect(source.scales.y.grid.color).toBe("#000");
    expect(themed.maintainAspectRatio).toBe(false);
  });
  it("does not invent doughnut axes or re-enable disabled plugins", () => {
    expect(
      themedChartOptions("doughnut", { cutout: "70%" }, CHART_PALETTES.dark),
    ).not.toHaveProperty("scales");
    expect(
      themedChartOptions("line", { plugins: false }, CHART_PALETTES.light)
        .plugins,
    ).toBe(false);
    expect(
      themedChartOptions(
        "bar",
        { plugins: { legend: false } },
        CHART_PALETTES.dark,
      ).plugins?.legend,
    ).toBe(false);
  });
  it("resolves semantic CSS tokens and keeps text above AA contrast in both themes", () => {
    expect(
      resolveChartPalette(
        {
          getPropertyValue: (key) =>
            key === "--muted-foreground" ? " #abcdef " : "",
        },
        CHART_PALETTES.dark,
      ),
    ).toEqual({ text: "#abcdef", grid: CHART_PALETTES.dark.grid });
    expect(
      contrast(CHART_PALETTES.light.text, "#ffffff"),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(CHART_PALETTES.dark.text, "#1c2420"),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", "#35463b")).toBeGreaterThanOrEqual(4.5);
  });
});
