import { useCallback, useState } from "react";
import { AppShell, type AppView } from "@/components/AppShell";
import { ToastStack } from "@/components/ToastStack";
import { DashboardPage } from "@/components/pages/DashboardPage";
import { ConsumablesPage } from "@/components/pages/ConsumablesPage";
import { BinsPage } from "@/components/pages/BinsPage";
import { PrintersPage } from "@/components/pages/PrintersPage";
import { HistoryPage } from "@/components/pages/HistoryPage";
import { ThemeProvider } from "@/lib/theme";
import { useToastState } from "@/hooks/use-toast";

export default function App() {
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

  return (
    <ThemeProvider>
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
      </AppShell>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ThemeProvider>
  );
}
