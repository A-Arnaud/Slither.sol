import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import { Connection, PublicKey } from "@solana/web3.js";

const SOLANA_RPC = "https://api.devnet.solana.com";
const TREASURY_WALLET = "21LyNXi8os73adkt61ppznLCMFK2jeoPHezMNrMVZfZZ";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.post(api.auth.login.path, async (req, res) => {
    try {
      const input = api.auth.login.input.parse(req.body);
      let user = await storage.getUserByWallet(input.walletAddress);
      
      if (!user) {
        user = await storage.createUser({
          walletAddress: input.walletAddress,
          username: input.username,
          isTestMode: req.body.isTestMode || false
        });
        return res.status(201).json(user);
      }
      
      res.status(200).json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(api.auth.verifyPayment.path, async (req, res) => {
    try {
      const { signature, walletAddress } = api.auth.verifyPayment.input.parse(req.body);
      const user = await storage.getUserByWallet(walletAddress);
      
      if (!user) return res.status(404).json({ message: "User not found" });

      const connection = new Connection(SOLANA_RPC, "confirmed");
      const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

      if (!tx) return res.status(400).json({ message: "Transaction not found" });

      // Basic verification: Check if treasury received funds
      const accountKeys = tx.transaction.message.getAccountKeys();
      const treasuryIndex = accountKeys.staticAccountKeys.findIndex(k => k.toBase58() === TREASURY_WALLET);
      
      if (treasuryIndex === -1) {
        return res.status(400).json({ message: "Invalid recipient wallet" });
      }

      const updatedUser = await storage.updateUserPayment(user.id, true);
      // Deduct 5 cents fee (approx 0.0002 SOL at current rate, but let's use lamports)
      // 0.1 SOL = 100,000,000 lamports. Let's say 0.095 SOL goes to player's game balance.
      const entryFeeLamports = 0.095 * 1_000_000_000;
      await storage.updateUserBalance(user.id, entryFeeLamports);
      res.json({ success: true, user: updatedUser });
    } catch (err) {
      res.status(400).json({ message: "Payment verification failed" });
    }
  });

  app.post("/api/auth/cash-out", async (req, res) => {
    try {
      const { walletAddress } = req.body;
      const user = await storage.getUserByWallet(walletAddress);
      if (!user || (user.solBalance || 0) <= 0) return res.status(400).json({ message: "No balance to cash out" });
      
      // In a real app, you would send a transaction here from the treasury.
      // For now, we simulate and clear balance.
      await storage.updateUserBalance(user.id, -(user.solBalance || 0));
      res.json({ success: true, amount: user.solBalance });
    } catch (err) {
      res.status(500).json({ message: "Cash out failed" });
    }
  });

  app.get(api.users.list.path, async (req, res) => {
    const users = await storage.getTopUsers(10);
    res.json(users);
  });

  app.post(api.users.updateScore.path, async (req, res) => {
    try {
      const { score } = req.body;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const updatedUser = await storage.updateUserScore(id, score);
      res.json(updatedUser);
    } catch (err) {
      res.status(500).json({ message: "Failed to update score" });
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const players = new Map();
  let foodItems: any[] = []; // In-memory food/loot state

  // Initialize with NO random food (only loot from deaths)
  // for(let i=0; i<200; i++) { ... }

  wss.on('connection', (ws) => {
    let playerId: string | null = null;
    
    // Send initial food state
    ws.send(JSON.stringify({ type: 'food-update', payload: foodItems }));

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'join') {
          playerId = message.payload.id;
          players.set(playerId, { ...message.payload, ws, score: 0 });
          broadcast({ type: 'player-joined', payload: message.payload });
        } else if (message.type === 'move') {
          if (playerId) {
            const player = players.get(playerId);
            if (player) {
              player.segments = message.payload.segments;
              broadcast({ type: 'player-moved', payload: { id: playerId, segments: player.segments } });
              
              // Check food collision
              const head = player.segments[0];
              foodItems = foodItems.filter(f => {
                const dx = head.x - f.x;
                const dy = head.y - f.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < 20) {
                   player.score += f.value;
                   if (f.isLoot) {
                     // If it's SOL loot, update database
                     storage.updateUserBalance(parseInt(player.userId), f.lamports);
                   }
                   broadcast({ type: 'food-eaten', payload: { id: f.id, playerId } });
                   return false;
                }
                return true;
              });
            }
          }
        } else if (message.type === 'die') {
           const player = players.get(playerId);
           if (player) {
             // Drop loot based on segments
             const lootItems = player.segments.filter((_:any, i:number) => i % 5 === 0).map((pt:any, i:number) => ({
               id: `loot-${playerId}-${i}-${Date.now()}`,
               x: pt.x,
               y: pt.y,
               value: 50,
               color: "#eab308", // Golden color for loot
               isLoot: true,
               lamports: 1_000_000 // 0.001 SOL per drop segment
             }));
             foodItems.push(...lootItems);
             broadcast({ type: 'food-update', payload: foodItems });
           }
           broadcast({ type: 'player-died', payload: { id: playerId } });
           players.delete(playerId);
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      if (playerId) {
        players.delete(playerId);
        broadcast({ type: 'player-left', payload: { id: playerId } });
      }
    });

    function broadcast(msg: any) {
      const payload = JSON.stringify(msg);
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  });

  return httpServer;
}
