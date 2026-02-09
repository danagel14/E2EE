import { useState, useEffect } from 'react'
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

  // איפוס צ'אטים והודעות כשמחליפים משתמש
  useEffect(() => {
    setChats([])
    setMessages([])
    setSelectedChat(null)
    ratchets.clear()
  }, [myId])


  // --- האזנה להודעות נכנסות מהשרת והרשמה ---
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to Socket.IO server, id:', socket.id)

      // הרשמה לשרת עם ה-ID שלי
      socket.emit('register-session', myId)

      // יצירת מפתחות קריפטוגרפיים אמיתיים בשרת
      socket.emit('register-keys', { userId: myId }, (res: any) => {
        if (res.ok) {
          console.log('✅ Cryptographic keys registered for user', myId)
        } else {
          console.log('ℹ️', res.message || 'Keys registration response', res)
        }
      })
    })

    socket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err.message)
    })

    const handleReceiveMessage = (data: any) => {
      const fromId = data.from as string
      const timestamp = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

      // פענוח ההודעה עם Double Ratchet
      const ratchetKey = [myId, fromId].sort().join('|')
      let plaintext = data.ciphertext

      let ratchet = ratchets.get(ratchetKey)

      // אם אין ratchet, ליצור אחד (המקבל צריך גם ratchet!)
      if (!ratchet) {
        console.log('🔑 Creating receiver ratchet for', ratchetKey)
        const demoSecret = `secret-${ratchetKey}`
        ratchet = new DoubleRatchet(demoSecret)
        ratchets.set(ratchetKey, ratchet)
      }

      // פענוח ההודעה
      plaintext = ratchet.decrypt(data.ciphertext)
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
              lastMessage: plaintext,  // הטקסט המפוענח!
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
        text: plaintext,  // הטקסט המפוענח!
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

      socket.emit('register-keys', { userId: myId }, (res: any) => {
        if (res.ok) {
          console.log('✅ Keys registered/verified for user', myId)
        }
      })
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

  // --- לוגיקה מעודכנת: שליחת הודעה עם Socket.io ---
  const handleSendMessage = (text: string) => {
    if (!selectedChat || !text.trim()) return

    const newMessage: Message = {
      id: Date.now().toString(),
      chatId: selectedChat,
      text: text.trim(),
      sender: 'אני',
      timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      isOwn: true
    }

    // יצירת ratchet בצד הקליינט לפני שליחת ההודעה
    const ratchetKey = [myId, selectedChat].sort().join('|')
    if (!ratchets.has(ratchetKey)) {
      // בפועל צריך לקבל shared secret מ-X3DH, אבל לדמו נשתמש במפתח פשוט
      const demoSecret = `secret-${ratchetKey}`
      ratchets.set(ratchetKey, new DoubleRatchet(demoSecret))
      console.log('✅ Created client ratchet for', ratchetKey)
    }

    // בקשה ל-init-session ושליחת ההודעה רק אחרי אתחול
    socket.emit('init-session', { from: myId, to: selectedChat }, (res: any) => {
      console.log('init-session result', res)

      const r = ratchets.get([myId, selectedChat].sort().join('|'))
      // אם יש מפתח מצפינים, אחרת שולחים רגיל (רק ליתר ביטחון)
      const encrypted = r ? r.encrypt(text.trim()) : text.trim()
      // שליחת טקסט גלוי – השרת יבצע "הצפנה" בסיסית
      socket.emit('send-message', {
        to: selectedChat,
        from: myId,
        ciphertext: encrypted, 
        // plaintext: text.trim(), // (מחקנו את השורה הזו)
      })
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