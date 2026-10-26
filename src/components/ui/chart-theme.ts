import type { ChartOptions } from "chart.js";

export type AppChartType = "line" | "bar" | "doughnut";
export interface ChartPalette {
  text: string;
  grid: string;
}
// SSR/first-render fallback mirrors the semantic tokens. The mounted wrapper
// resolves the actual CSS tokens after the theme's DOM update has committed.
export const CHART_PALETTES: Readonly<
  Record<"light" | "dark", Readonly<ChartPalette>>
> = {
  light: { text: "#56635a", grid: "#d6e0d9" },
  dark: { text: "#b0bdb4", grid: "#3b4b41" },
};
export function resolveChartPalette(
  styles: Pick<CSSStyleDeclaration, "getPropertyValue">,
  fallback: Readonly<ChartPalette>,
): ChartPalette {
  return {
    text: styles.getPropertyValue("--muted-foreground").trim() || fallback.text,
    grid: styles.getPropertyValue("--border").trim() || fallback.grid,
  };
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Adapt mixed-chart caller options without mutating them. Only neutral chart
 * chrome belongs to the theme; datasets, callbacks and plugin settings do not. */
export function themedChartOptions(
  type: AppChartType,
  options: unknown,
  palette: Readonly<ChartPalette>,
): ChartOptions {
  const original = record(options);
  const result: Record<string, unknown> = { ...original, color: palette.text };
  // Chart.js supports disabling plugins with false at runtime, even though its
  // public ChartOptions type does not model every such configuration.
  if (original.plugins !== false) {
    const plugins = record(original.plugins);
    const legend = record(plugins.legend);
    result.plugins = {
      ...plugins,
      legend:
        plugins.legend === false
          ? false
          : {
              ...legend,
              labels: { ...record(legend.labels), color: palette.text },
            },
    };
  }
  // In particular, never synthesize cartesian axes on a doughnut.
  if (type !== "doughnut" && original.scales) {
    result.scales = Object.fromEntries(
      Object.entries(record(original.scales)).map(([id, value]) => {
        if (value === false) return [id, value];
        const scale = record(value);
        return [
          id,
          {
            ...scale,
            ticks: { ...record(scale.ticks), color: palette.text },
            title: { ...record(scale.title), color: palette.text },
            grid:
              scale.grid === false
                ? false
                : { ...record(scale.grid), color: palette.grid },
            border: { ...record(scale.border), color: palette.grid },
          },
        ];
      }),
    );
  }
  // The existing wrapper deliberately accepts mixed/narrow callback signatures.
  // Keep that single adapter boundary while returning the official options API.
  return result as ChartOptions;
}
