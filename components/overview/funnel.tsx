import { FilterIcon } from "lucide-react";

import { FUNNEL_DAYS, type Funnel } from "@/lib/dal/overview";
import { AUTO_PICK_MIN_SCORE } from "@/lib/jobs/auto-pick";

import { FunnelBars } from "./funnel-chart";
import { Panel } from "./panel";

const STEPS: { key: keyof Funnel; label: string }[] = [
  { key: "found", label: "Found" },
  { key: "canTake", label: "You can take" },
  { key: "strong", label: `Scored ${AUTO_PICK_MIN_SCORE}+` },
  { key: "kits", label: "Kit made" },
  { key: "sent", label: "Sent" },
  { key: "replies", label: "Replied" },
  { key: "interviews", label: "Interviews" },
];

/** How far the roles found in the last 30 days got, step by step. */
export function FunnelCard({ funnel }: { funnel: Funnel }) {
  const steps = STEPS.map(({ key, label }) => ({
    key,
    label,
    value: funnel[key],
  }));
  return (
    <Panel
      title="Last 30 days"
      description={`What happened to the roles found in the last ${FUNNEL_DAYS} days`}
      icon={<FilterIcon />}
    >
      <div className="px-4 pb-4 sm:px-5">
        <FunnelBars steps={steps} />
        <div className="sr-only">
          <table>
            <caption>
              Roles found in the last {FUNNEL_DAYS} days, by how far they got
            </caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Roles</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.key}>
                  <th scope="row">{step.label}</th>
                  <td>{step.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
