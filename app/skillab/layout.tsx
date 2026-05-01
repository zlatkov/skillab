import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'skillab - Tools for AI Agent Skills',
  description: 'Tools for working with AI Agent Skills (SKILL.md files)',
};

export default function SkillabLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
