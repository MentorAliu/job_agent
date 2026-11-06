import { expect, test, type Page } from "@playwright/test";

import { setupCodeFor } from "../lib/auth/setup-code";

import { smokeEnv } from "./stack";

// The whole owner journey against `docker compose --profile app`, with the
// Claude API replaced by e2e/fake-claude, which answers with the recorded
// responses in test/fixtures/claude. Every other part is the real stack:
// the built app, Postgres, the self-hosted Inngest server and Redis.

const env = smokeEnv();
const FAKE_CLAUDE = `http://localhost:${env.FAKE_CLAUDE_PORT}`;
const EMAIL = "owner@smoke.test";
const PASSWORD = "smoke-test-password";

// A one-page PDF. The app only checks the file type; the fake API answers
// with the recorded read of the fictional "Jordan Sample" CV.
const CV_PDF = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    "4 0 obj<</Length 44>>stream",
    "BT /F1 18 Tf 72 720 Td (Jordan Sample) Tj ET",
    "endstream endobj",
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n"),
);

type FakeRequest = {
  kind: string;
  model: string | null;
  body: {
    tools?: {
      name: string;
      allowed_domains?: string[];
      blocked_domains?: string[];
    }[];
  };
};

async function claudeRequests(): Promise<FakeRequest[]> {
  const response = await fetch(`${FAKE_CLAUDE}/__requests`);
  return (await response.json()) as FakeRequest[];
}

/**
 * Opens a page and waits for the network to settle, so its streamed parts
 * are in and the form is hydrated before anything is typed into it.
 */
async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
}

