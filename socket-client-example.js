// Optional Socket.IO client example.
// Run this only after installing socket.io-client in a separate test folder:
// npm install socket.io-client

const { io } = require("socket.io-client");

const socket = io("http://localhost:5000");

socket.on("connect", () => {
  console.log("Connected:", socket.id);

  socket.emit("joinRoom", "general");

  setTimeout(() => {
    socket.emit("chatMessage", {
      room: "general",
      username: "Sahid",
      message: "Hello from the real-time chat!"
    });
  }, 500);
});

socket.on("systemMessage", (data) => {
  console.log("SYSTEM:", data);
});

socket.on("chatMessage", (data) => {
  console.log("CHAT:", data);
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
});
