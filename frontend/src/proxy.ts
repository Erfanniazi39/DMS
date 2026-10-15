import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The /api rewrite (next.config.ts) forwards requests to the backend, but Next's
// rewrite proxy does not add the client's address — the backend would see every
// user as 127.0.0.1, which breaks the per-address login limits and makes the audit
// log's IP useless (security review H2). Next knows the real address (it is in
// x-forwarded-for by the time this runs, either from the TLS proxy in front or from
// the socket); passing it on explicitly makes the backend's `trust proxy` work.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) headers.set("x-forwarded-for", forwarded);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
