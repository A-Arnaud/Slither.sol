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
      res.json({ success: true, user: updatedUser });
    } catch (err) {
      res.status(400).json({ message: "Payment verification failed" });
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

  wss.on('connection', (ws) => {
    let playerId: string | null = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'join') {
          playerId = message.payload.id;
          players.set(playerId, { ...message.payload, ws });
          broadcast({ type: 'player-joined', payload: message.payload });
        } else if (message.type === 'move') {
          if (playerId) {
            const player = players.get(playerId);
            if (player) {
              player.segments = message.payload.segments;
              broadcast({ type: 'player-moved', payload: { id: playerId, segments: player.segments } });
            }
          }
        } else if (message.type === 'die') {
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
