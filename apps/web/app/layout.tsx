import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Edmate',
  description: 'Learn every day with your teacher’s AI agent.',
};

// Mobile-first (task 9.1): no pinch-zoom lockout, just the standard device-width viewport so a
// 360px screen renders at its own width instead of a desktop layout scaled down.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
