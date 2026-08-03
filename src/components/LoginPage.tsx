import { useState } from "react";
import { Boxes, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth/use-auth";
import { BlurFade } from "@/components/ui/blur-fade";
import { DotPattern } from "@/components/ui/dot-pattern";
import { cn } from "@/lib/utils";

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.9 2.4 2.7 6.6 2.7 11.7S6.9 21 12 21c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.5H12z"
      />
      <path
        fill="#34A853"
        d="M3.9 7.5 7.1 9.9C8 7.8 9.8 6.4 12 6.4c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 8.5 2.4 5.4 4.4 3.9 7.5z"
      />
      <path
        fill="#4A90E2"
        d="M12 21c2.5 0 4.6-.8 6.1-2.2l-3-2.4c-.8.6-1.9 1-3.1 1-2.4 0-4.4-1.6-5.1-3.8l-3.2 2.5C5.3 18.7 8.4 21 12 21z"
      />
      <path
        fill="#FBBC05"
        d="M21.1 11.7c0-.6-.1-1.1-.2-1.5H12v3.9h5.5c-.3 1.3-1.1 2.3-2.2 3l3 2.4c1.8-1.6 2.8-4 2.8-7.8z"
      />
    </svg>
  );
}

export function LoginPage() {
  const { signIn, status } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      await signIn("google");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sign-in failed. Try again.";
      // Surface allowlist denials cleanly
      if (/not_approved|not on the approved/i.test(message)) {
        setError(
          "That Google account is not approved for StockTag. Ask an admin to add your email.",
        );
      } else if (/popup|blocked/i.test(message)) {
        setError(
          "The sign-in popup was blocked. Allow popups for this site and try again.",
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <DotPattern
        className={cn(
          "absolute inset-0 text-foreground/10 [mask-image:radial-gradient(500px_circle_at_center,white,transparent)]",
        )}
      />
      <BlurFade delay={0.05} className="relative z-10 w-full max-w-md">
        <Card className="border-border/80 shadow-lg">
          <CardContent className="space-y-6 p-8">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                <Boxes className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Sign in to StockTag
              </h1>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Team access is limited to approved Gmail accounts. Sign in with
                Google to continue.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-foreground shadow-sm">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0 text-left">
                  <p className="text-sm font-medium">Approved emails only</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    If this is the first sign-in on a fresh database, your
                    account becomes the admin and can invite the rest of the
                    team.
                  </p>
                </div>
              </div>
            </div>

            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}

            <Button
              type="button"
              size="lg"
              className="h-11 w-full gap-2"
              disabled={busy || status === "loading"}
              onClick={handleGoogle}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GoogleGlyph className="h-4 w-4" />
              )}
              {busy ? "Opening Google…" : "Continue with Google"}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              Use the same Google account your team admin approved.
            </p>
          </CardContent>
        </Card>
      </BlurFade>
    </div>
  );
}
