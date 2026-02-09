// In-Memory Storage for E2EE Keys (No MongoDB required for testing)
// This allows testing X3DH without installing MongoDB

interface UserKeys {
  userId: string;
  identityKeyPublic: string;
  identityKeyPrivate: string;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeyPrivate: string;
  signedPreKeySignature: string;
  oneTimePreKeys: Array<{
    keyId: number;
    publicKey: string;
    privateKey: string;
    used: boolean;
  }>;
}

interface Message {
  from: string;
  to: string;
  chatId: string;
  content?: string;
  timestamp: Date;
}

class InMemoryStore {
  private users: Map<string, UserKeys> = new Map();
  private messages: Message[] = [];

  // User methods
  async findUserByUserId(userId: string): Promise<UserKeys | null> {
    return this.users.get(userId) || null;
  }

  async upsertUser(userId: string, keys: Partial<UserKeys>): Promise<UserKeys> {
    const existing = this.users.get(userId);
    const updated: UserKeys = {
      userId,
      identityKeyPublic: keys.identityKeyPublic || existing?.identityKeyPublic || '',
      identityKeyPrivate: keys.identityKeyPrivate || existing?.identityKeyPrivate || '',
      signedPreKeyId: keys.signedPreKeyId ?? existing?.signedPreKeyId ?? 0,
      signedPreKeyPublic: keys.signedPreKeyPublic || existing?.signedPreKeyPublic || '',
      signedPreKeyPrivate: keys.signedPreKeyPrivate || existing?.signedPreKeyPrivate || ''!,
      signedPreKeySignature: keys.signedPreKeySignature || existing?.signedPreKeySignature || '',
      oneTimePreKeys: keys.oneTimePreKeys || existing?.oneTimePreKeys || []
    };
    this.users.set(userId, updated);
    return updated;
  }

  async updateUserOPKs(userId: string, oneTimePreKeys: UserKeys['oneTimePreKeys']): Promise<UserKeys | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    user.oneTimePreKeys = oneTimePreKeys;
    this.users.set(userId, user);
    return user;
  }

  // Message methods
  async saveMessage(message: Omit<Message, 'timestamp'>): Promise<Message> {
    const msg: Message = {
      ...message,
      timestamp: new Date()
    };
    this.messages.push(msg);
    return msg;
  }

  async getMessagesByChatId(chatId: string): Promise<Message[]> {
    return this.messages
      .filter(m => m.chatId === chatId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // Utility
  clear() {
    this.users.clear();
    this.messages = [];
  }

  listUsers(): string[] {
    return Array.from(this.users.keys());
  }
}

export const store = new InMemoryStore();

// Mock Mongoose models that use the in-memory store
export const UserModel = {
  findOne: async ({ userId }: { userId: string }) => {
    return await store.findUserByUserId(userId);
  },
  findOneAndUpdate: async (
    { userId }: { userId: string },
    update: any,
    options: any
  ) => {
    return await store.upsertUser(userId, update);
  }
};

export const MessageModel = {
  create: async (data: Omit<Message, 'timestamp'>) => {
    return await store.saveMessage(data);
  },
  find: async ({ chatId }: { chatId: string }) => {
    return await store.getMessagesByChatId(chatId);
  }
};

export const connectDB = async () => {
  console.log('✅ Using in-memory storage (MongoDB not required for testing)');
  console.log('💡 Keys and messages will be stored in memory');
  return Promise.resolve();
};