import { useState } from 'react';
import { useLocation } from "wouter";
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useAuth } from '@/hooks/use-game-api';
import { CyberButton } from '@/components/ui/CyberButton';
import { CyberInput } from '@/components/ui/CyberInput';
import { Leaderboard } from '@/components/Leaderboard';
import { motion } from 'framer-motion';
import { AlertCircle, Wallet, Coins } from 'lucide-react';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export default function Home() {
  const [, setLocation] = useLocation();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [username, setUsername] = useState("");
  const [isTestMode, setIsTestMode] = useState(false);
  const { toast } = useToast();
  
  const loginMutation = useAuth();

  const handlePlay = async () => {
    if (!connected || !publicKey) return;
    if (!username.trim()) {
      toast({ title: "Name Required", description: "Please enter a username to play", variant: "destructive" });
      return;
    }

    try {
      const user = await loginMutation.mutateAsync({
        walletAddress: publicKey.toString(),
        username: username,
        isTestMode: isTestMode
      });
      
      sessionStorage.setItem("slither_user_id", String(user.id));
      sessionStorage.setItem("slither_username", user.username);
      sessionStorage.setItem("slither_wallet", publicKey.toString());
      sessionStorage.setItem("slither_is_test", isTestMode ? "true" : "false");

      if (isTestMode) {
        toast({ title: "Test Mode", description: "Entering practice arena (No SOL required)" });
        setTimeout(() => setLocation("/game"), 500);
        return;
      }

      const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey("21LyNXi8os73adkt61ppznLCMFK2jeoPHezMNrMVZfZZ"),
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      );
      
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection);
      
      const response = await fetch('/api/auth/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, walletAddress: publicKey.toString() })
      });

      if (response.ok) {
        toast({ title: "Payment Verified", description: "Entering battle arena!" });
        setTimeout(() => setLocation("/game"), 500);
      } else {
        throw new Error("Payment verification failed");
      }

    } catch (txError: any) {
      console.error("Action failed", txError);
      toast({ 
        title: "Error", 
        description: txError.message || "Transaction failed or cancelled", 
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[100px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-green-600/20 blur-[100px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-secondary drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
              SLITHER<span className="text-white">.SOL</span>
            </h1>
            <p className="text-xl text-gray-400 font-light tracking-wide">
              The first PvP snake game on <span className="text-secondary font-bold">Solana</span>.
            </p>
          </div>

          <div className="bg-black/40 backdrop-blur-xl border border-white/10 p-8 rounded-2xl shadow-2xl space-y-6">
            <div className={`transition-opacity duration-300 ${connected ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
              <div className="flex items-center gap-3 mb-4 text-purple-300">
                <Wallet className="w-5 h-5" />
                <span className="uppercase tracking-wider font-bold text-sm">Step 1: Connect</span>
              </div>
              <WalletMultiButton className="!w-full !justify-center" />
            </div>

            {connected && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-6 pt-4 border-t border-white/10"
              >
                <div>
                  <div className="flex items-center gap-3 mb-4 text-green-300">
                    <AlertCircle className="w-5 h-5" />
                    <span className="uppercase tracking-wider font-bold text-sm">Step 2: Identity</span>
                  </div>
                  <CyberInput 
                    placeholder="Enter your snake name..." 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    maxLength={12}
                    className="text-lg"
                  />
                </div>

                <div className="pt-2">
                   <div className="flex items-center gap-3 mb-4 text-yellow-300">
                    <Coins className="w-5 h-5" />
                    <span className="uppercase tracking-wider font-bold text-sm">Step 3: Mode</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <CyberButton 
                      variant={!isTestMode ? "default" : "secondary"}
                      onClick={() => setIsTestMode(false)}
                      className="text-sm"
                    >
                      PVP (0.1 SOL)
                    </CyberButton>
                    <CyberButton 
                      variant={isTestMode ? "default" : "secondary"}
                      onClick={() => setIsTestMode(true)}
                      className="text-sm"
                    >
                      Test Mode
                    </CyberButton>
                  </div>

                  <CyberButton 
                    onClick={handlePlay} 
                    isLoading={loginMutation.isPending}
                    className="w-full text-lg py-6"
                  >
                    {isTestMode ? "Enter Training" : "Deposit & Battle"}
                  </CyberButton>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>

        <div className="hidden lg:block space-y-6">
            <div className="bg-gradient-to-br from-purple-900/40 to-blue-900/40 border border-white/10 p-6 rounded-xl backdrop-blur-md">
              <h3 className="text-lg font-bold text-white mb-2">My Balances</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400 uppercase tracking-wider font-bold">Real Solana</span>
                  <div className="text-3xl font-mono text-secondary font-bold text-glow">
                    {loginMutation.data ? (Number(loginMutation.data.solBalance || 0) / 1_000_000_000).toFixed(4) : "0.0000"} SOL
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-white/5 pt-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-gray-400 uppercase tracking-wider font-bold">Fake Balance</span>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-7 text-[10px] uppercase font-bold"
                      onClick={async () => {
                        const walletAddress = loginMutation.data?.walletAddress;
                        if (walletAddress) {
                          await fetch("/api/users/add-fake-sol", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ walletAddress, amount: 10 * 1_000_000_000 })
                          });
                          loginMutation.reset(); // Refresh data
                        }
                      }}
                    >
                      + 10 FAKE SOL
                    </Button>
                  </div>
                  <div className="text-3xl font-mono text-primary font-bold text-glow">
                    {loginMutation.data ? (Number(loginMutation.data.testSolBalance || 0) / 1_000_000_000).toFixed(2) : "0.00"} FAKE
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-4 uppercase tracking-widest text-center">
                Available for Play or Cash Out
              </div>
            </div>
            
            <Leaderboard />
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gradient-to-br from-purple-900/40 to-blue-900/40 border border-white/10 p-6 rounded-xl backdrop-blur-md"
          >
            <h3 className="text-lg font-bold text-white mb-2">Current Prize Pool</h3>
            <div className="text-4xl font-mono text-secondary font-bold text-glow">
              420.69 SOL
            </div>
            <div className="text-sm text-gray-400 mt-1">Live on Mainnet Beta (Soon)</div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
