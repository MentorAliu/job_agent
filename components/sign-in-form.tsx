"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon, LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { SIGN_UP_CLOSED, WRONG_SETUP_CODE } from "@/lib/auth/errors";
import {
  createAccountSchema,
  signInSchema,
  type SignInInput,
} from "@/lib/schemas/auth";

/** "create" while this copy has no account yet, then "sign-in" for good. */
export type SignInMode = "sign-in" | "create";

/** The setup code in a link setup opened, such as `#setup-code=K7QM-4XPA`. */
const SETUP_CODE_IN_LINK = /(?:^#|&)setup-code=([A-Za-z0-9-]{4,24})(?:&|$)/;

/**
 * The sign-in card. The first time, it creates the account instead, with
 * the setup code that setup printed, filled in when setup opened the page.
 * Signing in opens `next`, the page asked for (lib/auth/return-to.ts), or
 * the app's start page.
 */
export function SignInForm({
  mode,
  next = null,
}: {
  mode: SignInMode;
  next?: string | null;
}) {
  const router = useRouter();
  const creating = mode === "create";
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(creating ? createAccountSchema : signInSchema),
    defaultValues: { email: "", password: "", setupCode: "" },
  });

  // Setup opens this page with the code after `#`, which never reaches the
  // server. It goes into the form and out of the address bar and history.
  useEffect(() => {
    const code = SETUP_CODE_IN_LINK.exec(window.location.hash)?.[1];
    if (!code) return;
    if (creating) setValue("setupCode", code.toUpperCase());
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }, [creating, setValue]);

  async function onSubmit({ email, password, setupCode }: SignInInput) {
    // Better Auth passes extra fields through to the sign-up hook in
    // lib/auth/options.ts, which checks setupCode. Its client type doesn't
    // list them, so the body goes in as a variable rather than a literal.
    const account = {
      email,
      password,
      name: email.split("@")[0] ?? email,
      setupCode,
    };
    const { error } = creating
      ? await authClient.signUp.email(account)
      : await authClient.signIn.email({ email, password });

    if (error) {
      setError("root", { message: errorMessage(mode, error) });
      return;
    }
    // A new account goes straight on to first-run setup; the app's pages
    // send there too until it's finished.
    router.replace(creating ? "/setup" : (next ?? "/"));
    router.refresh();
  }

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <p className="text-center text-sm text-muted-foreground">
        {creating
          ? "Create your account. This copy of Job Agent has just one."
          : "Sign in to your copy of Job Agent."}
      </p>

      <form
        onSubmit={(event) => {
          // The button stays focusable while signing in, so ignore repeats.
          if (isSubmitting) {
            event.preventDefault();
            return;
          }
          void handleSubmit(onSubmit)(event);
        }}
        noValidate
        // scripts/setup.mjs reads it to tell a new copy from one in use.
        data-sign-in-mode={mode}
        className="flex w-full flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "email-error" : undefined}
            className="h-10 bg-card"
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" className="text-sm text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <InputGroup className="h-10 bg-card">
            <InputGroupInput
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete={creating ? "new-password" : "current-password"}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            <InputGroupAddon align="inline-end">
              {/* Named by its text, not aria-label, so it isn't a second "Password" field to tests and screen readers. */}
              <InputGroupButton
                size="icon-xs"
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOffIcon aria-hidden />
                ) : (
                  <EyeIcon aria-hidden />
                )}
                <span className="sr-only">Show password</span>
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {errors.password && (
            <p id="password-error" className="text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        {creating && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="setup-code" className="text-sm font-medium">
              Setup code
            </label>
            <Input
              id="setup-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              aria-invalid={errors.setupCode ? true : undefined}
              aria-describedby={
                errors.setupCode
                  ? "setup-code-error setup-code-hint"
                  : "setup-code-hint"
              }
              className="h-10 bg-card font-mono tracking-wider uppercase placeholder:normal-case placeholder:tracking-normal"
              {...register("setupCode")}
            />
            <p id="setup-code-hint" className="text-xs text-muted-foreground">
              Printed by setup, which fills it in here when it opens this page.
              It&apos;s also in the app&apos;s log:{" "}
              <code>docker compose logs web</code>, or Logs in your Vercel
              project.
            </p>
            {errors.setupCode && (
              <p id="setup-code-error" className="text-sm text-destructive">
                {errors.setupCode.message}
              </p>
            )}
          </div>
        )}

        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}

        <Button
          type="submit"
          aria-disabled={isSubmitting || undefined}
          className="mt-1 h-10 w-full aria-disabled:opacity-70"
        >
          {isSubmitting && <Spinner aria-hidden data-icon="inline-start" />}
          {creating ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="flex items-center gap-1.5 text-center text-xs text-muted-foreground">
        <LockIcon aria-hidden className="size-3.5 shrink-0" />
        {creating
          ? "Once it's created, nobody else can sign up."
          : "Forgot the password? Reset it with the command in the README."}
      </p>
    </div>
  );
}

function errorMessage(
  mode: SignInMode,
  error: { status: number; code?: string; message?: string },
): string {
  if (error.code === WRONG_SETUP_CODE) {
    return "That setup code doesn't match. Copy it again from the setup output or the app's log.";
  }
  if (error.code === SIGN_UP_CLOSED) {
    return "The account already exists. Reload the page to sign in.";
  }
  if (error.status === 429) {
    return "Too many tries. Wait a few seconds and try again.";
  }
  if (mode === "sign-in" && error.status === 401) {
    return "Wrong email or password.";
  }
  return error.message ?? "Something went wrong. Try again.";
}
