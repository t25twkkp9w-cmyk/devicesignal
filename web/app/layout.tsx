import type { Metadata } from 'next';
import './style.css';
import { APP_NAME, DESCRIPTION } from './brand';

export const metadata: Metadata = { title: APP_NAME, description: DESCRIPTION };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
