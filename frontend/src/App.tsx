import { useState, useEffect } from 'react'
import ChatList from './components/ChatList'
import ChatWindow from './components/ChatWindow'
import ContactsModal from './components/ContactsModal'
import { DoubleRatchet } from './crypto/ratchet'
import './App.css'

// Connection to server (make sure the server is running on port 3001)
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

  // Current user ID (can be selected from the UI)
  const [myId, setMyId] = useState<string>('4')

  // Double Ratchet instances for decrypting messages
  const [ratchets] = useState<Map<string, DoubleRatchet>>(new Map())


  // Reset chats and messages when changing user
  useEffect(() => {
    setChats([])
    setMessages([])
    setSelectedChat(null)
    ratchets.clear()
  }, [myId])


  // Listen for incoming messages from the server and registration
  useEffect(() => {
    socket.on('connect', async () => {
      console.log('Connected to Socket.IO server, id:', socket.id)

      // Register with the server with my ID
      socket.emit('register-session', myId)

      // Create cryptographic keys in the browser and send Public Keys to the server
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

      // Decrypt the message with Double Ratchet
      const ratchetKey = [myId, fromId].sort().join('|')
      let ratchet = ratchets.get(ratchetKey)
      let plaintext = ''

      try {
        let ciphertextToDecrypt = data.ciphertext;

        // Check if this is a PreKeyMessage (First Message)
        // We expect data.ciphertext to be an object: { type: 'prekey', header: {...}, ciphertext: string }
        // Or it might be passed as a string/JSON.
        let payload: any = data.ciphertext;
        if (typeof payload === 'string' && payload.startsWith('{')) {
          try { payload = JSON.parse(payload); } catch { }
        }

        if (payload?.type === 'prekey') {
          console.log("📩 Received PreKeyMessage (First Message) from", fromId);
          const { header } = payload;

          // Perform X3DH Receiver Side
          const { KeyManager } = await import('./crypto/keyManager');
          const { X3DH } = await import('./crypto/x3dh');
          const { DoubleRatchet } = await import('./crypto/ratchet');
          const { importPublicKey, importPrivateKey } = await import('./crypto/web-crypto-utils');

          const myKeys = KeyManager.getKeys(myId);
          if (myKeys) {
            const identityKeyPrivate = await importPrivateKey(myKeys.identityKey.priv);
            const signedPreKeyPrivate = await importPrivateKey(myKeys.signedPreKey.priv);

            let oneTimePreKeyPrivate: CryptoKey | null = null;
            if (header.usedOneTimePreKeyId !== null && header.usedOneTimePreKeyId !== undefined) {
              const opk = myKeys.oneTimePreKeys.find(k => k.id == header.usedOneTimePreKeyId);
              if (opk) oneTimePreKeyPrivate = await importPrivateKey(opk.priv);
            }

            const senderIdentityKey = await importPublicKey(header.senderIdentityKey);
            const senderEphemeralKey = await importPublicKey(header.senderEphemeralKey);

            const sharedSecret = await X3DH.deriveSharedSecretReceiver(
              identityKeyPrivate,
              signedPreKeyPrivate,
              oneTimePreKeyPrivate,
              senderIdentityKey,
              senderEphemeralKey
            );

            ratchet = new DoubleRatchet();
            await ratchet.init(sharedSecret);
            ratchets.set(ratchetKey, ratchet);
            console.log("✅ Session established from PreKeyMessage");

            ciphertextToDecrypt = payload.ciphertext;
          }
        }

        if (!ratchet) {
          console.warn(`No active ratchet session for ${ratchetKey}.`);
          plaintext = "[Encrypted Message - Session Missing]";
        } else {
          plaintext = await ratchet.decrypt(ciphertextToDecrypt);
          console.log('✅ Decrypted message:', plaintext)
        }

      } catch (e) {
        console.error("Decryption failed", e);
        plaintext = "[Decryption Error]";
      }

      // Update chat list
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
              lastMessage: plaintext,  // decrypted text
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

      // Add message to message list
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

    // If already connected and user changed - re-register
    if (socket.connected) {
      socket.emit('register-session', myId)
      // Key registration repeated...
      import('./crypto/keyManager').then(async ({ KeyManager }) => {
        const keys = await KeyManager.generateAndSaveKeys(myId);
        if (keys) {
          const publicBundle = KeyManager.getPublicBundle(keys);
          socket.emit('register-keys', publicBundle, () => { })
        }
      });
    }

    return () => {
      socket.off('connect')
      socket.off('connect_error')
      socket.off('receive-message', handleReceiveMessage)
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

  // sending message with Socket.io
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
      let finalCiphertext: any = null;

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

        // Encrypt message
        const encrypted = await dr.encrypt(text.trim());

        // 4. Bundle handshake payload (PreKeyMessage)
        const { exportPublicKey } = await import('./crypto/web-crypto-utils');
        const ephemeralPublicBase64 = await exportPublicKey(ephemeralKeyPair.publicKey);

        finalCiphertext = {
          type: 'prekey',
          header: {
            senderIdentityKey: myKeys.identityKey.pub,
            senderEphemeralKey: ephemeralPublicBase64,
            usedOneTimePreKeyId: recipientBundle.oneTimePreKeyId ?? null
          },
          ciphertext: encrypted
        };
        console.log("Sending PreKeyMessage...");

      } else {
        // Normal message
        finalCiphertext = await dr.encrypt(text.trim());
      }

      // Send
      socket.emit('send-message', {
        to: selectedChat,
        from: myId,
        ciphertext: finalCiphertext
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