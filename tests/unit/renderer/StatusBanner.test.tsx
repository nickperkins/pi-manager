import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { StatusBanner } from "../../../src/renderer/components/StatusBanner";
import type { StatusDetail } from "../../../src/renderer/hooks/use-status-detail";

describe("StatusBanner", () => {
  it("renders nothing for idle status", () => {
    const { container } = render(
      <StatusBanner status="idle" detail={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for streaming status", () => {
    const { container } = render(
      <StatusBanner status="streaming" detail={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for spawning status", () => {
    const { container } = render(
      <StatusBanner status="spawning" detail={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders compacting banner with reason", () => {
    render(
      <StatusBanner
        status="compacting"
        detail={{ compactionReason: "threshold" }}
      />,
    );
    expect(screen.getByText(/Compacting context.*\(threshold\)/)).toBeInTheDocument();
  });

  it("renders compacting banner without reason when detail is empty", () => {
    render(
      <StatusBanner status="compacting" detail={{}} />,
    );
    expect(screen.getByText("⟳ Compacting context…")).toBeInTheDocument();
  });

  it("renders retrying banner with attempt info", () => {
    render(
      <StatusBanner
        status="retrying"
        detail={{
          retryInfo: {
            attempt: 2,
            maxAttempts: 5,
            delayMs: 3000,
            errorMessage: "Rate limit",
          },
        }}
      />,
    );
    expect(screen.getByText(/attempt 2 \/ 5/)).toBeInTheDocument();
  });

  it("renders retrying banner with error message detail", () => {
    render(
      <StatusBanner
        status="retrying"
        detail={{
          retryInfo: {
            attempt: 1,
            maxAttempts: 3,
            delayMs: 1000,
            errorMessage: "429 Usage limit reached for 5 hour. Your limit will reset at 2026-04-30 21:50:07",
          },
        }}
      />,
    );
    expect(screen.getByText(/429 Usage limit reached/)).toBeInTheDocument();
  });

  it("does not render error detail when errorMessage is empty string", () => {
    render(
      <StatusBanner
        status="retrying"
        detail={{
          retryInfo: { attempt: 1, maxAttempts: 3, delayMs: 500, errorMessage: "" },
        }}
      />,
    );
    // Banner should be present but no error detail span
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/429/)).toBeNull();
  });

  it("renders nothing for retrying status without retryInfo", () => {
    const { container } = render(
      <StatusBanner status="retrying" detail={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders errored banner with errorMessage from record", () => {
    render(
      <StatusBanner status="errored" detail={{}} errorMessage="API key invalid" />,
    );
    expect(screen.getByText(/Session error: API key invalid/)).toBeInTheDocument();
  });

  it("renders errored banner with fallback text when errorMessage is absent", () => {
    render(
      <StatusBanner status="errored" detail={{}} />,
    );
    expect(screen.getByText(/Session error: Unknown error/)).toBeInTheDocument();
  });

  it("compacting banner has role=status", () => {
    render(
      <StatusBanner status="compacting" detail={{ compactionReason: "manual" }} />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("retrying banner has role=status", () => {
    render(
      <StatusBanner
        status="retrying"
        detail={{ retryInfo: { attempt: 1, maxAttempts: 3, delayMs: 500, errorMessage: "" } }}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("errored banner has role=alert", () => {
    render(
      <StatusBanner status="errored" detail={{}} errorMessage="fail" />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
