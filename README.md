This project is a full-stack application designed to demonstrate or implement End-to-End Encryption (E2EE). It ensures that communication remains private and secure by encrypting data on the client side before it reaches the server.
Technologies Used
• Primary Language: TypeScript (86.8%)
• Styling: CSS (12.6%)
• Infrastructure: Docker & Docker Compose for easy deployment
• Environment: Node.js

Project Structure
Based on the repository's architecture:
• /crypto: Contains the core logic for encryption and decryption algorithms.
• /frontend: The client-side application where users interact and where encryption/decryption typically occurs.
• /server: The backend service responsible for handling encrypted data, user sessions, and routing.
• /shared: Common types, interfaces, and utilities shared between the frontend and the server.
• /node_modules: Project dependencies.

Setup and Installation
Prerequisites
• Node.js and npm installed.
• Docker (optional, for containerized deployment).

Local Development
1. Clone the repository:
2. Install dependencies:
3. Run the development environment: (Note: Specific scripts like npm start or npm run dev should be defined in your package.json).
Using Docker
The project includes a Dockerfile and docker-compose.yml for streamlined setup:
docker-compose up --build

Security Features
• Client-Side Encryption: Sensitive data is encrypted before transmission.
• TypeScript Implementation: Strong typing ensures code reliability and fewer runtime errors in cryptographic operations.
