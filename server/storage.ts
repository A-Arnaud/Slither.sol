import { users, type User, type InsertUser } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByWallet(walletAddress: string): Promise<User | undefined>;
  createUser(user: InsertUser & { isTestMode?: boolean }): Promise<User>;
  updateUserScore(id: number, score: number): Promise<User>;
  updateUserPayment(id: number, status: boolean): Promise<User>;
  getTopUsers(limit?: number): Promise<User[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByWallet(walletAddress: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.walletAddress, walletAddress));
    return user;
  }

  async createUser(insertUser: InsertUser & { isTestMode?: boolean }): Promise<User> {
    const [user] = await db.insert(users).values({
      ...insertUser,
      isTestMode: insertUser.isTestMode || false,
      isPaid: false
    }).returning();
    return user;
  }

  async updateUserScore(id: number, score: number): Promise<User> {
    const currentUser = await this.getUser(id);
    if (!currentUser) throw new Error("User not found");
    
    if (score > (currentUser.bestScore || 0)) {
      const [updated] = await db
        .update(users)
        .set({ bestScore: score })
        .where(eq(users.id, id))
        .returning();
      return updated;
    }
    return currentUser;
  }

  async updateUserPayment(id: number, status: boolean): Promise<User> {
    const [updated] = await db
      .update(users)
      .set({ isPaid: status })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async getTopUsers(limit = 10): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.bestScore)).limit(limit);
  }
}

export const storage = new DatabaseStorage();
