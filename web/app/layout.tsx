import type { Metadata } from 'next';
import './style.css';

export const metadata: Metadata = { title: 'DeviceSignal', description: 'Synthetic pump investigation workspace' };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
