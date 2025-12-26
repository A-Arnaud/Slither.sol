import { useState, useEffect, useRef } from 'react';
import { GameEngine } from '@/components/game/GameEngine';
import { useLocation } from "wouter";
import { useUpdateScore } from '@/hooks/use-game-api';
import { CyberButton } from '@/components/ui/CyberButton';
import { motion, AnimatePresence } from 'framer-motion';
import snakeImg from "@/assets/snake.png";
import html2canvas from "html2canvas";
import type { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export default function Game() {
  const [location, setLocation] = useLocation();
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<Array<{ id: string; name: string; score: number; walletAddress?: string; mode: "test" | "pvp" }>>([]);
  const [showResult, setShowResult] = useState(false);
  const [resultData, setResultData] = useState<{
    stakeLamports: number;
    scoreLamports: number;
    deltaLamports: number;
    percent: number;
    feeLamports: number;
  } | null>(null);
  const [resultKind, setResultKind] = useState<"cashout" | "loss" | null>(null);
  const [isCashoutLoading, setIsCashoutLoading] = useState(false);
  const [cashoutProgress, setCashoutProgress] = useState(0);
  const [escHoldProgress, setEscHoldProgress] = useState(0);
  const [isHoldingEsc, setIsHoldingEsc] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const { toast } = useToast();
  const resultCardRef = useRef<HTMLDivElement | null>(null);
  const isHoldingEscRef = useRef(false);
  const cashoutTimerRef = useRef<number | null>(null);

  const playCashSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = () => ctx.close();
    } catch {
      // Ignore audio failures.
    }
  };
  
  const updateScoreMutation = useUpdateScore();
  
  // Retrieve user info from session storage (simple approach for MVP)
  const userId = sessionStorage.getItem("slither_user_id");
  const username = sessionStorage.getItem("slither_username") || "Anonymous";
  const walletAddress = sessionStorage.getItem("slither_wallet");
  const isTestMode = sessionStorage.getItem("slither_is_test") === "true";
  const isInGame = sessionStorage.getItem("slither_in_game") === "true";
  const stakeLamports = Number(sessionStorage.getItem("slither_stake") || "0");
  const formatWallet = (wallet?: string) => {
    if (!wallet || wallet.length < 8) return "--";
    return `${wallet.slice(0, 4)}...${wallet.slice(-3)}`;
  };
  const formatSol = (lamports: number) => (lamports / 1_000_000_000).toFixed(4);
  const feeRate = 0.05;
  const buildResult = (scoreLamports: number, kind: "cashout" | "loss") => {
    const feeLamports = Math.floor(stakeLamports * feeRate);
    const payoutLamports = kind === "cashout"
      ? scoreLamports + stakeLamports - feeLamports
      : scoreLamports;
    const deltaLamports = payoutLamports - stakeLamports;
    const percent = stakeLamports > 0 ? (deltaLamports / stakeLamports) * 100 : 0;
    return { stakeLamports, scoreLamports: payoutLamports, deltaLamports, percent, feeLamports };
  };
  const cashoutDurationMs = 2500;
  const cashoutResultHoldMs = 0;
  const escHoldDurationMs = 2500;
  const clearCashoutTimer = () => {
    if (cashoutTimerRef.current) {
      window.clearTimeout(cashoutTimerRef.current);
      cashoutTimerRef.current = null;
    }
  };

  const triggerCashout = async () => {
    const walletAddress = sessionStorage.getItem("slither_wallet");
    const isTestMode = sessionStorage.getItem("slither_is_test") === "true";
    if (!walletAddress || isCashoutLoading) return;
    playCashSound();
    const result = buildResult(score, "cashout");
    setResultData(result);
    setResultKind("cashout");
    setIsCashoutLoading(true);
    setCashoutProgress(0);
    clearCashoutTimer();
    cashoutTimerRef.current = window.setTimeout(async () => {
      try {
        await fetch("/api/auth/cash-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress, isTestMode, stakeLamports })
        });
      } catch {
        // Ignore cashout failures; loss logic handles retries.
      }
      setIsCashoutLoading(false);
      sessionStorage.setItem("slither_last_result", JSON.stringify({
        kind: "cashout",
        data: result,
      }));
      sessionStorage.removeItem("slither_in_game");
      setLocation("/");
    }, cashoutDurationMs + cashoutResultHoldMs);
  };

  const buildShareText = () => {
    if (!resultData) return "Just played Slither.SOL. https://slither.io";
    const deltaSol = resultData.deltaLamports / 1_000_000_000;
    if (deltaSol >= 0) {
      return `I just won ${deltaSol.toFixed(4)} SOL on Slither.SOL! https://slither.io`;
    }
    return "Just played Slither.SOL — next run will be better. https://slither.io";
  };

  const handleShare = async () => {
    if (!resultCardRef.current) return;
    setIsSharing(true);
    try {
      const shareText = buildShareText();
      const canvas = await html2canvas(resultCardRef.current, {
        backgroundColor: "#0b0f1a",
        scale: 2,
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
      if (!blob) throw new Error("Failed to export image");
      const file = new File([blob], "slither-result.png", { type: "image/png" });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "slither-result.png";
      link.click();
      URL.revokeObjectURL(url);

      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
      window.open(intentUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({
        title: "Share Failed",
        description: err?.message || "Unable to share result",
        variant: "destructive",
      });
    } finally {
      setIsSharing(false);
    }
  };

  // Redirect if no user
  useEffect(() => {
    if (!userId || !isInGame) {
      setLocation("/");
    }
  }, [userId, isInGame, setLocation]);

  useEffect(() => {
    if (!walletAddress || !username) return;
    let cancelled = false;

    const fetchUser = async () => {
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress,
            username,
            isTestMode,
            accessKey: localStorage.getItem("slither_access_key") || undefined
          })
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setUser(data);
        if ((data as any)?.joinToken) {
          sessionStorage.setItem("slither_join_token", String((data as any).joinToken));
        }
      } catch {
        // Ignore refresh errors during gameplay.
      }
    };

    fetchUser();
    const intervalId = window.setInterval(fetchUser, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [walletAddress, username, isTestMode]);

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
    const intervalId = window.setInterval(fetchPlayers, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isTestMode]);

  useEffect(() => {
    if (!isCashoutLoading) return;
    const startedAt = performance.now();
    const intervalId = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(1, elapsed / cashoutDurationMs);
      setCashoutProgress(progress);
    }, 50);
    return () => window.clearInterval(intervalId);
  }, [isCashoutLoading, cashoutDurationMs]);

  useEffect(() => {
    let startedAt = 0;
    let rafId = 0;

    const tick = (now: number) => {
      if (!isHoldingEscRef.current || isCashoutLoading || showResult) return;
      if (!startedAt) startedAt = now;
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / escHoldDurationMs);
      setEscHoldProgress(progress);
      if (progress >= 1) {
        isHoldingEscRef.current = false;
        setIsHoldingEsc(false);
        setEscHoldProgress(0);
        void triggerCashout();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isCashoutLoading || showResult) return;
      if (isHoldingEscRef.current) return;
      isHoldingEscRef.current = true;
      setIsHoldingEsc(true);
      setEscHoldProgress(0);
      startedAt = 0;
      rafId = requestAnimationFrame(tick);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      isHoldingEscRef.current = false;
      setIsHoldingEsc(false);
      setEscHoldProgress(0);
      if (rafId) cancelAnimationFrame(rafId);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [escHoldDurationMs, isCashoutLoading, showResult]);

  const handleGameOver = (finalScore: number) => {
    if (gameOver) return;
    if (isCashoutLoading || isHoldingEscRef.current) {
      clearCashoutTimer();
      setIsCashoutLoading(false);
      setCashoutProgress(0);
      isHoldingEscRef.current = false;
      setIsHoldingEsc(false);
      setEscHoldProgress(0);
    }
    if (showResult) return;
    setGameOver(true);
    setResultData(buildResult(finalScore, "loss"));
    setShowResult(true);
    setResultKind("loss");
    if (userId) {
      updateScoreMutation.mutate({ userId: parseInt(userId), score: finalScore });
    }
  };

  if(!userId) return null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900">
      
      {/* Game Layer */}
      <GameEngine 
        playerName={username}
        onScoreUpdate={setScore}
        onGameOver={handleGameOver}
        onServerReject={(message) => {
          sessionStorage.removeItem("slither_in_game");
          toast({
            title: "Unable to Join",
            description: message,
            variant: "destructive",
          });
          setLocation("/");
        }}
      />

      {/* UI Overlay */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none">
        <div className="bg-black/50 backdrop-blur px-6 py-3 rounded-full border border-primary/30 box-glow flex items-center gap-2">
          <span className="text-gray-400 font-bold">SOL</span>
          <span className="text-2xl font-mono text-primary font-bold">
            {(score / 1_000_000_000).toFixed(4)}
          </span>
          {isTestMode && (
            <span className="text-xs font-mono text-purple-400 font-bold ml-1">FAKE</span>
          )}
        </div>
        <div className="bg-black/50 backdrop-blur px-6 py-3 rounded-full border border-secondary/30 box-glow flex items-center gap-2">
          <span className="text-gray-400 font-bold">BALANCE</span>
          <span className="text-lg font-mono text-secondary font-bold">
            {user ? (Number(user.testSolBalance || 0) / 1_000_000_000).toFixed(2) : "0.00"}
          </span>
          <span className="text-xs font-mono text-purple-400 font-bold ml-1">FAKE</span>
        </div>
        <div className="bg-black/50 backdrop-blur px-4 py-3 rounded-xl border border-white/10 box-glow max-w-[260px]">
          <div className="text-xs text-gray-400 uppercase tracking-widest mb-2">Players Online</div>
          <div className="space-y-1 max-h-36 overflow-auto pr-1 text-xs">
            {onlinePlayers.length === 0 && (
              <div className="text-gray-500">No players online.</div>
            )}
            {onlinePlayers.map((player) => (
              <div key={player.id} className="flex items-center justify-between gap-2">
                <span className="text-gray-200 font-semibold truncate">{player.name}</span>
                <span className="text-[10px] text-gray-500 font-mono shrink-0">{formatWallet(player.walletAddress)}</span>
                <span className={`text-[10px] uppercase tracking-widest font-bold ${player.mode === "pvp" ? "text-emerald-300" : "text-purple-300"}`}>
                  {player.mode}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 flex items-center gap-4">
        <div className="bg-black/50 backdrop-blur px-6 py-3 rounded-full border border-secondary/30 pointer-events-none">
          <span className="text-gray-400 font-bold mr-2">PLAYER</span>
          <span className="text-lg text-white font-bold">{username}</span>
        </div>
        <div className="pointer-events-none bg-black/50 backdrop-blur px-5 py-3 rounded-2xl border border-white/10 text-sm text-gray-200 w-48">
          <div className="text-xs uppercase tracking-widest text-gray-400">Cash Out</div>
          <div className="mt-1 font-semibold">Hold ESC</div>
          <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-secondary transition-transform duration-75 ease-linear origin-left"
              style={{ transform: `scaleX(${escHoldProgress})` }}
            />
          </div>
        </div>
      </div>

      {/* Game Over Modal */}
  <AnimatePresence>
        {isCashoutLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
          >
            <div className="bg-black/70 border border-white/10 rounded-xl px-6 py-4 text-sm uppercase tracking-widest text-gray-200 w-[260px]">
              <div className="mb-3 text-center">Cashing Out...</div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-100"
                  style={{ width: `${Math.round(cashoutProgress * 100)}%` }}
                />
              </div>
            </div>
          </motion.div>
        )}
        {showResult && resultData && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div ref={resultCardRef} className={`relative w-[92%] max-w-3xl rounded-3xl border ${resultData.deltaLamports >= 0 ? "border-green-400/40" : "border-red-400/40"} bg-gradient-to-br from-black/80 via-slate-900/80 to-slate-950/90 p-8 shadow-2xl`}>
              <div className="absolute inset-0 pointer-events-none opacity-40">
                <div className={`absolute -top-10 -right-10 h-40 w-40 rounded-full blur-3xl ${resultData.deltaLamports >= 0 ? "bg-green-400/30" : "bg-red-400/30"}`} />
                <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full blur-3xl bg-purple-500/20" />
              </div>

              <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="space-y-3">
                  <div className={`text-xs uppercase tracking-[0.3em] ${resultData.deltaLamports >= 0 ? "text-green-300" : "text-red-300"}`}>
                    {resultKind === "cashout" ? "Cash Out" : "Game Over"}
                  </div>
                  <div className="text-4xl sm:text-5xl font-black text-white">
                    {resultData.deltaLamports >= 0 ? "Victory" : "Defeat"}
                  </div>
                  <div className="text-sm text-gray-300">
                    Stake {formatSol(resultData.stakeLamports)} • {resultKind === "cashout" ? "Payout" : "Score"} {formatSol(resultData.scoreLamports)}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-4">
                  {resultKind === "loss" && (
                    <img
                      src={snakeImg}
                      alt="Snake"
                      className="w-52 sm:w-60 md:w-64 h-auto -mt-4 drop-shadow-[0_0_30px_rgba(0,0,0,0.6)]"
                    />
                  )}
                  <div className={`text-5xl sm:text-6xl font-black ${resultData.deltaLamports >= 0 ? "text-green-300" : "text-red-300"}`}>
                    {resultData.percent >= 0 ? "+" : ""}{resultData.percent.toFixed(1)}%
                  </div>
                  <div className="text-lg sm:text-xl text-white">
                    {resultData.deltaLamports >= 0 ? "+" : "-"}
                    {formatSol(Math.abs(resultData.deltaLamports))} SOL
                  </div>
                </div>
              </div>

              {resultKind === "loss" && (
                <div className="mt-8 grid gap-4 md:grid-cols-2">
                  <CyberButton 
                    onClick={() => window.location.reload()}
                    className="w-full"
                  >
                    Respawn (0.1 SOL)
                  </CyberButton>
                  <CyberButton 
                    variant="secondary" 
                    onClick={() => setLocation("/")}
                    className="w-full"
                  >
                    Main Menu
                  </CyberButton>
                </div>
              )}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <CyberButton
                  variant="secondary"
                  disabled={isSharing}
                  onClick={handleShare}
                  className="px-6 py-3 text-sm"
                >
                  {isSharing ? "Preparing..." : "Share Result"}
                </CyberButton>
                {resultKind === "cashout" && (
                  <div className="text-sm text-gray-400">
                    Returning to menu...
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
