import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import { SIGN_UP_CLOSED, WRONG_SETUP_CODE } from "./errors";
import { authOptions } from "./options";
import { setupCodeFor } from "./setup-code";

const SECRET = "test-secret-that-is-long-enough-for-better-auth";
const CODE = setupCodeFor(SECRET);
const BASE_URL = "http://localhost:3000";

/** `codeSecret` is the secret the setup code comes from: none fails closed. */
function createTestAuth(codeSecret: string | undefined = SECRET) {
  return betterAuth({
    ...authOptions(codeSecret),
    secret: SECRET,
    baseURL: BASE_URL,
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      rateLimit: [],
    }),
  });
}

function signUpRequest(email: string, setupCode?: string) {
  return new Request(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify({
      email,
      password: "a-long-password",
      name: "Test",
      setupCode,
    }),
  });
}

describe("first sign-up creates the one account", () => {
  it("creates it with the setup code, in any case and spacing", async () => {
    const loose = CODE.toLowerCase().replace("-", " ");
    const response = await createTestAuth().handler(
      signUpRequest("me@example.com", loose),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { email: string } };
    expect(body.user.email).toBe("me@example.com");
  });

  it("refuses a missing or wrong setup code", async () => {
    const auth = createTestAuth();
    for (const code of [undefined, "", "ABCD-EFGH"]) {
      const response = await auth.handler(
        signUpRequest("me@example.com", code),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: WRONG_SETUP_CODE });
    }
  });

  it("refuses everyone when the app has no secret", async () => {
    const response = await createTestAuth("").handler(
      signUpRequest("me@example.com", CODE),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: WRONG_SETUP_CODE });
  });

  it("closes sign-up once the account exists, even with the code", async () => {
    const auth = createTestAuth();
    expect(
      (await auth.handler(signUpRequest("me@example.com", CODE))).status,
    ).toBe(200);

    const second = await auth.handler(signUpRequest("other@example.com", CODE));
    expect(second.status).toBe(403);
    expect(await second.json()).toMatchObject({ code: SIGN_UP_CLOSED });
  });
});
