import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/StatusBadge";

describe("StatusBadge", () => {
  it("renders the idle stage as Ready with the idle class", () => {
    render(<StatusBadge stage="idle" />);
    expect(screen.getByText("Ready")).toHaveClass("badge-idle");
  });

  it("renders the grace stage as Review with the grace class", () => {
    render(<StatusBadge stage="grace" />);
    expect(screen.getByText("Review")).toHaveClass("badge-grace");
  });
});
