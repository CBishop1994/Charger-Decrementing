import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TicketHistoryRow = {
  id?: number;
  /** Procurement day or alerts week key */
  period: string;
  status: string;
  jira_issue_key?: string | null;
  jira_issue_url?: string | null;
  dry_run?: boolean;
  line_or_item_count?: number;
  submitted_at?: string | null;
};

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Compact ticket/batch history for Alerts and Procurement panels.
 */
export function TicketHistoryList({
  rows,
  emptyLabel = "No tickets yet.",
  countSuffix = "",
  className,
}: {
  rows: TicketHistoryRow[];
  emptyLabel?: string;
  /** e.g. "lines" or "SKUs" shown after the count */
  countSuffix?: string;
  className?: string;
}) {
  if (!rows.length) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className={cn("divide-y divide-border rounded-md border border-border", className)}>
      {rows.map((row) => {
        const key = row.jira_issue_key?.trim();
        const url = row.jira_issue_url?.trim();
        const skipped = row.status === "empty_skipped";
        return (
          <li
            key={row.id ?? row.period}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <span className="font-medium tabular-nums">{row.period}</span>
            <Badge
              variant={skipped ? "secondary" : "outline"}
              className="text-[10px]"
            >
              {skipped ? "Skipped" : row.dry_run ? "Dry-run" : "Submitted"}
            </Badge>
            {row.line_or_item_count != null ? (
              <span className="text-xs text-muted-foreground">
                {row.line_or_item_count}
                {countSuffix ? ` ${countSuffix}` : ""}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              {formatWhen(row.submitted_at)}
              {url && key ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {key}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : key ? (
                <span>{key}</span>
              ) : skipped ? null : (
                <span>—</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
