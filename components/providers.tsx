"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <NuqsAdapter>
        <TooltipProvider>
          <Toaster>{children}</Toaster>
        </TooltipProvider>
      </NuqsAdapter>
      {/* Only in `pnpm dev`: production builds leave the devtools out. */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
