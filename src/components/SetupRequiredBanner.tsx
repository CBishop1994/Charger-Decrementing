import { Database, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isSetupRequiredError } from "@/lib/api";

type Props = {
  error: unknown;
  onRetry?: () => void;
};

/**
 * Shown when Supabase is linked but tables have not been pushed yet.
 * Detects the SETUP_REQUIRED / "schema cache" / "Push to Supabase" messages.
 */
export function SetupRequiredBanner({ error, onRetry }: Props) {
  if (!isSetupRequiredError(error)) return null;

  const message =
    error instanceof Error
      ? error.message
      : "Database tables are not set up yet.";

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <Database className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Database setup required
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground/90">
            <li>
              Confirm this app is pointed at the correct Supabase project
              (<code className="rounded bg-muted px-1 py-0.5 text-xs">SUPABASE_URL</code>{" "}
              +{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">SUPABASE_SERVICE_ROLE_KEY</code>
              ).
            </li>
            <li>
              Ensure inventory tables exist with full columns:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">consumables</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">bin_locations</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">stock_transactions</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">printer_settings</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">approved_emails</code>
              . Org-linked projects can use <strong>Push to Supabase</strong>; personal
              projects need the schema applied via the Database SQL editor or setup flow.
            </li>
            <li>Reload this app, sign in with Google, then use <strong>Load sample data</strong> on the dashboard.</li>
          </ol>
          {onRetry ? (
            <div className="pt-1">
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Check again
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
