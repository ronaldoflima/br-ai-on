import type { Metadata, Viewport } from "next";
import { Sidebar } from "./components/Sidebar";
import { ErrorBanner } from "./components/ErrorBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "HawkAI Dashboard",
  description: "Painel de controle dos agentes AI pessoais",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="app-layout">
          <Sidebar />
          <main className="app-main">
            <ErrorBanner />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
