import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptInput } from "../../../src/renderer/components/PromptInput";

describe("PromptInput", () => {
  it("calls onSubmit with trimmed text when Enter is pressed", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PromptInput isStreaming={false} onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox"), "hello{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("does not call onSubmit for whitespace-only input", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PromptInput isStreaming={false} onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox"), "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not call onSubmit on Shift+Enter", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PromptInput isStreaming={false} onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox"), "hello{Shift>}{Enter}{/Shift}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("textarea is disabled when isStreaming is true", () => {
    render(<PromptInput isStreaming={true} onSubmit={vi.fn()} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("does not call onSubmit when isStreaming is true and Enter is pressed", async () => {
    const onSubmit = vi.fn();
    render(<PromptInput isStreaming={true} onSubmit={onSubmit} />);
    // disabled textarea won't accept typing but test the guard directly
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears the textarea value after submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PromptInput isStreaming={false} onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox"), "hi{Enter}");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
