import React, { useState, useEffect } from 'react'
import ChatList from './components/ChatList'
import ChatWindow from './components/ChatWindow'
import ContactsModal from './components/ContactsModal'
import { DoubleRatchet } from './crypto/ratchet'
import './App.css'

// חיבור לשרת (וודא שהשרת רץ על פורט 3001)
import { io } from 'socket.io-client'

const socket = io('http://localhost:3001', {
  transports: ['websocket', 'polling'],
})

export interface Chat {
  id: string
  name: string
  avatar: string
  lastMessage: string
  timestamp: string
  unread: number
}

export interface Message {
  id: string
  chatId: string
  text: string
  sender: string
  timestamp: string
  isOwn: boolean
}

export interface Contact {
  id: string
  name: string
  avatar: string
}

const contacts: Contact[] = [
  { id: '1', name: 'רז בן לולו', avatar: '👨' },
  { id: '2', name: 'תומר פורת', avatar: '👨' },
  { id: '3', name: 'לידן תורגמן', avatar: '👨' },
  { id: '4', name: 'דנה גלפמן', avatar: '👩' },
  { id: '5', name: 'חמי ליבוביץ', avatar: '👨‍🎓' }
]

function App() {
  const [selectedChat, setSelectedChat] = useState<string | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [showContactsModal, setShowContactsModal] = useState(false)

  // זהות המשתמש הנוכחי – ניתנת לבחירה מה-UI
  const [myId, setMyId] = useState<string>('4')

  // Double Ratchet instances לפענוח הודעות
  const [ratchets] = useState<Map<string, DoubleRatchet>>(new Map())
  // Pending sessions promises to handle race conditions
  const pendingSessions = React.useRef(new Map<string, Promise<void>>()).current;

  // איפוס צ'אטים והודעות כשמחליפים משתמש
  useEffect(() => {
    setChats([])
    setMessages([])
    setSelectedChat(null)
    ratchets.clear()
    pendingSessions.clear()
  }, [myId])


  // --- האזנה להודעות נכנסות מהשרת והרשמה ---
  useEffect(() => {
    socket.on('connect', async () => {
      console.log('Connected to Socket.IO server, id:', socket.id)

      // הרשמה לשרת עם ה-ID שלי
      socket.emit('register-session', myId)

      // יצירת מפתחות קריפטוגרפיים בדפדפן ושליחת Public Keys לשרת
      try {
        import('./crypto/keyManager').then(async ({ KeyManager }) => {
          // Generate or load keys
          const keys = await KeyManager.generateAndSaveKeys(myId);
          if (keys) {
            const publicBundle = KeyManager.getPublicBundle(keys);
            socket.emit('register-keys', publicBundle, (res: any) => {
              if (res.ok) {
                console.log('✅ Public Keys registered for user', myId)
              } else {
                console.error('❌ Key registration failed', res)
              }
            })
          }
        });
      } catch (e) {
        console.error("Failed to initialize crypto keys", e);
      }
    })

    socket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err.message)
    })

    const handleReceiveMessage = async (data: any) => {
      const fromId = data.from as string
      const timestamp = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

      // פענוח ההודעה עם Double Ratchet
      const ratchetKey = [myId, fromId].sort().join('|')
      let plaintext = data.ciphertext // Default fallback?

      let ratchet = ratchets.get(ratchetKey)

      // Check if a session handshake is currently in progress
      if (!ratchet && pendingSessions.has(ratchetKey)) {
        console.log(`Waiting for pending session handshake with ${fromId}...`);
        try {
          await pendingSessions.get(ratchetKey);
          ratchet = ratchets.get(ratchetKey); // Try getting it again
          console.log("Session handshake finished, proceeding with decryption.");
        } catch (e) {
          console.error("Pending session handshake failed", e);
        }
      }

      // If we don't have a ratchet session, we might be receiving the first message.
      // But we need the Shared Secret established via X3DH first!
      // In a real flow, the first message might carry the X3DH bundle or we fetch it.
      // For this refactor, let's assume `init-session` was done if we sent it, 
      // BUT if we are receiving, we might need to "Accept" the session.
      // Ideally, the sender did X3DH against our PreKeys. They derived a secret.
      // We need to derive the SAME secret using our Private Keys and their Public Ephemeral Key (if they sent it).

      // SIMPLIFICATION FOR THIS STEP:
      // The current server logic had `init-session` where Server did X3DH and set up `ratchets`.
      // Now Client A does X3DH. Client A calculates Secret.
      // Client A puts Secret into Ratchet.
      // Client A sends message.
      // Client B receives message. Client B *doesn't know the secret yet*!
      // Client B needs: Sender's Identity Key + Sender's Ephemeral Key (from the message or handshake).
      // 
      // To make this work WITHOUT changing the protocol message format too much:
      // We will perform the `init-session` (Handshake) as a separate socket event *initiated by the sender*.
      // The sender will calculate the secret, AND send the necessary public keys to the recipient so THEY can calculate it too.
      // 
      // Let's implement `socket.on('session-established', ...)` or similar?
      // Or better: The sender calculates secret. The sender sends "I am starting session" to B directly?
      // 
      // Let's stick to the current flow's style:
      // `init-session` is currently C->S. 
      // The Plan: "Client calls API to get recipient's Public Key Bundle."
      // So Sender has Secret. Sender needs to tell Recipient "Here are my public values (Ephemeral Key) so you can derive the secret too".
      // 
      // We need to update `handleSendMessage` to transmit the Ephemeral Public Key used for X3DH to the recipient?
      // Standard X3DH: Initial message contains (IdentityKey, EphemeralKey, PreKeyId used).
      // 
      // Let's modify `handleSendMessage` to do the Handshake if needed.

      if (!ratchet) {
        console.warn(`No active ratchet session for ${ratchetKey}. Message cannot be decrypted yet.`);
        // In a real app we would queue this or trigger session rebuild.
        plaintext = "[Encrypted Message - Session Not Established]";
      } else {
        try {
          plaintext = await ratchet.decrypt(data.ciphertext);
          console.log('✅ Decrypted message:', plaintext)
        } catch (e) {
          console.error("Decryption failed", e);
          plaintext = "[Decryption Error]";
        }
      }

      // עדכון רשימת הצ׳אטים
      setChats(prevChats => {
        const existingChat = prevChats.find(chat => chat.id === fromId)

        if (!existingChat) {
          const contact = contacts.find(c => c.id === fromId)
          if (!contact) return prevChats

          return [
            ...prevChats,
            {
              id: contact.id,
              name: contact.name,
              avatar: contact.avatar,
              lastMessage: plaintext,  // הטקסט המפוענח!
              timestamp,
              unread: 1,
            },
          ]
        }

        return prevChats.map(chat =>
          chat.id === fromId
            ? {
              ...chat,
              lastMessage: plaintext,
              timestamp,
              unread: selectedChat === fromId ? chat.unread : chat.unread + 1,
            }
            : chat
        )
      })

      // הוספת ההודעה לרשימת ההודעות
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        chatId: fromId,
        text: plaintext,
        sender: fromId,
        timestamp,
        isOwn: false,
      }])
    }

    socket.on('receive-message', handleReceiveMessage)

    // Listen for incoming Handshake (X3DH) requests/info
    socket.on('session-request', async (data: any) => {
      // data: { from: string, senderIdentityKey: string, senderEphemeralKey: string, usedOneTimePreKeyId: number }
      console.log("Incoming Session Request from", data.from);

      const key = [myId, data.from].sort().join('|');

      const sessionPromise = (async () => {
        try {
          const { KeyManager } = await import('./crypto/keyManager');
          const { X3DH } = await import('./crypto/x3dh');
          const { DoubleRatchet } = await import('./crypto/ratchet');
          const { importPublicKey, importPrivateKey } = await import('./crypto/web-crypto-utils');

          const myKeys = KeyManager.getKeys(myId);
          if (!myKeys) return;

          // Reconstruct the flow to derive the same secret.
          const identityKeyPrivate = await importPrivateKey(myKeys.identityKey.priv);
          const signedPreKeyPrivate = await importPrivateKey(myKeys.signedPreKey.priv);

          let oneTimePreKeyPrivate: CryptoKey | null = null;
          if (data.usedOneTimePreKeyId !== undefined && data.usedOneTimePreKeyId !== null) {
            // Loose comparison in case of string/number mismatch
            const opk = myKeys.oneTimePreKeys.find(k => k.id == data.usedOneTimePreKeyId);

            if (opk) {
              oneTimePreKeyPrivate = await importPrivateKey(opk.priv);
            } else {
              console.warn(`Used OPK ${data.usedOneTimePreKeyId} not found locally.`);
            }
          }

          const senderIdentityKey = await importPublicKey(data.senderIdentityKey);
          const senderEphemeralKey = await importPublicKey(data.senderEphemeralKey);

          const sharedSecret = await X3DH.deriveSharedSecretReceiver(
            identityKeyPrivate,
            signedPreKeyPrivate,
            oneTimePreKeyPrivate,
            senderIdentityKey,
            senderEphemeralKey
          );

          const dr = new DoubleRatchet();
          await dr.init(sharedSecret);
          ratchets.set(key, dr);
          console.log("✅ Session established (Receiver side) with", data.from);

        } catch (e) {
          console.error("Failed to establish session (Receiver)", e);
        }
      })();

      pendingSessions.set(key, sessionPromise);

      // Clean up after done
      sessionPromise.finally(() => {
        if (pendingSessions.get(key) === sessionPromise) {
          pendingSessions.delete(key);
        }
      });
    });

    // אם כבר מחוברים והמשתמש השתנה – לרשום אותו מחדש
    if (socket.connected) {
      socket.emit('register-session', myId)
      // Key registration repeated...
      import('./crypto/keyManager').then(async ({ KeyManager }) => {
        const keys = await KeyManager.generateAndSaveKeys(myId);
        if (keys) {
          const publicBundle = KeyManager.getPublicBundle(keys);
          socket.emit('register-keys', publicBundle, (res: any) => { })
        }
      });
    }

    return () => {
      socket.off('connect')
      socket.off('connect_error')
      socket.off('receive-message', handleReceiveMessage)
      socket.off('session-request')
    }
  }, [myId, selectedChat]);

  const handleSelectChat = (chatId: string) => {
    setSelectedChat(chatId)
    setChats(chats.map(chat =>
      chat.id === chatId ? { ...chat, unread: 0 } : chat
    ))
  }

  const handleSelectContact = (contact: Contact) => {
    const existingChat = chats.find(chat => chat.id === contact.id)
    if (existingChat) {
      setSelectedChat(contact.id)
    } else {
      const newChat: Chat = {
        id: contact.id,
        name: contact.name,
        avatar: contact.avatar,
        lastMessage: '',
        timestamp: '',
        unread: 0
      }
      setChats([...chats, newChat])
      setSelectedChat(contact.id)
    }
    setShowContactsModal(false)
  }

  // --- לוגיקה מעודכנת: שליחת הודעה עם Socket.io ---
  const handleSendMessage = async (text: string) => {
    if (!selectedChat || !text.trim()) return

    const newMessage: Message = {
      id: Date.now().toString(),
      chatId: selectedChat,
      text: text.trim(),
      sender: 'אני',
      timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      isOwn: true
    }

    // Check if we have a ratchet session
    const ratchetKey = [myId, selectedChat].sort().join('|')
    let dr = ratchets.get(ratchetKey);

    try {
      if (!dr) {
        console.log("Initiating new session with", selectedChat);

        // 1. Fetch PreKey Bundle from Server
        const bundlePromise = new Promise<any>((resolve, reject) => {
          socket.emit('get-prekey-bundle', { userId: selectedChat }, (res: any) => {
            if (res.ok) resolve(res.bundle);
            else reject(res.error);
          });
        });

        const recipientBundle = await bundlePromise;
        console.log("Got bundle:", recipientBundle);

        // 2. Perform X3DH (Client Side)
        const { KeyManager } = await import('./crypto/keyManager');
        const { X3DH } = await import('./crypto/x3dh');
        const { DoubleRatchet } = await import('./crypto/ratchet');

        const myKeys = KeyManager.getKeys(myId);
        if (!myKeys) throw new Error("My keys not found");

        const { importPrivateKey } = await import('./crypto/web-crypto-utils');
        const myIdentityPriv = await importPrivateKey(myKeys.identityKey.priv);

        // Generate Ephemeral Key for this session
        const ephemeralKeyPair = await window.crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
        ) as CryptoKeyPair;

        const { sharedSecret } = await X3DH.deriveSharedSecret(
          myIdentityPriv,
          ephemeralKeyPair.privateKey,
          recipientBundle
        );

        // 3. Initialize Ratchet
        dr = new DoubleRatchet();
        await dr.init(sharedSecret);
        ratchets.set(ratchetKey, dr);

        // 4. Send "Session Request" / "Handshake" message to Recipient
        const { exportPublicKey } = await import('./crypto/web-crypto-utils');
        const ephemeralPublicBase64 = await exportPublicKey(ephemeralKeyPair.publicKey);

        socket.emit('session-request', {
          to: selectedChat,
          from: myId,
          senderIdentityKey: myKeys.identityKey.pub,
          senderEphemeralKey: ephemeralPublicBase64,
          usedOneTimePreKeyId: recipientBundle.oneTimePreKeyId ?? null // Fix: 0 is falsy, use ?? null
        });
      }

      // Encrypt
      const ciphertext = await dr.encrypt(text.trim());

      // Send
      socket.emit('send-message', {
        to: selectedChat,
        from: myId,
        ciphertext: ciphertext
      });

      // Update UI only after successful send
      setMessages(prev => [...prev, newMessage])

      const selectedChatData = chats.find(c => c.id === selectedChat)
      if (selectedChatData) {
        setChats(chats.map(chat =>
          chat.id === selectedChat
            ? { ...chat, lastMessage: text.trim(), timestamp: newMessage.timestamp }
            : chat
        ))
      }

    } catch (e) {
      console.error("Failed to send message", e);
      alert("Encrypted session failed: " + e);
    }
  }

  const handleDeleteChat = () => {
    if (!selectedChat) return
    setChats(chats.filter(chat => chat.id !== selectedChat))
    setMessages(messages.filter(message => message.chatId !== selectedChat))
    setSelectedChat(null)
  }

  const selectedChatData = selectedChat ? chats.find(c => c.id === selectedChat) : null
  const chatMessages = selectedChat ? messages.filter(m => m.chatId === selectedChat) : []

  return (
    <div className="app">
      <div className="app-container">
        {/* פס עליון לבחירת המשתמש המחובר */}
        <div className="app-topbar">
          <span className="app-topbar-label">אני מחובר כ</span>
          <select
            value={myId}
            onChange={(e) => setMyId(e.target.value)}
            className="app-topbar-select"
          >
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <ChatList
          chats={chats}
          selectedChat={selectedChat}
          onSelectChat={handleSelectChat}
          onNewChat={() => setShowContactsModal(true)}
        />
        {selectedChatData ? (
          <ChatWindow
            chat={selectedChatData}
            messages={chatMessages}
            onSendMessage={handleSendMessage}
            onDeleteChat={handleDeleteChat}
          />
        ) : (
          <div className="empty-chat">
            <div className="empty-chat-content">
              <h2>CipherChat</h2>
              <p>בחר צ'אט כדי להתחיל לשוחח</p>
            </div>
          </div>
        )}
      </div>
      {showContactsModal && (
        <ContactsModal
          contacts={contacts}
          onSelectContact={handleSelectContact}
          onClose={() => setShowContactsModal(false)}
        />
      )}
    </div>
  )
}

export default App