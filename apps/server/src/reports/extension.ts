import { Type, type Static } from "@earendil-works/pi-ai";
import { ReportNarrativeSchema } from "@rh/shared";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { publishReport, type ReportServiceDeps } from "./service.ts";

export type ReportExtensionDeps = ReportServiceDeps;

const SYMBOL_PATTERN = "^([A-Z.]{1,10}|[A-Z]{2,10}-USD)$";
const ET_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const publishReportSchema = Type.Object({
  kind: Type.Union([Type.Literal("daily"), Type.Literal("weekly"), Type.Literal("trade")], {
    description: "daily after every trading day, weekly on the last trading day of the week, trade for every closed trade.",
  }),
  symbol: Type.Optional(
    Type.String({ pattern: SYMBOL_PATTERN, minLength: 1, maxLength: 10, description: "Trade reports only: the closed symbol." }),
  ),
  weekOf: Type.Optional(
    Type.String({
      pattern: ET_DATE_PATTERN,
      description: "Weekly reports only: the Monday (ET date) of the week covered; defaults to the current week.",
    }),
  ),
  headline: Type.String({ minLength: 1, maxLength: 140, description: "One plain sentence, the first thing the owner reads." }),
  summary: Type.String({ minLength: 1, maxLength: 1200, description: "Two to four sentences of markdown." }),
  grade: Type.Optional(
    Type.Union([Type.Literal("A"), Type.Literal("B"), Type.Literal("C"), Type.Literal("D"), Type.Literal("F")], {
      description: "Trade reports only: decision quality, judged apart from the outcome.",
    }),
  ),
  gradeReason: Type.Optional(Type.String({ maxLength: 300, description: "Why the grade, in one sentence." })),
  sections: Type.Array(
    Type.Object({
      title: Type.String({ minLength: 1, maxLength: 60 }),
      body: Type.String({ minLength: 1, maxLength: 3000 }),
    }),
    { maxItems: 6, description: 'Short titled sections, for example "What worked", "What didn\'t", "Market", "Positions".' },
  ),
  lessons: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 5 }),
  nextSteps: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 5 }),
});

type PublishReportArgs = Static<typeof publishReportSchema>;

/**
 * The agent writes the narrative; the server computes every number. Quote
 * figures only from this tool's returned facts: the result carries the
 * report id, the period, and the headline figures (pnl, benchmark, trades
 * closed, win rate).
 */
export function createReportExtension(deps: ReportExtensionDeps): Extension {
  const publish_report = defineTool({
    name: "publish_report",
    description:
      "Publish a daily, weekly, or trade report: after the close publish one trade report per trade closed today (grade the decision, not the outcome), then the daily report, plus the weekly report on the last trading day of the week. Every number is computed server-side; quote figures only from the returned facts.",
    parameters: publishReportSchema,
    async execute(args: PublishReportArgs) {
      const parsed = ReportNarrativeSchema.safeParse(args);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.join(".") || "narrative";
        return {
          output: [{ type: "text" as const, text: `Report not published: ${where} ${issue?.message ?? "is invalid"}.` }],
          isError: true,
        };
      }
      try {
        const { text } = await publishReport(deps, parsed.data);
        return { output: [{ type: "text" as const, text }] };
      } catch (error) {
        return {
          output: [{ type: "text" as const, text: `Report not published: ${error instanceof Error ? error.message : "unknown error"}.` }],
          isError: true,
        };
      }
    },
  });

  return defineExtension({ name: "reports", tools: [publish_report] });
}
