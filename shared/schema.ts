import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  username: text("username").notNull(),
  bestScore: integer("best_score").default(0),
  coins: integer("coins").default(0),
  isPaid: boolean("is_paid").default(false),
  isTestMode: boolean("is_test_mode").default(false),
  solBalance: integer("sol_balance").default(0), // in lamports
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ 
  id: true, 
  createdAt: true,
  bestScore: true,
  coins: true,
  isPaid: true,
  isTestMode: true,
  solBalance: true
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateScoreRequest = { score: number };
