import { getAuth } from "@/lib/dal/auth";

// Better Auth's endpoints: sign-up, sign-in, sign-out and session.
export function GET(request: Request) {
  return getAuth().handler(request);
}

export function POST(request: Request) {
  return getAuth().handler(request);
}
