import React from 'react';
import { logout, useSession } from 'modelence/client';

type MenuItemRenderer = (props: { 
  className: string; 
  children: React.ReactNode; 
  to: string;
}) => React.ReactElement;

type LinkRenderer = (props: { 
  href: string; 
  className: string; 
  children: React.ReactNode; 
}) => React.ReactElement;

type LogoutHandler = () => void | Promise<void>;

export interface UserMenuProps {
  renderMenuItem?: MenuItemRenderer;
  renderLink?: LinkRenderer;
  onLogout?: LogoutHandler;
  // Styling overrides
  className?: string;
  avatarClassName?: string;
  dropdownClassName?: string;
  menuItemClassName?: string;
  userInfoClassName?: string;
  logoutButtonClassName?: string;
}

export function UserMenu({
  renderMenuItem,
  renderLink,
  onLogout,
  className = "",
  avatarClassName = "",
  dropdownClassName = "",
  menuItemClassName = "",
  userInfoClassName = "",
  logoutButtonClassName = ""
}: UserMenuProps) {
  const { user } = useSession();

  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    if (onLogout) {
      await onLogout();
    } else {
      await logout();
    }
  };

  const defaultMenuItemRenderer = ({ children, to, className }: { children: React.ReactNode, to: string, className: string }) => {
    if (renderLink) {
      return renderLink({ href: to, className, children });
    }
    return <a href={to} className={className}>{children}</a>;
  };

  const MenuItemComponent = renderMenuItem || defaultMenuItemRenderer;

  return (
    <div className={`relative group ${className}`}>
      <div className={`w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center cursor-pointer ${avatarClassName}`}>
        {user.handle[0].toUpperCase()}
      </div>
      
      <div className={`absolute right-0 mt-2 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700 rounded-lg shadow w-44 z-10 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-200 ${dropdownClassName}`}>
        <div className={`px-4 py-3 text-sm text-gray-900 dark:text-white ${userInfoClassName}`}>
          <div className="font-medium">{user.handle.split('@')[0]}</div>
          <div className="truncate text-gray-500 dark:text-gray-400">{user.handle}</div>
        </div>

        <ul className="py-2 text-sm text-gray-700 dark:text-gray-200">
          <li>
            <MenuItemComponent 
              to="/profile" 
              className={`block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${menuItemClassName}`}
            >
              Profile
            </MenuItemComponent>
          </li>
          <li>
            <MenuItemComponent 
              to="/preferences" 
              className={`block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${menuItemClassName}`}
            >
              Preferences
            </MenuItemComponent>
          </li>
        </ul>

        <div className="py-1">
          <button
            onClick={handleLogout}
            className={`block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${logoutButtonClassName}`}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
} 