import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionStatus } from "@/components/ConnectionStatus";

describe("ConnectionStatus", () => {
  it("renders connected as Live with the live class and the message as a title", () => {
    render(<ConnectionStatus status="connected" message="Live room joined." />);
    const badge = screen.getByText("Live");
    expect(badge).toHaveClass("conn-live");
    expect(badge).toHaveAttribute("title", "Live room joined.");
  });

  it("renders the disabled status as Local", () => {
    render(<ConnectionStatus status="disabled" message="Local room" />);
    expect(screen.getByText("Local")).toHaveClass("conn-local");
  });
});
