import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SolanaProvider } from "@/components/solana/WalletProvider";
import Home from "@/pages/Home";
import Game from "@/pages/Game";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home}/>
      <Route path="/game" component={Game}/>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </SolanaProvider>
    </QueryClientProvider>
  );
}

export default App;
