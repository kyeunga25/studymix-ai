import { describe, expect, it, vi } from "vitest";
import { fetchPrivateApi } from "./private-api";

describe("private API requests", () => {
  it("requests an AJAX-safe Access response without dropping existing headers", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: null }));

    await fetchPrivateApi(
      "/api/jobs",
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      request,
    );

    expect(request).toHaveBeenCalledOnce();
    const options = request.mock.calls[0]?.[1];
    const headers = new Headers(options?.headers);
    expect(options?.credentials).toBe("same-origin");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Requested-With")).toBe("XMLHttpRequest");
  });
});
