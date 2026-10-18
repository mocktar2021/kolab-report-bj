// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/user", () => ({ getCurrentUser: vi.fn() }));

const ID = "0b6f5e1c-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const SIGNED = "http://127.0.0.1:54321/storage/v1/object/sign/deliverables/w/s/f?token=t";

/** What RLS lets the signed-in user read, and the signed links storage gives. */
function readable(file: { mime_type: string } | null) {
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: SIGNED }, error: null }));
  const query = {
    select: () => query,
    eq: () => query,
    not: () => query,
    maybeSingle: async () => ({
      data: file && { storage_path: "w/s/f", file_name: "Façade.png", ...file },
      error: null,
    }),
  };
  vi.mocked(createClient).mockResolvedValue({
    from: () => query,
    storage: { from: () => ({ createSignedUrl }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return createSignedUrl;
}

function get(search = "") {
  return GET(new NextRequest(`http://localhost:3000/api/deliverables/${ID}/file${search}`), {
    params: Promise.resolve({ id: ID }),
  });
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1" } as Awaited<ReturnType<typeof getCurrentUser>>);
});

describe("GET /api/deliverables/[id]/file", () => {
  it("downloads a file as an attachment", async () => {
    const createSignedUrl = readable({ mime_type: "image/png" });
    const response = await get();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(SIGNED);
    expect(createSignedUrl).toHaveBeenCalledWith("w/s/f", 60, { download: "Façade.png" });
  });

  it("shows a PNG or a JPEG of a section's text inline (KRB-216)", async () => {
    for (const mime_type of ["image/png", "image/jpeg"]) {
      const createSignedUrl = readable({ mime_type });
      const response = await get("?image");
      expect(response.status).toBe(303);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(createSignedUrl).toHaveBeenCalledWith("w/s/f", 60, undefined);
    }
  });

  it("refuses any other type as an image of the text, SVG and WebP included", async () => {
    for (const mime_type of ["image/svg+xml", "image/webp", "application/pdf"]) {
      const createSignedUrl = readable({ mime_type });
      const response = await get("?image");
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: "fileType" });
      expect(createSignedUrl).not.toHaveBeenCalled();
    }
  });

  it("answers 404 for a file the user cannot read, and 401 when signed out", async () => {
    readable(null);
    expect((await get("?image")).status).toBe(404);
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await get("?image")).status).toBe(401);
  });
});
