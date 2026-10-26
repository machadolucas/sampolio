"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CanvasHTMLAttributes,
  type Ref,
} from "react";
import { useTheme } from "@/components/providers/theme-provider";
import {
  CHART_PALETTES,
  resolveChartPalette,
  themedChartOptions,
  type ChartPalette,
} from "./chart-theme";
import {
  Chart as ChartJS,
  LineController,
  BarController,
  DoughnutController,
  LineElement,
  BarElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Tooltip,
  type ChartType,
  type ChartData,
  type Plugin,
} from "chart.js";
import { Chart as ReactChart } from "react-chartjs-2";

// Match the app's system-font stack for canvas labels and tooltips.
ChartJS.defaults.font.family =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// Register exactly the families used by wealth, budget and mortgage views.
ChartJS.register(
  LineController,
  BarController,
  DoughnutController,
  LineElement,
  BarElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Tooltip,
);

interface ChartProps extends Omit<
  CanvasHTMLAttributes<HTMLCanvasElement>,
  "children"
> {
  type: "line" | "bar" | "doughnut";
  // The existing views include mixed datasets and narrow tooltip/plugin types.
  // Adapt once here instead of weakening every domain chart's inference.
  data: unknown;
  options?: unknown;
  plugins?: unknown[];
  ref?: Ref<ChartJS<ChartType> | undefined>;
}

export function Chart({
  type,
  data,
  options,
  plugins,
  className,
  style,
  ref,
  ...canvasProps
}: ChartProps) {
  const { theme } = useTheme();
  const [resolved, setResolved] = useState<{
    theme: typeof theme;
    palette: ChartPalette;
  } | null>(null);
  // Re-render immediately from context with the correct semantic fallback.
  // Then resolve CSS after all parent effects (including OS-driven theme DOM
  // changes) have run. No key/remount, global defaults mutation or dataset copy.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const palette = resolveChartPalette(
        getComputedStyle(document.documentElement),
        CHART_PALETTES[theme],
      );
      setResolved((previous) =>
        previous?.theme === theme &&
        previous.palette.text === palette.text &&
        previous.palette.grid === palette.grid
          ? previous
          : { theme, palette },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [theme]);
  const palette =
    resolved?.theme === theme ? resolved.palette : CHART_PALETTES[theme];
  const chartOptions = useMemo(
    () => themedChartOptions(type, options, palette),
    [type, options, palette],
  );
  return (
    <div className={`relative h-full min-w-0 ${className ?? ""}`} style={style}>
      <ReactChart
        type={type}
        data={data as ChartData<ChartType>}
        options={chartOptions}
        plugins={plugins as Plugin<ChartType>[] | undefined}
        ref={ref}
        // ChartExplain supplies the named image and tested description.
        role="presentation"
        aria-hidden={true}
        {...canvasProps}
      />
    </div>
  );
}
