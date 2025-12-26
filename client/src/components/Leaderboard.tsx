import { useLeaderboard } from "@/hooks/use-game-api";
import { Loader2, Trophy } from "lucide-react";
import { motion } from "framer-motion";

export function Leaderboard() {
  const { data: users, isLoading } = useLeaderboard();

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl"
    >
      <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
        <Trophy className="w-6 h-6 text-yellow-500" />
        <h2 className="text-xl font-bold text-white uppercase tracking-wider">Top Snakes</h2>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {users?.sort((a,b) => (b.bestScore || 0) - (a.bestScore || 0)).slice(0, 5).map((user, index) => (
            <div 
              key={user.id} 
              className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-transparent hover:border-primary/30 group"
            >
              <div className="flex items-center gap-4">
                <span className={`
                  w-6 h-6 flex items-center justify-center rounded font-bold text-sm
                  ${index === 0 ? 'bg-yellow-500 text-black' : 
                    index === 1 ? 'bg-gray-400 text-black' : 
                    index === 2 ? 'bg-amber-700 text-black' : 'text-gray-500'}
                `}>
                  {index + 1}
                </span>
                <span className="font-medium text-white group-hover:text-primary transition-colors">
                  {user.username}
                </span>
              </div>
              <span className="font-mono text-secondary font-bold">
                {user.bestScore?.toLocaleString()}
              </span>
            </div>
          ))}

          {users?.length === 0 && (
            <div className="text-center text-muted-foreground py-4">
              No players yet. Be the first!
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
