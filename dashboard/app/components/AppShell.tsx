"use client";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { ErrorBanner } from "./ErrorBanner";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  if (isLogin) return <>{children}</>;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <ErrorBanner />
        {children}
      </main>
    </div>
  );
}
