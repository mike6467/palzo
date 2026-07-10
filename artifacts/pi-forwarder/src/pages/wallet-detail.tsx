import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetWallet, 
  useUpdateWallet, 
  useDeleteWallet, 
  useStartWalletMonitor, 
  useStopWalletMonitor,
  useListTransfers,
  useGetLockedBalances,
  getListWalletsQueryKey,
  getGetMonitorSummaryQueryKey,
  getGetWalletQueryKey
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Shield, Save, Play, Square, Trash2, Activity, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { truncateHash } from "./dashboard";

const formSchema = z.object({
  label: z.string().min(1, "Label is required"),
  destinationAddress: z.string().min(1, "OKX deposit address is required").regex(/^(G[A-Z2-7]{55}|M[A-Z2-7]{68})$/, "Must be a valid Pi/Stellar address (starts with G or M)"),
  secretKey: z.string().regex(/^S[A-Z2-7]{55}$/, "Must be a valid Pi/Stellar secret key (starts with S)").optional().or(z.literal("")),
  sponsorSecretKey: z.string().regex(/^S[A-Z2-7]{55}$/, "Must be a valid Pi/Stellar secret key (starts with S)").optional().or(z.literal("")),
});

function LockedBalanceStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    monitoring: "text-yellow-500 border-yellow-500/30",
    claiming: "text-blue-400 border-blue-400/30 animate-pulse",
    claimed: "text-green-500 border-green-500/30",
    failed: "text-destructive border-destructive/30",
    expired: "text-muted-foreground border-muted-foreground/30",
  };
  return (
    <Badge variant="outline" className={styles[status] ?? ""}>
      {status}
    </Badge>
  );
}

