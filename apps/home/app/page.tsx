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
        <h1 className="text-3xl font-bold mb-2">Alexander Zlatkov</h1>
        <p className="text-text-dim text-sm mb-3">
          I'm an entrepreneur with an engineering background. I've built products, raised venture capital, scaled teams, pivoted, developed &amp; executed creative GTM strategies, and led M&amp;A processes.
        </p>
        <p className="text-text-dim text-sm mb-8">
          This is a playground for AI stuff.
        </p>

        {/* Projects */}
        <div className="mb-8">
          <h2 className="text-xs font-bold text-text-dim uppercase tracking-wider mb-3">Projects</h2>
          <a
            href={process.env.NEXT_PUBLIC_SKILLAB_URL ?? 'https://skillab.zlatkov.ai'}
            className="block border border-border rounded-lg p-4 bg-bg-secondary hover:border-accent/50 transition-colors group"
          >
            <span className="text-accent font-bold group-hover:underline">skillab</span>
            <p className="text-text-dim text-sm mt-1">
              Tools for working with AI Agent Skills (SKILL.md files)
            </p>
          </a>
        </div>

        {/* Links */}
        <div className="flex items-center justify-center gap-6 text-sm">
          <a
            href="mailto:alexander.z.zlatkov@gmail.com"
            className="text-text-dim hover:text-accent transition-colors"
          >
            Email
          </a>
          <a
            href="https://www.linkedin.com/in/zlatkov/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-dim hover:text-accent transition-colors"
          >
            LinkedIn
          </a>
          <a
            href="https://x.com/a_zlatkov"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-dim hover:text-accent transition-colors"
          >
            X
          </a>
          <a
            href="https://medium.com/@zlatkov"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-dim hover:text-accent transition-colors"
          >
            Medium
          </a>
        </div>
      </div>
    </div>
  );
}
