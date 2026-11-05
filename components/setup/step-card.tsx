import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** The id of the shown step's title, which takes focus when the step changes. */
export const STEP_TITLE_ID = "setup-step-title";

/**
 * One setup step: its question, what it's for, the step itself, and a
 * footer with the way on (and, on the left, any way back or around).
 */
export function StepCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="gap-5 [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>
          <h2
            id={STEP_TITLE_ID}
            tabIndex={-1}
            className="text-lg font-semibold tracking-tight outline-none"
          >
            {title}
          </h2>
        </CardTitle>
        {description ? (
          <CardDescription className="text-pretty">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {children}
      </CardContent>
      {footer ? (
        <CardFooter className="flex-wrap justify-between gap-2">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}
