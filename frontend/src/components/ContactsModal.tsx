import React from 'react'
import { Contact } from '../App'
import './ContactsModal.css'

interface ContactsModalProps {
  contacts: Contact[]
  onSelectContact: (contact: Contact) => void
  onClose: () => void
}

const ContactsModal: React.FC<ContactsModalProps> = ({ contacts, onSelectContact, onClose }) => {
  return (
    <div className="contacts-modal-overlay" onClick={onClose}>
      <div className="contacts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="contacts-modal-header">
          <h2>בחר איש קשר</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>
        <div className="contacts-list">
          {contacts.map(contact => (
            <div
              key={contact.id}
              className="contact-item"
              onClick={() => onSelectContact(contact)}
            >
              <div className="contact-avatar">{contact.avatar}</div>
              <span className="contact-name">{contact.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ContactsModal