import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { ShieldAlert, Save, Key } from "lucide-react";
import {
  useGetConfig,
  useUpdateConfig,
  getGetConfigQueryKey,
  getGetMonitorStatusQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect } from "react";

const configSchema = z.object({
  sourceAddress: z.string().min(1, "Source address is required"),
  destinationAddress: z.string().min(1, "Destination address is required"),
  secretKey: z.string().optional(),
  pollIntervalSeconds: z.coerce.number().min(10, "Minimum 10 seconds").max(3600, "Maximum 3600 seconds"),
});

type ConfigFormValues = z.infer<typeof configSchema>;

export default function ConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useGetConfig();
  
  const updateConfig = useUpdateConfig({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Configuration Saved",
          description: "Your wallet settings have been updated successfully.",
        });
        queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMonitorStatusQueryKey() });
        form.reset({
          ...form.getValues(),
          secretKey: "" // Clear secret key from form state after save
        });
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to update configuration.",
        });
      }
    }
  });

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      sourceAddress: "",
      destinationAddress: "",
      secretKey: "",
      pollIntervalSeconds: 15,
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        sourceAddress: config.sourceAddress || "",
        destinationAddress: config.destinationAddress || "",
        secretKey: "",
        pollIntervalSeconds: config.pollIntervalSeconds || 15,
      });
    }
  }, [config, form]);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  function onSubmit(data: ConfigFormValues) {
    // Only send secret key if it was explicitly provided
    const payload = { ...data };
    if (!payload.secretKey) {
      delete payload.secretKey;
    }
    updateConfig.mutate({ data: payload });
  }

  return (
    <div className="space-y-8 max-w-3xl pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground mt-1 text-sm">Set up your monitoring and forwarding parameters.</p>
      </div>

      <Alert className="bg-primary/10 text-primary border-primary/20">
        <Key className="h-4 w-4" />
        <AlertTitle>Security Notice</AlertTitle>
        <AlertDescription>
          Your secret key is encrypted and stored server-side. It is never returned in API responses and is only used to sign forwarding transactions.
          {config?.hasSecretKey && (
            <span className="block mt-2 font-medium">✓ A secret key is currently stored. Leave the secret key field blank to keep the existing one.</span>
          )}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Wallet Settings</CardTitle>
          <CardDescription>
            Configure the addresses the forwarder will monitor and transfer to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="sourceAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source Address (Public Key)</FormLabel>
                      <FormControl>
                        <Input placeholder="G..." className="font-mono bg-background" {...field} />
                      </FormControl>
                      <FormDescription>
                        The Pi wallet address you want to monitor for incoming funds.
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
                      <FormLabel>Destination Address (OKX or any Pi wallet)</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter OKX Pi deposit address or any Pi wallet address" className="font-mono bg-background" {...field} />
                      </FormControl>
                      <FormDescription>
                        Your OKX Pi deposit address or any other Pi wallet address you want incoming Pi forwarded to. OKX addresses are fully supported.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="secretKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secret Key</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder={config?.hasSecretKey ? "••••••••••••••••••••••••" : "S..."} className="font-mono bg-background" {...field} />
                      </FormControl>
                      <FormDescription>
                        The secret key for the source address. Required to authorize transfers.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pollIntervalSeconds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Polling Interval (Seconds)</FormLabel>
                      <FormControl>
                        <Input type="number" min={10} max={3600} className="bg-background max-w-[150px]" {...field} />
                      </FormControl>
                      <FormDescription>
                        How often to check the source address for new transactions (10 - 3600).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button type="submit" disabled={updateConfig.isPending} className="w-full sm:w-auto font-bold">
                <Save className="w-4 h-4 mr-2" />
                {updateConfig.isPending ? "Saving..." : "Save Configuration"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
