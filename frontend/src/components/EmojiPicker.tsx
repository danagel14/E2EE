import React from 'react'
import './EmojiPicker.css'

interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void
  onClose: () => void
}

const emojis = ['😊', '😂', '❤️', '👍', '👎', '🎉', '🔥', '💯', '😍', '😢', '🤔', '👏']

const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelectEmoji, onClose }) => {
  const handleEmojiClick = (emoji: string) => {
    onSelectEmoji(emoji)
  }

  return (
    <div className="emoji-picker">
      <div className="emoji-grid">
        {emojis.map((emoji, index) => (
          <button
            key={index}
            className="emoji-item"
            onClick={() => handleEmojiClick(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}

export default EmojiPicker