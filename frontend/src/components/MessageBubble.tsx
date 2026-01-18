import React from 'react'
import { Message } from '../App'
import './MessageBubble.css'

interface MessageBubbleProps {
  message: Message
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  return (
    <div className={`message-container ${message.isOwn ? 'own' : 'other'}`}>
      <div className={`message-bubble ${message.isOwn ? 'own' : 'other'}`}>
        <p>{message.text}</p>
        <span className="message-time">{message.timestamp}</span>
      </div>
    </div>
  )
}

export default MessageBubble