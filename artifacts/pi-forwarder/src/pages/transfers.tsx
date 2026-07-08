import { useState } from "react";
import { useListTransfers } from "@workspace/api-client-react";
import { format } from "date-fns";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { truncateHash } from "./dashboard";

const PAGE_SIZE = 20;

export default function TransfersPage() {
  const [page, setPage] = useState(0);
  
  const { data, isLoading } = useListTransfers({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card>
          <div className="p-4 space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  const transfers = data?.transfers || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Transfer History</h1>
        <p className="text-muted-foreground mt-1 text-sm">Complete log of all intercepted and forwarded transactions.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transfer Log</CardTitle>
          <CardDescription>Showing {transfers.length} of {total} records.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-accent/50">
              <TableRow>
                <TableHead className="w-[180px]">Date/Time</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Incoming Hash</TableHead>
                <TableHead>Outgoing Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No transfers recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                transfers.map((tx) => (
                  <TableRow key={tx.id} className="hover:bg-accent/30 font-mono text-sm">
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(tx.createdAt), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell className="font-bold">
                      {tx.amount} π
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        tx.status === "forwarded" ? "text-green-500 border-green-500/30" : 
                        tx.status === "failed" ? "text-destructive border-destructive/30" : 
                        "text-yellow-500 border-yellow-500/30"
                      }>
                        {tx.status}
                      </Badge>
                      {tx.errorMessage && (
                        <div className="text-[10px] text-destructive max-w-[150px] truncate mt-1" title={tx.errorMessage}>
                          {tx.errorMessage}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={tx.fromAddress || ""}>
                      {truncateHash(tx.fromAddress)}
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={tx.incomingTxHash}>
                      {truncateHash(tx.incomingTxHash)}
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={tx.outgoingTxHash || ""}>
                      {tx.outgoingTxHash ? truncateHash(tx.outgoingTxHash) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
          <div className="p-4 border-t flex items-center justify-between bg-accent/20">
            <div className="text-sm text-muted-foreground">
              Page {page + 1} of {Math.max(1, totalPages)}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
