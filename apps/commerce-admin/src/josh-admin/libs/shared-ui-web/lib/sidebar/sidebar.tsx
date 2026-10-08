import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  AiOutlineShoppingCart,
  AiOutlinePhone,
  AiOutlineSetting,
  AiOutlineArrowRight,
  AiOutlineProduct,
  AiOutlineMoneyCollect,
  AiTwotoneCalendar,
  AiFillControl,
  AiFillSwitcher,
  AiOutlineDashboard,
  AiOutlineCustomerService,
  AiOutlineRobot,
  AiOutlineClose,
  AiOutlineSearch,
} from 'react-icons/ai';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export type SidebarMenuChild = {
  label: string;
  path: string;
};

export type SidebarMenuItem =
  | { id: string; label: string; path: string }
  | { id: string; label: string; children: SidebarMenuChild[] };

// ponytail: no real default menu — callers always pass `menu` (web-admin's ADMIN_MENU
// via toSidebarMenu). sidebar.spec.tsx renders <Sidebar /> with no menu and only
// asserts it mounts, which an empty menu still satisfies.
const DEFAULT_MENU: SidebarMenuItem[] = [];

const ALL_MENU_IDS = [
  'dashboard', 'orders', 'customers', 'catalog', 'sales', 'promotions', 'marketing',
  'storefront', 'popups', 'content', 'finance', 'support', 'notifications', 'chatbot',
  'developer', 'settings',
];

const MENU_PERMISSIONS: Record<string, string[]> = {
  platform_admin: ALL_MENU_IDS,
  super_admin: ALL_MENU_IDS,
  admin: ALL_MENU_IDS.filter((id) => !['storefront', 'popups', 'finance'].includes(id)),
  accountant: ['dashboard', 'orders', 'customers', 'finance'],
  marketing: [
    'dashboard', 'customers', 'catalog', 'storefront', 'popups',
    'promotions', 'marketing', 'content', 'support', 'notifications',
  ],
};

const MENU_ICONS: Record<string, ReactNode> = {
  dashboard: <AiOutlineDashboard size={18} />,
  orders: <AiOutlineShoppingCart size={18} />,
  customers: <AiOutlinePhone size={18} />,
  catalog: <AiOutlineProduct size={18} />,
  sales: <AiOutlineMoneyCollect size={18} />,
  promotions: <AiTwotoneCalendar size={18} />,
  marketing: <AiTwotoneCalendar size={18} />,
  storefront: <AiFillControl size={18} />,
  popups: <AiFillControl size={18} />,
  content: <AiFillControl size={18} />,
  finance: <AiFillSwitcher size={18} />,
  support: <AiOutlineCustomerService size={18} />,
  notifications: <AiOutlineCustomerService size={18} />,
  chatbot: <AiOutlineRobot size={18} />,
  developer: <AiOutlineSetting size={18} />,
  settings: <AiOutlineSetting size={18} />,
};

type SidebarProps = {
  menu?: SidebarMenuItem[];
  role?: keyof typeof MENU_PERMISSIONS;
  /** When false, sidebar is hidden (desktop) / off-canvas (mobile). Default true. */
  open?: boolean;
  onClose?: () => void;
  /** Called after navigating a leaf link — useful to auto-close on mobile. */
  onNavigate?: () => void;
  /** Show menu search field. Default true. */
  searchable?: boolean;
};

function matchesQuery(label: string, query: string) {
  return label.toLowerCase().includes(query);
}

function filterMenuItems(items: SidebarMenuItem[], query: string): SidebarMenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const filtered: SidebarMenuItem[] = [];
  for (const item of items) {
    if ('path' in item) {
      if (matchesQuery(item.label, q)) filtered.push(item);
      continue;
    }

    const parentMatch = matchesQuery(item.label, q);
    const matchingChildren = item.children.filter((child) => matchesQuery(child.label, q));

    if (parentMatch) {
      filtered.push(item);
    } else if (matchingChildren.length > 0) {
      filtered.push({ ...item, children: matchingChildren });
    }
  }
  return filtered;
}

