import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Each step is one request. On Vercel it may run this long (the Hobby maximum),
// as Inngest's Vercel guide advises setting explicitly.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
