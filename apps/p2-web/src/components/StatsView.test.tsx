import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, getStats } from "@/lib/api";

import StatsView from "./StatsView";

// vi.mock is hoisted above the imports, so shared state must be hoisted too.
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getStats: vi.fn(),
}));

const getStatsMock = vi.mocked(getStats);
const STATS = { url: "https://aws.amazon.com/lambda/", clicks: 1234, createdAt: "2026-10-19T09:00:00Z" };

beforeEach(() => {
  getStatsMock.mockReset();
  nav.search = "code=aB3xY9z";
});

describe("StatsView", () => {
  it("asks for a code when the URL has none, without calling the API", () => {
    nav.search = "";

    render(<StatsView />);

    const input = screen.getByLabelText(/short code/i);
    expect(input).toHaveAttribute("name", "code");
    expect(input.closest("form")).toHaveAttribute("action", "/stats/");
    expect(getStatsMock).not.toHaveBeenCalled();
  });

  it("shows a loading state while the request is in flight", () => {
    getStatsMock.mockReturnValue(new Promise(() => {})); // never settles

    render(<StatsView />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading stats for aB3xY9z/i);
    expect(getStatsMock).toHaveBeenCalledWith("aB3xY9z");
  });

  it("shows the destination, click count and creation time", async () => {
    getStatsMock.mockResolvedValue(STATS);

    render(<StatsView />);

    expect(await screen.findByRole("link", { name: STATS.url })).toHaveAttribute("href", STATS.url);
    expect(screen.getByText((1234).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "TIME")).toHaveAttribute("dateTime", STATS.createdAt);
  });

  it("says when the code does not exist or has expired", async () => {
    getStatsMock.mockRejectedValue(new ApiError(404, "not found"));

    render(<StatsView />);

    expect(await screen.findByText(/no link with that code/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /shorten a link/i })).toHaveAttribute("href", "/");
  });

  it("offers a retry after other errors, and the retry can succeed", async () => {
    getStatsMock.mockRejectedValueOnce(new ApiError(500, "internal error")).mockResolvedValueOnce(STATS);
    const user = userEvent.setup();

    render(<StatsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("link", { name: STATS.url })).toBeInTheDocument();
    expect(getStatsMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest code's stats when an older request answers last", async () => {
    const pending = new Map<string, (stats: typeof STATS) => void>();
    getStatsMock.mockImplementation((code) => new Promise((resolve) => pending.set(code, resolve)));

    const { rerender } = render(<StatsView />); // requests aB3xY9z
    nav.search = "code=zzzzzzz";
    rerender(<StatsView />); // requests zzzzzzz; aB3xY9z is still in flight

    pending.get("zzzzzzz")!({ ...STATS, url: "https://new.example/" });
    expect(await screen.findByRole("link", { name: "https://new.example/" })).toBeInTheDocument();

    await act(async () => pending.get("aB3xY9z")!({ ...STATS, url: "https://old.example/" }));

    expect(screen.getByRole("link", { name: "https://new.example/" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "https://old.example/" })).not.toBeInTheDocument();
  });
});