/** Opens a PDF in the app's own viewer, waits for its pages, and closes it. */
async function viewPdf(page: Page, button: string) {
  await page.getByRole("button", { name: button, exact: true }).first().click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByText(/^Page 1 of \d+$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
}

async function save(page: Page, label: string) {
  await page.getByRole("button", { name: label }).click();
  await expect(page.getByText(/^Saved at/)).toBeVisible();
}

test("from sign-in through setup and a search to an automatic kit, an edited CV, Mark as applied, a pasted email, a built CV and an added role", async ({
  page,
}) => {
  await test.step("create the account with the setup code, which opens setup", async () => {
    const code = setupCodeFor(env.BETTER_AUTH_SECRET);
    // Setup opens the page with the code after #: the form takes it, and
    // the address bar no longer shows it.
    await open(page, `/sign-in#setup-code=${code}`);
    await expect(page.getByLabel("Setup code")).toHaveValue(code);
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByLabel("Setup code").fill("WRNG-CODE");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/setup code doesn't match/)).toBeVisible();
    await page.getByLabel("Setup code").fill(code);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/setup(\?step=provider)?$/);
    // The app's pages wait until setup is done.
    await open(page, "/jobs");
    await expect(page).toHaveURL(/\/setup\?step=provider$/);
  });

  await test.step("setup: pick the Claude API, which checks itself", async () => {
    // The key comes from ANTHROPIC_API_KEY, so the check starts at once.
    await page.getByText("Claude API", { exact: true }).click();
    await expect(page.getByText("Claude API works.")).toBeVisible({
      timeout: 2 * 60_000,
    });
    const checks = (await claudeRequests()).filter(
      (request) => request.kind === "check-engine",
    );
    expect(checks.map((request) => request.model)).toEqual([
      "claude-haiku-5-5",
    ]);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/step=cv$/);
  });

  await test.step("setup: upload a CV, which fills the profile by itself", async () => {
    await page.getByRole("button", { name: /^Upload your CV/ }).click();
    await page.getByLabel("CV file").setInputFiles({
      name: "jordan-sample-cv.pdf",
      mimeType: "application/pdf",
      buffer: CV_PDF,
    });
    await expect(
      page.getByText(/^Found 3 roles, 14 skills and 1 school/),
    ).toBeVisible({ timeout: 2 * 60_000 });
    await expect(
      page.getByText("Jordan Sample", { exact: true }),
    ).toBeVisible();
    // The ATS-friendly CV is optional after an upload; this run skips it.
    await page.getByRole("button", { name: "Looks right, continue" }).click();
    await expect(page).toHaveURL(/step=wanted$/);
  });

  await test.step("setup: what you're looking for, answered from the CV", async () => {
    const next = () =>
      page.getByRole("button", { name: "Next", exact: true }).click();
    // The CV's headline says frontend and senior, its location Montenegro.
    await expect(page.getByRole("radio", { name: /^Frontend/ })).toBeChecked();
    await next();
    await expect(page.getByRole("checkbox", { name: "Senior" })).toBeChecked();
    await next();
    await expect(
      page.getByRole("checkbox", { name: "Montenegro" }),
    ).toBeChecked();
    await next();
    // This browser's time zone (playwright.config.ts) is ticked for it.
    await expect(
      page.getByRole("checkbox", { name: /^Europe\/Belgrade/ }),
    ).toBeChecked();
    await next();
    await expect(
      page.getByRole("checkbox", { name: "TypeScript" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(/step=ready$/);
  });

  await test.step("setup: open the app, after which setup sends you there", async () => {
    await expect(page.getByText("Claude API works")).toBeVisible();
    await expect(
      page.getByText("From Montenegro · Europe/Belgrade"),
    ).toBeVisible();
    // The daily search's time zone is this browser's (playwright.config.ts).
    await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue(
      "Europe/Belgrade",
    );
    await expect(
      page.getByText("Search every morning at 07:00, Europe/Belgrade time"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open the app" }).click();
    await expect(page).toHaveURL(/\/$/);
    await open(page, "/setup");
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step("the profile and preferences hold what setup saved", async () => {
    await open(page, "/profile");
    await expect(
      page
        .getByRole("region", { name: "About you" })
        .getByText("Jordan Sample"),
    ).toBeVisible();
    await viewPdf(page, "View");
    await open(page, "/profile/preferences");
    for (const answer of ["Montenegro", "Europe/Belgrade", "TypeScript"]) {
      await expect(
        page.getByRole("button", { name: `Remove ${answer}`, exact: true }),
      ).toBeVisible();
    }
  });

  await test.step("search now, with the models and domains fixed in code", async () => {
    await open(page, "/runs");
    await page.getByRole("button", { name: "Search now" }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    await expect(
      page.getByText("Finished", { exact: true }).first(),
    ).toBeVisible({ timeout: 4 * 60_000 });

    const requests = await claudeRequests();
    const discover = requests.filter((request) => request.kind === "discover");
    expect(discover.length).toBeGreaterThan(1);
    const searches = discover.map((request) =>
      request.body.tools?.find((tool) => tool.name === "web_search"),
    );
    // One call per group of job sites, then one on the rest of the web.
    for (const search of searches.slice(0, -1)) {
      expect(search?.allowed_domains?.length).toBeGreaterThan(0);
      expect(search?.allowed_domains?.length).toBeLessThanOrEqual(4);
      expect(search?.blocked_domains).toBeUndefined();
    }
    const openWeb = searches.at(-1);
    expect(openWeb?.allowed_domains).toBeUndefined();
    expect(openWeb?.blocked_domains).toEqual(
      expect.arrayContaining(["greenhouse.io", "linkedin.com", "indeed.com"]),
    );
    const scoring = requests.filter(
      (request) => request.kind === "score-batch",
    );
    expect(scoring.map((request) => request.model)).toEqual([
      "claude-haiku-5-5",
    ]);
  });

  await test.step("the app picks the strong match and writes its kit", async () => {
    // The recorded score is 86, over the bar, so nobody has to shortlist it.
    await open(page, "/jobs");
    await page
      .getByRole("link", { name: /Senior Frontend Engineer \(React\)/ })
      .click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("status").filter({ hasText: "The documents are ready." }),
    ).toBeAttached({ timeout: 4 * 60_000 });
    // The recorded tailoring has two planted claims: one cites a fact that
    // isn't in the profile, and Claude's check rejects the other.
    await expect(page.getByText("2 claims left out")).toBeVisible();
    // The ATS check: the posting's keywords, and the ones the CV uses.
    await expect(
      page.getByText(/of the posting's keywords are on the CV\.$/),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "The posting's keywords" }),
    ).toContainText("TypeScript, on the CV");
    await expect(
      page.getByRole("link", { name: "Download PDF" }).first(),
    ).toBeVisible();
    await viewPdf(page, "View PDF");
  });

  await test.step("edit the kit's CV on the CVs page, so the kit sends the new version", async () => {
    await open(page, "/cvs?tab=tailored");
    await page
      .getByRole("list", { name: "Tailored CVs" })
      .getByRole("link", { name: "Edit Senior Frontend Engineer (React)" })
      .click();
    await expect(page).toHaveURL(/\/cvs\/edit\?kit=[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Edit CV" })).toBeVisible();
    await page.getByLabel("Title under your name").fill("Frontend Lead");
    await page
      .getByRole("button", { name: /^Remove: Migrated a 40k-line/ })
      .click();
    await expect(page.getByText(/^Migrated a 40k-line/)).toBeHidden();
    await page.getByRole("button", { name: "Save as version 2" }).click();

    // The kit opens and follows the new version while its PDF is drawn.
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/^Version 2 · edited by you/)).toBeVisible({
      timeout: 2 * 60_000,
    });
    const paper = page.getByRole("article", { name: "The tailored CV" });
    await expect(paper).toContainText("Frontend Lead");
    await expect(paper).not.toContainText("Migrated a 40k-line");
    // An edit asks Claude nothing.
    const tailoring = (await claudeRequests()).filter((request) =>
      ["tailor", "claim-check"].includes(request.kind),
    );
    expect(tailoring).toHaveLength(2);
  });

  await test.step("mark as applied in one click, which opens the application's page", async () => {
    await page.getByRole("button", { name: "Mark as applied" }).click();
    await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
    await expect(page.locator("#now")).toContainText("Nothing to do yet");
    await expect(
      page.getByRole("list", { name: "The conversation, oldest first" }),
    ).toContainText("You applied with CV v2");
  });

  await test.step("paste the company's email: the role moves on and a reply is ready", async () => {
    await page
      .getByLabel(/^Paste an email from/)
      .fill(
        "Hi Jordan,\n\nThanks for applying for the Senior Frontend Engineer role. We'd love to invite you to a 30-minute intro call with our engineering manager next week.\n\nDana",
      );
    await page.getByRole("button", { name: "Read email" }).click();
    const card = page.getByRole("article", { name: "Interview invite" });
    await expect(card).toBeVisible({ timeout: 2 * 60_000 });
    await expect(card).toContainText("Moved the role to Interviewing.");
    // The reply it needs waits at the top of the page.
    const now = page.locator("#now");
    await expect(now).toContainText("Your turn");
    await expect(now).toContainText("[two or three times that suit you]");
    await expect(
      now.getByRole("button", { name: /^Copy reply/ }),
    ).toBeVisible();
    const reads = (await claudeRequests()).filter(
      (request) => request.kind === "read-email",
    );
    expect(reads.map((request) => request.model)).toEqual([
      "claude-sonnet-5-5",
    ]);

    // The company is waiting for an answer, so it's the owner's turn.
    await open(page, "/applications?stage=your_turn");
    await expect(
      page.getByRole("link", { name: /Senior Frontend Engineer \(React\)/ }),
    ).toContainText("Your turn");
  });

  await test.step("build a CV from the profile, aimed at a posting, and find it saved", async () => {
    await open(page, "/cvs/new");
    // The form starts filled in from the profile and the preferences.
    await expect(page.getByLabel("Job title")).toHaveValue(
      "Senior Frontend Engineer",
    );
    await page
      .getByLabel("Job posting to match (optional)")
      .fill("We want React, TypeScript, Next.js and GraphQL.");
    await page.getByRole("button", { name: "Build CV" }).click();
    await expect(page).toHaveURL(/\/cvs\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "ATS check" })).toBeVisible({
      timeout: 4 * 60_000,
    });
    // The same two planted claims as the kit's, left out of the PDF.
    await expect(page.getByText("2 claims left out")).toBeVisible();
    // GraphQL is only in a planted claim, and Accessibility isn't in the
    // profile at all.
    await expect(page.getByText("5 of 8", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Page 1 of \d+$/)).toBeVisible();
    const builds = (await claudeRequests()).filter(
      (request) => request.kind === "build-cv",
    );
    expect(builds.map((request) => request.model)).toEqual([
      "claude-sonnet-5-5",
    ]);

    // Saved on the CVs page, beside the uploaded CV.
    await open(page, "/cvs");
    const general = page.getByRole("list", { name: "General CVs" });
    await expect(
      general.getByRole("button", {
        name: "jordan-sample-cv.pdf",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      general.getByRole("link", {
        name: "Senior Frontend Engineer",
        exact: true,
      }),
    ).toBeVisible();
  });

  await test.step("edit the built CV into a new one, with no Claude call", async () => {
    await page
      .getByRole("list", { name: "General CVs" })
      .getByRole("link", { name: "Edit Senior Frontend Engineer", exact: true })
      .click();
    await expect(page).toHaveURL(/\/cvs\/edit\?cv=[0-9a-f-]{36}$/);
    await page.getByLabel("Title under your name").fill("Frontend Lead");
    await page.getByRole("button", { name: "Remove React" }).click();
    await page.getByRole("button", { name: "Save as a new CV" }).click();
    await expect(page).toHaveURL(/\/cvs\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "ATS check" })).toBeVisible({
      timeout: 2 * 60_000,
    });
    await expect(page.getByText(/^You picked every line/)).toBeVisible();
    await expect(page.getByText(/^Page 1 of \d+$/)).toBeVisible();
    const builds = (await claudeRequests()).filter(
      (request) => request.kind === "build-cv",
    );
    expect(builds).toHaveLength(1);

    // Both are on the General tab, and the kit's two versions on the other.
    await open(page, "/cvs");
    const general = page.getByRole("list", { name: "General CVs" });
    await expect(general.getByRole("listitem")).toHaveCount(3);
    await expect(
      general.getByRole("link", { name: "Frontend Lead", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Tailored for a job/ }).click();
    await expect(
      page.getByRole("list", { name: "Tailored CVs" }).getByRole("button", {
        name: "Senior Frontend Engineer (React)",
        exact: true,
      }),
    ).toHaveCount(2);
  });

  await test.step("add a role by hand: Claude reads the pasted posting and finds the role it already is", async () => {
    await open(page, "/jobs");
    await page.getByRole("button", { name: "Add a role" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a role" });
    // LinkedIn's terms forbid apps to read its pages, so it asks for the text.
    await dialog
      .getByLabel("Link to the posting")
      .fill("https://www.linkedin.com/jobs/view/4012345678");
    await dialog.getByRole("button", { name: "Add role" }).click();
    await expect(
      dialog.getByText(
        "linkedin.com doesn't allow apps to read its pages. Paste the posting's text here.",
      ),
    ).toBeVisible();
    await dialog
      .getByLabel("The posting's text (optional)")
      .fill(
        [
          "Senior Frontend Engineer (React) at Northwind Labs",
          "Fully remote within Europe.",
          "You build our customer app in React and TypeScript, own the design system and mentor two engineers.",
          "You have five years of frontend work, and you care about accessibility and fast pages.",
        ].join("\n"),
      );
    await dialog.getByRole("button", { name: "Add role" }).click();
    await expect(dialog).toBeHidden();

    // The recorded reading is the posting the search found, so it's that role.
    const added = page.getByRole("region", { name: "Roles you added" });
    await expect(added).toContainText("It was already in your roles.", {
      timeout: 2 * 60_000,
    });
    await expect(
      added.getByRole("link", { name: /Senior Frontend Engineer \(React\)/ }),
    ).toBeVisible();
  });

  await test.step("Settings has the time zone setup saved, and changes it", async () => {
    await open(page, "/settings");
    const zone = page.getByLabel("Your time zone");
    await expect(zone).toHaveValue("Europe/Belgrade");
    await zone.selectOption("America/New_York");
    await expect(
      page.getByText("Search every morning at 07:00, America/New York time"),
    ).toBeVisible();
    await save(page, "Save settings");
    await open(page, "/settings");
    await expect(page.getByLabel("Your time zone")).toHaveValue(
      "America/New_York",
    );
    // The browser is still on Belgrade time, so Settings offers it back.
    await expect(
      page.getByText("This computer is on Europe/Belgrade time."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Use it" }).click();
    await expect(zone).toHaveValue("Europe/Belgrade");
    await save(page, "Save settings");
  });

  await test.step("the monthly cap blocks a new search with a clear message", async () => {
    await open(page, "/settings");
    await page.getByLabel("Most the agents may spend a month (USD)").fill("0");
    await save(page, "Save settings");

    await open(page, "/runs");
    await page.getByRole("button", { name: "Search now" }).click();
    const panel = page.locator("#search-now-error");
    await expect(panel).toContainText("Monthly budget reached");
    await expect(panel).toContainText("no new search can start until");
    await expect(
      panel.getByRole("link", { name: "Open Settings" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/runs$/);
  });
});
