import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateWallet, getListWalletsQueryKey, getGetMonitorSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  secretKey: z
    .string()
    .min(1, "Secret key is required")
    .regex(/^S[A-Z2-7]{55}$/, "Must be a valid Pi/Stellar secret key (56 characters, starts with S)"),
  destinationAddress: z
    .string()
    .min(1, "OKX deposit address is required")
    .regex(/^G[A-Z2-7]{55}$/, "Must be a valid Stellar/Pi address (56 characters, starts with G)"),
});

export default function WalletNew() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createWallet = useCreateWallet({
    mutation: {
      onSuccess: (data) => {
        const balance = data.currentBalance ? `${parseFloat(data.currentBalance).toFixed(4)} π` : "unknown";
        toast({
          title: "Monitor active",
          description: `Wallet ${data.sourceAddress?.slice(0, 8)}… deployed. Balance: ${balance}. Forwarding to your OKX address automatically.`,
        });
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMonitorSummaryQueryKey() });
        setLocation("/");
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "An error occurred. Check that your secret key is valid.";
        toast({
          variant: "destructive",
          title: "Setup failed",
          description: msg,
        });
      },
    },
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      secretKey: "",
      destinationAddress: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createWallet.mutate({ data: values });
  }

  return (
    <div className="space-y-6 max-w-xl mx-auto pb-12">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add Wallet</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Enter your secret key and OKX address — everything else is derived automatically.
          </p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Wallet Setup
          </CardTitle>
          <CardDescription>
            Your source address is derived from the secret key. Monitoring starts immediately after setup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="secretKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pi Wallet Secret Key</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="S…"
                        {...field}
                        className="font-mono bg-accent/50 tracking-widest"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </FormControl>
                    <FormDescription>
                      56-character key starting with&nbsp;<span className="font-mono text-primary">S</span>.
                      Your source wallet address is derived from this automatically.
                    </FormDescription>
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
                      <Input
                        placeholder="G…"
                        {...field}
                        className="font-mono bg-accent/50"
                        spellCheck={false}
                      />
                    </FormControl>
                    <FormDescription>
                      Your OKX Pi deposit address (starts with&nbsp;<span className="font-mono text-primary">G</span>).
                      All incoming Pi will be forwarded here immediately.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-primary" /> What happens next
                </p>
                <ul className="list-disc list-inside space-y-0.5 pl-1">
                  <li>Source address is derived from your secret key</li>
                  <li>Current balance is checked</li>
                  <li>Monitor starts — checking every 10 seconds</li>
                  <li>Any incoming Pi is forwarded to your OKX address immediately</li>
                  <li>1.02 π reserve is always kept in the source wallet</li>
                </ul>
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  type="submit"
                  disabled={createWallet.isPending}
                  className="font-bold tracking-wider"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  {createWallet.isPending ? "Setting up…" : "DEPLOY & START MONITORING"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
