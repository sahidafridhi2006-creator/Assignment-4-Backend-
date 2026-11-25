# Lab 4 Submission Report

## Title
Secure Connect and Communication Platform

## Objective
To implement secure authentication, JWT-protected APIs, RBAC, Notes CRUD, Socket.IO real-time communication, EventEmitter-based events, and dotenv configuration.

## Implementation
The project contains:
- `server.js` – complete backend
- `.env.example` – environment configuration template
- `data/users.json` and `data/notes.json` – persistence
- `postman/Secure-Connect-Lab4.postman_collection.json` – Postman test collection
- `socket-client-example.js` – optional Socket.IO test client

## Postman Test Evidence
After starting the server, import the collection and execute all requests. Capture screenshots of:
1. Signup – 201
2. Login – 200 with JWT
3. Profile – 200
4. Notes without token – 401
5. Create note – 201
6. Get notes – 200
7. Get note by ID – 200
8. Update note – 200
9. Delete note – 200
10. Admin users as normal user – 403

## Conclusion
The Secure Connect platform demonstrates authentication, authorization, secure password handling, protected CRUD APIs, RBAC, environment variables, event-driven backend behaviour, and real-time communication with Socket.IO.
