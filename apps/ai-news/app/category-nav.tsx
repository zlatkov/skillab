'use client';

import { useState, useEffect, useRef } from 'react';
import { catId } from '@/lib/cat-id';

export function CategoryNav({ categories }: { categories: string[] }) {
  const [active, setActive] = useState(categories[0] ?? '');
  const lockRef = useRef(false);

  useEffect(() => {
    const ids = categories.map(catId);
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        if (lockRef.current) return;
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        for (const id of ids) {
          if (visible.has(id)) {
            setActive(id.replace(/^cat-/, ''));
            break;
          }
        }
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [categories]);

  return (
    <ul className="space-y-2 text-xs">
      {categories.map(cat => (
        <li key={cat}>
          <a
            href={`#${catId(cat)}`}
            onClick={() => {
              setActive(catId(cat).replace(/^cat-/, ''));
              lockRef.current = true;
              setTimeout(() => { lockRef.current = false; }, 1000);
            }}
            className={`transition-colors ${
              active === catId(cat).replace(/^cat-/, '')
                ? 'text-accent font-bold'
                : 'text-text-dim hover:text-accent'
            }`}
          >
            {cat}
          </a>
        </li>
      ))}
    </ul>
  );
}
