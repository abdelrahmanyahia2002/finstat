'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import clsx from 'clsx';
import {
  BookOpen,
  Building2,
  CalendarRange,
  ClipboardCheck,
  FileSpreadsheet,
  Files,
  LayoutDashboard,
  ListTree,
  LogOut,
  Settings,
  ShieldCheck,
  Table2,
  Users,
} from 'lucide-react';

import { useSession } from '@/lib/session';
import { Spinner } from './ui';

export interface ShellNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Guards every page behind a session and paints the chrome around it. */
export function AppShell({
  children,
  nav,
  contextLabel,
  contextHref,
}: {
  children: React.ReactNode;
  nav?: ShellNavItem[];
  contextLabel?: string;
  contextHref?: string;
}) {
  const { user, loading, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) return <Spinner label="Checking your session" />;
  if (!user) return null;

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2 font-semibold text-ink-900">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-ink-800 text-sm text-white">
              F
            </span>
            <span className="text-sm">FinStat</span>
          </Link>

          {contextLabel ? (
            <>
              <span className="text-ink-300">/</span>
              <Link
                href={contextHref ?? '/'}
                className="truncate text-sm text-ink-600 hover:text-ink-900"
              >
                {contextLabel}
              </Link>
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-ink-500 sm:block">{user.email}</span>
            <button
              onClick={() => void signOut()}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/*
        The sidebar disappears below the large breakpoint, so a narrow window
        needs its own way through. This strip scrolls sideways and carries the
        same destinations.
      */}
      {nav && nav.length > 0 ? (
        <nav className="no-print border-b border-ink-200 bg-white lg:hidden">
          <ul className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-3 py-2">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={clsx(
                      'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition',
                      active
                        ? 'bg-ink-800 font-medium text-white'
                        : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-6">
        {nav && nav.length > 0 ? (
          <nav className="no-print hidden w-56 shrink-0 lg:block">
            <ul className="sticky top-20 space-y-0.5">
              {nav.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={clsx(
                        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                        active
                          ? 'bg-ink-800 font-medium text-white'
                          : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function companyNav(companyId: string): ShellNavItem[] {
  return [
    { href: `/c/${companyId}`, label: 'Overview', icon: LayoutDashboard },
    { href: `/c/${companyId}/years`, label: 'Financial years', icon: CalendarRange },
    { href: `/c/${companyId}/accounts`, label: 'Chart of accounts', icon: ListTree },
    { href: `/c/${companyId}/members`, label: 'People', icon: Users },
    { href: `/c/${companyId}/settings`, label: 'Settings', icon: Settings },
    { href: `/c/${companyId}/audit`, label: 'Audit trail', icon: ShieldCheck },
  ];
}

export function yearNav(companyId: string, yearId: string): ShellNavItem[] {
  const base = `/c/${companyId}/y/${yearId}`;
  return [
    { href: base, label: 'Overview', icon: LayoutDashboard },
    { href: `${base}/trial-balance`, label: 'Trial balance', icon: Table2 },
    { href: `${base}/debtors`, label: 'Debtors', icon: Users },
    { href: `${base}/creditors`, label: 'Creditors', icon: Building2 },
    { href: `${base}/notes`, label: 'Notes', icon: BookOpen },
    { href: `${base}/statements`, label: 'Statements', icon: FileSpreadsheet },
    { href: `${base}/validation`, label: 'Validation', icon: ClipboardCheck },
    { href: `${base}/reports`, label: 'Reports', icon: Files },
  ];
}
