import Anthropic from "@anthropic-ai/sdk";

/**
 * A recorded API response: the request id header and the body. A JSON body
 * is sent as JSON; a string body is sent as it is, for the JSONL of batch
 * results.
 */
export type RecordedResponse = {
  requestId: string;
  body: unknown;
  status?: number;
};

/**
 * A real SDK client whose `fetch` replays recorded responses in order, so
 * tests exercise the SDK's own request building and parsing without calling
 * the live API. `requests` holds the URL, method and JSON body of every
 * request sent.
 */
export function fakeAnthropic(responses: RecordedResponse[]) {
  const queue = [...responses];
  const requests: { url: string; method: string; body: unknown }[] = [];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      const next = queue.shift();
      if (!next) throw new Error("No recorded response left.");
      const raw = typeof next.body === "string";
      return new Response(
        raw ? (next.body as string) : JSON.stringify(next.body),
        {
          status: next.status ?? 200,
          headers: {
            "content-type": raw ? "application/binary" : "application/json",
            "request-id": next.requestId,
          },
        },
      );
    },
  });
  return { client, requests };
}
