import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Auth / User routes
  app.post(api.auth.login.path, async (req, res) => {
    try {
      const input = api.auth.login.input.parse(req.body);
      let user = await storage.getUserByWallet(input.walletAddress);
      
      if (!user) {
        user = await storage.createUser(input);
        res.status(201).json(user);
      } else {
        res.status(200).json(user);
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
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
      
      // Basic validation
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      
      const updatedUser = await storage.updateUserScore(id, score);
      res.json(updatedUser);
    } catch (err) {
      res.status(500).json({ message: "Failed to update score" });
    }
  });

  // Basic WebSocket setup for real-time game (optional for MVP but good to have)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
      // Broadcast to all other clients (basic relay)
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    });

    ws.on('close', () => {
      console.log('Client disconnected');
    });
  });

  return httpServer;
}
