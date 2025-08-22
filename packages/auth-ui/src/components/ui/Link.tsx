import { MouseEvent } from "react";

export type LinkRenderer = (props: {
  className: string;
  children: React.ReactNode;
  href: string;
  /**
   * @deprecated use href
   */
  to: string;
}) => React.ReactElement;

export function Link({
  linkRenderer,
  onClick,
  className = '',
  href = '#',
  children,
}: {
  linkRenderer?: LinkRenderer;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  children: React.ReactNode;
  href?: string;
}) {
  if (linkRenderer) {
    return linkRenderer({ 
      href,
      to: href,
      className, 
      children,
    });
  }
  if (onClick) {
    return (
      <a
        href={href}
        className={className}
        onClick={onClick}
      >
        {children}
      </a>
    );
  }
}
