import { z } from "zod";

// Better Auth's default minimum password length.
export const MIN_PASSWORD_LENGTH = 8;

export const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    ),
  // Only the first sign-up, which creates the account, asks for it.
  setupCode: z.string().trim(),
});

export type SignInInput = z.infer<typeof signInSchema>;

/** Creating the account: the same fields, and the setup code is required. */
export const createAccountSchema = signInSchema.extend({
  setupCode: z.string().trim().min(1, "Enter the setup code."),
});
