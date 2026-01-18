import React from 'react'
import { Chat } from '../App'
import './ChatList.css'

interface ChatListProps {
  chats: Chat[]
  selectedChat: string | null
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
}

const ChatList: React.FC<ChatListProps> = ({ chats, selectedChat, onSelectChat, onNewChat }) => {
  return (
    <div className="chat-list">
      <div className="chat-list-header">
        <h1>CipherChat</h1>
        <button className="new-chat-button" onClick={onNewChat} title="שיחה חדשה">
          ✏️
        </button>
      </div>
      <div className="chat-list-items">
        {chats.map(chat => (
          <div
            key={chat.id}
            className={`chat-item ${selectedChat === chat.id ? 'active' : ''}`}
            onClick={() => onSelectChat(chat.id)}
          >
            <div className="chat-avatar">{chat.avatar}</div>
            <div className="chat-info">
              <div className="chat-header">
                <span className="chat-name">{chat.name}</span>
                <span className="chat-timestamp">{chat.timestamp}</span>
              </div>
              <div className="chat-footer">
                {chat.lastMessage ? (
                  <span className="chat-message">{chat.lastMessage}</span>
                ) : (
                  <span className="chat-message-empty">אין הודעות</span>
                )}
                {chat.unread > 0 && (
                  <span className="chat-unread">{chat.unread}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ChatList