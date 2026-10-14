/**
 * @file layout.tsx
 * @description Root HTML layout and Next.js metadata configuration for PocketClear.
 * Configures the application title, offline description, and brand favicon assets.
 */
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PocketClear — 100% Offline Personal Finance & Project Tracker',
  description:
    'Beginner-friendly, 100% offline cross-platform personal finance and project tracker powered by Tauri v2 and SQLite.',
  icons: {
    icon: [
      { url: '/favicon.jpg', type: 'image/jpeg' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    shortcut: '/favicon.jpg',
    apple: '/logo.jpg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
