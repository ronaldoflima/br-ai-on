import type { Metadata, Viewport } from "next";
import { AppShell } from "./components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "BR.AI.ON Dashboard",
  description: "Painel de controle dos agentes AI pessoais",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
