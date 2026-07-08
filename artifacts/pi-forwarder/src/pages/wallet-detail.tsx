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
import { ArrowLeft, Shield, Save, Play, Square, Trash2, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { truncateHash } from "./dashboard";

const formSchema = z.object({
  label: z.string().min(1, "Label is required"),
  sourceAddress: z.string().min(1, "Source address is required"),
  destinationAddress: z.string().min(1, "Destination address is required"),
  secretKey: z.string().optional(),
  pollIntervalSeconds: z.coerce.number().min(10, "Minimum 10 seconds").max(3600, "Maximum 3600 seconds").default(10),
});

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
      sourceAddress: "",
      destinationAddress: "",
      secretKey: "",
      pollIntervalSeconds: 10,
    },
  });

  useEffect(() => {
    if (wallet) {
      form.reset({
        label: wallet.label,
        sourceAddress: wallet.sourceAddress || "",
        destinationAddress: wallet.destinationAddress || "",
        secretKey: "",
        pollIntervalSeconds: wallet.pollIntervalSeconds,
      });
    }
  }, [wallet, form]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateWallet.mutate({ id: walletId, data: {
      ...values,
      secretKey: values.secretKey ? values.secretKey : undefined
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
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="label"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Node Label</FormLabel>
                        <FormControl>
                          <Input {...field} className="font-mono bg-accent/50" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="sourceAddress"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Source Address</FormLabel>
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
                          <FormLabel>Destination Address</FormLabel>
                          <FormControl>
                            <Input {...field} className="font-mono bg-accent/50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="secretKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secret Key (Optional)</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Leave blank to keep current key" {...field} className="font-mono bg-accent/50" />
                        </FormControl>
                        <FormDescription>Only enter a new key to change it.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="pollIntervalSeconds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Poll Interval (seconds)</FormLabel>
                        <FormControl>
                          <Input type="number" min={10} max={3600} {...field} className="font-mono bg-accent/50" />
                        </FormControl>
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