import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { StatsBar } from "../../../src/renderer/components/StatsBar";
import type { SessionStatsData } from "../../../src/renderer/hooks/use-session-stats";

function makeStats(overrides: Partial<SessionStatsData> = {}): SessionStatsData {
  return {
    tokens: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, total: 300 },
    cost: 0.0012,
    contextUsage: { tokens: 3000, contextWindow: 10000, percent: 30 },
    ...overrides,
  };
}

describe("StatsBar", () => {
  it("renders nothing when stats is null", () => {
    const { container } = render(<StatsBar stats={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders token count with k abbreviation", () => {
    render(<StatsBar stats={makeStats({ tokens: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 0, total: 3000 } })} />);
    expect(screen.getByText(/3\.0k tokens/)).toBeInTheDocument();
  });

  it("renders M abbreviation for large token counts", () => {
    render(<StatsBar stats={makeStats({ tokens: { input: 500000, output: 500000, cacheRead: 0, cacheWrite: 0, total: 1_000_000 } })} />);
    expect(screen.getByText(/1\.0M tokens/)).toBeInTheDocument();
  });

  it("renders small token counts without abbreviation", () => {
    render(<StatsBar stats={makeStats({ tokens: { input: 50, output: 50, cacheRead: 0, cacheWrite: 0, total: 100 } })} />);
    expect(screen.getByText(/^100 tokens$/)).toBeInTheDocument();
  });

  it("renders cost when cost > 0", () => {
    render(<StatsBar stats={makeStats({ cost: 0.0034 })} />);
    expect(screen.getByText("$0.0034")).toBeInTheDocument();
  });

  it("hides cost when cost is 0", () => {
    render(<StatsBar stats={makeStats({ cost: 0 })} />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("renders context percent when contextUsage.percent is set", () => {
    render(<StatsBar stats={makeStats({ contextUsage: { tokens: 3000, contextWindow: 10000, percent: 30 } })} />);
    expect(screen.getByText("30% ctx")).toBeInTheDocument();
  });

  it("hides context bar when percent is null", () => {
    render(<StatsBar stats={makeStats({ contextUsage: { tokens: null, contextWindow: 10000, percent: null } })} />);
    expect(screen.queryByText(/% ctx/)).toBeNull();
  });

  it("hides context bar when contextUsage is absent", () => {
    render(<StatsBar stats={makeStats({ contextUsage: undefined })} />);
    expect(screen.queryByText(/% ctx/)).toBeNull();
  });

  it("caps context bar width at 100% when percent exceeds 100", () => {
    render(<StatsBar stats={makeStats({ contextUsage: { tokens: 12000, contextWindow: 10000, percent: 120 } })} />);
    // Text shows rounded value (120%)
    expect(screen.getByText("120% ctx")).toBeInTheDocument();
    // The inner bar element should be capped at 100%
    const bar = document.querySelector(".stats-context-bar") as HTMLElement;
    expect(bar.style.width).toBe("100%");
  });

  it("has accessible label", () => {
    render(<StatsBar stats={makeStats()} />);
    expect(screen.getByRole("generic", { name: "Session statistics" })).toBeInTheDocument();
  });
});
