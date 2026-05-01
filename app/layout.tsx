import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'skillab - Tools for AI Agent Skills',
  description: 'Tools for working with AI Agent Skills (SKILL.md files)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
