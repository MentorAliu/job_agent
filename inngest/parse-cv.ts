import { NonRetriableError } from "inngest";

import { hasClaudeApiKey } from "@/lib/claude/api-key";
import { BudgetExceededError } from "@/lib/claude/budget";
import { getStageSetup } from "@/lib/claude/llm-call";
import {
  CvParseError,
  deleteCvFile,
  readCv,
  uploadCvFile,
  type CvSource,
} from "@/lib/claude/parse-cv";
import {
  clearAnthropicFileId,
  DocxTextError,
  extractDocxText,
  extractPdfText,
  getCvUpload,
  getReplacedAnthropicFileIds,
  markParseFailed,
  readCvBytes,
  saveParsedProfile,
  setAnthropicFileId,
} from "@/lib/pipeline/cv";
import { PDF_MIME } from "@/lib/schemas/cv-upload";

import { inngest } from "./client";
import { permanentOrRetry } from "./errors";
import { cvUploaded, profileChanged } from "./events";

/**
 * A refusal, an over-long CV, an unreadable DOCX or a full monthly budget
 * would fail the same way on a retry, so they end the run with their message.
 */
const PERMANENT_ERRORS = [CvParseError, DocxTextError, BudgetExceededError];

/**
 * Step 1 of the pipeline: reads an uploaded CV and saves it as the profile.
 * The owner can edit the profile afterwards, but doesn't have to review it.
 */
export const parseCv = inngest.createFunction(
  {
    id: "parse-cv",
    name: "Read CV",
    triggers: [cvUploaded],
    retries: 2,
    onFailure: async ({ event, error }) => {
      await markParseFailed(
        event.data.event.data.fileId,
        error.message.slice(0, 500),
      );
    },
  },
  async ({ event, step }) => {
    const { fileId } = event.data;

    // A PDF goes to the Files API once, so a retried read doesn't upload it
    // again. On a command-line agent a PDF with text is read as its text,
    // there and on the API, so it isn't uploaded at all.
    const anthropicFileId = await step.run("upload-to-files-api", async () => {
      const upload = await requireUpload(fileId);
      if (upload.mime !== PDF_MIME) return null;
      if (upload.anthropicFileId) return upload.anthropicFileId;
      if (await pdfTextOnCli(upload)) return null;
      try {
        const id = await uploadCvFile(
          await readCvBytes(upload),
          upload.originalName ?? "cv.pdf",
        );
        await setAnthropicFileId(fileId, id);
        return id;
      } catch (error) {
        throw permanentOrRetry(error, PERMANENT_ERRORS);
      }
    });

    // The profile is saved inside the step, so the CV's contents never end
    // up in Inngest's step history.
    const summary = await step.run("read-cv", async () => {
      try {
        const source = await cvSource(fileId, anthropicFileId);
        const { profile, costUsd } = await readCv(source);
        await saveParsedProfile(fileId, profile);
        return {
          roles: profile.experience.length,
          projects: profile.projects.length,
          skills: profile.skills.length,
          costUsd,
        };
      } catch (error) {
        throw permanentOrRetry(error, PERMANENT_ERRORS);
      }
    });

    // A new CV is a new profile: the roles found so far are scored again.
    await step.sendEvent(
      "profile-changed",
      profileChanged.create({ source: "cv" }),
    );

    await step.run("delete-replaced-cv-files", async () => {
      // Without the key the files can't be reached; they stay listed.
      if (!(await hasClaudeApiKey())) return;
      for (const id of await getReplacedAnthropicFileIds(fileId)) {
        await deleteCvFile(id);
        await clearAnthropicFileId(id);
      }
    });

    return summary;
  },
);

type CvUpload = Awaited<ReturnType<typeof requireUpload>>;

/** A PDF's text, when the CV is read on a command-line agent. */
async function pdfTextOnCli(upload: CvUpload): Promise<string | null> {
  const { engine } = await getStageSetup("parse_cv");
  return engine ? extractPdfText(await readCvBytes(upload)) : null;
}

/**
 * A PDF is read from the Files API; a DOCX is turned into text first. On a
 * command-line agent, which can't read a PDF, the PDF's text is read: alone
 * when it wasn't uploaded, or with the uploaded file for the API.
 */
async function cvSource(
  fileId: string,
  anthropicFileId: string | null,
): Promise<CvSource> {
  const upload = await requireUpload(fileId);
  if (anthropicFileId) {
    const text = await pdfTextOnCli(upload);
    return text
      ? { kind: "pdf", anthropicFileId, text }
      : { kind: "pdf", anthropicFileId };
  }
  const bytes = await readCvBytes(upload);
  if (upload.mime === PDF_MIME) {
    const text = await extractPdfText(bytes);
    if (!text) {
      throw new CvParseError(
        "The PDF has no text to read. Upload it again, or as a DOCX.",
      );
    }
    return { kind: "text", text };
  }
  return { kind: "text", text: await extractDocxText(bytes) };
}

async function requireUpload(fileId: string) {
  const upload = await getCvUpload(fileId);
  if (!upload) throw new NonRetriableError(`No CV upload with id ${fileId}.`);
  return upload;
}
