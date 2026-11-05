// The Applications page's filters, kept in its URL with nuqs.
import {
  createLoader,
  createSerializer,
  parseAsIndex,
  parseAsNumberLiteral,
  parseAsString,
  parseAsStringLiteral,
  type inferParserType,
  type LoaderInput,
} from "nuqs/server";

import type { JobStatus } from "@/lib/schemas/tracker";

/**
 * The page's filters, by whose move it is. `your_turn`: the company's latest
 * email is waiting for a reply. `waiting`: an open application where the
 * company is to answer.
 */
export const APPLICATION_STAGES = [
  "all",
  "your_turn",
  "waiting",
  "interviewing",
  "offer",
  "closed",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** Applications still going: the company may still write. */
export const OPEN_APPLICATION_STATUSES = [
  "applied",
  "interviewing",
  "offer",
] as const satisfies readonly JobStatus[];

export const CLOSED_APPLICATION_STATUSES = [
  "rejected",
  "no_response",
  "withdrawn",
] as const satisfies readonly JobStatus[];

/** "Applied in the last …" days. */
export const APPLIED_WITHIN = [7, 30, 90] as const;

export const APPLICATIONS_PAGE_SIZE = 25;

/** The longest search the page takes. */
const MAX_SEARCH = 100;

export const applicationsParsers = {
  stage: parseAsStringLiteral(APPLICATION_STAGES).withDefault("all"),
  q: parseAsString.withDefault(""),
  within: parseAsNumberLiteral(APPLIED_WITHIN),
  page: parseAsIndex.withDefault(0),
};

export type ApplicationsParams = inferParserType<typeof applicationsParsers>;

const load = createLoader(applicationsParsers);

/** Reads the page's URL, with a search cut to size. */
export function loadApplicationsParams(input: LoaderInput): ApplicationsParams {
  const params = load(input);
  return { ...params, q: params.q.trim().slice(0, MAX_SEARCH) };
}

export const serializeApplicationsParams =
  createSerializer(applicationsParsers);

export const DEFAULT_APPLICATIONS_PARAMS: ApplicationsParams =
  loadApplicationsParams({});
