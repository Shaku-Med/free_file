import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import { formatNumber } from "~/lib/utils/formatNumber";

const chartConfig = {
  views: { label: "Views", color: "var(--chart-2)" },
} satisfies ChartConfig;

const fmtDate = (v: unknown) =>
  new Date(String(v)).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function ViewsAreaChart({
  data,
}: {
  data: { date: string; views: number }[];
}) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 12, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="studioFillViews" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-views)" stopOpacity={0.7} />
            <stop offset="95%" stopColor="var(--color-views)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={fmtDate}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v) => formatNumber(Number(v))}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="dot" labelFormatter={fmtDate} />}
        />
        <Area
          dataKey="views"
          type="natural"
          fill="url(#studioFillViews)"
          stroke="var(--color-views)"
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
