import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Play, Square, Activity, ArrowRight, ShieldAlert, CheckCircle2, XCircle, Clock, Plus, Wifi } from "lucide-react";
import {
  useListWallets,
  useGetMonitorSummary,
  useGetTransferStats,
  useStartWalletMonitor,
  useStopWalletMonitor,
  getListWalletsQueryKey,
  getGetMonitorSummaryQueryKey,
  getGetTransferStatsQueryKey,
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

  const { data: wallets, isLoading: walletsLoading } = useListWallets({
    query: { queryKey: getListWalletsQueryKey(), refetchInterval: 5000 },
  });

  const { data: summary, isLoading: summaryLoading } = useGetMonitorSummary({
    query: { queryKey: getGetMonitorSummaryQueryKey(), refetchInterval: 5000 },
  });

  const { data: stats, isLoading: statsLoading } = useGetTransferStats({
    query: { queryKey: getGetTransferStatsQueryKey(), refetchInterval: 5000 },
  });

  const startMonitor = useStartWalletMonitor({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMonitorSummaryQueryKey() });
      },
    },
  });

  const stopMonitor = useStopWalletMonitor({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMonitorSummaryQueryKey() });
      },
    },
  });

  if (walletsLoading || summaryLoading || statsLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const walletList = wallets ?? [];
  const hasWallets = walletList.length > 0;

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Operations</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {summary?.runningWallets ?? 0} of {summary?.totalWallets ?? 0} wallets active
          </p>
        </div>
        <Link href="/wallets/new">
          <Button className="font-bold bg-primary hover:bg-primary/90 text-primary-foreground">
            <Plus className="w-4 h-4 mr-2" />
            Add Wallet
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider font-semibold">Active Monitors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-primary">
              {summary?.runningWallets ?? 0}
              <span className="text-lg text-muted-foreground">/{summary?.totalWallets ?? 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider font-semibold">Total Forwarded</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-primary">
              {stats?.totalPiForwarded || "0"}
              <span className="text-lg text-muted-foreground"> π</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider font-semibold">Success Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-green-500">
              {stats?.totalTransactions ? Math.round(((stats.successCount ?? 0) / stats.totalTransactions) * 100) : 0}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats?.successCount ?? 0} ok / {stats?.failedCount ?? 0} failed
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider font-semibold">Transactions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-foreground">
              {stats?.totalTransactions ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats?.pendingCount ?? 0} pending
            </div>
          </CardContent>
        </Card>
      </div>

      {!hasWallets ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Wifi className="w-16 h-16 text-primary/30 mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Wallets Configured</h2>
            <p className="text-muted-foreground text-sm max-w-sm mb-6">
              Add your first Pi wallet to start monitoring for incoming funds and automatically forwarding them to safety.
            </p>
            <Link href="/wallets/new">
              <Button className="font-bold bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                Add First Wallet
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Monitored Wallets</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {walletList.map((wallet) => (
              <Card key={wallet.id} className={`transition-colors ${wallet.monitorRunning ? "border-primary/30 bg-primary/5" : "border-border"}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${wallet.monitorRunning ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`} />
                      <CardTitle className="text-base truncate">{wallet.label}</CardTitle>
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-[10px] font-mono uppercase ${wallet.monitorRunning ? "text-primary border-primary/50" : "text-muted-foreground"}`}>
                      {wallet.monitorRunning ? "ACTIVE" : "STANDBY"}
                    </Badge>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {wallet.sourceAddress || "No source address"}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">Forwarded</div>
                      <div className="font-mono font-bold text-primary">
                        {wallet.totalForwarded ? parseFloat(wallet.totalForwarded).toFixed(4) : "0"} π
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">Transfers</div>
                      <div className="font-mono font-bold">{wallet.transferCount ?? 0}</div>
                    </div>
                  </div>
                  {wallet.lastError && (
                    <div className="text-xs text-destructive truncate" title={wallet.lastError}>
                      {wallet.lastError}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {wallet.isConfigured ? (
                      wallet.monitorRunning ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="font-bold"
                          disabled={stopMonitor.isPending}
                          onClick={() => stopMonitor.mutate({ id: wallet.id })}
                        >
                          <Square className="w-3.5 h-3.5 mr-1.5" />
                          Stop
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="font-bold bg-green-600 hover:bg-green-700 text-white"
                          disabled={startMonitor.isPending}
                          onClick={() => startMonitor.mutate({ id: wallet.id })}
                        >
                          <Play className="w-3.5 h-3.5 mr-1.5" />
                          Start
                        </Button>
                      )
                    ) : (
                      <span className="text-xs text-destructive flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Incomplete config
                      </span>
                    )}
                    <Link href={`/wallets/${wallet.id}`}>
                      <Button variant="outline" size="sm" className="ml-auto">
                        Details <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {hasWallets && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest transfers across all wallets.</CardDescription>
            </div>
            <Link href="/transfers" className="text-sm text-primary hover:underline font-medium flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </CardHeader>
          <CardContent>
            {!stats?.recentTransfers?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No transfers detected yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stats.recentTransfers.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0">
                        {tx.status === "forwarded" && <CheckCircle2 className="w-6 h-6 text-green-500" />}
                        {tx.status === "failed" && <XCircle className="w-6 h-6 text-destructive" />}
                        {tx.status === "pending" && <Clock className="w-6 h-6 text-yellow-500" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-sm">{tx.amount} π</span>
                          {tx.walletLabel && (
                            <span className="text-xs text-muted-foreground font-medium">{tx.walletLabel}</span>
                          )}
                          <Badge variant="outline" className={`text-[10px] ${
                            tx.status === "forwarded" ? "text-green-500 border-green-500/30" :
                            tx.status === "failed" ? "text-destructive border-destructive/30" :
                            "text-yellow-500 border-yellow-500/30"
                          }`}>
                            {tx.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {truncateHash(tx.incomingTxHash)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        {format(new Date(tx.createdAt), "MMM d, HH:mm")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
