import { ReactNode } from 'react';

export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white shadow-sm rounded-md p-6 relative ${className}`}>
      {children}
    </div>
  );
}
