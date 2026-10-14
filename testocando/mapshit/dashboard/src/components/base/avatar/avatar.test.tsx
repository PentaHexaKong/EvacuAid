import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { Avatar } from "@/components/base/avatar/avatar";

test("renders BoardUI sidebar initials at the medium size", () => {
  render(<Avatar initials="EA" />);

  expect(screen.getByText("EA")).toHaveClass("size-8", "bg-avatar-neutral-background");
});
