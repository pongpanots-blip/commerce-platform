import { useState, useEffect } from 'react';
import { AiOutlineMenu } from 'react-icons/ai';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function getUserFromToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;

  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window
        .atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

type NavbarProps = {
  onMenuClick?: () => void;
  /** When true, menu button shows as active (sidebar open on desktop). */
  menuOpen?: boolean;
  /** Override logout — apps served under a base path (e.g. /admin) must pass a basename-aware redirect. */
  onLogout?: () => void;
};

export function Navbar({ onMenuClick, menuOpen, onLogout }: NavbarProps) {
  __useUiLocale();
  const [user, setUser] = useState<{ fullName: string; email: string } | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    const userData = getUserFromToken();
    if (userData) {
      setUser(userData);
    }
  }, []);

  const getInitials = (name: string) => {
    if (!name) return '??';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
      return;
    }
    localStorage.removeItem('token');
    window.location.href = '/login';
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 shadow-sm sm:h-16 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label={menuOpen ? __uiText("ปิดเมนู") : __uiText("เปิดเมนู")}
            aria-expanded={menuOpen}
            className={`rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 ${
              menuOpen ? 'bg-gray-100 text-gray-900' : ''
            }`}
          >
            <AiOutlineMenu size={20} />
          </button>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className={`flex items-center gap-2 rounded-lg p-1.5 text-left transition-colors ${
            isDropdownOpen ? 'bg-gray-100' : 'hover:bg-gray-100'
          }`}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {user ? getInitials(user.fullName) : '??'}
          </div>

          <span className="hidden text-sm font-semibold text-gray-700 sm:block">
            {user ? user.fullName : __uiText("กำลังโหลด...")} ▾
          </span>
        </button>

        {isDropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />

            <div className="absolute right-0 z-20 mt-2 w-48 animate-in fade-in slide-in-from-top-2 rounded-xl border border-gray-200 bg-white py-1 shadow-xl duration-100">
              <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">
                {user ? user.email : __uiText("josh.admin@saas.com")}
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                {__uiText("ออกจากระบบ")}</button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

export default Navbar;
