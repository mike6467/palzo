import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateWallet, getListWalletsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  label: z.string().min(1, "Label is required"),
  sourceAddress: z.string().min(1, "Source address is required"),
  destinationAddress: z.string().min(1, "Destination address is required"),
  secretKey: z.string().min(1, "Secret key is required"),
  pollIntervalSeconds: z.coerce.number().min(10, "Minimum 10 seconds").max(3600, "Maximum 3600 seconds").default(10),
});

export default function WalletNew() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const createWallet = useCreateWallet({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Node deployed",
          description: "Wallet node successfully created.",
        });
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
        setLocation("/");
      },
      onError: (err) => {
        toast({
          variant: "destructive",
          title: "Deployment failed",
          description: "An error occurred while creating the node.",
        });
      }
    }
  });

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

  function onSubmit(values: z.infer<typeof formSchema>) {
    createWallet.mutate({ data: values });
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto pb-12">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deploy Node</h1>
          <p className="text-muted-foreground mt-1 text-sm">Initialize a new wallet monitoring node.</p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Node Configuration
          </CardTitle>
          <CardDescription>
            Configure the source wallet to monitor and the destination to auto-forward to.
          </CardDescription>
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
                      <Input placeholder="e.g. Main Cold Storage, Exchange Node 1" {...field} className="font-mono bg-accent/50" />
                    </FormControl>
                    <FormDescription>Friendly name to identify this monitoring node.</FormDescription>
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
                        <Input placeholder="G..." {...field} className="font-mono bg-accent/50" />
                      </FormControl>
                      <FormDescription>The wallet to monitor for incoming Pi.</FormDescription>
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
                        <Input placeholder="G... or OKX address" {...field} className="font-mono bg-accent/50" />
                      </FormControl>
                      <FormDescription>Where to forward the received Pi.</FormDescription>
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
                    <FormLabel>Secret Key</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="S..." {...field} className="font-mono bg-accent/50" />
                    </FormControl>
                    <FormDescription>The secret key for the source wallet. Stored securely.</FormDescription>
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
                    <FormDescription>How often to check for incoming transactions (10-3600).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4 flex justify-end">
                <Button type="submit" disabled={createWallet.isPending} className="font-bold tracking-wider">
                  <Save className="w-4 h-4 mr-2" />
                  DEPLOY NODE
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}