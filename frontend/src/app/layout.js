import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import { ThemeProvider } from "@/lib/ThemeContext";
import { FeedbackProvider } from "@/lib/Feedback";
import { PeriodProvider } from "@/lib/PeriodContext";
import { RefreshProvider } from "@/lib/RefreshContext";
import AppShell from "@/components/AppShell";

export const metadata = {
  title: "Account Payroll",
  description: "Diamond Production & Final Payable Management System",
};

// Runs before paint, before React hydrates -- reads the saved preference (or
// falls back to the OS setting) and stamps data-theme onto <html>
// synchronously so there's no flash of the wrong theme on load.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <FeedbackProvider>
            <AuthProvider>
              <RefreshProvider>
                <PeriodProvider>
                  <AppShell>{children}</AppShell>
                </PeriodProvider>
              </RefreshProvider>
            </AuthProvider>
          </FeedbackProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
