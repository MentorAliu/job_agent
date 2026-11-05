import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StageCost } from "@/lib/dal/spend";
import { modelName } from "@/lib/schemas/settings";

import { formatCost, LLM_STAGE_LABELS } from "./run-labels";

const number = new Intl.NumberFormat("en-US");

/** Tokens, searches and cost for each Claude step, with a total row. */
export function StageCostTable({
  stages,
  caption,
}: {
  stages: StageCost[];
  caption: string;
}) {
  const sum = (key: keyof Omit<StageCost, "stage" | "model">) =>
    stages.reduce((total, stage) => total + stage[key], 0);
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Step</TableHead>
          <TableHead scope="col">Model</TableHead>
          <TableHead scope="col" className="text-right">
            Calls
          </TableHead>
          <TableHead scope="col" className="text-right">
            Input tokens
          </TableHead>
          <TableHead scope="col" className="text-right">
            Cached input
          </TableHead>
          <TableHead scope="col" className="text-right">
            Output tokens
          </TableHead>
          <TableHead scope="col" className="text-right">
            Web searches
          </TableHead>
          <TableHead scope="col" className="text-right">
            Cost
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stages.map((stage) => (
          <TableRow key={`${stage.stage}-${stage.model}`}>
            <TableCell>{LLM_STAGE_LABELS[stage.stage].label}</TableCell>
            <TableCell className="text-muted-foreground">
              {modelName(stage.model)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(stage.calls)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(stage.inputTokens + stage.cacheWriteTokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(stage.cacheReadTokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(stage.outputTokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(stage.webSearches)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCost(stage.costUsd)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      {stages.length > 1 ? (
        <TableFooter>
          <TableRow>
            <TableHead scope="row" colSpan={2}>
              Total
            </TableHead>
            <TableCell className="text-right tabular-nums">
              {number.format(sum("calls"))}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(sum("inputTokens") + sum("cacheWriteTokens"))}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(sum("cacheReadTokens"))}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(sum("outputTokens"))}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number.format(sum("webSearches"))}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCost(sum("costUsd"))}
            </TableCell>
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
}