function LockedBalanceCountdown({ unlockAt }: { unlockAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  if (!unlockAt) return <span className="text-muted-foreground">unknown</span>;
  const msLeft = new Date(unlockAt).getTime() - now;
  if (msLeft <= 0) return <span className="text-primary font-bold">unlocking now…</span>;
  const totalSeconds = Math.ceil(msLeft / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const label = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return <span className={msLeft <= 30_000 ? "text-primary font-bold" : ""}>{label}</span>;
}

export default function WalletDetail() {
  const { id } = useParams();
  const walletId = Number(id);
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: wallet, isLoading: walletLoading } = useGetWallet(walletId, {
    query: {
      queryKey: getGetWalletQueryKey(walletId),
      refetchInterval: 5000,
    }
  });

  const { data: transfersData, isLoading: transfersLoading } = useListTransfers({
    walletId,
    limit: 10,
    offset: 0
  });

  const { data: lockedBalances } = useGetLockedBalances(walletId, {
    query: { queryKey: ["locked-balances", walletId], refetchInterval: 2000 },
  });

  const updateWallet = useUpdateWallet({
    mutation: {
      onSuccess: () => {
        toast({ title: "Node updated" });
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey(walletId) });
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
      }
    }
  });

  const deleteWallet = useDeleteWallet({
    mutation: {
      onSuccess: () => {
        toast({ title: "Node decommissioned" });
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMonitorSummaryQueryKey() });
        setLocation("/");
      }
    }
  });

  const startMonitor = useStartWalletMonitor();
  const stopMonitor = useStopWalletMonitor();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      label: "",
      destinationAddress: "",
      secretKey: "",
      sponsorSecretKey: "",
    },
  });

  useEffect(() => {
    if (wallet) {
      form.reset({
        label: wallet.label,
        destinationAddress: wallet.destinationAddress || "",
        secretKey: "",
        sponsorSecretKey: "",
      });
    }
  }, [wallet, form]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateWallet.mutate({ id: walletId, data: {
      label: values.label,
      destinationAddress: values.destinationAddress,
      secretKey: values.secretKey || undefined,
      sponsorSecretKey: values.sponsorSecretKey || undefined,
    }});
  };

  const handleToggleMonitor = async () => {
    if (!wallet) return;
    try {
      if (wallet.monitorRunning) {
        await stopMonitor.mutateAsync({ id: walletId });
        toast({ title: "Monitor stopped" });
      } else {
        await startMonitor.mutateAsync({ id: walletId });
        toast({ title: "Monitor started" });
      }
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey(walletId) });
      queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMonitorSummaryQueryKey() });
    } catch (e) {
      toast({ variant: "destructive", title: "Action failed" });
    }
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this node? This cannot be undone.")) {
      deleteWallet.mutate({ id: walletId });
    }
  };

  if (walletLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!wallet) return null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{wallet.label}</h1>
              <Badge variant="outline" className={`font-mono text-[10px] uppercase px-2 py-0.5 ${wallet.monitorRunning ? 'text-primary border-primary/50 bg-primary/10 shadow-[0_0_8px_rgba(139,92,246,0.3)]' : 'text-muted-foreground'}`}>
                {wallet.monitorRunning ? 'ACTIVE' : 'STANDBY'}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm font-mono truncate max-w-[300px] sm:max-w-md">
              {wallet.sourceAddress}
            </p>
          </div>
        </div>

        <Button 
          size="lg"
          variant={wallet.monitorRunning ? "destructive" : "default"}
          onClick={handleToggleMonitor}
          disabled={startMonitor.isPending || stopMonitor.isPending || !wallet.isConfigured}
          className={`font-bold tracking-wider ${!wallet.monitorRunning && 'bg-primary hover:bg-primary/90 text-primary-foreground'}`}
        >
          {wallet.monitorRunning ? (
            <><Square className="w-5 h-5 mr-2" /> STOP</>
          ) : (
            <><Play className="w-5 h-5 mr-2" /> START</>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</div>
            <div className={`font-medium ${wallet.monitorRunning ? "text-primary" : "text-muted-foreground"}`}>
              {wallet.monitorRunning ? "Running" : "Stopped"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Forwarded</div>
            <div className="font-medium font-mono text-primary">
              {wallet.totalForwarded ? parseFloat(wallet.totalForwarded).toFixed(4) : "0"} π
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Transfers</div>
            <div className="font-medium font-mono">
              {wallet.transferCount || 0}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Last Checked</div>
            <div className="font-medium font-mono text-sm truncate">
              {wallet.lastCheckedAt ? format(new Date(wallet.lastCheckedAt), "HH:mm:ss") : "Never"}
            </div>
          </CardContent>
        </Card>
      </div>

      {lockedBalances && lockedBalances.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-5 w-5 text-primary" />
              Locked Pi — Unlock Watch
            </CardTitle>
            <CardDescription>
              Detected lockups are polled as often as every 100ms in the final seconds so the claim + forward fires
              the instant they unlock.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-accent/50">
                <TableRow>
                  <TableHead>Amount</TableHead>
                  <TableHead>Unlocks In</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Claim Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lockedBalances.map((lb) => (
                  <TableRow key={lb.id} className="font-mono text-sm">
                    <TableCell className="font-bold">{parseFloat(lb.amount).toFixed(4)} π</TableCell>
                    <TableCell>
                      {lb.status === "monitoring" ? <LockedBalanceCountdown unlockAt={lb.unlockAt ?? null} /> : "—"}
                    </TableCell>
                    <TableCell><LockedBalanceStatusBadge status={lb.status} /></TableCell>
                    <TableCell className="text-muted-foreground">
                      {lb.claimTxHash ? truncateHash(lb.claimTxHash) : lb.errorMessage ? (
                        <span className="text-destructive">{lb.errorMessage}</span>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="history" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="history">Transfer History</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
        </TabsList>
        
        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-accent/50">
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfersLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">Loading...</TableCell>
                    </TableRow>
                  ) : !transfersData?.transfers || transfersData.transfers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                        <Activity className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        No transfers recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    transfersData.transfers.map(tx => (
                      <TableRow key={tx.id} className="font-mono text-sm">
                        <TableCell className="text-muted-foreground">
                          {format(new Date(tx.createdAt), "MM-dd HH:mm")}
                        </TableCell>
                        <TableCell className="font-bold">{tx.amount} π</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            tx.status === "forwarded" ? "text-green-500 border-green-500/30" : 
                            tx.status === "failed" ? "text-destructive border-destructive/30" : 
                            "text-yellow-500 border-yellow-500/30"
                          }>
                            {tx.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {truncateHash(tx.incomingTxHash)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="mt-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Node Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Read-only derived source address */}
              <div className="mb-6 space-y-1.5">
                <p className="text-sm font-medium">Source Address <span className="text-xs text-muted-foreground font-normal ml-1">(derived from secret key)</span></p>
                <div className="flex items-center gap-2 rounded-md border border-border bg-accent/30 px-3 py-2">
                  <span className="font-mono text-sm text-muted-foreground break-all select-all">{wallet.sourceAddress || "—"}</span>
                </div>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="label"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Label</FormLabel>
                        <FormControl>
                          <Input {...field} className="font-mono bg-accent/50" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="destinationAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>OKX Deposit Address</FormLabel>
                        <FormControl>
                          <Input placeholder="G… or M…" {...field} className="font-mono bg-accent/50" spellCheck={false} />
                        </FormControl>
                        <FormDescription>All incoming Pi is forwarded here immediately.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="secretKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secret Key <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Leave blank to keep current key" {...field} className="font-mono bg-accent/50" autoComplete="off" />
                        </FormControl>
                        <FormDescription>Enter a new key to replace it. Source address will be re-derived automatically.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="sponsorSecretKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Sponsor Wallet Secret Key{" "}
                          <span className="text-muted-foreground font-normal">
                            (optional{wallet.hasSponsorKey ? " — currently set" : ""})
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Leave blank to keep current sponsor" {...field} className="font-mono bg-accent/50" autoComplete="off" />
                        </FormControl>
                        <FormDescription>
                          Pays the network fee when claiming and forwarding locked (lockup) Pi the instant it unlocks.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="pt-4 flex justify-between items-center border-t border-border mt-6">
                    <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteWallet.isPending}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Decommission Node
                    </Button>
                    <Button type="submit" disabled={updateWallet.isPending}>
                      <Save className="w-4 h-4 mr-2" />
                      Save Configuration
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}