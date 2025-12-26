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

// Use a known devnet address or random one for simulation if you don't have a treasury wallet
const TREASURY_WALLET = "82h7Gg1i8w5y5g5v5w5x5y5z5A5b5C5d5E5f5G5h"; 

export default function Home() {
  const [, setLocation] = useLocation();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [username, setUsername] = useState("");
  const { toast } = useToast();
  
  const loginMutation = useAuth();

  const handlePlay = async () => {
    if (!connected || !publicKey) return;
    if (!username.trim()) {
      toast({ title: "Name Required", description: "Please enter a username to play", variant: "destructive" });
      return;
    }

    // 1. Authenticate / Create User
    try {
      const user = await loginMutation.mutateAsync({
        walletAddress: publicKey.toString(),
        username: username,
      });
      
      // Store locally
      sessionStorage.setItem("slither_user_id", String(user.id));
      sessionStorage.setItem("slither_username", user.username);

      // 2. Process Payment (0.1 SOL Entry Fee)
      // This logic creates a transaction on Solana Devnet
      try {
        const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(publicKey), // Self-transfer for safety if treasury invalid, or use TREASURY_WALLET
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        );
        
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        const signature = await sendTransaction(transaction, connection);
        
        toast({ 
          title: "Payment Successful", 
          description: `Transaction: ${signature.slice(0, 8)}...` 
        });

        // 3. Start Game
        setTimeout(() => setLocation("/game"), 500);

      } catch (txError) {
        console.error("Transaction failed", txError);
        toast({ 
          title: "Payment Failed", 
          description: "Could not process 0.1 SOL entry fee. Make sure you are on Devnet with funds.", 
          variant: "destructive" 
        });
        
        // FOR MVP TESTING ONLY: Allow entry even if payment fails (remove for production)
        toast({ title: "Dev Mode", description: "Entering game anyway for demo...", duration: 2000 });
        setTimeout(() => setLocation("/game"), 1000);
      }

    } catch (authError: any) {
      console.error("Login failed", authError);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      
      {/* Background Animated Elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[100px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-green-600/20 blur-[100px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
        
        {/* Left Column: Login / Actions */}
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
            
            {/* Step 1: Connect Wallet */}
            <div className={`transition-opacity duration-300 ${connected ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
              <div className="flex items-center gap-3 mb-4 text-purple-300">
                <Wallet className="w-5 h-5" />
                <span className="uppercase tracking-wider font-bold text-sm">Step 1: Connect</span>
              </div>
              <WalletMultiButton className="!w-full !justify-center" />
            </div>

            {/* Step 2: Game Details */}
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
                    <span className="uppercase tracking-wider font-bold text-sm">Step 3: Entry Fee</span>
                  </div>
                  <CyberButton 
                    onClick={handlePlay} 
                    isLoading={loginMutation.isPending}
                    className="w-full text-lg py-6"
                  >
                    Deposit 0.1 SOL & Play
                  </CyberButton>
                  <p className="text-center text-xs text-gray-500 mt-3 uppercase tracking-wider">
                    Powered by Solana Devnet
                  </p>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Right Column: Leaderboard & Stats */}
        <div className="hidden lg:block space-y-6">
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
