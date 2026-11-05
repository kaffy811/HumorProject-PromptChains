import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Prompt Chain Tool", template: "%s · Prompt Chain Tool" },
  description: "Superadmin tool for building, ordering and running The Humor Project's caption prompt chains.",
  robots: { index: false, follow: false },
};
// Runs before first paint so a saved light/dark choice never flashes the other theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
