import { users, whitelistKeys, type User, type InsertUser, type WhitelistKey } from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByWallet(walletAddress: string): Promise<User | undefined>;
  createUser(user: InsertUser & { isTestMode?: boolean }): Promise<User>;
  updateUsername(id: number, username: string): Promise<User>;
  updateUserScore(id: number, score: number): Promise<User>;
  updateUserBalance(id: number, amount: number): Promise<User>;
  updateUserTestBalance(id: number, amount: number): Promise<User>;
  updateUserTestMode(id: number, isTestMode: boolean): Promise<User>;
  updateUserCosmetics(id: number, ownedHats: string[], equippedHat: string | null): Promise<User>;
  getWhitelistKey(key: string): Promise<WhitelistKey | undefined>;
  bindWhitelistKey(key: string, boundIp: string): Promise<WhitelistKey>;
  touchWhitelistKey(key: string): Promise<WhitelistKey>;
  createWhitelistKeys(keys: string[]): Promise<void>;
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
      walletAddress: insertUser.walletAddress,
      username: insertUser.username,
      isTestMode: insertUser.isTestMode || false,
      isPaid: false,
      solBalance: 0,
      testSolBalance: 0
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

  async updateUsername(id: number, username: string): Promise<User> {
    const [updated] = await db
      .update(users)
      .set({ username })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserPayment(id: number, status: boolean): Promise<User> {
    const [updated] = await db
      .update(users)
      .set({ isPaid: status })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserBalance(id: number, amount: number): Promise<User> {
    const user = await this.getUser(id);
    if (!user) throw new Error("User not found");
    const newBalance = Number(user.solBalance || 0) + amount;
    const [updated] = await db
      .update(users)
      .set({ solBalance: newBalance })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserTestBalance(id: number, amount: number): Promise<User> {
    const user = await this.getUser(id);
    if (!user) throw new Error("User not found");
    const newBalance = Number(user.testSolBalance || 0) + amount;
    const [updated] = await db
      .update(users)
      .set({ testSolBalance: newBalance })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserTestMode(id: number, isTestMode: boolean): Promise<User> {
    const [updated] = await db
      .update(users)
      .set({ isTestMode })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserCosmetics(id: number, ownedHats: string[], equippedHat: string | null): Promise<User> {
    const [updated] = await db
      .update(users)
      .set({ ownedHats, equippedHat })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async getWhitelistKey(key: string): Promise<WhitelistKey | undefined> {
    const [entry] = await db.select().from(whitelistKeys).where(eq(whitelistKeys.key, key));
    return entry;
  }

  async bindWhitelistKey(key: string, boundIp: string): Promise<WhitelistKey> {
    const [updated] = await db
      .update(whitelistKeys)
      .set({ boundIp, lastUsedAt: new Date(), useCount: sql`${whitelistKeys.useCount} + 1` })
      .where(eq(whitelistKeys.key, key))
      .returning();
    return updated;
  }

  async touchWhitelistKey(key: string): Promise<WhitelistKey> {
    const [updated] = await db
      .update(whitelistKeys)
      .set({ lastUsedAt: new Date(), useCount: sql`${whitelistKeys.useCount} + 1` })
      .where(eq(whitelistKeys.key, key))
      .returning();
    return updated;
  }

  async createWhitelistKeys(keys: string[]): Promise<void> {
    if (!keys.length) return;
    await db.insert(whitelistKeys).values(keys.map((key) => ({ key }))).onConflictDoNothing();
  }

  async getTopUsers(limit = 10): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.bestScore)).limit(limit);
  }
}

export const storage = new DatabaseStorage();
