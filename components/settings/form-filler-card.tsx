import { DownloadIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

import { SettingsCard } from "./settings-card";

/** Where to get the Chrome extension that fills application forms. */
export function FormFillerCard() {
  return (
    <SettingsCard
      title="Form filler"
      description="A Chrome extension that fills an application form from the role's apply kit, attaches the PDFs, and marks the role Applied when you press Submit. It never submits for you."
    >
      <div className="flex flex-col items-start gap-3">
        <a
          href="/api/extension/download"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <DownloadIcon aria-hidden />
          Download for Chrome
        </a>
        <ol className="list-decimal pl-5 text-[0.8125rem] text-muted-foreground">
          <li>Unzip it.</li>
          <li>
            In Chrome, open chrome://extensions, turn on Developer mode and
            press Load unpacked.
          </li>
          <li>Pick the job-agent-form-filler folder.</li>
        </ol>
        <p className="text-[0.8125rem] text-muted-foreground">
          On an application form, click the extension&apos;s icon and press Fill
          this form. Stay signed in to Job Agent in the same browser.
        </p>
      </div>
    </SettingsCard>
  );
}
