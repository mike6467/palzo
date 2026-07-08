import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, List, ShieldCheck, Plus } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/transfers", label: "Transfer History", icon: List },
  ];

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden font-sans">
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border shrink-0">
          <ShieldCheck className="w-6 h-6 text-primary mr-3" />
          <h1 className="font-bold tracking-tight text-lg text-primary-foreground">PiOps</h1>
        </div>
        
        <div className="px-4 py-4">
          <Link href="/wallets/new" className="flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2 rounded-md font-medium transition-colors text-sm">
            <Plus className="w-4 h-4" />
            Add Wallet
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location === item.href || (location.startsWith("/wallets") && item.href === "/");
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm ${active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <div className={`w-2 h-2 rounded-full ${health ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"}`} />
            SYSTEM {health ? "ONLINE" : "OFFLINE"}
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Mobile Header */}
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 md:hidden shrink-0">
          <div className="flex items-center">
            <ShieldCheck className="w-6 h-6 text-primary mr-3" />
            <h1 className="font-bold tracking-tight text-lg">PiOps</h1>
          </div>
          <Link href="/wallets/new" className="bg-primary p-2 rounded text-primary-foreground">
            <Plus className="w-4 h-4" />
          </Link>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto w-full">
            {children}
          </div>
        </div>
        
        {/* Mobile Nav */}
        <nav className="border-t border-border bg-card flex items-center justify-around p-2 md:hidden shrink-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-1 p-2 ${active ? "text-primary" : "text-muted-foreground"}`}>
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}