import React, { useState, useRef, useEffect } from 'react'
import { Chat, Message } from '../App'
import MessageBubble from './MessageBubble'
import EmojiPicker from './EmojiPicker'
import './ChatWindow.css'

interface ChatWindowProps {
  chat: Chat
  messages: Message[]
  onSendMessage: (text: string) => void
  onDeleteChat: () => void
}

const ChatWindow: React.FC<ChatWindowProps> = ({ chat, messages, onSendMessage, onDeleteChat }) => {
  const [inputValue, setInputValue] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // איפוס תיבת הקלט כשמחליפים צ'אט
  useEffect(() => {
    setInputValue('')
  }, [chat.id])


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim()) {
      onSendMessage(inputValue)
      setInputValue('')
      setShowEmojiPicker(false)
    }
  }

  const handleEmojiSelect = (emoji: string) => {
    onSendMessage(emoji)
    setShowEmojiPicker(false)
  }

  const handleDeleteChat = () => {
    onDeleteChat()
    setShowMenu(false)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuButtonRef.current && !menuButtonRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
      if (emojiButtonRef.current && !emojiButtonRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false)
      }
    }

    if (showMenu || showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMenu, showEmojiPicker])

  return (
    <div className="chat-window">
      <div className="chat-window-header">
        <div className="chat-window-avatar">{chat.avatar}</div>
        <div className="chat-window-info">
          <h2>{chat.name}</h2>
          <span className="chat-status">מחובר</span>
        </div>
        <div className="chat-window-actions">
          <div className="menu-wrapper" ref={menuButtonRef}>
            <button
              className="icon-button"
              onClick={() => setShowMenu(!showMenu)}
            >
              ⋯
            </button>
            {showMenu && (
              <div className="dropdown-menu">
                <button className="dropdown-item delete-item" onClick={handleDeleteChat}>
                  🗑️ מחק שיחה
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="chat-messages">
        {messages.map(message => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <div className="chat-input-container">
          <div className="emoji-button-wrapper" ref={emojiButtonRef}>
            <button
              type="button"
              className="icon-button emoji-button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            >
              😊
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                onSelectEmoji={handleEmojiSelect}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>
          <input
            type="text"
            className="chat-input"
            placeholder="הקלד הודעה..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            dir="rtl"
          />
          <button
            type="submit"
            className={`send-button ${inputValue.trim() ? 'active' : ''}`}
            disabled={!inputValue.trim()}
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  )
}

export default ChatWindow