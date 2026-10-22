import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Roblox AI Studio", description: "Dein lokales Workspace für Roblox-Projekte und kontrollierte Agentenläufe." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="de"><body>{children}</body></html>; }