export function Sidebar({
  menu = DEFAULT_MENU,
  role = 'platform_admin',
  open = true,
  onClose,
  onNavigate,
  searchable = true,
}: SidebarProps) {
  __useUiLocale();
  const [openSubMenus, setOpenSubMenus] = useState<Record<string, boolean>>({
    storefront: true,
    promotions: true,
  });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('');
          return;
        }
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, searchQuery]);

  const toggleSubMenu = (key: string) => {
    setOpenSubMenus((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const allowedIds = MENU_PERMISSIONS[role] || ['dashboard'];
  const menus = filterMenuItems(
    menu.filter((m) => allowedIds.includes(m.id)),
    searchQuery
  );
  const isSearching = searchQuery.trim().length > 0;

  const baseLinkStyle =
    'flex items-center justify-between px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-100 hover:text-black transition-colors duration-200 cursor-pointer w-full text-left';
  const subLinkStyle =
    'flex items-center gap-3 pl-11 pr-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50 hover:text-black transition-colors duration-200 cursor-pointer';

  const activeLinkStyle = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? 'flex items-center justify-between px-4 py-3 rounded-lg bg-primary text-white font-medium shadow-sm transition-all duration-200 w-full'
      : baseLinkStyle;

  const activeSubLinkStyle = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${subLinkStyle} bg-primary/10 text-primary font-semibold` : subLinkStyle;

  const handleNavigate = () => {
    onNavigate?.();
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 lg:hidden ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      <aside
        aria-hidden={!open}
        className={`
          fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col justify-between
          overflow-y-auto border-r border-gray-100 bg-white p-4 shadow-sm
          transition-transform duration-200 ease-out
          lg:static lg:z-auto lg:shadow-none
          ${open ? 'translate-x-0' : '-translate-x-full lg:hidden'}
        `}
      >
        <div>
          <div className="mb-4 flex items-start justify-between gap-2 border-b border-gray-100 px-2 py-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xl font-bold tracking-wider text-primary">{__uiText("JOSH ADMIN")}</span>
              <span className="w-max rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                {__uiText("Role: ")}{role.replace('_', ' ')}
              </span>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={__uiText("ปิดเมนู")}
                className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              >
                <AiOutlineClose size={18} />
              </button>
            )}
          </div>

          {searchable && (
            <div className="relative mb-3 px-1">
              <AiOutlineSearch
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={__uiText("ค้นหาเมนู...")}
                aria-label={__uiText("ค้นหาเมนู")}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-8 text-sm text-gray-800 placeholder:text-gray-400 outline-none transition-colors focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={__uiText("ล้างคำค้นหา")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700"
                >
                  <AiOutlineClose size={14} />
                </button>
              )}
            </div>
          )}

          <nav className="space-y-1">
            {menus.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-400">{__uiText("ไม่พบเมนูที่ตรงกับคำค้นหา")}</p>
            )}
            {menus.map((item) => {
              const icon = MENU_ICONS[item.id];

              if ('path' in item) {
                return (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    className={activeLinkStyle}
                    onClick={handleNavigate}
                  >
                    <div className="flex items-center gap-3">
                      {icon}
                      <span className="text-sm">{item.label}</span>
                    </div>
                  </NavLink>
                );
              }

              const isOpen = isSearching || (openSubMenus[item.id] ?? false);

              return (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => !isSearching && toggleSubMenu(item.id)}
                    className={baseLinkStyle}
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-3">
                      {icon}
                      <span className="text-sm">{item.label}</span>
                    </div>
                    <span
                      className={`transform text-xs text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                    >
                      <AiOutlineArrowRight />
                    </span>
                  </button>

                  {isOpen && (
                    <div className="ml-1 mt-1 space-y-0.5 border-l border-gray-100">
                      {item.children.map((sub) => (
                        <NavLink
                          key={sub.path}
                          to={sub.path}
                          className={activeSubLinkStyle}
                          onClick={handleNavigate}
                        >
                          {sub.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="-mx-4 flex items-center gap-3 border-t border-gray-100 bg-gray-50/50 px-4 pb-2 pt-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
            {__uiText("JD")}</div>
          <div className="overflow-hidden">
            <p className="truncate text-xs font-semibold text-gray-800">{__uiText("John Doe")}</p>
            <p className="truncate text-[10px] capitalize text-gray-400">{role.replace('_', ' ')} {__uiText(" Staff")}</p>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
