import React, { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatCompact(n) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatUsd(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function buildOHLC(seed = 64900, points = 72) {
  const data = [];
  let prevClose = seed;

  for (let i = 0; i < points; i += 1) {
    const drift = Math.sin(i / 6) * 18 + Math.cos(i / 13) * 10;
    const noise = (Math.random() - 0.5) * 50;
    const open = prevClose;
    const close = open + drift + noise;
    const wickBase = Math.max(18, Math.abs(close - open) * 0.8);
    const high = Math.max(open, close) + wickBase + Math.random() * 22;
    const low = Math.min(open, close) - wickBase - Math.random() * 22;
    const bullish = close >= open;
    const volumeBase = 120 + Math.abs(close - open) * 12;
    const volume = Math.round(volumeBase + Math.random() * 260);

    data.push({
      i,
      t: i,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
      bullish,
    });

    prevClose = close;
  }

  return data;
}

function CandleLayer({ data, xAxisMap, yAxisMap, width, height }) {
  const xAxis = xAxisMap?.[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap?.[Object.keys(yAxisMap)[0]];
  if (!xAxis?.scale || !yAxis?.scale) return null;

  const xScale = xAxis.scale;
  const yScale = yAxis.scale;

  const strokeGrid = "rgba(255,255,255,.06)";
  const green = "#2cff8f";
  const red = "#ff4d4d";

  const step = data.length > 1 ? Math.abs(xScale(1) - xScale(0)) : 16;
  const candleW = clamp(step * 0.62, 8, 18);
  const wickW = 2;

  return (
    <g>
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={14}
        ry={14}
        fill="transparent"
        stroke={strokeGrid}
      />

      {data.map((d, idx) => {
        const x = xScale(idx);
        const o = yScale(d.open);
        const c = yScale(d.close);
        const h = yScale(d.high);
        const l = yScale(d.low);

        const bodyTop = Math.min(o, c);
        const bodyBot = Math.max(o, c);
        const bodyH = Math.max(2, bodyBot - bodyTop);
        const color = d.bullish ? green : red;

        return (
          <g key={d.i}>
            <line
              x1={x}
              x2={x}
              y1={h}
              y2={l}
              stroke={color}
              strokeWidth={wickW}
              strokeLinecap="round"
              opacity={0.9}
            />

            <rect
              x={x - candleW / 2}
              y={bodyTop}
              width={candleW}
              height={bodyH}
              rx={5}
              ry={5}
              fill={color}
              opacity={0.95}
            />

            <rect
              x={x - candleW / 2 - 1}
              y={bodyTop - 1}
              width={candleW + 2}
              height={bodyH + 2}
              rx={6}
              ry={6}
              fill="transparent"
              stroke={color}
              strokeWidth={1}
              opacity={0.22}
            />
          </g>
        );
      })}

      <defs>
        <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,0,0,.35)" />
          <stop offset="65%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
        <linearGradient id="fadeBottom" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="rgba(0,0,0,.55)" />
          <stop offset="70%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={width} height={28} fill="url(#fadeTop)" />
      <rect
        x={0}
        y={height - 60}
        width={width}
        height={60}
        fill="url(#fadeBottom)"
      />
    </g>
  );
}

function CandleTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  const green = "#2cff8f";
  const red = "#ff4d4d";
  const color = d.bullish ? green : red;

  return (
    <div
      style={{
        background: "rgba(10,10,10,.92)",
        border: `1px solid ${color}55`,
        boxShadow: "0 14px 40px rgba(0,0,0,.55)",
        padding: "10px 12px",
        borderRadius: "12px",
        backdropFilter: "blur(10px)",
        minWidth: "220px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div
          style={{
            color,
            fontSize: "10px",
            letterSpacing: "2px",
            fontWeight: 900,
          }}
        >
          BTC / USD
        </div>
        <div style={{ color: "#666", fontSize: "10px", fontWeight: 700 }}>
          candle #{d.i + 1}
        </div>
      </div>

      <div style={{ marginTop: "8px", color: "#fff", fontWeight: 900 }}>
        {formatUsd(d.close)}
        <span style={{ color: "#666", fontWeight: 800, marginLeft: "8px" }}>
          close
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 10px",
          marginTop: "10px",
          fontSize: "11px",
        }}
      >
        <div style={{ color: "#777" }}>
          O{" "}
          <span style={{ color: "#bbb", fontWeight: 800 }}>
            {formatUsd(d.open)}
          </span>
        </div>
        <div style={{ color: "#777" }}>
          H{" "}
          <span style={{ color: "#bbb", fontWeight: 800 }}>
            {formatUsd(d.high)}
          </span>
        </div>
        <div style={{ color: "#777" }}>
          L{" "}
          <span style={{ color: "#bbb", fontWeight: 800 }}>
            {formatUsd(d.low)}
          </span>
        </div>
        <div style={{ color: "#777" }}>
          V{" "}
          <span style={{ color: "#bbb", fontWeight: 800 }}>
            {formatCompact(d.volume)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function VolumeChart({ height = 360 }) {
  const [tf, setTf] = useState("1H");

  const all = useMemo(() => buildOHLC(64900, 72), []);
  const data = useMemo(() => {
    const map = { "15m": 24, "1H": 36, "4H": 48, "1D": 72 };
    return all.slice(all.length - (map[tf] ?? 36));
  }, [all, tf]);

  const last = data[data.length - 1];
  const first = data[0];
  const chg =
    last && first ? ((last.close - first.open) / first.open) * 100 : 0;
  const chgUp = chg >= 0;
  const accent = chgUp ? "#2cff8f" : "#ff4d4d";

  return (
    <div
      style={{
        width: "100%",
        height: typeof height === "number" ? `${height}px` : height,
        background:
          "linear-gradient(180deg,#060606 0%, #0a0a0a 55%, #050505 100%)",
        borderRadius: "18px",
        padding: "14px",
        boxSizing: "border-box",
        border: "1px solid rgba(255,255,255,.05)",
        boxShadow: "0 0 28px rgba(0,255,140,.06)",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <div
              style={{
                color: "#fff",
                fontWeight: 950,
                letterSpacing: "2px",
                fontSize: "12px",
              }}
            >
              BTC / USD
            </div>
            <div
              style={{
                color: "#666",
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: "2px",
              }}
            >
              CANDLE + VOLUME
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <div
              style={{
                color: accent,
                fontWeight: 950,
                fontSize: "26px",
                lineHeight: 1,
                textShadow: `0 0 14px ${accent}33`,
              }}
            >
              {last ? formatUsd(last.close) : "$0"}
            </div>
            <div
              style={{
                color: chgUp ? "#8effc1" : "#ff9b9b",
                fontSize: "11px",
                fontWeight: 900,
              }}
            >
              {chgUp ? "+" : ""}
              {chg.toFixed(2)}%
              <span style={{ color: "#666", fontWeight: 800, marginLeft: "6px" }}>
                {tf}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "7px",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {["15m", "1H", "4H", "1D"].map((item) => {
            const active = item === tf;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setTf(item)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "10px",
                  fontSize: "11px",
                  fontWeight: 900,
                  cursor: "pointer",
                  color: active ? "#08120c" : "#a0a0a0",
                  background: active ? accent : "#0f0f0f",
                  border: active
                    ? `1px solid ${accent}`
                    : "1px solid rgba(255,255,255,.06)",
                  boxShadow: active ? `0 0 14px ${accent}33` : "none",
                  letterSpacing: "1px",
                }}
              >
                {item}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ width: "100%", flex: 1, minHeight: 0, marginTop: "10px" }}>
        <ResponsiveContainer>
          <ComposedChart data={data}>
            <CartesianGrid
              stroke="rgba(255,255,255,.04)"
              vertical={false}
              strokeDasharray="3 3"
            />

            <XAxis hide dataKey="t" />
            <YAxis
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#666", fontSize: 10 }}
              domain={["dataMin - 80", "dataMax + 80"]}
              tickFormatter={(v) => Math.round(v).toLocaleString("en-US")}
            />

            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,.08)", strokeWidth: 1 }}
              content={<CandleTooltip />}
            />

            <Line
              type="monotone"
              dataKey="close"
              stroke="rgba(44,255,143,.35)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />

            <Line
              type="linear"
              dataKey={() => (last ? last.close : 0)}
              stroke={accent}
              strokeDasharray="5 5"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />

            <Customized component={CandleLayer} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ width: "100%", height: "82px", marginTop: "8px" }}>
        <ResponsiveContainer>
          <ComposedChart data={data}>
            <CartesianGrid stroke="rgba(255,255,255,.03)" vertical={false} />
            <XAxis hide dataKey="t" />
            <YAxis hide domain={[0, "dataMax + 40"]} />

            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,.08)", strokeWidth: 1 }}
              content={<CandleTooltip />}
            />

            <Bar
              dataKey="volume"
              barSize={10}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              fill="rgba(255,255,255,.06)"
              shape={(props) => {
                const { x, y, width, height, payload } = props;
                const green = "#2cff8f";
                const red = "#ff4d4d";
                const color = payload?.bullish ? green : red;
                return (
                  <g>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      rx={4}
                      ry={4}
                      fill={color}
                      opacity={0.35}
                    />
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      rx={4}
                      ry={4}
                      fill="transparent"
                      stroke={color}
                      strokeWidth={1}
                      opacity={0.18}
                    />
                  </g>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(900px 260px at 70% 10%, rgba(44,255,143,.08), transparent 60%), radial-gradient(800px 220px at 20% 15%, rgba(247,147,26,.07), transparent 62%)",
          mixBlendMode: "screen",
          opacity: 0.9,
        }}
      />
    </div>
  );
}