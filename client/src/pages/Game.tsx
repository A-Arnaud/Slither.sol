import { useState, useEffect } from 'react';
import { GameEngine } from '@/components/game/GameEngine';
import { useLocation } from "wouter";
import { useUpdateScore } from '@/hooks/use-game-api';
import { CyberButton } from '@/components/ui/CyberButton';
import { motion, AnimatePresence } from 'framer-motion';

export default function Game() {
  const [location, setLocation] = useLocation();
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  
  const updateScoreMutation = useUpdateScore();
  
  // Retrieve user info from session storage (simple approach for MVP)
  const userId = sessionStorage.getItem("slither_user_id");
  const username = sessionStorage.getItem("slither_username") || "Anonymous";

  // Redirect if no user
  useEffect(() => {
    if(!userId) {
      setLocation("/");
    }
  }, [userId, setLocation]);

  const handleGameOver = (finalScore: number) => {
    setGameOver(true);
    if(userId) {
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
      />

      {/* UI Overlay */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none">
        <div className="bg-black/50 backdrop-blur px-6 py-3 rounded-full border border-primary/30 box-glow flex items-center gap-2">
          <span className="text-gray-400 font-bold">SOL</span>
          <span className="text-2xl font-mono text-primary font-bold">
            {(score / 1_000_000_000).toFixed(4)}
          </span>
          {sessionStorage.getItem("slither_is_test") === "true" && (
            <span className="text-xs font-mono text-purple-400 font-bold ml-1">FAKE</span>
          )}
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 flex items-center gap-4">
        <div className="bg-black/50 backdrop-blur px-6 py-3 rounded-full border border-secondary/30 pointer-events-none">
          <span className="text-gray-400 font-bold mr-2">PLAYER</span>
          <span className="text-lg text-white font-bold">{username}</span>
        </div>
        <CyberButton 
          variant="secondary"
          className="pointer-events-auto"
          onClick={async () => {
            const walletAddress = sessionStorage.getItem("slither_wallet");
            const isTestMode = sessionStorage.getItem("slither_is_test") === "true";
            if (walletAddress) {
              await fetch("/api/auth/cash-out", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ walletAddress, isTestMode })
              });
              setLocation("/");
            }
          }}
        >
          Cash Out
        </CyberButton>
      </div>

      {/* Game Over Modal */}
      <AnimatePresence>
        {gameOver && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-slate-900 border border-red-500/50 p-12 rounded-2xl shadow-[0_0_50px_rgba(239,68,68,0.2)] text-center max-w-md w-full"
            >
              <h1 className="text-6xl font-black text-red-500 mb-2 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]">WASTED</h1>
              <p className="text-gray-400 text-lg mb-8 uppercase tracking-widest">You hit a wall or snake</p>
              
              <div className="bg-black/40 p-6 rounded-xl border border-white/10 mb-8">
                <div className="text-sm text-gray-500 uppercase tracking-wider mb-1">Final Score</div>
                <div className="text-4xl font-mono text-white font-bold">{(score / 1_000_000_000).toFixed(4)} SOL</div>
              </div>

              <div className="space-y-4">
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
