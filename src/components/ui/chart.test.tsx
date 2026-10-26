// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Chart } from "./chart";
import { CHART_PALETTES } from "./chart-theme";
import type { ChartOptions } from "chart.js";
const state = vi.hoisted(() => ({
  theme: "light" as "light" | "dark",
  listeners: new Set<() => void>(),
  mounts: 0,
  unmounts: 0,
  last: null as null | {
    data: unknown;
    plugins: unknown;
    options: ChartOptions;
  },
}));
vi.mock("@/components/providers/theme-provider", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useTheme: () => ({
      theme: useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        () => state.theme,
      ),
    }),
  };
});
vi.mock("react-chartjs-2", async () => {
  const { useEffect } = await import("react");
  return {
    Chart: (props: NonNullable<typeof state.last>) => {
      state.last = props;
      useEffect(() => {
        state.mounts++;
        return () => {
          state.unmounts++;
        };
      }, []);
      return <canvas />;
    },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.theme = "light";
});
it("redraws options immediately on theme changes while retaining the chart, datasets and inline plugins", () => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const data = {
    labels: ["October"],
    datasets: [{ data: [120], backgroundColor: "#ef4444" }],
  };
  const plugins = [{ id: "todayLine" }];
  render(
    <Chart
      type="bar"
      data={data}
      options={{ scales: { y: { min: 0 } } }}
      plugins={plugins}
    />,
  );
  const first = state.last!.options;
  expect(first.color).toBe(CHART_PALETTES.light.text);
  act(() => {
    state.theme = "dark";
    state.listeners.forEach((listener) => listener());
  });
  expect(state.last!.options).not.toBe(first);
  expect(state.last!.options.color).toBe(CHART_PALETTES.dark.text);
  expect(state.last!.data).toBe(data);
  expect(state.last!.plugins).toBe(plugins);
  expect(state.mounts).toBe(1);
  expect(state.unmounts).toBe(0);
  act(() => {
    state.theme = "light";
    state.listeners.forEach((listener) => listener());
  });
  expect(state.last!.options.color).toBe(CHART_PALETTES.light.text);
  expect(state.mounts).toBe(1);
});
