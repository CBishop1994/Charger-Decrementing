import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppShell, type AppView } from "@/components/AppShell";
import { ToastStack } from "@/components/ToastStack";
import { LoginPage } from "@/components/LoginPage";
import { DashboardPage } from "@/components/pages/DashboardPage";
import { ConsumablesPage } from "@/components/pages/ConsumablesPage";
import { BinsPage } from "@/components/pages/BinsPage";
import { PrintersPage } from "@/components/pages/PrintersPage";
import { HistoryPage } from "@/components/pages/HistoryPage";
import { AccessPage } from "@/components/pages/AccessPage";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { useAuth } from "@/lib/auth/use-auth";
import { useToastState } from "@/hooks/use-toast";

function AuthenticatedApp() {
  const { status } = useAuth();
  const [view, setView] = useState<AppView>("dashboard");
  const { toasts, toast, dismiss } = useToastState();

  const onToast = useCallback(
    (t: {
      title: string;
      description?: string;
      variant?: "default" | "success" | "destructive";
    }) => {
      toast(t);
    },
    [toast],
  );

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Checking sign-in…</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <>
        <LoginPage />
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </>
    );
  }

  return (
    <>
      <AppShell view={view} onNavigate={setView}>
        {view === "dashboard" ? (
          <DashboardPage
            onToast={onToast}
            onGoConsumables={() => setView("consumables")}
            onGoBins={() => setView("bins")}
          />
        ) : null}
        {view === "consumables" ? (
          <ConsumablesPage onToast={onToast} />
        ) : null}
        {view === "bins" ? <BinsPage onToast={onToast} /> : null}
        {view === "printers" ? <PrintersPage onToast={onToast} /> : null}
        {view === "history" ? <HistoryPage onToast={onToast} /> : null}
        {view === "access" ? <AccessPage onToast={onToast} /> : null}
      </AppShell>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </ThemeProvider>
  );
}
