import { defineRelations } from "drizzle-orm";

import { authRelations } from "./auth-schema";
import * as schema from "./schema";

const appRelations = defineRelations(schema, (r) => ({
  profile: {
    cvFile: r.one.file({ from: r.profile.cvFileId, to: r.file.id }),
  },
  run: {
    jobs: r.many.job({ from: r.run.id, to: r.job.firstRunId }),
    llmCalls: r.many.llmCall({ from: r.run.id, to: r.llmCall.runId }),
  },
  job: {
    firstRun: r.one.run({ from: r.job.firstRunId, to: r.run.id }),
    documents: r.many.document({ from: r.job.id, to: r.document.jobId }),
    application: r.one.application({
      from: r.job.id,
      to: r.application.jobId,
    }),
    events: r.many.event({ from: r.job.id, to: r.event.jobId }),
    emails: r.many.jobEmail({
      from: r.job.id,
      to: r.jobEmail.jobId,
    }),
  },
  document: {
    job: r.one.job({ from: r.document.jobId, to: r.job.id }),
    snapshot: r.one.profileSnapshot({
      from: r.document.snapshotId,
      to: r.profileSnapshot.id,
    }),
    pdfFile: r.one.file({ from: r.document.pdfFileId, to: r.file.id }),
  },
  builtCv: {
    snapshot: r.one.profileSnapshot({
      from: r.builtCv.snapshotId,
      to: r.profileSnapshot.id,
    }),
    pdfFile: r.one.file({ from: r.builtCv.pdfFileId, to: r.file.id }),
  },
  application: {
    job: r.one.job({ from: r.application.jobId, to: r.job.id }),
  },
  event: {
    job: r.one.job({ from: r.event.jobId, to: r.job.id }),
  },
  jobEmail: {
    job: r.one.job({ from: r.jobEmail.jobId, to: r.job.id }),
  },
  llmCall: {
    run: r.one.run({ from: r.llmCall.runId, to: r.run.id }),
    job: r.one.job({ from: r.llmCall.jobId, to: r.job.id }),
  },
}));

export const relations = { ...appRelations, ...authRelations };
