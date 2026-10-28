"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type Point = { bucket: string; sent: number; replies: number };

const SERIES = [
  { key: "sent", name: "Emails sent", color: "var(--series-1)" },
  { key: "replies", name: "Replies", color: "var(--series-2)" },
] as const;

export function ActivityChart({ data }: { data: Point[] }) {
  const [table, setTable] = useState(false);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-ink-2">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        <button onClick={() => setTable(!table)} className="ml-auto text-xs text-muted hover:text-ink">
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Period</th>
                <th className="th text-right">Sent</th>
                <th className="th text-right">Replies</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.bucket} className="border-t border-line">
                  <td className="td">{d.bucket}</td>
                  <td className="td text-right tabular-nums">{d.sent}</td>
                  <td className="td text-right tabular-nums">{d.replies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 12 }}
                labelStyle={{ color: "var(--text)" }}
                itemStyle={{ color: "var(--text-2)" }}
              />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
