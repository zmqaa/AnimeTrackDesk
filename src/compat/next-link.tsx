import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

interface NextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ReactNode;
}

export default function NextLink({ href, children, ...props }: NextLinkProps) {
  const isExternal = /^(https?:)?\/\//.test(href) || href.startsWith("mailto:") || href.startsWith("tel:");

  if (isExternal) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink to={href} {...props}>
      {children}
    </RouterLink>
  );
}