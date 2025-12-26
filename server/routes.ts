import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const SOLANA_RPC = "https://api.devnet.solana.com";
const TREASURY_WALLET = "21LyNXi8os73adkt61ppznLCMFK2jeoPHezMNrMVZfZZ";
const ESCROW_WALLET = process.env.ESCROW_WALLET || "";
const MIN_STAKE_LAMPORTS = 0.1 * 1_000_000_000;
const MAX_STAKE_LAMPORTS = 5 * 1_000_000_000;
const FEE_RATE = 0.05;
const WORLD_SIZE = 4000;
const INITIAL_SNAKE_LENGTH = 20;
const BASE_SPEED = 6;
const BOOST_SPEED = 10;
const TURN_SPEED = 0.08;
const FOOD_TARGET = 0;
const MAX_PLAYERS_PER_WORLD = 20;

type WorldMode = "test" | "pvp";
type Point = { x: number; y: number };
type FoodItem = {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
  value: number;
  isLoot: boolean;
  lamports: number;
};
type PlayerState = {
  id: string;
  ws: WebSocket;
  userId: number;
  walletAddress: string;
  name: string;
  color: string;
  isTestMode: boolean;
  stakeLamports: number;
  segments: Point[];
  angle: number;
  targetAngle: number;
  boosting: boolean;
  score: number;
  width: number;
  alive: boolean;
  boostEnergy: number;
};
type WorldState = {
  mode: WorldMode;
  players: Map<string, PlayerState>;
  food: FoodItem[];
};

const worlds: Record<WorldMode, WorldState> = {
  test: { mode: "test", players: new Map(), food: [] },
  pvp: { mode: "pvp", players: new Map(), food: [] },
};

function randomInRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function spawnFood(world: WorldState, count: number) {
  const colors = ["#22c55e", "#a855f7", "#06b6d4", "#f43f5e", "#eab308"];
  for (let i = 0; i < count; i += 1) {
    world.food.push({
      id: `food-${world.mode}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      x: randomInRange(50, WORLD_SIZE - 50),
      y: randomInRange(50, WORLD_SIZE - 50),
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 8,
      value: 10,
      isLoot: false,
      lamports: 0,
    });
  }
}

function createPlayer(id: string, name: string, color: string): { segments: Point[]; angle: number } {
  const spawnX = randomInRange(200, WORLD_SIZE - 200);
  const spawnY = randomInRange(200, WORLD_SIZE - 200);
  const segments: Point[] = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i += 1) {
    segments.push({ x: spawnX - i * 5, y: spawnY });
  }
  return {
    segments,
    angle: Math.random() * Math.PI * 2,
  };
}

function getEscrowKeypair() {
  const raw = process.env.ESCROW_SECRET_KEY;
  if (!raw) {
    throw new Error("ESCROW_SECRET_KEY not configured");
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("ESCROW_SECRET_KEY must be a JSON array");
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/api/players/count", (req, res) => {
    const mode = req.query.mode === "pvp" ? "pvp" : "test";
    const count = worlds[mode].players.size;
    res.json({ mode, count, max: MAX_PLAYERS_PER_WORLD });
  });

  app.get("/api/players/list", (req, res) => {
    const mode = req.query.mode === "pvp" ? "pvp" : "test";
    const players = Array.from(worlds[mode].players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      walletAddress: player.walletAddress,
      score: player.score,
    }));
    res.json({ mode, players, count: players.length, max: MAX_PLAYERS_PER_WORLD });
  });
  
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
        
        // Give fake SOL if test mode
        if (req.body.isTestMode) {
          user = await storage.updateUserTestBalance(user.id, 10 * 1_000_000_000); // 10 Fake SOL
        }
        
        return res.status(201).json(user);
      }
      
      // If user exists but is entering test mode, give them test balance if they don't have it
      if (req.body.isTestMode && !user.isTestMode) {
         user = await storage.updateUserTestBalance(user.id, 10 * 1_000_000_000);
         // Also update the test mode flag in DB
         user = await storage.updateUserTestMode(user.id, true);
      }
      
      res.status(200).json(user);
    } catch (err) {
      console.error("Login error:", err);
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
      const { signature, walletAddress, stakeLamports } = api.auth.verifyPayment.input.parse(req.body);
      if (!ESCROW_WALLET) {
        return res.status(500).json({ message: "ESCROW_WALLET not configured" });
      }
      if (stakeLamports < MIN_STAKE_LAMPORTS || stakeLamports > MAX_STAKE_LAMPORTS) {
        return res.status(400).json({ message: "Invalid stake amount" });
      }
      const user = await storage.getUserByWallet(walletAddress);
      
      if (!user) return res.status(404).json({ message: "User not found" });

      const connection = new Connection(SOLANA_RPC, "confirmed");
      const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

      if (!tx) return res.status(400).json({ message: "Transaction not found" });

      // Verify treasury and escrow recipients
      const accountKeys = tx.transaction.message.getAccountKeys();
      const treasuryIndex = accountKeys.staticAccountKeys.findIndex(k => k.toBase58() === TREASURY_WALLET);
      const escrowIndex = accountKeys.staticAccountKeys.findIndex(k => k.toBase58() === ESCROW_WALLET);

      if (treasuryIndex === -1 || escrowIndex === -1) {
        return res.status(400).json({ message: "Invalid recipient wallet(s)" });
      }

      const feeLamports = Math.floor(stakeLamports * FEE_RATE);
      const escrowLamports = stakeLamports - feeLamports;
      const preBalances = tx.meta?.preBalances;
      const postBalances = tx.meta?.postBalances;
      if (!preBalances || !postBalances) {
        return res.status(400).json({ message: "Missing transaction balances" });
      }

      const treasuryDelta = postBalances[treasuryIndex] - preBalances[treasuryIndex];
      const escrowDelta = postBalances[escrowIndex] - preBalances[escrowIndex];
      if (treasuryDelta < feeLamports || escrowDelta < escrowLamports) {
        return res.status(400).json({ message: "Incorrect payment amounts" });
      }

      const updatedUser = await storage.updateUserPayment(user.id, true);
      await storage.updateUserBalance(user.id, escrowLamports);
      res.json({ success: true, user: updatedUser });
    } catch (err) {
      res.status(400).json({ message: "Payment verification failed" });
    }
  });

  app.post("/api/auth/cash-out", async (req, res) => {
    try {
      const { walletAddress, isTestMode } = req.body;
      const user = await storage.getUserByWallet(walletAddress);
      
      if (!user) return res.status(404).json({ message: "User not found" });
      const balance = isTestMode ? Number(user.testSolBalance || 0) : Number(user.solBalance || 0);
      res.json({ success: true, amount: balance.toString(), user });
    } catch (err) {
      res.status(500).json({ message: "Cash out failed" });
    }
  });

  app.post("/api/auth/withdraw", async (req, res) => {
    try {
      const { walletAddress, isTestMode } = z.object({
        walletAddress: z.string(),
        isTestMode: z.boolean().optional().default(false)
      }).parse(req.body);

      if (isTestMode) {
        return res.status(400).json({ message: "Test mode withdrawals are disabled" });
      }

      if (!ESCROW_WALLET) {
        return res.status(500).json({ message: "ESCROW_WALLET not configured" });
      }

      const user = await storage.getUserByWallet(walletAddress);
      if (!user) return res.status(404).json({ message: "User not found" });

      const balance = Number(user.solBalance || 0);
      if (balance <= 0) return res.status(400).json({ message: "No balance to withdraw" });

      const escrowKeypair = getEscrowKeypair();
      if (escrowKeypair.publicKey.toBase58() !== ESCROW_WALLET) {
        return res.status(500).json({ message: "ESCROW wallet mismatch" });
      }

      const connection = new Connection(SOLANA_RPC, "confirmed");
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: escrowKeypair.publicKey,
          toPubkey: new PublicKey(walletAddress),
          lamports: balance
        })
      );

      const signature = await connection.sendTransaction(tx, [escrowKeypair]);
      await connection.confirmTransaction(signature, "confirmed");

      const updated = await storage.updateUserBalance(user.id, -balance);
      res.json({ success: true, signature, user: updated });
    } catch (err) {
      res.status(400).json({ message: "Withdraw failed" });
    }
  });

  app.post("/api/game/lose", async (req, res) => {
    try {
      const input = z.object({
        walletAddress: z.string(),
        isTestMode: z.boolean(),
        stakeLamports: z.number().positive()
      }).parse(req.body);

      const user = await storage.getUserByWallet(input.walletAddress);
      if (!user) return res.status(404).json({ message: "User not found" });

      const currentBalance = input.isTestMode
        ? Number(user.testSolBalance || 0)
        : Number(user.solBalance || 0);
      const loss = Math.min(currentBalance, input.stakeLamports);

      const updated = input.isTestMode
        ? await storage.updateUserTestBalance(user.id, -loss)
        : await storage.updateUserBalance(user.id, -loss);

      res.json({ success: true, loss: loss.toString(), user: updated });
    } catch (err) {
      res.status(400).json({ message: "Failed to apply loss" });
    }
  });

  app.post("/api/users/add-fake-sol", async (req, res) => {
    try {
      const { walletAddress, amount } = req.body;
      const user = await storage.getUserByWallet(walletAddress);
      if (!user) return res.status(404).json({ message: "User not found" });
      const updated = await storage.updateUserTestBalance(user.id, amount);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Failed to add fake SOL" });
    }
  });

  app.get("/api/users/by-wallet", async (req, res) => {
    try {
      const walletAddress = String(req.query.walletAddress || "");
      if (!walletAddress) return res.status(400).json({ message: "walletAddress is required" });
      const user = await storage.getUserByWallet(walletAddress);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch user" });
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

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  function broadcastToWorld(world: WorldState, payload: string) {
    world.players.forEach((player) => {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(payload);
      }
    });
  }

  function buildSnapshot(world: WorldState) {
    return JSON.stringify({
      type: "snapshot",
      payload: {
        world: world.mode,
        players: Array.from(world.players.values())
          .filter((player) => player.alive)
          .map((player) => ({
            id: player.id,
            name: player.name,
            color: player.color,
            segments: player.segments,
            score: player.score,
            boostEnergy: player.boostEnergy,
          })),
        food: world.food,
        ts: Date.now(),
      },
    });
  }

  async function applyLoss(world: WorldState, player: PlayerState) {
    if (!player.stakeLamports || player.stakeLamports <= 0) return;
    const user = await storage.getUserByWallet(player.walletAddress);
    if (!user) return;
    const currentBalance = player.isTestMode
      ? Number(user.testSolBalance || 0)
      : Number(user.solBalance || 0);
    const loss = Math.min(currentBalance, player.stakeLamports);
    if (loss <= 0) return;
    if (player.isTestMode) {
      await storage.updateUserTestBalance(user.id, -loss);
    } else {
      await storage.updateUserBalance(user.id, -loss);
    }
  }

  function dropLoot(world: WorldState, player: PlayerState) {
    const lootItems = player.segments
      .filter((_, i) => i % 5 === 0)
      .map((pt, i) => ({
        id: `loot-${player.id}-${i}-${Date.now()}`,
        x: pt.x,
        y: pt.y,
        value: 1_000_000,
        color: "#eab308",
        isLoot: true,
        lamports: 1_000_000,
        size: 10,
      }));
    world.food.push(...lootItems);
  }

  function removePlayer(world: WorldState, playerId: string) {
    world.players.delete(playerId);
  }

  async function handleDeath(world: WorldState, player: PlayerState, reason: string) {
    if (!player.alive) return;
    player.alive = false;
    dropLoot(world, player);
    await applyLoss(world, player);
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({ type: "dead", payload: { reason } }));
      player.ws.close();
    }
    removePlayer(world, player.id);
  }

  function updateWorld(world: WorldState) {
    if (FOOD_TARGET > 0 && world.food.length < FOOD_TARGET) {
      spawnFood(world, FOOD_TARGET - world.food.length);
    }

    world.players.forEach((player) => {
      if (!player.alive) return;

      const diff = ((player.targetAngle - player.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      player.angle += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED);
      if (player.boosting && player.boostEnergy > 0) {
        player.boostEnergy = Math.max(0, player.boostEnergy - 2.0);
      } else {
        player.boosting = false;
        player.boostEnergy = Math.min(100, player.boostEnergy + 0.15);
      }
      const speed = player.boosting && player.boostEnergy > 0 ? BOOST_SPEED : BASE_SPEED;
      const head = player.segments[0];
      const newHead = {
        x: head.x + Math.cos(player.angle) * speed,
        y: head.y + Math.sin(player.angle) * speed,
      };

      if (newHead.x < 0 || newHead.x > WORLD_SIZE || newHead.y < 0 || newHead.y > WORLD_SIZE) {
        void handleDeath(world, player, "out-of-bounds");
        return;
      }

      // Collision with other snakes
      for (const other of world.players.values()) {
        if (other.id === player.id) continue;
        for (let j = 1; j < other.segments.length; j += 1) {
          const pt = other.segments[j];
          const dx = newHead.x - pt.x;
          const dy = newHead.y - pt.y;
          if (Math.sqrt(dx * dx + dy * dy) < player.width / 2 + 5) {
            void handleDeath(world, player, "hit-snake");
            return;
          }
        }
      }

      player.segments.unshift(newHead);
      const desiredLength = INITIAL_SNAKE_LENGTH + Math.floor(player.score / 1_000_000);
      while (player.segments.length > desiredLength) player.segments.pop();

      // Food collision
      for (let i = world.food.length - 1; i >= 0; i -= 1) {
        const f = world.food[i];
        const dx = newHead.x - f.x;
        const dy = newHead.y - f.y;
        if (Math.sqrt(dx * dx + dy * dy) < player.width / 2 + f.size) {
          player.score += f.isLoot ? f.lamports : f.value;
          if (f.isLoot && player.userId > 0) {
            if (player.isTestMode) {
              void storage.updateUserTestBalance(player.userId, f.lamports);
            } else {
              void storage.updateUserBalance(player.userId, f.lamports);
            }
          }
          world.food.splice(i, 1);
        }
      }
    });

    broadcastToWorld(world, buildSnapshot(world));
  }

  setInterval(() => updateWorld(worlds.test), 33);
  setInterval(() => updateWorld(worlds.pvp), 33);

  wss.on("connection", (ws) => {
    let playerId: string | null = null;
    let world: WorldState | null = null;

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "join") {
          const payload = z.object({
            id: z.string(),
            name: z.string(),
            color: z.string(),
            mode: z.enum(["test", "pvp"]),
            isTestMode: z.boolean(),
            userId: z.union([z.number(), z.string()]),
            walletAddress: z.string(),
            stakeLamports: z.number(),
          }).parse(message.payload);

          if (payload.isTestMode !== (payload.mode === "test")) {
            ws.send(JSON.stringify({ type: "reject", payload: { message: "Mode mismatch" } }));
            ws.close();
            return;
          }

          if (!payload.walletAddress) {
            ws.send(JSON.stringify({ type: "reject", payload: { message: "Missing wallet address" } }));
            ws.close();
            return;
          }

          const selectedWorld = worlds[payload.mode];
          if (selectedWorld.players.size >= MAX_PLAYERS_PER_WORLD) {
            ws.send(JSON.stringify({ type: "full", payload: { message: "World is full" } }));
            ws.close();
            return;
          }

          if (payload.stakeLamports < MIN_STAKE_LAMPORTS || payload.stakeLamports > MAX_STAKE_LAMPORTS) {
            ws.send(JSON.stringify({ type: "reject", payload: { message: "Invalid stake amount" } }));
            ws.close();
            return;
          }

          const user = await storage.getUserByWallet(payload.walletAddress);
          if (!user) {
            ws.send(JSON.stringify({ type: "reject", payload: { message: "User not found" } }));
            ws.close();
            return;
          }

          const balance = payload.isTestMode ? Number(user.testSolBalance || 0) : Number(user.solBalance || 0);
          if (balance < payload.stakeLamports) {
            ws.send(JSON.stringify({ type: "reject", payload: { message: "Insufficient balance" } }));
            ws.close();
            return;
          }

          playerId = payload.id;
          world = selectedWorld;

          const spawn = createPlayer(payload.id, payload.name, payload.color);
          selectedWorld.players.set(payload.id, {
            id: payload.id,
            ws,
            userId: Number(payload.userId),
            walletAddress: payload.walletAddress,
            name: payload.name,
            color: payload.color,
            isTestMode: payload.isTestMode,
            stakeLamports: payload.stakeLamports,
            segments: spawn.segments,
            angle: spawn.angle,
            targetAngle: spawn.angle,
            boosting: false,
            score: 0,
            width: 20,
            alive: true,
            boostEnergy: 100,
          });

          ws.send(JSON.stringify({ type: "joined", payload: { id: payload.id, world: payload.mode } }));
          ws.send(buildSnapshot(selectedWorld));
        } else if (message.type === "input") {
          if (!playerId || !world) return;
          const player = world.players.get(playerId);
          if (!player || !player.alive) return;
          const input = z.object({
            angle: z.number(),
            boosting: z.boolean().optional(),
          }).parse(message.payload);
          if (!Number.isFinite(input.angle)) return;
          player.targetAngle = input.angle;
          player.boosting = Boolean(input.boosting);
        }
      } catch {
        // Ignore malformed messages.
      }
    });

    ws.on("close", () => {
      if (playerId && world) {
        removePlayer(world, playerId);
      }
    });
  });

  return httpServer;
}
