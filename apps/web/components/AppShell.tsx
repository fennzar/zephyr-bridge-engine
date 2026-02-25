"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { colors } from "./theme";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/engine", label: "Engine" },
  { href: "/activity", label: "Activity" },
  { href: "/pools", label: "Pools" },
  { href: "/mexc", label: "Market" },
  { href: "/balances", label: "Inventory" },
  { href: "/arbitrage", label: "Arbitrage" },
];

const shellStyle: CSSProperties = {
  minHeight: "100vh",
};

const topBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 24px",
  borderBottom: `1px solid ${colors.border.primary}`,
  background: colors.bg.section,
  position: "sticky",
  top: 0,
  zIndex: 100,
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: colors.text.primary,
  textDecoration: "none",
};

const navStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  fontSize: 12,
};

const linkBase: CSSProperties = {
  color: colors.text.muted,
  textDecoration: "none",
  padding: "4px 0",
};

const linkActive: CSSProperties = {
  ...linkBase,
  color: colors.accent.green,
};

function normalizePath(path: string): string {
  if (path === "/") return "/";
  return path.replace(/\/+$/, "");
}

function isActive(current: string, href: string): boolean {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = normalizePath(usePathname());

  return (
    <div style={shellStyle}>
      <header style={topBarStyle}>
        <Link href="/" style={titleStyle}>
          Zephyr Bridge Engine
        </Link>
        <nav style={navStyle}>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={isActive(pathname, link.href) ? linkActive : linkBase}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

/** Reusable sub-navigation row for linking to related/hidden pages */
export function SubNav({ links }: { links: { href: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
      {links.map((link) => (
        <SubNavLink key={link.href} href={link.href} label={link.label} />
      ))}
    </div>
  );
}

function SubNavLink({ href, label }: { href: string; label: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      style={{
        color: hovered ? colors.text.primary : colors.text.dimmed,
        textDecoration: "none",
        transition: "color 0.15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label} &rarr;
    </Link>
  );
}
