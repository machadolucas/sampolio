"use client";

import type { CanvasHTMLAttributes, Ref } from "react";
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
  type ChartOptions,
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
  return (
    <div className={`relative h-full min-w-0 ${className ?? ""}`} style={style}>
      <ReactChart
        type={type}
        data={data as ChartData<ChartType>}
        options={options as ChartOptions<ChartType>}
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
