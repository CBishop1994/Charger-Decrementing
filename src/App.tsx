import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppShell, type AppView } from "@/components/AppShell";
import { ToastStack } from "@/components/ToastStack";
import { LoginPage } from "@/components/LoginPage";
import { DashboardPage } from "@/components/pages/DashboardPage";
import { ScanPage } from "@/components/pages/ScanPage";
import { ConsumablesPage } from "@/components/pages/ConsumablesPage";
import { BinsPage } from "@/components/pages/BinsPage";
import { HistoryPage } from "@/components/pages/HistoryPage";
import { AdminPage } from "@/components/pages/AdminPage";
import { ProcurementPage } from "@/components/pages/ProcurementPage";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { useAuth } from "@/lib/auth/use-auth";
import { useToastState } from "@/hooks/use-toast";
import {
  migrateLegacyView,
  persistAdminTab,
  persistView,
  readPersistedView,
} from "@/lib/nav-persistence";

function AuthenticatedApp() {
  const { status } = useAuth();
  const [view, setView] = useState<AppView>(() => readPersistedView("dashboard"));
  const { toasts, toast, dismiss } = useToastState();

  useEffect(() => {
    if (view === "printers") {
      persistAdminTab("printers");
      setView("admin");
      return;
    }
    persistView(view);
  }, [view]);

  const navigate = useCallback((next: AppView) => {
    const migrated = migrateLegacyView(next);
    if (migrated.adminTab) persistAdminTab(migrated.adminTab);
    setView(migrated.view);
  }, []);

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
      <AppShell view={view === "printers" ? "admin" : view} onNavigate={navigate}>
        {view === "dashboard" ? (
          <DashboardPage
            onToast={onToast}
            onGoConsumables={() => navigate("consumables")}
            onGoBins={() => navigate("bins")}
          />
        ) : null}
        {view === "scan" ? <ScanPage onToast={onToast} /> : null}
        {view === "consumables" ? (
          <ConsumablesPage onToast={onToast} />
        ) : null}
        {view === "procurement" ? (
          <ProcurementPage onToast={onToast} />
        ) : null}
        {view === "bins" ? <BinsPage onToast={onToast} /> : null}
        {view === "history" ? <HistoryPage onToast={onToast} /> : null}
        {view === "admin" || view === "printers" ? (
          <AdminPage onToast={onToast} />
        ) : null}
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
