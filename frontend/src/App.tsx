
import { useState, useEffect, useRef } from 'react'
import ChatList from './components/ChatList'
import ChatWindow from './components/ChatWindow'
import ContactsModal from './components/ContactsModal'
import { KeyManager } from './crypto/KeyManager'
import { Protocol } from './crypto/Protocol'
import './App.css'

// חיבור לשרת (וודא שהשרת רץ על פורט 3001)
import { io, Socket } from 'socket.io-client'

const socket: Socket = io('http://localhost:3001', {
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

  // Protocol & KeyManager refs to persist across renders
  const keyManagerRef = useRef<KeyManager | null>(null)
  const protocolRef = useRef<Protocol | null>(null)

  // איפוס צ'אטים והודעות כשמחליפים משתמש
  useEffect(() => {
    setChats([])
    setMessages([])
    setSelectedChat(null)

    // Init crypto for new user
    const km = new KeyManager(myId);
    const proto = new Protocol(km);
    keyManagerRef.current = km;
    protocolRef.current = proto;

    // Ensure keys exist and register with server
    km.ensureKeysExist().then(async (justGenerated) => {
      if (justGenerated || socket.connected) {
        // Upload keys
        const bundle = km.getPublicKeyBundle();
        socket.emit('register-keys', bundle, (res: any) => {
          if (res.ok) console.log('✅ Keys uploaded to server');
          else console.error('❌ Failed to upload keys', res);
        });
      }
    });

  }, [myId])


  // --- האזנה להודעות נכנסות מהשרת והרשמה ---
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to Socket.IO server, id:', socket.id)

      // הרשמה לשרת עם ה-ID שלי
      socket.emit('register-session', myId)

      // Upload keys if we have them
      if (keyManagerRef.current) {
        const bundle = keyManagerRef.current.getPublicKeyBundle();
        socket.emit('register-keys', bundle);
      }
    })

    socket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err.message)
    })

    // Handle incoming session requests (X3DH Init)
    socket.on('session-request', async (data: any) => {
      // data: { from, senderIdentityKey, senderEphemeralKey, ... }
      console.log('Received session request from', data.from);
      if (protocolRef.current) {
        await protocolRef.current.handleSessionRequest(data);
      }
    });

    const handleReceiveMessage = async (data: any) => {
      const fromId = data.from as string
      const timestamp = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

      let plaintext = '[Encrypted Message]';
      if (protocolRef.current) {
        try {
          plaintext = await protocolRef.current.decryptMessage(fromId, myId, data.ciphertext);
        } catch (e) {
          console.error('Decryption error:', e);
          plaintext = '[Decryption Failed]';
        }
      }

      console.log('✅ Decrypted message:', plaintext)

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
              lastMessage: plaintext,
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
      const incomingMessage: Message = {
        id: Date.now().toString(),
        chatId: fromId,
        text: plaintext,
        sender: fromId,
        timestamp,
        isOwn: false,
      }
      setMessages(prev => [...prev, incomingMessage])
    }

    socket.on('receive-message', handleReceiveMessage)

    // אם כבר מחוברים והמשתמש השתנה – לרשום אותו מחדש
    if (socket.connected) {
      socket.emit('register-session', myId)
      if (keyManagerRef.current) {
        /* 
           We might re-upload, but optimization: 
           only if needed. For now, innocent re-upload is fine. 
        */
        const bundle = keyManagerRef.current.getPublicKeyBundle();
        socket.emit('register-keys', bundle);
      }
    }

    return () => {
      socket.off('connect')
      socket.off('connect_error')
      socket.off('session-request')
      socket.off('receive-message', handleReceiveMessage)
    }
  }, [myId, selectedChat]); // Removed `ratchets` dependency as it's now in ref

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
    if (!protocolRef.current) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      chatId: selectedChat,
      text: text.trim(),
      sender: 'אני',
      timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      isOwn: true
    }

    try {
      // Ensure session exists
      if (!protocolRef.current.hasSession(selectedChat, myId)) {
        console.log('Orchestrating X3DH handshake...');
        await protocolRef.current.initSessionAsSender(selectedChat, myId, 'http://localhost:3001', socket);
      }

      // Encrypt
      const ciphertext = await protocolRef.current.encryptMessage(selectedChat, myId, text.trim());

      // Send
      socket.emit('send-message', {
        to: selectedChat,
        from: myId,
        ciphertext: ciphertext,
      })

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
      console.error('Failed to send message:', e);
      alert('Failed to send secure message. Check console.');
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
              <h2>CipherChat - E2EE</h2>
              <p>בחר צ'אט כדי להתחיל לשוחח באופן מאובטח</p>
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