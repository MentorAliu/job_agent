"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { authClient } from "@/lib/auth-client";

export function useSignOut() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await authClient.signOut();
      router.replace("/sign-in");
      router.refresh();
    });
  }

  return { pending, signOut };
}
