import { pgTable, text, serial, integer, boolean, timestamp, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  username: text("username").notNull(),
  bestScore: integer("best_score").default(0),
  coins: integer("coins").default(0),
  isPaid: boolean("is_paid").default(false),
  isTestMode: boolean("is_test_mode").default(false),
  solBalance: bigint("sol_balance", { mode: "number" }).default(sql`0`), 
  testSolBalance: bigint("test_sol_balance", { mode: "number" }).default(sql`0`),
  ownedHats: text("owned_hats").array().default(sql`'{}'::text[]`),
  equippedHat: text("equipped_hat"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const whitelistKeys = pgTable("whitelist_keys", {
  key: text("key").primaryKey(),
  boundIp: text("bound_ip"),
  useCount: integer("use_count").default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ 
  id: true, 
  createdAt: true,
  bestScore: true,
  coins: true,
  isPaid: true,
  isTestMode: true,
  solBalance: true,
  testSolBalance: true,
  ownedHats: true,
  equippedHat: true
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateScoreRequest = { score: number };
export type WhitelistKey = typeof whitelistKeys.$inferSelect;
