"use client";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

/** Routes that render bare (no dashboard sidebar): landing + auth. */
const BARE = new Set(["/", "/login", "/signup"]);

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE.has(pathname)) return <>{children}</>;
  return (
    <div className="app-shell console">
      <Sidebar />
      <div>{children}</div>
    </div>
  );
}
