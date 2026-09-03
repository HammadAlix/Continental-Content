"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { assets } from "@/assets/assets";
import "./Navbar.css";

const LINKS = [
  { label: "Office", href: "/office" },
  { label: "Theatre", href: "/theatre" },
  { label: "Merch", href: "/merch" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  // Once past the opening frames the scrim earns its keep; over the very first
  // frame the bar should feel like part of the shot rather than a UI band.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`navbar${scrolled ? " is-scrolled" : ""}`}>
      <Link href="/" className="navbar-mark" aria-label="Continental Content">
        <Image
          src={assets.markGold}
          alt=""
          className="navbar-mark-img"
          priority
        />
      </Link>

      {/* Absolutely positioned so it centres on the viewport, not on whatever
          space is left between the mark and the links. */}
      <div className="navbar-wordmark">
        <Image
          src={assets.wordmarkGold}
          alt="Continental Content"
          className="navbar-wordmark-img"
          priority
        />
      </div>

      <button
        className="navbar-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Menu"
      >
        <span />
        <span />
      </button>

      <ul className={`navbar-links${open ? " is-open" : ""}`}>
        {LINKS.map((link) => {
          const current = pathname === link.href;

          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={current ? "is-current" : undefined}
                // Marks the room you're standing in for assistive tech, which
                // the underline alone doesn't convey.
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
