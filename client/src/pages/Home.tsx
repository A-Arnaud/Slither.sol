import { useEffect, useState } from 'react';
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
import type { User } from "@shared/schema";

export default function Home() {
  const [, setLocation] = useLocation();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [username, setUsername] = useState("");
  const [isTestMode, setIsTestMode] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [accessKey, setAccessKey] = useState(() => localStorage.getItem("slither_access_key") || "");
  const [whitelistVerified, setWhitelistVerified] = useState(false);
  const [accessKeyError, setAccessKeyError] = useState("");
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRenamingBusy, setIsRenamingBusy] = useState(false);
  const [cashoutResult, setCashoutResult] = useState<{
    kind: "cashout";
    data: {
      stakeLamports: number;
      scoreLamports: number;
      deltaLamports: number;
      percent: number;
      feeLamports: number;
    };
  } | null>(null);
  const [stakeSol, setStakeSol] = useState(0.1);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [playerMax, setPlayerMax] = useState<number | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<Array<{ id: string; name: string; score: number; walletAddress?: string; mode: "test" | "pvp" }>>([]);
  const { toast } = useToast();
  
  const loginMutation = useAuth();
  const minStakeSol = 0.1;
  const maxStakeSol = 5;
  const feeRate = 0.05;
  const canWithdraw = !!user && !isTestMode && Number(user.solBalance || 0) > 0;
  const formatWallet = (wallet?: string) => {
    if (!wallet || wallet.length < 8) return "--";
    return `${wallet.slice(0, 4)}...${wallet.slice(-3)}`;
  };
  const formatSol = (lamports: number) => (lamports / 1_000_000_000).toFixed(4);
  const buildShareText = () => {
    if (!cashoutResult) return "Just played Slither.SOL. https://slither.io";
    const deltaSol = cashoutResult.data.deltaLamports / 1_000_000_000;
    if (deltaSol >= 0) {
      return `I just won ${deltaSol.toFixed(4)} SOL on Slither.SOL! https://slither.io`;
    }
    return "Just played Slither.SOL — next run will be better. https://slither.io";
  };

  const verifyAccessKey = async () => {
    if (!accessKey) {
      setAccessKeyError("Access key required.");
      return;
    }
    setIsVerifyingKey(true);
    setAccessKeyError("");
    try {
      const response = await fetch("/api/whitelist/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Invalid access key." }));
        throw new Error(error.message || "Invalid access key.");
      }
      setWhitelistVerified(true);
      sessionStorage.setItem("slither_access_key_verified", accessKey);
    } catch (err: any) {
      setWhitelistVerified(false);
      sessionStorage.removeItem("slither_access_key_verified");
      setAccessKeyError(err.message || "Invalid access key.");
    } finally {
      setIsVerifyingKey(false);
    }
  };

  const handleRename = async () => {
    if (!connected || !publicKey || !user) return;
    const nextName = username.trim();
    if (nextName.length < 2 || nextName.length > 12) {
      toast({ title: "Invalid name", description: "Username must be 2-12 characters.", variant: "destructive" });
      return;
    }
    if (nextName === user.username) {
      setIsRenaming(false);
      return;
    }
    setIsRenamingBusy(true);
    try {
      const response = await fetch("/api/users/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toString(),
          username: nextName,
        }),
      });
      if (!response.ok) throw new Error("Rename failed");
      const updated = await response.json();
      setUser(updated);
      setUsername(updated.username);
      sessionStorage.setItem("slither_username", updated.username);
      setIsRenaming(false);
      toast({ title: "Username updated", description: "Your name has been changed." });
    } catch {
      toast({ title: "Rename failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsRenamingBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchWhitelist = async () => {
      try {
        const response = await fetch("/api/whitelist/status", { cache: "no-store" });
        if (!response.ok) throw new Error("status failed");
        const data = await response.json();
        if (!cancelled) setWhitelistEnabled(Boolean(data.enabled));
      } catch {
        if (!cancelled) setWhitelistEnabled(false);
      }
    };
    fetchWhitelist();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-verify disabled to avoid repeated invalid-key spam.
  useEffect(() => {
    if (!whitelistEnabled) {
      setWhitelistVerified(true);
      return;
    }
    const storedKey = localStorage.getItem("slither_access_key") || "";
    const verifiedKey = sessionStorage.getItem("slither_access_key_verified") || "";
    if (storedKey && verifiedKey && storedKey === verifiedKey) {
      setWhitelistVerified(true);
    }
  }, [whitelistEnabled]);

  useEffect(() => {
    const raw = sessionStorage.getItem("slither_last_result");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.kind === "cashout" && parsed?.data) {
        setCashoutResult({ kind: "cashout", data: parsed.data });
      }
    } catch {
      // Ignore invalid payloads.
    } finally {
      sessionStorage.removeItem("slither_last_result");
    }
  }, []);

  useEffect(() => {
    if (user) setIsRenaming(false);
  }, [user]);

  useEffect(() => {
    if (user) return;
    const storedWallet = sessionStorage.getItem("slither_wallet");
    const storedUsername = sessionStorage.getItem("slither_username");
    if (!storedWallet || !storedUsername) return;

    const storedIsTest = sessionStorage.getItem("slither_is_test") === "true";
    setIsTestMode(storedIsTest);
    setUsername(storedUsername);
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: storedWallet,
            username: storedUsername,
            isTestMode: storedIsTest,
            accessKey: accessKey || undefined,
          }),
        });
        if (!response.ok) return;
        const hydratedUser = await response.json();
        if (!cancelled) setUser(hydratedUser);
        if (!cancelled && whitelistEnabled) setWhitelistVerified(true);
      } catch {
        // Ignore hydration errors; user can reconnect manually.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, whitelistEnabled, accessKey]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    const storedWallet = sessionStorage.getItem("slither_wallet");
    const storedUsername = sessionStorage.getItem("slither_username");
    if (storedWallet && storedUsername && storedWallet === publicKey.toString()) {
      setUsername(storedUsername);
    }
  }, [connected, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey || user) return;
    let cancelled = false;

    const fetchExisting = async () => {
      try {
        const walletAddress = publicKey.toString();
        const response = await fetch(`/api/users/by-wallet?walletAddress=${walletAddress}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data?.username) {
          setUsername(data.username);
          setUser(data);
          sessionStorage.setItem("slither_user_id", String(data.id));
          sessionStorage.setItem("slither_username", data.username);
          sessionStorage.setItem("slither_wallet", walletAddress);
        }
      } catch {
        // Ignore if user doesn't exist yet.
      }
    };

    fetchExisting();
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, user]);

  useEffect(() => {
    let cancelled = false;
    const measurePing = async () => {
      const started = performance.now();
      try {
        const response = await fetch("/api/ping", { cache: "no-store" });
        if (!response.ok) throw new Error("Ping failed");
        const elapsed = Math.round(performance.now() - started);
        if (!cancelled) setPingMs(elapsed);
      } catch {
        if (!cancelled) setPingMs(null);
      }
    };

    measurePing();
    const intervalId = window.setInterval(measurePing, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const mode = isTestMode ? "test" : "pvp";
        const response = await fetch(`/api/players/count?mode=${mode}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Count failed");
        const data = await response.json();
        if (!cancelled) {
          setPlayerCount(data.count ?? null);
          setPlayerMax(data.max ?? null);
        }
      } catch {
        if (!cancelled) {
          setPlayerCount(null);
          setPlayerMax(null);
        }
      }
    };

    fetchCount();
    const intervalId = window.setInterval(fetchCount, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isTestMode]);

  useEffect(() => {
    let cancelled = false;
    const fetchPlayers = async () => {
      try {
        const [testRes, pvpRes] = await Promise.all([
          fetch("/api/players/list?mode=test", { cache: "no-store" }),
          fetch("/api/players/list?mode=pvp", { cache: "no-store" }),
        ]);
        if (!testRes.ok || !pvpRes.ok) throw new Error("List failed");
        const [testData, pvpData] = await Promise.all([testRes.json(), pvpRes.json()]);
        const testPlayers = Array.isArray(testData.players) ? testData.players.map((p: any) => ({ ...p, mode: "test" as const })) : [];
        const pvpPlayers = Array.isArray(pvpData.players) ? pvpData.players.map((p: any) => ({ ...p, mode: "pvp" as const })) : [];
        if (!cancelled) setOnlinePlayers([...pvpPlayers, ...testPlayers]);
      } catch {
        if (!cancelled) setOnlinePlayers([]);
      }
    };

    fetchPlayers();
    const intervalId = window.setInterval(fetchPlayers, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isTestMode]);

  const handlePlay = async () => {
    if (!connected || !publicKey) return;
    if (!username.trim()) {
      toast({ title: "Name Required", description: "Please enter a username to play", variant: "destructive" });
      return;
    }
    if (whitelistEnabled && !accessKey) {
      toast({ title: "Access Key Required", description: "Enter a whitelist access key to continue.", variant: "destructive" });
      return;
    }
    if (stakeSol < minStakeSol || stakeSol > maxStakeSol) {
      toast({ title: "Invalid Stake", description: `Stake must be between ${minStakeSol} and ${maxStakeSol} SOL`, variant: "destructive" });
      return;
    }

    const stakeLamports = Math.round(stakeSol * LAMPORTS_PER_SOL);
    try {
      setAccessKeyError("");
      const user = await loginMutation.mutateAsync({
        walletAddress: publicKey.toString(),
        username: username,
        isTestMode: isTestMode,
        accessKey: accessKey || undefined
      });
      setUser(user);
      setUsername(user.username);
      if (whitelistEnabled) setWhitelistVerified(true);
      if ((user as any)?.joinToken) {
        sessionStorage.setItem("slither_join_token", String((user as any).joinToken));
      }
      
      sessionStorage.setItem("slither_user_id", String(user.id));
      sessionStorage.setItem("slither_username", user.username);
      sessionStorage.setItem("slither_wallet", publicKey.toString());
      sessionStorage.setItem("slither_is_test", isTestMode ? "true" : "false");
      sessionStorage.setItem("slither_stake", String(stakeLamports));
      sessionStorage.setItem("slither_in_game", "true");
      if (accessKey) {
        sessionStorage.setItem("slither_access_key", accessKey);
      }

      if (isTestMode) {
        if ((user.testSolBalance || 0) < stakeLamports) {
          toast({ title: "Insufficient Fake Balance", description: "Add more fake SOL before playing.", variant: "destructive" });
          return;
        }
        toast({ title: "Test Mode", description: "Entering practice arena (No SOL required)" });
        setTimeout(() => setLocation("/game"), 500);
        return;
      }

      const escrowWallet = import.meta.env.VITE_ESCROW_WALLET;
      if (!escrowWallet) {
        toast({ title: "Missing ESCROW Wallet", description: "Set VITE_ESCROW_WALLET to continue.", variant: "destructive" });
        return;
      }

      const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
      const feeLamports = Math.floor(stakeLamports * feeRate);
      const escrowLamports = stakeLamports - feeLamports;
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey("21LyNXi8os73adkt61ppznLCMFK2jeoPHezMNrMVZfZZ"),
          lamports: feeLamports,
        })
      ).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(escrowWallet),
          lamports: escrowLamports,
        })
      );
      
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection);
      
      const response = await fetch('/api/auth/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, walletAddress: publicKey.toString(), stakeLamports })
      });

      if (response.ok) {
        toast({ title: "Payment Verified", description: "Entering battle arena!" });
        setTimeout(() => setLocation("/game"), 500);
      } else {
        throw new Error("Payment verification failed");
      }

    } catch (txError: any) {
      if (whitelistEnabled && String(txError?.message || "").toLowerCase().includes("whitelist")) {
        setAccessKeyError("Invalid access key.");
        setWhitelistVerified(false);
      }
      console.error("Action failed", txError);
      toast({ 
        title: "Error", 
        description: txError.message || "Transaction failed or cancelled", 
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="min-h-[100svh] flex items-start lg:items-center justify-center px-4 py-3 lg:py-4 relative overflow-x-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[100px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-green-600/20 blur-[100px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-5 lg:gap-6 xl:gap-8 items-start relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-4 lg:pr-6 min-w-0"
        >
          <div className="space-y-2 max-w-[32rem]">
            <h1 className="text-3xl sm:text-4xl lg:text-4xl xl:text-5xl leading-[0.9] max-w-[12ch] font-black text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-secondary drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
              SLITHER<span className="text-white">.SOL</span>
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-lg text-gray-400 font-light tracking-wide">
              <span>
                The first PvP snake game on <span className="text-secondary font-bold">Solana</span>.
              </span>
              <span className="text-xs uppercase tracking-widest px-2 py-1 rounded-full border border-white/10 bg-black/30">
                {pingMs === null ? "Ping: --" : `Ping: ${pingMs} ms`}
              </span>
              <span className="text-xs uppercase tracking-widest px-2 py-1 rounded-full border border-white/10 bg-black/30">
                {playerCount === null || playerMax === null ? "Players: --" : `Players: ${playerCount}/${playerMax}`}
              </span>
            </div>
          </div>

          <div className="bg-black/40 backdrop-blur-xl border border-white/10 p-5 rounded-2xl shadow-2xl space-y-3">
            <div className={`transition-opacity duration-300 ${connected ? 'opacity-70' : 'opacity-100'}`}>
              <div className="flex items-center gap-3 mb-3 text-purple-300">
                <Wallet className="w-5 h-5" />
                <span className="uppercase tracking-wider font-bold text-sm">Step 1: Connect</span>
              </div>
              <WalletMultiButton className="!w-full !justify-center" />
            </div>

            {connected && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-3 pt-4 border-t border-white/10"
              >
                <div>
                  <div className="flex items-center gap-3 mb-3 text-green-300">
                    <AlertCircle className="w-5 h-5" />
                    <span className="uppercase tracking-wider font-bold text-sm">Step 2: Identity</span>
                  </div>
                  <CyberInput 
                    placeholder="Enter your snake name..." 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    maxLength={12}
                    className="text-base"
                    disabled={!!user && !isRenaming}
                  />
                  {user && !isRenaming && (
                    <div className="mt-2 text-xs text-gray-500">
                      Username locked to this wallet: {user.username}
                    </div>
                  )}
                  {user && (
                    <div className="mt-2 flex items-center gap-3">
                      {!isRenaming ? (
                        <CyberButton onClick={() => setIsRenaming(true)} variant="secondary" className="text-xs px-4 py-2">
                          Rename
                        </CyberButton>
                      ) : (
                        <>
                          <CyberButton onClick={handleRename} isLoading={isRenamingBusy} className="text-xs px-4 py-2">
                            Save
                          </CyberButton>
                          <CyberButton
                            onClick={() => {
                              setUsername(user.username);
                              setIsRenaming(false);
                            }}
                            variant="secondary"
                            className="text-xs px-4 py-2"
                          >
                            Cancel
                          </CyberButton>
                        </>
                      )}
                    </div>
                  )}
                  {whitelistEnabled && (
                    <div className="mt-3">
                      <div className="text-xs uppercase tracking-widest text-gray-400 mb-2">Access Key</div>
                      <CyberInput
                        placeholder="Enter access key..."
                        value={accessKey}
                        onChange={(e) => {
                          const value = e.target.value.trim();
                          setAccessKey(value);
                          localStorage.setItem("slither_access_key", value);
                          setAccessKeyError("");
                          setWhitelistVerified(false);
                          if (sessionStorage.getItem("slither_access_key_verified") !== value) {
                            sessionStorage.removeItem("slither_access_key_verified");
                          }
                        }}
                        className="text-base"
                      />
                    </div>
                  )}
                </div>

                  <div className="pt-2">
                   <div className="flex items-center gap-3 mb-3 text-yellow-300">
                    <Coins className="w-5 h-5" />
                    <span className="uppercase tracking-wider font-bold text-sm">Step 3: Mode</span>
                  </div>

                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-2 text-sm text-gray-400 uppercase tracking-wider font-bold">
                      <span>Stake (SOL)</span>
                      <span>{stakeSol.toFixed(2)} SOL</span>
                    </div>
                    <CyberInput
                      type="number"
                      min={minStakeSol}
                      max={maxStakeSol}
                      step="0.1"
                      value={stakeSol}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isNaN(next)) setStakeSol(next);
                      }}
                      onBlur={() => {
                        if (stakeSol < minStakeSol) setStakeSol(minStakeSol);
                        if (stakeSol > maxStakeSol) setStakeSol(maxStakeSol);
                      }}
                      className="text-base"
                    />
                    <div className="mt-2 text-xs text-gray-500">
                      Min {minStakeSol} SOL • Max {maxStakeSol} SOL • Fee {(feeRate * 100).toFixed(0)}%
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <CyberButton 
                      variant={!isTestMode ? "default" : "secondary"}
                      onClick={() => setIsTestMode(false)}
                      className="text-sm"
                    >
                      PVP
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
                    className="w-full text-base py-3"
                  >
                    {isTestMode ? "Enter Training" : "Deposit & Battle"}
                  </CyberButton>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>

        <div className="hidden lg:block space-y-4 min-w-0">
            <div className="bg-gradient-to-br from-purple-900/40 to-blue-900/40 border border-white/10 p-5 rounded-xl backdrop-blur-md">
              <h3 className="text-base font-bold text-white mb-2">My Balances</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400 uppercase tracking-wider font-bold">Real Solana</span>
                  <div className="text-2xl font-mono text-secondary font-bold text-glow">
                    {user ? (Number(user.solBalance || 0) / 1_000_000_000).toFixed(4) : "0.0000"} SOL
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-white/5 pt-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-gray-400 uppercase tracking-wider font-bold">Fake Balance</span>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-7 text-[10px] uppercase font-bold"
                      onClick={async () => {
                        const walletAddress = user?.walletAddress;
                        if (!walletAddress) {
                          toast({
                            title: "Connect & Play First",
                            description: "Start a session before adding fake SOL.",
                            variant: "destructive",
                          });
                          return;
                        }
                        if (walletAddress) {
                          await fetch("/api/users/add-fake-sol", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ walletAddress, amount: 10 * 1_000_000_000 })
                          });
                          // Fetch fresh user data to update the UI
                          const response = await fetch("/api/auth/login", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              walletAddress,
                              username: user.username,
                              isTestMode,
                              accessKey: accessKey || undefined,
                            })
                          });
                          if (response.ok) {
                            const updatedUser = await response.json();
                            setUser(updatedUser);
                          }
                        }
                      }}
                    >
                      + 10 FAKE SOL
                    </Button>
                  </div>
                  <div className="text-2xl font-mono text-primary font-bold text-glow">
                    {user ? (Number(user.testSolBalance || 0) / 1_000_000_000).toFixed(2) : "0.00"} FAKE
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-3 uppercase tracking-widest text-center">
                Available for Play or Cash Out
              </div>
              <div className="mt-3">
                <CyberButton
                  variant="secondary"
                  className="w-full text-[0.65rem] sm:text-xs md:text-sm py-3 leading-snug tracking-normal whitespace-normal px-3 sm:px-6 text-center"
                  disabled={!canWithdraw}
                  isLoading={isWithdrawing}
                  onClick={async () => {
                    if (!user?.walletAddress || !canWithdraw) return;
                    setIsWithdrawing(true);
                    try {
                      const response = await fetch("/api/auth/withdraw", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ walletAddress: user.walletAddress, isTestMode })
                      });
                      if (!response.ok) {
                        const error = await response.json().catch(() => ({ message: "Withdraw failed" }));
                        throw new Error(error.message || "Withdraw failed");
                      }
                      const data = await response.json();
                      setUser(data.user || null);
                      toast({ title: "Withdraw Sent", description: "Funds are on the way to your wallet." });
                    } catch (err: any) {
                      toast({ title: "Withdraw Failed", description: err.message || "Try again later", variant: "destructive" });
                    } finally {
                      setIsWithdrawing(false);
                    }
                  }}
                >
                  <span className="block">Withdraw</span>
                  <span className="block">to Wallet</span>
                </CyberButton>
                {!canWithdraw && !isTestMode && (
                  <div className="text-xs text-gray-500 mt-2 text-center">
                    Add SOL and play to unlock withdraw.
                  </div>
                )}
                {isTestMode && (
                  <div className="text-xs text-gray-500 mt-2 text-center">
                    Withdraw disabled in Test Mode.
                  </div>
                )}
              </div>
            </div>
            
          <Leaderboard />
          <div className="bg-gradient-to-br from-slate-900/60 to-slate-800/60 border border-white/10 p-5 rounded-xl backdrop-blur-md">
            <h3 className="text-base font-bold text-white mb-2">Players Online</h3>
            <div className="text-xs text-gray-500 mb-3 uppercase tracking-widest">
              {onlinePlayers.length === 0 ? "No players online." : `${onlinePlayers.length} total online`}
            </div>
            <div className="space-y-2 max-h-36 overflow-auto pr-1">
              {onlinePlayers.length === 0 && (
                <div className="text-sm text-gray-500">No players online.</div>
              )}
              {onlinePlayers.map((player) => (
                <div key={player.id} className="flex items-center justify-between text-sm bg-black/30 border border-white/5 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-200 font-semibold truncate">{player.name}</span>
                    <span className="text-[10px] text-gray-500 font-mono shrink-0">{formatWallet(player.walletAddress)}</span>
                    <span className={`text-[10px] uppercase tracking-widest font-bold ${player.mode === "pvp" ? "text-emerald-300" : "text-purple-300"}`}>
                      {player.mode}
                    </span>
                  </div>
                  <span className="text-xs text-secondary font-mono">{(player.score / 1_000_000_000).toFixed(3)} SOL</span>
                </div>
              ))}
            </div>
          </div>
          
        </div>
      </div>
      {cashoutResult && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className={`relative w-full max-w-3xl rounded-3xl border ${cashoutResult.data.deltaLamports >= 0 ? "border-green-400/40" : "border-red-400/40"} bg-gradient-to-br from-black/80 via-slate-900/80 to-slate-950/90 p-8 shadow-2xl`}>
            <div className="absolute inset-0 pointer-events-none opacity-40">
              <div className={`absolute -top-10 -right-10 h-40 w-40 rounded-full blur-3xl ${cashoutResult.data.deltaLamports >= 0 ? "bg-green-400/30" : "bg-red-400/30"}`} />
              <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full blur-3xl bg-purple-500/20" />
            </div>
            <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-3">
                <div className={`text-xs uppercase tracking-[0.3em] ${cashoutResult.data.deltaLamports >= 0 ? "text-green-300" : "text-red-300"}`}>
                  Cash Out
                </div>
                <div className="text-4xl sm:text-5xl font-black text-white">
                  {cashoutResult.data.deltaLamports >= 0 ? "Victory" : "Defeat"}
                </div>
                <div className="text-sm text-gray-300">
                  Stake {formatSol(cashoutResult.data.stakeLamports)} • Payout {formatSol(cashoutResult.data.scoreLamports)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-4">
                <div className={`text-5xl sm:text-6xl font-black ${cashoutResult.data.deltaLamports >= 0 ? "text-green-300" : "text-red-300"}`}>
                  {cashoutResult.data.percent >= 0 ? "+" : ""}{cashoutResult.data.percent.toFixed(1)}%
                </div>
                <div className="text-lg sm:text-xl text-white">
                  {cashoutResult.data.deltaLamports >= 0 ? "+" : "-"}
                  {formatSol(Math.abs(cashoutResult.data.deltaLamports))} SOL
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <CyberButton
                variant="secondary"
                onClick={() => {
                  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText())}`;
                  window.open(intentUrl, "_blank", "noopener,noreferrer");
                }}
                className="px-6 py-3 text-sm"
              >
                Share Result
              </CyberButton>
              <CyberButton
                onClick={() => setCashoutResult(null)}
                className="px-6 py-3 text-sm"
              >
                Close
              </CyberButton>
            </div>
          </div>
        </div>
      )}
      {whitelistEnabled && !whitelistVerified && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/70 p-6 shadow-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-gray-400">Access Key</div>
            <div className="mt-2 text-2xl font-black text-white">Whitelist Enabled</div>
            <div className="mt-4">
              <CyberInput
                autoFocus
                placeholder="Enter access key..."
                value={accessKey}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  setAccessKey(value);
                  localStorage.setItem("slither_access_key", value);
                  setAccessKeyError("");
                  setWhitelistVerified(false);
                }}
                className="text-lg"
              />
            </div>
            {accessKeyError ? (
              <div className="mt-4 text-xs text-red-300">{accessKeyError}</div>
            ) : (
              <div className="mt-4 text-xs text-gray-500">
                Enter your access key to continue.
              </div>
            )}
            <div className="mt-5">
              <CyberButton
                className="w-full"
                isLoading={isVerifyingKey}
                onClick={verifyAccessKey}
              >
                Verify Access Key
              </CyberButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
