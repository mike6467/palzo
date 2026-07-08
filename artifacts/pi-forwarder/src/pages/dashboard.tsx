import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Play, Square, Activity, ArrowRight, ShieldAlert, CheckCircle2, XCircle, Clock } from "lucide-react";
import {
  useGetMonitorStatus,
  useStartMonitor,
  useStopMonitor,
  useGetConfig,
  useGetTransferStats,
  getGetMonitorStatusQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export function truncateHash(hash: string | null | undefined) {
  if (!hash) return "-";
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-6)}`;
}

export default function Dashboard() {
  const queryClient = useQueryClient();

  const { data: config, isLoading: configLoading } = useGetConfig();
  
  const { data: status, isLoading: statusLoading } = useGetMonitorStatus({
    query: {
      refetchInterval: 5000,
    }
  });

  const { data: stats, isLoading: statsLoading } = useGetTransferStats({
    query: {
      refetchInterval: 5000,
    }
  });

  const startMonitor = useStartMonitor({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMonitorStatusQueryKey() })
    }
  });

  const stopMonitor = useStopMonitor({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMonitorStatusQueryKey() })
    }
  });

  if (configLoading || statusLoading || statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isConfigured = config?.isConfigured;

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Security Ops</h1>
          <p className="text-muted-foreground mt-1 text-sm">Real-time monitoring of incoming funds</p>
        </div>

        {isConfigured ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-md shadow-sm">
              <div className={`w-2.5 h-2.5 rounded-full ${status?.running ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
              <span className="text-sm font-medium uppercase tracking-wider">{status?.running ? "Active" : "Standby"}</span>
            </div>
            
            {status?.running ? (
              <Button 
                variant="destructive" 
                size="lg" 
                onClick={() => stopMonitor.mutate()}
                disabled={stopMonitor.isPending}
                className="font-bold"
              >
                <Square className="w-5 h-5 mr-2" />
                STOP MONITOR
              </Button>
            ) : (
              <Button 
                size="lg" 
                onClick={() => startMonitor.mutate()}
                disabled={startMonitor.isPending}
                className="font-bold bg-green-600 hover:bg-green-700 text-white border-green-700"
              >
                <Play className="w-5 h-5 mr-2" />
                START MONITOR
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center bg-destructive/10 border border-destructive/20 text-destructive px-4 py-2 rounded-md">
            <ShieldAlert className="w-5 h-5 mr-2" />
            <span className="text-sm font-medium">Wallet not configured</span>
          </div>
        )}
      </div>

      {!isConfigured && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              Action Required
            </CardTitle>
            <CardDescription>
              Your auto-forwarder is offline. Configure your wallet addresses and secret key to start protecting your funds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/config" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
              Configure Wallet
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider font-semibold">Total Forwarded</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-primary">{stats?.totalPiForwarded || "0"} <span className="text-lg text-muted-foreground">π</span></div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider font-semibold">Success Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-green-500">
              {stats?.totalTransactions ? Math.round((stats.successCount / stats.totalTransactions) * 100) : 0}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats?.successCount || 0} successful / {stats?.failedCount || 0} failed
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider font-semibold">Transactions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-foreground">{stats?.totalTransactions || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats?.pendingCount || 0} currently pending
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider font-semibold">Last Checked</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-mono font-bold text-foreground">
              {status?.lastCheckedAt ? format(new Date(status.lastCheckedAt), "HH:mm:ss") : "Never"}
            </div>
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {status?.lastError ? <span className="text-destructive">{status.lastError}</span> : "System nominal"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest monitored transfers and forwarding actions.</CardDescription>
          </div>
          <Link href="/transfers" className="text-sm text-primary hover:underline font-medium flex items-center gap-1">
            View All <ArrowRight className="w-4 h-4" />
          </Link>
        </CardHeader>
        <CardContent>
          {!stats?.recentTransfers?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No transfers detected yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {stats.recentTransfers.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="shrink-0">
                      {tx.status === "forwarded" && <CheckCircle2 className="w-8 h-8 text-green-500" />}
                      {tx.status === "failed" && <XCircle className="w-8 h-8 text-destructive" />}
                      {tx.status === "pending" && <Clock className="w-8 h-8 text-yellow-500" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold">{tx.amount} π</span>
                        <Badge variant="outline" className={
                          tx.status === "forwarded" ? "text-green-500 border-green-500/30" : 
                          tx.status === "failed" ? "text-destructive border-destructive/30" : 
                          "text-yellow-500 border-yellow-500/30"
                        }>
                          {tx.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 font-mono">
                        <span>From: {truncateHash(tx.fromAddress)}</span>
                        <ArrowRight className="w-3 h-3" />
                        <span>Tx: {truncateHash(tx.incomingTxHash)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium">
                      {format(new Date(tx.createdAt), "MMM d, HH:mm")}
                    </div>
                    {tx.errorMessage && (
                      <div className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={tx.errorMessage}>
                        {tx.errorMessage}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
