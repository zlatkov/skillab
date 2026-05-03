export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-lg w-full text-center">
        {/* Photo */}
        <img
          src="/photo.jpg"
          alt="Alexander Zlatkov"
          className="w-28 h-28 rounded-full mx-auto mb-6 border-2 border-border"
        />

        {/* Name */}
        <h1 className="text-3xl font-bold mb-4">Alexander Zlatkov</h1>

        {/* Social icons */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <a
            href="mailto:alexander.z.zlatkov@gmail.com"
            aria-label="Email"
            className="text-text-dim hover:text-accent transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
          </a>
          <a
            href="https://www.linkedin.com/in/zlatkov/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn"
            className="text-text-dim hover:text-accent transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
              <rect x="2" y="9" width="4" height="12"/>
              <circle cx="4" cy="4" r="2"/>
            </svg>
          </a>
          <a
            href="https://medium.com/@zlatkov"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Medium"
            className="text-text-dim hover:text-accent transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13.54 12a6.8 6.8 0 0 1-6.77 6.82A6.8 6.8 0 0 1 0 12a6.8 6.8 0 0 1 6.77-6.82A6.8 6.8 0 0 1 13.54 12zm7.42 0c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z"/>
            </svg>
          </a>
          <a
            href="https://x.com/a_zlatkov"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X"
            className="text-text-dim hover:text-accent transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
        </div>

        {/* Bio */}
        <p className="text-text-dim text-sm mb-3">
          I'm an entrepreneur with an engineering background. I've built products, raised venture capital, scaled teams, pivoted, developed &amp; executed creative GTM strategies, and led M&amp;A processes.
        </p>
        {/* Projects */}
        <div className="mb-10">
          <h2 className="text-xs font-bold text-text-dim tracking-wider mb-3">This is a playground for AI stuff:</h2>
          <div className="border border-border rounded-lg overflow-hidden">
            {[
              { href: process.env.NEXT_PUBLIC_SKILLAB_URL ?? 'https://skillab.zlatkov.ai', name: 'skillab', desc: 'Tools for working with AI Agent Skills (SKILL.md files)' },
              { href: process.env.NEXT_PUBLIC_AINEWS_URL ?? 'https://ainews.zlatkov.ai', name: 'ai-news', desc: 'An Agent that shows recent AI news' },
              { href: process.env.NEXT_PUBLIC_OSSLLMS_URL ?? 'https://llms.zlatkov.ai', name: 'oss-llms', desc: 'OSS LLM pricing and availability across inference providers' },
            ].map(p => (
              <a
                key={p.name}
                href={p.href}
                className="block px-4 py-3 border-b border-border last:border-b-0 bg-bg-secondary hover:bg-bg-tertiary transition-colors group text-left"
              >
                <span className="text-accent font-bold text-sm group-hover:underline">{p.name}</span>
                <p className="text-text-dim text-xs mt-0.5">{p.desc}</p>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
