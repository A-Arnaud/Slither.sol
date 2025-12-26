import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type InsertUser } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useLeaderboard() {
  return useQuery({
    queryKey: [api.users.list.path],
    queryFn: async () => {
      const res = await fetch(api.users.list.path);
      if (!res.ok) throw new Error("Failed to fetch leaderboard");
      return api.users.list.responses[200].parse(await res.json());
    },
    refetchInterval: 10000, // Refresh every 10s
  });
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (user: InsertUser) => {
      const res = await fetch(api.auth.login.path, {
        method: api.auth.login.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.auth.login.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Login failed");
      }
      return api.auth.login.responses[200].parse(await res.json());
    },
    onError: (error) => {
      toast({
        title: "Authentication Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: (data) => {
      // Store user ID in local session storage for simple persistence across reloads if needed
      sessionStorage.setItem("slither_user_id", String(data.id));
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
    }
  });
}

export function useUpdateScore() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ userId, score }: { userId: number, score: number }) => {
      const url = buildUrl(api.users.updateScore.path, { id: userId });
      const res = await fetch(url, {
        method: api.users.updateScore.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      
      if (!res.ok) throw new Error("Failed to update score");
      return api.users.updateScore.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
    }
  });
}
