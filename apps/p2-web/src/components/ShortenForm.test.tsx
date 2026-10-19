import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, createLink } from "@/lib/api";

import { ShortenForm } from "./ShortenForm";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  createLink: vi.fn(),
}));

const createLinkMock = vi.mocked(createLink);
const SHORT = { code: "aB3xY9z", shortUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/aB3xY9z" };

function setup() {
  const user = userEvent.setup();
  render(<ShortenForm />);
  return {
    user,
    input: screen.getByLabelText(/url to shorten/i),
    submit: screen.getByRole("button", { name: /shorten/i }),
  };
}

beforeEach(() => {
  createLinkMock.mockReset();
});

describe("ShortenForm", () => {
  it("shows a validation error next to the field without calling the API", async () => {
    const { user, input, submit } = setup();

    await user.type(input, "example.com");
    await user.click(submit);

    expect(createLinkMock).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/http:\/\/ or https:\/\//);
    expect(input).toHaveFocus();
  });

  it("clears the error as soon as the URL is edited", async () => {
    const { user, input, submit } = setup();
    await user.click(submit);
    expect(input).toHaveAttribute("aria-invalid", "true");

    await user.type(input, "h");

    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the button while the request is in flight", async () => {
    createLinkMock.mockReturnValue(new Promise(() => {})); // never settles
    const { user, input, submit } = setup();

    await user.type(input, "https://aws.amazon.com/lambda/");
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent(/shortening/i);
  });

  it("shortens the trimmed URL and shows the short link and a stats link", async () => {
    createLinkMock.mockResolvedValue(SHORT);
    const { user, input, submit } = setup();

    await user.type(input, "  https://aws.amazon.com/lambda/ ");
    await user.click(submit);

    expect(createLinkMock).toHaveBeenCalledWith("https://aws.amazon.com/lambda/");
    expect(await screen.findByRole("link", { name: SHORT.shortUrl })).toHaveAttribute("href", SHORT.shortUrl);
    // next/link applies trailingSlash only under `next build`, so compare path and query, not text.
    const stats = new URL(screen.getByRole("link", { name: /view stats/i }).getAttribute("href")!, "https://x");
    expect(stats.pathname).toMatch(/^\/stats\/?$/);
    expect(stats.searchParams.get("code")).toBe("aB3xY9z");
    expect(screen.getByRole("status")).toHaveTextContent(/short link ready/i);
    expect(submit).toBeEnabled();
  });

  it.each([
    [new ApiError(400, "invalid url: must be http or https with a host"), /invalid url/],
    [new ApiError(429, "Too Many Requests"), /too many requests/i],
    [new ApiError(0, "Can't reach the API."), /can't reach the api/i],
  ])("shows the API failure %o as an alert", async (err, message) => {
    createLinkMock.mockRejectedValue(err);
    const { user, input, submit } = setup();

    await user.type(input, "https://example.com");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(submit).toBeEnabled();
  });

  it("copies the short link and confirms it", async () => {
    createLinkMock.mockResolvedValue(SHORT);
    const { user, input, submit } = setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    await user.type(input, "https://aws.amazon.com/lambda/");
    await user.click(submit);
    await user.click(await screen.findByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(SHORT.shortUrl);
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("explains how to copy by hand when the clipboard is unavailable", async () => {
    createLinkMock.mockResolvedValue(SHORT);
    const { user, input, submit } = setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

    await user.type(input, "https://aws.amazon.com/lambda/");
    await user.click(submit);
    await user.click(await screen.findByRole("button", { name: /copy/i }));

    expect(await screen.findByText(/select the link and copy it/i)).toBeInTheDocument();
  });
});
