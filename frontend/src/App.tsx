import React, { useState } from 'react'
import ChatList from './components/ChatList'
import ChatWindow from './components/ChatWindow'
import ContactsModal from './components/ContactsModal'
import './App.css'

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

const initialChats: Chat[] = []
const initialMessages: Message[] = []

function App() {
  const [selectedChat, setSelectedChat] = useState<string | null>(null)
  const [chats, setChats] = useState<Chat[]>(initialChats)
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [showContactsModal, setShowContactsModal] = useState(false)

  const handleSelectChat = (chatId: string) => {
    setSelectedChat(chatId)
    // Mark as read
    setChats(chats.map(chat => 
      chat.id === chatId ? { ...chat, unread: 0 } : chat
    ))
  }

  const handleSelectContact = (contact: Contact) => {
    // Check if chat already exists
    const existingChat = chats.find(chat => chat.id === contact.id)
    
    if (existingChat) {
      // Open existing chat
      setSelectedChat(contact.id)
    } else {
      // Create new chat
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

    setMessages([...messages, newMessage])

    // Update chat last message
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
    
    // Remove chat from list
    setChats(chats.filter(chat => chat.id !== selectedChat))
    // Remove all messages from this chat
    setMessages(messages.filter(message => message.chatId !== selectedChat))
    // Close chat window
    setSelectedChat(null)
  }

  const selectedChatData = selectedChat ? chats.find(c => c.id === selectedChat) : null
  const chatMessages = selectedChat ? messages.filter(m => m.chatId === selectedChat) : []

  return (
    <div className="app">
      <div className="app-container">
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