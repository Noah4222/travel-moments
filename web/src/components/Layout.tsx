import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "./ui";
import { cn } from "@/lib/cn";

export function AppLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:px-4">
          <Link to="/" className="truncate text-base font-semibold tracking-tight sm:text-lg">
            Travel Moments
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 sm:flex">
            {user && (
              <>
                <NavTab to="/admin">相册</NavTab>
                {user.role === "admin" && <NavTab to="/admin/users">用户</NavTab>}
                {user.role === "admin" && <NavTab to="/admin/settings">设置</NavTab>}
              </>
            )}
          </nav>

          <div className="hidden items-center gap-3 text-sm sm:flex">
            {user ? (
              <>
                <span className="text-zinc-500">
                  {user.username} <span className="text-zinc-400">/ {user.role}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={logout}>
                  退出
                </Button>
              </>
            ) : (
              <NavLink to="/login" className="text-zinc-600 hover:text-zinc-900">
                登录
              </NavLink>
            )}
          </div>

          {/* Mobile burger */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="菜单"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 sm:hidden dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {menuOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="border-t border-zinc-200 px-3 pb-3 pt-2 sm:hidden dark:border-zinc-800">
            <nav className="flex flex-col gap-1">
              {user && (
                <>
                  <MobileNav to="/admin" onClick={closeMenu}>
                    相册
                  </MobileNav>
                  {user.role === "admin" && (
                    <MobileNav to="/admin/users" onClick={closeMenu}>
                      用户
                    </MobileNav>
                  )}
                  {user.role === "admin" && (
                    <MobileNav to="/admin/settings" onClick={closeMenu}>
                      设置
                    </MobileNav>
                  )}
                </>
              )}
            </nav>
            <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
              {user ? (
                <>
                  <span className="text-zinc-500">
                    {user.username}
                    <span className="ml-1 text-zinc-400">/ {user.role}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      closeMenu();
                      logout();
                    }}
                  >
                    退出
                  </Button>
                </>
              ) : (
                <NavLink
                  to="/login"
                  onClick={closeMenu}
                  className="text-zinc-600 hover:text-zinc-900"
                >
                  登录
                </NavLink>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function NavTab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          "rounded-md px-3 py-1.5 text-sm font-medium",
          isActive
            ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        )
      }
    >
      {children}
    </NavLink>
  );
}

function MobileNav({
  to,
  onClick,
  children,
}: {
  to: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "rounded-md px-3 py-2 text-base font-medium",
          isActive
            ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        )
      }
    >
      {children}
    </NavLink>
  );
}
